import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { claudeAuthEnvironment, currentOAuthToken } from '../lib/auth.mjs'
import { configuration, hostGitEnvironment } from '../lib/config.mjs'
import { historyStore } from '../lib/history.mjs'
import { readClaudeTurns, turnSummary } from '../lib/telemetry.mjs'

test('reusa apenas o token válido e aceita a credencial fornecida explicitamente', t => {
  const folder = mkdtempSync(join(tmpdir(), 'lab-auth-test-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const path = join(folder, '.credentials.json')
  const oauth = { accessToken: 'oauth-fixture', refreshToken: 'refresh-fixture', expiresAt: Date.now() + 120_000 }
  writeFileSync(path, JSON.stringify({ claudeAiOauth: oauth }), { mode: 0o600 })
  assert.deepEqual(claudeAuthEnvironment({ CLAUDE_CONFIG_DIR: folder }), { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture' })
  assert.deepEqual(claudeAuthEnvironment({ CLAUDE_CONFIG_DIR: folder, ANTHROPIC_API_KEY: 'explicit-fixture' }), { ANTHROPIC_API_KEY: 'explicit-fixture' })
  assert.equal(currentOAuthToken(JSON.stringify({ claudeAiOauth: oauth }), oauth.expiresAt), null)
  assert.equal(currentOAuthToken('not json'), null)
})

test('os dois processos Claude recebem bypass de permissões', t => {
  const staging = mkdtempSync(join(tmpdir(), 'lab-permissions-test-'))
  t.after(() => rmSync(staging, { recursive: true, force: true }))
  const config = configuration(['--claude-bin', process.execPath], process.cwd(), staging)
  for (const lane of ['with', 'without']) {
    const { args, env } = config.createLane(lane, join(staging, lane))
    assert.ok(args.includes('--dangerously-skip-permissions'))
    assert.ok(!args.includes('--permission-mode'))
    assert.equal(env.CLAUDE_CODEFLOW_ENABLED, lane === 'with' ? '0' : undefined)
  }
})

test('herda a configuração do git, o gh e o agente SSH do host', () => {
  const home = mkdtempSync(join(tmpdir(), 'lab-host-'))
  try {
    mkdirSync(join(home, '.config', 'gh'), { recursive: true })
    writeFileSync(join(home, '.gitconfig'), '[user]\n  name = Host\n')
    assert.deepEqual(hostGitEnvironment({ SSH_AUTH_SOCK: '/tmp/agent.sock' }, home), {
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GH_CONFIG_DIR: join(home, '.config', 'gh'), SSH_AUTH_SOCK: '/tmp/agent.sock',
    })
    rmSync(join(home, '.gitconfig'))
    assert.deepEqual(hostGitEnvironment({}, home), { GH_CONFIG_DIR: join(home, '.config', 'gh') })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('acesso pela rede exige o token e guarda o cookie', { timeout: 15_000 }, async t => {
  const historyDir = mkdtempSync(join(tmpdir(), 'lab-remote-test-'))
  t.after(() => rmSync(historyDir, { recursive: true, force: true }))
  const child = spawn(process.execPath, ['lab-switch.mjs', '--demo', '--port', '0', '--listen', '127.0.0.2', '--history-dir', join(historyDir, 'history')], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LAB_TOKEN: 'token-de-teste-com-tamanho-suficiente' },
  })
  t.after(() => { child.kill('SIGTERM') })
  const [raw] = await once(child.stdout, 'data')
  const link = raw.toString().match(/http:\/\/127\.0\.0\.2:\d+\/\?token=\S+/)?.[0]
  assert.ok(link)
  const base = new URL(link).origin
  assert.equal((await fetch(base + '/')).status, 401)
  assert.equal((await fetch(base + '/?token=errado', { redirect: 'manual' })).status, 401)
  const login = await fetch(link, { redirect: 'manual' })
  assert.equal(login.status, 302)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  assert.match(login.headers.get('set-cookie'), /HttpOnly/)
  assert.equal((await fetch(base + '/', { headers: { cookie } })).status, 200)
  const denied = new WebSocket(base.replace('http:', 'ws:') + '/terminal', { origin: base })
  const [, response] = await once(denied, 'unexpected-response')
  assert.equal(response.statusCode, 403)
  response.resume()
  denied.on('error', () => undefined)
  denied.terminate()
  const allowed = new WebSocket(base.replace('http:', 'ws:') + '/terminal', { origin: base, headers: { cookie } })
  const [data] = await once(allowed, 'message')
  assert.equal(JSON.parse(data.toString()).previewPorts.with, Number(new URL(base).port) + 1)
  allowed.terminate()
})

test('dois PTYs recebem a mesma entrada uma vez e voltam ao prompt', { timeout: 25_000 }, async t => {
  const historyDir = mkdtempSync(join(tmpdir(), 'lab-history-test-'))
  t.after(() => rmSync(historyDir, { recursive: true, force: true }))
  const child = spawn(process.execPath, ['lab-switch.mjs', '--demo', '--port', '0', '--history-dir', historyDir], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LAB_BROWSER: join(import.meta.dirname, 'fake-browser.mjs') },
  })
  t.after(() => { child.kill('SIGTERM') })
  const [raw] = await once(child.stdout, 'data')
  const url = raw.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
  assert.ok(url)
  const rejected = new WebSocket(url.replace('http:', 'ws:') + '/terminal', { origin: 'http://localhost:99' })
  const [, response] = await once(rejected, 'unexpected-response')
  assert.equal(response.statusCode, 403)
  response.resume()
  rejected.on('error', () => undefined)
  rejected.terminate()
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/terminal', { origin: url })
  const events = []
  socket.on('message', data => events.push(JSON.parse(data.toString())))
  t.after(() => { socket.terminate() })
  await once(socket, 'open')
  const waitFor = async (condition, attempts = 120) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (condition()) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    const notice = events.findLast(event => event.type === 'notice')
    assert.fail('Estado esperado ausente. ' + JSON.stringify(notice ?? events.at(-1)))
  }
  const state = () => events.findLast(e => e.type === 'state')
  const ready = () => state()?.lanes.with.status === 'ready' && state().lanes.without.status === 'ready'
  const output = lane => events.filter(e => e.type === 'data' && e.lane === lane).map(e => e.data).join('')
  await waitFor(ready)
  socket.send(JSON.stringify({ type: 'input', lane: 'with', data: '\x1b[I' }))
  socket.send(JSON.stringify({ type: 'input', lane: 'with', data: '\x1b[O' }))
  socket.send(JSON.stringify({ type: 'input', lane: 'without', data: '\x1b[I' }))
  socket.send(JSON.stringify({ type: 'input', lane: 'without', data: '\x1b[O' }))
  socket.send(JSON.stringify({ type: 'send', text: 'Primeira linha\nSegunda linha' }))
  await waitFor(() => events.some(e => e.type === 'sent'))
  await waitFor(() => output('with').includes('Entrada recebida') && output('without').includes('Entrada recebida'))
  for (const lane of ['with', 'without']) {
    assert.match(output(lane).replace(/\r/g, ''), /Primeira linha\nSegunda linha/)
    assert.equal(output(lane).split('Entrada recebida').length, 2)
  }
  await waitFor(ready)
  await waitFor(() => events.some(e => e.type === 'history-entry' && e.entry.status === 'complete'))
  const saved = events.find(e => e.type === 'history-entry' && e.entry.status === 'complete').entry
  assert.equal(saved.prompt, 'Primeira linha\nSegunda linha')
  assert.equal(saved.source, 'demo')
  assert.equal(saved.sides.with.input, 31)
  assert.equal(saved.sides.without.input, 31)
  assert.equal(saved.sides.with.model, 'demo-local')
  assert.equal(saved.sides.without.permissionMode, 'simulated')
  assert.deepEqual(await historyStore(historyDir).read(saved.id), saved)
  socket.send(JSON.stringify({ type: 'history-open', id: saved.id }))
  await waitFor(() => events.some(e => e.type === 'history-open' && e.entry.id === saved.id))
  socket.send(JSON.stringify({ type: 'send', text: 'suba o servidor' }))
  await waitFor(() => state()?.lanes.with.preview && state()?.lanes.without.preview)
  assert.equal(state().lanes.with.preview, 'http://127.0.0.1:5173/')
  assert.equal(state().lanes.without.preview, 'http://127.0.0.1:5174/')
  await waitFor(ready)
  const printed = () => events.findLast(e => e.type === 'history-entry' && e.entry.prompt === 'suba o servidor' && e.entry.sides.with?.print && e.entry.sides.without?.print)
  await waitFor(printed, 300)
  const printEntry = printed().entry
  assert.equal(printEntry.sides.with.print.url, 'http://127.0.0.1:5173/')
  const image = await fetch(url + '/history-print/' + printEntry.id + '/with.png?v=' + encodeURIComponent(printEntry.sides.with.print.capturedAt))
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.match(Buffer.from(await image.arrayBuffer()).toString('latin1'), /PNG[\s\S]*127\.0\.0\.1:5173/)
  assert.equal((await fetch(url + '/history-print/not-an-id/with.png')).status, 404)
  socket.send(JSON.stringify({ type: 'stop' }))
  await waitFor(() => state()?.lanes.with.status === 'stopped' && state().lanes.without.status === 'stopped')
  const before = events.filter(e => e.type === 'data').length
  socket.send(JSON.stringify({ type: 'send', text: 'não enviar com terminal encerrado' }))
  await waitFor(() => events.some(e => e.type === 'notice'))
  assert.equal(events.filter(e => e.type === 'data').length, before)
})

test('agrupa uso pela requisição nativa e guarda só a resposta visível', () => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 12, cache_creation_input_tokens: 3, output_tokens: 2 }
  const text = [
    { type: 'user', permissionMode: 'auto', message: { content: 'Tarefa de teste' } },
    { type: 'assistant', requestId: 'one', message: { usage, content: [{ type: 'tool_use', name: 'Bash', id: 'call-one' }] } },
    { type: 'assistant', requestId: 'one', message: { usage, content: [{ type: 'thinking', thinking: 'não persistir' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'saída interna' }] } },
    { type: 'assistant', requestId: 'two', message: { model: 'demo', usage, content: [{ type: 'text', text: 'Resposta visível' }] } },
    { type: 'system', subtype: 'turn_duration', durationMs: 820 },
  ].map(row => JSON.stringify(row)).join('\n')
  const [turn] = readClaudeTurns(text)
  const summary = turnSummary(turn)
  assert.equal(summary.requests, 2)
  assert.equal(summary.input, 50)
  assert.equal(summary.output, 4)
  assert.equal(summary.tools, 1)
  assert.equal(summary.toolErrors, 1)
  assert.equal(summary.permissionMode, 'auto')
  assert.equal(summary.durationMs, 820)
  assert.equal(summary.answer, 'Resposta visível')
})
