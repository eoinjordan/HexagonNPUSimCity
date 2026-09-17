import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { clamp01, makeRng } from '../core/util'
import { DistrictBuild, districtGroup, roundedBox, surface } from './build'

/**
 * Micro-tile inferencing: a yard where activations and weights are cut into
 * small tiles and streamed through the accelerators. The number of tiles alight
 * and scrolling tracks how many tiles are resident this instant — the mechanism
 * that keeps the engines fed at ultra-low power.
 */
export function createMicrotile(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const G = 14
  const COUNT = G * G
  const PITCH = 0.86
  const HALF = ((G - 1) * PITCH) / 2

  const pad = new THREE.Mesh(roundedBox(G * PITCH + 1.6, 0.4, G * PITCH + 1.6, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const geo = roundedBox(0.66, 0.22, 0.66, 0.06)
  const mat = surface(0xffffff, { emissiveIntensity: 0.6, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const tiles = new THREE.InstancedMesh(geo, mat, COUNT)
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  group.add(tiles)

  const base = new THREE.Color(def.color)
  const rng = makeRng(0x3c0d)
  const threshold = new Float32Array(COUNT)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < COUNT; i++) threshold[i] = rng()

  function update(_dt: number, s: SimState): void {
    const frac = clamp01(s.microTiles / 900)
    for (let i = 0; i < COUNT; i++) {
      const gx = i % G
      const gz = (i / G) | 0
      const resident = threshold[i] < frac
      const scroll = 0.5 + 0.5 * Math.sin(s.t * 5 - gx * 0.5 - gz * 0.3)
      const b = resident ? 0.35 + scroll * 0.6 : 0.08
      const h = resident ? 0.6 + scroll * 1.1 : 0.35
      dummy.position.set(gx * PITCH - HALF, 0.5, gz * PITCH - HALF)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      tiles.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(b)
      tiles.setColorAt(i, color)
    }
    tiles.instanceMatrix.needsUpdate = true
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true
  }

  update(0, { microTiles: 400, t: 0 } as SimState)
  return { group, update }
}
