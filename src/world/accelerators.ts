import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * The three fused accelerators. Each reads its own utilisation from the sim and
 * shows it as motion: the scalar scheduler spins, HVX lanes ripple, and the HMX
 * array runs a systolic wave. Fusing these three around VTCM is the NPU's whole
 * trick.
 * ==========================================================================*/

/** Scalar accelerator: a control tower with a spinning scheduler ring. */
export function createScalar(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const heights = [3.2, 2.4, 1.8]
  let y = 0.6
  for (let i = 0; i < heights.length; i++) {
    const w = 5 - i * 1.1
    const box = new THREE.Mesh(roundedBox(w, heights[i], w, 0.2), surface(def.color, { emissiveIntensity: 0.16 }))
    box.position.y = y + heights[i] / 2
    box.castShadow = true
    group.add(box)
    y += heights[i]
  }

  const ringMat = glow(def.color, 0.8)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 12, 40), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = y + 0.6
  group.add(ring)

  let previousTime = 0
  function update(dt: number, s: SimState): void {
    if (s.t < previousTime || s.t === 0) ring.rotation.z = 0
    if (s.t > previousTime) ring.rotation.z += dt * (0.4 + s.util.scalar * 5)
    previousTime = s.t
    ringMat.emissiveIntensity = 0.4 + s.util.scalar * 1.4
  }

  return { group, update }
}

/** HVX vector engine: a bank of SIMD lanes that ripple as they process. */
export function createVector(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const COLS = 8
  const ROWS = 4
  const COUNT = COLS * ROWS
  const PITCH = 1.15
  const geo = roundedBox(0.7, 1, 0.7, 0.1)
  const mat = surface(0xffffff, { emissiveIntensity: 0.55, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const lanes = new THREE.InstancedMesh(geo, mat, COUNT)
  lanes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  lanes.castShadow = true
  group.add(lanes)

  const base = new THREE.Color(def.color)
  const px = new Float32Array(COUNT)
  const pz = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    const c = i % COLS
    const r = (i / COLS) | 0
    px[i] = c * PITCH - ((COLS - 1) * PITCH) / 2
    pz[i] = r * PITCH - ((ROWS - 1) * PITCH) / 2
  }

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const u = s.util.vector
    for (let i = 0; i < COUNT; i++) {
      const c = i % COLS
      // A wave travelling along the lanes; amplitude scales with utilisation.
      const wave = 0.5 + 0.5 * Math.sin(s.t * 4 - c * 0.7)
      const h = 0.6 + u * (1.5 + wave * 3.2)
      dummy.position.set(px[i], (h * 1) / 2, pz[i])
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      lanes.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(0.25 + u * wave * 0.85)
      lanes.setColorAt(i, color)
    }
    lanes.instanceMatrix.needsUpdate = true
    if (lanes.instanceColor) lanes.instanceColor.needsUpdate = true
  }

  update(0, { util: { vector: 0.4 }, t: 0 } as SimState)
  return { group, update }
}

/** HMX tensor engine: the MAC array, running a systolic wave of accumulation. */
export function createTensor(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const G = 12
  const COUNT = G * G
  const PITCH = 0.92
  const HALF = ((G - 1) * PITCH) / 2

  // A gantry frame around the array.
  const frameMat = surface(def.color, { emissiveIntensity: 0.22, roughness: 0.5 })
  const frame = new THREE.Mesh(roundedBox(G * PITCH + 2, 0.7, G * PITCH + 2, 0.3), frameMat)
  frame.position.y = 0.35
  frame.receiveShadow = true
  group.add(frame)

  const geo = roundedBox(0.66, 0.5, 0.66, 0.08)
  const mat = surface(0xffffff, { emissiveIntensity: 0.6, roughness: 0.35 })
  mat.emissive = new THREE.Color(def.color)
  const cells = new THREE.InstancedMesh(geo, mat, COUNT)
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  cells.castShadow = true
  cells.position.y = 0.9
  group.add(cells)

  const base = new THREE.Color(def.color)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const u = s.util.tensor
    // Diagonal wavefront sweeping the array — a stand-in for systolic dataflow.
    const front = (s.t * 6) % (G * 2)
    for (let i = 0; i < COUNT; i++) {
      const gx = i % G
      const gz = (i / G) | 0
      const d = Math.abs(gx + gz - front)
      const active = Math.max(0, 1 - d * 0.55) * u
      const h = 0.4 + active * 2.4
      dummy.position.set(gx * PITCH - HALF, (h * 0.5) / 2, gz * PITCH - HALF)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      cells.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(0.18 + active * 0.95)
      cells.setColorAt(i, color)
    }
    cells.instanceMatrix.needsUpdate = true
    if (cells.instanceColor) cells.instanceColor.needsUpdate = true
    frameMat.emissiveIntensity = 0.18 + u * 0.5
  }

  update(0, { util: { tensor: 0.6 }, t: 0 } as SimState)
  return { group, update }
}
