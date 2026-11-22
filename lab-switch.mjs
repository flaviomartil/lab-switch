#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'
import headless from '@xterm/headless'
import { WebSocket, WebSocketServer } from 'ws'
import { configuration } from './lib/config.mjs'
import { ClaudeJournal, turnSummary } from './lib/telemetry.mjs'
import { defaultHistoryPath, historyStore } from './lib/history.mjs'

const root = dirname(fileURLToPath(import.meta.url))
if (process.argv.includes('--help')) {
  console.log('lab-switch [start] [--kind mod|skill|hook|mcp|agent --item PATH] [--project PATH] [--model NAME] [--port 4178] [--code-mode] [--active-codeflow] [--history-dir PATH] [--demo]')
  process.exit(0)
}
const scratch = await mkdtemp(join(tmpdir(), 'lab-switch-'))
let config
try {
  if (process.platform === 'darwin') {
    const helper = join(root, 'node_modules', 'node-pty', 'prebuilds', 'darwin-' + process.arch, 'spawn-helper')
    if (existsSync(helper)) {
      const mode = statSync(helper).mode
      if ((mode & 0o100) === 0) chmodSync(helper, (mode & 0o777) | 0o100)
    }
  }
  config = configuration(process.argv.slice(2), root, scratch)
} catch (error) {
  console.error(error.message)
  await rm(scratch, { recursive: true, force: true })
  process.exit(1)
}

const ids = ['with', 'without']
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65_536 })
const lanes = new Map()
const title = config.itemName
const history = historyStore(config.historyDir ?? (config.demo ? join(scratch, 'history') : defaultHistoryPath()))
const comparisons = new Map()
const labels = config.telemetryOnly
  ? { with: 'Com telemetria', without: 'Sem telemetria' }
  : { with: 'Com ' + title, without: 'Sem ' + title }
let dimensions = { cols: 74, rows: 19 }
let run = 0
let pairId
let sending = false
let transitioning = false
let closing = false
let collecting

function push(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > 1_048_576) {
    socket.close(1013, 'Terminal congestionado')
    return
  }
  socket.send(JSON.stringify(payload))
}

function broadcast(payload) {
  for (const socket of sockets.clients) push(socket, payload)
}

function laneStatus(lane) {
  if (!lane || lane.exit !== null) return lane?.exit ? 'error' : 'stopped'
  if (lane.stopping) return 'stopping'
  return lane.status
}

function status() {
  return {
    type: 'state', run, sending, transitioning,
    lanes: Object.fromEntries(ids.map(id => [id, {
      status: laneStatus(lanes.get(id)), permissionMode: lanes.get(id)?.permissionMode ?? null,
    }])),
  }
}

function inspect(lane) {
  const buffer = lane.screen.buffer.active
  const view = Array.from({ length: lane.screen.rows }, (_, i) =>
    buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '')
  const scope = view.filter(line => line.trim()).slice(-14).join('\n')
  const line = view[buffer.cursorY] ?? ''
  const prompt = line.match(/^\s*([❯›])(?:\s|$)/)
  if (/Do you (?:want|trust)|(?:Allow|Approve) this|permission (?:prompt|required)|Yes,\s+(?:allow|proceed|I trust)|Esc to cancel|Bypass Permissions mode.*(?:warning|risk|danger)|Yes, I accept/i.test(scope)) return 'approval'
  if (/Select (?:a |the )?login method|Log in to Claude|Copy this URL|Security notes|Press Enter to continue|Choose the text style|theme.*(?:dark|light)|Use Claude Code with your/i.test(scope)) return 'setup'
  if (/\b(?:Thinking|Working|Pondering|Baking|Brewing|Cooking|Running)\b.*(?:esc to interrupt|…|\.\.\.)|esc to interrupt/i.test(scope)) return 'running'
  if (prompt) {
    const text = line.slice(line.indexOf(prompt[1]) + 1).trim()
    if (!text || (buffer.cursorX <= line.indexOf(prompt[1]) + 2 && /^(?:Try|Ask|Describe|What)\b/.test(text))) return 'ready'
    if (/^\s*[─━]{5,}\s*$/.test(view[buffer.cursorY - 1] ?? '')) return 'draft'
  }
  const lastFrame = view.findLastIndex(row => /^\s*[─━]{5,}\s*$/.test(row))
  if (lastFrame >= 2 && /^\s*[❯›]\s*$/.test(view[lastFrame - 1]) &&
    /^\s*[─━]{5,}\s*$/.test(view[lastFrame - 2])) return 'ready'
  return lane.received ? 'running' : 'starting'
}

function refreshLane(lane) {
  if (lanes.get(lane.id) !== lane || lane.exit !== null || lane.stopping || sending || lane.outputPending) return
  const value = inspect(lane)
  if (value === 'ready' && Date.now() < lane.inputUntil) return
  const buffer = lane.screen.buffer.active
  const rows = Array.from({ length: 6 }, (_, index) =>
    buffer.getLine(buffer.baseY + lane.screen.rows - 1 - index)?.translateToString(true) ?? '')
  const mode = rows.join('\n').match(/(bypass permissions|manual mode|auto mode|plan mode|accept edits) on/i)?.[1]?.toLowerCase()
  if (value === lane.status && (!mode || mode === lane.permissionMode)) return
  lane.status = value
  if (mode) lane.permissionMode = mode
  broadcast(status())
}

function submitLane(lane) {
  lane.status = 'running'
  lane.inputUntil = Date.now() + 300
  clearTimeout(lane.recheck)
  lane.recheck = setTimeout(() => refreshLane(lane), 310)
}

function receive(lane, data) {
  if (lanes.get(lane.id) !== lane) return
  lane.received = true
  lane.outputPending += 1
  lane.history = (lane.history + data).slice(-393_216)
  broadcast({ type: 'data', run: lane.run, lane: lane.id, data })
  lane.screen.write(data, () => {
    lane.outputPending -= 1
    refreshLane(lane)
  })
}

function spawnLane(id, directory) {
  const sessionId = randomUUID()
  const { args, env } = config.createLane(id, join(directory, id), sessionId)
  const process = pty.spawn(config.command, args, {
    name: 'xterm-256color', ...dimensions, cwd: join(directory, id), env,
  })
  const screen = new headless.Terminal({ ...dimensions, scrollback: 20, allowProposedApi: true })
  const lane = {
    id, run, process, screen, history: '', exit: null, stopping: false,
    status: 'starting', received: false, inputUntil: 0, outputPending: 0,
    journal: new ClaudeJournal(config.profiles[id], sessionId), permissionMode: null,
  }
  lanes.set(id, lane)
  process.onData(data => receive(lane, data))
  lane.ended = new Promise(resolve => {
    process.onExit(({ exitCode }) => {
      lane.exit = lane.stopping ? 0 : exitCode
      clearTimeout(lane.recheck)
      lane.screen.dispose()
      if (lanes.get(id) === lane) broadcast(status())
      resolve()
    })
  })
}

function terminate(lane, signal = 'SIGTERM') {
  if (lane.exit !== null) return
  try {
    process.kill(-lane.process.pid, signal)
  } catch {
    try { lane.process.kill(signal) } catch {}
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function stop() {
  const active = [...lanes.values()].filter(lane => lane.exit === null)
  for (const lane of active) {
    lane.stopping = true
    terminate(lane)
  }
  broadcast(status())
  if (!active.length) return
  const exited = Promise.all(active.map(lane => lane.ended))
  await Promise.race([exited, delay(650)])
  for (const lane of active) terminate(lane, 'SIGKILL')
  await Promise.race([exited, delay(650)])
}

let directory
async function reset() {
  if (sending || transitioning || closing) return
  transitioning = true
  broadcast(status())
  try {
    await stop()
    if ([...lanes.values()].some(lane => lane.exit === null)) throw new Error('Aguarde os terminais encerrarem.')
    if (directory) await rm(directory, { recursive: true, force: true })
    lanes.clear()
    directory = await mkdtemp(join(scratch, 'run-'))
    config.preparePair()
    run += 1
    pairId = randomUUID()
    broadcast({ type: 'reset', run })
    for (const id of ids) spawnLane(id, directory)
  } catch (error) {
    await stop()
    broadcast({ type: 'notice', text: error.message })
  } finally {
    transitioning = false
    broadcast(status())
  }
}

async function publishHistory(socket) {
  try {
    const message = { type: 'history-list', entries: await history.list() }
    if (socket) push(socket, message)
    else broadcast(message)
  } catch {
    const message = { type: 'notice', text: 'Não foi possível ler o histórico do Lab.' }
    if (socket) push(socket, message)
    else broadcast(message)
  }
}

async function collectPending() {
  try {
    for (const pending of comparisons.values()) {
      const { record, pair, after } = pending
      const updated = { ...record, sides: { ...record.sides } }
      let changed = false
      for (const lane of pair) {
        if (record.sides[lane.id]?.complete) continue
        await lane.journal.poll()
        const observed = lane.journal.find(record.prompt, after)
        if (observed?.complete || (lane.exit !== null && observed)) {
          const summary = turnSummary(observed)
          if (JSON.stringify(record.sides[lane.id]) !== JSON.stringify(summary)) {
            updated.sides[lane.id] = summary
            changed = true
          }
        }
      }
      const status = ids.every(id => updated.sides[id]?.complete) ? 'complete'
        : pair.some(lane => lane.exit !== null) ? 'partial' : 'running'
      if (changed || record.status !== status) {
        updated.status = status
        await history.write(updated)
        pending.record = updated
        broadcast({ type: 'history-entry', entry: updated })
        await publishHistory()
      }
      if (status === 'complete' || pair.every(lane => lane.exit !== null)) comparisons.delete(record.id)
    }
  } catch (error) {
    console.error('Histórico:', error.code ?? error.name)
  }
}

function collectHistory() {
  if (!collecting && comparisons.size > 0) {
    collecting = collectPending().finally(() => { collecting = null })
  }
  return collecting
}

const historyPoll = setInterval(() => void collectHistory(), 540).unref()

function updateSize(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 30 || cols > 280 || rows < 10 || rows > 70) return
  if (dimensions.cols === cols && dimensions.rows === rows) return
  dimensions = { cols, rows }
  for (const lane of lanes.values()) {
    if (lane.exit !== null || lane.stopping) continue
    lane.screen.resize(cols, rows)
    lane.process.resize(cols, rows)
    refreshLane(lane)
  }
}

async function sendToBoth(socket, input) {
  const text = typeof input === 'string' ? input.replace(/\r\n/g, '\n').trim() : ''
  if (!text || text.length > 12_000 || /[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(text)) {
    return push(socket, { type: 'notice', text: 'Use de 1 a 12.000 caracteres de texto.' })
  }
  const pair = ids.map(id => lanes.get(id))
  if (sending || transitioning || pair.some(lane => laneStatus(lane) !== 'ready' || lane.outputPending > 0)) {
    return push(socket, { type: 'notice', text: 'Os dois terminais precisam estar no campo de prompt.' })
  }
  sending = true
  for (const lane of pair) submitLane(lane)
  broadcast(status())
  try {
    for (const lane of pair) lane.process.write('\x1b[200~' + text + '\x1b[201~')
    await delay(70)
    if (pair.some(lane => lane.exit !== null || lane.stopping)) throw new Error('Um terminal encerrou antes do envio.')
    const after = Date.now()
    const record = {
      id: randomUUID(), pairId, startedAt: new Date(after).toISOString(), prompt: text,
      item: title, labels, status: 'running', source: config.demo ? 'demo' : 'live',
      sides: { with: null, without: null },
    }
    for (const lane of pair) lane.process.write('\r')
    push(socket, { type: 'sent' })
    try {
      await history.write(record)
      broadcast({ type: 'history-entry', entry: record })
      await publishHistory()
    } catch {
      push(socket, { type: 'notice', text: 'O prompt foi enviado. Falhou a gravação inicial do histórico.' })
    }
    comparisons.set(record.id, { record, pair, after })
  } catch (error) {
    push(socket, { type: 'notice', text: 'Falha ao enviar. Confira os terminais. ' + error.message })
  } finally {
    sending = false
    broadcast(status())
  }
}

const staticFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/compare.svg', ['public/compare.svg', 'image/svg+xml']],
  ['/xterm.js', ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8']],
  ['/xterm.css', ['node_modules/@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8']],
  ['/fit.js', ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript; charset=utf-8']],
  ['/archivo.woff2', ['node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2', 'font/woff2']],
  ['/fraunces.woff2', ['node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2', 'font/woff2']],
  ['/jetbrains.woff2', ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2', 'font/woff2']],
])

function allowedHost(request) {
  const port = server.address()?.port
  return request.headers.host === '127.0.0.1:' + port || request.headers.host === 'localhost:' + port
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  response.setHeader('Referrer-Policy', 'no-referrer')
  if (!allowedHost(request)) {
    response.writeHead(403).end()
    return
  }
  const file = request.method === 'GET' && staticFiles.get(request.url)
  if (!file) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = await readFile(join(root, file[0]))
    response.writeHead(200, { 'Content-Type': file[1] }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})

server.on('upgrade', (request, socket, head) => {
  if (!allowedHost(request) || request.url !== '/terminal' || request.headers.origin !== 'http://' + request.headers.host) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  sockets.handleUpgrade(request, socket, head, peer => sockets.emit('connection', peer))
})

sockets.on('connection', socket => {
  push(socket, {
    type: 'meta', item: title, kind: config.kind, demo: config.demo,
    bypassPermissions: !config.demo,
    labels, telemetryOnly: config.telemetryOnly,
    project: config.projectName, model: config.model, sample: config.projectName === 'Projeto de exemplo',
  })
  push(socket, { type: 'reset', run })
  for (const lane of lanes.values()) {
    if (lane.history) push(socket, { type: 'data', run, lane: lane.id, data: lane.history })
  }
  push(socket, status())
  if (run === 0) void reset()
  socket.on('error', () => undefined)
  socket.on('message', async buffer => {
    let message
    try { message = JSON.parse(buffer.toString()) } catch { return }
    if (!message || typeof message !== 'object' || closing) return
    try {
      if (message.type === 'resize') updateSize(message.cols, message.rows)
      if (message.type === 'reset') await reset()
      if (message.type === 'stop' && !transitioning && !sending) await stop()
      if (message.type === 'send') await sendToBoth(socket, message.text)
      if (message.type === 'history-list') await publishHistory(socket)
      if (message.type === 'history-open') {
        const entry = await history.read(message.id)
        if (entry) push(socket, { type: 'history-open', entry })
      }
      if (message.type === 'input' && !transitioning && !sending && typeof message.data === 'string' && message.data.length <= 16_000) {
        const lane = lanes.get(message.lane)
        if (!lane || lane.exit !== null || lane.stopping) return
        const data = message.data.replace(/\x1b\[[IO]/g, '')
        if (!data) return
        if (data.includes('\r')) {
          submitLane(lane)
          broadcast(status())
        } else if (lane.status === 'ready' && (data.startsWith('\x1b[200~') || /^[^\x00-\x1f\x7f]/.test(data))) {
          lane.status = 'draft'
          broadcast(status())
        }
        lane.process.write(data)
      }
    } catch (error) {
      push(socket, { type: 'notice', text: error.message })
    }
  })
})

async function shutdown() {
  if (closing) return
  closing = true
  clearInterval(historyPoll)
  await stop()
  await collecting
  await collectHistory()
  for (const socket of sockets.clients) socket.terminate()
  server.close()
  await rm(scratch, { recursive: true, force: true })
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
server.on('error', async error => {
  console.error(error.message)
  await shutdown()
})
server.listen(config.port, '127.0.0.1', () => {
  console.log('Lab Switch: http://127.0.0.1:' + server.address().port)
})
