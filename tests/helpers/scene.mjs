import assert from 'node:assert/strict'

export function disposeScene(root) {
  const resources = new Set()
  root.traverse((object) => {
    if (object.geometry) resources.add(object.geometry)
    for (const material of [object.material].flat().filter(Boolean)) resources.add(material)
    if (object.isInstancedMesh) resources.add(object)
  })
  for (const resource of resources) resource.dispose()
}

export function snapshotScene(root) {
  const values = []
  root.traverse((object) => {
    values.push(...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), object.visible)
    if (object.instanceMatrix) values.push(...object.instanceMatrix.array)
    if (object.instanceColor) values.push(...object.instanceColor.array)
    for (const material of [object.material].flat().filter(Boolean)) {
      values.push(material.opacity, material.emissiveIntensity ?? 0)
    }
  })
  return values
}

export function assertFiniteScene(root) {
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${object.name || object.type}: invalid world transform`)
    if (object.instanceMatrix) assert.ok(object.instanceMatrix.array.every(Number.isFinite), 'invalid instance transform')
    if (object.instanceColor) assert.ok(object.instanceColor.array.every(Number.isFinite), 'invalid instance color')
    const positions = object.geometry?.getAttribute('position')
    if (positions) assert.ok(positions.array.every(Number.isFinite), 'invalid geometry vertex')
  })
}