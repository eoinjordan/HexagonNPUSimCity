# Contributing to HexagonNPUSimCity

Thanks for helping improve this explorable model of the Qualcomm® Hexagon™ NPU.
It’s an independent, non-commercial, educational project (Apache-2.0).

**Read [AGENTS.md](AGENTS.md) first** — it’s the single source of truth for
architecture, conventions, and step-by-step extension recipes. This file is the
short version.

## Setup

- Node **>= 22.18**, then `npm ci`.
- `npm run dev` for a hot-reloading dev server.

## The one rule that matters most

Every on-screen figure is **illustrative** — a scaled teaching value, not a
datasheet or measurement. Defaults live in `src/sim/model.ts`
(`DEFAULT_SIM_CONFIG`) and are audited in [docs/verification.md](docs/verification.md).
If you change a default, update that audit in the same PR, and never present a
modelled number as hardware fact.

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
deploy on the whole matrix (web + Android + Windows), so keep all of it green.

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

## Trademarks

Not affiliated with, sponsored by, or endorsed by Qualcomm. Hexagon, Snapdragon,
Adreno and Oryon are trademarks of Qualcomm Incorporated. See [NOTICE](NOTICE).
