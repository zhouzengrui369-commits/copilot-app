# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

R31 remains the authoritative Phase 1 source-completion baseline, including the historical Desktop Phase 1 source suite `1107/1107 PASS`. The R47 clean-room llm_wiki + Demo UI Knowledge Studio remains integrated in Draft PR #20. The R49 MiniMax attempt on exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` passed exact-object authority and `95/95` Candidate source contracts, then stopped before Candidate creation because R48 tarball-only prefetch did not prove npm registry metadata cache closure: strict `npm ci --offline` reported `ENOTCACHED` for `typescript`. R50 fixes that deterministic source defect with exact `name@version` metadata+tarball prefetch, a strict deny-network registry-cache closure proof, and a zero-registry-request-after-closure invariant. No packaged Electron Candidate, artifact SHA-256, runtime ID, Codex acceptance, signing, notarization, Release, Experience readiness, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R31 pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`; source gate run `30819543111`, `17/17 PASS`; Desktop Phase 1 `1107/1107 PASS`
- R47 final stacked head: `8f0d1604217c966e696e7caf8763496c6be681c9`; run `31150946435`, job `92780309284`, `17/17 PASS`; merged into PR #20 as `292e2a6160cf009a13492c93af96f5ff3c320899`
- R48 final stacked head: `8297cd4f7ebea0bcd7b6477f36f1b91b148c31cb`; run `31156362975`, job `92796663770`, `17/17 PASS`; merged as `1f9beaaf60f08b607204be8b99f93cca5d48c408`
- R49 attempted source: `32ff3ebc0b1dc217bf0954974127b0aa68de61f2`; source gate run `31157162004`, job `92799120113`, `17/17 PASS`; local source contracts `95/95 PASS`; hydration only, no Candidate
- R49 deterministic blocker: `npm ci --offline` → `ENOTCACHED https://registry.npmjs.org/typescript`; predecessor cache/evidence remains non-reusable reference-only
- R50 repair PR #25 final head: `4707148f9402cddf5959067fee46f6686e0af6ad`; source gate run `31161050220`, job `92811240325`, `17/17 PASS`
- R50 merged only into PR #20 as `42357ea7d48e691624c43c1c182c0d1c0ec9752d`
- Final PR #20 source gate: pending on the exact tracked head created by this final R50 governance freeze
- Electron list-only Candidate discovery remains exact `113 tests in 9 files`

The **exact Git commit object**, not a branch name, stale worktree, browser fixture, CI summary, package output, or chat transcript, is the only deployment authority.

## R50 registry metadata closure

R48 used exact tarball URLs with `npm pack`, which warmed tarball content but did not guarantee every npm packument/metadata cache key needed by offline reify. R50 changes the source contract to:

```text
exact package-lock v3
→ deterministic exact name@version + canonical tarball + integrity manifest
→ bounded 24-item npm pack --ignore-scripts name@version batches
→ npm metadata/packument + tarball cache
→ strict (deny network*) npm ci --offline --ignore-scripts registry-cache closure proof
→ remove closure-proof node_modules
→ full lifecycle npm ci --offline with the existing bounded lifecycle-asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron arm64 native hydration
→ full deny-network install/native proofs
→ immutable cache ledger + PASS receipt
```

A registry-cache closure failure now stops deterministically before lifecycle assets with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`. Any registry request after closure stops with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`. `automaticRetry=false`, no retry/backoff/resume, no predecessor cache reuse, no host allowlist expansion, and Candidate Gate 1–12 deny-network remain invariant.

## Integrated product source

The demo-first Electron shell includes `知识台 / Wiki Studio` while retaining canonical `KnowledgeWorkspace`. The Studio provides Sources, digest-bound Wiki truth/provenance, projection-bound local Review Queue metadata, Activity over existing durable knowledge-build state, existing local Sigma/Graphology KG, clean-room 4-Signal Connections, and explicit `重新整理`. The GPLv3 `nashsu/llm_wiki` reference is clean-room adapted; no upstream implementation bytes, Tauri/Rust/DuckDB runtime, second DB/KB/vector store, Python daemon, or cloud truth is added.

## Preserved MVP critical loop

```text
local material
→ grounded Ask answer
→ clickable verified local source
→ full source reader
→ same Ask exchange after return
→ canonical Todo create/readback
→ All / Unscheduled exact Todo discovery
→ Todo edit and source preservation
→ schedule association
→ full Electron quit/relaunch persistence gate
```

## Role boundary

1. ChatGPT Parent PM owns bounded GitHub source work, exact-source freeze, PR review, and MiniMax task contract.
2. MiniMax starts only after the final exact PR #20 SHA passes the complete source gate; it cannot repair source during Candidate execution.
3. Codex starts independent product acceptance only after a complete source/artifact/runtime/test-data-bound MiniMax receipt exists.
4. Development Evidence Is Not Candidate Identity: CI, static tests, renderer/jsdom/browser fixture, build/package success, merge, or MiniMax self-test cannot substitute for packaged Electron acceptance.

## Remaining gates

- Pass `copilot-source-gate` on the exact PR #20 head after this final tracked R50 governance freeze.
- Freeze that 40-character `EXACT_FINAL_HEAD` and make no later tracked source change.
- Issue a fresh exact-SHA MiniMax contract with a new run stamp and entirely new paths; R49 and all predecessor caches/evidence remain reference-only.
- Pass Candidate Gates 1–12, packaged Electron `113/113`, three performance runs, Wiki Studio, full Ask/source/Todo/schedule/quit-relaunch loop, local ASR, screenshots, identities/manifests, and clean termination.
- Let Codex independently operate that same packaged Candidate and report P0/P1/P2.

## Next single action

Run the complete source gate on the final exact PR #20 head produced after this R50 governance freeze, freeze that SHA, then hand only that exact Git object to MiniMax Code for one fresh macOS Candidate attempt. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY` until independent packaged Electron evidence exists.
