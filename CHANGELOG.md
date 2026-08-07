# Changelog

## 2026-08-07 — R50 Metadata-Complete Registry Prefetch

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`.

### R49 local blocker

- Exact PR #20 source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` passed source gate run `31157162004`, job `92799120113`, `17/17 PASS`.
- MiniMax exact-object authority and Candidate source contracts `95/95 PASS`.
- One Owner-authorized hydration invocation ran; Candidate execution count remained zero.
- R48 tarball-only prefetch completed far enough to reach strict lifecycle `npm ci --offline`, which reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`.
- The deterministic defect is incomplete npm registry metadata/packument cache closure, not a product-code defect. Cumulative proxy evidence also contained a registry `ECONNRESET`, but R50 now scopes stage errors so earlier tunnel errors cannot mask a later offline-cache blocker.
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

R31 remains the source-completion baseline and the macOS Candidate remains twelve ordered fail-closed gates:

1. exact source and clean preimage;
2. receipt-bound lifecycle install under deny-network;
3. complete tracked-file SHA-256 ledger;
4. source contracts and ordered LLM → KB → KG → RAG build;
5. checks/tests/coverage/build/SBOM;
6. canonical unsigned macOS arm64 package authority;
7. source/artifact identities;
8. focused packaged Electron;
9. exact `113 tests in 9 files` plus deterministic test-data manifest;
10. packaged Electron `113/113` and clean termination;
11. three Candidate-bound performance runs;
12. final source/artifact/runtime/test-data/evidence receipt.

Deployment authority is read from the exact Git object through `scripts/candidate-r30/minimax-authority.mjs`; stale worktrees, branch names, CI summaries and chat transcripts are not Candidate identity.
