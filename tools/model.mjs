import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import schema from 'onnx-proto'

const { onnx } = schema
export const WIDTH = 64
export const SAMPLE_INPUT = Uint8Array.from({ length: WIDTH }, (_, index) => 124 + index % 8)

export function buildSmokeModel() {
  const tensorInfo = (name) => ({
    name,
    type: { tensorType: { elemType: onnx.TensorProto.DataType.UINT8, shape: { dim: [{ dimValue: 1 }, { dimValue: WIDTH }] } } },
  })
  const weights = new Uint8Array(WIDTH * WIDTH).fill(128)
  for (let index = 0; index < WIDTH; index++) weights[index * WIDTH + index] = 136
  const model = onnx.ModelProto.create({
    irVersion: 8,
    producerName: 'HexagonNPUSimCity arithmetic smoke test',
    opsetImport: [{ domain: '', version: 13 }],
    graph: {
      name: 'uint8-qdq-identity-matmul',
      input: [tensorInfo('input')],
      output: [tensorInfo('output')],
      initializer: [
        { name: 'scale', dataType: onnx.TensorProto.DataType.FLOAT, dims: [], floatData: [0.125] },
        { name: 'zero', dataType: onnx.TensorProto.DataType.UINT8, dims: [], int32Data: [128] },
        { name: 'weights', dataType: onnx.TensorProto.DataType.UINT8, dims: [WIDTH, WIDTH], rawData: weights },
      ],
      node: [
        { name: 'input-dq', opType: 'DequantizeLinear', input: ['input', 'scale', 'zero'], output: ['input-float'] },
        { name: 'weight-dq', opType: 'DequantizeLinear', input: ['weights', 'scale', 'zero'], output: ['weight-float'] },
        { name: 'matmul', opType: 'MatMul', input: ['input-float', 'weight-float'], output: ['product'] },
        { name: 'output-q', opType: 'QuantizeLinear', input: ['product', 'scale', 'zero'], output: ['output'] },
      ],
    },
  })
  const error = onnx.ModelProto.verify(model)
  if (error) throw new Error(error)
  return onnx.ModelProto.encode(model).finish()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = new URL('../native/models/', import.meta.url)
  await mkdir(directory, { recursive: true })
  const model = buildSmokeModel()
  await writeFile(new URL('matmul-qdq.onnx', directory), model)
  console.log(`Generated matmul-qdq.onnx (${model.length} bytes); UINT8 [1,64] identity oracle`)
}