# Changelog

## 2026-08-07 — R48 Segmented Registry Prefetch

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF` until a same-SHA packaged Electron Candidate is executed by MiniMax and independently accepted by Codex.

### Local blocker

- The first source-green R47 PR #20 head `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f` passed GitHub `copilot-source-gate` run `31152146196`, job `92783833715`, `17/17 PASS`.
- MiniMax fetched that exact PR #20 object, passed deployment authority and `90/90` Candidate source contracts, and invoked native-toolchain hydration exactly once.
- The hydration stopped before Candidate creation with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` / `ECONNRESET` at `registry.npmjs.org:443`.
- Source stayed clean; no PASS cache receipt, Candidate, artifact SHA-256, runtime ID or Electron runtime evidence was created.
- The failed cache is `partial_failed_transport`, `reusable=false`, evidence-only, and cannot be retried, resumed or reused.

### Source repair

- Added `scripts/candidate-r30/registry-prefetch.mjs` and direct source contracts.
- Registry tarballs are now derived deterministically from exact package-lock v3, integrity-bound, deduplicated and canonicalized only from already-reviewed registry origins to `registry.npmjs.org`.
- Hydration prefetches exact tarballs in bounded 24-item `npm pack --ignore-scripts` batches; every batch is a fresh npm child process with retries disabled.
- Temporary packed tarballs are removed after successful batches while the isolated npm content cache remains.
- The following full lifecycle dependency install now runs `npm ci --offline`, so npm registry resolution is cache-only during lifecycle execution.
- Lifecycle-only Node/Electron/GitHub official assets retain the existing bounded localhost CONNECT proxy; the source-defined host allowlist was not expanded.
- Existing Electron arm64 native hydration, full deny-network install/native proofs, immutable cache ledger and Candidate Gate 1–12 deny-network authority remain intact.
- `automaticRetry=false`, no hidden retry/backoff/resume, and partial-cache nonreuse remain invariant.

### Source validation and integration

- R48 implementation head `a3f87e71930857ac71abe626fea115aa709996ee` passed complete source gate run `31155823536`, job `92794967653`, `17/17 PASS`.
- Parent PM GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log/changed-files receipts were added under `tasks/chatgpt/2026-08-07-r48-segmented-registry-prefetch/`.
- Final PR #24 head `8297cd4f7ebea0bcd7b6477f36f1b91b148c31cb` passed complete source gate run `31156362975`, job `92796663770`, `17/17 PASS`.
- PR #24 was squash-merged only into Draft PR #20 source branch as `1f9beaaf60f08b607204be8b99f93cca5d48c408`; `main` remains untouched.
- The exact PR #20 head produced after this final governance alignment must pass the complete source gate before a new MiniMax attempt is authorized.

Rollback: revert the R48 registry-prefetch repair from unmerged Draft PR #20. No product data, package version, lockfile, credential, cloud resource, signing or notarization state was changed.

## 2026-08-07 — R47 Owner-Directed llm_wiki + Demo UI MVP Integration

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF` until a same-SHA packaged Electron Candidate is executed by MiniMax and independently accepted by Codex.

### Owner direction

- Parent PM was instructed to use the existing `nashsu/llm_wiki` research and the demo UI source as the implementation basis for Copilot App MVP delivery.
- Upstream architectural reference is pinned to `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7, GPLv3).
- Copilot's existing Electron/TypeScript/SQLite architecture and local-first data truth remain unchanged.

### Licensing / clean-room boundary

- No GPL upstream implementation file was copied, vendored, mechanically translated or transpiled.
- Behavior-level concepts were reimplemented against existing Copilot interfaces.
- Added `docs/development/LLM_WIKI_CLEAN_ROOM_MVP.md` and an architectural-reference notice in `THIRD_PARTY_NOTICES.md`.
- No Tauri, Rust, DuckDB, second database, second KB, second vector store or cloud truth was introduced.

### Product implementation

- Added `KnowledgeStudioWorkspace` and exposed it as `知识台` in the existing demo-first Electron shell.
- Reused existing `demo-first-prototype.css` / `demo-source-v4.css` shell instead of adding another renderer.
- Added a responsive Sources / Wiki-Review-Graph / Activity-Connections three-column workbench.
- Reused existing digest-bound `WikiTruthReceipt` and durable `kg_pending` / `knowledgeBuild` state.
- Added projection-bound local human review metadata; review decisions cannot mutate canonical note/WIKI/KG/RAG/Todo/schedule truth.
- Added explicit WIKI reindex/retry; opening the Studio performs local truth reads only and does not silently enqueue model work.
- Reused the existing local Sigma/Graphology knowledge graph renderer.
- Added a clean-room 4-Signal relevance model: direct relation ×3, source-note overlap ×4, Adamic-Adar ×1.5, same entity type ×1.
- Preserved the existing `KnowledgeWorkspace`, Ask/source return continuity, Todo canonical readback, Unscheduled discovery and schedule flow.

### Source validation and integration

- Added model tests for Review Queue priority/identity rollover, activity fail-closed truth and 4-Signal scoring.
- Added renderer tests for local human review metadata and explicit reindex behavior.
- Implementation-only head `6886bd37bbc80658b7e994bed052d1ec6b2b65e6` passed complete `copilot-source-gate` run `31150271762`, job `92778261873`, `17/17 PASS`.
- Final stacked PR #23 head `8f0d1604217c966e696e7caf8763496c6be681c9` passed complete source gate run `31150946435`, job `92780309284`, `17/17 PASS`.
- PR #23 was merged only into Draft PR #20's source branch as `292e2a6160cf009a13492c93af96f5ff3c320899`.
- PR #20 was not merged to `main`.

### Acceptance boundary

- Any new tracked commit invalidates a prior exact Candidate source handoff.
- MiniMax must use the final source-green PR #20 Git object in new detached worktrees and cannot reuse old caches/evidence.
- Codex must independently operate the same packaged Electron Candidate; GitHub CI, renderer/browser tests, merge, build or packaging alone are not runtime proof.

## 2026-08-03 — R46 Native Hydration Transport Stability

- Preserved one-invocation native hydration and Candidate deny-network authority while adding TCP keepalive/no-delay, long idle timeout, explicit zero-retry npm transport settings and complete CONNECT evidence.
- Transport-failed cache roots are sealed with `HYDRATION-FAILED.json`, `partial_failed_transport`, `reusable=false`, and cannot produce a PASS receipt.
- R46 source was merged into the Draft PR #20 lineage and passed the full Node 24/macOS source gate.

## 2026-08-03 — R45 Gate 2 Native-Toolchain Cache Repair

- First exact MVP Candidate source `74454d21910f0c01e0b9d4f8117b4394defe3228` stopped at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED` because a registry-only cache did not contain lifecycle/native toolchain closure.
- Added receipt-bound native-toolchain hydration with exact Owner authority, reviewed lifecycle set, local CONNECT proxy, online/offline native proofs and deny-network Candidate Gate 2.
- Candidate `--ignore-scripts` and Candidate network expansion were explicitly rejected.

## 2026-08-03 — R44 One-Shot macOS MVP Remote Source Consolidation

- Consolidated the macOS-first product source into Draft PR #20.
- Source included grounded Ask/source truth, Todo closure, source-reader return continuity, local-first persistence, app-embedded local-ASR source contracts, strict coverage, SBOM and exact Electron discovery.
- Source success never implied Electron runtime, signing, notarization or MVP completion.

## 2026-08-01 — R41 Offline Cache Identity Alignment

- Isolated npm config authority and aligned cache keys while retaining Candidate deny-network and no automatic online fallback.

## R31 / R30 candidate contract retained

The complete pre-R30 detailed changelog remains byte-preserved at `docs/history/CHANGELOG_PRE_R30.md`.

The executable macOS Candidate remains twelve ordered, fail-closed gates:

1. exact source and clean preimage;
2. receipt-bound lifecycle install under deny-network (**Gate 2**);
3. complete tracked-file SHA-256 ledger (**Gate 3**);
4. source contracts and ordered workspace build;
5. checks/tests/coverage/build/SBOM;
6. canonical unsigned macOS arm64 package authority;
7. source/artifact identities;
8. focused packaged Electron;
9. exact `113 tests in 9 files` + deterministic test-data manifest (**Gate 9**);
10. packaged Electron `113/113` and clean termination;
11. three candidate-bound performance runs (**Gate 11**);
12. final source/artifact/runtime/test-data/evidence receipt (**Gate 12**).

Deployment authority is read from the **exact Git object** through `scripts/candidate-r30/minimax-authority.mjs`; stale worktrees, branch names and chat transcripts are not authority.