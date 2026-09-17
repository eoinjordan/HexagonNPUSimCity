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

export interface Sim {
  readonly state: SimState
  update(dt: number): void
  setWorkload(id: WorkloadId): void
  setPrecision(precision: Precision): void
  togglePause(): void
  reset(): void
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