import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/**
 * The sensing hub and power district. Always-on, low-power silicon that wakes
 * the big engines only when there is work — the efficiency that lets generative
 * AI run on-device, on battery. It breathes slowly at idle and lifts a little
 * when the NPU is busy.
 */
export function createSensors(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)
  const rng = makeRng(0x53454e53)

  const pad = new THREE.Mesh(roundedBox(8, 0.4, 8, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const pillarMat = surface(def.color, { emissiveIntensity: 0.3, roughness: 0.4 })
  const pillars: THREE.Mesh[] = []
  const spots = [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [0, 0],
  ]
  for (const [x, z] of spots) {
    const h = 1.4 + rng() * 0.8
    const p = new THREE.Mesh(roundedBox(1.1, h, 1.1, 0.2), pillarMat.clone())
    p.position.set(x, 0.4 + h / 2, z)
    p.castShadow = true
    group.add(p)
    pillars.push(p)
  }

  // Always-on beacon.
  const beaconMat = glow(def.color, 0.9)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), beaconMat)
  beacon.position.y = 4
  group.add(beacon)

  function update(_dt: number, s: SimState): void {
    const wake = s.workload === 'idle' ? 0.15 : 0.5
    const breathe = 0.5 + 0.5 * Math.sin(s.t * 1.4)
    beaconMat.emissiveIntensity = 0.4 + (wake + breathe * 0.3) * 1.1
    beacon.position.y = 4 + breathe * 0.3
    for (let i = 0; i < pillars.length; i++) {
      const m = pillars[i].material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.18 + (wake * 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(s.t * 1.4 + i)))
    }
  }

  return { group, update }
}
