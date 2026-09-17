import assert from 'node:assert/strict'
import test from 'node:test'
import * as ort from 'onnxruntime-node'
import { buildSmokeModel, SAMPLE_INPUT, WIDTH } from './model.mjs'

test('native smoke model is reproducible and executes its known quantized arithmetic on CPU', async (context) => {
  const model = buildSmokeModel()
  assert.deepEqual(model, buildSmokeModel())
  assert.ok(model.length < 8192)
  const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: 1 })
  context.after(() => session.release())
  assert.deepEqual(session.inputNames, ['input'])
  assert.deepEqual(session.outputNames, ['output'])
  for (const data of [SAMPLE_INPUT, new Uint8Array(WIDTH), new Uint8Array(WIDTH).fill(255)]) {
    const input = new ort.Tensor('uint8', data, [1, WIDTH])
    const output = await session.run({ input })
    assert.deepEqual(output.output.dims, [1, WIDTH])
    assert.deepEqual(output.output.data, data)
  }
})