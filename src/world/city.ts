import * as THREE from 'three'
import type { DistrictId, SimState } from '../core/types'
import { createScalar, createTensor, createVector } from './accelerators'
import { DistrictBuild } from './build'
import { DISTRICTS, districtById } from './districts'
import { createGround } from './ground'
import { createChip } from './heterogeneous'
import { createMicrotile } from './microtile'
import { createSensors } from './sensors'
import { createVtcm } from './vtcm'

export interface CityLabel {
  id: DistrictId
  name: string
  position: THREE.Vector3
}

export interface CityHandle {
  object: THREE.Group
  pickables: THREE.Object3D[]
  labels: CityLabel[]
  update(dt: number, s: SimState): void
}

/** Height above each district centre at which its floating label sits. */
const LABEL_Y: Record<DistrictId, number> = {
  vtcm: 9,
  scalar: 9.5,
  vector: 6,
  tensor: 6.5,
  microtile: 3,
  cpu: 3.5,
  gpu: 3.5,
  sensors: 6,
}

export function createCity(): CityHandle {
  const object = new THREE.Group()
  object.add(createGround())

  const def = (id: DistrictId) => districtById(id)!
  const builds: DistrictBuild[] = [
    createVtcm(def('vtcm')),
    createScalar(def('scalar')),
    createVector(def('vector')),
    createTensor(def('tensor')),
    createMicrotile(def('microtile')),
    createChip(def('cpu'), (s) => (s.workload === 'idle' ? 0.08 : 0.35 + s.util.scalar * 0.4)),
    createChip(def('gpu'), (s) => 0.1 + s.util.vector * 0.4),
    createSensors(def('sensors')),
  ]

  const pickables: THREE.Object3D[] = []
  for (const b of builds) {
    object.add(b.group)
    pickables.push(b.group)
  }

  const labels: CityLabel[] = DISTRICTS.map((d) => ({
    id: d.id,
    name: d.name,
    position: d.pos.clone().setY(LABEL_Y[d.id]),
  }))

  function update(dt: number, s: SimState): void {
    for (const b of builds) b.update(dt, s)
  }

  return { object, pickables, labels, update }
}
