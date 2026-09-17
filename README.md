# HexagonNPUSimCity

**Walk through the Qualcomm Hexagon NPU. Watch a tensor flow. Understand on-device AI.**

An explorable 3D model where districts are the parts of the Hexagon™ NPU and
motion is the dataflow between them. Follow an inference from weights in memory,
through the scalar, vector and tensor accelerators fused around a shared memory,
and back out again.

No installation to explore — it runs in a browser with WebGL2.

> **Independent & non-commercial.** Not affiliated with, sponsored by, or endorsed
> by Qualcomm. Hexagon, Snapdragon, Adreno and Oryon are trademarks of Qualcomm
> Incorporated. Every number shown is **illustrative** and scaled to be readable —
> a teaching model, **not** a datasheet or a measurement of any real silicon.

Inspired by [PGSimCity](https://github.com/NikolayS/PGSimCity), which does the
same thing for PostgreSQL.

## Quick start

```bash
npm install
npm run dev      # open the printed localhost URL
```

```bash
npm run build      # production build to dist/
npm run preview    # serve the built site
npm run typecheck  # tsc --noEmit
npm test           # simulation + clock unit tests
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

Drag to pan, wheel/pinch to zoom, Shift-drag to orbit, click a district to
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

This is a **model, not an emulator**. The 3D city, the utilisation bars and the
throughput figures are scaled to make the architecture observable. The simulation
is a small deterministic behaviour model (`src/sim/`); it does not execute any real
Hexagon workload and its numbers should not be cited as performance data.

Architecture background is drawn from Qualcomm's public description of the Hexagon
NPU (fused scalar + vector + tensor accelerators, a large shared memory, and
micro-tile inferencing within the heterogeneous Qualcomm AI Engine).

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

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for trademarks and the model disclaimer.
