# Contributing to HexagonNPUSimCity

Thanks for helping improve this explorable model of the Qualcomm® Hexagon™ NPU.
It’s an independent, non-commercial, educational project (Apache-2.0).

**Read [AGENTS.md](AGENTS.md) first** — it is the entry point for
architecture, conventions, and step-by-step extension recipes. This file is the
short version. Platform commands live in [the runtime guide](docs/native.md),
[Arduino guide](arduino/README.md), and
[QCS6490 NPU guide](docs/qcs6490-npu.md).

## Setup

- Node **>= 22.18**, then `npm ci`.
- `npm run dev` for a hot-reloading dev server.

## The one rule that matters most

Simulation figures are **illustrative** — scaled teaching values, not
datasheet or measurement claims. Defaults live in [src/sim/model.ts](src/sim/model.ts)
(`DEFAULT_SIM_CONFIG`) and are audited in [docs/verification.md](docs/verification.md).
If you change a default, update that audit in the same PR, and never present a
modelled number as hardware fact.

Separately measured readouts and reports need an identified device, runtime,
workload, timing scope, and evidence. The QCS6490 arithmetic result does not
validate an LLM, other operating systems, HMX-only execution, or city meters.
The tested GenieX v68 path failed; do not turn its HTP0 listing into a pass.

## Before you open a PR

Run and pass:

```bash
npm run typecheck
npm test
# if you touched anything rendered (HUD, overlays, scene, toolbar):
npx playwright install chromium   # once
npm run test:browser
npm run test:app
```

Note: adding/removing a toolbar button means updating the button-count assertions
in `src/ui/ui.test.mjs` **and** `tests/browser/app.spec.mjs`. CI gates the live
deploy on the whole matrix (web + Debian packaging + Android + Windows), so
keep all of it green. The Arduino workflow is separate.

For the relevant Python surfaces, also run:

```sh
arduino/scripts/test-local.sh
python3 -m unittest discover -s tools -p 'test_qnn_validate.py' -v
python3 -m unittest discover -s tools -p 'test_qcs6490_runtime.py' -v
```

Neither command proves physical-device execution. Reproduce QCS6490 output and
profile checks on the supported board when changing its hardware-validation
path. Native installer changes require checks on their supported platform;
cross-compilation alone does not prove install/uninstall or QNN operation.

The board gateway intentionally uses different backends: NPU image classification,
CPU language/VLM, and no-dispatch idle. Preserve those labels and the legacy
streaming/image API when changing the service. Document deployment and rollback,
and compare any new model outputs with a suitable independent reference before
promoting its hardware support.

For docs changes, verify local links and heading anchors, runnable commands,
release asset names, and numeric tables against the actual source/reports. Keep
historical evidence historical; record a new date and method for new results.
Do not claim a release is live from workflow configuration or a local build.

## Adding things

Recipes for adding a district, workload, illustrative figure, UI overlay,
dataflow, bus event, or test are in [AGENTS.md §4](AGENTS.md#4-how-to-extend-recipes).
Keep the single-source-of-truth lists (`DISTRICTS`, `WORKLOADS`,
`DEFAULT_SIM_CONFIG`, `COLOR`) authoritative — read from them, don’t duplicate.

## Style

- TypeScript strict; DOM via the `el()` helper (no framework); native
  `<button>`/`<a>` + `aria-label`s for interactive elements.
- Style with the CSS tokens in `src/styles/tokens.css`.
- Commit prefixes: `feat:`, `fix:`, `docs:`, `test:`, `ci:`.

## Evidence And Shared Work

Read the local, Git-ignored `issues.md` before editing shared files and preserve
other contributors' work. Do not commit that coordination log, SDKs, model
weights, access tokens, private SSH keys, or proprietary runtime bundles.
Licensed SDK dependencies remain external; measurement reports should retain
binary hashes, limits and failures without pretending to be certification.

Release asset names are stable contracts because existing QR codes encode them.
New releases are drafted, but reruns can replace assets on an existing published
release. Check [release behavior](docs/native.md#automation-and-release-gates)
before publishing, and never push or tag as an implicit part of a documentation
or validation task.

## Trademarks

Not affiliated with, sponsored by, or endorsed by Qualcomm. Hexagon, Snapdragon,
Adreno and Oryon are trademarks of Qualcomm Incorporated. See [NOTICE](NOTICE).
