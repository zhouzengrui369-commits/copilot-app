# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

R31 remains the source lineage for the macOS-first MVP. The active Parent PM slice is PR #23 (`chatgpt/mvp-llm-wiki-demo-ui`), which clean-room adapts the researched llm_wiki product patterns into the existing Electron/demo UI source. No current packaged Candidate, artifact SHA-256, runtime ID, Codex acceptance, Release, or Human Owner Gate exists.

## P0 — Owner-directed llm_wiki + Demo UI MVP source

- [x] Read `goal.md`, `plan.md`, `rules.md`, `delivery.md`, README/state/status/TODO and current Candidate contracts.
- [x] Read the existing `docs/llm-wiki-ecosystem-fit-report.md` research from project history.
- [x] Pin upstream architectural reference `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7).
- [x] Identify upstream license as GPLv3 and choose clean-room adaptation instead of copying implementation bytes.
- [x] Preserve current Electron / TypeScript / SQLite / local KG / local RAG architecture.
- [x] Preserve `apps/copilot-desktop/src/renderer/styles/demo-first-prototype.css` and `demo-source-v4.css` as the UI shell basis.
- [x] Add `知识台 / Wiki Studio` route without replacing existing `KnowledgeWorkspace`.
- [x] Add local Sources rail and three-column responsive workbench.
- [x] Reuse digest-bound `WikiTruthReceipt` rather than create a second Wiki truth store.
- [x] Add projection-bound human Review Queue metadata (`accepted` / `deferred`) stored locally and separated from canonical truth.
- [x] Surface existing durable `kg_pending` / `knowledgeBuild` states as Activity instead of creating a second ingest database.
- [x] Reuse the existing local Sigma/Graphology KG renderer.
- [x] Add clean-room 4-Signal ranking: direct relation ×3, source overlap ×4, Adamic-Adar ×1.5, same type ×1.
- [x] Keep retries explicit through the existing local `kg.reindexNote` path; no surprise model work on Studio open.
- [x] Add model tests for review identity, activity truth, and 4-Signal ranking.
- [x] Add renderer tests for Review Queue/local decision separation/explicit retry.
- [x] Add `THIRD_PARTY_NOTICES.md` and `docs/development/LLM_WIKI_CLEAN_ROOM_MVP.md` provenance.
- [x] Open stacked Draft PR #23 targeting `chatgpt/mvp-source-finalization`.
- [x] Validate the implementation-only head `6886bd37bbc80658b7e994bed052d1ec6b2b65e6` with `copilot-source-gate` run `31150271762` (`17/17 PASS`).
- [x] Freeze Parent PM GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log/changed-files receipts on PR #23.
- [ ] Pass the complete Node 24/macOS `copilot-source-gate` on the final evidence-containing PR #23 head.
- [ ] Merge PR #23 into Draft PR #20 only.
- [ ] Pass the complete `copilot-source-gate` on the resulting exact PR #20 head.
- [ ] Freeze the new 40-character `EXACT_FINAL_HEAD` with no subsequent tracked source change.

## P0 — MiniMax Code fresh macOS Candidate

MiniMax remains stopped until ChatGPT supplies a new exact PR #20 head after PR #23 integration.

- [ ] Fetch `refs/pull/20/head` and prove `FETCH_HEAD == EXACT_FINAL_HEAD`.
- [ ] Read `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and `scripts/candidate-r30/minimax-authority.mjs` from that exact Git object.
- [ ] Use all-new hydration/candidate worktrees, cache, receipt, task root, evidence, artifact and runtime identities.
- [ ] Never reuse R44/R45/R46 caches, worktrees, evidence or old exact SHAs.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs` from the clean detached source.
- [ ] Run one Owner-authorized native-toolchain hydration; no retry/resume or partial-cache reuse.
- [ ] Run `scripts/candidate-r30/run-candidate.mjs --dry-run`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute the real Candidate once and stop at the first fail-closed blocker.
- [ ] Pass Gate 2 full lifecycle install under deny-network.
- [ ] Pass Gates 3–12 without source edits or authority expansion.
- [ ] Return source snapshot, artifact SHA-256, runtime ID, test-data manifest, packaged Electron `113/113`, zero skipped/unexpected/flaky, three performance runs, screenshots and clean process termination.
- [ ] `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

Required authority tokens remain:

```text
scripts/candidate-r30/run-candidate.mjs
scripts/candidate-r30/minimax-authority.mjs
EXACT_FINAL_HEAD
```

## P0 — Codex independent Electron acceptance

- [ ] Start only after a complete internally consistent MiniMax receipt.
- [ ] Independently verify source commit, artifact SHA-256, runtime ID, ecosystem baseline and deterministic test-data manifest.
- [ ] Operate the exact packaged Electron Candidate on the real macOS computer.
- [ ] Verify Wiki Studio Sources/Wiki/Review/Graph/Activity UI with real local data.
- [ ] Verify local material → grounded Ask → verified source → same-exchange return.
- [ ] Verify Todo create/readback → View Todo → All/Unscheduled → edit → schedule association.
- [ ] Verify complete Electron quit/relaunch persistence.
- [ ] Verify real packaged offline local ASR.
- [ ] Report P0/P1/P2 and keep Human Owner Gate ineligible until candidate-bound P0=0.

## Existing Candidate / native-cache controls — preserve

- [x] R46 transport fix merged into PR #20 source lineage.
- [x] Candidate network remains `(deny network*)`.
- [x] Hydration remains one explicit Owner-authorized operation with `automaticRetry=false`.
- [x] Partial native cache remains non-reusable and fail-closed.
- [x] Gate 9 exact discovery remains `113 tests in 9 files`.
- [x] Gate 11 remains three candidate-bound performance runs.
- [x] Gate 12 remains final source/artifact/runtime/test-data/evidence receipt.

## Open release gates

- [ ] Candidate-bound three verify-fix rounds.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, validation and Gatekeeper install/launch evidence.
- [ ] Human Owner Gate and required use evidence.

## Deferred

- Windows real-machine/signing/install/screenshots → Phase 1.1.
- Tencent deployment, Remote/live and optional Backup → post-MVP.
- 3D graph, Deep Research, MCP/API expansion → post-MVP.
- Mobile/web, multi-user, plugins, i18n, enterprise and major dependency upgrades → post-MVP.
