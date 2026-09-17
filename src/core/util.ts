export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * -Math.expm1(-rate * dt)
}

export function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function fmtNum(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function fmtPct(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`
}

export function reduceMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function hexCss(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}