import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { checkReleaseVersion, checksum } from './release.mjs'
import { ASSET } from './deb.mjs'

test('release tags must match the package and Windows Installer version bounds', () => {
  assert.equal(checkReleaseVersion('v0.1.0', '0.1.0'), '0.1.0')
  for (const [tag, version] of [['main', '0.1.0'], ['v1.0.0', '0.1.0'], ['v0.1.0-beta', '0.1.0-beta'], ['v256.0.0', '256.0.0'], ['v1.2.65536', '1.2.65536']]) assert.throws(() => checkReleaseVersion(tag, version))
})

test('asset checksums match the standard SHA256 test vector and reject unsafe names', () => {
  assert.equal(checksum('asset.zip', Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  asset.zip')
  assert.throws(() => checksum('../asset.zip', Buffer.from('abc')))
  assert.throws(() => checksum('asset\n.zip', Buffer.from('abc')))
})
test('download names stay pinned, because QR codes already in circulation encode them', async () => {
  // Renaming any of these silently breaks every printed QR code and shared link.
  const pinned = [
    'HexagonNPUSimCity-arm64-cpu-preview.apk',
    'HexagonNPUSimCity-arm64.msi',
    'HexagonNPUSimCity-all.deb',
  ]
  const [getapp, release] = await Promise.all([
    readFile(new URL('../src/ui/getapp.ts', import.meta.url), 'utf8'),
    readFile(new URL('release.mjs', import.meta.url), 'utf8'),
  ])
  assert.ok(pinned.includes(ASSET), 'the Debian asset name must stay pinned')
  for (const name of pinned) {
    assert.ok(getapp.includes(`/latest/download/${name}`), `getapp.ts must link ${name}`)
    assert.ok(release.includes(`'${name}'`), `release.mjs must require ${name}`)
  }
  // `latest/download` resolves for any published release; a versioned URL would not.
  assert.doesNotMatch(getapp, /releases\/download\/v\d/, 'links must not pin a version')
})
