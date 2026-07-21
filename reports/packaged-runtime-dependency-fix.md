# Packaged Runtime Dependency Fix

## Verdict

PASS for the bounded dependency-closure repair. The Desktop production factory directly loads four workspace runtime packages, and all four are now explicit `@copilot/desktop` runtime dependencies at version `0.1.0`. No product source, builder/release script, coverage configuration, threshold, or release candidate was changed.

## Root cause and exact change

`createProductionKnowledgeService` directly calls `loadPackage` for:

- `@copilot/kb`
- `@copilot/kg`
- `@copilot/llm-client`
- `@copilot/rag`

Only `@copilot/kg` was previously explicit in `apps/copilot-desktop/package.json`; package assembly therefore depended on transitive workspace closure and omitted `@copilot/rag` from the packaged application.

Lane-owned changes:

- `apps/copilot-desktop/package.json`: added direct runtime dependencies `@copilot/kb`, `@copilot/llm-client`, and `@copilot/rag`, all `0.1.0`; retained existing direct `@copilot/kg: 0.1.0`.
- `package-lock.json`: added the same three entries only under `packages["apps/copilot-desktop"].dependencies`. Existing workspace link/package records already covered all four packages, so no install or network operation was needed.
- `apps/copilot-desktop/tests/packaged-runtime-dependencies.test.ts`: added a TypeScript-AST regression test that fails closed on missing/duplicate/non-literal `loadPackage` calls, requires the factory load set to be the four expected packages, and compares every loaded package with Desktop direct dependencies at `0.1.0`.

The two package files were already shared/dirty before this lane. Only the dependency lines above belong to this repair; unrelated existing hunks were preserved.

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `node_modules/.bin/vitest run apps/copilot-desktop/tests/packaged-runtime-dependencies.test.ts` | 0 | 1 file, 2/2 tests PASS |
| `npm run check --workspace @copilot/desktop` | 0 | main, renderer, and test TypeScript checks PASS |
| `npm run build --workspace @copilot/desktop` | 0 | main/renderer builds PASS; `RENDERER_BUNDLE_VERIFIED: files=7` |
| `node_modules/.bin/vitest run --coverage --config apps/copilot-desktop/tests/vitest.desktop-coverage.config.ts` | 0 | 50 files, 747/747 tests PASS; S 77.18%, B 88.05%, F 92.81%, L 77.18% |
| `node_modules/.bin/vitest run --coverage --config apps/copilot-desktop/tests/vitest.critical-coverage.config.ts` | 0 | 50 files, 747/747 tests PASS; S 97.86%, B 94.55%, F 97.37%, L 97.86%; critical per-file gate PASS |
| dependency parity JSON probe (Desktop package vs lockfile) | 0 | kb/kg/llm-client/rag all exactly `0.1.0` in both |
| `git diff --check -- apps/copilot-desktop/package.json package-lock.json apps/copilot-desktop/tests/packaged-runtime-dependencies.test.ts` | 0 | PASS |

Known stderr from the canonical suites is pre-existing/non-failing test noise (`act(...)`, a non-awaited rejection warning, and jsdom canvas not implemented); both canonical commands exited 0 with all tests passing.

## SHA-256 after verification

| File | SHA-256 |
| --- | --- |
| `apps/copilot-desktop/package.json` | `fdf8e8886c0874b5836968239ea791511df4ac9837f64a731dc7391ea2fbee1d` |
| `package-lock.json` | `a3ccbede76ecaf5dd5d5f7511b5295d88adfdf909ba35777eb349c0032352b06` |
| `apps/copilot-desktop/tests/packaged-runtime-dependencies.test.ts` | `f15fe06cfb8e350d3c486e9b19a6b11a84128ce9fb0920197013e01d3b4fc644` |

## Remaining release action

This repair deliberately did not create or mutate r22-r25 and did not build r26. PM must use a fresh candidate to prove that the packaged `app.asar` contains all four direct runtime packages and rerun release-mode Electron E2E.
