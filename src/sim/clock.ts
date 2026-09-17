export const FIXED_STEP = 1 / 60

export function createClock(step: (dt: number) => void) {
  let previousTime: number | undefined
  let accumulator = 0

  return {
    advance(timestamp: number, running = true): boolean {
      if (!Number.isFinite(timestamp)) return false
      if (previousTime === undefined) {
        previousTime = timestamp
        return false
      }
      const elapsed = Math.max(0, Math.min((timestamp - previousTime) / 1000, 0.1))
      previousTime = timestamp
      if (!running) {
        accumulator = 0
        return false
      }
      accumulator += elapsed
      let changed = false
      while (accumulator + 1e-9 >= FIXED_STEP) {
        step(FIXED_STEP)
        accumulator = Math.max(0, accumulator - FIXED_STEP)
        changed = true
      }
      return changed
    },
    reset() {
      previousTime = undefined
      accumulator = 0
    },
  }
}