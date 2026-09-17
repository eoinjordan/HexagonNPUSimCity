import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { execFileSync } from 'node:child_process'
import { loopbackUrl } from './runtime-server.mjs'

const server = loopbackUrl(process.env.LLAMACPP_URL ?? 'http://127.0.0.1:8080')
const dashboard = loopbackUrl(process.env.DASHBOARD_URL ?? 'http://127.0.0.1:4318')
const model = process.env.LLAMA_MODEL_ALIAS ?? 'qwen2.5-0.5b-instruct-q4_k_m'
const prompt = 'Explain matrix multiplication in one short sentence.'

async function json(origin, path, body) {
  const response = await fetch(new URL(path, origin), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Hexagon-Request': '1' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
    redirect: 'error',
  })
  assert.ok(response.ok, `${path}: HTTP ${response.status}`)
  return response.json()
}

assert.equal((await json(server, '/health')).status, 'ok')
assert.ok((await json(server, '/v1/models')).data.some((entry) => entry.id === model), 'Model missing from llama.cpp')
assert.ok((await json(dashboard, '/api/runtime/models?provider=llamacpp')).models.includes(model), 'Model missing from dashboard discovery')

const completion = await json(server, '/v1/chat/completions', {
  model,
  messages: [{ role: 'user', content: prompt }],
  temperature: 0,
  max_tokens: 64,
  stream: false,
  cache_prompt: false,
})
const text = completion.choices?.[0]?.message?.content
assert.ok(typeof text === 'string' && text.trim().length > 0, 'No generated text')
assert.ok(completion.usage?.completion_tokens > 0, 'No generated token count')

await json(dashboard, '/api/runtime/run', { provider: 'llamacpp', model })
const samples = []
for (let index = 0; index < 5; index++) {
  const result = await json(dashboard, '/api/runtime/run', { provider: 'llamacpp', model })
  assert.equal(result.source, 'llamacpp')
  assert.equal(result.model, model)
  assert.equal(result.backend, 'unverified')
  assert.ok(Number.isSafeInteger(result.generatedTokens) && result.generatedTokens > 0)
  assert.ok(Number.isFinite(result.generationMs) && result.generationMs > 0)
  assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs > 0)
  assert.ok(Number.isFinite(result.tokensPerSecond) && result.tokensPerSecond > 0)
  assert.ok(Math.abs(result.tokensPerSecond - result.generatedTokens * 1000 / result.generationMs) < 1e-6, 'Incorrect timing-unit conversion')
  samples.push({ trial: index + 1, ...result })
}

const mean = (key) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length
const rates = samples.map((sample) => sample.tokensPerSecond).sort((first, second) => first - second)
const report = {
  measuredAt: new Date().toISOString(),
  llamaVersion: execFileSync('llama-server', ['--version'], { encoding: 'utf8' }).trim(),
  host: { platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model, memoryBytes: totalmem() },
  server,
  dashboard,
  model,
  directGeneration: { prompt, response: text, usage: completion.usage, timings: completion.timings },
  method: { trials: 5, excludedDashboardWarmups: 1, dashboardTokenLimit: 32, cachePrompt: false, concurrency: 1 },
  samples,
  summary: {
    meanTokensPerSecond: mean('tokensPerSecond'),
    medianTokensPerSecond: rates[2],
    minTokensPerSecond: rates[0],
    maxTokensPerSecond: rates[4],
    meanGenerationMs: mean('generationMs'),
    meanRequestMs: mean('elapsedMs'),
  },
  caveat: 'Local integration smoke test, not a controlled performance or accuracy benchmark. Timing API does not prove the hardware backend; no Qualcomm/QNN or Apple Neural Engine inference is claimed.',
}
const directory = new URL('../docs/measurements/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('llama-local.json', directory), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ checks: 'health, direct generation, dashboard discovery, five measured runs, unit conversion', report: 'docs/measurements/llama-local.json', ...report.summary, response: text }, null, 2))