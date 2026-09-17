export type RuntimeProvider = 'ollama' | 'llamacpp' | 'lmstudio'

export interface RuntimeMeasurement {
  source: RuntimeProvider
  model: string
  backend: 'unverified'
  elapsedMs: number
  generatedTokens: number | null
  generationMs: number | null
  tokensPerSecond: number | null
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function isProvider(value: unknown): value is RuntimeProvider {
  return value === 'ollama' || value === 'llamacpp' || value === 'lmstudio'
}

export function normalizeMeasurement(source: RuntimeProvider, model: string, payload: unknown, elapsedMs: number): RuntimeMeasurement {
  if (!isProvider(source) || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid measurement source or duration')
  const data = record(payload)
  const timings = record(data.timings)
  const stats = record(data.stats)
  const usage = record(data.usage)
  const count = finite(source === 'ollama' ? data.eval_count : source === 'llamacpp' ? timings.predicted_n : usage.completion_tokens)
  const generatedTokens = count !== null && Number.isSafeInteger(count) ? count : null
  const duration = finite(source === 'ollama' ? data.eval_duration : source === 'llamacpp' ? timings.predicted_ms : stats.generation_time)
  const generationMs = duration === null ? null : source === 'ollama' ? duration / 1e6 : source === 'lmstudio' ? duration * 1000 : duration
  const reportedRate = finite(source === 'lmstudio' ? stats.tokens_per_second : source === 'llamacpp' ? timings.predicted_per_second : null)
  const calculatedRate = generatedTokens !== null && generationMs !== null && generationMs > 0 ? generatedTokens * 1000 / generationMs : null
  return {
    source,
    model,
    backend: 'unverified',
    elapsedMs,
    generatedTokens,
    generationMs,
    tokensPerSecond: calculatedRate !== null && Number.isFinite(calculatedRate) ? calculatedRate : reportedRate,
  }
}

export function modelNames(source: RuntimeProvider, payload: unknown): string[] {
  const data = record(payload)
  const models = source === 'ollama' ? data.models : data.data
  if (!Array.isArray(models)) throw new Error('Runtime returned an invalid model list')
  return [...new Set(models.map((model) => {
    const entry = record(model)
    return source === 'ollama' ? entry.name : entry.id
  }).filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 256))].slice(0, 100)
}