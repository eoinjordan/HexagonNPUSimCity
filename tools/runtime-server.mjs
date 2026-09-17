import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isProvider, modelNames, normalizeMeasurement } from '../src/runtime/telemetry.ts'

export const DEFAULT_PROVIDERS = {
  ollama: 'http://127.0.0.1:11434',
  llamacpp: 'http://127.0.0.1:8080',
  lmstudio: 'http://127.0.0.1:1234',
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }

export function loopbackUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Runtime URLs must be loopback HTTP(S) origins without credentials or paths')
  }
  return url.origin
}

async function readJson(stream, limit) {
  let length = 0
  const chunks = []
  for await (const chunk of stream) {
    length += chunk.length
    if (length > limit) throw new Error('JSON payload exceeds the size limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'))
}

export function createRuntimeServer({ providers = DEFAULT_PROVIDERS, distRoot = fileURLToPath(new URL('../dist/', import.meta.url)), apiKeys = {}, allowedOrigins = [], fetchImpl = fetch } = {}) {
  const origins = Object.fromEntries(Object.entries(providers).map(([provider, value]) => [provider, loopbackUrl(value)]))
  let busy = false
  async function upstream(provider, path, body) {
    const headers = { 'Content-Type': 'application/json' }
    if (apiKeys[provider]) headers.Authorization = `Bearer ${apiKeys[provider]}`
    const response = await fetchImpl(new URL(path, origins[provider]), {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}`)
    if (!response.body) throw new Error('Runtime returned an empty response')
    return readJson(response.body, 1024 * 1024)
  }

  return createServer(async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(JSON.stringify(payload))
    }
    try {
      const port = request.socket.localPort
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
      if (!allowedHosts.includes(request.headers.host)) return send(403, { error: 'Host rejected' })
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}` && !allowedOrigins.includes(origin)) return send(403, { error: 'Origin rejected' })
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin)
        response.setHeader('Vary', 'Origin')
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hexagon-Request')
        response.writeHead(204)
        return response.end()
      }
      const url = new URL(request.url, `http://${request.headers.host}`)
      if (url.pathname === '/api/runtime/models' && request.method === 'GET') {
        const provider = url.searchParams.get('provider')
        if (!isProvider(provider)) return send(400, { error: 'Unknown provider' })
        const path = provider === 'ollama' ? '/api/tags' : provider === 'lmstudio' ? '/api/v0/models' : '/v1/models'
        return send(200, { models: modelNames(provider, await upstream(provider, path)) })
      }
      if (url.pathname === '/api/runtime/run' && request.method === 'POST') {
        if (request.headers['x-hexagon-request'] !== '1' || !request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Explicit JSON request required' })
        const input = await readJson(request, 1024)
        if (!isProvider(input.provider) || typeof input.model !== 'string' || input.model.length === 0 || input.model.length > 256) return send(400, { error: 'Invalid provider or model' })
        if (busy) return send(409, { error: 'A workload is already running' })
        busy = true
        try {
          const prompt = 'Explain matrix multiplication in one short sentence.'
          const body = input.provider === 'ollama'
            ? { model: input.model, prompt, stream: false, options: { num_predict: 32, temperature: 0 } }
            : input.provider === 'llamacpp'
              ? { model: input.model, prompt, stream: false, n_predict: 32, temperature: 0, cache_prompt: false }
              : { model: input.model, messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 32, temperature: 0 }
          const path = input.provider === 'ollama' ? '/api/generate' : input.provider === 'llamacpp' ? '/completion' : '/api/v0/chat/completions'
          const start = performance.now()
          const result = await upstream(input.provider, path, body)
          return send(200, normalizeMeasurement(input.provider, input.model, result, performance.now() - start))
        } finally {
          busy = false
        }
      }
      if (url.pathname.startsWith('/api/') || request.method !== 'GET') return send(404, { error: 'Not found' })
      const root = await realpath(distRoot)
      const file = await realpath(resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`))
      if (!file.startsWith(root + sep) || !MIME[extname(file)]) return send(404, { error: 'Not found' })
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)],
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      })
      response.end(await readFile(file))
    } catch (error) {
      if (!response.headersSent) send(error.code === 'ENOENT' ? 404 : 502, { error: error.code === 'ENOENT' ? 'Asset missing; build the site first' : String(error.message).slice(0, 240) })
      else response.end()
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.RUNTIME_PORT ?? 4318)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RUNTIME_PORT must be 1024-65535')
  const providers = Object.fromEntries(Object.entries(DEFAULT_PROVIDERS).map(([name, url]) => [name, process.env[`${name.toUpperCase()}_URL`] ?? url]))
  const apiKeys = Object.fromEntries(Object.keys(providers).map((name) => [name, process.env[`${name.toUpperCase()}_API_KEY`]]))
  const server = createRuntimeServer({ providers, apiKeys, allowedOrigins: process.env.RUNTIME_ORIGIN ? [new URL(process.env.RUNTIME_ORIGIN).origin] : [] })
  server.listen(port, '127.0.0.1', () => console.log(`Local runtime dashboard: http://127.0.0.1:${port}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}