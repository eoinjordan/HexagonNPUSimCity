import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState } from '../core/types'
import { reduceMotion } from '../core/util'
import { districtById } from '../world/districts'

/**
 * The dataflow. Colour is meaning: cyan is activations moving through the fused
 * compute loop (VTCM -> HVX -> HMX -> VTCM), orange is model weights streaming
 * in through the micro-tile yard, and each engine's own colour marks its control
 * or hand-off traffic. Particle speed tracks the matching utilisation, so a busy
 * tensor engine visibly pulls harder on the activation loop.
 */
interface FlowSpec {
  color: number
  points: THREE.Vector3[]
  count: number
  size: number
  speedOf: (s: SimState) => number
}

interface Flow {
  curve: THREE.CatmullRomCurve3
  mesh: THREE.InstancedMesh
  count: number
  size: number
  phase: number
  speedOf: (s: SimState) => number
}

function pos(id: string, y: number): THREE.Vector3 {
  return districtById(id)!.pos.clone().setY(y)
}

export interface FlowField {
  object: THREE.Group
  update(dt: number, s: SimState): void
  reset(): void
}

export function createFlows(): FlowField {
  const object = new THREE.Group()

  const specs: FlowSpec[] = [
    // Activations loop through the fused accelerators, arcing over VTCM.
    {
      color: COLOR.activation,
      count: 22,
      size: 0.42,
      speedOf: (s) => 0.2 + s.util.tensor,
      points: [pos('vtcm', 3), pos('vector', 3), new THREE.Vector3(0, 8, 0), pos('tensor', 3), pos('vtcm', 3)],
    },
    // Weights stream up from system memory through the micro-tile yard.
    {
      color: COLOR.weight,
      count: 16,
      size: 0.4,
      speedOf: (s) => 0.15 + s.vtcmOccupancy * 0.9,
      points: [new THREE.Vector3(0, 1.5, 52), pos('microtile', 2), new THREE.Vector3(0, 4, 12), pos('vtcm', 3)],
    },
    // Scalar control traffic.
    {
      color: COLOR.scalar,
      count: 10,
      size: 0.32,
      speedOf: (s) => 0.15 + s.util.scalar * 0.9,
      points: [pos('scalar', 3), new THREE.Vector3(0, 6, -12), pos('vtcm', 3)],
    },
    // NPU results staged out to system memory — leaving the NPU-local pool.
    {
      color: 0x8aa0c0,
      count: 10,
      size: 0.32,
      speedOf: (s) => 0.12 + s.util.tensor * 0.5,
      points: [pos('vtcm', 3), new THREE.Vector3(0, 5, -16), new THREE.Vector3(0, 2.6, -46)],
    },
    // Host CPU reads results FROM system memory: it is outside the NPU and does
    // not consume the VTCM pool directly.
    {
      color: COLOR.cpu,
      count: 7,
      size: 0.3,
      speedOf: (s) => (s.workload === 'idle' ? 0.05 : 0.3),
      points: [new THREE.Vector3(0, 2.6, -46), new THREE.Vector3(-14, 3.4, -34), pos('cpu', 2.2)],
    },
    // Adreno GPU likewise reads from system memory, not from VTCM.
    {
      color: COLOR.gpu,
      count: 7,
      size: 0.3,
      speedOf: (s) => 0.1 + s.util.vector * 0.4,
      points: [new THREE.Vector3(0, 2.6, -46), new THREE.Vector3(14, 3.4, -34), pos('gpu', 2.2)],
    },
  ]

  const flows: Flow[] = specs.map((spec, fi) => {
    const curve = new THREE.CatmullRomCurve3(spec.points, false, 'catmullrom', 0.5)
    const geo = new THREE.SphereGeometry(spec.size, 12, 12)
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.color,
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.3,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, spec.count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    object.add(mesh)
    // Deterministic phase spread so a reset reproduces the same animation.
    return { curve, mesh, count: spec.count, size: spec.size, phase: fi * 0.13, speedOf: spec.speedOf }
  })

  const dummy = new THREE.Object3D()

  function reset(): void {
    for (let fi = 0; fi < flows.length; fi++) flows[fi].phase = fi * 0.13
  }

  function update(dt: number, s: SimState): void {
    // Re-checked each frame so a runtime change to the motion preference is honoured.
    const still = reduceMotion()
    for (const flow of flows) {
      if (!still) flow.phase = (flow.phase + flow.speedOf(s) * dt * 0.12) % 1
      for (let i = 0; i < flow.count; i++) {
        const frac = (flow.phase + i / flow.count) % 1
        const p = flow.curve.getPointAt(frac)
        // A gentle size pulse so packets read as moving even when slow.
        const pulse = 0.8 + 0.35 * Math.sin(s.t * 6 + i)
        dummy.position.copy(p)
        dummy.scale.setScalar(pulse)
        dummy.updateMatrix()
        flow.mesh.setMatrixAt(i, dummy.matrix)
      }
      flow.mesh.instanceMatrix.needsUpdate = true
    }
  }

  update(0, { util: { scalar: 0.3, vector: 0.5, tensor: 0.7 }, vtcmOccupancy: 0.5, t: 0, workload: 'llm-decode' } as SimState)
  return { object, update, reset }
}
