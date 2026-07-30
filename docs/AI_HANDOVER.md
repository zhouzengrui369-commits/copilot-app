# Copilot App AI Handover — R31

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`

This is a mirror. Read root authority first, in this order:

1. `AGENTS.md`
2. `goal.md`
3. `plan.md`
4. `rules.md`
5. `delivery.md`
6. `PROJECT_STATE.yaml`
7. `PROJECT_STATUS.md`
8. `TODO.md`
9. `DECISIONS.md`
10. `CHANGELOG.md`

Do not let `docs/PROJECT_STATUS.md` or any other docs mirror override root truth. The full pre-R30 handoff is preserved under `docs/history/`.

## Current Source

- repository: `zhouzengrui369-commits/copilot-app`
- original takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`, PR #12
- candidate-runner parent: `agent/r30-github-bound-candidate-runner`, PR #13
- active source-completion branch: `agent/r31-source-completion`
- active Draft PR: #14
- final SHA rule: use the externally reported final 40-character PR #14 HEAD after final CI; tracked files do not self-embed their own commit

## Current Truth

GitHub Phase 1 source is complete. The Node 24 macOS source gate covers exact checkout/lockfile, candidate contracts, embedded-local RAG, ordered workspace builds, checks, unit/integration suites, desktop build, Phase 1 source suite, strict global and per-file critical coverage, production CycloneDX SBOM, exact list-only `113 tests in 9 files`, and clean tracked source.

At the source-completion checkpoint, desktop passed `1106/1106`; each critical file reached at least 90%, including `local-knowledge-service.ts` branch coverage at 90.00%.

No local candidate has been executed. Candidate identity, artifact SHA256, runtime ID, candidate-bound performance, packaged Electron 113/113, signing, notarization, independent acceptance, and owner gate are all absent.

## R31 Architectural Changes

- production embedding default: deterministic self-contained `embedded-local-hash-v1`;
- Ollama: explicit local-service compatibility only;
- vector persistence: one embedding model at a time, rotate incompatible vectors, preserve durable local text;
- candidate runner: twelve fail-closed gates;
- Gate 2: absolute npm identity and deny-network offline authority;
- Gate 3: every Git-tracked regular file plus aggregate SHA256;
- Gate 5: full Phase 1 source quality and CycloneDX SBOM;
- Gate 6/7: canonical arm64 ZIP/DMG and source/artifact/`app.asar` identity;
- Gate 9: exact 113/9 plus hashes for all E2E specs/fixtures/helpers;
- Gate 11: three distinct candidate-bound `r31-v1` performance runs;
- Gate 12: final manifest and screenshots.

## Role Boundary

- ChatGPT: GitHub source/PR only; local candidate execution forbidden.
- MiniMax Code: exact approved commit, clean detached worktree, new outside-repo evidence directory, no silent source fix.
- Codex: starts only after complete MiniMax receipt; independent real-computer acceptance; no source fix in acceptance lane.

## Next Single Action

Follow `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` with the externally reported final PR #14 SHA. Execute `scripts/candidate-r30/run-candidate.mjs` exactly once after dry-run. On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop and return the blocker; do not retry online.

Return all source/artifact/runtime/test-data/performance/SBOM/command/screenshot/terminal-state receipts plus `CANDIDATE-MANIFEST.json`, `R30-COMPLETE.json`, exact Git identity, and clean final status. Codex remains idle until that package is complete.
