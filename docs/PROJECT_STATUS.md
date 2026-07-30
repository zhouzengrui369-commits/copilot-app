# Copilot App Project Status — Mirror

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`

Root authority must be read first: `goal.md`, `plan.md`, `rules.md`, `delivery.md`, `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md`. This mirror cannot override them.

## Current Stage

GitHub Phase 1 source development is complete on `agent/r31-source-completion`, Draft PR #14. The exact final 40-character PR HEAD will be recorded externally after the last documentation CI succeeds.

Source completion includes the self-contained embedded-local RAG default, explicit Ollama compatibility, single-model vector rotation preserving durable text, fail-closed product/source paths, a Node 24 source gate, production CycloneDX SBOM validation, strict global/per-file critical coverage, exact Electron list-only `113 tests in 9 files`, and a twelve-gate local candidate runner.

At the source-completion checkpoint, the desktop Phase 1 suite passed `1106/1106`; each critical file reached at least 90%, including `local-knowledge-service.ts` branch coverage at 90.00%.

## What Is Not Established

- no local exact-commit candidate;
- no source snapshot/artifact/app/executable/`app.asar` SHA256 receipt;
- no runtime ID;
- no focused packaged Electron 2/2 or full 113/113 candidate evidence;
- no three-run candidate-bound performance receipt;
- no independent Codex acceptance;
- no Developer ID signing or Apple notarization;
- no Human Owner Gate.

Therefore GitHub source completion must not be reported as MVP completion or Release readiness.

## Role Boundary

1. ChatGPT develops source through GitHub only.
2. MiniMax Code executes the exact approved final commit locally and returns complete evidence; no silent source fix.
3. Codex independently operates and evaluates the packaged app only after the receipt exists; no source fix in acceptance.

## Next Action

MiniMax Code follows `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`, creates a new clean detached worktree at the exact final PR #14 SHA, uses a new absolute evidence directory outside the repository, runs source contracts and dry-run, then executes `scripts/candidate-r30/run-candidate.mjs` once.

The runner requires twelve gates, including offline deny-network install, complete SHA256 ledger, source quality/SBOM, canonical arm64 package identity, focused/full Electron, exact 113/9 discovery with complete E2E source manifest, three-run performance, screenshots, and final manifest.

On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop without online retry. Codex remains idle until the MiniMax return package is complete.
