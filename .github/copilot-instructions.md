# Copilot instructions — HexagonNPUSimCity

**The full, authoritative guide is [AGENTS.md](../AGENTS.md).** Read it before
making changes. Quick reminders:

- **Figures are illustrative** teaching values, not datasheet/measured numbers.
  Defaults: `src/sim/model.ts` (`DEFAULT_SIM_CONFIG`), audited in
  `docs/verification.md` — update both together.
- **Single source of truth**: districts in `src/world/districts.ts`; workloads,
  formats and figures in `src/sim/model.ts`; colours in `src/core/theme.ts`.
  Read from these; never duplicate a position, colour, or number.
- **UI ↔ world only via the bus** (`src/core/bus.ts`). The world only reads sim
  state. UI overlays expose `{ toggle, close, readonly open }`; build DOM with
  `el()` and use native `<button>`/`<a>` + `aria-label`s.
- **Adding a toolbar button?** Update the button-count assertions in
  `src/ui/ui.test.mjs` **and** `tests/browser/app.spec.mjs`.
- **Before pushing**: `npm run typecheck`, `npm test`, and for anything rendered
  `npm run test:browser` + `npm run test:app`. CI gates the live Pages deploy on
  the **whole** matrix (web + Android + Windows), so keep all of it green.
- **`native/` is ~1.1 GB locally** but `.gitignore` stages only its ~17 source
  files — don't hand-exclude `native/`, CI builds that source.
- Extension recipes (district, workload, figure, overlay, flow, test) are in
  [AGENTS.md §4](../AGENTS.md#4-how-to-extend-recipes).
- Coordinate multi-agent work through `issues.md` (local, git-ignored).
