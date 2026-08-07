# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

R31 remains the source lineage for the macOS-first MVP. R47 clean-room llm_wiki + Demo UI source is integrated into Draft PR #20, and R48 segmented registry-prefetch repair is now integrated after the first R47 exact-SHA hydration stopped on `registry.npmjs.org` transport reset. No current packaged Candidate, artifact SHA-256, runtime ID, Codex acceptance, Release, or Human Owner Gate exists.

## P0 — Owner-directed llm_wiki + Demo UI MVP source

- [x] Read `goal.md`, `plan.md`, `rules.md`, `delivery.md`, README/state/status/TODO and current Candidate contracts.
- [x] Read the existing `docs/llm-wiki-ecosystem-fit-report.md` research from project history.
- [x] Pin upstream architectural reference `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7).
- [x] Identify upstream license as GPLv3 and choose clean-room adaptation instead of copying implementation bytes.
- [x] Preserve current Electron / TypeScript / SQLite / local KG / local RAG architecture.
- [x] Preserve the existing demo-first renderer shell as the UI basis.
- [x] Add `知识台 / Wiki Studio` route without replacing existing `KnowledgeWorkspace`.
- [x] Add Sources / Wiki / Review / Activity / Graph / 4-Signal Connections and explicit reindex/retry.
- [x] Keep Review metadata local and separated from canonical note/WIKI/KG/RAG/Todo/schedule truth.
- [x] Add clean-room provenance and Parent PM task receipts.
- [x] Pass final PR #23 source gate at `8f0d1604217c966e696e7caf8763496c6be681c9`: run `31150946435`, job `92780309284`, `17/17 PASS`.
- [x] Merge PR #23 only into Draft PR #20: `292e2a6160cf009a13492c93af96f5ff3c320899`.
- [x] Pass integrated R47 PR #20 source gate at `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`: run `31152146196`, job `92783833715`, `17/17 PASS`.

## P0 — R48 native hydration registry transport closure

- [x] Accept MiniMax blocker on `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`: exact authority PASS, source contracts `90/90 PASS`, one hydration invocation, `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`, Candidate not created, source unchanged.
- [x] Preserve the failed cache/evidence as `FORBIDDEN_REFERENCE_ONLY`; no retry/resume/reuse.
- [x] Create `chatgpt/r48-segmented-registry-prefetch`, Draft PR #24.
- [x] Derive a deterministic/deduplicated registry tarball manifest from package-lock v3.
- [x] Canonicalize reviewed registry origins to `registry.npmjs.org` without expanding the host allowlist.
- [x] Prefetch exact registry tarballs in bounded 24-item `npm pack --ignore-scripts` batches; each batch is a fresh npm process with retry disabled.
- [x] Make the following lifecycle install use `npm ci --offline` for registry resolution while retaining existing bounded lifecycle asset proxy access.
- [x] Preserve `automaticRetry=false`, single hydration invocation, partial-cache fail-closed behavior and deny-network Candidate Gates 1–12.
- [x] Add direct registry-prefetch contracts and Parent PM GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log/changed-files.
- [x] Pass PR #24 implementation source gate at `a3f87e71930857ac71abe626fea115aa709996ee`: run `31155823536`, job `92794967653`, `17/17 PASS`.
- [x] Pass PR #24 final evidence-containing source gate at `8297cd4f7ebea0bcd7b6477f36f1b91b148c31cb`: run `31156362975`, job `92796663770`, `17/17 PASS`.
- [x] Merge PR #24 only into Draft PR #20: squash merge `1f9beaaf60f08b607204be8b99f93cca5d48c408`.
- [ ] Pass the complete `copilot-source-gate` on the exact PR #20 head produced after this final R48 governance freeze.
- [ ] Freeze the new 40-character `EXACT_FINAL_HEAD` with no subsequent tracked source change.

## P0 — MiniMax Code fresh macOS Candidate

MiniMax remains stopped until ChatGPT supplies all four trigger fields: `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, and a new unique `RUN_STAMP`.

- [ ] Fetch `refs/pull/20/head` and prove `FETCH_HEAD == EXACT_FINAL_HEAD`.
- [ ] Read `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`, `docs/MINIMAX_LOCAL_DEPLOYMENT_MVP.md`, and `scripts/candidate-r30/minimax-authority.mjs` from that exact Git object.
- [ ] Use all-new hydration/candidate worktrees, cache, receipt, task root, evidence, artifact and runtime identities.
- [ ] Never reuse R44/R45/R46 or the failed `7d8495…` hydration cache/worktree/evidence as Candidate input.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs` from the clean detached source.
- [ ] Run one Owner-authorized native-toolchain hydration; no retry/resume or partial-cache reuse.
- [ ] Require R48 registry prefetch batches to finish and a PASS native-cache receipt before Candidate creation.
- [ ] Run `scripts/candidate-r30/run-candidate.mjs --dry-run`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute the real Candidate once and stop at the first fail-closed blocker.
- [ ] Pass Gate 2 full lifecycle install under deny-network.
- [ ] Pass Gates 3–12 without source edits or authority expansion.
- [ ] Return source snapshot, artifact SHA-256, runtime ID, test-data manifest, packaged Electron `113/113`, zero skipped/unexpected/flaky, three performance runs, screenshots, local ASR proof and clean process termination.
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
- [ ] Verify Wiki Studio Sources/Wiki/Review/Graph/Activity/4-Signal UI with real local data.
- [ ] Verify local material → grounded Ask → verified source → same-exchange return.
- [ ] Verify Todo create/readback → View Todo → All/Unscheduled → edit → schedule association.
- [ ] Verify complete Electron quit/relaunch persistence and real packaged offline local ASR.
- [ ] Report P0/P1/P2 and keep Human Owner Gate ineligible until candidate-bound P0=0.

## Existing Candidate / native-cache controls — preserve

- [x] R31/R30 exact-object Candidate authority remains active.
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