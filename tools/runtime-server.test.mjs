import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { createRuntimeServer, loopbackUrl } from './runtime-server.mjs'

async function fixture(context, fetchImpl) {
  const server = createRuntimeServer({ fetchImpl })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

test('runtime proxy rejects non-loopback URLs, credentials and arbitrary paths', () => {
  for (const value of ['http://example.com', 'http://127.0.0.1.evil.test', 'file:///tmp/data', 'http://user:pass@localhost', 'http://localhost/private', 'http://localhost?key=secret']) assert.throws(() => loopbackUrl(value))
  assert.equal(loopbackUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434')
  assert.equal(loopbackUrl('http://[::1]:1234'), 'http://[::1]:1234')
})

test('runtime proxy lists real model names and executes only its bounded sample payload', async (context) => {
  const requests = []
  const base = await fixture(context, async (url, options) => {
    requests.push({ url: url.toString(), options })
    return Response.json(options.method === 'GET' ? { models: [{ name: 'tiny' }] } : { eval_count: 8, eval_duration: 500_000_000 })
  })
  const models = await fetch(`${base}/api/runtime/models?provider=ollama`)
  assert.deepEqual(await models.json(), { models: ['tiny'] })
  const run = await fetch(`${base}/api/runtime/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hexagon-Request': '1' }, body: JSON.stringify({ provider: 'ollama', model: 'tiny', prompt: 'not forwarded', max_tokens: 99999 }) })
  const value = await run.json()
  assert.equal(value.tokensPerSecond, 16)
  assert.equal(value.backend, 'unverified')
  assert.equal(requests[1].url, 'http://127.0.0.1:11434/api/generate')
  const body = JSON.parse(requests[1].options.body)
  assert.equal(body.options.num_predict, 32)
  assert.equal(body.stream, false)
  assert.notEqual(body.prompt, 'not forwarded')
  assert.equal(requests[1].options.redirect, 'error')
})

test('host/origin checks and explicit JSON requirement block cross-site workload triggers', async (context) => {
  let calls = 0
  const base = await fixture(context, async () => { calls++; return Response.json({}) })
  assert.equal((await fetch(`${base}/api/runtime/models?provider=ollama`, { headers: { Origin: 'https://evil.test' } })).status, 403)
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const forged = request(`${base}/api/runtime/models?provider=ollama`, { headers: { Host: 'evil.test' } }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode))
    })
    forged.on('error', reject)
    forged.end()
  })
  assert.equal(forgedHostStatus, 403)
  assert.equal((await fetch(`${base}/api/runtime/run`, { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await fetch(`${base}/api/runtime/models?provider=unknown`)).status, 400)
  assert.equal(calls, 0)
})

test('runtime failures return errors instead of synthetic measurements', async (context) => {
  const base = await fixture(context, async () => new Response('Unavailable', { status: 503 }))
  const response = await fetch(`${base}/api/runtime/models?provider=lmstudio`)
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'lmstudio returned HTTP 503' })
})