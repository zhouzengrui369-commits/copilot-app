# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The R31 macOS-first local-first product source remains the executable baseline. The Owner's 2026-08-07 direction has been implemented as a clean-room llm_wiki-inspired Knowledge Studio on Draft PR #23. The implementation-only head `6886bd37bbc80658b7e994bed052d1ec6b2b65e6` passed the complete Node 24/macOS source gate (`31150271762`, 17/17 steps). Parent PM evidence/governance receipts were committed afterward, so the final evidence-containing PR #23 head still requires one fresh complete source gate before integration. No current packaged Electron Candidate, artifact SHA-256, runtime ID, independent Codex acceptance, signing, notarization, Release, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- R31 product lineage: source-complete and preserved
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- Pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`
- Pre-Studio source gate: run `30819543111`, all 17 steps PASS
- Candidate source contracts: `90/90`
- Desktop Phase 1 source suite before Studio: `1107/1107`
- Electron list-only discovery: exact `113 tests in 9 files`
- Active Parent PM implementation: PR `#23`, branch `chatgpt/mvp-llm-wiki-demo-ui`
- R47 implementation-only source gate: head `6886bd37bbc80658b7e994bed052d1ec6b2b65e6`, run `31150271762`, job `92778261873`, `17/17 PASS`
- R47 final evidence-containing source gate: pending on the final PR #23 head
- Upstream architectural reference: `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7, GPLv3)
- Exact successor deployment SHA: supplied only after PR #23 is merged into Draft PR #20 and the resulting exact PR #20 head passes the complete source gate.

The exact Git commit object, not a branch tip, stale worktree, browser fixture, GitHub status summary, or chat transcript, is the only deployment authority.

## Owner direction and source-reuse decision

The Owner explicitly directed the Parent PM to use the prior llm_wiki research and demo UI source as the basis for MVP delivery.

Because the upstream is GPLv3 and Copilot currently identifies its own internal source as UNLICENSED, this slice uses a clean-room adaptation:

- no upstream GPL source file is copied or vendored;
- no Tauri/Rust/DuckDB runtime is imported;
- no second database, second knowledge base, or second vector store is introduced;
- current Electron/TypeScript/SQLite/KG/RAG boundaries remain authoritative.

The detailed provenance is in `docs/development/LLM_WIKI_CLEAN_ROOM_MVP.md` and `THIRD_PARTY_NOTICES.md`.

## Product implementation on PR #23

The existing demo-first Electron shell now has a dedicated `知识台 / Wiki Studio` route. The already-tested `KnowledgeWorkspace` remains intact for canonical note editing, full source reading, Ask-source return continuity and MOC behavior.

The new Studio adds:

1. **Sources** — searchable local note rail with fail-closed WIKI/build truth chips.
2. **Wiki** — raw local source + digest-bound WIKI summary/tags/entities/provenance.
3. **Review Queue** — projection-bound local review metadata (`accepted` / `deferred`), with a changed projection producing a new review identity.
4. **Activity** — existing durable `kg_pending` / `knowledgeBuild` states surfaced directly; no duplicate queue/database.
5. **Graph** — existing local Sigma/Graphology KG renderer and local `KgSubgraph` truth.
6. **4-Signal Connections** — clean-room relevance ranking using direct relation ×3, source overlap ×4, Adamic-Adar ×1.5, same type ×1.
7. **Explicit retry** — `重新整理` calls the existing local reindex route; opening the Studio does not silently trigger model work.
8. **Demo UI reuse** — responsive three-column source / center workbench / activity-insight layout within the existing `demo-first-prototype.css` and `demo-source-v4.css` shell.

Review metadata is local UI state only. It cannot change note bytes, WIKI truth, KG rows, RAG source truth, Todo truth, or schedule truth.

## Preserved MVP critical loop

The source still retains the bounded loop:

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

PR #23 does not weaken or replace EXP-COP-008/009 source closure.

## R45/R46 candidate infrastructure

The prior R44 Candidate stopped at Gate 2 and remains historical evidence. R45 added receipt-bound native-toolchain hydration. R46 added no-retry transport stability and was merged into the PR #20 source lineage.

Those controls remain unchanged by PR #23:

- Candidate deny-network;
- exact-object authority;
- one bounded Owner-authorized hydration;
- no hidden retry;
- fail-closed partial-cache handling;
- twelve Candidate gates;
- exact `113 tests in 9 files` discovery contract.

## Role boundary

1. ChatGPT Parent PM owns bounded GitHub source development, Draft PR review and MiniMax task contract.
2. MiniMax Code starts only after a new exact PR #20 source SHA passes the complete source gate; it may not repair source during Candidate execution.
3. Codex starts product acceptance only after a complete source/artifact/runtime/test-data-bound MiniMax evidence package exists.
4. CI, static code, browser fixture, build, package success, MiniMax self-test or PR merge cannot substitute for real packaged Electron acceptance.

## Remaining gates

- Pass the final evidence-containing PR #23 head through the complete Node 24/macOS source gate.
- Merge PR #23 into Draft PR #20 only; do not merge PR #20 to `main` yet.
- Pass the complete source gate on the resulting exact PR #20 head.
- Freeze the new full source SHA and issue a new clean-worktree MiniMax contract.
- Build/package and pass Candidate Gates 1–12 on macOS.
- Produce artifact SHA-256, runtime ID, test-data manifest, `113/113` packaged Electron, three performance runs, screenshots, and clean terminal state.
- Let Codex independently operate the same packaged Candidate and report P0/P1/P2.
- Preserve v6.2 release gates for packaged local ASR, verify-fix rounds, Developer ID, notarization/staple/Gatekeeper and Human Owner Gate unless the Owner explicitly changes them.

## Next single action

Pass the complete source gate on the final evidence-containing PR #23 head, integrate it into Draft PR #20, revalidate the resulting exact PR #20 source, then hand that SHA to MiniMax Code for a fresh macOS Candidate. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF` until independent Electron evidence exists.
