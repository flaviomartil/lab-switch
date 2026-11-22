export const STATE_TTL_MS = 30 * 60 * 1000
export const MAX_STATE_ENTRIES = 20
export const MAX_STATE_CHARS = 2000

export interface CacheEntry {
  expiresAtMs: number
  value: string
}

export function pruneState(entries: Map<string, CacheEntry>, nowMs: number): void {
  for (const [name, entry] of entries) {
    if (entry.expiresAtMs <= nowMs) entries.delete(name)
  }
}
