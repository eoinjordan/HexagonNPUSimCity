# AGENTS.md

Guidance for humans **and** coding agents working on **HexagonNPUSimCity** — an
explorable 3D model of the Qualcomm® Hexagon™ NPU. Live:
<https://eoinjordan.github.io/HexagonNPUSimCity/>

This file is the entry point for how to build, test, and extend the
project. It is a generic `AGENTS.md` — the convention read by coding agents
across tools — so there are no vendor-specific variants to keep in sync.
`CONTRIBUTING.md` and `README.md` defer here. The scoped
[Arduino guide](arduino/AGENTS.md) adds connector-specific constraints. Detailed
platform commands live in [docs/native.md](docs/native.md) and
[docs/qcs6490-npu.md](docs/qcs6490-npu.md). Executable configuration and retained
reports remain authoritative when documenting behavior or measurements.

---

## 0. Golden rules (read first)

1. **Simulation figures are illustrative.** The city's TOPS, tokens/s, watts,
   utilisation and tile counts are scaled teaching values, **not** datasheet or
   measured values. Separate runtime readouts and saved reports must identify
   their source, workload and limits. The reviewed defaults live in `src/sim/model.ts`
   (`DEFAULT_SIM_CONFIG`) and are audited in `docs/verification.md`. If you
   change a default, update `docs/verification.md` in the same change. Never
   present a modelled number as hardware fact.
2. **Colour is meaning, never decoration.** Each engine/memory/flow owns exactly
   one hue. The palette is `COLOR` in `src/core/theme.ts` and must match the CSS
   tokens in `src/styles/tokens.css`.
3. **Single source of truth.** Districts come from `DISTRICTS`
   (`src/world/districts.ts`); workloads/formats/figures from `src/sim/model.ts`.
   The scene, HUD legend, tour, inspector, and settings all *read* these — don't
   re-declare a position, colour, or number anywhere else.
4. **The UI talks to the world only through the bus** (`src/core/bus.ts`). The
   world only *reads* simulation state; it never reaches into the UI.
5. **Accuracy about the NPU boundary.** VTCM, scalar, HVX and HMX are inside the
   NPU. The CPU, GPU and sensing hub are *system context outside* it, and
   micro-tiling is a *scheduling concept*, not a silicon block. Keep copy and
   dataflow consistent with that (see `docs/verification.md`).
6. **Keep it green before you push.** See §5 — CI gates the live deploy on the
  **whole** pipeline (web + Debian packaging + Android + Windows).
7. **Require execution evidence.** The QCS6490 QAIRT matrix test passed; the
  tested GenieX GGUF NPU path did not. Never promote an HTP device listing,
  cDSP node, backend request, or DSP calculator result into proof of LLM
  acceleration. Keep raw reports historical and label new evidence.

---

## 1. Setup & commands

Node **>= 22.18** (see `engines`). Install with `npm ci`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Production build to `dist/`. |
| `npm run preview` | Serve the built `dist/` on port 4173. |
| `npm run typecheck` | `tsc --noEmit` (strict). Must be clean. |
| `npm test` | Node test runner over `src/**/*.test.mjs` + `tools/*.test.mjs` (via `tsx`, uses `jsdom`). |
| `npm run test:coverage` | `npm test` under `c8` coverage. |
| `npm run test:browser` | Playwright real-WebGL component tests. Run `npx playwright install chromium` first. |
| `npm run test:app` | Build, then Playwright tests against the production bundle under a Pages-style subpath. |
| `npm run runtime` | Local **measured-mode** stats server (`tools/runtime-server.mjs`) for the opt-in Runtime panel. |
| `npm run native:prepare` | Generate the fixed ONNX smoke model and build the shared web assets. |
| `node tools/deb.mjs` | Package an existing `dist/` into a Debian installer; requires `dpkg-deb`, otherwise only stages files. |
| `arduino/scripts/test-local.sh` | Connector Python model, HTTP and sweep tests; no board execution. |
| `python3 -m unittest discover -s tools -p 'test_qnn_validate.py' -v` | QCS6490 oracle/profile-validator tests; no NPU execution. |
| `python3 -m unittest discover -s tools -p 'test_qcs6490_runtime.py' -v` | Workload gateway, vision evidence, HTTP and CPU-worker compatibility tests; actual model runs are separate. |

> ⚠️ `npm test` alone does **not** run the Playwright suites. CI does. If you
> touch the HUD/toolbar/overlays, also run `npm run test:browser` and
> `npm run test:app` locally — that is where the toolbar-count assertions live.

---

## 2. Repository map

```
index.html               app shell (boot screen, #hud scaffold, canvas + label roots)
src/
  main.ts                boot + wiring: renderer → scene/lights → camera → world → flows → sim → UI
  core/                  types.ts · theme.ts (COLOR) · util.ts · bus.ts (typed pub/sub)
  sim/                   model.ts (createSim, DEFAULT_SIM_CONFIG, configure/getConfig) · clock.ts (fixed 60 Hz)
                         quantization.ts (ONNX affine demo) · *.test.mjs
  engine/                renderer · camera (OrbitControls rig) · labels (CSS2D) · flows (dataflow) · picker
  world/                 districts.ts (SINGLE SOURCE OF TRUTH) · ground · vtcm · accelerators · microtile
                         heterogeneous · sensors · city.ts (assembly) · build.ts (helpers)
  ui/                    hud · panel (inspector) · tour · help · settings · getapp · controls · dom (el helper)
  runtime/               panel.ts + telemetry.ts (opt-in measured mode; local server or native WebView channel)
                         applab.ts (trusted-LAN message parsing and separate reported-rate display)
  assets/                static assets (QR SVGs, inlined by Vite when < 4 KB)
  styles/                tokens.css (design tokens) · ui.css · settings.css · getapp.css
tools/                   model.mjs · release.mjs · deb.mjs · runtime-server.mjs · llama-smoke.mjs
                         qnn-smoke.cpp (context exporter) · qnn_validate.py (+ corresponding tests)
                         qcs6490_runtime.py (NPU vision / CPU language gateway) · qcs6490-*.service/.conf
tests/                   Playwright specs (browser/*.spec.mjs, fixtures/, helpers/)
docs/                    verification.md (figures audit + primary sources) · native.md · release-notes.md
                         qcs6490-npu.md (complete hardware procedure) · media/ · measurements/
native/                  android/ + windows/ WebView preview hosts + WiX installer (SOURCE tracked; build
                         artifacts and local SDK/model caches are gitignored)
.github/workflows/       ci.yml (verify + android + windows) · deploy.yml (Pages, chained on CI) · release.yml (tags)
                         arduino-connector.yml (separate path-filtered Python checks)
arduino/                 app/ (illustrative Python/LED host) · bench/ (measured-rate viewer) · scripts/ · tests/
```

---

## 3. Architecture

- **Boot order** (`src/main.ts`): configure renderer → scene + lights + fog →
  camera rig → world (`createCity`) → dataflow (`createFlows`) → `createSim` →
  UI (HUD, inspector, tour, help, settings, get-app, runtime) → picker → bus
  wiring → resize → a single fixed-step clock drives `sim.update` and the world.
- **Simulation** (`src/sim/`): `createSim()` is config-driven. `update(dt)` eases
  per-accelerator utilisation toward the active workload profile; `refreshMetrics`
  derives TOPS / tokens/s / power from the current `SimConfig`. A returning
  background tab must not dump catch-up (visibility resets the clock). `paused`
  freezes both the sim and the dataflow (the fixed-step clock receives a false
  running flag). Reset restarts state/animation but keeps configured coefficients;
  settings **Restore defaults** resets those coefficients.
- **World** reads `SimState` only. Each district builder returns
  `{ group, update(dt, s) }` (`DistrictBuild`) and is assembled in `city.ts`.
- **UI** is DOM built with the tiny `el()` helper (`src/ui/dom.ts`); it emits and
  listens on the typed bus. Overlays expose `{ toggle, close, readonly open }`.
- **Measurements** stay separate: local adapters report server timings with an
  unverified hardware backend; native CPU/QNN actions check arithmetic outputs;
  App Lab messages set a separate readout and select a simulation precision.
  The offline QCS6490 JSON report is not automatically ingested by the UI.
  The QCS6490 gateway is a separate live source: explicit vision calls require
  HTP profiles, language/VLM uses the retained CPU worker, and idle dispatches
  nothing. It does not report global NPU utilization or power. Model selection
  and simulation workload changes must not automatically start inference.
- **Arduino** has independent browser and Python model states. The current
  browser does not poll the illustrative telemetry API; do not document LED
  synchronization that is not implemented. See [arduino/README.md](arduino/README.md).

---

## 4. How to extend (recipes)

### Add a district
1. Append to `DISTRICTS` in `src/world/districts.ts` (`id`, `name`, `subtitle`,
   `color`, `pos`, `blurb`, live `readout`).
2. Add the id to the `DistrictId` union in `src/core/types.ts`.
3. Add its hue to `COLOR` (`src/core/theme.ts`) and a matching token in
   `src/styles/tokens.css` if it appears in the legend.
4. Build geometry: a `create<Name>(def): DistrictBuild` in `src/world/`
   (copy `accelerators.ts`/`vtcm.ts`), then register it in `src/world/city.ts`
   (`builds` array + `LABEL_Y`).
5. Optionally add a dataflow in `src/engine/flows.ts`.
6. The HUD legend, tour and inspector pick it up automatically. Update any
   count assertions in `src/world/world.test.mjs`.

### Add a workload
1. Extend `WorkloadId` (`types.ts`), `WORKLOADS` (`sim/model.ts`) and add a
   profile to `DEFAULT_SIM_CONFIG.workloads`.
2. The HUD dropdown and settings drawer read these automatically.
3. Optionally add a `1/2/3`-style shortcut in `src/ui/controls.ts`.

### Change or add an illustrative figure
- Edit `DEFAULT_SIM_CONFIG` in `src/sim/model.ts` **and** `docs/verification.md`.
- New tunable field? Add it to `SimConfig`/`SimConfigPatch` (`types.ts`), read it
  in `refreshMetrics`/`update`, and expose a control in `src/ui/settings.ts`.
  Keep defaults identical to what tests/`verification.md` expect.

### Add a UI overlay + toolbar button
1. Create `src/ui/<name>.ts` exporting `create<Name>(...)` →
   `{ toggle, close, readonly open }` (copy `settings.ts`/`getapp.ts`/`help.ts`).
   Put styles in `src/styles/<name>.css` and `import` them from the module.
2. Add `'<name>:toggle': void` to `BusEvents` in `src/core/bus.ts`.
3. Add a `tool('<glyph>', '<label>', '<name>:toggle')` in `src/ui/hud.ts` and
   extend the local `VoidEvent` union.
   **➜ Update the toolbar-button count in BOTH** `src/ui/ui.test.mjs`
   (`#hud-left .tool` length) **and** `tests/browser/app.spec.mjs`
   (`#hud-left` `getByRole('button')` `toHaveCount`).
4. In `src/main.ts`: instantiate it, `bus.on('<name>:toggle', () => x.toggle())`,
   and add `if (x.open) x.close()` at the top of the `createControls` Escape
   handler so Escape closes the topmost overlay first.

### Add a dataflow stream
- Add a spec to the `specs` array in `src/engine/flows.ts` (colour, waypoints,
  `count`, `speedOf`). Keep NPU-local traffic (cyan activations) visually
  distinct from system transfers (weights from DRAM, host hand-offs).

### Add a bus event
- Extend `BusEvents` in `src/core/bus.ts`. Payloads are typed; `void` events are
  emitted with `undefined`.

### Add tests
- Unit/integration: a `*.test.mjs` next to the code (`node:test` + `jsdom`);
  runs under `npm test`. Browser behaviour: a Playwright spec in
  `tests/browser/`. Keep counts/selectors in sync with the DOM you changed.

### Extend NPU validation
- Read [docs/qcs6490-npu.md](docs/qcs6490-npu.md) before changing the exporter,
  fixtures, runtime selection, profiling parser, or measured claims.
- Keep C++ fixture export and Python oracle calculations independent. Require
  every output comparison and positive per-execution accelerator/operator
  evidence; skip-only tests, enumeration, and tool exit status alone cannot pass.
- The current path is QAIRT `qnn-net-run` on QCS6490, not a generic LLM adapter.
  Do not weaken provider checks or substitute CPU timings to make it pass.
- For the deployed gateway, retain the exact MobileNet model/runtime provenance,
  CPU-reference comparison and per-request positive convolution evidence. The
  original VLM worker remains CPU-only behind the gateway. Preserve its API,
  authentication headers and streaming behavior; use the documented reversible
  systemd override, not destructive replacement of the model files or unit.
- Keep licensed SDK headers/libraries, firmware, models, keys and raw board
  artifacts outside Git. Record provenance and content hashes when retaining a
  new measurement; do not silently rewrite a prior preflight into a success.
- Update the NPU guide, README result summary and verification boundaries
  together when the workload or verified support changes.

---

## 5. Testing, CI, release & deploy

**Before you push**, make sure these pass: `npm run typecheck`, `npm test`, and —
if you touched anything rendered — `npm run test:browser` and `npm run test:app`.

- **CI** (`.github/workflows/ci.yml`) runs three jobs: `verify` (install, audit,
  typecheck, coverage, Playwright browser + app tests, model + release checks,
  web packaging, Debian package/install/remove checks, artifact upload), then
  `android` and `windows` native builds.
- **Deploy** (`.github/workflows/deploy.yml`) runs via `workflow_run` **after CI
  succeeds** and publishes `dist/` to GitHub Pages. ⇒ **The web app only goes
  live when the *entire* CI matrix (verify, including Debian packaging, + android + windows) is green.** A
  broken native build blocks the web deploy.
- **Release** (`.github/workflows/release.yml`) runs on `v*.*.*` tags or manual
  dispatch and reuses CI. Tag-only publication requires four assets plus
  `SHA256SUMS` (names defined in `tools/release.mjs`):
  `HexagonNPUSimCity-web.zip`, `HexagonNPUSimCity-arm64-cpu-preview.apk`,
  `HexagonNPUSimCity-arm64.msi`, `HexagonNPUSimCity-all.deb`. A new release is a
  draft; an existing release receives replacement assets via `--clobber` without
  a visibility change. A manual branch run packages but skips publication.
- **Download links:** the three in-app installer QR codes use
  `.../releases/latest/download/<asset>`. They require an eligible published
  release with those exact assets. A tag or draft alone is insufficient.
- **Separate checks:** Arduino tests run in their own path-filtered workflow.
  QCS6490 Python tests and physical-board validation are manual gates today;
  neither is run by `npm test` or the main CI workflow.

| Changed surface | Required relevant checks |
| --- | --- |
| Web/core/simulation | Typecheck and Node tests; build and both Playwright suites for rendered changes |
| Packaging/release | Package/release tests; produce/inspect the affected artifact on its supported host |
| Arduino | `arduino/scripts/test-local.sh`; actual App Lab/LED checks for hardware claims |
| QCS6490 validator | Python validator tests, native ARM64 exporter build, and physical HTP output/profile checks |
| QCS6490 gateway | Runtime Python tests; real vision/reference/profile, CPU language/VLM and idle checks; both browser suites for panel changes |
| Documentation | Parse local links/anchors, check commands/assets against source, and compare numeric tables with authoritative config/reports |

---

## 6. Native preview apps

`native/android` (Gradle/Java WebView host) and `native/windows` (WebView2 + WiX
MSI) wrap the web build as installable previews. Only **source** is tracked; the
local folder may contain large SDK/build outputs that `.gitignore` excludes.
See `docs/native.md`. The web app never imports `native/` — it talks to an
optional native runner over a WebView message channel (`src/runtime/`).

The Debian package is static files plus a loopback Python launcher, built by
`tools/deb.mjs`, not another native inference host. The independent QCS6490
tools export/execute/check a QAIRT graph and do not come with the installers.

---

## 7. Gotchas (learned the hard way)

- **Keep native sources, exclude artifacts.** Review Git status and ignores
  before staging. Do not hand-exclude all of `native/`; CI needs its tracked
  Android/Windows sources. Do not stage SDKs, models, build outputs, or unrelated
  work just because they sit beside those sources.
- **Adding/removing a toolbar button** breaks the hard-coded counts in
  `src/ui/ui.test.mjs` and `tests/browser/app.spec.mjs`. Update both.
- **Large pushes** (e.g. adding GIFs/binaries) can fail with `HTTP 400`
  `send-pack: unexpected disconnect`; fix with
  `git config http.postBuffer 524288000`.
- **The deploy is chained**, not push-triggered. If the site didn't update, check
  that the whole CI matrix went green (not just `verify`).
- **QR codes** are pre-generated static SVGs in `src/assets/` (via
  `npx qrcode -t svg`) — no runtime dependency. Regenerate them if the asset
  URLs change.

---

## 8. Working with multiple agents

This repo is often edited by more than one agent at once. `issues.md` (git-
ignored, local-only) is the coordination/handoff log: read it first, claim a
shared file before rewriting it, record decisions, and preserve the other
agent's edits. Origin moves frequently — expect non-fast-forward pushes and
`git pull --rebase origin main` before pushing.

---

## 9. Conventions

- **TypeScript strict**; `noEmit`. `src/sim/*` imports core with explicit `.ts`
  extensions (matches the existing style); the rest use extensionless imports.
- **DOM** is built with `el(tag, attrs, children)` from `src/ui/dom.ts` — no
  framework. Use **native `<button>`/`<a>`** with `aria-label`s for anything
  interactive (accessibility is tested).
- **Styling** uses the CSS custom properties in `src/styles/tokens.css`
  (`--ink`, `--panel`, `--accent`, …) so day/night theming and customisation are
  one-stop.
- **Commits**: conventional-ish prefixes (`feat:`, `fix:`, `docs:`, `test:`,
  `ci:`). Keep changes additive and reviewable.

---

## 10. Trademarks & scope

Independent, non-commercial, educational. **Not** affiliated with, sponsored by,
or endorsed by Qualcomm. Hexagon, Snapdragon, Adreno and Oryon are trademarks of
Qualcomm Incorporated. See `NOTICE`. Licensed under Apache-2.0 (`LICENSE`).
