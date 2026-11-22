const ids = ['with', 'without']
const element = id => document.getElementById(id)
const prompt = element('prompt')
const hint = element('hint')
const sendButton = element('send')
const restartButton = element('restart')
const stopButton = element('stop')
const connection = element('connection')
const sample = 'No arquivo rotina.tsv, conte as tarefas marcadas como feito e diga o identificador da última concluída.'

const labels = {
  starting: 'Iniciando', setup: 'Configuração', approval: 'Aguardando confirmação',
  ready: 'Pronto', draft: 'Rascunho', running: 'Em execução', stopping: 'Encerrando', stopped: 'Encerrado', error: 'Erro',
}
const sessions = new Map()
let socket
let run = 0
let pending = false
let state = { lanes: {} }
let notice = ''

function connected() {
  return socket?.readyState === WebSocket.OPEN
}

function post(data) {
  if (connected()) socket.send(JSON.stringify(data))
}

for (const lane of ids) {
  const host = element(lane + '-terminal')
  const terminal = new Terminal({
    fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
    fontSize: 12, lineHeight: 1.23, cursorBlink: false, scrollback: 1500,
    theme: {
      background: '#24211e', foreground: '#f6efe2', cursor: '#f1c466',
      selectionBackground: '#635748', black: '#24211e', brightBlack: '#867e72',
      red: '#ef9b83', green: '#aeddab', yellow: '#f1c466', blue: '#99b8e1',
      magenta: '#e3aed9', cyan: '#a5d8d6', white: '#f6efe2',
    },
  })
  const fit = new FitAddon.FitAddon()
  terminal.loadAddon(fit)
  terminal.open(host)
  terminal.textarea?.setAttribute('aria-label', host.getAttribute('aria-label'))
  terminal.onData(data => post({ type: 'input', lane, data }))
  sessions.set(lane, { terminal, fit })
}

let resizeTimer
function scheduleFit() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const sizes = [...sessions.values()].map(({ fit }) => fit.proposeDimensions())
    if (sizes.some(size => !size)) return
    const cols = Math.max(30, Math.min(280, ...sizes.map(size => size.cols)))
    const rows = Math.max(10, Math.min(70, ...sizes.map(size => size.rows)))
    for (const { terminal } of sessions.values()) terminal.resize(cols, rows)
    post({ type: 'resize', cols, rows })
  }, 50)
}
const observer = new ResizeObserver(scheduleFit)
for (const id of ids) observer.observe(element(id + '-terminal'))
document.fonts.ready.then(scheduleFit)

function update() {
  const online = connected()
  const current = ids.map(id => state.lanes[id]?.status ?? 'starting')
  const ready = current.every(value => value === 'ready')
  const stopped = current.every(value => value === 'stopped' || value === 'error')
  connection.dataset.live = String(online)
  connection.lastElementChild.textContent = online ? 'Conexão local' : 'Reconectando'
  current.forEach((value, index) => {
    const pill = element(ids[index] + '-status')
    pill.dataset.state = value
    pill.textContent = labels[value]
  })
  restartButton.disabled = !online || pending || state.sending || state.transitioning
  stopButton.disabled = restartButton.disabled || stopped
  sendButton.disabled = !online || pending || state.sending || state.transitioning || !ready || !prompt.value.trim()
  hint.textContent = notice || (
    !online ? 'Reconectando ao laboratório local.'
      : pending || state.sending ? 'Enviando a mesma entrada para os dois.'
      : current.includes('setup') ? 'Conclua a configuração ou o login em cada terminal.'
      : current.includes('approval') ? 'Responda à confirmação no terminal que a solicitou.'
      : current.includes('draft') ? 'Envie ou limpe o rascunho do terminal antes de usar o prompt compartilhado.'
      : stopped ? 'Inicie um novo par para continuar.'
      : ready ? 'Envie pelo campo compartilhado ou use Ctrl ou ⌘ + Enter.'
      : 'O envio fica disponível quando os dois terminais estiverem no campo de prompt.'
  )
}

function connect() {
  socket = new WebSocket('ws://' + location.host + '/terminal')
  socket.onopen = () => { notice = ''; scheduleFit(); update() }
  socket.onclose = () => {
    pending = false
    state = { lanes: {} }
    update()
    setTimeout(connect, 850)
  }
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.type === 'meta') {
      element('with-heading').textContent = 'Com ' + message.item
      element('without-heading').textContent = 'Sem ' + message.item
      element('item-summary').textContent = (message.demo ? 'Demonstração de PTY · ' : 'Item testado · ') +
        message.item + (message.bypassPermissions ? ' · Bypass de permissões' : '')
      element('project-summary').textContent = message.project + (message.model ? ' · ' + message.model : '')
      element('subtitle').textContent = message.demo
        ? 'Demonstração local dos terminais. O exemplo roda sem consulta ao Claude.'
        : 'Envie uma entrada e compare os resultados em sessões isoladas.'
      element('example').hidden = !message.sample
    }
    if (message.type === 'reset') {
      run = message.run
      notice = ''
      for (const { terminal } of sessions.values()) terminal.write('\x1bc\x1b[3J')
    }
    if (message.type === 'data' && message.run === run) {
      sessions.get(message.lane)?.terminal.write(message.data)
    }
    if (message.type === 'state') state = message
    if (message.type === 'notice') {
      pending = false
      notice = message.text
    }
    if (message.type === 'sent') {
      pending = false
      prompt.value = ''
      notice = ''
    }
    update()
  }
}

element('example').addEventListener('click', () => {
  prompt.value = sample
  notice = ''
  prompt.focus()
  update()
})
prompt.addEventListener('input', () => { notice = ''; update() })
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    element('composer').requestSubmit()
  }
})
element('composer').addEventListener('submit', event => {
  event.preventDefault()
  if (sendButton.disabled) return
  pending = true
  notice = ''
  post({ type: 'send', text: prompt.value })
  update()
})
restartButton.addEventListener('click', () => {
  const open = ids.some(id => !['stopped', 'error'].includes(state.lanes[id]?.status))
  if (open && !confirm('Abrir um novo par e descartar as cópias desta rodada?')) return
  post({ type: 'reset' })
})
stopButton.addEventListener('click', () => post({ type: 'stop' }))

connect()
