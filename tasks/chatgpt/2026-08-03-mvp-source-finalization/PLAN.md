# PLAN — macOS MVP Remote Source Finalization

## Objective

Consolidate the current authoritative remote product source into one Draft PR against `main`, preserve the macOS/local-first scope, and hand one exact source identity to MiniMax Code and Codex.

## Source

- Base product source: `agent/r31-source-completion@feb93d6b87284ac68a62de0919d4ee10ca25ee9d`
- Consolidation branch: `chatgpt/mvp-source-finalization`
- PR base: `main@e91cafaa22ea100428b404b371aa35dce535c5bf`

## Included

- current macOS product source and local-first packages;
- EXP-COP-008 Todo closure source and tests;
- EXP-COP-009 source-reader return continuity source and tests;
- embedded-local RAG, vector rotation and local-ASR source/package contracts;
- exact Electron discovery and candidate evidence runner;
- offline-cache hydration alignment and source gate;
- final local deployment and acceptance contracts.

## Not included

- Electron runtime acceptance;
- local source edits by MiniMax;
- signing or notarization;
- Windows/mobile/cloud/Remote/Backup expansion;
- dependency major upgrades;
- changes to review-only branch materials.

## Remote gates

1. exact branch is based on `feb93d6...`;
2. branch contains `main` as an ancestor;
3. Draft PR targets `main`;
4. `copilot-source-gate` completes successfully on the final PR head;
5. no runtime/release/experience completion language is introduced;
6. final MiniMax and Codex contracts are versioned in Git.

## Completion truth

```text
REMOTE_MVP_SOURCE_COMPLETE
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
