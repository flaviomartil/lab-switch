import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { claudeAuthEnvironment, currentOAuthToken } from '../lib/auth.mjs'

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

test('dois PTYs recebem a mesma entrada uma vez e voltam ao prompt', { timeout: 15_000 }, async t => {
  const child = spawn(process.execPath, ['lab-switch.mjs', '--demo', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
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
  const waitFor = async condition => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
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
  socket.send(JSON.stringify({ type: 'send', text: 'Primeira linha\nSegunda linha' }))
  await waitFor(() => events.some(e => e.type === 'sent'))
  await waitFor(() => output('with').includes('Entrada recebida') && output('without').includes('Entrada recebida'))
  for (const lane of ['with', 'without']) {
    assert.match(output(lane).replace(/\r/g, ''), /Primeira linha\nSegunda linha/)
    assert.equal(output(lane).split('Entrada recebida').length, 2)
  }
  await waitFor(ready)
  socket.send(JSON.stringify({ type: 'stop' }))
  await waitFor(() => state()?.lanes.with.status === 'stopped' && state().lanes.without.status === 'stopped')
  const before = events.filter(e => e.type === 'data').length
  socket.send(JSON.stringify({ type: 'send', text: 'não enviar com terminal encerrado' }))
  await waitFor(() => events.some(e => e.type === 'notice'))
  assert.equal(events.filter(e => e.type === 'data').length, before)
})
