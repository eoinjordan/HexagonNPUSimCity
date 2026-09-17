import * as THREE from 'three'

export interface PickerOptions {
  dom: HTMLElement
  camera: THREE.Camera
  pickables: THREE.Object3D[]
  onPick: (id: string | null) => void
  onHover: (id: string | null) => void
}

export interface Picker {
  dispose(): void
}

/** Find the tagged district ancestor of a hit object, if any. */
function districtOf(obj: THREE.Object3D | null): string | null {
  let node: THREE.Object3D | null = obj
  while (node) {
    const id = node.userData?.districtId
    if (typeof id === 'string') return id
    node = node.parent
  }
  return null
}

/**
 * Turns clicks into district selections and hovers into highlights. A small
 * movement threshold on pointer-up keeps orbit drags from registering as clicks.
 */
export function createPicker(opts: PickerOptions): Picker {
  const { dom, camera, pickables, onPick, onHover } = opts
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let downX = 0
  let downY = 0
  let hovered: string | null = null

  function toNdc(e: PointerEvent): void {
    const rect = dom.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  function hit(): string | null {
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(pickables, true)
    return hits.length ? districtOf(hits[0].object) : null
  }

  function onMove(e: PointerEvent): void {
    toNdc(e)
    const id = hit()
    if (id !== hovered) {
      hovered = id
      dom.style.cursor = id ? 'pointer' : ''
      onHover(id)
    }
  }

  function onDown(e: PointerEvent): void {
    downX = e.clientX
    downY = e.clientY
  }

  function onUp(e: PointerEvent): void {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return // was a drag
    toNdc(e)
    onPick(hit())
  }

  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointerup', onUp)

  return {
    dispose() {
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointerup', onUp)
    },
  }
}
