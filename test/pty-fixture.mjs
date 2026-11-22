import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const withItem = process.argv[2] === 'with'
const rows = readFileSync('routine.tsv', 'utf8').trim().split('\n').slice(1)
const finished = rows.filter(row => row.endsWith('\tdone'))
const last = finished.at(-1)?.split('\t')[0]
const journal = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'demo')
mkdirSync(journal, { recursive: true })
const transcript = join(journal, process.argv[3] + '.jsonl')
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdout.write('\x1b[?2004h\x1b[1m' +
  (withItem ? 'Experimental terminal' : 'Control terminal') +
  '\x1b[0m\r\nPTY demo\r\n\r\n❯ ')
let input = ''
let readyTimer
process.stdin.on('data', data => {
  if (data.includes('\x03')) process.exit(0)
  const text = data.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '')
  for (const character of text) {
    if (character !== '\r') {
      input += character
      continue
    }
    process.stdout.write(input.replaceAll('\n', '\r\n') + '\r\n\r\n')
    process.stdout.write('Input received in this session.\r\n')
    let answer = 'Input received in this session.'
    if (input.includes('server')) {
      process.stdout.write('  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m' + (withItem ? 5173 : 5174) + '\x1b[22m/\x1b[39m\r\n')
    }
    if (input.includes('routine.tsv')) {
      answer = finished.length + ' tasks done. Last: ' + last + '.'
      process.stdout.write(answer + '\r\n')
    }
    const records = [
      { type: 'user', timestamp: new Date().toISOString(), permissionMode: 'simulated', message: { content: input } },
      { type: 'assistant', requestId: randomUUID(), message: {
        model: 'demo-local',
        usage: { input_tokens: 21, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 3 },
        content: [{ type: 'text', text: answer }],
      } },
      { type: 'system', subtype: 'turn_duration', durationMs: 16 },
    ]
    appendFileSync(transcript, records.map(record => JSON.stringify(record)).join('\n') + '\n')
    input = ''
    clearTimeout(readyTimer)
    readyTimer = setTimeout(() => process.stdout.write('\r\n❯ '), 30)
  }
})
