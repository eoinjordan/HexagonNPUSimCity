import { el } from '../ui/dom'
import { isProvider, type RuntimeMeasurement } from './telemetry'

interface NativeReply {
  id: string
  error?: string
  backend?: string
  meanMs?: number
  iterations?: number
  outputMatches?: boolean
  cpuFallbackDisabled?: boolean
}

interface NativeChannel {
  postMessage(message: unknown): void
  addEventListener?(name: string, handler: (event: MessageEvent) => void): void
  removeEventListener?(name: string, handler: (event: MessageEvent) => void): void
  onmessage?: (event: MessageEvent) => void
}

function nativeSample(backend: 'cpu' | 'qnn'): Promise<NativeReply> {
  const host = window as Window & { chrome?: { webview?: NativeChannel }; HexagonNative?: NativeChannel }
  const channel = host.chrome?.webview ?? host.HexagonNative
  if (!channel) return Promise.reject(new Error('Native runner unavailable in this browser'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      channel.removeEventListener?.('message', receive)
      if (host.HexagonNative) channel.onmessage = undefined
    }
    const receive = (event: MessageEvent) => {
      let data: NativeReply
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
      if (!data || data.id !== id) return
      cleanup()
      if (data.error) return reject(new Error(data.error))
      if (!data.outputMatches || !Number.isFinite(data.meanMs) || data.meanMs! < 0 || data.iterations !== 25
        || (backend === 'qnn' && (data.backend !== 'qnn-htp' || data.cpuFallbackDisabled !== true))) {
        return reject(new Error('Native result did not pass provider/output verification'))
      }
      resolve(data)
    }
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Native workload timed out')) }, 30_000)
    if (channel.addEventListener) channel.addEventListener('message', receive)
    else channel.onmessage = receive
    try {
      const message = { id, command: 'benchmark', backend }
      channel.postMessage(host.HexagonNative ? JSON.stringify(message) : message)
    } catch (error) { cleanup(); reject(error) }
  })
}

export function createRuntimePanel(root: HTMLElement, fetchImpl: typeof fetch = fetch): HTMLElement {
  const status = el('output', { class: 'runtime-status', 'aria-live': 'polite', text: 'Not connected' })
  const provider = el('select', { 'aria-label': 'Measured runtime' }, [
    el('option', { value: 'ollama', text: 'Ollama' }),
    el('option', { value: 'llamacpp', text: 'llama.cpp' }),
    el('option', { value: 'lmstudio', text: 'LM Studio' }),
  ])
  const endpoint = el('input', { type: 'url', 'aria-label': 'Local stats service', value: 'http://127.0.0.1:4318' })
  const model = el('select', { 'aria-label': 'Local model', disabled: true })
  const connect = el('button', { type: 'button', class: 'btn', text: 'Connect' })
  const run = el('button', { type: 'button', class: 'btn', text: 'Run 32-token sample', disabled: true })
  let connectedSource = ''
  let connectedEndpoint = ''
  let busy = false
  const invalidate = () => { run.disabled = true; model.disabled = true; model.replaceChildren(); status.textContent = 'Not connected' }
  provider.addEventListener('change', invalidate)
  endpoint.addEventListener('input', invalidate)

  function serviceOrigin(): string {
    const url = new URL(endpoint.value)
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback HTTP(S) service origin')
    return url.origin
  }

  async function request(path: string, body?: object) {
    const response = await fetchImpl(`${serviceOrigin()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-Hexagon-Request': '1' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35_000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `Service returned HTTP ${response.status}`)
    return data
  }

  async function action(work: () => Promise<void>) {
    if (busy) return
    busy = true
    connect.disabled = run.disabled = provider.disabled = endpoint.disabled = true
    status.textContent = 'Running...'
    try { await work() } catch (error) { status.textContent = error instanceof Error ? error.message : 'Runtime request failed' }
    finally {
      busy = false
      connect.disabled = provider.disabled = endpoint.disabled = false
      run.disabled = model.options.length === 0 || provider.value !== connectedSource || endpoint.value !== connectedEndpoint
    }
  }

  connect.addEventListener('click', () => void action(async () => {
    invalidate()
    const data = await request(`/api/runtime/models?provider=${encodeURIComponent(provider.value)}`)
    if (!Array.isArray(data.models) || !data.models.every((name: unknown) => typeof name === 'string')) throw new Error('Invalid model response')
    model.replaceChildren(...data.models.map((name: string) => el('option', { value: name, text: name })))
    model.disabled = model.options.length === 0
    connectedSource = provider.value
    connectedEndpoint = endpoint.value
    status.textContent = model.options.length ? 'Connected - device backend unverified' : 'Connected - no local models'
  }))

  run.addEventListener('click', () => void action(async () => {
    if (!isProvider(provider.value)) throw new Error('Unknown runtime')
    const value: RuntimeMeasurement = await request('/api/runtime/run', { provider: provider.value, model: model.value })
    const rate = typeof value.tokensPerSecond === 'number' && Number.isFinite(value.tokensPerSecond) ? `${value.tokensPerSecond.toFixed(1)} tokens/s` : 'Token rate unavailable'
    const elapsed = typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) ? `${value.elapsedMs.toFixed(1)} ms request` : 'Request time unavailable'
    status.textContent = `${rate} | ${elapsed} | backend unverified`
  }))

  const panel = el('details', { id: 'runtime-panel', class: 'runtime-panel' }, [
    el('summary', { text: 'Runtime measurements' }),
    el('div', { class: 'runtime-fields' }, [
      el('label', { text: 'Source' }, [provider]),
      el('label', { text: 'Local service' }, [endpoint]),
      el('label', { text: 'Model' }, [model]),
      el('div', { class: 'runtime-actions' }, [connect, run]),
      status,
    ]),
  ])
  const host = window as Window & { chrome?: { webview?: NativeChannel }; HexagonNative?: NativeChannel }
  if (host.chrome?.webview || host.HexagonNative) {
    const nativeStatus = el('output', { class: 'runtime-status', 'aria-live': 'polite', text: 'Native sample not run' })
    const buttons = (['cpu', 'qnn'] as const).map((backend) => {
      const button = el('button', { type: 'button', class: 'btn', text: backend === 'cpu' ? 'Run CPU sample' : 'Run QNN HTP sample' })
      button.addEventListener('click', async () => {
        for (const item of buttons) item.disabled = true
        nativeStatus.textContent = 'Running UINT8 QDQ sample...'
        try {
          const result = await nativeSample(backend)
          nativeStatus.textContent = `${result.backend} | ${result.meanMs!.toFixed(3)} ms mean | 25 runs | output verified`
        } catch (error) { nativeStatus.textContent = error instanceof Error ? error.message : 'Native workload failed' }
        finally { for (const item of buttons) item.disabled = false }
      })
      return button
    })
    panel.append(el('div', { class: 'runtime-fields' }, [el('strong', { text: 'Native arithmetic sample' }), ...buttons, nativeStatus]))
  }
  root.append(panel)
  return panel
}