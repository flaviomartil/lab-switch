const ids = ['with', 'without']
const element = id => document.getElementById(id)
const prompt = element('prompt')
const hint = element('hint')
const sendButton = element('send')
const restartButton = element('restart')
const stopButton = element('stop')
const connection = element('connection')
const sample = 'No arquivo rotina.tsv, conte as tarefas marcadas como feito e diga o identificador da última concluída.'

const historyList = element('history-list')
const historyDetail = element('history-detail')
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const historyDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
let savedEntries = []
let selectedHistory = null
let followLatest = false
let sentSinceLoad = false
let activeTab = 'compare'
const previews = { with: undefined, without: undefined }
const owners = { with: null, without: null }

function make(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function selectHistory(id, user = false) {
  selectedHistory = id
  if (user) showTab('compare')
  for (const button of historyList.querySelectorAll('button')) {
    if (button.dataset.id === id) button.setAttribute('aria-current', 'true')
    else button.removeAttribute('aria-current')
  }
  historyDetail.replaceChildren(make('p', 'Carregando comparação…'))
  post({ type: 'history-open', id })
}

function showHistoryList(entries) {
  savedEntries = entries
  element('lab-title').textContent = entries.length ? 'Rodadas · ' + entries.length : 'Rodadas'
  historyList.replaceChildren()
  for (const entry of entries) {
    const button = make('button')
    button.type = 'button'
    button.dataset.id = entry.id
    if (entry.id === selectedHistory) button.setAttribute('aria-current', 'true')
    const when = make('span', historyDate.format(new Date(entry.startedAt)), 'history-date')
    if (entry.status === 'running') when.append(make('span', ' · em andamento', 'live'))
    button.append(when, make('span', entry.prompt))
    button.addEventListener('click', () => selectHistory(entry.id, true))
    historyList.append(button)
  }
  if (!entries.length) historyDetail.replaceChildren(make('p', 'Envie um prompt aos dois terminais para criar a primeira comparação.'))
  else if (!entries.some(entry => entry.id === selectedHistory)) selectHistory(entries[0].id)
}

function effectiveMode(mode) {
  return { bypassPermissions: 'Bypass', auto: 'Auto', default: 'Manual', plan: 'Plano', acceptEdits: 'Aceitar edições', simulated: 'Simulado' }[mode] ?? mode ?? '—'
}

function showComparison(entry) {
  if (selectedHistory !== entry.id) return
  const statusLabel = { complete: 'Concluída', partial: 'Incompleta', running: 'Em andamento' }[entry.status]
  const origin = { imported: 'Rodada anterior importada', demo: 'Demonstração', live: 'Enviada no Lab' }[entry.source]
  const sides = ids.map(id => entry.sides[id])
  const labels = ids.map(id => entry.labels[id])
  const rows = [
    ['Modo efetivo', side => effectiveMode(side?.permissionMode)],
    ['Modelo', side => side?.model ?? '—'],
    ['Entrada total', 'input'], ['Entrada nova', 'fresh'], ['Cache lido', 'cacheRead'],
    ['Cache criado', 'cacheWritten'], ['Saída', 'output'], ['Requisições medidas', 'requests'],
    ['Chamadas', 'tools'], ['Erros de ferramentas', 'toolErrors'], ['Tempo', 'durationMs'],
  ]
  const table = make('table', undefined, 'metrics')
  const thead = make('thead')
  const headings = make('tr')
  for (const label of ['Métrica', ...labels, 'Com − sem']) headings.append(make('th', label))
  thead.append(headings)
  table.append(thead)
  const tbody = make('tbody')
  for (const [label, field] of rows) {
    const row = make('tr')
    const head = make('th', label)
    head.scope = 'row'
    row.append(head)
    if (typeof field === 'function') {
      for (const side of sides) row.append(make('td', field(side)))
      row.append(make('td', '—'))
    } else {
      const values = sides.map(side => side?.[field] ?? null)
      const difference = values.every(Number.isFinite) ? values[0] - values[1] : null
      const format = value => !Number.isFinite(value) ? '—'
        : field === 'durationMs' ? numberFormat.format(value / 1000) + ' s' : numberFormat.format(value)
      for (const value of values) row.append(make('td', format(value)))
      row.append(make('td', (difference > 0 ? '+' : '') + format(difference)))
    }
    tbody.append(row)
  }
  table.append(tbody)
  const metrics = make('div', undefined, 'metric-wrap')
  metrics.append(table)
  const replies = make('div', undefined, 'history-replies')
  sides.forEach((side, index) => {
    const panel = make('section')
    panel.append(make('h4', labels[index]), make('pre', side?.answer || 'Resposta ainda indisponível.'))
    replies.append(panel)
  })
  const ownerText = {
    self: '✓ servido por este terminal', with: '⚠ servido pelo outro terminal', without: '⚠ servido pelo outro terminal',
    external: '⚠ porta de outro processo', waiting: 'servidor ainda não respondia',
  }
  let prints = null
  if (sides.some(side => side?.print)) {
    prints = make('div', undefined, 'history-prints')
    sides.forEach((side, index) => {
      const figure = make('figure', undefined, 'print')
      const caption = make('figcaption')
      caption.append(make('strong', labels[index]))
      if (side?.print) {
        const badge = make('span', ownerText[side.print.owner] ?? '', 'owner')
        badge.dataset.owner = side.print.owner ?? ''
        caption.append(badge, make('span', side.print.url.replace('http://', ''), 'history-date'))
        const link = make('a')
        link.href = '/history-print/' + entry.id + '/' + ids[index] + '.png?v=' + encodeURIComponent(side.print.capturedAt)
        link.target = '_blank'
        const image = make('img')
        image.src = link.href
        image.alt = 'Print do preview: ' + labels[index]
        image.loading = 'lazy'
        link.append(image)
        figure.append(caption, link)
      } else {
        figure.append(caption, make('p', 'Sem preview nesta rodada.', 'preview-empty'))
      }
      prints.append(figure)
    })
  }
  historyDetail.replaceChildren(
    make('h3', 'Prompt'),
    make('p', entry.prompt),
    make('p', [statusLabel, origin, historyDate.format(new Date(entry.startedAt))].filter(Boolean).join(' · '), 'history-date'),
    ...(prints ? [make('h3', 'Print do preview', 'section-title'), prints] : []),
    metrics,
    replies,
  )
  if (entry.source === 'imported') {
    historyDetail.append(make('p', 'As sessões anteriores podem ter contexto diferente. Os números descrevem a rodada, sem isolar o efeito da telemetria.', 'history-date'))
  }
}

function showTab(tab) {
  activeTab = tab
  for (const name of ['compare', 'preview']) element('tab-' + name).setAttribute('aria-selected', String(name === tab))
  element('history-detail').hidden = tab !== 'compare'
  element('preview').hidden = tab !== 'preview'
}
element('tab-compare').addEventListener('click', () => showTab('compare'))
element('tab-preview').addEventListener('click', () => showTab('preview'))

function renderPreviews() {
  let count = 0
  for (const id of ids) {
    const url = state.lanes[id]?.preview ?? null
    if (url) count += 1
    const owner = url ? state.lanes[id]?.previewOwner ?? 'waiting' : null
    const badge = element(id + '-preview-owner')
    badge.dataset.owner = owner ?? ''
    const settled = owner && owner !== 'waiting'
    if (url === previews[id] && settled && owners[id] !== owner) {
      const iframe = element(id + '-preview').querySelector('iframe')
      if (iframe) iframe.src = url
    }
    owners[id] = owner
    badge.textContent = {
      self: '✓ servido por este terminal', waiting: 'aguardando servidor', unknown: '',
      external: '⚠ porta de outro processo da máquina',
      with: '⚠ servido pelo outro terminal', without: '⚠ servido pelo outro terminal',
    }[owner] ?? ''
    badge.title = owner === 'with' || owner === 'without'
      ? 'Os dois terminais compartilham as portas da máquina. O servidor deste lado não está escutando nessa porta; a página mostrada é a do outro lado.' : ''
    if (url === previews[id]) continue
    const first = sentSinceLoad && !Object.values(previews).some(Boolean)
    previews[id] = url
    const frame = element(id + '-preview')
    const link = element(id + '-preview-link')
    const reload = document.querySelector('[data-reload="' + id + '"]')
    link.hidden = reload.hidden = !url
    if (!url) {
      frame.replaceChildren(make('p', 'Nenhum servidor local detectado neste terminal. Quando o Claude iniciar um (vite, next, http.server…), a página aparece aqui.', 'preview-empty'))
      continue
    }
    link.href = url
    link.textContent = url.replace('http://', '') + ' ↗'
    const iframe = make('iframe')
    iframe.src = url
    iframe.title = 'Preview ' + element(id + '-heading').textContent
    frame.replaceChildren(iframe)
    if (first) showTab('preview')
  }
  element('tab-preview').textContent = count ? 'Preview · ' + count : 'Preview'
}
for (const button of document.querySelectorAll('[data-reload]')) {
  button.addEventListener('click', () => {
    const iframe = element(button.dataset.reload + '-preview').querySelector('iframe')
    if (iframe) iframe.src = previews[button.dataset.reload]
  })
}

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
    const mode = state.lanes[ids[index]]?.permissionMode
    element(ids[index] + '-mode').textContent = mode ?? (index === 0 ? 'Experimental' : 'Controle')
  })
  restartButton.disabled = !online || pending || state.sending || state.transitioning
  renderPreviews()
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
  socket.onopen = () => { notice = ''; scheduleFit(); post({ type: 'history-list' }); update() }
  socket.onclose = () => {
    pending = false
    state = { lanes: {} }
    update()
    setTimeout(connect, 850)
  }
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.type === 'meta') {
      element('with-heading').textContent = message.labels?.with ?? 'Com ' + message.item
      element('without-heading').textContent = message.labels?.without ?? 'Sem ' + message.item
      for (const id of ids) element(id + '-preview-label').textContent = element(id + '-heading').textContent
      element('item-summary').textContent = (message.demo ? 'Demonstração de PTY · ' : 'Item testado · ') +
        message.item + (message.telemetryOnly ? ' · Comparação de telemetria' : '')
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
    if (message.type === 'history-list') showHistoryList(message.entries)
    if (message.type === 'history-entry' && followLatest && message.entry.source !== 'imported') {
      followLatest = false
      selectedHistory = message.entry.id
    }
    if (message.type === 'history-open' || message.type === 'history-entry') showComparison(message.entry)
    if (message.type === 'notice') {
      pending = false
      notice = message.text
    }
    if (message.type === 'sent') {
      followLatest = true
      sentSinceLoad = true
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
