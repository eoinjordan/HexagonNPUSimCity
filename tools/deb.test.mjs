import assert from 'node:assert/strict'
import test from 'node:test'
import { ASSET, PACKAGE, controlFile, debianVersion, desktopEntry, launcher } from './deb.mjs'

test('the package is architecture independent so one build installs on an arm64 Pi', () => {
  const control = controlFile('1.0.0', 4096)
  assert.match(control, /^Architecture: all$/m)
  assert.match(control, /^Package: hexagon-npu-simcity$/m)
  assert.match(control, /^Version: 1\.0\.0-1$/m)
  assert.match(control, /^Installed-Size: 4096$/m)
  // python3 ships in Ubuntu's base install; anything heavier would not be "easiest".
  assert.match(control, /^Depends: python3 \(>= 3\.8\)$/m)
  assert.ok(control.endsWith('\n'))
})

test('control metadata keeps the non-affiliation notice', () => {
  const control = controlFile('1.0.0', 1)
  assert.match(control, /not hardware measurements/)
  assert.match(control, /Not affiliated with, sponsored by or/)
})

test('versions are validated and given a Debian revision', () => {
  assert.equal(debianVersion('0.1.0'), '0.1.0-1')
  assert.equal(debianVersion('12.34.56'), '12.34.56-1')
  for (const bad of ['1.0', '1.0.0-rc1', 'v1.0.0', '01.0.0', '']) {
    assert.throws(() => debianVersion(bad), /MAJOR\.MINOR\.PATCH/)
  }
  assert.throws(() => controlFile('1.0.0', 0), /positive integer/)
  assert.throws(() => controlFile('1.0.0', 1.5), /positive integer/)
})

test('the launcher binds loopback only and never leaves the server running', () => {
  const script = launcher(8770)
  assert.match(script, /--bind 127\.0\.0\.1/)
  assert.doesNotMatch(script, /0\.0\.0\.0/)
  assert.match(script, /trap .*kill \$SERVER/)
  assert.match(script, /HEXAGON_PORT/)
  assert.ok(script.startsWith('#!/bin/sh'))
})

test('the desktop entry launches the installed binary', () => {
  const entry = desktopEntry()
  assert.match(entry, /^Exec=hexagon-npu-simcity$/m)
  assert.match(entry, /^Type=Application$/m)
})

test('the release asset name is safe for checksum listing', () => {
  assert.match(ASSET, /^[a-zA-Z0-9._-]+$/)
  assert.ok(ASSET.endsWith('.deb'))
  assert.equal(PACKAGE, 'hexagon-npu-simcity')
})
