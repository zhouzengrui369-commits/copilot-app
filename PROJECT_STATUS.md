# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The Owner-directed R47 clean-room llm_wiki + Demo UI Knowledge Studio source is implemented, source-green on its stacked PR, and integrated only into Draft PR #20. Final PR #23 head `8f0d1604217c966e696e7caf8763496c6be681c9` passed the complete Node 24/macOS source gate in run `31150946435`, job `92780309284`, with all 17 workflow steps successful; it was then merged into `chatgpt/mvp-source-finalization` as merge commit `292e2a6160cf009a13492c93af96f5ff3c320899`. R31 remains the authoritative Phase 1 source-completion baseline beneath this additive R47 product slice. This governance alignment is the last tracked-source update phase before the final PR #20 source gate. No packaged Electron Candidate, artifact SHA-256, runtime ID, independent Codex acceptance, signing, notarization, Release, Experience readiness, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R31 pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`
- R31 pre-Studio source gate: run `30819543111`, `17/17 PASS`
- R31 Desktop Phase 1 source suite at that baseline: `1107/1107 PASS`
- R47 implementation-only head: `6886bd37bbc80658b7e994bed052d1ec6b2b65e6`; source gate run `31150271762`, job `92778261873`, `17/17 PASS`
- R47 final stacked head: `8f0d1604217c966e696e7caf8763496c6be681c9`; source gate run `31150946435`, job `92780309284`, `17/17 PASS`
- R47 integration into PR #20 source branch: `292e2a6160cf009a13492c93af96f5ff3c320899`
- Final PR #20 source gate: pending on the exact head produced after this final governance freeze
- Electron list-only Candidate discovery contract remains exact `113 tests in 9 files`
- Upstream architectural reference: `nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7, GPLv3)

The exact Git commit object, not a branch name, stale worktree, browser fixture, CI summary, package output, or chat transcript, is the only deployment authority.

## Source-reuse decision

Because `nashsu/llm_wiki` is GPLv3 while Copilot's current internal source is identified as UNLICENSED, R47 is a clean-room behavioral/architectural adaptation:

- no upstream GPL implementation file is copied, vendored, mechanically translated, or transpiled;
- no Tauri/Rust/DuckDB runtime is imported;
- no second database, second knowledge base, or second vector store is introduced;
- current Electron/TypeScript/SQLite/KG/RAG boundaries remain authoritative.

Provenance and mapping are recorded in `docs/development/LLM_WIKI_CLEAN_ROOM_MVP.md` and `THIRD_PARTY_NOTICES.md`.

## Integrated product source

The existing demo-first Electron shell now includes a dedicated `知识台 / Wiki Studio` while retaining the canonical `KnowledgeWorkspace`.

The Studio provides:

1. **Sources** — searchable local-note rail with fail-closed WIKI/build state.
2. **Wiki** — raw local source plus digest-bound WIKI summary/tags/entities/provenance.
3. **Review Queue** — projection-bound local review metadata (`accepted` / `deferred`) that cannot mutate canonical truth.
4. **Activity** — existing durable `kg_pending` / `knowledgeBuild` states; no duplicate queue or database.
5. **Graph** — existing local Sigma/Graphology KG renderer.
6. **4-Signal Connections** — clean-room relevance ranking using direct relation ×3, source overlap ×4, Adamic-Adar ×1.5, same type ×1.
7. **Explicit retry** — `重新整理` uses the existing local reindex path; opening the Studio does not silently trigger model work.
8. **Demo UI reuse** — the existing demo-first product shell remains the visual/navigation basis.

## Preserved MVP critical loop

R47 does not replace or weaken the existing bounded source truth:

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

EXP-COP-008/009 source closure, local-ASR contracts, Candidate runner, deny-network Gate 2 and R46 native-cache transport controls remain in the PR #20 lineage.

## Role boundary

1. ChatGPT Parent PM owns bounded GitHub source work, exact-source freeze and MiniMax task contract.
2. MiniMax starts only after the final exact PR #20 SHA passes the complete source gate; it cannot repair source during Candidate execution.
3. Codex starts independent product acceptance only after a complete source/artifact/runtime/test-data-bound MiniMax receipt exists.
4. CI, static tests, jsdom/browser fixture, build/package success, merge, or MiniMax self-test cannot substitute for real packaged Electron acceptance.

## Remaining gates

- Pass the complete `copilot-source-gate` on the exact PR #20 head after this final tracked governance freeze.
- Freeze that 40-character SHA and make no later tracked source change.
- Issue a fresh exact-SHA MiniMax contract; use new worktrees/cache/receipt/evidence/artifact/runtime identities and never reuse R44/R45/R46 assets.
- Pass Candidate Gates 1–12 on macOS, including packaged Electron `113/113`, three distinct candidate-bound performance runs, screenshots, identities/manifests and clean termination.
- Let Codex independently operate the same packaged Electron Candidate and report P0/P1/P2.
- Preserve Developer ID signing, notarization/staple/Gatekeeper and Human Owner Gate as separate release gates.

## Next single action

Run the complete source gate on the final exact PR #20 head, freeze that SHA, then hand only that exact Git object to MiniMax Code for a fresh macOS Candidate. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY` until independent packaged Electron evidence exists.
