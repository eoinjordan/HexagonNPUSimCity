import assert from 'node:assert/strict'
import test from 'node:test'
import { checkReleaseVersion, checksum } from './release.mjs'

test('release tags must match the package and Windows Installer version bounds', () => {
  assert.equal(checkReleaseVersion('v0.1.0', '0.1.0'), '0.1.0')
  for (const [tag, version] of [['main', '0.1.0'], ['v1.0.0', '0.1.0'], ['v0.1.0-beta', '0.1.0-beta'], ['v256.0.0', '256.0.0'], ['v1.2.65536', '1.2.65536']]) assert.throws(() => checkReleaseVersion(tag, version))
})

test('asset checksums match the standard SHA256 test vector and reject unsafe names', () => {
  assert.equal(checksum('asset.zip', Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  asset.zip')
  assert.throws(() => checksum('../asset.zip', Buffer.from('abc')))
  assert.throws(() => checksum('asset\n.zip', Buffer.from('abc')))
})