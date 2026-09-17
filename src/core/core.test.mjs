import assert from 'node:assert/strict'
import test from 'node:test'
import { createBus } from './bus.ts'
import { COLOR } from './theme.ts'
import { approach, clamp01, fmtNum, fmtPct, hexCss, makeRng, reduceMotion } from './util.ts'

test('bus delivers the original payload only to the subscribed event', () => {
  const bus = createBus()
  const payload = { id: 'tensor' }
  const received = []
  bus.on('district:select', (value) => received.push(value))
  bus.on('district:hover', () => assert.fail('wrong event delivered'))
  bus.emit('district:select', payload)
  assert.deepEqual(received, [payload])
  assert.equal(received[0], payload)
  assert.doesNotThrow(() => bus.emit('camera:home', undefined))
})

test('bus unsubscribe is idempotent and leaves other listeners active', () => {
  const bus = createBus()
  const received = []
  const unsubscribe = bus.on('reset', () => received.push('first'))
  bus.on('reset', () => received.push('second'))
  bus.emit('reset', undefined)
  unsubscribe()
  unsubscribe()
  bus.emit('reset', undefined)
  assert.deepEqual(received, ['first', 'second', 'second'])
})

test('bus instances have independent listeners', () => {
  const first = createBus()
  const second = createBus()
  first.on('pause:toggle', () => assert.fail('event crossed bus instances'))
  assert.doesNotThrow(() => second.emit('pause:toggle', undefined))
})

test('clamp01 bounds finite input and preserves values inside the interval', () => {
  assert.deepEqual([-10, 0, 0.25, 1, 10].map(clamp01), [0, 0, 0.25, 1, 1])
})

test('approach is monotonic, does not overshoot, and composes across time steps', () => {
  assert.equal(approach(0.2, 0.8, 2, 0), 0.2)
  assert.equal(approach(0.2, 0.8, 0, 1), 0.2)
  const halfway = approach(0.2, 0.8, 2, 0.5)
  assert.ok(halfway > 0.2 && halfway < 0.8)
  assert.ok(Math.abs(approach(halfway, 0.8, 2, 0.5) - approach(0.2, 0.8, 2, 1)) < 1e-12)
  assert.ok(approach(0.8, 0.2, 2, 0.5) < 0.8)
  assert.ok(approach(0.8, 0.2, 2, 0.5) > 0.2)
})

test('RNG sequences are seeded, reproducible, isolated and bounded', () => {
  const first = makeRng(42)
  const replay = makeRng(42)
  const other = makeRng(43)
  const sequence = Array.from({ length: 100 }, () => first())
  assert.deepEqual(sequence, Array.from({ length: 100 }, () => replay()))
  assert.notDeepEqual(sequence, Array.from({ length: 100 }, () => other()))
  assert.ok(sequence.every((value) => value >= 0 && value < 1))
  assert.ok(new Set(sequence).size > 90)
})

test('formatters preserve readable precision, percentages and padded colors', () => {
  assert.equal(fmtNum(1234.567), '1,234.6')
  assert.equal(fmtNum(1234.567, 0), '1,235')
  assert.equal(fmtPct(0.728), '73%')
  assert.equal(fmtPct(-1), '0%')
  assert.equal(fmtPct(2), '100%')
  assert.equal(hexCss(0x00ab0f), '#00ab0f')
  assert.equal(hexCss(0), '#000000')
})

test('motion preference is safe without a browser', () => {
  assert.equal(reduceMotion(), false)
})

test('all theme colors are valid RGB values and compute engines are distinct', () => {
  assert.ok(Object.values(COLOR).every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffff))
  assert.equal(new Set([COLOR.scalar, COLOR.vector, COLOR.tensor, COLOR.vtcm]).size, 4)
})