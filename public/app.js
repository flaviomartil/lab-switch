const ids = ['with', 'without']
const element = id => document.getElementById(id)
const prompt = element('prompt')
const hint = element('hint')
const sendButton = element('send')
const restartButton = element('restart')
const stopButton = element('stop')
const connection = element('connection')
const sample = 'In the file routine.tsv, count the tasks marked as done and give the identifier of the last one completed.'

const historyList = element('history-list')
const historyDetail = element('history-detail')
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const historyDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' })
let savedEntries = []
let selectedHistory = null
let followLatest = false
let sentSinceLoad = false
let previewPorts = null
const viewUrl = (id, url) => previewPorts ? 'http://' + location.hostname + ':' + previewPorts[id] + new URL(url).pathname : url
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
  historyDetail.replaceChildren(make('p', 'Loading comparison…'))
  post({ type: 'history-open', id })
}

function showHistoryList(entries) {
  savedEntries = entries
  element('lab-title').textContent = entries.length ? 'Rounds · ' + entries.length : 'Rounds'
  historyList.replaceChildren()
  for (const entry of entries) {
    const button = make('button')
    button.type = 'button'
    button.dataset.id = entry.id
    if (entry.id === selectedHistory) button.setAttribute('aria-current', 'true')
    const when = make('span', historyDate.format(new Date(entry.startedAt)), 'history-date')
    if (entry.status === 'running') when.append(make('span', ' · in progress', 'live'))
    button.append(when, make('span', entry.prompt))
    button.addEventListener('click', () => selectHistory(entry.id, true))
    historyList.append(button)
  }
  if (!entries.length) historyDetail.replaceChildren(make('p', 'Send a prompt to both terminals to create the first comparison.'))
  else if (!entries.some(entry => entry.id === selectedHistory)) selectHistory(entries[0].id)
}

function effectiveMode(mode) {
  return { bypassPermissions: 'Bypass', auto: 'Auto', default: 'Manual', plan: 'Plan', acceptEdits: 'Accept edits', simulated: 'Simulated' }[mode] ?? mode ?? '—'
}

function showComparison(entry) {
  if (selectedHistory !== entry.id) return
  const statusLabel = { complete: 'Complete', partial: 'Incomplete', running: 'In progress' }[entry.status]
  const origin = { imported: 'Previous round imported', demo: 'Demo', live: 'Sent in Lab' }[entry.source]
  const sides = ids.map(id => entry.sides[id])
  const labels = ids.map(id => entry.labels[id])
  const rows = [
    ['Effective mode', side => effectiveMode(side?.permissionMode)],
    ['Model', side => side?.model ?? '—'],
    ['Total input', 'input'], ['New input', 'fresh'], ['Cache read', 'cacheRead'],
    ['Cache created', 'cacheWritten'], ['Output', 'output'], ['Measured requests', 'requests'],
    ['Calls', 'tools'], ['Tool errors', 'toolErrors'], ['Time', 'durationMs'],
  ]
  const table = make('table', undefined, 'metrics')
  const thead = make('thead')
  const headings = make('tr')
  for (const label of ['Metric', ...labels, 'With − without']) headings.append(make('th', label))
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
    panel.append(make('h4', labels[index]), make('pre', side?.answer || 'Answer not available yet.'))
    replies.append(panel)
  })
  const ownerText = {
    self: '✓ served by this terminal', with: '⚠ served by the other terminal', without: '⚠ served by the other terminal',
    external: '⚠ port owned by another process', waiting: 'server was not responding yet',
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
        image.alt = 'Preview screenshot: ' + labels[index]
        image.loading = 'lazy'
        link.append(image)
        figure.append(caption, link)
      } else {
        figure.append(caption, make('p', 'No preview in this round.', 'preview-empty'))
      }
      prints.append(figure)
    })
  }
  historyDetail.replaceChildren(
    make('h3', 'Prompt'),
    make('p', entry.prompt),
    make('p', [statusLabel, origin, historyDate.format(new Date(entry.startedAt))].filter(Boolean).join(' · '), 'history-date'),
    ...(prints ? [make('h3', 'Preview screenshot', 'section-title'), prints] : []),
    metrics,
    replies,
  )
  if (entry.source === 'imported') {
    historyDetail.append(make('p', 'Previous sessions may have a different context. The numbers describe the round without isolating the effect of telemetry.', 'history-date'))
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
      if (iframe) iframe.src = viewUrl(id, url)
    }
    owners[id] = owner
    badge.textContent = {
      self: '✓ served by this terminal', waiting: 'waiting for server', unknown: '',
      external: '⚠ port owned by another process on this machine',
      with: '⚠ served by the other terminal', without: '⚠ served by the other terminal',
    }[owner] ?? ''
    badge.title = owner === 'with' || owner === 'without'
      ? 'Both terminals share the machine ports. The server on this side is not listening on that port; the page shown comes from the other side.' : ''
    if (url === previews[id]) continue
    const first = sentSinceLoad && !Object.values(previews).some(Boolean)
    previews[id] = url
    const frame = element(id + '-preview')
    const link = element(id + '-preview-link')
    const reload = document.querySelector('[data-reload="' + id + '"]')
    link.hidden = reload.hidden = !url
    if (!url) {
      frame.replaceChildren(make('p', 'No local server detected in this terminal. When Claude starts one (vite, next, http.server…), the page appears here.', 'preview-empty'))
      continue
    }
    link.href = viewUrl(id, url)
    link.textContent = url.replace('http://', '') + ' ↗'
    const iframe = make('iframe')
    iframe.src = viewUrl(id, url)
    iframe.title = 'Preview ' + element(id + '-heading').textContent
    frame.replaceChildren(iframe)
    if (first) showTab('preview')
  }
  element('tab-preview').textContent = count ? 'Preview · ' + count : 'Preview'
}
for (const button of document.querySelectorAll('[data-reload]')) {
  button.addEventListener('click', () => {
    const iframe = element(button.dataset.reload + '-preview').querySelector('iframe')
    if (iframe) iframe.src = viewUrl(button.dataset.reload, previews[button.dataset.reload])
  })
}

const labels = {
  starting: 'Starting', setup: 'Setup', approval: 'Awaiting confirmation',
  ready: 'Ready', draft: 'Draft', running: 'Running', stopping: 'Stopping', stopped: 'Stopped', error: 'Error',
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
  connection.lastElementChild.textContent = online ? 'Local connection' : 'Reconnecting'
  current.forEach((value, index) => {
    const pill = element(ids[index] + '-status')
    pill.dataset.state = value
    pill.textContent = labels[value]
    const mode = state.lanes[ids[index]]?.permissionMode
    element(ids[index] + '-mode').textContent = mode ?? (index === 0 ? 'Experimental' : 'Control')
  })
  restartButton.disabled = !online || pending || state.sending || state.transitioning
  renderPreviews()
  stopButton.disabled = restartButton.disabled || stopped
  sendButton.disabled = !online || pending || state.sending || state.transitioning || !ready || !prompt.value.trim()
  hint.textContent = notice || (
    !online ? 'Reconnecting to the local lab.'
      : pending || state.sending ? 'Sending the same input to both.'
      : current.includes('setup') ? 'Finish the setup or login in each terminal.'
      : current.includes('approval') ? 'Answer the confirmation in the terminal that requested it.'
      : current.includes('draft') ? 'Send or clear the terminal draft before using the shared prompt.'
      : stopped ? 'Start a new pair to continue.'
      : ready ? 'Send from the shared field or use Ctrl or ⌘ + Enter.'
      : 'Sending is available when both terminals are at the prompt field.'
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
      previewPorts = message.previewPorts ?? null
      element('with-heading').textContent = message.labels?.with ?? 'With ' + message.item
      element('without-heading').textContent = message.labels?.without ?? 'Without ' + message.item
      for (const id of ids) element(id + '-preview-label').textContent = element(id + '-heading').textContent
      element('item-summary').textContent = (message.demo ? 'PTY demo · ' : 'Item under test · ') +
        message.item + (message.telemetryOnly ? ' · Telemetry comparison' : '')
      element('project-summary').textContent = message.project + (message.model ? ' · ' + message.model : '')
      element('subtitle').textContent = message.demo
        ? 'Local demo of the terminals. The example runs without querying Claude.'
        : 'Send an input and compare the results in isolated sessions.'
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
  if (open && !confirm('Open a new pair and discard the copies from this round?')) return
  post({ type: 'reset' })
})
stopButton.addEventListener('click', () => post({ type: 'stop' }))

connect()
