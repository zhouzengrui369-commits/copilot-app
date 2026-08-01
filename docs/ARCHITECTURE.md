# Copilot App Architecture — R31 Current Mirror

> Authority: this document is a maintained architecture mirror. Root `goal.md`, `plan.md`, `rules.md`, `delivery.md`, `PROJECT_STATE.yaml`, and `PROJECT_STATUS.md` override it. The complete pre-R30 detailed architecture remains byte-preserved at [`history/ARCHITECTURE_PRE_R30.md`](history/ARCHITECTURE_PRE_R30.md).
>
> Status: `BLOCKED / MVP_NOT_COMPLETE`. PR #14 is under date-stability repair;
> no local exact-commit candidate, independent Codex acceptance, or Human Owner
> Gate exists.

## 1. Architectural Principles

### 1.1 Local-First Product Authority

The Electron desktop application is the product and data authority. Notes, bodies, metadata, WIKI projections, knowledge graph rows, RAG text/vector indexes, Todo records, schedules, Trash state, and the latest completed grounded Ask exchange remain local. Optional cloud or local-service adapters may assist computation, but they cannot become the authority for a local mutation.

A local write is successful only when the local durable owner accepts and canonically reads it back. Cloud backup enqueueing, provider response, renderer state, and optimistic UI cannot replace that readback.

### 1.2 Fail-Closed Truth

The product uses explicit truth states rather than optimistic badges:

- WIKI: queued, running, current/ready, failed, not-ready;
- Ask sources: checking, local-present, missing, unavailable, unknown;
- deployment authority: not-fetched, missing, invalid, exact-object-pass;
- candidate: not-run, blocked, complete unsigned diagnostic candidate;
- Release: blocked until signed/notarized/accepted;
- optional Remote/Backup: disabled or unavailable unless explicitly enabled and proven.

Missing, stale, malformed, ambiguous, provider-unavailable, or identity-mismatched evidence cannot become green success.

### 1.3 Role Separation

- GitHub commits/PRs are durable source truth; ChatGPT may contribute through
  bounded PRs.
- MiniMax Code CLI is the primary bounded implementation and exact-commit local
  execution worker.
- Codex is parent PM, diff/test reviewer, and real-computer acceptance owner.

This division is an architectural evidence boundary, not merely a staffing
convention. MiniMax self-test is not Codex acceptance; source CI is not runtime
proof; Codex's focused review does not replace independent product-experience
retest or the Human Owner Gate.

## 2. Process and Trust Boundaries

### 2.1 Renderer

The React renderer owns presentation, interaction state, accessible dialogs, and user-controlled drafts. It does not receive arbitrary filesystem paths, database handles, credential material, raw provider errors, Trash metadata, or unrestricted Electron APIs.

Primary product workspaces include:

- Today/Schedule: date-scoped Todo and notes, All/Unscheduled routes, quick capture, local voice draft, reminders, canonical Todo editing, source links;
- Ask: local RAG answer, source truth, previews, copying, latest completed exchange persistence, answer-to-Todo conversion;
- Knowledge: note/WIKI/KG navigation and grounded local truth;
- Settings and deferred surfaces: narrow configuration contracts with explicit unavailable/deferred states.

### 2.2 Preload

Preload exposes one narrow `window.copilot` bridge. Each function maps to an allowlisted IPC channel and validated request/receipt shape. Listener wrappers return explicit disposers. Renderer-visible errors use curated stable categories rather than main-process stack traces or private paths.

### 2.3 Main Process

The main process owns:

- local storage composition;
- SQLite native-binding validation for source mode;
- KB/KG/RAG ports;
- Todo canonical records;
- reversible Trash lifecycle;
- WIKI revision truth;
- Ask conversation persistence;
- credentials and settings;
- local-ASR manager/worker boundary;
- Electron startup/window/process lifecycle;
- candidate/runtime evidence producers.

The main process validates all public paths and payloads. Renderer input cannot select arbitrary system files or impersonate reserved Todo/import namespaces.

## 3. Local Knowledge Pipeline

### 3.1 Note Commit

A note mutation first commits local note bytes and metadata. The commit receipt reports `LOCAL_SAVED`. Knowledge enrichment is a separate durable lifecycle and cannot retroactively turn a valid local save into a failed local save.

### 3.2 Durable Knowledge Build

The build sequence is:

1. local note document read;
2. exact note revision/digest capture;
3. KG entity/relation indexing;
4. digest-bound WIKI projection verification;
5. RAG text/vector indexing;
6. durable status update.

If the note changes during the build, the result is not current. Startup reconciliation returns abandoned processing rows to pending and schedules work without delaying product startup. A ready badge requires the exact current revision and current digest-bound WIKI projection.

### 3.3 WIKI Truth

WIKI receipts carry:

- exact note path;
- expected content digest;
- current/latest/stale/failed projections;
- provider/model/generated-at provenance;
- current build status for the exact note revision.

The renderer only reports WIKI current when path, expected digest, projection status, projection path, and projection digest all agree.

## 4. RAG Architecture

### 4.1 Embedded-Local Production Default

R31 changes the production embedding default to `embedded-local-hash-v1`:

- deterministic normalized word and character n-gram features;
- signed hashing into a fixed vector;
- default 1024 dimensions;
- stable model identity `embedded-local-hash-v1:<dimensions>`;
- stable implementation revision `char-word-ngram-v1`;
- privacy class `embedded-local`;
- no HTTP request, child process, external model server, model download, native addon, cloud fallback, or credential.

This provider supplies retrieval vectors. It does not replace the separately configured answer-generation LLM.

### 4.2 Explicit Ollama Compatibility

Ollama remains supported only when the owner explicitly selects `provider: ollama` or provides Ollama-specific compatibility configuration. It is classified as `local-service`, not as the packaged self-contained default. Its endpoint, model, timeout, response shape, dimensions, and cancellation remain validated.

### 4.3 Single-Model Vector Scope

The production-facing vector store wraps the existing SQL text/vector store with a single-model invariant:

- zero models: durable text may exist without vectors;
- one expected model: vectors are valid;
- a different or mixed model set: all incompatible vectors are removed;
- text chunks remain durable and searchable by local-text fallback;
- re-indexing may repopulate vectors under the new model;
- source note truth is never deleted by vector rotation.

The SQL schema version remains independent from the model-scope contract version.

### 4.4 Retrieval and Grounding

Candidate evidence may include vector, KG entity, KG neighbor, and deterministic local-text signals. Answer source details bind note path, evidence classes, score, chunk identity, exact character range, and bounded excerpt.

The renderer re-reads each returned source through the local notes API. A source is actionable only when its returned path exactly matches the requested path and a local preview can be produced. Todo conversion is enabled only after every source is `LOCAL_PRESENT`, the completed answer still matches the current answer, and the latest exchange is safely persisted.

## 5. Todo and Schedule Architecture

Todo records are local system notes under a reserved namespace. The structured JSON body contains title/body/due/reminder/status/priority/source links and canonical timestamps. User-facing extended detail—notes and append-only execution logs—is encoded deterministically in the Todo body so main, renderer, and restart share one truth.

Create/update success requires two readbacks:

1. main re-reads and compares the durable Todo record;
2. renderer lists and compares the returned ID before showing success.

`due_at_ms=null` is a supported product state. The UI provides All and Unscheduled routes rather than forcing an artificial due date. Calendar selection returns the workspace to day scope. A requested Todo ID selects the correct route, focuses the canonical card, and fails closed if the ID is not present.

## 6. Quick Capture and Local ASR

Text capture is always available. Voice is disclosed explicitly and uses the packaged local-ASR bridge only; there is no silent remote fallback.

The renderer converts a bounded compressed recording to validated mono PCM16LE, binds byte length/sample count/SHA256/request UUID, and sends it through the narrow preload bridge. The main-process manager validates status, request identity, assets, timing, cancellation, and worker reply. Transcript text enters an editable draft only. The user must confirm before a local note is created.

Source/package contracts do not establish real packaged offline ASR. MiniMax must execute the candidate and Codex must independently verify the actual offline chain.

## 7. Reversible Trash

Notes and Todos move through a durable Trash state machine:

`prepared → cleanup_pending → trashed → restoring → restored`

or

`trashed → purging → purged`.

The original local row is removed atomically before asynchronous KG/RAG cleanup. Crash recovery resumes `cleanup_pending` or `restoring` work. Restore rebuilds current indexes before reporting completion. Renderer receipts exclude original filesystem paths, metadata JSON, journal ownership, private content, and internal leases.

Backup import rollback is namespace-bound and ownership-marked. It can remove only objects created by its import intent. Missing objects are idempotent, but stale KG/RAG index cleanup still runs for a declared imported note path.

## 8. Deployment Authority Boundary

Local execution may begin only after versioned deployment authority is bound to the same exact commit that will become the candidate source.

The authority tuple is:

- source commit: external exact 40-character PR #14 HEAD after final CI;
- document: `<commit>:docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`;
- verifier: `<commit>:scripts/candidate-r30/minimax-authority.mjs`;
- runner: `<commit>:scripts/candidate-r30/run-candidate.mjs`;
- receipt identity: document bytes, line count, SHA256, commit, repository and fixed paths.

The bootstrap sequence first performs an explicit GitHub PR-head fetch and equality check. It then uses `git cat-file` and `git show` against the exact object database. The current checkout is not the authority because it may be stale, dirty, or on a different branch.

`minimax-authority.mjs` is deliberately outside candidate-state creation. It:

- performs no network access;
- creates no candidate worktree;
- creates no candidate evidence directory;
- validates the authority document is complete and contains the reviewed fail-closed markers;
- confirms the candidate runner exists in the same commit;
- writes optional authority/receipt outputs only by exclusive owner-only creation;
- refuses an unavailable commit, missing/invalid document, missing runner, relative output path, or existing output.

The explicit GitHub fetch does not extend to npm or other registry authority. Candidate Gate 2 remains deny-network/offline-only.

A recursive filesystem search, a chat-pasted replacement, or a cron file-presence probe cannot authorize candidate execution. A stale worktree that lacks the document does not prove the exact commit lacks it.

## 9. Electron Trust and Candidate Identity

A development test or source-gate result is not candidate identity. Candidate identity begins only when MiniMax Code executes one exact final Git commit from a clean detached worktree after exact-object deployment authority passes.

The R30 successor produces identity-bound evidence for:

- exact source commit and clean status;
- all-tracked-file SHA256 ledger and aggregate;
- canonical source snapshot;
- CycloneDX SBOM;
- unsigned macOS arm64 ZIP and DMG;
- extracted `.app`, executable, and `app.asar` hashes;
- focused and full packaged Electron evidence;
- runtime ID and terminal process state;
- complete E2E source manifest;
- three distinct performance runs and aggregate;
- screenshots and final manifest.

macOS `.app` bundles are atomic candidate artifacts. Nested Electron Helper.app bundles are part of the main bundle, not additional top-level candidates.

## 10. Twelve Candidate Gates

### Gate 1 — Source Preimage

Exact full commit, clean tracked/untracked state, and absence of governed generated candidate inputs.

### Gate 2 — Network Authority

Resolve an absolute npm executable, execute under `/usr/bin/sandbox-exec` with `deny network*`, strip proxy/registry authority, and run offline npm only. A cache miss stops with `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`; there is no automatic online retry.

### Gate 3 — Complete SHA256 Ledger

Hash every path returned by `git ls-files -z` using no-follow same-handle reads. Require regular single-link files, exact byte size, per-file SHA256, full path set, and aggregate SHA256.

### Gates 4–5 — Source Quality

Run candidate contracts, ordered workspace build, all checks, core unit/integration/global/critical suites, desktop build, Phase 1 release suite, strict desktop global/critical coverage, and production CycloneDX SBOM.

### Gates 6–7 — Canonical Package and Identity

Run the existing canonical unsigned release builder for the arm64 ZIP/DMG, copy verified source/artifact evidence into the private candidate directory, extract the ZIP, and bind source snapshot, canonical manifest, release identity, ZIP, DMG, app, executable, and `app.asar` hashes.

### Gates 8–10 — Packaged Electron

Run the exact focused 2/2 profile, list exactly `113 tests in 9 files`, hash all E2E TypeScript specs/fixtures/helpers, then run full packaged Electron 113/113 with zero skipped/unexpected/flaky and clean process termination.

### Gate 11 — Candidate-Bound Performance

Run three distinct `r31-v1` direct-spawn measurements. Each run binds candidate, executable, `app.asar`, release identity, canonical manifest, source snapshot, unique challenge, native-window/renderer startup milestones, 100-node KG result, RSS, and process cleanup. Aggregate bytes and SHA256 must match the raw records.

### Gate 12 — Complete Receipt

Require deployment authority/source/artifact/runtime/test-data/performance/SBOM/command/screenshot/terminal-state evidence and write `CANDIDATE-MANIFEST.json` plus `R30-COMPLETE.json`.

## 11. Deferred Boundaries

- Windows real-machine packaging/signing/install/screenshots: Phase 1.1.
- Tencent deployment, Remote/live, and optional encrypted Backup: post-MVP.
- 3D knowledge graph and broader ecosystem expansion: post-MVP.

Deferred modules must not inflate Phase 1 readiness or be silently exposed as working product paths.

## 12. Release Boundary

A passing twelve-gate run is an unsigned diagnostic candidate. Release still requires independent Codex acceptance, three candidate-consistent verify-fix rounds, real packaged offline ASR, Developer ID signing, Apple notarization/stapling/validation, Gatekeeper install/launch evidence, Human Owner Gate, and required use evidence.

The root v6.2 baseline and `delivery.md` remain the final authority for any completion claim.
