# Changelog

## 2026-08-01 — R34 KnowledgeGraph test isolation

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`.

- PR #16 run `30691755888` passed install, source contracts, RAG, ordered build,
  local-first, core tests, desktop build, Phase 1 suite and core coverage, then
  failed one of `1107` desktop critical tests.
- The same KnowledgeGraph test passed earlier in the same run; the failure was
  an immediate harness read after the toolbar reached `100 / 100 nodes`.
- R34 wraps only that harness assertion in RTL `waitFor`; all semantic
  assertions, production source and coverage thresholds remain unchanged.
- MiniMax focused evidence is `5/5 PASS`; the entire KnowledgeGraph test file is
  `17/17 PASS`. A sibling-dependency full run is not accepted as a complete
  gate because the app-local Electron guard correctly failed.
- Next: commit/push R34 and require a clean GitHub source gate before merging
  PR #16 or creating a new candidate.

## 2026-08-01 — R33 npm config isolation repair

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`.

- PR #15 and PR #14 head `e91b37618638da0b2ac864c368cde232079e3bee`
  passed the full 17-step GitHub source gate.
- The first exact-SHA hydration stopped before candidate creation because npm
  11.8.0 rejects loading `/dev/null` as both user and global config.
- R33 replaces that duplicate path with two distinct, exclusive, mode-0600
  empty config files outside the repository while preserving inherited
  proxy/registry/token stripping and explicit reviewed proxy overrides.
- Added direct RED reproduction and GREEN isolation/fail-closed tests; focused
  candidate contract suite is `29/29 PASS` and `git diff --check` passes.
- The first PR #16 gate exposed an existing governance contract requiring
  `github_source: SOURCE_COMPLETE`; R33 preserves that source-capability token
  while keeping candidate/runtime readiness separately blocked.
- No dependency install, hydration retry, candidate, Electron, artifact,
  signing, notarization, database, cloud, or user-data change was performed.

Next: clean GitHub CI, merge into PR #14, freeze the new exact SHA, then make
one fresh hydration/candidate attempt. Rollback is a source-only revert.

## 2026-08-01 — R32 Codex/MiniMax Takeover And Source-Gate Recovery

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY /
EXPERIENCE_NOT_READY`.

- Reconciled Draft PR #14 head
  `c3bb0ecf64ab841707b954dfa05728fd44652a79` with source-gate run
  `30682977003` / job `91323461797`: four date-sensitive failures in two test
  files, `1103/1107` passed.
- Created clean branch `codex/r32-ci-date-stability` from that exact head and
  repaired only the two affected test files.
- Independently reran the focused files with direct exit `0`, `47/47 PASS`.
- Kept local tests TSC and phase1-release as NOT_ACCEPTED because the available
  reused dependency tree has Vite/Vitest type-identity drift and violates the
  app-local Electron guard. Clean GitHub CI is the next source authority.
- Reinstated Codex as parent PM/acceptance owner and MiniMax Code CLI as the
  primary bounded implementation worker; GitHub remains durable source truth.
- Prioritized the single-user macOS MVP and deferred broad enterprise security
  review and other post-MVP scope without weakening local-first, credential,
  no-egress, persistence, or evidence-integrity controls.

Reason: restore one current project truth and remove calendar drift before
spending resources on candidate creation. Impact: no production behavior or
MVP readiness changed; only tests and governance are under repair.

## 2026-08-01 — R31 Owner-Approved NPM Cache Hydration Closure

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`. GitHub completed only source, test, governance, and exact-commit handoff work. No local hydrated cache, candidate, packaged Electron runtime, artifact identity, Codex acceptance, signing, notarization, Release, or Human Owner Gate is claimed.

### Root cause

- MiniMax correctly reached candidate Gate 2 on the previously frozen SHA and stopped with `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED` because the existing npm cache could not satisfy `npm ci --offline`.
- The candidate contract correctly prohibited an online retry, but the repository did not yet contain an auditable, separately owner-approved cache-hydration path.
- The initial hydration implementation exposed three source-contract defects before local use:
  - root `TODO.md` no longer carried the exact `scripts/candidate-r30/minimax-authority.mjs` and `EXACT_FINAL_HEAD` governance tokens;
  - the authority verifier expected an obsolete Codex handoff sentence instead of the exact versioned-document sentence;
  - the lock-origin parser treated npm lockfile v3 plain relative workspace resolutions such as `apps/copilot-cloud` as network origins.

### Source implementation

- Added the owner-gated `scripts/candidate-r30/npm-cache-hydrate.mjs` flow and kept it separate from candidate execution.
- Require the exact token `OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS`, an exact clean detached source commit, new outside-repository cache/receipt paths, and no repository `.npmrc`.
- Strip inherited proxy, registry, token, and npm user/global configuration authority and disable lifecycle scripts.
- Confine the npm child to a localhost CONNECT proxy under `sandbox-exec`; the parent proxy accepts only `registry.npmjs.org:443` and records every request.
- Require a deny-network `npm ci --ignore-scripts --offline` proof before emitting the exclusive source/lock/cache-bound hydration receipt.
- Bind the candidate runner to paired `--npm-cache-dir` and `--npm-cache-receipt` inputs, validate their exact bytes before Gate 2, and keep the candidate itself under `(deny network*)` with `npm ci --offline`.
- Accept npm lockfile v3 plain relative workspace resolutions only when they are safe `apps/...` or `packages/...` paths and exactly match a non-link package entry in the same lockfile graph.
- Continue rejecting traversal, absolute, backslash, unknown workspace, unreviewed host, credential-bearing, non-HTTPS, Git, SSH, and GitHub dependency origins.
- Align the deployment-authority marker with the actual versioned Codex handoff sentence and restore exact governance tokens in root `TODO.md`.

### RED → GREEN tests

- Added source tests for exact owner approval, new absolute paths, localhost-only sandbox authority, reviewed registry origins, lockfile workspace-path binding, cache identity tamper, exclusive receipt validation, paired candidate cache arguments, and offline-only plan truth.
- The real root `package-lock.json` is now validated directly, including `apps/copilot-cloud` as a package-graph-bound workspace resolution.
- Negative tests reject `../apps/cloud`, `/apps/cloud`, `apps\\cloud`, unknown `apps/missing`, and non-workspace `tools/cloud` resolutions.
- The complete Node 24/macOS source gate remains mandatory on the final externally reported PR #14 HEAD; no tracked file self-embeds its containing commit.

### Governance and handoff

- Updated root TODO authority tokens and retained the executable `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` hydration/candidate separation.
- All previously reported deployment SHAs are invalid after these tracked source changes.
- MiniMax must use a new hydration worktree, new isolated cache, new receipt, separate new candidate worktree, and new evidence directory against the final externally supplied exact SHA.
- Existing failed worktrees, evidence, caches, receipts, and `/tmp` probes remain `REFERENCE_ONLY` and must never be reused.

Rollback: revert the bounded cache-hydration, receipt-binding, workspace-lock policy, governance-token, and authority-marker commits. Rollback creates no database, candidate, artifact, runtime, cloud, signing, notarization, or user-data migration because none were produced by GitHub execution.

## 2026-07-31 — R31 Exact-Object Authority Command Marker Closure

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`. No local candidate worktree, candidate evidence directory, packaged Electron execution, signing, notarization, independent Codex acceptance, Release, or Human Owner Gate was created by this GitHub repair.

### Root cause

- MiniMax correctly fetched and bound the exact Git object, then Gate 0 returned `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`.
- The versioned authority document used the valid repository-scoped command `git -C "$REPO" worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"`.
- `scripts/candidate-r30/minimax-authority.mjs` incorrectly required the contiguous literal substring `git worktree add --detach` through `String.prototype.includes`, so inserting Git's valid `-C <repo>` option caused a false blocker.
- The original unit fixture was built from `REQUIRED_AUTHORITY_MARKERS` itself and therefore could not detect drift between the verifier and the real versioned authority document.

### Source implementation

- Split literal prose markers from executable-command validation in `scripts/candidate-r30/minimax-authority.mjs`.
- Added a bounded detached-worktree command pattern that accepts both `git worktree add --detach` and `git -C <repo> worktree add --detach`.
- Kept `--detach` mandatory; a worktree command without it still returns `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID` with the stable missing-marker label `git worktree add --detach`.
- Preserved exact-object reads, runner co-location checks, SHA256 authority identity, exclusive outputs, no-network truth, and no-candidate-state truth.

### RED → GREEN tests

- The RED evidence is MiniMax's exact-object Gate 0 blocker against the previously approved source SHA: the authority document and verifier disagreed even though neither local source nor candidate state had been modified.
- Expanded `scripts/candidate-r30/minimax-authority.test.mjs` to cover direct and repository-scoped detached-worktree commands.
- Added a negative regression requiring `--detach`.
- Added a regression that reads and validates the real `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` file instead of only a self-generated fixture.
- The repaired source checkpoint completed all 17 `copilot-source-gate` steps on Node 24/macOS, including candidate source contracts, desktop Phase 1 source tests, strict global/per-file coverage, CycloneDX SBOM, exact `113 tests in 9 files` discovery, and tracked-source cleanliness.

### Governance and handoff

- Updated `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, and this changelog with the second deployment-authority incident and its closure.
- The previously supplied SHA `205eef52927c44c4eff65d72e6cea3ac9c0c064c` is invalidated by subsequent tracked repair commits and must not be executed again.
- The new exact final PR #14 HEAD is supplied externally only after the last governance commit passes the complete source gate; tracked files deliberately do not self-embed their containing commit.

Rollback: revert the bounded authority-command validation and regression-test commits. A rollback creates no database, candidate, artifact, runtime, cloud, signing, notarization, or user-data migration because none were produced.

## 2026-07-31 — R31 Exact-Object Deployment Authority

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`. No local candidate, packaged Electron execution, signing, notarization, independent Codex acceptance, Release, or Human Owner Gate was created by this GitHub work.

### Root cause

- MiniMax searched two stale local worktrees for `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` before fetching and binding the externally approved PR commit.
- The document existed in the approved exact Git object, so the reported `MISSING_DEPLOYMENT_AUTHORITY` was a stale-checkout false blocker rather than missing versioned authority.

### Source implementation

- Added `scripts/candidate-r30/minimax-authority.mjs`.
- The verifier reads `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and confirms `scripts/candidate-r30/run-candidate.mjs` directly from `<exact SHA>:<path>`.
- It validates required fail-closed markers, records authority bytes/lines/SHA256, and emits an exclusive receipt.
- It fails closed with stable codes for an unavailable commit, missing/invalid authority, missing runner, invalid arguments, relative output paths, and output overwrite.
- Its receipt explicitly states `networkUsed=false`, `worktreeCreated=false`, and `evidenceCreated=false`.

### RED → GREEN tests

- Added `scripts/candidate-r30/minimax-authority.test.mjs` with five tests covering exact argument validation, document-marker validation, exact-object reads despite stale checkout bytes, missing commit/document blockers, and exclusive materialization.
- Added governance assertions that the MiniMax handoff fetches PR #14, compares the exact SHA, uses `git cat-file`/`git show`, invokes the verifier, and never treats current-worktree presence as authority.
- Candidate source contracts still execute through `node --test scripts/candidate-r30/*.test.mjs`; the complete GitHub source gate remains required on the final externally supplied SHA.

### Handoff and governance

- Rewrote `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` to bootstrap authority from the exact Git object before creating a candidate worktree or evidence directory.
- Added PR-head equality, authority SHA256 receipt, stable pre-candidate blocker handling, and an explicit prohibition on cron/file-presence auto-execution.
- Updated root state/status/TODO/decisions and docs mirrors/workflow/README.
- The exact final PR #14 HEAD remains externally supplied only after the last tracked commit passes the complete source gate; no tracked file self-embeds its own containing commit.

Rollback: revert the bounded authority-bootstrap commits on Draft PR #14. The rollback does not require database, artifact, runtime, cloud, signing, notarization, or user-data changes because none were produced.

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
