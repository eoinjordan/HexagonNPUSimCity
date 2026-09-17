import type { Precision, Sim, SimState, WorkloadDef, WorkloadId } from '../core/types.ts'
import { approach, clamp01, makeRng } from '../core/util.ts'

/**
 * A small behavioural model of the Hexagon NPU under load.
 *
 * Everything here is ILLUSTRATIVE and scaled for legibility. The goal is that
 * switching workload or precision produces a believable, readable change across
 * the accelerators and dataflow — not that any figure matches a real datasheet.
 */

export const WORKLOADS: WorkloadDef[] = [
  { id: 'llm-decode', label: 'LLM decode' },
  { id: 'vision-conv', label: 'Vision / conv' },
  { id: 'idle', label: 'Idle' },
]

export const PRECISIONS: Precision[] = ['INT4', 'INT8', 'INT16', 'FP16']

/** Illustrative peak tensor throughput (TOPS) by numeric format. */
const PEAK_TOPS: Record<Precision, number> = {
  INT4: 80,
  INT8: 45,
  INT16: 22,
  FP16: 20,
}

/** Illustrative on-device generative decode ceiling (tokens/s) by format. */
const TOKEN_CEIL: Record<Precision, number> = {
  INT4: 95,
  INT8: 62,
  INT16: 34,
  FP16: 30,
}

interface Targets {
  scalar: number
  vector: number
  tensor: number
  vtcm: number
  /** 0..1 scale on the format's token ceiling; 0 for non-generative work. */
  tokenScale: number
  /** Baseline resident micro-tiles for this workload. */
  microTiles: number
}

const TARGETS: Record<WorkloadId, Targets> = {
  'llm-decode': { scalar: 0.35, vector: 0.5, tensor: 0.82, vtcm: 0.72, tokenScale: 1, microTiles: 640 },
  'vision-conv': { scalar: 0.24, vector: 0.72, tensor: 0.92, vtcm: 0.8, tokenScale: 0, microTiles: 900 },
  idle: { scalar: 0.06, vector: 0.05, tensor: 0.04, vtcm: 0.12, tokenScale: 0, microTiles: 40 },
}

export function createSim(): Sim {
  let rng = makeRng(0x4858)

  const state: SimState = {
    t: 0,
    workload: 'llm-decode',
    precision: 'INT8',
    tops: 0,
    tokensPerSec: 0,
    powerWatts: 0,
    util: { scalar: 0, vector: 0, tensor: 0 },
    vtcmOccupancy: 0,
    microTiles: 0,
    paused: false,
  }

  /** Small, bounded per-accelerator liveliness so bars never sit dead flat. */
  function jitter(base: number, phase: number): number {
    const wobble = 0.05 * Math.sin(state.t * 1.7 + phase) + (rng() - 0.5) * 0.02
    return clamp01(base + base * wobble)
  }

  function refreshMetrics(): void {
    state.tops = PEAK_TOPS[state.precision] * state.util.tensor
    state.tokensPerSec = TOKEN_CEIL[state.precision] * TARGETS[state.workload].tokenScale * state.util.tensor
    const work = state.util.scalar * 0.6 + state.util.vector * 1.1 + state.util.tensor * 2.4
    state.powerWatts = 0.4 + work
  }

  function update(dt: number): void {
    if (state.paused || !Number.isFinite(dt) || dt <= 0) return
    dt = Math.min(dt, 0.1)
    state.t += dt

    const tgt = TARGETS[state.workload]
    const rate = 2.2 // how fast utilisation chases its target
    state.util.scalar = approach(state.util.scalar, jitter(tgt.scalar, 0.4), rate, dt)
    state.util.vector = approach(state.util.vector, jitter(tgt.vector, 1.9), rate, dt)
    state.util.tensor = approach(state.util.tensor, jitter(tgt.tensor, 3.1), rate, dt)
    state.vtcmOccupancy = approach(state.vtcmOccupancy, jitter(tgt.vtcm, 2.4), rate, dt)
    state.microTiles = approach(state.microTiles, tgt.microTiles, 1.6, dt)

    refreshMetrics()
  }

  return {
    state,
    update,
    setWorkload(id: WorkloadId) {
      state.workload = id
      refreshMetrics()
    },
    setPrecision(p: Precision) {
      state.precision = p
      refreshMetrics()
    },
    togglePause() {
      state.paused = !state.paused
    },
    reset() {
      rng = makeRng(0x4858)
      state.t = 0
      state.workload = 'llm-decode'
      state.precision = 'INT8'
      state.tops = 0
      state.tokensPerSec = 0
      state.powerWatts = 0
      state.util.scalar = state.util.vector = state.util.tensor = 0
      state.vtcmOccupancy = 0
      state.microTiles = 0
      state.paused = false
    },
  }
}
