# Copilot App Risks — R31 Mirror

`BLOCKED / MVP_NOT_COMPLETE`

Root `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, and `rules.md` are authoritative.

## R1 — Source Completion Could Be Misreported As Product Completion

**State:** OPEN / P0 governance risk.

GitHub checks prove source contracts only. They do not prove the local packaged candidate, real user machine behavior, signing, notarization, installation, independent acceptance, or owner use.

**Control:** every current document keeps `BLOCKED / MVP_NOT_COMPLETE`; candidate/runtime fields remain null until MiniMax returns exact-commit evidence.

## R2 — Mutable Branch, Self-Referential Commit, Or Stale Worktree Handoff

**State:** CONTROLLED pending final authority-bootstrap CI.

A branch can move, a tracked file cannot truthfully contain the commit that contains itself, and a stale worktree may not contain a document that does exist in the approved exact Git object. Searching only old local paths can therefore produce a false `MISSING_DEPLOYMENT_AUTHORITY` blocker.

**Control:** after final docs CI, record the exact 40-character PR #14 HEAD externally. MiniMax explicitly fetches `refs/pull/14/head`, proves `FETCH_HEAD` equals that SHA, then reads and hashes `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and verifies `scripts/candidate-r30/run-candidate.mjs` from `<SHA>:<path>` using `scripts/candidate-r30/minimax-authority.mjs`. Current-worktree file presence is non-authoritative. Any later commit invalidates the handoff.

## R3 — R28 Evidence Reuse

**State:** CONTROLLED / permanent prohibition.

R28 was never executed and failed review because Gate 3 SHA256 evidence was malformed/incomplete, Gate 2 network authority was not fail-closed, and Gate 9 did not bind exactly `113 tests in 9 files`.

**Control:** never run, repair, copy, or promote R28. R30/R31 uses a new runner identity and new evidence directory.

## R4 — Network Or npm Cache Authority Drift

**State:** OPEN until local execution.

The local npm cache may be incomplete. An implicit online retry would violate the approved network boundary.

**Control:** resolve an absolute npm executable, strip proxy/registry authority, run every recorded command through macOS `sandbox-exec` with `deny network*`, and use offline npm. `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED` stops execution; no online retry. Any exception requires separate reviewed owner approval. The one explicit GitHub fetch used to acquire the exact source commit occurs before candidate execution and does not grant npm registry authority.

## R5 — SHA256 Ledger Incompleteness Or Symlink Substitution

**State:** SOURCE CONTROL CLOSED; runtime execution pending.

A selected control-file list or path-following read could omit or substitute candidate inputs.

**Control:** Gate 3 consumes `git ls-files -z`, requires the exact complete path set, opens each file no-follow through one handle, requires a regular single-link file, records byte size and SHA256, and binds an aggregate SHA256.

## R6 — Packaging Identity Drift

**State:** OPEN until local execution.

A source build, generated ZIP, extracted app, executable, or `app.asar` can diverge.

**Control:** canonical manifest and source snapshot are bound to the exact source commit. Gate 7 records ZIP, DMG, app, executable, and `app.asar` hashes. macOS `.app` is treated as one atomic artifact; nested Electron Helper.app bundles cannot be counted as separate candidates.

## R7 — Incompatible Embedding Vectors

**State:** SOURCE CONTROL CLOSED; migration behavior must be observed locally.

Vectors from different provider/model/dimension identities could be mixed and produce invalid retrieval.

**Control:** one-model vector invariant; rotate incompatible vectors while preserving durable local text and source notes. The packaged default is deterministic `embedded-local-hash-v1`; Ollama is explicit local-service opt-in only.

## R8 — Grounding Or Canonical Readback Inflation

**State:** SOURCE CONTROL CLOSED; packaged verification pending.

Renderer state or provider output could appear successful without local source/Todo truth.

**Control:** exact local source readback, source previews, latest-completed exchange persistence, main and renderer Todo canonical readbacks, fail-closed WIKI revision/digest truth, and no green state for missing/stale/unknown evidence.

## R9 — Local ASR Source Contract Mistaken For Offline Runtime Proof

**State:** OPEN.

Source and package tests cannot prove microphone permission, audio preprocessing, worker assets, cancellation, transcript quality, or no-egress behavior in the final packaged app.

**Control:** Gate 10/11 candidate execution plus independent Codex real-computer offline verification. No remote fallback is permitted.

## R10 — Electron Test Fixture Or Process Evidence Contamination

**State:** OPEN until candidate execution.

Shared userData, overwritten receipts, reused screenshots, or orphaned Electron processes could blend evidence.

**Control:** producer-scoped userData, exclusive receipts, exact candidate/runtime binding, complete E2E source manifest, zero skipped/unexpected/flaky full result, clean process exit, Gate 12 screenshots, and no evidence-directory reuse.

## R11 — Candidate Performance Reuse Or Synthetic Aggregation

**State:** OPEN.

Historical performance files or repeated challenges could be presented as three independent runs.

**Control:** Gate 11 uses three fixed raw basenames, unique challenge SHA256 values, ordered captured timestamps, exact candidate/executable/`app.asar`/canonical source binding, raw byte hashes, and one strict aggregate.

## R12 — CycloneDX Root Identity Variation

**State:** SOURCE CONTROL CLOSED.

npm 11 may identify the SBOM application root by checkout directory rather than package name.

**Control:** accept only the two reviewed identities `openclaw-workbench@0.1.0` and `copilot-app@0.1.0`; still require application type, exact version, nonempty bom-ref, valid optional purl, nonempty components, dependency array, unique component refs, and no private path/secret leakage.

## R13 — Signing And Notarization

**State:** OPEN / release blocker.

An unsigned diagnostic ZIP/DMG is not a distributable macOS Release.

**Control:** Developer ID identity, hardened runtime/entitlements, notarization, stapling, validation, Gatekeeper installation/launch, and independent Release Gate evidence remain required.

## R14 — Deferred Scope Inflation

**State:** CONTROLLED.

Windows, Tencent deployment, Remote/live, Backup, or 3D graph could be described as Phase 1 delivered functionality.

**Control:** Windows real-machine/signing/install/screenshots are Phase 1.1; Tencent/Remote/Backup and 3D graph are post-MVP unless Owner explicitly changes scope. Deferred sources cannot produce current readiness claims.

## R15 — Authority Verifier Could Mutate Candidate State

**State:** SOURCE CONTROL CLOSED; final CI pending.

A bootstrap helper that fetched dependencies, created worktrees, or created candidate evidence would blur the GitHub-to-MiniMax boundary before exact authority was established.

**Control:** `scripts/candidate-r30/minimax-authority.mjs` uses Git object reads only. Its receipt states `networkUsed=false`, `worktreeCreated=false`, and `evidenceCreated=false`; outputs are optional absolute paths created exclusively with owner-only permissions. Tests reject missing commit objects, missing/invalid authority documents, missing runners, relative outputs, and output overwrite.
