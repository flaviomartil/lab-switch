import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

export function defaultHistoryPath() {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Lab Switch', 'history')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'lab-switch', 'history')
}

export function historyStore(directory) {
  async function read(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) return null
    try { return JSON.parse(await readFile(join(directory, id + '.json'), 'utf8')) } catch { return null }
  }
  return {
    read,
    printPath(id, lane) {
      if (typeof id !== 'string' || !idPattern.test(id) || !['with', 'without'].includes(lane)) return null
      return join(directory, id + '-' + lane + '.png')
    },
    async write(entry) {
      if (!idPattern.test(entry.id)) throw new Error('Identificador de comparação inválido.')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const target = join(directory, entry.id + '.json')
      const temp = target + '.' + randomUUID() + '.tmp'
      await writeFile(temp, JSON.stringify(entry), { mode: 0o600 })
      await rename(temp, target)
    },
    async list() {
      const files = await readdir(directory).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const entries = await Promise.all(files
        .filter(file => file.endsWith('.json'))
        .map(file => read(file.slice(0, -5))))
      return entries.filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100)
        .map(({ id, startedAt, prompt, status, source }) => ({ id, startedAt, prompt: prompt.slice(0, 130), status, source }))
    },
  }
}
