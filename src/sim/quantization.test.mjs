import assert from 'node:assert/strict'
import test from 'node:test'
import { dequantizeLinear, integerRange, packedTensorBytes, quantizeLinear } from './quantization.ts'

test('affine UINT8 matches the published ONNX QuantizeLinear reference vector', () => {
  const encoding = { bits: 8, signed: false, scale: 2, zeroPoint: 128 }
  assert.deepEqual(quantizeLinear([0, 2, 3, 1000, -254, -1000], encoding), [128, 129, 130, 255, 1, 0])
})

test('dequantization matches the published ONNX DequantizeLinear reference vector', () => {
  const encoding = { bits: 8, signed: false, scale: 2, zeroPoint: 128 }
  assert.deepEqual(dequantizeLinear([0, 3, 128, 255], encoding), [-256, -250, 0, 254])
})

test('signed INT16 matches the published ONNX reference including saturation', () => {
  const encoding = { bits: 16, signed: true, scale: 2, zeroPoint: 256 }
  const values = [0, -514, 3, -3, 2.9, -2.9, 3.1, -3.1, 65022, -66046, 65023, -66047, 65024, -66048, 70000, -70000]
  const expected = [256, -1, 258, 254, 257, 255, 258, 254, 32767, -32767, 32767, -32768, 32767, -32768, 32767, -32768]
  assert.deepEqual(quantizeLinear(values, encoding), expected)
})

test('per-row INT4 encodings reproduce the ONNX per-axis example without wraparound', () => {
  const rows = [[0, 2.5, 4.8, 8.6], [-30, -20, 6, 9], [12, 15, 16, 40]]
  const scales = [2, 3, 4]
  const actual = rows.flatMap((values, index) => quantizeLinear(values, { bits: 4, signed: true, scale: scales[index], zeroPoint: 1 }))
  assert.deepEqual(actual, [1, 2, 3, 5, -8, -6, 3, 4, 4, 5, 5, 7])
  assert.deepEqual(dequantizeLinear([0, 1, 7, -4, -8], { bits: 4, signed: true, scale: 2, zeroPoint: 1 }), [-2, 0, 12, -10, -18])
})

test('ties round to even before adding an odd zero point, for both signs', () => {
  const encoding = { bits: 8, signed: true, scale: 1, zeroPoint: 1 }
  assert.deepEqual(quantizeLinear([-2.5, -1.5, -0.5, 0.5, 1.5, 2.5], encoding), [-1, -1, 1, 1, 3, 3])
  assert.equal(quantizeLinear([2.5], { ...encoding, zeroPoint: 0 })[0], 2)
  assert.equal(Math.round(2.5), 3)
})

test('integer bounds, zero representation and saturation hold for every illustrated bit width', () => {
  for (const bits of [4, 8, 16]) {
    for (const signed of [true, false]) {
      const { min, max } = integerRange(bits, signed)
      const encoding = { bits, signed, scale: 0.25, zeroPoint: signed ? 0 : 1 }
      assert.deepEqual(quantizeLinear([-1e9, 1e9], encoding), [min, max])
      assert.equal(quantizeLinear([0], encoding)[0], encoding.zeroPoint)
      assert.equal(dequantizeLinear([encoding.zeroPoint], encoding)[0], 0)
    }
  }
  assert.deepEqual(integerRange(4), { min: -8, max: 7 })
  assert.deepEqual(integerRange(8), { min: -128, max: 127 })
  assert.deepEqual(integerRange(16), { min: -32768, max: 32767 })
})

test('unclipped quantization error is bounded by half a step; clipping can exceed that bound', () => {
  const encoding = { bits: 8, signed: true, scale: 0.25, zeroPoint: 0 }
  const values = Array.from({ length: 100 }, (_, index) => (index - 50) * 0.137)
  const restored = dequantizeLinear(quantizeLinear(values, encoding), encoding)
  for (let index = 0; index < values.length; index++) assert.ok(Math.abs(values[index] - restored[index]) <= encoding.scale / 2 + 1e-12)
  const clipped = dequantizeLinear(quantizeLinear([100], encoding), encoding)[0]
  assert.ok(Math.abs(100 - clipped) > encoding.scale / 2)
})

test('packed storage counts only payload bits and rounds up incomplete bytes', () => {
  assert.equal(packedTensorBytes(1000, 4), 500)
  assert.equal(packedTensorBytes(1000, 8), 1000)
  assert.equal(packedTensorBytes(1000, 16), 2000)
  assert.equal(packedTensorBytes(5, 4), 3)
  assert.equal(packedTensorBytes(0, 8), 0)
})

test('invalid encodings, non-finite input and invalid packed sizes are rejected', () => {
  const encoding = { bits: 8, signed: true, scale: 0.5, zeroPoint: 0 }
  for (const scale of [0, -1, NaN, Infinity]) {
    assert.throws(() => quantizeLinear([0], { ...encoding, scale }), RangeError)
    assert.throws(() => dequantizeLinear([0], { ...encoding, scale }), RangeError)
  }
  for (const zeroPoint of [0.5, -129, 128, NaN]) assert.throws(() => quantizeLinear([0], { ...encoding, zeroPoint }), RangeError)
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => quantizeLinear([value], encoding), RangeError)
  for (const value of [-129, 128, 0.5, NaN]) assert.throws(() => dequantizeLinear([value], encoding), RangeError)
  assert.throws(() => dequantizeLinear([127], { ...encoding, scale: Number.MAX_VALUE }), RangeError)
  for (const bits of [0, 2, 32, 'FP16']) assert.throws(() => integerRange(bits), RangeError)
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => packedTensorBytes(count, 16), RangeError)
})