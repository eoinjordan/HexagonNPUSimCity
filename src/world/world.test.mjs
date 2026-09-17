import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createSim, PRECISIONS, WORKLOADS } from '../sim/model.ts'
import { districtGroup, glow, plinth, rim, roundedBox, surface } from './build.ts'
import { createCity } from './city.ts'
import { DISTRICTS, districtById } from './districts.ts'
import { createGround } from './ground.ts'
import { assertFiniteScene, disposeScene, snapshotScene } from '../../tests/helpers/scene.mjs'

test('district metadata has unique identities, finite positions and valid live readouts', () => {
  assert.equal(DISTRICTS.length, 8)
  assert.equal(new Set(DISTRICTS.map((district) => district.id)).size, DISTRICTS.length)
  assert.equal(districtById('unknown'), undefined)
  const sim = createSim()
  for (const workload of WORKLOADS) {
    sim.setWorkload(workload.id)
    sim.update(1 / 60)
    for (const district of DISTRICTS) {
      assert.equal(districtById(district.id), district)
      assert.ok(district.pos.toArray().every(Number.isFinite))
      assert.ok(district.name && district.subtitle && district.blurb)
      assert.ok(district.readout(sim.state).length > 0)
      assert.doesNotMatch(district.readout(sim.state), /NaN|Infinity|undefined/)
    }
  }
})

test('rounded geometry respects dimensions even when radius exceeds the box size', (context) => {
  const geometry = roundedBox(2, 4, 6, 100)
  context.after(() => geometry.dispose())
  geometry.computeBoundingBox()
  const size = geometry.boundingBox.getSize(new THREE.Vector3())
  assert.ok(size.distanceTo(new THREE.Vector3(2, 4, 6)) < 1e-5)
  assert.ok(geometry.getAttribute('position').array.every(Number.isFinite))
})

test('surface and glow preserve semantic colors and explicit material options', (context) => {
  const basic = surface(0x123456)
  const custom = surface(0xabcdef, { metalness: 0, roughness: 1, emissiveIntensity: 0 })
  const luminous = glow(0x123456, 2)
  context.after(() => [basic, custom, luminous].forEach((material) => material.dispose()))
  assert.equal(basic.color.getHex(), 0x123456)
  assert.equal(basic.metalness, 0.35)
  assert.equal(custom.metalness, 0)
  assert.equal(custom.roughness, 1)
  assert.equal(custom.emissiveIntensity, 0)
  assert.equal(luminous.emissive.getHex(), 0x123456)
  assert.equal(luminous.emissiveIntensity, 2)
})

test('district primitives use independent positions and retain picking metadata', (context) => {
  const district = districtById('tensor')
  const group = districtGroup(district)
  group.add(plinth(district, 12, 10), rim(district, 12, 10))
  context.after(() => disposeScene(group))
  assert.equal(group.userData.districtId, 'tensor')
  assert.deepEqual(group.position.toArray(), district.pos.toArray())
  assert.notEqual(group.position, district.pos)
  assert.equal(group.children[0].receiveShadow, true)
  assert.equal(group.children[0].castShadow, true)
  assert.equal(group.children[1].isLineSegments, true)
  assertFiniteScene(group)
})

test('ground connects only the three NPU compute engines to local memory', (context) => {
  const ground = createGround()
  context.after(() => disposeScene(ground))
  const rails = ground.children.filter((object) => object.geometry?.type === 'BoxGeometry')
  assert.equal(rails.length, 3)
  for (const id of ['scalar', 'vector', 'tensor']) {
    const position = districtById(id).pos
    assert.ok(rails.some((rail) => rail.position.x === position.x / 2 && rail.position.z === position.z / 2))
  }
  assertFiniteScene(ground)
})

test('city assembles every district exactly once with matching pickables and labels', (context) => {
  const city = createCity()
  context.after(() => disposeScene(city.object))
  assert.equal(city.pickables.length, DISTRICTS.length)
  assert.equal(city.labels.length, DISTRICTS.length)
  assert.equal(city.object.children.length, DISTRICTS.length + 1)
  for (const district of DISTRICTS) {
    const group = city.pickables.find((object) => object.userData.districtId === district.id)
    const label = city.labels.find((item) => item.id === district.id)
    assert.ok(group && group.children.length > 0, `missing builder: ${district.id}`)
    assert.equal(group.parent, city.object)
    assert.deepEqual(group.position.toArray(), district.pos.toArray())
    assert.equal(label.name, district.name)
    assert.equal(label.position.x, district.pos.x)
    assert.equal(label.position.z, district.pos.z)
    assert.ok(label.position.y > 0)
    assert.notEqual(label.position, district.pos)
  }
  assertFiniteScene(city.object)
})

test('every district remains finite across workloads and precisions without growing the scene', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  const originalIds = []
  city.object.traverse((object) => originalIds.push(object.uuid))
  for (const workload of WORKLOADS) {
    for (const precision of PRECISIONS) {
      sim.setWorkload(workload.id)
      sim.setPrecision(precision)
      for (let step = 0; step < 12; step++) {
        sim.update(1 / 60)
        city.update(1 / 60, sim.state)
      }
      assertFiniteScene(city.object)
    }
  }
  const updatedIds = []
  city.object.traverse((object) => updatedIds.push(object.uuid))
  assert.deepEqual(updatedIds, originalIds)
})

test('animation changes the world, while zero elapsed time and frozen state preserve it', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  city.update(0, sim.state)
  const initial = snapshotScene(city.object)
  for (let step = 0; step < 30; step++) {
    sim.update(1 / 60)
    city.update(1 / 60, sim.state)
  }
  assert.notDeepEqual(snapshotScene(city.object), initial)
  sim.togglePause()
  const paused = snapshotScene(city.object)
  city.update(0, sim.state)
  assert.deepEqual(snapshotScene(city.object), paused)
})

test('reset restores and replays all world animations, including scalar rotation', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  city.update(0, sim.state)
  const initial = snapshotScene(city.object)
  const advance = () => {
    for (let step = 0; step < 60; step++) {
      sim.update(1 / 60)
      city.update(1 / 60, sim.state)
    }
  }
  advance()
  const firstRun = snapshotScene(city.object)
  sim.reset()
  city.update(0, sim.state)
  assert.deepEqual(snapshotScene(city.object), initial)
  advance()
  assert.deepEqual(snapshotScene(city.object), firstRun)
})