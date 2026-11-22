export type TurnOutcome = 'completo' | 'interrompido' | 'recusado' | 'erro' | 'em andamento'

export interface TokenUsage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

export interface ThinkingSummary {
  /** Quantidade de blocos de raciocínio observados no turno. */
  blocks: number
  /** Palavras totais de raciocínio (aproximação barata). */
  words: number
}

export interface TurnTelemetry {
  turnId: string | null
  startedAtMs: number | null
  durationMs: number | null
  modelRequests: number
  multiToolRequests: number
  toolCalls: number
  toolsByName: Record<string, number>
  usage: TokenUsage | null
  models: string[]
  efforts: string[]
  outcome: TurnOutcome
  thinking: ThinkingSummary
}

export interface ContextSnapshot {
  tokens: number | null
  window: number | null
  percent: number | null
  costUsd: number | null
}

export interface SessionTelemetry {
  turns: TurnTelemetry[]
  current: TurnTelemetry | null
  peakContextPercent: number | null
  usageSeen: boolean
  trimmedChars: number
  guardedAsks: number
  stashes: number
  thinkingBlocks: number
  thinkingWords: number
}

export function newTurnTelemetry(turnId: string | null, startedAtMs: number | null): TurnTelemetry {
  return {
    turnId,
    startedAtMs,
    durationMs: null,
    modelRequests: 0,
    multiToolRequests: 0,
    toolCalls: 0,
    toolsByName: Object.create(null) as Record<string, number>,
    usage: null,
    models: [],
    efforts: [],
    outcome: 'em andamento',
    thinking: { blocks: 0, words: 0 },
  }
}

export function newSessionTelemetry(): SessionTelemetry {
  return {
    turns: [],
    current: null,
    peakContextPercent: null,
    usageSeen: false,
    trimmedChars: 0,
    guardedAsks: 0,
    stashes: 0,
    thinkingBlocks: 0,
    thinkingWords: 0,
  }
}

/** Registra um bloco de raciocínio (texto_thinking) no turno corrente. */
export function observeThinkingBlock(session: SessionTelemetry, text: string): void {
  const words = text.split(/\s+/).filter(w => w !== '').length
  session.thinkingBlocks += 1
  session.thinkingWords += words
  const turn = session.current
  if (!turn) return
  turn.thinking.blocks += 1
  turn.thinking.words += words
}

export function addRequestUsage(turn: TurnTelemetry, raw: unknown, session: SessionTelemetry): void {
  if (raw === null || typeof raw !== 'object') return
  const u = raw as Record<string, unknown>
  const pick = (keys: string[]): number | null => {
    for (const key of keys) {
      const value = u[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return null
  }
  const input = pick(['input_tokens', 'inputTokens'])
  const output = pick(['output_tokens', 'outputTokens'])
  const cacheRead = pick(['cache_read_input_tokens', 'cacheReadInputTokens'])
  const cacheCreation = pick(['cache_creation_input_tokens', 'cacheCreationInputTokens'])
  if (input === null && output === null && cacheRead === null && cacheCreation === null) return
  session.usageSeen = true
  turn.usage = { input, output, cacheRead, cacheCreation }
}

export function observeStep(turn: TurnTelemetry, raw: unknown): void {
  if (raw === null || typeof raw !== 'object') return
  const e = raw as Record<string, unknown>
  if (typeof e.model === 'string' && e.model !== '' && !turn.models.includes(e.model)) {
    turn.models.push(e.model)
  }
  if (typeof e.effort === 'string' && e.effort !== '' && !turn.efforts.includes(e.effort)) {
    turn.efforts.push(e.effort)
  }
}

export function snapshotContext(raw: unknown, session: SessionTelemetry): ContextSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const context = (u.context ?? {}) as Record<string, unknown>
  const cost = (u.cost ?? {}) as Record<string, unknown>
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const snapshot: ContextSnapshot = {
    tokens: num(context.tokens),
    window: num(context.window),
    percent: num(context.percent),
    costUsd: cost.hasUnknownPrice === true ? null : num(cost.usd),
  }
  if (snapshot.percent !== null) {
    session.peakContextPercent =
      session.peakContextPercent === null
        ? snapshot.percent
        : Math.max(session.peakContextPercent, snapshot.percent)
  }
  return snapshot
}

export function finalizeTurnTelemetry(
  session: SessionTelemetry,
  event: unknown,
  nowMs: number | null,
): TurnTelemetry | null {
  const turn = session.current
  if (!turn) return null
  const e = (event ?? {}) as Record<string, unknown>
  if (typeof e.durationMs === 'number' && Number.isFinite(e.durationMs)) {
    turn.durationMs = e.durationMs
  } else if (turn.startedAtMs !== null && nowMs !== null) {
    turn.durationMs = Math.max(0, nowMs - turn.startedAtMs)
  }
  addRequestUsage(turn, e.usage, session)
  if (e.isAborted === true || e.reason === 'aborted') turn.outcome = 'interrompido'
  else if (e.reason === 'refusal') turn.outcome = 'recusado'
  else if (e.reason === 'error') turn.outcome = 'erro'
  else turn.outcome = 'completo'
  session.turns.push(turn)
  session.current = null
  return turn
}

export function countToolCall(session: SessionTelemetry, tool: string): void {
  const turn = session.current
  if (!turn) return
  turn.toolCalls += 1
  turn.toolsByName[tool] = (turn.toolsByName[tool] ?? 0) + 1
}

export function totalInput(usage: TokenUsage): number | null {
  if (usage.input === null || usage.cacheRead === null || usage.cacheCreation === null) return null
  return usage.input + usage.cacheRead + usage.cacheCreation
}

export function sumUsage(turns: TurnTelemetry[]): TokenUsage | null {
  if (!turns.some(turn => turn.usage)) return null
  const sum = (field: keyof TokenUsage) => {
    let total = 0
    for (const turn of turns) {
      const amount = turn.usage?.[field]
      if (amount === undefined || amount === null) return null
      total += amount
    }
    return total
  }
  return { input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheCreation: sum('cacheCreation') }
}

export function totalDurationMs(turns: TurnTelemetry[]): number | null {
  let total = 0
  let seen = false
  for (const turn of turns) {
    if (turn.durationMs !== null) {
      total += turn.durationMs
      seen = true
    }
  }
  return seen ? total : null
}

export function avg(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

/** Mediana simples (sem ordenar o array do chamador). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper === undefined) return null
  const lower = sorted[mid - 1] ?? upper
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

export function telemetryExport(session: SessionTelemetry, contextNow: ContextSnapshot | null) {
  return {
    plugin: 'codeflow',
    turns: session.turns.length,
    durationMs: totalDurationMs(session.turns),
    modelRequests: session.turns.reduce((n, t) => n + t.modelRequests, 0),
    multiToolRequests: session.turns.reduce((n, t) => n + t.multiToolRequests, 0),
    toolCalls: session.turns.reduce((n, t) => n + t.toolCalls, 0),
    usage: sumUsage(session.turns),
    usageSeen: session.usageSeen,
    peakContextPercent: session.peakContextPercent,
    contextNow,
    trimmedChars: session.trimmedChars,
    guardedAsks: session.guardedAsks,
    stashes: session.stashes,
    thinking: { blocks: session.thinkingBlocks, words: session.thinkingWords },
  }
}
