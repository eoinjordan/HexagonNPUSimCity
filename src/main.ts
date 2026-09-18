import * as THREE from 'three'

import './styles/tokens.css'
import './styles/ui.css'
import './styles/quantization.css'

import { createBus } from './core/bus'
import type { DistrictId, Precision, WorkloadId } from './core/types'
import { reduceMotion } from './core/util'

import { createRenderer } from './engine/renderer'
import { createCameraRig } from './engine/camera'
import { createLabels } from './engine/labels'
import { createFlows } from './engine/flows'
import { createPicker } from './engine/picker'

import { createSim } from './sim/model'
import { createClock } from './sim/clock'
import { createRuntimePanel } from './runtime/panel'
import { createAppLabBridge, createAppLabPanel } from './runtime/applab'

import { createCity } from './world/city'
import { districtById } from './world/districts'

import { createHud } from './ui/hud'
import { createInspector } from './ui/panel'
import { createTour } from './ui/tour'
import { createHelp } from './ui/help'
import { createControls } from './ui/controls'
import { createSettings } from './ui/settings'
import { createGetApp } from './ui/getapp'
import { el } from './ui/dom'

/* ============================================================================
 * HexagonNPUSimCity — boot.
 *
 * Order: renderer -> scene/lights -> camera -> world -> flows -> sim -> UI.
 * The world only reads simulation state; the UI only talks to the world through
 * the bus. A single fixed-step clock owns simulation time (see sim/clock.ts).
 * ==========================================================================*/

type ThemeMode = 'day' | 'night'
interface Atmosphere {
  background: number
  fog: number
  fogNear: number
  fogFar: number
  hemiSky: number
  hemiGround: number
  ambient: number
  key: number
}
const NIGHT: Atmosphere = {
  background: 0x05070e, fog: 0x05070e, fogNear: 90, fogFar: 300,
  hemiSky: 0x25406e, hemiGround: 0x05070e, ambient: 0.55, key: 1.15,
}
const DAY: Atmosphere = {
  background: 0xcfe0ee, fog: 0xcfe0ee, fogNear: 120, fogFar: 360,
  hemiSky: 0xdcebff, hemiGround: 0x9fb4cf, ambient: 0.9, key: 1.4,
}

const boot = document.getElementById('boot')
const bootFill = document.getElementById('boot-fill')
const bootStatus = document.getElementById('boot-status')
function setBoot(pct: number, msg: string): void {
  if (bootFill) bootFill.style.width = `${pct}%`
  if (bootStatus) bootStatus.textContent = msg
}

const canvasRoot = document.getElementById('canvas-root')!
const stage = document.getElementById('stage')!

setBoot(20, 'starting renderer…')
const renderer = createRenderer(canvasRoot)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000)

const hemi = new THREE.HemisphereLight(0xffffff, 0x223044, 0.6)
const key = new THREE.DirectionalLight(0xffffff, 1.1)
key.position.set(42, 74, 34)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
const shadowCam = key.shadow.camera as THREE.OrthographicCamera
shadowCam.left = -80
shadowCam.right = 80
shadowCam.top = 80
shadowCam.bottom = -80
shadowCam.near = 1
shadowCam.far = 280
key.shadow.bias = -0.0004
scene.add(hemi, key, key.target)

let themeMode: ThemeMode = 'night'
try {
  const stored = localStorage.getItem('hexsimcity.theme')
  if (stored === 'day' || stored === 'night') themeMode = stored
} catch {
  /* storage may be unavailable */
}
function applyTheme(): void {
  const a = themeMode === 'day' ? DAY : NIGHT
  scene.background = new THREE.Color(a.background)
  scene.fog = new THREE.Fog(a.fog, a.fogNear, a.fogFar)
  hemi.color.setHex(a.hemiSky)
  hemi.groundColor.setHex(a.hemiGround)
  hemi.intensity = a.ambient
  key.intensity = a.key
  document.documentElement.dataset.theme = themeMode
  try {
    localStorage.setItem('hexsimcity.theme', themeMode)
  } catch {
    /* ignore */
  }
}
applyTheme()

setBoot(45, 'building the NPU…')
const rig = createCameraRig(camera, renderer.domElement)
const labels = createLabels(stage, scene)
const city = createCity()
scene.add(city.object)
const flows = createFlows()
scene.add(flows.object)

// District labels, plus two bits of system context outside the NPU.
for (const l of city.labels) {
  const parts = l.name.split('·')
  const div = el('div', { class: 'label' })
  const shortNames: Record<DistrictId, string> = { vtcm: 'VTCM', scalar: 'Scalar', vector: 'HVX', tensor: 'HMX', microtile: 'Tiles', cpu: 'CPU', gpu: 'GPU', sensors: 'Sensing' }
  div.append(
    el('span', { class: 'label-full', html: `<b>${parts[0].trim()}</b>${parts[1] ? ` ${parts[1].trim()}` : ''}` }),
    el('span', { class: 'label-short', text: shortNames[l.id] }),
  )
  labels.add(div, l.position)
}
labels.add(el('div', { class: 'label label-ctx', text: 'System memory' }), new THREE.Vector3(0, 4.4, -46))
labels.add(el('div', { class: 'label label-ctx', text: 'System DRAM' }), new THREE.Vector3(0, 3.2, 52))

setBoot(70, 'wiring controls…')
const sim = createSim()
const bus = createBus()
const hud = createHud({ bus, initial: sim.state })
const inspector = createInspector(bus)
const tour = createTour(bus)
const help = createHelp(bus)
const settings = createSettings(bus, sim)
const getApp = createGetApp()
const runtimePanel = createRuntimePanel(document.getElementById('hud')!, fetch, bus)

// A ring that sits under the selected district.
const ringMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, transparent: true, opacity: 0.9,
})
const selRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 12, 64), ringMat)
selRing.rotation.x = Math.PI / 2
selRing.visible = false
scene.add(selRing)

function selectDistrict(id: string): void {
  const d = districtById(id)
  if (!d) {
    deselect()
    return
  }
  inspector.show(d)
  ringMat.color.setHex(d.color)
  ringMat.emissive.setHex(d.color)
  const r = d.id === 'vtcm' ? 13 : 8
  selRing.scale.set(r, r, r)
  selRing.position.set(d.pos.x, 0.6, d.pos.z)
  selRing.visible = true
}
function deselect(): void {
  inspector.hide()
  selRing.visible = false
}

createPicker({
  dom: renderer.domElement,
  camera,
  pickables: city.pickables,
  onPick: (id) => bus.emit('district:select', { id: id as DistrictId | null }),
  onHover: () => {},
})

bus.on('workload:change', ({ id }) => sim.setWorkload(id as WorkloadId))
bus.on('precision:change', ({ value }) => sim.setPrecision(value as Precision))
bus.on('district:select', ({ id }) => (id ? selectDistrict(id) : deselect()))
bus.on('camera:focus', ({ id }) => {
  const d = districtById(id)
  if (d) rig.focus(new THREE.Vector3(d.pos.x, 3, d.pos.z), d.id === 'vtcm' ? 52 : 32)
})
bus.on('camera:home', () => rig.home())
bus.on('pause:toggle', () => {
  sim.togglePause()
  hud.setPaused(sim.state.paused)
})

// Live measurements from an Arduino App Lab host embedding this page.
const appLabPanel = createAppLabPanel(runtimePanel)
createAppLabBridge({
  onSample: (sample) => {
    appLabPanel.show(sample)
    bus.emit('precision:change', { value: sample.precision })
  },
})
bus.on('theme:toggle', () => {
  themeMode = themeMode === 'day' ? 'night' : 'day'
  applyTheme()
})
bus.on('help:toggle', () => help.toggle())
bus.on('settings:toggle', () => settings.toggle())
bus.on('getapp:toggle', () => getApp.toggle())
bus.on('tour:toggle', () => tour.toggle())
bus.on('reset', () => {
  sim.reset()
  flows.reset()
  clock.reset()
  city.update(0, sim.state)
  flows.update(0, sim.state)
  rig.home()
  deselect()
  hud.setPaused(false)
})

createControls(bus, () => {
  if (getApp.open) getApp.close()
  else if (settings.open) settings.close()
  else if (help.open) help.close()
  else if (tour.active) tour.stop()
  else deselect()
})

function resize(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  labels.setSize(w, h)
}
window.addEventListener('resize', resize)
resize()

// One fixed-step owner of simulation time. A returning background tab must not
// dump a huge catch-up in at once, so drop the accumulated gap on re-show.
city.update(0, sim.state)
flows.update(0, sim.state)
const clock = createClock((step) => {
  sim.update(step)
  if (!reduceMotion()) {
    city.update(step, sim.state)
    flows.update(step, sim.state)
  }
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clock.reset()
    last = performance.now()
  }
})

let last = performance.now()
let booted = false
function frame(now: number): void {
  requestAnimationFrame(frame)
  const running = !sim.state.paused && !document.hidden
  clock.advance(now, running)

  let wall = (now - last) / 1000
  last = now
  if (!Number.isFinite(wall) || wall < 0) wall = 0
  wall = Math.min(wall, 0.1)
  rig.update(wall)
  if (selRing.visible && running && !reduceMotion()) selRing.rotation.z = sim.state.t * 0.6
  hud.update(sim.state)
  inspector.update(sim.state)

  labels.render(scene, camera)
  renderer.render(scene, camera)

  if (!booted) {
    booted = true
    setBoot(100, 'ready')
    if (boot) {
      boot.classList.add('done')
      setTimeout(() => boot.remove(), 600)
    }
  }
}
requestAnimationFrame(frame)
