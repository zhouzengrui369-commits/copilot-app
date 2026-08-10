# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

R31 remains the macOS-first source lineage. R47 clean-room llm_wiki + Demo UI is integrated into Draft PR #20. R66 consumed source `beb951b95695233911da0a17543ef342acc6df93` after one real hydrator completed 50 registry-prefetch batches and stopped fail-closed on the invalid registry spec `string-width-cjs@4.2.3`. R67 repairs npm alias/install-path identity without changing package/lockfile bytes. No Candidate, artifact SHA-256, runtime ID, Codex acceptance, Release, or Human Owner Gate exists.

## P0 — Product source

- [x] Preserve R31 exact-object Candidate authority and historical Desktop Phase 1 `1107/1107 PASS` baseline.
- [x] Clean-room adapt `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` into the existing Electron/TypeScript/SQLite/local-KG/local-RAG architecture.
- [x] Deliver `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections, explicit `重新整理`.
- [x] Preserve Ask → verified source → same-exchange return → Todo → All/Unscheduled → edit → schedule → quit/relaunch source contracts.
- [x] Keep all product-source integration in Draft PR #20; no `main` merge.

## P0 — R66 blocker / R67 npm alias identity

- [x] Accept R66 exact source `beb951b95695233911da0a17543ef342acc6df93` as Tier-B consumed: one hydration invocation, zero Candidate executions, source unchanged.
- [x] Record R66 pre-network/root-closure proof: `106/106` source tests, `1361/1361` unique exact-spec coverage, typescript and zustand focused identities PASS.
- [x] Record R66 terminal blocker: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH`, batch 51, `string-width-cjs@4.2.3` `ETARGET`.
- [x] Independently verify the root lock entry is an npm alias/install-path entry: path `node_modules/string-width-cjs`, locked package `name=string-width`, `version=4.2.3`.
- [x] Reject wholesale root lockfile regeneration as unnecessary scope expansion.
- [x] Create R67 branch `chatgpt/r67-lockfile-alias-identity`, Draft PR #36.
- [x] Make exact-version-only prefetch identity prefer valid lock entry `name` only for `node_modules/...` paths.
- [x] Preserve fallback to install-path package name when lock entry `name` is absent.
- [x] Exclude root/workspace entries outside `node_modules`.
- [x] Add synthetic alias regression and exact-repository alias regression.
- [x] Require real specs `string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0`.
- [x] Forbid fake specs `string-width-cjs@4.2.3`, `strip-ansi-cjs@6.0.1`, `wrap-ansi-cjs@7.0.0`.
- [x] Pass R67 implementation source gate at `20003b07b8137a369263e0fadb3b4f4171d7d392`: run `31354821614`, job `93352458882`, `17/17 PASS`.
- [ ] Pass complete source gate on the final evidence-containing R67 PR #36 head.
- [ ] Squash PR #36 only into Draft PR #20 with expected-head binding.
- [ ] Align PR #20 exact-object authority and pass the complete source gate on the resulting exact PR #20 head.
- [ ] Freeze the new 40-character `EXACT_FINAL_HEAD` with no subsequent tracked source change.

## P0 — MiniMax Code R68 fresh macOS Candidate

MiniMax remains stopped until ChatGPT supplies `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, a new unique `RUN_STAMP`, and six all-new paths.

- [ ] Fetch `refs/pull/20/head` and prove `FETCH_HEAD == EXACT_FINAL_HEAD`.
- [ ] Read exact-object deployment authority and Candidate scripts.
- [ ] Use no R66/predecessor cache, worktree, evidence, manifest, artifact or runtime identity.
- [ ] Pre-network manifest must prove root exact-spec completeness and alias-aware registry identity.
- [ ] Require `string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0` present and corresponding fake `*-cjs` registry specs absent.
- [ ] Use only the exact-source background hydrator launcher; one launcher, one hydrator, no retry/resume/replacement.
- [ ] Pass bounded registry prefetch, strict deny-network registry-cache closure and zero post-closure registry requests.
- [ ] Pass Electron/native hydration and obtain one immutable native-cache PASS receipt.
- [ ] Run `run-candidate.mjs --dry-run`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute the real Candidate once and stop at the first fail-closed blocker.
- [ ] Pass Gate 2 and Gates 3–12 without source edits or authority expansion.
- [ ] Return source snapshot, artifact SHA-256, runtime ID, test-data manifest, packaged Electron `113/113`, zero skipped/unexpected/flaky, three performance runs, Wiki Studio/critical-loop screenshots, local ASR proof, and clean process termination.
- [ ] `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

Required authority anchors:

```text
scripts/candidate-r30/run-candidate.mjs
scripts/candidate-r30/minimax-authority.mjs
EXACT_FINAL_HEAD
```

## P0 — Codex independent Electron acceptance

- [ ] Start only after a complete internally consistent MiniMax Candidate receipt.
- [ ] Verify exact source commit, artifact SHA-256, runtime ID, ecosystem baseline and deterministic test-data manifest.
- [ ] Operate the exact packaged Electron Candidate on the real Mac.
- [ ] Verify Wiki Studio with real local data, full Ask/source/Todo/schedule loop, complete quit/relaunch persistence, and packaged offline local ASR.
- [ ] Report P0/P1/P2; Human Owner Gate remains ineligible until candidate-bound P0=0.

## Existing controls — preserve

- [x] Candidate network remains `(deny network*)`.
- [x] Hydration remains one explicit Owner-authorized operation with `automaticRetry=false`.
- [x] Partial cache is non-reusable and fail-closed.
- [x] Gate 9 exact discovery remains `113 tests in 9 files`.
- [x] Gate 11 remains three Candidate-bound performance runs.
- [x] Gate 12 remains final source/artifact/runtime/test-data/evidence receipt.

## Open release gates

- [ ] Candidate-bound verify-fix rounds.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, validation and Gatekeeper install/launch evidence.
- [ ] Human Owner Gate.
