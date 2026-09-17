import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/**
 * The rest of the Qualcomm AI Engine: the Oryon CPU and Adreno GPU. They aren't
 * the NPU, but heterogeneous computing means work is placed on whichever engine
 * fits — the CPU dispatches and runs light layers, the GPU takes parallel work —
 * and the shared bus lets them hand tensors to the NPU cheaply.
 *
 * `activityOf` maps the sim to a 0..1 pulse so each chip breathes with the load
 * it would actually carry.
 */
export function createChip(def: DistrictDef, activityOf: (s: SimState) => number): DistrictBuild {
  const group = districtGroup(def)

  const pkg = new THREE.Mesh(roundedBox(9, 0.9, 7, 0.3), surface(def.color, { emissiveIntensity: 0.14, roughness: 0.5 }))
  pkg.position.y = 0.55
  pkg.castShadow = true
  pkg.receiveShadow = true
  group.add(pkg)

  // Core die.
  const coreMat = glow(def.color, 0.5)
  const core = new THREE.Mesh(roundedBox(4.4, 0.5, 4.4, 0.15), coreMat)
  core.position.y = 1.15
  group.add(core)

  // A small grid of on-package blocks.
  const G = 5
  const COUNT = G * G
  const PITCH = 0.78
  const HALF = ((G - 1) * PITCH) / 2
  const mat = surface(0xffffff, { emissiveIntensity: 0.5, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const blocks = new THREE.InstancedMesh(roundedBox(0.55, 0.4, 0.55, 0.06), mat, COUNT)
  blocks.position.y = 1.35
  group.add(blocks)

  const base = new THREE.Color(def.color)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < COUNT; i++) {
    const gx = i % G
    const gz = (i / G) | 0
    dummy.position.set(gx * PITCH - HALF, 0, gz * PITCH - HALF)
    dummy.updateMatrix()
    blocks.setMatrixAt(i, dummy.matrix)
  }
  blocks.instanceMatrix.needsUpdate = true

  function update(_dt: number, s: SimState): void {
    const a = activityOf(s)
    coreMat.emissiveIntensity = 0.3 + a * 1.3
    for (let i = 0; i < COUNT; i++) {
      const b = 0.2 + a * (0.4 + 0.5 * Math.sin(s.t * 3 + i))
      color.copy(base).multiplyScalar(b)
      blocks.setColorAt(i, color)
    }
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true
  }

  return { group, update }
}
