import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

export function currentOAuthToken(document, now = Date.now()) {
  let credentials
  try { credentials = JSON.parse(document)?.claudeAiOauth } catch { return null }
  const token = credentials?.accessToken
  const expires = credentials?.expiresAt
  if (typeof token !== 'string' || !token || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) return null
  return typeof expires === 'number' && expires > now + 30_000 ? token : null
}

function fromFile(path) {
  try {
    const file = statSync(path)
    if (!file.isFile() || (file.mode & 0o077) !== 0 || file.size > 131_072) return null
    return currentOAuthToken(readFileSync(path, 'utf8'))
  } catch { return null }
}

function fromMacKeychain() {
  const result = spawnSync(
    '/usr/bin/security',
    ['find-generic-password', '-s', 'Claude Code-credentials', '-a', userInfo().username, '-w'],
    { encoding: 'utf8', timeout: 1500, maxBuffer: 131_072, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return result.status === 0 ? currentOAuthToken(result.stdout) : null
}

export function claudeAuthEnvironment(env = process.env) {
  const auth = {}
  for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    if (env[name]) auth[name] = env[name]
  }
  if (Object.keys(auth).length) return auth
  const directory = env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const token = fromFile(join(directory, '.credentials.json')) ??
    (process.platform === 'darwin' && !env.CLAUDE_CONFIG_DIR ? fromMacKeychain() : null)
  return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}
}
