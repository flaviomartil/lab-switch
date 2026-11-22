import { readFileSync } from 'node:fs'

const withItem = process.argv[2] === 'with'
const rows = readFileSync('rotina.tsv', 'utf8').trim().split('\n').slice(1)
const finished = rows.filter(row => row.endsWith('\tfeito'))
const last = finished.at(-1)?.split('\t')[0]
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdout.write('\x1b[?2004h\x1b[1m' +
  (withItem ? 'Terminal experimental' : 'Terminal de controle') +
  '\x1b[0m\r\nDemonstração de PTY\r\n\r\n❯ ')
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
    process.stdout.write('Entrada recebida nesta sessão.\r\n')
    if (input.includes('rotina.tsv')) {
      process.stdout.write(finished.length + ' tarefas concluídas. Última: ' + last + '.\r\n')
    }
    input = ''
    clearTimeout(readyTimer)
    readyTimer = setTimeout(() => process.stdout.write('\r\n❯ '), 30)
  }
})
