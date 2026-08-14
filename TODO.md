# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

## P0 — Web-first Demo UI gate

- [x] Bind the Owner Demo HTML by exact path, `52046` bytes, and SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`.
- [x] Start from Draft PR #20 exact head `d450badfc85b65d3eef20f05eeb0607c1bf6a912` in isolated branch `codex/demo-ui-web-first-r1`.
- [x] Restore the Demo's four primary destinations: Today, Knowledge, Conversations, Settings.
- [x] Keep Wiki Studio reachable from Knowledge without making it a fifth primary destination.
- [x] Pass focused renderer typecheck and web tests.
- [x] Capture source and implementation at the same 1440x900 viewport and finish `design-qa.md` with `final result: passed`.
- [x] Publish web-only Draft PR #54 and pass source gate run `31751463041`.
- [x] Record `PARENT_PM_WEB_ACCEPTANCE=PASS` from source-bound browser evidence.
- [x] Issue separate local successors R1/R2/R3 only after the web technical gate; retain every failed identity as immutable reference-only.
- [ ] Keep `HUMAN_OWNER_MILESTONE_GATE=PENDING` until an exact packaged Candidate passes independent acceptance.

Exact unlock condition: NJX explicitly accepts the live web page derived from the bound source. A screenshot, browser test, commit, PR, CI result, worker report, or local app launch does not unlock packaging.

## P0 — PR #54 watchdog contract reproducibility

- [x] Preserve R3 evidence root `b8b04819ac25629b0f2a5135858532902567b794-20260814T003315Z` unchanged.
- [x] Classify R3 as a source-test timing race: fixed `await 80ms` could observe the 40ms timeout callback before its subsequently scheduled 20ms grace callback.
- [x] Replace the wall-clock assertion with injected manual timers; do not change production timeout, process-group, signal, audit, or retry behavior.
- [x] Add the inverse contract: a child closing during grace cancels `SIGKILL`.
- [x] Pass the focused contract 100 consecutive runs (`300/300`) and the complete Candidate source contract `111/111` in a non-nested macOS sandbox environment.
- [x] Push exact PR #54 head `c9ed8b346e60b580860e58dde459372a2f8384c4` and pass source gate run `31758923541`, job `94640840476`, `17/17`.
- [ ] Create a new local successor with a new run stamp, evidence root, worktree, native cache, receipt, candidate identity, artifact identity, and runtime identity.

Exact unlock condition: the new 40-character PR #54 head, not `b8b04819...`, must pass the complete GitHub source gate. R1/R2/R3 may never be retried, resumed, mutated, or reused.

## P0 — R4 proxy upstream family repair / R5 unlock

- [x] Accept R4 as immutable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_TIMEOUT`: exact source/tree and `111/111` source contracts PASS; hydration executions `1`; Candidate/App/artifact/E2E/performance executions `0`; final process clean.
- [x] Prove direct registry IPv4 metadata access `3/3 PASS` and exact default-family proxy access only `1/3 PASS` with two approximately three-second upstream `ETIMEDOUT` events.
- [x] Prove a diagnostic-only `family:4` CONNECT proxy passes `3/3` with requests `3`, allowed `3`, denied `0`, transport errors `0`, positive bidirectional bytes, and all nine allowlisted hosts exposing A records.
- [x] Bind `proxyUpstreamFamily=4` into transport policy, proxy audit receipts, validation, and source contracts.
- [x] Preserve one request per CONNECT, automatic retry `false`, npm retries `0`, official-host allowlist, port `443`, mirror, timeouts, concurrency, and partial-cache nonreuse.
- [x] Pass focused transport/receipt/hydrator and governance contracts `30/30`; pass complete Candidate source contracts `112/112` in a non-nested macOS sandbox environment.
- [x] Push exact PR #54 head `6d609d9c989a16e143d38e7a33b2d69d01f1d442` and pass source gate run `31761937329`, job `94649962981`, `17/17`.
- [x] Issue R5 only from that new SHA/tree with all-new paths; R1/R2/R3/R4 and all preflight assets remained ineligible for reuse.

Exact unlock condition: the repaired PR head must pass the complete GitHub source gate. A diagnostic-only temporary proxy PASS is not deployment authority.

## P0 — R5 GitHub control-tunnel repair / R6 unlock

- [x] Accept R5 evidence root `6d609d9c989a16e143d38e7a33b2d69d01f1d442-20260814T020338Z` as immutable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`.
- [x] Preserve R5 counts: source `112/112 PASS` once; hydration once; dry-run/Candidate/package/App/E2E/performance all zero; final process clean.
- [x] Classify the exact terminal tunnel: `github.com:443`, upstream `ETIMEDOUT`, `3088` received bytes, while total proxy transfer reached `121555082` bytes and Electron reported `socket hang up` after forced downstream destruction.
- [x] Add an auditable graceful EOF only for `github.com + ETIMEDOUT + 1..65536 bytes` and keep all asset/zero-byte/oversized/non-timeout/other-host terminations fail-closed.
- [x] Require strict receipt validation for the exact graceful disposition; reject fabricated disposition on error-free or out-of-bound tunnels.
- [x] Preserve IPv4, official-host allowlist, port 443, zero retry, no mirror change, partial-cache nonreuse and Candidate deny-network.
- [x] Pass the complete non-nested macOS source contract `117/117`.
- [ ] Commit/push a new exact PR #54 head and pass the complete GitHub source gate.
- [ ] Issue R6 with all-new authority, cache, worktree, evidence, Candidate, artifact, app-data and runtime identities; R1–R5 remain ineligible for reuse.

Exact unlock condition: only the new source-gated PR #54 SHA/tree may authorize R6. Local unit PASS and R5's partial cache are not deployment authority.

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
- [x] Pass complete source gate on final evidence-containing R67 PR #36 head `05185bf6d8239da22b80e89cf1c27edf1bb3d4c6`; final rerun job `93354715454`, `17/17 PASS`.
- [x] Squash PR #36 only into Draft PR #20 with expected-head binding as `68e9cb99f65bfb79562c9e6d49cf9351cb8a70a5`.
- [x] Align PR #20 exact-object authority to the integrated R67 truth.
- [ ] Pass the complete source gate on the resulting exact PR #20 head after this authority alignment.
- [ ] Freeze the new 40-character `EXACT_FINAL_HEAD` with no subsequent tracked source change.

## P0 — MiniMax Code R68 fresh macOS Candidate

MiniMax remains stopped until ChatGPT supplies `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, a new unique `RUN_STAMP`, and six all-new paths.

- [ ] Fetch `refs/pull/20/head` and prove `FETCH_HEAD == EXACT_FINAL_HEAD`.
- [ ] Read exact-object deployment authority and Candidate scripts.
- [ ] Use no R66/predecessor cache, worktree, evidence, manifest, artifact or runtime identity.
- [ ] Pre-network manifest must prove root exact-spec completeness and alias-aware registry identity.
- [ ] Require real specs `string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0` present and corresponding fake `*-cjs` registry specs absent.
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
