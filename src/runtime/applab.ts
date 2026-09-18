import type { Precision } from '../core/types'
import { el } from '../ui/dom'

/* ============================================================================
 * Arduino App Lab connector.
 *
 * The App Lab App runs a llama.cpp quantization sweep on the board and embeds
 * this page in an <iframe>. Measurements arrive over postMessage; this module
 * validates them and hands back a typed sample. Nothing here fabricates a
 * number: a field the board did not report stays null.
 *
 * Protocol (host = the App Lab page, guest = this page):
 *   host  -> guest  { channel, version, type: 'hello' }
 *   guest -> host   { channel, version, type: 'ready' }   (replied to sender)
 *   host  -> guest  { channel, version, type: 'sample', sample }
 * ==========================================================================*/

export const APPLAB_CHANNEL = 'hexagon-npu-simcity'
export const APPLAB_VERSION = 1

/** Backends a sample can be measured on. */
export type SampleBackend = 'hexagon-htp' | 'cpu'

export interface AppLabSample {
  model: string
  /** GGUF tensor type actually loaded, e.g. `Q4_0`. */
  quantization: string
  /** The simulation format the quantization maps onto. */
  precision: Precision
  backend: SampleBackend
  /** llama.cpp device string, e.g. `HTP0` or `CPU`. */
  device: string
  /** Prompt-processing rate (pp), tokens/s, or null when not reported. */
  promptTokensPerSecond: number | null
  /** Token-generation rate (tg), tokens/s, or null when not reported. */
  tokensPerSecond: number | null
}

/**
 * GGUF tensor type -> illustrative simulation format, bucketed by stored bit
 * width. MXFP4 is a 4-bit float rather than an affine integer format; it is
 * bucketed with INT4 for display only.
 */
const QUANT_PRECISION: Readonly<Record<string, Precision>> = {
  Q4_0: 'INT4', Q4_1: 'INT4', Q4_K_S: 'INT4', Q4_K_M: 'INT4', IQ4_NL: 'INT4', IQ4_XS: 'INT4', MXFP4: 'INT4',
  Q5_0: 'INT8', Q5_1: 'INT8', Q5_K_S: 'INT8', Q5_K_M: 'INT8', Q6_K: 'INT8', Q8_0: 'INT8',
  F16: 'FP16', BF16: 'FP16', FP16: 'FP16',
}

export function precisionForQuant(quantization: string): Precision | null {
  return QUANT_PRECISION[quantization.toUpperCase()] ?? null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** A positive, finite rate, or null. Zero and negatives are treated as absent. */
function rate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function label(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

/**
 * True for loopback and RFC1918 origins. The board's address comes from DHCP, so
 * the connector trusts LAN hosts rather than a hard-coded IP. A site on the open
 * internet cannot present such an origin, which keeps a hostile page from
 * driving the visualization.
 */
export function isLanOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.endsWith('.local')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (!v4) return false
  const a = Number(v4[1])
  const b = Number(v4[2])
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * Validate an untrusted sample payload. Returns null for anything malformed so
 * a hostile or buggy sender cannot push partial state into the simulation.
 */
export function parseAppLabSample(payload: unknown): AppLabSample | null {
  const data = record(payload)
  const model = label(data.model, 256)
  const quantization = label(data.quantization, 32)
  const device = label(data.device, 64)
  if (!model || !quantization || !device) return null
  if (data.backend !== 'hexagon-htp' && data.backend !== 'cpu') return null
  const precision = precisionForQuant(quantization)
  if (!precision) return null
  return {
    model,
    quantization: quantization.toUpperCase(),
    precision,
    backend: data.backend,
    device,
    promptTokensPerSecond: rate(data.promptTokensPerSecond),
    tokensPerSecond: rate(data.tokensPerSecond),
  }
}

export type AppLabMessage = { type: 'hello' } | { type: 'sample'; sample: AppLabSample }

/** Unwrap a postMessage envelope, rejecting anything not addressed to us. */
export function parseAppLabEnvelope(data: unknown): AppLabMessage | null {
  const envelope = record(data)
  if (envelope.channel !== APPLAB_CHANNEL || envelope.version !== APPLAB_VERSION) return null
  if (envelope.type === 'hello') return { type: 'hello' }
  if (envelope.type !== 'sample') return null
  const sample = parseAppLabSample(envelope.sample)
  return sample ? { type: 'sample', sample } : null
}

export interface AppLabBridgeOptions {
  onSample(sample: AppLabSample): void
  /** Extra exact origins to trust, beyond loopback and RFC1918 hosts. */
  allowedOrigins?: readonly string[]
  /** Overridable for tests. */
  host?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * Listen for samples from the embedding App Lab UI, replying `ready` to the
 * host's `hello` so it knows when to start streaming. Returns a teardown
 * function.
 */
export function createAppLabBridge(options: AppLabBridgeOptions): () => void {
  const host = options.host ?? window
  const extra = (options.allowedOrigins ?? []).filter((origin) => origin && origin !== '*')
  const receive = (event: MessageEvent) => {
    if (!isLanOrigin(event.origin) && !extra.includes(event.origin)) return
    const message = parseAppLabEnvelope(event.data)
    if (!message) return
    if (message.type === 'sample') {
      options.onSample(message.sample)
      return
    }
    const sender = event.source as { postMessage?: (data: unknown, origin: string) => void } | null
    // Replying to the sender's own origin avoids ever using a '*' target.
    sender?.postMessage?.({ channel: APPLAB_CHANNEL, version: APPLAB_VERSION, type: 'ready' }, event.origin)
  }
  host.addEventListener('message', receive as EventListener)
  return () => host.removeEventListener('message', receive as EventListener)
}

/** One-line human summary of a sample, for the on-screen readout. */
export function describeSample(sample: AppLabSample): string {
  const backend = sample.backend === 'hexagon-htp' ? `Hexagon NPU (${sample.device})` : `CPU (${sample.device})`
  const tg = sample.tokensPerSecond === null ? 'generation rate unavailable' : `${sample.tokensPerSecond.toFixed(1)} tok/s generate`
  const pp = sample.promptTokensPerSecond === null ? 'prompt rate unavailable' : `${sample.promptTokensPerSecond.toFixed(1)} tok/s prompt`
  return `${sample.quantization} · ${backend} · ${tg} · ${pp}`
}

export interface AppLabPanel {
  show(sample: AppLabSample): void
}

/**
 * A readout for measurements arriving from the board, appended to the runtime
 * panel. It is built on the first sample, so a standalone visit never shows an
 * empty, permanently-waiting section.
 */
export function createAppLabPanel(panel: HTMLElement): AppLabPanel {
  const status = el('output', { class: 'runtime-status', 'aria-live': 'polite' })
  const model = el('div', { class: 'applab-model' })
  const note = el('p', { class: 'applab-note' })
  let attached = false
  return {
    show(sample) {
      if (!attached) {
        attached = true
        panel.append(el('div', { class: 'runtime-fields applab-fields' }, [
          el('strong', { text: 'Measured on Arduino board' }),
          model,
          status,
          note,
        ]))
        if (panel instanceof HTMLDetailsElement) panel.open = true
      }
      model.textContent = sample.model
      status.textContent = describeSample(sample)
      note.textContent = sample.backend === 'cpu'
        ? 'Measured on the board CPU. The accelerator districts remain an illustrative simulation.'
        : 'Measured on the board NPU.'
    },
  }
}
