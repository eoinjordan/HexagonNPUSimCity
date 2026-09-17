import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { DistrictDef, SimState } from '../core/types'

/** What every district builder returns: a scene group and a per-frame update. */
export interface DistrictBuild {
  group: THREE.Group
  update(dt: number, s: SimState): void
}

/** A rounded chip-like box, reused for every structure in the city. */
export function roundedBox(w: number, h: number, d: number, radius = 0.14): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2))
}

/** Standard lit surface with a faint self-glow in its own colour. */
export function surface(
  color: number,
  opts: { metalness?: number; roughness?: number; emissiveIntensity?: number } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.5,
    emissive: color,
    emissiveIntensity: opts.emissiveIntensity ?? 0.12,
  })
}

/** Bright emissive material for edges, rims and dataflow accents. */
export function glow(color: number, intensity = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.35,
  })
}

/**
 * A district root group, positioned once and tagged for picking. Every mesh
 * placed inside is discovered by the picker climbing to this tagged ancestor.
 */
export function districtGroup(def: DistrictDef): THREE.Group {
  const g = new THREE.Group()
  g.name = def.id
  g.position.copy(def.pos)
  g.userData.districtId = def.id
  return g
}

/** A low plinth every district sits on, in the district's own colour. */
export function plinth(def: DistrictDef, w: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(roundedBox(w, 0.6, d, 0.2), surface(def.color, { emissiveIntensity: 0.18, roughness: 0.6 }))
  mesh.position.y = 0.3
  mesh.receiveShadow = true
  mesh.castShadow = true
  return mesh
}

/** A glowing outline ring sitting just above the plinth, for selection pop. */
export function rim(def: DistrictDef, w: number, d: number): THREE.LineSegments {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.62, d))
  const mat = new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.55 })
  const seg = new THREE.LineSegments(geo, mat)
  seg.position.y = 0.31
  return seg
}
