# Changelog

## 2026-08-14 — R5 GitHub control-tunnel graceful EOF

- Sealed R5 as immutable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`: source `112/112 PASS`, one hydration, zero dry-run/Candidate/package/App/E2E/performance.
- Classified the failure as a late `github.com` control/redirect tunnel `ETIMEDOUT` after 3,088 bytes; the bounded proxy had transferred 121,555,082 upstream-to-client bytes in total before forced downstream destruction surfaced as Electron `socket hang up`.
- Added a narrow graceful-EOF disposition only for `github.com + ETIMEDOUT + 1..65536 bytes` and made it receipt-bound.
- Kept release-assets, zero-byte, oversized, non-timeout and other-host errors fail-closed; preserved IPv4, no retry, no mirror change, partial-cache nonreuse and Candidate deny-network.
- Added transport and receipt-audit regressions, including rejection of fabricated/out-of-bound graceful claims.
- Passed the complete source contract `117/117` in the non-nested macOS environment. R6 remains blocked until the new PR #54 head passes GitHub source gate.

## 2026-08-14 — Receipt-bound IPv4 native hydration proxy

- Recorded R4 as immutable transport-blocked after exact authority and `111/111` source contracts passed; hydration ran once, while Candidate and App execution counts stayed zero.
- Reproduced the exact default-family CONNECT proxy at `1/3` registry success with two upstream `ETIMEDOUT` events, while direct IPv4 and a diagnostic-only `family:4` proxy each passed `3/3`.
- Bound the production proxy's single upstream connection to IPv4 and added `proxyUpstreamFamily=4` to transport policy and receipt audit validation.
- Preserved official-host allowlist, port `443`, registry/mirror, timeouts, concurrency, no retry, partial-cache nonreuse, Candidate network denial, and all release gates.

## 2026-08-14 — Deterministic native-cache watchdog contract

- Replaced the watchdog unit test's fixed 80ms wall-clock wait with injected manual timeout/grace timers.
- Added a regression proving `SIGKILL` is cancelled when the child closes during the grace window.
- Preserved production watchdog implementation and all timeout, process-group, signal, audit, and no-retry semantics.
- Focused contract passed 100 consecutive runs; the complete Candidate source contract passed `111/111` outside the nested Codex sandbox.
- Recorded local deployment R1/R2/R3 as immutable evidence bound only to `b8b04819ac25629b0f2a5135858532902567b794`; no Candidate, artifact, E2E, performance, signing, notarization, release, or Human Owner PASS was created.

## 2026-08-14 — Web-first UI verification receipt

- Added source/implementation 1440x900 comparison evidence and `design-qa.md` with `final result: passed`.
- Recorded the passing browser-only typecheck, build, focused `21/21` UI tests, four-destination journey, and zero browser console errors.
- Recorded the broad Desktop suite as `NOT PASS` rather than hiding or upgrading unrelated native/Electron and historical-fixture failures.
- Kept Electron launch, native staging, packaging, signing, deployment, and deployment-executor notification blocked pending explicit Owner web acceptance.

## 2026-08-13 — Demo-source web-first UI correction

- Added the exact Owner-pinned Demo HTML as an immutable repository authority copy (`52046` bytes, SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`).
- Corrected the renderer and startup shell from five primary destinations to the Demo's four: Today, Knowledge, Conversations, Settings.
- Kept Wiki Studio available through a secondary action inside Knowledge.
- Added the explicit sequencing gate: browser development/test/Owner acceptance first; Electron integration, packaging, and local deployment notification later under separate successor authority.
- Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / OWNER_WEB_UI_ACCEPTANCE=PENDING`.

## 2026-08-10 — R67 npm alias registry identity repair

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`.

### R66 local blocker

- Exact PR #20 source `beb951b95695233911da0a17543ef342acc6df93` was source-green and MiniMax source contracts `106/106 PASS`.
- R65 root exact-spec completeness passed (`1361/1361`), exact-source launcher passed, one real hydrator started, Candidate execution count remained zero.
- Registry prefetch completed 50 batches and stopped fail-closed on batch 51 with `npm pack string-width-cjs@4.2.3` → `ETARGET`.
- R66 source is Tier-B consumed; no retry/resume/reuse is permitted and all local cache/evidence identities are immutable predecessor references.

### Root cause

The failing `*-cjs` entries are npm alias/install-path lock entries, not proof that the entire lockfile is stale. The root lock explicitly records:

```text
node_modules/string-width-cjs  -> name=string-width, version=4.2.3
node_modules/strip-ansi-cjs    -> name=strip-ansi, version=6.0.1
node_modules/wrap-ansi-cjs     -> name=wrap-ansi, version=7.0.0
```

R65 exact-version-only fallback ignored `entry.name` and incorrectly converted the install path into a registry package spec, producing fake names such as `string-width-cjs@4.2.3`.

### R67 source repair

- Added lock-entry-aware exact-version-only identity: a valid `name` on a non-link `node_modules/...` entry is authoritative for registry prefetch.
- Install-path package name is only a fallback when `entry.name` is absent.
- Root/workspace entries outside `node_modules` remain excluded.
- Added synthetic alias and exact-repository regressions requiring `string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0` and forbidding corresponding fake `*-cjs@...` specs.
- No package/lockfile regeneration, dependency version change, mirror/allowlist expansion, retry/resume change, Candidate network change, product runtime change or `main` change.
- R67 implementation head `20003b07b8137a369263e0fadb3b4f4171d7d392` passed source gate run `31354821614`, job `93352458882`, `17/17 PASS`.
- Final evidence-containing PR #36 head `05185bf6d8239da22b80e89cf1c27edf1bb3d4c6` passed source gate run `31355390496`; initial Step 12 failure was adjudicated CI transient after exact-diff proof and one same-SHA failed-job rerun, final job `93354715454` `17/17 PASS`.
- PR #36 squash-merged only into Draft PR #20 source branch as `68e9cb99f65bfb79562c9e6d49cf9351cb8a70a5`; `main` remains untouched.
- Final PR #20 exact head after the authority-alignment commits must pass the complete source gate before MiniMax R68 receives deployment authority.

## 2026-08-07 — R50 Metadata-Complete Registry Prefetch

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`.

### R49 local blocker

- Exact PR #20 source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` passed source gate run `31157162004`, job `92799120113`, `17/17 PASS`.
- MiniMax exact-object authority and Candidate source contracts `95/95 PASS`.
- One Owner-authorized hydration invocation ran; Candidate execution count remained zero.
- R48 tarball-only prefetch completed far enough to reach strict lifecycle `npm ci --offline`, which reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`.
- The deterministic defect is incomplete npm registry metadata/packument cache closure, not a product-code defect. Cumulative proxy evidence also contained a registry `ECONNRESET`, but R50 scopes stage errors so earlier tunnel errors cannot mask a later offline-cache blocker.
- Source stayed clean; no PASS receipt, Candidate, artifact SHA-256 or runtime ID exists. R49 cache/evidence is immutable reference-only and cannot be retried/resumed/reused.

### R50 source repair

- Added metadata-complete registry prefetch strategy `lockfile-batched-name-version-npm-pack-v2`.
- Exact package-lock v3 registry entries are represented as deterministic exact `name@version` specs while retaining canonical tarball URL and integrity identity.
- Bounded 24-item `npm pack --ignore-scripts name@version` batches warm npm registry packument/metadata plus tarball cache using the unchanged isolated cache, localhost proxy, official host allowlist, and zero retry.
- Added a strict `(deny network*) npm ci --offline --ignore-scripts` registry-cache closure proof before lifecycle scripts.
- Closure failure is `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE` with non-reusable `HYDRATION-FAILED.json` evidence.
- After closure, lifecycle/native asset hydration may use the existing bounded official-asset proxy but must emit zero `registry.npmjs.org` requests; any leak is `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`.
- PASS receipt validation now binds prefetch strategy, metadata mode, manifest SHA-256, batch count, closure proof, zero post-closure registry requests, source/lock/cache identity, and existing final deny-network install/native proofs.
- No product/UI/database/vector-store/package/lockfile/allowlist/credential/global-config/signing/notarization change.

### Source validation and integration

- R50 implementation head `88d66a34b3416a917ef1a39ac6d1e72ea8540922`: source gate run `31160628979`, job `92809916272`, `17/17 PASS`.
- Final evidence-containing PR #25 head `4707148f9402cddf5959067fee46f6686e0af6ad`: source gate run `31161050220`, job `92811240325`, `17/17 PASS`.
- PR #25 squash-merged only into Draft PR #20 source branch as `42357ea7d48e691624c43c1c182c0d1c0ec9752d`; `main` remains untouched.
- Final PR #20 exact head after this governance freeze must pass the complete source gate before MiniMax receives new deployment authority.

## 2026-08-07 — R48 Segmented Registry Prefetch

- Source `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f` was source-green but its one bounded hydration stopped before Candidate creation on registry transport reset; source remained clean and the failed cache became non-reusable evidence.
- R48 replaced one registry-heavy online lifecycle install with deterministic package-lock tarball batches followed by registry-offline lifecycle install.
- PR #24 final head `8297cd4f7ebea0bcd7b6477f36f1b91b148c31cb` passed complete source gate run `31156362975`, job `92796663770`, `17/17 PASS` and merged only into PR #20 as `1f9beaaf60f08b607204be8b99f93cca5d48c408`.

## 2026-08-07 — R47 Owner-Directed llm_wiki + Demo UI MVP Integration

- Clean-room adapted `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (GPLv3) into the existing Electron/TypeScript/SQLite/local-KG/local-RAG architecture without copying upstream GPL implementation bytes.
- Added `知识台 / Wiki Studio`: Sources, Wiki/provenance, local Review Queue metadata, Activity, existing Graph, clean-room 4-Signal Connections and explicit reindex/retry.
- Preserved Ask/source return continuity, Todo All/Unscheduled/edit/schedule closure, local-ASR contracts and Candidate authority.
- PR #23 final head `8f0d1604217c966e696e7caf8763496c6be681c9` passed source gate run `31150946435`, job `92780309284`, `17/17 PASS` and merged only into PR #20 as `292e2a6160cf009a13492c93af96f5ff3c320899`.

## 2026-08-03 — R46 / R45 / R44 retained source lineage

- R46 hardened hydration TCP transport/evidence while keeping `automaticRetry=false`, partial-cache nonreuse and Candidate deny-network.
- R45 introduced receipt-bound native-toolchain hydration after the first Candidate Gate 2 offline-native blocker.
- R44 consolidated the macOS-first remote product source into Draft PR #20. Source success never implied Electron runtime, signing, notarization, Release or MVP completion.

## R31 / R30 Candidate contract retained

The complete detailed pre-R30 history remains byte-preserved at `history/CHANGELOG_PRE_R30.md` and repository history mirror `docs/history/CHANGELOG_PRE_R30.md`.

The executable macOS Candidate remains twelve ordered fail-closed gates:

- **Gate 2** — exact receipt-bound full lifecycle install under deny-network.
- **Gate 3** — complete tracked-file SHA-256 ledger and aggregate.
- Gate 4 — source contracts and ordered LLM → KB → KG → RAG build.
- Gate 5 — checks/tests/coverage/build/SBOM.
- Gate 6 — canonical unsigned macOS arm64 package authority.
- Gate 7 — source/artifact identities.
- Gate 8 — focused packaged Electron.
- **Gate 9** — exact `113 tests in 9 files` plus deterministic test-data manifest.
- Gate 10 — packaged Electron `113/113` and clean termination.
- **Gate 11** — three Candidate-bound performance runs.
- **Gate 12** — final source/artifact/runtime/test-data/evidence receipt.

Deployment authority is read from the **exact Git object** through `scripts/candidate-r30/minimax-authority.mjs`; stale worktrees, branch names, CI summaries and chat transcripts are not Candidate identity.
