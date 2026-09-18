# HexagonNPUSimCity

**Walk through the Qualcomm Hexagon NPU. Watch a tensor flow. Understand on-device AI.**

An explorable 3D model where districts are the parts of the Hexagon™ NPU and
motion is the dataflow between them. Follow an inference from weights in memory,
through the scalar, vector and tensor accelerators fused around a shared memory,
and back out again.

No installation to explore — it runs in a browser with WebGL2. View here: https://eoinjordan.github.io/HexagonNPUSimCity/
### The NPU at a glance

Districts are NPU components; the moving particles are the dataflow (cyan activations, orange weights from DRAM). Press `N` to swing between night and day.

![Overview of the Hexagon NPU city with animated dataflow, toggling day and night](docs/media/overview.gif)

### Guided tour

Press `T` to follow one inference through the fused pipeline — the camera glides between districts and explains each one.

![Guided tour gliding between the VTCM, scalar, HVX and HMX districts](docs/media/tour.gif)

<img width="1464" height="779" alt="image" src="https://github.com/user-attachments/assets/0071aecc-552a-451d-8658-1ae4b6670ccc" />



> **Independent & non-commercial.** Not affiliated with, sponsored by, or endorsed
> by Qualcomm. Hexagon, Snapdragon, Adreno and Oryon are trademarks of Qualcomm
> Incorporated. Every number shown is **illustrative** and scaled to be readable —
> a teaching model, **not** a datasheet or a measurement of any real silicon.

Inspired by [PGSimCity](https://github.com/NikolayS/PGSimCity), which does the
same thing for PostgreSQL.

## Native and measured runtimes

Android ARM64 and Windows ARM64 shells can run a small, output-checked ONNX
arithmetic workload with explicit CPU/QNN selection. The default Android preview
is CPU-only; a QNN-enabled build requires matching SDK libraries. Windows has a
QNN-backed build and MSI packaging workflow. Actual Snapdragon execution and MSI
installation still require target-device verification.

Ollama, llama.cpp and LM Studio adapters provide separate measured timings through
an opt-in local service, never inferred NPU utilization. See the
[native and runtime guide](docs/native.md) for build commands, release automation,
security boundaries and limitations.

Android example source:
[edgeimpulse/example-android-inferencing](https://github.com/edgeimpulse/example-android-inferencing)
and its [QNN example](https://github.com/edgeimpulse/example-android-inferencing/tree/main/qnn-hardware-acceleration).

### Linux / VentuinoQ / Rubik Pi package

Releases include a Debian package, `HexagonNPUSimCity-all.deb`. It is
`Architecture: all` and depends only on `python3`, so the same file installs on
an amd64 desktop and on Ubuntu or Raspberry Pi OS running arm64:

```sh
sudo apt install ./HexagonNPUSimCity-all.deb
hexagon-npu-simcity            # serves on 127.0.0.1:8770 and opens a browser
```

It installs a desktop entry and serves the bundled build on loopback only.
Override the port with `HEXAGON_PORT`. Build it yourself with `node tools/deb.mjs`
after `npm run build`.

### Arduino App Lab connector

An [Arduino UNO Q connector](arduino/README.md) ships two App Lab Apps:
**HexagonNPUCity** hosts this visualization on the board and mirrors its
illustrative telemetry onto the RGB LEDs, and **HexagonNPUCity Bench** runs a
real `llama-bench` sweep across five GGUF quantizations and drives the embedded
visualization with the measured token rates.

The App Lab connector targets Qualcomm Dragonwing boards. On a **VENTUNO Q**
(Dragonwing IQ8) the Hexagon backend can target the NPU; the **UNO Q**'s QRB2210
has no cDSP/HTP, so llama.cpp measures its CPU there. Each sample is labelled
with the backend `llama-bench` actually reported. See
[verification](docs/verification.md#arduino-app-lab-measurements).

## See it in motion

> Recorded from the running app. Everything on screen is **illustrative** (a teaching model), not a hardware measurement.


### Quantization / precision

Switch **format** (INT4 → INT8 → INT16 → FP16) and the HMX *Tensor TOPS* and *tokens/s* readouts scale with the chosen precision — this is how the model represents quantization. The coefficients are illustrative; the arithmetic of integer affine quantization is verified separately in [docs/verification.md](docs/verification.md).

![Cycling precision from INT4 to FP16 while the tensor TOPS and tokens per second change](docs/media/quantization.gif)

### Workloads under different conditions

Switch **workload** — LLM decode, Vision / conv, Idle — and watch the scalar, HVX and HMX utilisation bars and the accelerators themselves respond.

![Switching between LLM decode, vision convolution and idle workloads and watching the utilisation bars react](docs/media/workloads.gif)

## Quick start

```bash
npm install
npm run dev      # open the printed localhost URL
```

```bash
npm run build      # production build to dist/
npm run preview    # serve the built site
npm run typecheck  # tsc --noEmit
npm test           # module unit and component integration tests
npm run test:coverage
npm run test:browser # real WebGL component tests (install Chromium first)
npm run test:app     # production app tests under a Pages-style subpath
```

## What you are looking at

| District | What it is |
|---|---|
| **VTCM** (centre, violet) | Vector Tightly-Coupled Memory — NPU-local memory that keeps working tiles close to the engines so they share data without constant DRAM traffic. |
| **Scalar accelerator** (north, blue) | Control flow and orchestration: sequences the other engines and runs the parts of a model that aren't big matrix math. |
| **HVX** (west, green) | The Hexagon Vector eXtensions SIMD engine — activations, normalisation and elementwise work between matrix multiplies. |
| **HMX** (east, amber) | The Hexagon Matrix eXtensions tensor engine — a multiply-accumulate array for convolutions and matmuls. Most of the TOPS live here. |
| **Micro-tile scheduling** (south, cyan) | A *scheduling concept*, not a separate block: large ops are split into tiles that fit local memory and reuse data. |
| **Host CPU / Adreno GPU / Sensing hub** (corners) | System context *outside* the NPU. Shown to place the NPU in the wider Qualcomm AI Engine, not simulated as consumers of VTCM. |

Colour is meaning, never decoration: **scalar is blue**, **HVX is green**,
**HMX is amber**, **VTCM is violet**, **activations are cyan**, **weights are
orange**, and system-context labels are drawn quieter and dashed.

## Controls

Drag to orbit, wheel/pinch to zoom, Shift-drag to pan, click a district to
inspect it. Press **?** for the full key map and colour legend.

| Key | Action | Key | Action |
|---|---|---|---|
| `T` | Guided tour | `N` | Day / night |
| `K` / `P` | Pause / resume | `R` | Reset |
| `H` | Establishing shot | `1` `2` `3` | LLM / Vision / Idle workload |
| `?` | Keys & legend | `Esc` | Close overlay |

Try switching **precision** (INT4 → FP16) and watch the tensor engine's TOPS and
the token rate change, or run the **Vision / conv** workload and watch HMX light up.

## How much to trust this

The city is a **model, not an emulator**. The 3D city, the utilisation bars and the
throughput figures are scaled to make the architecture observable. The simulation
is a small deterministic behaviour model (`src/sim/`); it does not execute any real
Hexagon workload and its numbers should not be cited as performance data. Optional
native workload and local-runtime measurements are separately labelled and are
not used to claim measured values for the city's utilization or power meters.

Architecture background is drawn from Qualcomm's public description of the Hexagon
NPU (fused scalar + vector + tensor accelerators, a large shared memory, and
micro-tile inferencing within the heterogeneous Qualcomm AI Engine).

See the [calculation and quantization verification](docs/verification.md) for
primary sources, executable ONNX reference examples, integer ranges, storage
calculations and the boundary between verified arithmetic and unverified hardware
performance. Format labels are not a universal Hexagon support matrix; FP16 and
integer quantization are different, and real models need calibration and testing.

## References & sources

The district model (fused scalar + vector + tensor accelerators around a large shared
memory, micro-tile inferencing, and the heterogeneous Qualcomm AI Engine) is drawn from
Qualcomm's public materials. The on-screen figures are **not** taken from these sources —
see [docs/verification.md](docs/verification.md) for the source-by-source audit and the
verified integer-quantization examples.

**Qualcomm — Hexagon NPU & AI Engine**
- [Qualcomm Hexagon NPU](https://www.qualcomm.com/processors/hexagon) — primary reference for the districts and dataflow.
- [Qualcomm AI Engine](https://www.qualcomm.com/products/technology/processors/ai-engine) — heterogeneous CPU + GPU + NPU.
- [Qualcomm AI (overview)](https://www.qualcomm.com/artificial-intelligence)
- [Qualcomm Oryon CPU](https://www.qualcomm.com/processors/oryon) · [Qualcomm Adreno GPU](https://www.qualcomm.com/processors/adreno)
- [Qualcomm AI Hub](https://aihub.qualcomm.com/)

**Qualcomm — platform figures & quantization workflow** (used only in the verification notes, clearly labelled illustrative vs. cited)
- [Snapdragon X Elite](https://www.qualcomm.com/laptops/products/snapdragon-x-elite) and its [product brief (87-71417-1 Rev F, PDF)](https://docs.qualcomm.com/doc/87-71417-1/87-71417-1_REV_F_Snapdragon_X_Elite_Product_Brief.pdf) — the “up to 45 TOPS” figure.
- [AI Hub quantization guide](https://workbench.aihub.qualcomm.com/docs/hub/quantize_examples.html) and [profiling guide](https://workbench.aihub.qualcomm.com/docs/hub/profile_examples.html) — weight/activation precision choices and HTP FP16 support caveats.

**Quantization semantics**
- ONNX [QuantizeLinear](https://onnx.ai/onnx/operators/onnx__QuantizeLinear.html) / [DequantizeLinear](https://onnx.ai/onnx/operators/onnx__DequantizeLinear.html) — the integer affine model reproduced in [`src/sim/quantization.ts`](src/sim/quantization.ts).

## Project layout

```
src/
  core/     types, palette, math utilities, event bus
  sim/      the behaviour model + fixed-step clock (+ tests)
  engine/   renderer, camera rig, CSS2D labels, dataflow, picking
  world/    the districts: ground, VTCM, accelerators, tiling, system context
  ui/       HUD, inspector, guided tour, help overlay, keyboard controls
  main.ts   boot + wiring
```

## Contributing & extending

New here — or an AI agent picking this up? Start with **[AGENTS.md](AGENTS.md)**:
architecture, conventions, the CI/deploy pipeline, and copy-paste recipes for
adding a district, workload, illustrative figure, UI overlay or dataflow.
[CONTRIBUTING.md](CONTRIBUTING.md) is the short version.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for trademarks and the model disclaimer.
