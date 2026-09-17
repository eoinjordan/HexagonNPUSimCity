# Architecture, Calculations and Quantization Verification

Reviewed against public sources on 2026-09-17.

## Verification Boundary

The city is a generic educational visualization, not a Hexagon emulator. Its
simulation does not load a trained network or calibrate activations. Optional
[native shells](native.md) execute a separate tiny QDQ arithmetic sample through
ONNX Runtime, with explicit CPU/QNN selection; no Qualcomm device was available
for validation in this review. Passing browser and arithmetic
tests does **not** establish real model accuracy, NPU utilization, latency, power,
or universal support for a numeric format.

The format selector changes illustrative animation coefficients. It does not
quantize a model. The separate worked examples below demonstrate integer affine
quantization and are checked against published ONNX expected-output vectors.

## Public Hardware Facts

| Statement | Evidence and limits |
| --- | --- |
| Snapdragon X Elite advertises an integrated Hexagon NPU at up to 45 TOPS | Qualcomm's [product page](https://www.qualcomm.com/laptops/products/snapdragon-x-elite) and [product brief, 87-71417-1 Rev F](https://docs.qualcomm.com/doc/87-71417-1/87-71417-1_REV_F_Snapdragon_X_Elite_Product_Brief.pdf). This is a named product, not a specification for every Hexagon generation. The brief does not provide the simulator's per-format throughput table. |
| The same brief lists 135 GB/s LPDDR5x bandwidth | This is platform memory bandwidth, not a measured VTCM bandwidth or a guaranteed per-model inference rate. |
| Weight and activation precision are separate choices | Qualcomm's [AI Hub quantization guide](https://workbench.aihub.qualcomm.com/docs/hub/quantize_examples.html) demonstrates W8A8 and lists INT8 weights with INT8/INT16 activations for its QNN quantize-job workflow. That workflow's table is not a universal silicon capability matrix. |
| FP16 is not supported by every HTP/device path | Qualcomm's [profiling guide](https://workbench.aihub.qualcomm.com/docs/hub/profile_examples.html) explicitly describes devices whose HTP does not support FP32/FP16 models and possible CPU fallback. Check device, runtime, operator and compiler support. |
| Quantization can lose accuracy | Qualcomm documents representative calibration data, scales/zero points and possible accuracy loss. Its tutorial uses 100 samples and generally recommends 500-1000; this is guidance, not a guarantee of accuracy. |

The CPU, GPU and sensing hub are system context outside the depicted NPU. VTCM
is not represented as a CPU/GPU-shared cache. Rails and particle paths are
conceptual data movement, not a measured bus topology. The visible lane/cell
counts, district dimensions and tile yard are visual metaphors, not published
silicon dimensions. Micro-tiling is a scheduling concept, not an additional
accelerator block.

## Audit of Displayed Calculations

The model currently uses the following **synthetic coefficients**, not Qualcomm
specifications:

| Format label | Illustrative peak TOPS coefficient | Illustrative token/s coefficient |
| --- | ---: | ---: |
| INT4 | 80 | 95 |
| INT8 | 45 | 62 |
| INT16 | 22 | 34 |
| FP16 | 20 | 30 |

- Displayed TOPS = the synthetic TOPS coefficient times simulated tensor activity.
- Displayed tokens/s = the synthetic token coefficient times simulated tensor activity, with zero token output for vision and idle workloads.
- Displayed power after an update = `0.4 + 0.6 * scalar + 1.1 * vector + 2.4 * tensor`, with activity in `[0, 1]`. This bounds the toy power at 0.4-4.5 W. Initial/reset metrics are zero until an update.
- The two throughput readouts are independently animated proxies. They are not a consistent operation-count model of a particular LLM and must not be used to derive operations/token or claim that INT4 is a particular multiple faster than FP16.
- Token latency also depends on model size, context/KV cache, batch size, memory traffic, kernels and runtime. Watts require measurement or a calibrated power model. Neither follows from the bit width alone.
- Counting a multiply-accumulate as two operations is a common reporting convention, but advertised TOPS must also be interpreted with its precision, sparsity and measurement conditions. The number of drawn cells is not an operation count.

The automated model tests verify the equations, bounds, state transitions and
repeatability above. **The physical performance coefficients are not verified.**
They remain clearly labelled illustrative instead of being silently equated to
a particular processor's advertising figures.

## Verified Quantization Examples

The scalar helper in [quantization.ts](../src/sim/quantization.ts) follows the
integer affine semantics described by ONNX
[QuantizeLinear](https://onnx.ai/onnx/operators/onnx__QuantizeLinear.html) and
[DequantizeLinear](https://onnx.ai/onnx/operators/onnx__DequantizeLinear.html):

```text
q = clamp(round_to_nearest_even(x / scale) + zero_point, q_min, q_max)
x_restored = (q - zero_point) * scale
```

Scale must be positive. The zero point must be an integer in the encoded range.
Rounding happens before adding the integer zero point. Ordinary JavaScript
`Math.round` alone is incorrect for the tie cases: `2.5` must round to `2`, not
`3`, and `-1.5` rounds to `-2`.

### Published Reference Vector

For UINT8, scale `2` and zero point `128`:

```text
input:       [0, 2, 3, 1000, -254, -1000]
quantized:   [128, 129, 130, 255, 1, 0]
```

This matches ONNX's published default QuantizeLinear example. ONNX's default
DequantizeLinear example uses `[0, 3, 128, 255]` with the same encoding and yields
`[-256, -250, 0, 254]`. Saturation is not reversible: clipped values do not recover
their original magnitudes.

Tests also reproduce the published INT16 vector and the INT4 per-axis example,
applying its individual row encodings explicitly. The helper is a scalar
per-tensor demonstration, not a general tensor-axis/blocked-quantization engine.

### Ranges, Error and Storage

| Signed integer format | Full two's-complement range | Packed payload for 1,000 values |
| --- | --- | ---: |
| INT4 | -8 to 7 | 500 bytes |
| INT8 | -128 to 127 | 1,000 bytes |
| INT16 | -32,768 to 32,767 | 2,000 bytes |

These are full representable ranges. A symmetric quantizer can choose a narrower
range; do not assume every calibration scheme uses all codes. UINT8's range is
0-255. FP16 is floating point, not affine INT16 quantization.

Unclipped reconstruction error is at most half a quantization step in the scalar
rounding model. Clipping can exceed that bound. This is **not** a neural-network
accuracy guarantee.

Packed payload size is `ceil(elements * bits / 8)`: five INT4 values require
three bytes. Scales, zero points, alignment, activations, KV cache, mixed-format
layers and runtime buffers are excluded. Halving weight bits does not necessarily
halve total model memory or latency. Returned example arrays contain JavaScript
numbers; the helper reports packed size but does not serialize packed tensors.

The implementation uses JavaScript number arithmetic and deliberately rejects
non-finite demonstration inputs. The checked vectors verify the listed results,
not bit-for-bit equivalence with every FP16/FP32 division or hardware kernel.

## Reproduce the Checks

```sh
npm ci
npm run typecheck
npm test
npm run test:coverage
npx playwright install chromium
npm run test:browser
npm run test:app
```

`test:browser` exercises real renderer/scene integration in an isolated fixture.
`test:app` builds the actual app and tests it from a production preview under a
GitHub Pages-style subdirectory. Both cover desktop and high-DPI mobile views.
Neither executes Qualcomm NPU instructions.

Native CPU output-oracle tests are separate from these browser suites. Native
HTP execution requires a supported device/runtime and is not certified by a
successful desktop cross-build or Android APK build.

Actual quantized-model validation requires a chosen device and runtime, a known
model and representative calibration/evaluation data, float-versus-quantized
output comparison, task accuracy evaluation and on-device profiling. Qualcomm's
quantization and profiling guides above describe that workflow. No cloud jobs,
model uploads or device benchmarks were performed in this review.