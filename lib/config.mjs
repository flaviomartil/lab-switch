import {
  accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync,
  readFileSync, realpathSync, writeFileSync,
} from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { claudeAuthEnvironment } from './auth.mjs'

const ignored = new Set([
  '.git', '.claude', '.claude.json', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md',
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
  throw new Error('Claude Code não encontrado. Informe --claude-bin com o caminho do executável.')
}

function objectFrom(file, label) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(label + ' deve ser um objeto JSON.')
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
  if (!existsSync(join(skill, 'SKILL.md'))) throw new Error('A skill precisa de um arquivo SKILL.md.')
  return folder
}

export function configuration(args, root, staging) {
  const { values } = parseArgs({
    args, allowPositionals: true, options: {
      kind: { type: 'string', default: 'mod' }, item: { type: 'string' },
      project: { type: 'string' }, port: { type: 'string', default: '4178' },
      model: { type: 'string' }, 'claude-bin': { type: 'string' },
      'code-mode': { type: 'boolean', default: false }, demo: { type: 'boolean', default: false },
    },
  })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.')
  const kind = values.kind
  if (!['mod', 'skill', 'hook', 'mcp', 'agent'].includes(kind)) throw new Error('Use --kind mod, skill, hook, mcp ou agent.')
  if (!values.item && kind !== 'mod') throw new Error('Informe --item para este tipo de extensão.')
  const item = resolve(values.item ?? join(root, 'vendor/codeflow'))
  const baseline = join(staging, 'base')
  const project = resolve(values.project ?? join(root, 'sample'))
  if (!lstatSync(project).isDirectory()) throw new Error('--project deve apontar para uma pasta.')
  copyProject(project, baseline)
  const plug = []
  if (kind === 'mod') {
    if (!existsSync(item)) throw new Error('O mod selecionado não foi encontrado.')
    plug.push('--plugin-dir', item)
  }
  if (kind === 'skill') plug.push('--plugin-dir', skillPlugin(item, staging))
  if (kind === 'agent') plug.push('--agents', JSON.stringify(objectFrom(item, 'O Agent')))
  const commonSettings = { autoMemoryEnabled: false }
  const treatmentSettings = { ...commonSettings }
  if (kind === 'hook') {
    const { hooks } = objectFrom(item, 'A configuração do Hook')
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('Informe um JSON com um objeto hooks.')
    treatmentSettings.hooks = hooks
  }
  const emptyMcp = JSON.stringify({ mcpServers: {} })
  const treatmentMcp = kind === 'mcp'
    ? JSON.stringify({ mcpServers: objectFrom(item, 'A configuração MCP').mcpServers ?? {} })
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
    port, kind, itemName, codeflow, profiles, baseline, command,
    projectName: values.project ? basename(project) : 'Projeto de exemplo',
    model: values.model ?? null,
    demo: values.demo,
    preparePair() {
      authentication = values.demo ? {} : claudeAuthEnvironment()
    },
    createLane(lane, workingDir) {
      copyProject(baseline, workingDir)
      const withItem = lane === 'with'
      const home = profiles[lane]
      const env = {
        HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
        PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8',
        TERM: 'xterm-256color', COLORTERM: 'truecolor',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      }
      Object.assign(env, authentication)
      if (values['code-mode']) env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE = '1'
      if (codeflow && withItem) env.CLAUDE_CODEFLOW_ENABLED = '1'
      const argumentsForLane = values.demo
        ? [join(root, 'test/pty-fixture.mjs'), lane]
        : [
            '--setting-sources', 'user',
            '--settings', JSON.stringify(withItem ? treatmentSettings : commonSettings),
            '--strict-mcp-config', '--mcp-config', withItem ? treatmentMcp : emptyMcp,
            '--no-chrome', '--permission-mode', 'default',
            ...(values.model ? ['--model', values.model] : []),
            ...(withItem ? plug : []),
          ]
      return { env, args: argumentsForLane }
    },
  }
}
