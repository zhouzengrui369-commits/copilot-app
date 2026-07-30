# Changelog

## 2026-07-30 — R31 Phase 1 Source Completion

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY` because the exact final commit has not yet been executed locally, independently accepted, signed, notarized, or owner-approved.

### Product source

- Added `embedded-local-hash-v1` as the self-contained deterministic production embedding default. It requires no HTTP endpoint, process spawn, model download, native addon, cloud fallback, or external local service.
- Kept Ollama only as an explicit local-service compatibility provider.
- Added a single-model vector-store invariant. Incompatible vector rows are removed during model rotation while durable local text remains available for deterministic fallback and re-indexing.
- Preserved and expanded fail-closed contracts for grounded Ask/source truth, canonical Todo readback and restart continuity, WIKI revision truth, reversible Trash, IPC/preload, Markdown/VoiceInput, local ASR, native binding validation, calendar/capture workflows, and release identity.

### Source validation

- Added a Node 24 macOS `copilot-source-gate` that binds the exact PR HEAD and exact lockfile.
- Required all local-first workspace checks, ordered LLM → KB → KG → RAG builds, core unit/integration suites, desktop Phase 1 release suite, strict global coverage, strict per-file critical coverage, production CycloneDX SBOM, exact Electron list-only discovery, and clean tracked source.
- Closed the desktop Phase 1 source checkpoint at `1106/1106` tests. Every critical file reached at least 90% per-file coverage; `local-knowledge-service.ts` branch coverage reached exactly 90.00%.
- Kept exact Electron list-only discovery at `113 tests in 9 files`; GitHub did not launch the packaged Electron candidate.
- Bound the npm 11 SBOM root compatibility contract to exactly the package identity `openclaw-workbench@0.1.0` or the reviewed checkout identity `copilot-app@0.1.0`, rather than weakening root validation.

### Candidate runner

- Expanded the R30 successor into a twelve-gate exact-commit local candidate contract.
- Gate 2 now resolves and records an absolute npm executable before entering the fail-closed macOS network sandbox.
- Gate 3 now hashes every Git-tracked regular file with no-follow reads and records an aggregate SHA256.
- Gate 5 now includes the complete Phase 1 source suite, strict global/critical coverage, desktop build, and production CycloneDX SBOM.
- Gate 6 now routes the legacy canonical builder through an R31 macOS-arm64 authority wrapper. The wrapper independently revalidates the selected arm64 ZIP, DMG, release identity, per-artifact identity reports, source snapshot, byte sizes, and SHA256 values. Legacy x64/Windows matrix blockers are quarantined only after those arm64 checks pass; an arm64 build/DMG/identity blocker remains fatal.
- Gate 7 binds snapshot, ZIP, DMG, app, executable, and `app.asar` identities.
- Gate 9 hashes every E2E spec, fixture, and helper in addition to exact `113 tests in 9 files` discovery.
- Gate 11 requires three distinct candidate-bound `r31-v1` performance records plus one hash-bound aggregate.
- Gate 12 owns screenshots and the final candidate manifest/receipt.
- macOS `.app` bundles are treated as atomic candidate artifacts so nested Electron Helper.app bundles cannot be misclassified as additional candidates.

### Governance and handoff

- Updated `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md`, and all six docs mirrors for PR #14 / R31 source completion.
- Added `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` as the executable exact-commit deployment handoff.
- The exact final PR #14 HEAD is supplied externally after the final documentation CI succeeds; tracked files deliberately do not self-embed their containing commit.
- ChatGPT remains GitHub-source-only, MiniMax Code remains exact-commit local executor, and Codex remains independent real-computer acceptance authority.

Rollback: revert the bounded R31 Draft PR. No local candidate, database migration, signed artifact, notarized package, cloud deployment, or independent product acceptance was created by this remote GitHub work.

## 2026-07-30 — R30 GitHub-Bound Candidate Runner

Status remained `BLOCKED / MVP_NOT_COMPLETE`.

- Reconciled all six low-confidence `main` handoff documents. `docs/ARCHITECTURE.md` routes to the byte-preserved detailed architecture at `docs/history/ARCHITECTURE_PRE_R30.md`; generic placeholders cannot override root v6.2 truth.
- Preserved the exact pre-R30 root `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `CHANGELOG.md`, and detailed architecture under `docs/history/`; current-state updates do not erase accepted evidence or prior blockers.
- Added a brand-new R30 successor. R28 remains `NEVER_RUN / PERMANENTLY_REJECTED` and is not copied, repaired, executed, or reused.
- Gate 1 binds the full GitHub commit, clean tracked/untracked state, absence of stale ignored build/test outputs, and a new realpath-validated evidence directory outside the repository.
- Gate 2 uses macOS `sandbox-exec` with `(deny network*)`, strips proxy/registry authority, and permits only `npm ci --offline --no-audit --no-fund`. Cache miss stops for separate approval; no online retry exists.
- Gate 3 computes a complete regular-file control ledger with exact lower-case SHA256 values and rejects missing, duplicate, unknown, malformed, symlinked, or nonregular entries.
- Gate 9 requires exactly `113 tests in 9 files`; Gate 10 subsequently requires exact 113/113 with zero skipped/unexpected/flaky and clean process exit.
- No npm install, product build, package, Electron candidate, signing, notarization, independent Codex acceptance, Release, or Human Owner Gate was executed by ChatGPT.

## Preserved history

The complete pre-R30 root governance record from `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd` is preserved byte-for-byte at `docs/history/PROJECT_STATE_PRE_R30.yaml`, `docs/history/PROJECT_STATUS_PRE_R30.md`, `docs/history/TODO_PRE_R30.md`, [`docs/history/CHANGELOG_PRE_R30.md`](docs/history/CHANGELOG_PRE_R30.md), and `docs/history/ARCHITECTURE_PRE_R30.md`.
