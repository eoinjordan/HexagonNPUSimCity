import assert from 'node:assert/strict'
import test from 'node:test'
import { isProvider, modelNames, normalizeMeasurement } from './telemetry.ts'

test('Ollama nanosecond timings are converted without including model-load time', () => {
  const value = normalizeMeasurement('ollama', 'local-model', { eval_count: 32, eval_duration: 800_000_000, total_duration: 5_000_000_000 }, 5200)
  assert.equal(value.generationMs, 800)
  assert.equal(value.tokensPerSecond, 40)
  assert.equal(value.elapsedMs, 5200)
  assert.equal(value.backend, 'unverified')
})

test('llama.cpp milliseconds and LM Studio seconds produce the same rate', () => {
  const llama = normalizeMeasurement('llamacpp', 'local-model', { timings: { predicted_n: 16, predicted_ms: 500 } }, 700)
  const studio = normalizeMeasurement('lmstudio', 'local-model', { usage: { completion_tokens: 16 }, stats: { generation_time: 0.5 } }, 700)
  assert.equal(llama.tokensPerSecond, 32)
  assert.equal(studio.tokensPerSecond, 32)
  assert.equal(studio.generationMs, 500)
})

test('missing or invalid metrics stay unknown, not manufactured from wall time', () => {
  for (const source of ['ollama', 'llamacpp', 'lmstudio']) {
    const value = normalizeMeasurement(source, 'local-model', {}, 10)
    assert.equal(value.tokensPerSecond, null)
    assert.equal(value.generatedTokens, null)
    assert.equal(value.generationMs, null)
    assert.equal(value.backend, 'unverified')
  }
  assert.equal(normalizeMeasurement('ollama', 'local', { eval_count: 10, eval_duration: 0 }, 20).tokensPerSecond, null)
  assert.equal(normalizeMeasurement('ollama', 'local', { eval_count: NaN, eval_duration: -1 }, 20).tokensPerSecond, null)
  assert.throws(() => normalizeMeasurement('unknown', 'local', {}, 0), RangeError)
  assert.throws(() => normalizeMeasurement('ollama', 'local', {}, Infinity), RangeError)
})

test('reported rate is retained when generation counts are unavailable, without inferring NPU use', () => {
  const value = normalizeMeasurement('lmstudio', 'local', { stats: { tokens_per_second: 42 }, runtime: { name: 'qnn' } }, 20)
  assert.equal(value.tokensPerSecond, 42)
  assert.equal(value.backend, 'unverified')
})

test('model discovery filters malformed entries and deduplicates without inventing models', () => {
  assert.deepEqual(modelNames('ollama', { models: [{ name: 'tiny' }, { name: 'tiny' }, {}, { name: 4 }] }), ['tiny'])
  assert.deepEqual(modelNames('llamacpp', { data: [{ id: 'loaded-model' }] }), ['loaded-model'])
  assert.deepEqual(modelNames('lmstudio', { data: [] }), [])
  assert.throws(() => modelNames('ollama', { models: 'invalid' }))
  assert.equal(isProvider('ollama'), true)
  assert.equal(isProvider('http://example.com'), false)
})