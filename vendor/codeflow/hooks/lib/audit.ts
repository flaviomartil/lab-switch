export function logPath(cwd: string, sessionId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) return null
  return `${cwd}/.codeflow/session-${sessionId}.ndjson`
}
