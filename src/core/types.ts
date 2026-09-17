import type { Vector3 } from 'three'

export type Precision = 'INT4' | 'INT8' | 'INT16' | 'FP16'
export type WorkloadId = 'llm-decode' | 'vision-conv' | 'idle'
export type DistrictId = 'vtcm' | 'scalar' | 'vector' | 'tensor' | 'microtile' | 'cpu' | 'gpu' | 'sensors'

export interface WorkloadDef {
  id: WorkloadId
  label: string
}

export interface SimState {
  t: number
  workload: WorkloadId
  precision: Precision
  tops: number
  tokensPerSec: number
  powerWatts: number
  util: { scalar: number; vector: number; tensor: number }
  vtcmOccupancy: number
  microTiles: number
  paused: boolean
}

export interface WorkloadProfile {
  scalar: number
  vector: number
  tensor: number
  vtcm: number
  /** 0..1 scale on the format's token ceiling; 0 for non-generative work. */
  tokenScale: number
  /** Baseline resident micro-tiles for this workload. */
  microTiles: number
}

export interface PowerModel {
  base: number
  scalar: number
  vector: number
  tensor: number
}

/**
 * The tunable, ILLUSTRATIVE figures behind the model. Defaults live in
 * DEFAULT_SIM_CONFIG (src/sim/model.ts) and match docs/verification.md; the
 * settings drawer edits copies of these, it does not change the defaults.
 */
export interface SimConfig {
  peakTops: Record<Precision, number>
  tokenCeil: Record<Precision, number>
  workloads: Record<WorkloadId, WorkloadProfile>
  power: PowerModel
  /** Illustrative list of “supported” ONNX opset versions — display/config only. */
  supportedOpsets: number[]
}

export interface SimConfigPatch {
  peakTops?: Partial<Record<Precision, number>>
  tokenCeil?: Partial<Record<Precision, number>>
  workloads?: Partial<Record<WorkloadId, Partial<WorkloadProfile>>>
  power?: Partial<PowerModel>
  supportedOpsets?: number[]
}

export interface Sim {
  readonly state: SimState
  update(dt: number): void
  setWorkload(id: WorkloadId): void
  setPrecision(precision: Precision): void
  togglePause(): void
  reset(): void
  /** Apply an illustrative-figure change live. */
  configure(patch: SimConfigPatch): void
  /** A copy of the current figures, for populating the settings UI. */
  getConfig(): SimConfig
}

export interface DistrictDef {
  id: DistrictId
  name: string
  subtitle: string
  color: number
  pos: Vector3
  blurb: string
  readout(state: SimState): string
}