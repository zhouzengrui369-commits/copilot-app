# TASK — R47 Parent PM Source Slice

## Problem

The Copilot MVP already had local-first knowledge, grounded Ask/source continuity, canonical Todo persistence and a demo-first Electron shell, but the Owner-directed llm_wiki research had not yet been turned into one coherent knowledge workbench surface.

## Scope

Implement only the macOS-first source slice required to expose a clean-room `知识台 / Wiki Studio` over the existing local truth:

- Sources rail;
- digest-bound Wiki truth/provenance;
- projection-bound local Review Queue metadata;
- Activity over existing durable knowledge-build state;
- existing local KG renderer;
- clean-room 4-Signal connection relevance;
- explicit reindex/retry;
- navigation back to canonical Knowledge and Ask workspaces.

## Non-goals

- no upstream GPL source copying or vendoring;
- no second DB/KB/vector store;
- no Tauri/Rust/DuckDB/Python daemon;
- no cloud truth, Windows/mobile/3D/plugins/multi-user/commercial expansion;
- no package-major upgrades;
- no credentials/signing/notarization/global configuration changes;
- no claim that CI/browser/build/package equals Electron runtime acceptance.

## Acceptance

The exact final PR #23 head must pass the complete Node 24/macOS `copilot-source-gate`. After that, integrate only into Draft PR #20, re-run the same complete gate on the resulting exact PR #20 head, freeze that SHA, and only then issue the MiniMax clean-worktree candidate contract.
