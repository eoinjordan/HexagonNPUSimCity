# CLAUDE.md

See **[AGENTS.md](AGENTS.md)** — it is the single source of truth for building,
testing, and extending HexagonNPUSimCity, and applies to every agent (Claude
included).

Top reminders:

- On-screen figures are **illustrative**, not hardware facts. Defaults in
  `src/sim/model.ts` (`DEFAULT_SIM_CONFIG`), audited in `docs/verification.md` —
  change them together.
- Single sources of truth: `DISTRICTS` (`src/world/districts.ts`),
  `WORKLOADS`/`PRECISIONS`/`DEFAULT_SIM_CONFIG` (`src/sim/model.ts`), `COLOR`
  (`src/core/theme.ts`). Read from them; don't duplicate.
- UI talks to the world only through the bus (`src/core/bus.ts`).
- Before pushing: `npm run typecheck`, `npm test`, and — for rendered changes —
  `npm run test:browser` + `npm run test:app`. Adding a toolbar button? Update
  the counts in `src/ui/ui.test.mjs` and `tests/browser/app.spec.mjs`.
- The Pages deploy is chained behind the **full** CI matrix (web + Android +
  Windows). Coordinate multi-agent work in `issues.md`.
