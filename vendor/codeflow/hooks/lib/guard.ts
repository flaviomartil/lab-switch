/**
 * Guard for sensitive commands.
 *
 * Fixed failure: in permissive mode, nothing asked for approval and an `rm` or
 * `git push` could run hidden inside a compound command
 * (`cd app && git push` reaches the hook whole). Here every shell call
 * is scanned for dangerous patterns, anywhere in the command and not only
 * at the start, and the decision becomes `ask`, preserving the operator's answer.
 */

export interface GuardDecision {
  matched: string[]
  ask: boolean
}

/** Built-in patterns. `guardPatterns` from userConfig is added to this list. */
export const BUILTIN_PATTERNS = [
  'rm -rf',
  'rm -r ',
  'git push',
  'git reset --hard',
  'git clean -',
  'git rebase',
  'git commit --amend',
  ':(){ :|:& };:', // fork bomb
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'chmod -r 777',
  '> /dev/',
  'curl -o- | sh',
  'curl -s | sh',
  'wget -q -o- | sh',
  'npm publish',
  'docker system prune',
  'kubectl delete',
  // seen inside REPL scripts: arbitrary network output and processes
  'child_process',
  'process.exit',
  'fetch("http',
  "fetch('http",
]

export function parseExtraPatterns(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0)
}

/**
 * Extracts the text to scan from a tool call and applies the sensitive
 * patterns. Tolerant of missing fields and varied types, since the arguments
 * arrive as frozen data of variable shape.
 *
 * Besides Bash, it covers the native Code Mode `REPL` tool: when
 * Claude Code has Code Mode on, JS scripts arrive in `e.code` and
 * the native classifier reviews the whole script once, without seeing
 * runtime values. Here the code TEXT is scanned with the same
 * patterns (git push, rm -rf, etc. inside the script).
 */
export function guardToolCall(input: unknown, extraPatterns: string[]): GuardDecision {
  const e = (input ?? {}) as Record<string, unknown>
  let commandText = ''
  if (typeof e.command === 'string') commandText = e.command
  else if (typeof e.cmd === 'string') commandText = e.cmd
  else if (typeof e.script === 'string') commandText = e.script
  else if (typeof e.code === 'string') commandText = e.code
  else if (Array.isArray(e.argv)) commandText = (e.argv as unknown[]).filter(a => typeof a === 'string').join(' ')

  if (commandText.trim() === '') return { matched: [], ask: false }

  const haystack = commandText.toLowerCase()
  const all = [...BUILTIN_PATTERNS, ...extraPatterns.map(p => p.toLowerCase())]
  const matched = all.filter(pattern => haystack.includes(pattern))
  return { matched, ask: matched.length > 0 }
}

export function applyGuard<T extends { decision: 'allow' | 'ask' | 'deny'; reason?: string }>(
  current: T,
  input: unknown,
  extraPatterns: string[],
): T {
  if (current.decision !== 'allow' || !guardToolCall(input, extraPatterns).ask) return current
  return { ...current, decision: 'ask', reason: 'Codeflow flagged a sensitive operation.' }
}
