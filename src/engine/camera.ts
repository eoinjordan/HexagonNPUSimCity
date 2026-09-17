import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clamp01 } from '../core/util'

/** The default establishing shot: a three-quarter view over the whole die. */
const HOME_POS = new THREE.Vector3(48, 42, 66)
const HOME_TARGET = new THREE.Vector3(0, 2, 0)

export interface CameraRig {
  controls: OrbitControls
  /** Glide to frame a point in the world at a comfortable distance. */
  focus(target: THREE.Vector3, distance?: number): void
  /** Return to the establishing shot. */
  home(): void
  update(dt: number): void
}

interface Tween {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  t: number
  dur: number
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 14
  controls.maxDistance = 170
  controls.maxPolarAngle = Math.PI * 0.49
  controls.target.copy(HOME_TARGET)
  camera.position.copy(HOME_POS)
  controls.update()

  let tween: Tween | null = null

  function glide(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
    tween = {
      fromPos: camera.position.clone(),
      toPos: toPos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      t: 0,
      dur: 0.9,
    }
  }

  function focus(target: THREE.Vector3, distance = 34): void {
    // Keep the current viewing direction but pull in to the chosen district.
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target)
    dir.y = Math.max(dir.y, distance * 0.45) // never dive below the die
    dir.normalize()
    const toPos = target.clone().add(dir.multiplyScalar(distance))
    glide(toPos, target)
  }

  function home(): void {
    glide(HOME_POS, HOME_TARGET)
  }

  function update(dt: number): void {
    if (tween) {
      tween.t += dt / tween.dur
      const k = easeInOut(clamp01(tween.t))
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k)
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k)
      if (tween.t >= 1) tween = null
    }
    controls.update()
  }

  return { controls, focus, home, update }
}
