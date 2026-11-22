export interface Limits {
  maxFileLines: number
  maxToolResultChars: number
  maxListItems: number
}

export const DEFAULT_LIMITS: Limits = {
  maxFileLines: 200,
  maxToolResultChars: 2000,
  maxListItems: 20,
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = '\n… [Codeflow: output truncated]'
  return text.slice(0, Math.max(0, maxChars - marker.length)) + marker
}

export function limitFileContent(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(0, maxLines).join('\n') +
    '\n… [Codeflow: ' + maxLines + ' of ' + lines.length + ' lines. Use offset to read the rest.]'
}

export function limitList(text: string, maxItems: number): string {
  const items = text.split('\n').filter(line => line.trim() !== '')
  if (items.length <= maxItems) return text
  return items.slice(0, maxItems).join('\n') +
    '\n… [Codeflow: ' + maxItems + ' of ' + items.length + ' result lines.]'
}
