# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

R31 remains the macOS-first source lineage. R47 clean-room llm_wiki + Demo UI is integrated into Draft PR #20. R49 proved that R48 tarball-only prefetch did not close npm registry metadata requirements (`ENOTCACHED` on `typescript`), so no Candidate was created. R50 metadata-complete registry prefetch is now integrated and awaits the final PR #20 source gate. No artifact SHA-256, runtime ID, Codex acceptance, Release, or Human Owner Gate exists.

## P0 — Product source

- [x] Preserve R31 exact-object Candidate authority and historical Desktop Phase 1 `1107/1107 PASS` baseline.
- [x] Clean-room adapt `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` into the existing Electron/TypeScript/SQLite/local-KG/local-RAG architecture.
- [x] Deliver `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections, explicit `重新整理`.
- [x] Preserve Ask → verified source → same-exchange return → Todo → All/Unscheduled → edit → schedule → quit/relaunch source contracts.
- [x] Merge R47 PR #23 only into Draft PR #20; no `main` merge.

## P0 — R49 blocker / R50 metadata-complete registry closure

- [x] Accept R49 exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2`: source gate `17/17 PASS`, MiniMax source contracts `95/95 PASS`, one hydration invocation, zero Candidate executions, source unchanged.
- [x] Record deterministic R49 root cause: strict `npm ci --offline` reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`; tarball bytes alone did not prove npm packument/metadata cache closure.
- [x] Keep R49 partial cache/evidence immutable and `FORBIDDEN_REFERENCE_ONLY`; no retry/resume/reuse.
- [x] Create R50 branch `chatgpt/r50-metadata-complete-registry-prefetch`, PR #25.
- [x] Replace tarball-URL prefetch specs with exact `name@version` specs while retaining canonical tarball URL + integrity in the deterministic manifest.
- [x] Keep bounded 24-item `npm pack --ignore-scripts` batches, zero retry, isolated cache, and unchanged host allowlist.
- [x] Add strict `(deny network*) npm ci --offline --ignore-scripts` registry-cache closure proof before lifecycle scripts.
- [x] Add fail-closed `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE` for incomplete cache.
- [x] Require zero `registry.npmjs.org` requests after closure; fail with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH` otherwise.
- [x] Bind strategy/metadata mode/manifest/closure/zero-post-closure-registry into the PASS receipt validator.
- [x] Pass R50 implementation source gate at `88d66a34b3416a917ef1a39ac6d1e72ea8540922`: run `31160628979`, job `92809916272`, `17/17 PASS`.
- [x] Pass R50 final evidence-containing source gate at `4707148f9402cddf5959067fee46f6686e0af6ad`: run `31161050220`, job `92811240325`, `17/17 PASS`.
- [x] Squash merge PR #25 only into Draft PR #20: `42357ea7d48e691624c43c1c182c0d1c0ec9752d`.
- [ ] Pass complete `copilot-source-gate` on the exact PR #20 head produced after this final R50 governance freeze.
- [ ] Freeze the new 40-character `EXACT_FINAL_HEAD` with no subsequent tracked source change.

## P0 — MiniMax Code fresh macOS Candidate

MiniMax remains stopped until ChatGPT supplies all four trigger fields: `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, and a new unique `RUN_STAMP`.

- [ ] Fetch `refs/pull/20/head` and prove `FETCH_HEAD == EXACT_FINAL_HEAD`.
- [ ] Read `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`, `docs/MINIMAX_LOCAL_DEPLOYMENT_MVP.md`, `scripts/candidate-r30/minimax-authority.mjs`, `scripts/candidate-r30/npm-native-cache-hydrate.mjs`, and `scripts/candidate-r30/run-candidate.mjs` from that exact Git object.
- [ ] Use all-new hydration/Candidate worktrees, cache, receipt, task root, evidence, artifact and runtime identities.
- [ ] Never reuse R44/R45/R46/R48/R49 caches, worktrees, evidence or attempted exact SHAs.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs` from the clean detached source; require actual source count PASS with zero fail/skip.
- [ ] Run one Owner-authorized hydration only; no retry/backoff/resume/partial-cache reuse.
- [ ] Require R50 exact `name@version` metadata+tarball prefetch PASS and strict deny-network registry-cache closure PASS.
- [ ] Require zero registry requests after closure.
- [ ] Run `scripts/candidate-r30/run-candidate.mjs --dry-run`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute the real Candidate once and stop at the first fail-closed blocker.
- [ ] Pass Gate 2 receipt-bound lifecycle install under deny-network and Gates 3–12 without source edits or authority expansion.
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
