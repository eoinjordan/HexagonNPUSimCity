import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/**
 * VTCM — the shared memory plaza at the centre of the die. A raised deck carries
 * a grid of memory banks; the fraction of banks lit tracks how much of the
 * tightly-coupled memory currently holds live tiles. Everything else in the city
 * exists to fill these banks or drain them.
 */
const GRID = 16
const N = GRID * GRID
const PITCH = 1.02
const HALF = ((GRID - 1) * PITCH) / 2
const DECK_Y = 2.0

export function createVtcm(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  // Cantilevered deck.
  const deck = new THREE.Mesh(roundedBox(19, 1.4, 19, 0.4), surface(def.color, { emissiveIntensity: 0.16, roughness: 0.55 }))
  deck.position.y = DECK_Y - 0.7
  deck.castShadow = true
  deck.receiveShadow = true
  group.add(deck)

  // Memory banks.
  const cell = roundedBox(0.82, 1.2, 0.82, 0.12)
  const mat = surface(0xffffff, { emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.2 })
  mat.emissive = new THREE.Color(def.color)
  const banks = new THREE.InstancedMesh(cell, mat, N)
  banks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  banks.castShadow = true
  banks.position.y = DECK_Y
  group.add(banks)

  const base = new THREE.Color(def.color)
  const rng = makeRng(0x7a11)
  const threshold = new Float32Array(N)
  const px = new Float32Array(N)
  const pz = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const gx = i % GRID
    const gz = (i / GRID) | 0
    px[i] = gx * PITCH - HALF
    pz[i] = gz * PITCH - HALF
    // Banks near the centre fill first, with a little noise.
    const r = Math.hypot(px[i], pz[i]) / HALF
    threshold[i] = Math.min(1, r * 0.85 + rng() * 0.25)
  }

  // A central light column: shared memory literally lit from within.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.9, 6, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  )
  column.position.y = DECK_Y + 2.4
  group.add(column)

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const occ = s.vtcmOccupancy
    for (let i = 0; i < N; i++) {
      const lit = threshold[i] < occ
      const shimmer = lit ? 0.78 + 0.22 * Math.sin(s.t * 3 + i * 0.7) : 0.16
      const h = lit ? 1 + 1.6 * occ : 0.35
      dummy.position.set(px[i], (h * 1.2) / 2 - 0.6, pz[i])
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      banks.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(shimmer)
      banks.setColorAt(i, color)
    }
    banks.instanceMatrix.needsUpdate = true
    if (banks.instanceColor) banks.instanceColor.needsUpdate = true
    const m = column.material as THREE.MeshBasicMaterial
    m.opacity = 0.1 + 0.16 * occ
  }

  update(0, { vtcmOccupancy: 0.4, t: 0 } as SimState)
  return { group, update }
}
