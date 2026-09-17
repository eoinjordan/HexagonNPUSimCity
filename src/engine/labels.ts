import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

export interface LabelLayer {
  add(el: HTMLElement, position: THREE.Vector3): CSS2DObject
  setSize(w: number, h: number): void
  render(scene: THREE.Scene, camera: THREE.Camera): void
}

/** A CSS2D overlay that paints DOM labels at world positions, over the canvas. */
export function createLabels(container: HTMLElement, scene: THREE.Scene): LabelLayer {
  const renderer = new CSS2DRenderer()
  renderer.setSize(window.innerWidth, window.innerHeight)
  const el = renderer.domElement
  el.style.position = 'absolute'
  el.style.top = '0'
  el.style.left = '0'
  el.style.pointerEvents = 'none'
  container.appendChild(el)

  return {
    add(html: HTMLElement, position: THREE.Vector3): CSS2DObject {
      const obj = new CSS2DObject(html)
      obj.position.copy(position)
      scene.add(obj)
      return obj
    },
    setSize(w: number, h: number): void {
      renderer.setSize(w, h)
    },
    render(s: THREE.Scene, camera: THREE.Camera): void {
      renderer.render(s, camera)
    },
  }
}
