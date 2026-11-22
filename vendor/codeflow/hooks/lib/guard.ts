/**
 * Guarda de comandos sensíveis.
 *
 * Falha corrigida: em modo permissivo, nada pedia aprovação e um `rm` ou
 * `git push` podia rodar escondido em meio a um comando composto
 * (`cd app && git push` chega inteiro ao hook). Aqui cada chamada de shell
 * é varrida por padrões perigosos — em qualquer parte do comando, não só
 * no início — e a decisão vira `ask`, preservando a resposta do operador.
 */

export interface GuardDecision {
  matched: string[]
  ask: boolean
}

/** Padrões internos. `guardPatterns` do userConfig soma a esta lista. */
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
  // vistos dentro de scripts REPL: saída de rede arbitrária e processos
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
 * Extrai o texto a varrer de uma chamada de ferramenta e aplica os padrões
 * sensíveis. Tolerante a campos ausentes e a tipos variados — os argumentos
 * chegam como dados congelados de forma variável.
 *
 * Além de Bash, cobre a ferramenta `REPL` do Code Mode nativo: quando o
 * Claude Code está com Code Mode ligado, os scripts JS chegam em `e.code` e
 * o classificador nativo revisa o script inteiro uma vez, sem enxergar
 * valores de runtime — aqui o TEXTO do código é varrido pelos mesmos
 * padrões (git push, rm -rf etc. dentro do script).
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
  return { ...current, decision: 'ask', reason: 'Codeflow sinalizou uma operação sensível.' }
}
