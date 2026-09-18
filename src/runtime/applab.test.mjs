import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPLAB_CHANNEL,
  APPLAB_VERSION,
  createAppLabBridge,
  describeSample,
  isLanOrigin,
  parseAppLabEnvelope,
  parseAppLabSample,
  precisionForQuant,
} from './applab.ts'

const SAMPLE = {
  model: 'SmolLM2-135M-Instruct',
  quantization: 'Q4_0',
  device: 'CPU',
  backend: 'cpu',
  promptTokensPerSecond: 120.5,
  tokensPerSecond: 31.25,
}

const envelope = (type, body = {}) => ({ channel: APPLAB_CHANNEL, version: APPLAB_VERSION, type, ...body })

test('GGUF tensor types map onto the simulation formats by stored bit width', () => {
  assert.equal(precisionForQuant('Q4_0'), 'INT4')
  assert.equal(precisionForQuant('q4_k_m'), 'INT4')
  assert.equal(precisionForQuant('Q8_0'), 'INT8')
  assert.equal(precisionForQuant('Q5_K_M'), 'INT8')
  assert.equal(precisionForQuant('f16'), 'FP16')
  assert.equal(precisionForQuant('Q2_K'), null)
  assert.equal(precisionForQuant(''), null)
})

test('a well-formed sample is accepted and normalised', () => {
  const value = parseAppLabSample(SAMPLE)
  assert.equal(value.precision, 'INT4')
  assert.equal(value.backend, 'cpu')
  assert.equal(value.tokensPerSecond, 31.25)
  assert.equal(value.promptTokensPerSecond, 120.5)
  assert.equal(parseAppLabSample({ ...SAMPLE, quantization: 'q8_0' }).quantization, 'Q8_0')
})

test('unreported rates stay null rather than being invented', () => {
  const value = parseAppLabSample({ ...SAMPLE, tokensPerSecond: null, promptTokensPerSecond: 0 })
  assert.equal(value.tokensPerSecond, null)
  assert.equal(value.promptTokensPerSecond, null)
  for (const bad of [-1, NaN, Infinity, '31']) {
    assert.equal(parseAppLabSample({ ...SAMPLE, tokensPerSecond: bad }).tokensPerSecond, null)
  }
})

test('malformed samples are rejected outright', () => {
  assert.equal(parseAppLabSample(null), null)
  assert.equal(parseAppLabSample([SAMPLE]), null)
  assert.equal(parseAppLabSample({ ...SAMPLE, model: '' }), null)
  assert.equal(parseAppLabSample({ ...SAMPLE, model: 'x'.repeat(257) }), null)
  assert.equal(parseAppLabSample({ ...SAMPLE, device: undefined }), null)
  assert.equal(parseAppLabSample({ ...SAMPLE, backend: 'qnn' }), null)
  assert.equal(parseAppLabSample({ ...SAMPLE, quantization: 'Q2_K' }), null)
})

test('envelopes for another channel or version are ignored', () => {
  assert.deepEqual(parseAppLabEnvelope(envelope('hello')), { type: 'hello' })
  assert.equal(parseAppLabEnvelope(envelope('sample', { sample: SAMPLE })).sample.quantization, 'Q4_0')
  assert.equal(parseAppLabEnvelope({ ...envelope('hello'), channel: 'other' }), null)
  assert.equal(parseAppLabEnvelope({ ...envelope('hello'), version: 2 }), null)
  assert.equal(parseAppLabEnvelope(envelope('shutdown')), null)
  assert.equal(parseAppLabEnvelope(envelope('sample', { sample: { ...SAMPLE, backend: 'gpu' } })), null)
  assert.equal(parseAppLabEnvelope('hello'), null)
})

test('only loopback and private-range origins count as the board', () => {
  for (const origin of ['http://127.0.0.1:7000', 'http://localhost:7000', 'http://192.168.1.63:7000',
    'https://10.0.0.5', 'http://172.16.4.4:8080', 'http://172.31.0.1', 'http://echoglow-eoin.local:7000']) {
    assert.equal(isLanOrigin(origin), true, origin)
  }
  for (const origin of ['https://evil.example.com', 'http://172.32.0.1', 'http://11.0.0.1',
    'http://193.168.1.1', 'file:///tmp', 'not-a-url', '', 'null']) {
    assert.equal(isLanOrigin(origin), false, origin)
  }
})

/** Minimal window stand-in so the bridge can be driven without a DOM. */
function fakeHost() {
  const listeners = new Set()
  return {
    listeners,
    addEventListener: (_name, fn) => listeners.add(fn),
    removeEventListener: (_name, fn) => listeners.delete(fn),
    dispatch: (event) => { for (const fn of [...listeners]) fn(event) },
  }
}

test('the bridge accepts board samples and ignores foreign origins', () => {
  const host = fakeHost()
  const seen = []
  const stop = createAppLabBridge({ host, onSample: (sample) => seen.push(sample) })

  host.dispatch({ origin: 'https://evil.example.com', data: envelope('sample', { sample: SAMPLE }) })
  assert.equal(seen.length, 0, 'a public origin must not drive the simulation')

  host.dispatch({ origin: 'http://192.168.1.63:7000', data: envelope('sample', { sample: SAMPLE }) })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].precision, 'INT4')

  host.dispatch({ origin: 'http://192.168.1.63:7000', data: envelope('sample', { sample: { ...SAMPLE, backend: 'nope' } }) })
  assert.equal(seen.length, 1, 'malformed samples are dropped')

  stop()
  host.dispatch({ origin: 'http://192.168.1.63:7000', data: envelope('sample', { sample: SAMPLE }) })
  assert.equal(seen.length, 1, 'teardown detaches the listener')
})

test('an extra allowed origin is honoured without widening the LAN rule', () => {
  const host = fakeHost()
  const seen = []
  createAppLabBridge({ host, allowedOrigins: ['https://applab.example', '*'], onSample: (s) => seen.push(s) })
  host.dispatch({ origin: 'https://applab.example', data: envelope('sample', { sample: SAMPLE }) })
  assert.equal(seen.length, 1)
  host.dispatch({ origin: 'https://other.example', data: envelope('sample', { sample: SAMPLE }) })
  assert.equal(seen.length, 1, "a literal '*' entry must not act as a wildcard")
})

test('hello is answered with ready, addressed back to the sender origin', () => {
  const host = fakeHost()
  const sent = []
  createAppLabBridge({ host, onSample: () => {} })
  const source = { postMessage: (data, origin) => sent.push({ data, origin }) }
  host.dispatch({ origin: 'http://192.168.1.63:7000', data: envelope('hello'), source })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].origin, 'http://192.168.1.63:7000')
  assert.equal(sent[0].data.type, 'ready')
  assert.equal(sent[0].data.channel, APPLAB_CHANNEL)

  host.dispatch({ origin: 'https://evil.example.com', data: envelope('hello'), source })
  assert.equal(sent.length, 1, 'no reply to an untrusted origin')
})

test('the readout names the measured backend and admits missing numbers', () => {
  const cpu = describeSample(parseAppLabSample(SAMPLE))
  assert.match(cpu, /Q4_0/)
  assert.match(cpu, /CPU \(CPU\)/)
  assert.match(cpu, /31\.3 tok\/s generate/)

  const partial = describeSample(parseAppLabSample({ ...SAMPLE, tokensPerSecond: null }))
  assert.match(partial, /generation rate unavailable/)

  const npu = describeSample(parseAppLabSample({ ...SAMPLE, backend: 'hexagon-htp', device: 'HTP0' }))
  assert.match(npu, /Hexagon NPU \(HTP0\)/)
})
