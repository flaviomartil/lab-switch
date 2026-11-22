import {
  accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync,
  readFileSync, realpathSync, writeFileSync,
} from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { isIP } from 'node:net'
import { claudeAuthEnvironment } from './auth.mjs'

const ignored = new Set([
  '.claude', '.claude.json', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md',
  'AGENTS.md', 'node_modules', '.codeflow', '.nightshift', '.ssh', '.netrc', '.npmrc',
])

function copyProject(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      const stat = lstatSync(path)
      const name = basename(path)
      return (stat.isFile() || stat.isDirectory()) && !ignored.has(name) &&
        !name.startsWith('.env') && !/\.(?:pem|key|p12)$/i.test(name)
    },
  })
}

export function hostGitEnvironment(env = process.env, home = homedir()) {
  const inherited = {}
  const config = [env.GIT_CONFIG_GLOBAL, join(home, '.gitconfig'), join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'git', 'config')]
    .find(path => path && existsSync(path))
  if (config) inherited.GIT_CONFIG_GLOBAL = config
  const gh = env.GH_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'gh')
  if (existsSync(gh)) inherited.GH_CONFIG_DIR = gh
  for (const name of ['SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'GIT_SSH_COMMAND']) {
    if (env[name]) inherited[name] = env[name]
  }
  return inherited
}

function executable(requested) {
  const candidates = requested
    ? [resolve(requested)]
    : [join(homedir(), '.local/bin/claude'), ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, 'claude'))]
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK)
      if (lstatSync(realpathSync(path)).isFile()) return realpathSync(path)
    } catch {}
  }
  throw new Error('Claude Code not found. Provide --claude-bin with the path to the executable.')
}

function objectFrom(file, label) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(label + ' must be a JSON object.')
  return data
}

function skillPlugin(item, staging) {
  const folder = join(staging, 'skill-plugin')
  mkdirSync(join(folder, '.claude-plugin'), { recursive: true })
  writeFileSync(join(folder, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'lab-item' }))
  const name = basename(lstatSync(item).isDirectory() ? item : dirname(item))
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'skill'
  const skill = join(folder, 'skills', name)
  mkdirSync(skill, { recursive: true })
  if (lstatSync(item).isDirectory()) copyProject(item, skill)
  else cpSync(item, join(skill, 'SKILL.md'))
  if (!existsSync(join(skill, 'SKILL.md'))) throw new Error('The skill needs a SKILL.md file.')
  return folder
}

function seedProfile(configDir, workingDir) {
  const file = join(configDir, '.claude.json')
  let state = {}
  try { state = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  const projects = { ...state.projects }
  for (const path of new Set([workingDir, realpathSync(workingDir)])) {
    projects[path] = { ...projects[path], hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
  }
  writeFileSync(file, JSON.stringify({
    ...state, theme: state.theme ?? 'dark', hasCompletedOnboarding: true,
    bypassPermissionsModeAccepted: true, projects,
  }), { mode: 0o600 })
}

export function configuration(args, root, staging) {
  const { values } = parseArgs({
    args, allowPositionals: true, options: {
      kind: { type: 'string', default: 'mod' }, item: { type: 'string' },
      project: { type: 'string' }, port: { type: 'string', default: '4178' },
      model: { type: 'string' }, 'claude-bin': { type: 'string' },
      'code-mode': { type: 'boolean', default: false }, demo: { type: 'boolean', default: false },
      'active-codeflow': { type: 'boolean', default: false }, 'history-dir': { type: 'string' },
      listen: { type: 'string', default: '127.0.0.1' },
    },
  })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65533) throw new Error('Invalid port.')
  if (!isIP(values.listen)) throw new Error('Use an IP address of an interface on this machine in --listen.')
  const kind = values.kind
  if (!['mod', 'skill', 'hook', 'mcp', 'agent'].includes(kind)) throw new Error('Use --kind mod, skill, hook, mcp or agent.')
  if (!values.item && kind !== 'mod') throw new Error('Provide --item for this extension type.')
  const item = resolve(values.item ?? join(root, 'vendor/codeflow'))
  const baseline = join(staging, 'base')
  const project = resolve(values.project ?? join(root, 'sample'))
  if (!lstatSync(project).isDirectory()) throw new Error('--project must point to a folder.')
  copyProject(project, baseline)
  const plug = []
  if (kind === 'mod') {
    if (!existsSync(item)) throw new Error('The selected mod was not found.')
    plug.push('--plugin-dir', item)
  }
  if (kind === 'skill') plug.push('--plugin-dir', skillPlugin(item, staging))
  if (kind === 'agent') plug.push('--agents', JSON.stringify(objectFrom(item, 'The Agent')))
  const commonSettings = { autoMemoryEnabled: false, skipDangerousModePermissionPrompt: true }
  const treatmentSettings = { ...commonSettings }
  if (kind === 'hook') {
    const { hooks } = objectFrom(item, 'The Hook configuration')
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('Provide JSON with a hooks object.')
    treatmentSettings.hooks = hooks
  }
  const emptyMcp = JSON.stringify({ mcpServers: {} })
  const treatmentMcp = kind === 'mcp'
    ? JSON.stringify({ mcpServers: objectFrom(item, 'The MCP configuration').mcpServers ?? {} })
    : emptyMcp
  const codeflow = kind === 'mod' && (!values.item || basename(item).toLowerCase().startsWith('codeflow'))
  const itemName = codeflow ? 'Codeflow' : basename(item).replace(/\.json$|\.zip$/g, '')
  const command = values.demo ? process.execPath : executable(values['claude-bin'])
  let authentication = {}
  const profiles = {}
  for (const lane of ['with', 'without']) {
    const home = join(staging, 'profiles', lane)
    mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 })
    profiles[lane] = home
  }
  return {
    port, listen: values.listen, kind, itemName, codeflow, profiles, baseline, command,
    projectName: values.project ? basename(project) : 'Sample project',
    model: values.model ?? null,
    demo: values.demo,
    telemetryOnly: codeflow && !values['active-codeflow'],
    historyDir: values['history-dir'] ? resolve(values['history-dir']) : null,
    preparePair() {
      authentication = values.demo ? {} : claudeAuthEnvironment()
    },
    createLane(lane, workingDir, sessionId) {
      copyProject(baseline, workingDir)
      const withItem = lane === 'with'
      const home = profiles[lane]
      if (!values.demo) seedProfile(join(home, '.claude'), workingDir)
      const env = {
        HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
        PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8',
        TERM: 'xterm-256color', COLORTERM: 'truecolor',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      }
      Object.assign(env, hostGitEnvironment(), authentication)
      if (values['code-mode']) env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE = '1'
      if (codeflow && withItem) env.CLAUDE_CODEFLOW_ENABLED = values['active-codeflow'] ? '1' : '0'
      const argumentsForLane = values.demo
        ? [join(root, 'test/pty-fixture.mjs'), lane, sessionId]
        : [
            '--setting-sources', 'user',
            '--settings', JSON.stringify(withItem ? treatmentSettings : commonSettings),
            '--strict-mcp-config', '--mcp-config', withItem ? treatmentMcp : emptyMcp,
            '--no-chrome', '--dangerously-skip-permissions',
            ...(sessionId ? ['--session-id', sessionId] : []),
            ...(values.model ? ['--model', values.model] : []),
            ...(withItem ? plug : []),
          ]
      return { env, args: argumentsForLane }
    },
  }
}
