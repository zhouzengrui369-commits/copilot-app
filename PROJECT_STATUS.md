# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The Owner-directed R47 clean-room llm_wiki + Demo UI Knowledge Studio is integrated into Draft PR #20. R31 remains the authoritative Phase 1 source-completion baseline beneath that additive product slice, including the historical Desktop Phase 1 source suite `1107/1107 PASS`. The first integrated R47 PR #20 source `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f` was source-green but its single MiniMax native-toolchain hydration stopped before Candidate creation with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` at `registry.npmjs.org:443`. R48 has now replaced the one registry-heavy online lifecycle install with lockfile-derived bounded registry prefetch plus a registry-offline lifecycle install, and that repair has been merged only into the Draft PR #20 source branch. No packaged Electron Candidate, artifact SHA-256, runtime ID, independent Codex acceptance, signing, notarization, Release, Experience readiness, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R31 pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`
- R31 pre-Studio source gate: run `30819543111`, `17/17 PASS`
- R31 Desktop Phase 1 source suite at that baseline: `1107/1107 PASS`
- R47 final stacked head: `8f0d1604217c966e696e7caf8763496c6be681c9`; source gate run `31150946435`, job `92780309284`, `17/17 PASS`
- R47 integration into PR #20: `292e2a6160cf009a13492c93af96f5ff3c320899`
- First integrated R47 PR #20 head: `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`; source gate run `31152146196`, job `92783833715`, `17/17 PASS`
- Local hydration on `7d8495…`: exact-object authority PASS, source contracts `90/90 PASS`, one hydration invocation, then `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`; Candidate not created
- R48 repair PR: `#24`, branch `chatgpt/r48-segmented-registry-prefetch`
- R48 implementation head: `a3f87e71930857ac71abe626fea115aa709996ee`; source gate run `31155823536`, job `92794967653`, `17/17 PASS`
- R48 final stacked head: `8297cd4f7ebea0bcd7b6477f36f1b91b148c31cb`; source gate run `31156362975`, job `92796663770`, `17/17 PASS`
- R48 integration into PR #20: `1f9beaaf60f08b607204be8b99f93cca5d48c408`
- Final PR #20 source gate: pending on the exact tracked head produced by this final R48 governance freeze
- Electron list-only Candidate discovery contract remains exact `113 tests in 9 files`
- Upstream product reference remains `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7, GPLv3), clean-room adapted with no upstream implementation bytes copied

The exact Git commit object, not a branch name, stale worktree, browser fixture, CI summary, package output, or chat transcript, is the only deployment authority.

## R48 hydration repair

R46 transport hardening retained one large online `npm ci --prefer-online`. The MiniMax run on `7d8495…` showed that a very small number of allowed CONNECT tunnels could carry hundreds of MiB for long periods before an upstream registry reset. R48 changes the preparation shape without adding retry or network authority:

```text
exact package-lock v3
→ deterministic unique registry tarball manifest
→ canonical registry.npmjs.org tarballs
→ bounded 24-item npm pack --ignore-scripts batches
→ isolated npm cache
→ full lifecycle npm ci --offline inside the bounded hydration sandbox
→ lifecycle-only official Node/Electron/GitHub asset access through the unchanged proxy
→ Electron arm64 native hydration
→ full deny-network offline install/native proofs
→ immutable cache ledger + PASS receipt
```

The hydrator invocation remains single-shot. `automaticRetry=false`, partial-cache reuse is forbidden, the official-host allowlist is unchanged, and Candidate Gates 1–12 receive no online authority. A failed batch remains a transport blocker and cannot produce a PASS receipt.

## Integrated product source

The demo-first Electron shell includes `知识台 / Wiki Studio` while retaining canonical `KnowledgeWorkspace`. The Studio provides Sources, digest-bound Wiki truth/provenance, projection-bound local Review Queue metadata, Activity over existing durable knowledge-build state, the existing Sigma/Graphology local KG, clean-room 4-Signal Connections, and explicit `重新整理`. It adds no Tauri/Rust/DuckDB runtime, second database, second KB, second vector store, Python daemon, or cloud truth.

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

EXP-COP-008/009 source closure, local-ASR contracts, R31/R30 Candidate runner, deny-network Gate 2, and receipt-bound native-cache controls remain in the PR #20 lineage.

## Role boundary

1. ChatGPT Parent PM owns bounded GitHub source work, exact-source freeze, PR review, and MiniMax task contract.
2. MiniMax starts only after the final exact PR #20 SHA passes the complete source gate; it cannot repair source during Candidate execution.
3. Codex starts independent product acceptance only after a complete source/artifact/runtime/test-data-bound MiniMax receipt exists.
4. CI, static tests, jsdom/browser fixture, build/package success, merge, or MiniMax self-test cannot substitute for real packaged Electron acceptance.

## Remaining gates

- Pass the complete `copilot-source-gate` on the exact PR #20 head after this final tracked R48 governance freeze.
- Freeze that 40-character `EXACT_FINAL_HEAD` and make no later tracked source change.
- Issue a fresh exact-SHA MiniMax contract with a new run stamp; all prior sources, partial caches, worktrees, receipts, evidence, artifacts and runtime identities are reference-only.
- Pass Candidate Gates 1–12 on macOS, including packaged Electron `113/113`, three distinct candidate-bound performance runs, Wiki Studio and the full Ask/source/Todo/schedule/quit-relaunch loop, screenshots, identities/manifests, local ASR and clean termination.
- Let Codex independently operate the same packaged Electron Candidate and report P0/P1/P2.
- Preserve Developer ID signing, notarization/staple/Gatekeeper and Human Owner Gate as separate release gates.

## Next single action

Run the complete source gate on the exact PR #20 head created by this final R48 governance freeze, freeze that SHA, then hand only that exact Git object to MiniMax Code for one fresh macOS Candidate attempt. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY` until independent packaged Electron evidence exists.