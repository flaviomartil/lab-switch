import type { EngineInterface, On } from 'claude-code'
import { DEFAULT_LIMITS, limitFileContent, limitList, truncate } from './lib/limits'
import { operationsSection } from './lib/prompt'
import { applyGuard, parseExtraPatterns } from './lib/guard'
import { MAX_STATE_CHARS, MAX_STATE_ENTRIES, pruneState, STATE_TTL_MS, type CacheEntry } from './lib/state'
import { logPath } from './lib/audit'
import { resolveToggle } from './lib/env'
import {
  countToolCall, finalizeTurnTelemetry, newSessionTelemetry, newTurnTelemetry,
  observeStep, observeThinkingBlock, snapshotContext, telemetryExport,
} from './lib/telemetry'
import { buildTelemetryReport, buildThinkingDigest, buildTurnSummaryLine } from './lib/report'
import { entryFromSession, readRegistry, saveEntry } from './lib/registry'

interface CodeflowOptions {
  maxFileLines?: number
  maxToolResultChars?: number
  maxListItems?: number
  guardPatterns?: string
  turnSummary?: boolean
  thinking?: boolean
  sessionLog?: boolean
}

function positiveLimit(value: number | undefined, fallback: number, minimum = 1): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : fallback
}

async function currentContext($: EngineInterface, session: ReturnType<typeof newSessionTelemetry>) {
  return snapshotContext(await $.session.usage().catch(() => null), session)
}

export function register(on: On, options: CodeflowOptions = {}) {
  const limits = {
    maxFileLines: positiveLimit(options.maxFileLines, DEFAULT_LIMITS.maxFileLines),
    maxToolResultChars: positiveLimit(options.maxToolResultChars, DEFAULT_LIMITS.maxToolResultChars, 64),
    maxListItems: positiveLimit(options.maxListItems, DEFAULT_LIMITS.maxListItems),
  }
  const extraPatterns = parseExtraPatterns(options.guardPatterns)
  const showSummary = options.turnSummary !== false
  const countThinking = options.thinking === true
  const sessionLog = options.sessionLog === true
  let toggle = resolveToggle(undefined)
  let runId: string | null = null
  let cwd = ''
  let telemetry = newSessionTelemetry()
  const stash = new Map<string, CacheEntry>()
  const outputKinds = new Map<string, 'Read' | 'Grep' | 'Glob'>()

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    toggle = resolveToggle(await $.env.get('CLAUDE_CODEFLOW_ENABLED').catch(() => undefined))
    const run = await $.env.get('CLAUDE_CODEFLOW_RUN').catch(() => undefined)
    runId = run && /^[A-Za-z0-9_-]{1,48}$/.test(run) ? run : null
    await $.command.register({ name: 'codeflow', description: 'Codeflow telemetry, active mode and local state' })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!toggle.enabled || result.sections.some(section => section.id === 'codeflow:operations')) return result
    return {
      sections: [
        ...result.sections,
        { id: 'codeflow:operations', text: operationsSection(limits), scope: 'session' },
      ],
    }
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      outputKinds.clear()
      telemetry.current = newTurnTelemetry(result.turnId, null)
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const turn = telemetry.current
    const mainTurn = e.agentId === undefined && turn?.turnId === e.turnId ? turn : null
    if (mainTurn) {
      mainTurn.modelRequests += 1
      observeStep(mainTurn, e)
    }
    const result = yield* next(e)
    if (mainTurn && (result.toolUses?.length ?? 0) > 1) mainTurn.multiToolRequests += 1
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || telemetry.current?.turnId !== e.turnId) return result
    const turn = finalizeTurnTelemetry(telemetry, e, null)
    const context = await currentContext($, telemetry)
    outputKinds.clear()
    if (!showSummary || !turn) return result
    const summary = buildTurnSummaryLine(turn, context)
    const text = result.text && result.text !== e.answer ? [result.text, summary].join('\n') : summary
    return { ...result, text }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) countToolCall(telemetry, e.tool)
    const turn = telemetry.current
    const result = await next(e)
    if (!toggle.enabled || e.agentId !== undefined || !turn || turn !== telemetry.current) return result
    if (!e.tool_use_id || result.isError || result.deny !== undefined) return result
    if (e.tool === 'Read' || e.tool === 'Grep' || e.tool === 'Glob') outputKinds.set(e.tool_use_id, e.tool)
    return result
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'tool-result' }, ($, e, next) => {
    if (!toggle.enabled || e.agentId !== undefined || outputKinds.size === 0) return next(e)
    let changed = false
    const content = e.message.content.map(block => {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || block.is_error) return block
      const tool = outputKinds.get(block.tool_use_id)
      outputKinds.delete(block.tool_use_id)
      if (!tool) return block
      const parts = Array.isArray(block.content) ? block.content : null
      const part = parts?.length === 1 ? parts[0] as { type?: unknown; text?: unknown } | null : null
      const original = typeof block.content === 'string'
        ? block.content
        : part?.type === 'text' && typeof part.text === 'string' ? part.text : null
      if (original === null) return block
      const reduced = tool === 'Read'
        ? limitFileContent(original, limits.maxFileLines)
        : limitList(original, limits.maxListItems)
      const limited = truncate(reduced, limits.maxToolResultChars)
      if (limited.length >= original.length) return block
      changed = true
      telemetry.trimmedChars += original.length - limited.length
      return { ...block, content: part ? [{ ...part, text: limited }] : limited }
    })
    return changed ? next({ ...e, message: { ...e.message, content } }) : next(e)
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'response' }, ($, e, next) => {
    if (countThinking && e.agentId === undefined && e.message.role === 'assistant' && telemetry.current) {
      for (const block of e.message.content) {
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          observeThinkingBlock(telemetry, block.thinking)
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const native = await next(e)
    if (!toggle.enabled) return native
    const result = applyGuard(native, e.input, extraPatterns)
    if (result !== native) telemetry.guardedAsks += 1
    return result
  }).catch(($, e, next) => next(e))

  on('tool.check', { tool: 'REPL' }, async ($, e, next) => {
    const native = await next(e)
    if (!toggle.enabled) return native
    const result = applyGuard(native, e.input, extraPatterns)
    if (result !== native) telemetry.guardedAsks += 1
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const finished = telemetry
    telemetry = newSessionTelemetry()
    stash.clear()
    outputKinds.clear()
    if (finished.turns.length > 0) {
      if (runId) {
        const now = await $.clock.now()
        await saveEntry($, runId, entryFromSession(finished, e.sessionId, toggle.enabled, now), now).catch(() => undefined)
      }
      const path = sessionLog && cwd ? logPath(cwd, e.sessionId) : null
      if (path) {
        const context = await currentContext($, finished)
        await $.fs.write(path, JSON.stringify(telemetryExport(finished, context)) + '\n').catch(() => undefined)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'codeflow' }, async ($, e) => {
    const [sub = '', name = ''] = e.args.trim().split(/\s+/)
    if (sub === 'report') {
      const registry = runId ? await readRegistry($, runId, await $.clock.now()) : []
      return { text: buildTelemetryReport(toggle, runId, registry, telemetry, await currentContext($, telemetry)) }
    }
    if (sub === 'thinking') {
      const last = telemetry.turns.at(-1) ?? telemetry.current
      return {
        text: countThinking && last
          ? buildThinkingDigest(last)
          : 'Count unavailable. Enable thinking and complete a turn.',
      }
    }
    if (sub === 'stash' || sub === 'recall' || sub === 'forget') {
      if (!toggle.enabled) return { text: 'The stash is available with CLAUDE_CODEFLOW_ENABLED=1.' }
      if (e.origin.kind !== 'composer') return { text: 'Use this command directly in the terminal.' }
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) return { text: 'Provide a name with up to 40 letters, numbers, hyphens or underscores.' }
      const now = await $.clock.now()
      pruneState(stash, now)
      if (sub === 'forget') {
        stash.delete(name)
        return { text: 'Entry removed.' }
      }
      if (sub === 'recall') return { text: stash.get(name)?.value ?? 'Entry missing or expired.' }
      const value = e.args.trim().slice(sub.length).trimStart().slice(name.length).trim()
      if (!value || value.length > MAX_STATE_CHARS) return { text: 'Use /codeflow stash <name> <text> with up to 2,000 characters.' }
      if (!stash.has(name) && stash.size >= MAX_STATE_ENTRIES) return { text: 'The stash is full. Use /codeflow forget <name>.' }
      stash.set(name, { value, expiresAtMs: now + STATE_TTL_MS })
      telemetry.stashes += 1
      return { text: 'Text kept in this session memory for 30 minutes.' }
    }
    return {
      text: [
        'Codeflow 1.1.1',
        toggle.enabled ? 'Active mode' : 'Passive mode',
        toggle.invalid ? 'Invalid CLAUDE_CODEFLOW_ENABLED. Use 0 or 1.' : '',
        'Use /codeflow report to see session usage.',
        'Use Ctrl+O to inspect the native executor Code blocks.',
      ].filter(Boolean).join('\n'),
    }
  })
}
