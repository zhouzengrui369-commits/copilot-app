# Changelog

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

### Source tests

- Added model tests for Review Queue priority/identity rollover, activity fail-closed truth and 4-Signal scoring.
- Added renderer tests for local human review metadata and explicit reindex behavior.
- Opened stacked Draft PR #23 against `chatgpt/mvp-source-finalization`; the complete Node 24/macOS source gate remains mandatory.

### Acceptance boundary

- Any new tracked commit invalidates the previous exact Candidate source handoff.
- After PR #23 is source-green it may merge only into Draft PR #20; PR #20 must then pass its complete source gate again.
- MiniMax must use the resulting exact Git object in new detached worktrees and cannot reuse old caches/evidence.
- Codex must independently operate the same packaged Electron Candidate; GitHub CI, renderer/browser tests or packaging alone are not runtime proof.

Rollback: revert the R47 Knowledge Studio, route/tests, clean-room provenance and governance commits. No database migration, package-version change, local user-data mutation, credential, cloud, signing or notarization state is created by this source slice.

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
