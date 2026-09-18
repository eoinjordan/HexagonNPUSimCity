# Architecture, Calculations and Quantization Verification

Public-source review: 2026-09-17. Implementation and QCS6490 hardware-evidence
update: 2026-09-18.

## Verification Boundary

The city is a generic educational visualization, not a Hexagon emulator. Its
simulation does not load a trained network or calibrate activations. Optional
[native shells](native.md) execute a separate tiny QDQ arithmetic sample through
ONNX Runtime, with explicit CPU/QNN selection. Android/Windows hardware execution
remains unverified by the local host builds. A separate native Ubuntu
[QCS6490 HTP test](qcs6490-npu.md) has now passed using Qualcomm QAIRT and checked
matrix outputs. Its latency applies only to that workload and method.

Passing browser or arithmetic tests does **not** establish trained-model
accuracy, general NPU throughput/utilization/power, or universal format support.
There is still no successful QCS6490 NPU LLM run in the recorded investigation.

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
- Displayed tokens/s = the synthetic token coefficient times the workload's `tokenScale` times simulated tensor activity. Default vision and idle profiles use `tokenScale = 0`.
- Displayed power with default configuration = `0.4 + 0.6 * scalar + 1.1 * vector + 2.4 * tensor`, with activity in `[0, 1]`. This bounds the default toy power at 0.4-4.5 W. Initial/reset metrics are zero until an update or a selector/configuration change refreshes them, including while paused.
- The two throughput readouts are independently animated proxies. They are not a consistent operation-count model of a particular LLM and must not be used to derive operations/token or claim that INT4 is a particular multiple faster than FP16.
- Token latency also depends on model size, context/KV cache, batch size, memory traffic, kernels and runtime. Watts require measurement or a calibrated power model. Neither follows from the bit width alone.
- Counting a multiply-accumulate as two operations is a common reporting convention, but advertised TOPS must also be interpreted with its precision, sparsity and measurement conditions. The number of drawn cells is not an operation count.

The automated model tests verify the equations, bounds, state transitions and
repeatability above. **The physical performance coefficients are not verified.**
They remain clearly labelled illustrative instead of being silently equated to
a particular processor's advertising figures.

### Configurable Workload Defaults

The settings drawer edits a live copy of
[`DEFAULT_SIM_CONFIG`](../src/sim/model.ts), not hardware configuration:

| Workload | Scalar target | HVX target | HMX target | VTCM occupancy target | Token scale | Tile target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `llm-decode` | 0.35 | 0.50 | 0.82 | 0.72 | 1 | 640 |
| `vision-conv` | 0.24 | 0.72 | 0.92 | 0.80 | 0 | 900 |
| `idle` | 0.06 | 0.05 | 0.04 | 0.12 | 0 | 40 |

Utilization and occupancy ease toward targets with bounded seeded jitter in the
web model. The tile count is another illustrative target, not a measured hardware
resource inventory. Default ONNX opsets `[13, 17, 19, 21]` in settings are teaching
metadata; the checklist does not validate, convert, or restrict a real model.
The separately generated ONNX smoke model uses opset 13.

Reset restarts simulation state and seeded animation while retaining the live
configuration. **Restore defaults** in settings restores the coefficients.
Changing coefficients changes the equations' outputs; the default bounds above
must not be presented as invariant under arbitrary configuration changes.

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

## QCS6490 NPU Support Work

Eoin Jordan's hardware-validation work on a RUBIK Pi 3 established a working
Ubuntu/QAIRT path for a dense affine-UINT8 matrix graph, with CPU fallback
excluded. The [full NPU guide](qcs6490-npu.md) documents access setup, toolchain
and SDK prerequisites, exact commands, independent oracles, profiles, artifacts,
and the unsuccessful runtime alternatives.

[The hardware report](measurements/qcs6490-qnn.json) records 32 executions over
eight fixtures and 65,536 exact output comparisons, with positive accelerator
and matrix-operation profiles for every execution. After discarding eight
warm-ups, 24 host-side QNN execution measurements averaged **0.4706 ms**
(median **0.4705 ms**, range **0.420-0.518 ms**). Detailed profiling was enabled;
RPC overhead is included, context loading and tensor file I/O are excluded.

This result is not an ONNX Runtime mobile/Windows certification, HMX-only
attribution, peak TOPS or watts measurement, LLM result, or calibration of the
visualization. The report is not automatically ingested by the web dashboard.
The earlier [preflight snapshot](measurements/qcs6490-preflight.json) remains a
historical blocked llama.cpp check, not the final arithmetic-validation verdict.

Off-device validation logic is tested separately with:

```sh
python3 -m unittest discover -s tools -p 'test_qnn_validate.py' -v
```

The current main CI does not run that Python command or execute the physical NPU.

### NPU Vision And Mixed-Backend Gateway

The [gateway](qcs6490-npu.md#multi-workload-gateway) adds real MobileNet-v2 W8A16
classification through QNN HTP. Positive accelerator and convolution profiles
are required for every HTTP vision result. An independent same-DLC SNPE CPU
comparison checked all 1,000 logits for the test image: cosine 0.999665 and an
identical top prediction. See the [vision evidence](measurements/qcs6490-vision.json).
The earlier FP32-reference comparison missed the chosen threshold; the matched
quantized comparison is recorded separately, not represented as dataset accuracy.

The board's port-8088 gateway routes language and image/VLM compatibility calls
to an explicitly CPU-only worker on 8089. The [acceptance report](measurements/qcs6490-gateway.json)
records actual NPU vision, CPU text/image generation and a no-dispatch idle
request. CPU token rates are not NPU throughput. Idle does not prove global
hardware inactivity or zero watts. The runtime panel displays these results
separately; changing a display workload/precision does not perform quantization,
start automatic inference, or calibrate the illustrative city meters.

## Arduino App Lab Measurements

The App Lab connector (`src/runtime/applab.ts`, app in `arduino/bench/`) streams
real `llama-bench` results from an Arduino board into the visualization. What
those numbers do and do not establish:

| Statement | Evidence and limits |
| --- | --- |
| The token rates are measured, not modelled | They come from `llama-bench -o json`, taken from `avg_ts` for the prompt (`n_prompt > 0`) and generation (`n_gen > 0`) rows. A rate the tool did not report stays `null` and is displayed as unavailable. |
| The supplied UNO Q setup builds a CPU runner | The observed QRB2210 board exposes an ADSP, not the cDSP/HTP needed by this llama.cpp path. `bench-setup-board.sh` builds CPU llama.cpp; it does not install a compatible Hexagon kernel for other boards. No CPU-utilization, power, or NPU counters are read. |
| Backend labels are tool-reported, not independently attested | `describe_backend()` classifies the first row's `backends` text containing `htp` or `hexagon` as `hexagon-htp`, otherwise `cpu`, and uses the reported device label. It does not validate outputs, offloaded-operator coverage, or accelerator profiles. Missing metadata falls into the CPU-labelled path; do not treat that classification as proof of exclusive CPU execution either. |
| A quantization change selects another file | The setup downloads five GGUF variants (`Q4_0`, `Q4_K_M`, `Q5_K_M`, `Q8_0`, `F16`) of SmolLM2-135M-Instruct. The sweep skips missing/failed files; it neither quantizes a model nor measures task accuracy. Source/model downloads use mutable branches, so retain revisions and hashes for a reproducible performance comparison. |
| The accelerator districts stay illustrative | Receiving a measured sample sets the displayed format and the on-screen readout. It does not make the scalar/HVX/HMX/VTCM animations measured; those remain the synthetic coefficients above. The readout says so when `backend` is `cpu`. |

The browser bridge accepts HTTP(S) loopback, RFC1918 and `.local` origins, plus
optional exact allowlisted origins. It validates message shape and values but
does not authenticate the sender or verify the hardware claim. Treat the local
network and embedding page as trusted, not as cryptographic measurement evidence.

GGUF formats are mapped to the city's display buckets: Q4-family formats to
INT4, Q5/Q6/Q8 to INT8, and F16/BF16 to FP16. This is not a claim that Q5 weights
are eight-bit weights, BF16 equals FP16, or MXFP4 is affine integer quantization.
The received rates stay in a separate readout; the main TOPS/tokens/power meters
continue to come from the simulation.

Actual quantized-model validation requires a chosen device and runtime, a known
model and representative calibration/evaluation data, float-versus-quantized
output comparison, task accuracy evaluation and on-device profiling. Qualcomm's
quantization and profiling guides above describe that workflow. No cloud model
uploads or compilation jobs were used for the QCS6490 arithmetic run. Its fixed
fixtures do not replace representative calibration/evaluation data for a trained
network. The local Mac LLM smoke report and QCS6490 report are separate evidence
records with different workloads, backends, timing scopes, and limitations.

## Documentation Recordings

The README GIFs are generated from the running application by
[tools/record-media.mjs](../tools/record-media.mjs), not fabricated UI frames.
The four simulation clips cover overview/day-night, the guided tour, precision,
and workloads. They contain illustrative figures, not measurements. The separate
[QCS6490 clip](media/qcs6490.gif) makes real vision, language and idle requests
through a loopback gateway and verifies the returned backend/evidence contract
before capturing the displayed result.

Install Chromium with `npx playwright install chromium` and make `ffmpeg`,
`ffprobe`, and `gifsicle` available on `PATH`. Build and serve the web app in one
terminal:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Then regenerate the simulation recordings:

```sh
node --import tsx tools/record-media.mjs --url http://127.0.0.1:4173/
```

For a live board recording, establish the documented same-port SSH tunnel and
include its gateway URL. This command explicitly dispatches one NPU vision and
one CPU language request, then checks no-dispatch idle; it is not a passive
screen capture:

```sh
node --import tsx tools/record-media.mjs \
	--url http://127.0.0.1:4173/ \
	--gateway-url http://127.0.0.1:8088/
```

Use `--only overview`, `--only tour`, `--only quantization`, `--only workloads`,
or `--only qcs6490` to refresh one clip. The last requires `--gateway-url`.
The recorder rejects non-loopback URLs and embedded URL credentials.

Capture uses a controlled browser clock for the simulation, samples at eight
frames/s, then encodes a looping GIF. Network requests finish before result
frames are captured; GIF duration is not a measurement of inference latency.
The tool checks nonblank/changing canvas pixels, page errors, horizontal overflow,
encoded dimensions, frame counts, duration, and an 8 MiB per-file size limit.
It decodes a midpoint PNG into the system temporary directory for visual review.

[media/recordings.json](media/recordings.json) records each GIF's source URL,
capture date, dimensions, frame count, size and SHA-256. Gateway entries also
retain the actual backend summaries. Frames are temporary and removed after
encoding; reviewed GIFs and the manifest are retained in Git. These checks
validate the recording, not trained-model accuracy or hardware peak performance.