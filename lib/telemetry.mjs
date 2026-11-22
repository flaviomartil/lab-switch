import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const usageFields = {
  fresh: 'input_tokens',
  cacheRead: 'cache_read_input_tokens',
  cacheWritten: 'cache_creation_input_tokens',
  output: 'output_tokens',
}

function promptText(record) {
  if (record.type !== 'user' || record.isMeta || record.isSidechain) return ''
  const content = record.message?.content
  if (typeof content === 'string') {
    const text = content.trim()
    return /^<(?:local-command-|command-name|system-reminder|user-prompt-submit-hook)/.test(text) ? '' : text
  }
  if (!Array.isArray(content) || content.some(block => block.type === 'tool_result')) return ''
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
}

function newTurn(record, prompt) {
  return {
    prompt, timestamp: record.timestamp, permissionMode: record.permissionMode ?? null,
    durationMs: null, complete: false, toolErrors: 0, model: null,
    requests: new Map(), tools: new Set(), answer: '', answerRequest: null, answerBlocks: new Map(),
  }
}

class TurnReader {
  turns = []
  current = null

  line(line) {
    if (!/"type"\s*:\s*"(?:user|assistant|system)"/.test(line)) return
    let record
    try { record = JSON.parse(line) } catch { return }
    if (record.isSidechain) return
    const prompt = promptText(record)
    if (prompt) {
      this.current = newTurn(record, prompt)
      this.turns.push(this.current)
      return
    }
    const turn = this.current
    if (!turn || turn.complete) return
    if (record.type === 'system' && record.subtype === 'turn_duration') {
      turn.durationMs = Number.isFinite(record.durationMs) ? record.durationMs : null
      turn.complete = true
      return
    }
    const message = record.message
    const blocks = message?.content
    if (!Array.isArray(blocks)) return
    if (record.type === 'user') {
      turn.toolErrors += blocks.filter(block => block.type === 'tool_result' && block.is_error).length
      return
    }
    if (record.type !== 'assistant') return
    const nativeUsage = message.usage
    const request = record.requestId ?? message.id ?? record.uuid
    if (request && nativeUsage && typeof nativeUsage === 'object') {
      const previous = turn.requests.get(request) ?? {}
      for (const [key, field] of Object.entries(usageFields)) {
        const value = nativeUsage[field]
        if (Number.isFinite(value)) previous[key] = Math.max(previous[key] ?? 0, value)
      }
      turn.requests.set(request, previous)
    }
    if (typeof message.model === 'string' && !message.model.startsWith('<')) turn.model = message.model
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.id) turn.tools.add(block.id)
    }
    const response = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    if (response) {
      if (turn.answerRequest !== request) {
        turn.answerRequest = request
        turn.answerBlocks.clear()
      }
      turn.answerBlocks.set(record.uuid ?? response, response)
      turn.answer = [...turn.answerBlocks.values()].join('\n\n')
    }
  }
}

export function readClaudeTurns(text) {
  const reader = new TurnReader()
  for (const line of text.split('\n')) reader.line(line)
  return reader.turns
}

export function turnSummary(turn) {
  if (!turn) return null
  const requests = [...turn.requests.values()]
  const counts = Object.fromEntries(Object.keys(usageFields).map(field => [
    field,
    requests.length && requests.every(request => Number.isFinite(request[field]))
      ? requests.reduce((sum, request) => sum + request[field], 0)
      : null,
  ]))
  const input = [counts.fresh, counts.cacheRead, counts.cacheWritten]
  return {
    timestamp: turn.timestamp,
    permissionMode: turn.permissionMode,
    durationMs: turn.durationMs,
    complete: turn.complete,
    model: turn.model,
    requests: requests.length || null,
    tools: requests.length ? turn.tools.size : null,
    toolErrors: turn.toolErrors,
    ...counts,
    input: input.every(Number.isFinite) ? input.reduce((sum, value) => sum + value, 0) : null,
    answer: turn.answer,
  }
}

export class ClaudeJournal {
  reader = new TurnReader()
  offset = 0
  remainder = ''
  decoder = new StringDecoder('utf8')
  path = null

  constructor(profile, session) {
    this.projects = join(profile, '.claude', 'projects')
    this.session = session
  }

  async poll() {
    if (!this.path) {
      const projects = await readdir(this.projects, { withFileTypes: true }).catch(() => [])
      for (const project of projects) {
        if (!project.isDirectory()) continue
        const dir = join(this.projects, project.name)
        const files = await readdir(dir).catch(() => [])
        if (files.includes(this.session + '.jsonl')) {
          this.path = join(dir, this.session + '.jsonl')
          break
        }
      }
    }
    if (!this.path) return
    const file = await open(this.path, 'r').catch(() => null)
    if (!file) return
    try {
      const info = await file.stat()
      const length = Math.min(1_048_576, Math.max(0, info.size - this.offset))
      if (!length) return
      const chunk = Buffer.alloc(length)
      const read = await file.read(chunk, 0, length, this.offset)
      this.offset += read.bytesRead
      const lines = (this.remainder + this.decoder.write(chunk.subarray(0, read.bytesRead))).split('\n')
      this.remainder = lines.pop()
      for (const line of lines) this.reader.line(line)
    } finally {
      await file.close()
    }
  }

  find(prompt, after) {
    const normalize = value => value.replace(/\r\n/g, '\n').trim()
    return this.reader.turns.find(turn =>
      Date.parse(turn.timestamp) >= after - 150 && normalize(turn.prompt) === normalize(prompt))
  }
}
