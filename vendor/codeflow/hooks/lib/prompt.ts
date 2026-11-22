import type { Limits } from './limits'

export function operationsSection(limits: Limits): string {
  return [
    'Codeflow is active. In tasks with many calls, use targeted searches,',
    'process data locally and return the counts and evidence you need.',
    'Group independent steps when the executor allows it. If native Code',
    'Mode is available, reuse state from one block in another.',
    'For batch edits, check the real diff and run the tests.',
    'Permissions and project instructions still apply.',
    'Read and search results that the mod recognizes may be reduced',
    `to ${limits.maxFileLines} lines, ${limits.maxListItems} entries or ${limits.maxToolResultChars} characters.`,
    'When the output indicates truncation, read a section with offset or refine the search.',
  ].join('\n')
}
