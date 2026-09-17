import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntimePanel } from './panel.ts'
import { installDom } from '../../tests/helpers/dom.mjs'

test('runtime panel makes no automatic requests and keeps native actions out of a regular browser', (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  const panel = createRuntimePanel(environment.document.body, async () => assert.fail('unexpected request'))
  assert.equal(panel.querySelector('output').textContent, 'Not connected')
  assert.equal(panel.querySelectorAll('button').length, 2)
  assert.equal(panel.querySelectorAll('button')[1].disabled, true)
})

test('runtime panel connects and renders measured rates without changing simulation meters', async (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  const calls = []
  const panel = createRuntimePanel(environment.document.body, async (url, options) => {
    calls.push({ url, options })
    return Response.json(options.method === 'GET' ? { models: ['tiny-local'] } : { tokensPerSecond: 16, elapsedMs: 600 })
  })
  const [connect, run] = panel.querySelectorAll('button')
  connect.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(run.disabled, false)
  run.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(panel.querySelector('output').textContent, /16.0 tokens\/s.*600.0 ms.*backend unverified/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].options.headers['X-Hexagon-Request'], '1')
  assert.deepEqual(JSON.parse(calls[1].options.body), { provider: 'ollama', model: 'tiny-local' })
  panel.querySelector('select').dispatchEvent(new environment.window.Event('change'))
  assert.equal(run.disabled, true)
})

test('runtime panel refuses remote service URLs and displays connection failures', async (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  const panel = createRuntimePanel(environment.document.body, async () => assert.fail('remote request should be blocked'))
  panel.querySelector('input').value = 'https://example.com'
  panel.querySelector('button').click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(panel.querySelector('output').textContent, /loopback/)
  assert.equal(panel.querySelector('button').disabled, false)
})

test('native bridge only accepts QNN results with verified output and no CPU fallback', async (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  let listener
  let valid = false
  environment.window.chrome = { webview: {
    addEventListener: (_name, handler) => { listener = handler },
    removeEventListener: () => { listener = undefined },
    postMessage: (request) => queueMicrotask(() => listener({ data: {
      id: request.id, backend: valid ? 'qnn-htp' : 'cpu', cpuFallbackDisabled: valid,
      outputMatches: true, iterations: 25, meanMs: 0.25,
    } })),
  } }
  const panel = createRuntimePanel(environment.document.body)
  const qnn = [...panel.querySelectorAll('button')].find((button) => button.textContent.includes('QNN'))
  qnn.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(panel.querySelectorAll('output')[1].textContent, /did not pass provider\/output verification/)
  assert.equal(listener, undefined)
  valid = true
  qnn.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(panel.querySelectorAll('output')[1].textContent, /qnn-htp.*0.250 ms.*25 runs.*output verified/)
  assert.equal(qnn.disabled, false)
  assert.equal(listener, undefined)
})

test('Android bridge handles JSON replies and reports unavailable QNN without simulated fallback', async (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  environment.window.HexagonNative = {
    postMessage: (json) => {
      const request = JSON.parse(json)
      queueMicrotask(() => environment.window.HexagonNative.onmessage({ data: JSON.stringify({ id: request.id, error: 'QNN provider unavailable' }) }))
    },
  }
  const panel = createRuntimePanel(environment.document.body)
  const qnn = [...panel.querySelectorAll('button')].find((button) => button.textContent.includes('QNN'))
  qnn.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(panel.querySelectorAll('output')[1].textContent, 'QNN provider unavailable')
  assert.equal(environment.window.HexagonNative.onmessage, undefined)
  assert.equal(qnn.disabled, false)
})