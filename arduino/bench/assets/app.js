/* Relays the board's llama.cpp sweep into the embedded HexagonNPUSimCity page. */

const CHANNEL = 'hexagon-npu-simcity'
const VERSION = 1
const HELLO_RETRY_MS = 1000

const city = document.querySelector('#city')
const statusEl = document.querySelector('#status')
const quantsEl = document.querySelector('#quants')
const caveatEl = document.querySelector('#caveat')

// Exact origin of the embedded build; never post measurements to '*'.
const CITY_ORIGIN = new URL(city.src).origin

let cityReady = false
let latest = null
let helloTimer = null

function post(message) {
  city.contentWindow?.postMessage({ channel: CHANNEL, version: VERSION, ...message }, CITY_ORIGIN)
}

/** Keep greeting the frame until it answers, since we cannot see its load state. */
function greet() {
  clearInterval(helloTimer)
  cityReady = false
  helloTimer = setInterval(() => {
    if (cityReady) return clearInterval(helloTimer)
    post({ type: 'hello' })
  }, HELLO_RETRY_MS)
  post({ type: 'hello' })
}

window.addEventListener('message', (event) => {
  if (event.origin !== CITY_ORIGIN) return
  const data = event.data
  if (!data || data.channel !== CHANNEL || data.version !== VERSION || data.type !== 'ready') return
  cityReady = true
  clearInterval(helloTimer)
  if (latest) post({ type: 'sample', sample: latest })
})

city.addEventListener('load', greet)

function renderStatus(status) {
  statusEl.textContent = status.message ?? ''
  quantsEl.replaceChildren(...(status.samples ?? []).map((sample) => {
    const item = document.createElement('li')
    item.dataset.quant = sample.quantization
    const name = document.createElement('b')
    name.textContent = sample.quantization
    const rate = document.createElement('span')
    rate.textContent = typeof sample.tokensPerSecond === 'number'
      ? `${sample.tokensPerSecond.toFixed(1)} tok/s`
      : 'not reported'
    item.append(name, rate)
    return item
  }))
  const backend = status.samples?.[0]?.backend
  caveatEl.hidden = backend !== 'cpu'
  caveatEl.textContent = backend === 'cpu'
    ? 'This board (QRB2210) has no cDSP/HTP, so llama.cpp measures the CPU. The accelerator districts are an illustrative simulation.'
    : ''
}

function highlight(sample) {
  for (const item of quantsEl.children) {
    item.classList.toggle('active', item.dataset.quant === sample.quantization)
  }
}

const ui = new WebUI()
ui.on_message('status', renderStatus)
ui.on_message('sample', (sample) => {
  latest = sample
  highlight(sample)
  if (cityReady) post({ type: 'sample', sample })
  else greet()
})
