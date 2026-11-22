import type { EngineInterface } from 'claude-code'
import type { SessionTelemetry } from './telemetry'

export interface RegistryEntry {
  sessionId: string
  savedAtMs: number
  enabled: boolean
  turns: SessionTelemetry['turns']
  peakContextPercent: number | null
}

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50

function runPrefix(run: string): string {
  return 'codeflow:v2:' + run + ':'
}

export async function readRegistry($: EngineInterface, run: string, now: number): Promise<RegistryEntry[]> {
  const prefix = runPrefix(run)
  const keys = await $.store.keys().catch(() => [])
  const entries: RegistryEntry[] = []
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const entry = await $.store.get(key).catch(() => null) as RegistryEntry | null
    if (!entry || !Array.isArray(entry.turns)) continue
    if (now - entry.savedAtMs > TTL_MS) {
      await $.store.delete(key).catch(() => undefined)
      continue
    }
    entries.push(entry)
  }
  return entries.sort((a, b) => b.savedAtMs - a.savedAtMs)
}

export async function saveEntry($: EngineInterface, run: string, entry: RegistryEntry, now: number): Promise<void> {
  const prefix = runPrefix(run)
  await $.store.set(prefix + entry.sessionId, entry)
  const entries = await readRegistry($, run, now)
  for (const old of entries.slice(MAX_ENTRIES)) {
    await $.store.delete(prefix + old.sessionId).catch(() => undefined)
  }
}

export function entryFromSession(
  session: SessionTelemetry,
  sessionId: string,
  enabled: boolean,
  savedAtMs: number,
): RegistryEntry {
  return { sessionId, savedAtMs, enabled, turns: session.turns, peakContextPercent: session.peakContextPercent }
}
