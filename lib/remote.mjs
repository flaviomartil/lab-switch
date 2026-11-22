import { createServer, connect } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function loadToken(file, env = process.env) {
  if (env.LAB_TOKEN) return env.LAB_TOKEN
  try {
    const saved = readFileSync(file, 'utf8').trim()
    if (/^[\w-]{32,}$/.test(saved)) return saved
  } catch {}
  const token = randomBytes(24).toString('base64url')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, token + '\n', { mode: 0o600 })
  return token
}

function same(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieToken(request) {
  return (request.headers.cookie ?? '').split(';').map(part => part.trim().split('='))
    .find(([name]) => name === 'lab_token')?.[1] ?? null
}

export function access({ listen, token }) {
  const remote = !loopback.has(listen)
  const trusted = new Set()
  const local = request => loopback.has(request.socket.remoteAddress)

  function allowedHost(request, port) {
    const host = request.headers.host
    if (host === '127.0.0.1:' + port || host === 'localhost:' + port) return local(request)
    return remote && host === listen + ':' + port
  }

  function authorized(request) {
    if (local(request) && (!remote || !request.headers.host?.startsWith(listen + ':'))) return true
    const value = cookieToken(request)
    const ok = Boolean(value && same(value, token))
    if (ok) trusted.add(request.socket.remoteAddress)
    return ok
  }

  function login(request, response) {
    const url = new URL(request.url, 'http://lab')
    const given = url.searchParams.get('token')
    if (request.method !== 'GET' || url.pathname !== '/' || !given || !same(given, token)) return false
    trusted.add(request.socket.remoteAddress)
    response.writeHead(302, {
      'Set-Cookie': 'lab_token=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000',
      Location: '/',
    }).end()
    return true
  }

  return { remote, trusted, allowedHost, authorized, login }
}

export function previewProxy({ listen, port, trusted, target }) {
  const server = createServer(client => {
    const destination = target()
    if (!trusted.has(client.remoteAddress) || !destination) {
      client.destroy()
      return
    }
    const upstream = connect(destination, '127.0.0.1')
    client.pipe(upstream).pipe(client)
    const close = () => { client.destroy(); upstream.destroy() }
    client.on('error', close)
    upstream.on('error', close)
  })
  server.on('error', error => console.error('Proxy do preview ' + port + ':', error.code ?? error.message))
  server.listen(port, listen)
  return server
}
