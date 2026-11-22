import {
  avg, median, sumUsage, totalInput,
  type ContextSnapshot, type SessionTelemetry, type TurnTelemetry,
} from './telemetry'
import type { RegistryEntry } from './registry'
import type { Toggle } from './env'

const UNAVAILABLE = 'Indisponível'

function format(value: number | null, maximumFractionDigits = 0): string {
  return value === null || !Number.isFinite(value)
    ? UNAVAILABLE
    : value.toLocaleString('pt-BR', { maximumFractionDigits })
}

function seconds(ms: number | null): string {
  return ms === null ? UNAVAILABLE : format(ms / 1000, 3) + ' s'
}

function tokenLine(turns: TurnTelemetry[]): string {
  const usage = sumUsage(turns)
  if (!usage) return 'tokens: ' + UNAVAILABLE
  return [
    'entrada total ' + format(totalInput(usage)),
    'entrada nova ' + format(usage.input),
    'cache lido ' + format(usage.cacheRead),
    'cache criado ' + format(usage.cacheCreation),
    'saída ' + format(usage.output),
  ].join(' · ')
}

export function buildTurnSummaryLine(turn: TurnTelemetry, context: ContextSnapshot | null): string {
  const parts = [
    'Codeflow · ' + seconds(turn.durationMs),
    turn.modelRequests + ' requisição(ões) · ' + turn.toolCalls + ' chamada(s)',
    tokenLine([turn]),
  ]
  if (turn.multiToolRequests) parts.push(turn.multiToolRequests + ' requisição(ões) com múltiplas ferramentas')
  if (turn.thinking.blocks) parts.push(turn.thinking.blocks + ' bloco(s) de raciocínio')
  if (context?.percent != null) parts.push('contexto ' + format(context.percent) + '%')
  if (turn.outcome !== 'completo') parts.push(turn.outcome)
  return parts.join(' · ')
}

function summarize(label: string, turns: TurnTelemetry[]): string[] {
  const completed = turns.filter(turn => turn.outcome === 'completo')
  const durations = completed.flatMap(turn => turn.durationMs === null ? [] : [turn.durationMs])
  const range = durations.length ? seconds(Math.min(...durations)) + ' a ' + seconds(Math.max(...durations)) : UNAVAILABLE
  return [
    label + ' · ' + completed.length + '/' + turns.length + ' turno(s) concluído(s)',
    tokenLine(completed),
    'tempo/turno: mediana ' + seconds(median(durations)) + ' · faixa ' + range,
    'por turno: ' + format(avg(completed.map(turn => turn.modelRequests)), 1) + ' requisição(ões) · ' +
      format(avg(completed.map(turn => turn.toolCalls)), 1) + ' chamada(s) · ' +
      format(avg(completed.map(turn => turn.multiToolRequests)), 1) + ' requisição(ões) com múltiplas ferramentas',
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
    'Codeflow · modo ' + (toggle.enabled ? 'ativo' : 'passivo'),
    ...summarize('Sessão atual', session.turns),
  ]
  if (toggle.invalid) lines.push('CLAUDE_CODEFLOW_ENABLED inválido. O modo passivo permanece ativo.')
  const models = [...new Set(session.turns.flatMap(turn => turn.models))]
  const efforts = [...new Set(session.turns.flatMap(turn => turn.efforts))]
  lines.push('modelos: ' + (models.join(', ') || UNAVAILABLE) + ' · esforço: ' + (efforts.join(', ') || UNAVAILABLE))
  if (context) {
    lines.push('contexto atual: ' + format(context.tokens) + '/' + format(context.window))
    lines.push('custo estimado da sessão (USD): ' + format(context.costUsd, 6))
  }
  lines.push('caracteres removidos de resultados: ' + format(session.trimmedChars))
  lines.push('chamadas sinalizadas: ' + session.guardedAsks + ' · entradas no stash: ' + session.stashes)
  if (run) {
    lines.push('', 'Experimento ' + run + ' · sessões encerradas nas últimas 24 h')
    for (const enabled of [true, false]) {
      const sample = registry.filter(entry => entry.enabled === enabled)
      const label = (enabled ? 'Ativo' : 'Passivo') + ' (' + sample.length + ' sessões)'
      lines.push(...summarize(label, sample.flatMap(entry => entry.turns)), '')
    }
  }
  return lines.join('\n')
}

export function buildThinkingDigest(turn: TurnTelemetry): string {
  return 'Contagem do turno: ' + turn.thinking.blocks + ' bloco(s), ' + turn.thinking.words + ' palavra(s).'
}
