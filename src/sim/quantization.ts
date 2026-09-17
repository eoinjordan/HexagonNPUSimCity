export type IntegerBits = 4 | 8 | 16

export interface AffineEncoding {
  bits: IntegerBits
  signed: boolean
  scale: number
  zeroPoint: number
}

export function integerRange(bits: IntegerBits, signed = true): { min: number; max: number } {
  if (![4, 8, 16].includes(bits)) throw new RangeError('Integer examples support 4, 8, or 16 bits')
  return signed ? { min: -(2 ** (bits - 1)), max: 2 ** (bits - 1) - 1 } : { min: 0, max: 2 ** bits - 1 }
}

function validateEncoding(encoding: AffineEncoding) {
  const range = integerRange(encoding.bits, encoding.signed)
  if (!Number.isFinite(encoding.scale) || encoding.scale <= 0) throw new RangeError('Scale must be finite and positive')
  if (!Number.isInteger(encoding.zeroPoint) || encoding.zeroPoint < range.min || encoding.zeroPoint > range.max) {
    throw new RangeError('Zero point must be an integer in the encoded range')
  }
  return range
}

export function quantizeLinear(values: readonly number[], encoding: AffineEncoding): number[] {
  const { min, max } = validateEncoding(encoding)
  return values.map((value) => {
    if (!Number.isFinite(value)) throw new RangeError('Examples require finite input values')
    const scaled = value / encoding.scale
    if (scaled <= min - encoding.zeroPoint) return min
    if (scaled >= max - encoding.zeroPoint) return max
    const lower = Math.floor(scaled)
    const rounded = scaled - lower === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(scaled)
    return Math.max(min, Math.min(max, rounded + encoding.zeroPoint))
  })
}

export function dequantizeLinear(values: readonly number[], encoding: AffineEncoding): number[] {
  const { min, max } = validateEncoding(encoding)
  return values.map((value) => {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Encoded values must be integers in range')
    const restored = (value - encoding.zeroPoint) * encoding.scale
    if (!Number.isFinite(restored)) throw new RangeError('Restored value exceeds numeric range')
    return restored
  })
}

export function packedTensorBytes(elements: number, bits: IntegerBits): number {
  integerRange(bits)
  if (!Number.isSafeInteger(elements) || elements < 0 || !Number.isSafeInteger(elements * bits)) {
    throw new RangeError('Element count must be a non-negative safe integer with a safe bit count')
  }
  return Math.ceil(elements * bits / 8)
}