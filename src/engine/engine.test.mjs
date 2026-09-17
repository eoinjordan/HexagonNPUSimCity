import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { reduceMotion } from '../core/util.ts'
import { createSim } from '../sim/model.ts'
import { createCameraRig } from './camera.ts'
import { createFlows } from './flows.ts'
import { createLabels } from './labels.ts'
import { createPicker } from './picker.ts'
import { installDom, pointer } from '../../tests/helpers/dom.mjs'
import { assertFiniteScene, disposeScene, snapshotScene } from '../../tests/helpers/scene.mjs'

function cameraFixture(context) {
  const environment = installDom({ html: '<canvas></canvas>' })
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500)
  const rig = createCameraRig(camera, environment.document.querySelector('canvas'))
  context.after(() => {
    rig.controls.dispose()
    environment.cleanup()
  })
  return { camera, rig }
}

function pickerFixture(context) {
  const environment = installDom({ html: '<canvas></canvas>' })
  const canvas = environment.document.querySelector('canvas')
  canvas.getBoundingClientRect = () => ({ left: 30, top: 20, width: 200, height: 200, right: 230, bottom: 220 })
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 5
  camera.updateMatrixWorld(true)
  const group = new THREE.Group()
  group.userData.districtId = 'tensor'
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  group.updateMatrixWorld(true)
  const picks = []
  const hovers = []
  const picker = createPicker({ dom: canvas, camera, pickables: [group], onPick: (id) => picks.push(id), onHover: (id) => hovers.push(id) })
  context.after(() => {
    picker.dispose()
    disposeScene(group)
    environment.cleanup()
  })
  const send = (type, clientX = 130, clientY = 120, options) => pointer(environment.window, canvas, type, clientX, clientY, options)
  return { canvas, picks, hovers, picker, send }
}

test('camera initializes above the floor with bounded orbit controls', (context) => {
  const { camera, rig } = cameraFixture(context)
  assert.ok(camera.position.distanceTo(new THREE.Vector3(48, 42, 66)) < 1e-8)
  assert.deepEqual(rig.controls.target.toArray(), [0, 2, 0])
  assert.equal(rig.controls.minDistance, 14)
  assert.equal(rig.controls.maxDistance, 170)
  assert.ok(rig.controls.maxPolarAngle < Math.PI / 2)
})

test('camera focus interpolates, copies its target, and reaches the requested distance', (context) => {
  const { camera, rig } = cameraFixture(context)
  const target = new THREE.Vector3(26, 2, 0)
  const expected = target.clone()
  const initial = camera.position.clone()
  rig.focus(target, 40)
  target.x = 999
  rig.update(0)
  assert.ok(camera.position.distanceTo(initial) < 1e-8)
  rig.update(0.45)
  assert.ok(rig.controls.target.distanceTo(expected) > 0)
  rig.update(0.45)
  assert.ok(rig.controls.target.distanceTo(expected) < 1e-8)
  assert.ok(Math.abs(camera.position.distanceTo(expected) - 40) < 1e-8)
  assert.ok(camera.position.y > expected.y)
})

test('camera retargeting replaces an active transition and home restores the establishing shot', (context) => {
  const { camera, rig } = cameraFixture(context)
  rig.focus(new THREE.Vector3(26, 0, 0))
  rig.update(0.2)
  const latest = new THREE.Vector3(-26, 0, 0)
  rig.focus(latest)
  rig.update(1)
  assert.ok(rig.controls.target.distanceTo(latest) < 1e-8)
  rig.home()
  rig.update(1)
  assert.ok(camera.position.distanceTo(new THREE.Vector3(48, 42, 66)) < 1e-8)
  assert.ok(rig.controls.target.distanceTo(new THREE.Vector3(0, 2, 0)) < 1e-8)
})

test('picker raycasts through a tagged ancestor using canvas-relative coordinates', (context) => {
  const { send, picks } = pickerFixture(context)
  send('pointerdown')
  send('pointerup')
  send('pointerdown', 31, 21)
  send('pointerup', 31, 21)
  assert.deepEqual(picks, ['tensor', null])
})

test('picker separates orbit drags from clicks and suppresses duplicate hover events', (context) => {
  const { send, picks, hovers, canvas } = pickerFixture(context)
  send('pointerdown')
  send('pointerup', 150, 120)
  assert.deepEqual(picks, [])
  send('pointermove')
  send('pointermove')
  assert.deepEqual(hovers, ['tensor'])
  assert.equal(canvas.style.cursor, 'pointer')
  send('pointermove', 31, 21)
  assert.deepEqual(hovers, ['tensor', null])
  assert.equal(canvas.style.cursor, '')
})

test('picker dispose removes selection and hover listeners', (context) => {
  const { picker, send, picks, hovers } = pickerFixture(context)
  picker.dispose()
  picker.dispose()
  send('pointerdown')
  send('pointerup')
  send('pointermove')
  assert.deepEqual(picks, [])
  assert.deepEqual(hovers, [])
})

test('label layer sizes, projects, clips and removes labels with their scene objects', (context) => {
  const environment = installDom({ html: '<div id="labels"></div>' })
  context.after(environment.cleanup)
  const container = environment.document.getElementById('labels')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 400 / 240, 0.1, 100)
  camera.position.z = 5
  camera.updateMatrixWorld(true)
  const labels = createLabels(container, scene)
  labels.setSize(400, 240)
  assert.equal(container.firstElementChild.style.width, '400px')
  assert.equal(container.firstElementChild.style.height, '240px')
  assert.equal(container.firstElementChild.style.pointerEvents, 'none')
  const element = environment.document.createElement('span')
  element.textContent = 'Tensor'
  const position = new THREE.Vector3()
  const label = labels.add(element, position)
  assert.notEqual(label.position, position)
  labels.render(scene, camera)
  assert.ok(container.contains(element))
  assert.equal(element.style.display, '')
  assert.match(element.style.transform, /200px,120px/)
  label.position.z = 10
  labels.render(scene, camera)
  assert.equal(element.style.display, 'none')
  label.removeFromParent()
  assert.equal(container.contains(element), false)
})

test('flow field uses finite, bounded instanced meshes and actually moves', (context) => {
  const environment = installDom()
  const field = createFlows()
  const sim = createSim()
  context.after(() => {
    disposeScene(field.object)
    environment.cleanup()
  })
  assert.ok(field.object.children.length > 0)
  assert.ok(field.object.children.every((object) => object.isInstancedMesh && object.count > 0 && object.count <= 100))
  const count = field.object.children.length
  const initial = snapshotScene(field.object)
  for (let step = 0; step < 60; step++) {
    sim.update(1 / 60)
    field.update(1 / 60, sim.state)
  }
  assert.equal(field.object.children.length, count)
  assertFiniteScene(field.object)
  assert.notDeepEqual(snapshotScene(field.object), initial)
  sim.togglePause()
  const paused = snapshotScene(field.object)
  field.update(0, sim.state)
  assert.deepEqual(snapshotScene(field.object), paused)
})

test('initial reduced motion stops packet travel and the preference helper reflects changes', (context) => {
  const environment = installDom({ reducedMotion: true })
  const field = createFlows()
  const sim = createSim()
  context.after(() => {
    disposeScene(field.object)
    environment.cleanup()
  })
  const positions = () => field.object.children.flatMap((mesh) => {
    const result = []
    for (let instance = 0; instance < mesh.count; instance++) {
      result.push(...mesh.instanceMatrix.array.slice(instance * 16 + 12, instance * 16 + 15))
    }
    return result
  })
  const initial = positions()
  sim.update(0.1)
  field.update(0.1, sim.state)
  assert.deepEqual(positions(), initial)
  assert.equal(reduceMotion(), true)
  environment.setReducedMotion(false)
  assert.equal(reduceMotion(), false)
})

test('flow reset and seeded initialization reproduce the same simulation sequence', (context) => {
  const environment = installDom()
  const field = createFlows()
  const sim = createSim()
  context.after(() => { disposeScene(field.object); environment.cleanup() })
  field.update(0, sim.state)
  const initial = snapshotScene(field.object)
  const advance = () => {
    for (let step = 0; step < 60; step++) {
      sim.update(1 / 60)
      field.update(1 / 60, sim.state)
    }
  }
  advance()
  const firstRun = snapshotScene(field.object)
  sim.setWorkload('idle')
  advance()
  sim.reset()
  field.reset()
  field.update(0, sim.state)
  assert.deepEqual(snapshotScene(field.object), initial)
  advance()
  assert.deepEqual(snapshotScene(field.object), firstRun)
})