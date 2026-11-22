import {
  avg, median, sumUsage, totalInput,
  type ContextSnapshot, type SessionTelemetry, type TurnTelemetry,
} from './telemetry'
import type { RegistryEntry } from './registry'
import type { Toggle } from './env'

const UNAVAILABLE = 'Unavailable'

function format(value: number | null, maximumFractionDigits = 0): string {
  return value === null || !Number.isFinite(value)
    ? UNAVAILABLE
    : value.toLocaleString('en-US', { maximumFractionDigits })
}

function seconds(ms: number | null): string {
  return ms === null ? UNAVAILABLE : format(ms / 1000, 3) + ' s'
}

function tokenLine(turns: TurnTelemetry[]): string {
  const usage = sumUsage(turns)
  if (!usage) return 'tokens: ' + UNAVAILABLE
  return [
    'total input ' + format(totalInput(usage)),
    'new input ' + format(usage.input),
    'cache read ' + format(usage.cacheRead),
    'cache created ' + format(usage.cacheCreation),
    'output ' + format(usage.output),
  ].join(' · ')
}

export function buildTurnSummaryLine(turn: TurnTelemetry, context: ContextSnapshot | null): string {
  const parts = [
    'Codeflow · ' + seconds(turn.durationMs),
    turn.modelRequests + ' request(s) · ' + turn.toolCalls + ' call(s)',
    tokenLine([turn]),
  ]
  if (turn.multiToolRequests) parts.push(turn.multiToolRequests + ' request(s) with multiple tools')
  if (turn.thinking.blocks) parts.push(turn.thinking.blocks + ' reasoning block(s)')
  if (context?.percent != null) parts.push('context ' + format(context.percent) + '%')
  if (turn.outcome !== 'complete') parts.push(turn.outcome)
  return parts.join(' · ')
}

function summarize(label: string, turns: TurnTelemetry[]): string[] {
  const completed = turns.filter(turn => turn.outcome === 'complete')
  const durations = completed.flatMap(turn => turn.durationMs === null ? [] : [turn.durationMs])
  const range = durations.length ? seconds(Math.min(...durations)) + ' to ' + seconds(Math.max(...durations)) : UNAVAILABLE
  return [
    label + ' · ' + completed.length + '/' + turns.length + ' completed turn(s)',
    tokenLine(completed),
    'time/turn: median ' + seconds(median(durations)) + ' · range ' + range,
    'per turn: ' + format(avg(completed.map(turn => turn.modelRequests)), 1) + ' request(s) · ' +
      format(avg(completed.map(turn => turn.toolCalls)), 1) + ' call(s) · ' +
      format(avg(completed.map(turn => turn.multiToolRequests)), 1) + ' request(s) with multiple tools',
  ]
}

export function buildTelemetryReport(
  toggle: Toggle,
  run: string | null,
  registry: RegistryEntry[],
  session: SessionTelemetry,
  context: ContextSnapshot | null,
): string {
  const lines = [
    'Codeflow · ' + (toggle.enabled ? 'active' : 'passive') + ' mode',
    ...summarize('Current session', session.turns),
  ]
  if (toggle.invalid) lines.push('Invalid CLAUDE_CODEFLOW_ENABLED. Passive mode stays on.')
  const models = [...new Set(session.turns.flatMap(turn => turn.models))]
  const efforts = [...new Set(session.turns.flatMap(turn => turn.efforts))]
  lines.push('models: ' + (models.join(', ') || UNAVAILABLE) + ' · effort: ' + (efforts.join(', ') || UNAVAILABLE))
  if (context) {
    lines.push('current context: ' + format(context.tokens) + '/' + format(context.window))
    lines.push('estimated session cost (USD): ' + format(context.costUsd, 6))
  }
  lines.push('characters removed from results: ' + format(session.trimmedChars))
  lines.push('flagged calls: ' + session.guardedAsks + ' · stash entries: ' + session.stashes)
  if (run) {
    lines.push('', 'Experiment ' + run + ' · sessions ended in the last 24 h')
    for (const enabled of [true, false]) {
      const sample = registry.filter(entry => entry.enabled === enabled)
      const label = (enabled ? 'Active' : 'Passive') + ' (' + sample.length + ' session(s))'
      lines.push(...summarize(label, sample.flatMap(entry => entry.turns)), '')
    }
  }
  return lines.join('\n')
}

export function buildThinkingDigest(turn: TurnTelemetry): string {
  return 'Turn count: ' + turn.thinking.blocks + ' block(s), ' + turn.thinking.words + ' word(s).'
}
