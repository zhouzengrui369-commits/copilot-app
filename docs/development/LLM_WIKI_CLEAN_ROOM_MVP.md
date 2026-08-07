# Copilot App MVP — llm_wiki Clean-Room Adaptation

Date: 2026-08-07

## Owner direction

The Owner asked the Parent PM to use the prior `nashsu/llm_wiki` research and the existing demo UI source as the implementation basis for the Copilot App macOS MVP.

This document fixes the safe source-reuse boundary. It does not change the v6.2 local-first, macOS-first, MiniMax-first or independent Electron acceptance gates.

## Reference identities

### Upstream architecture reference

```text
repository: nashsu/llm_wiki
commit:     ad215b51252ffc1c6721d5b057f0449a2fb51530
release:    v0.6.7
license:    GNU GPL v3
```

The existing product research lives on Copilot's current main history as `docs/llm-wiki-ecosystem-fit-report.md`.

### Copilot product source

```text
parent MVP source: chatgpt/mvp-source-finalization
pre-slice commit:  0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29
implementation:    chatgpt/mvp-llm-wiki-demo-ui
```

### Demo UI basis

The Electron product already imports and uses:

```text
apps/copilot-desktop/src/renderer/styles/demo-first-prototype.css
apps/copilot-desktop/src/renderer/styles/demo-source-v4.css
```

The new Knowledge Studio keeps that shell and adds a responsive three-column workspace rather than replacing the existing renderer or introducing another UI runtime.

## GPL boundary

No upstream source file is copied, vendored, mechanically translated, or transpiled into Copilot App.

The implementation is clean-room behavior-level adaptation because:

1. Copilot App currently identifies its internal source as `UNLICENSED` and has no Owner-approved GPL distribution decision.
2. Directly copying GPLv3 implementation bytes would create a materially different licensing/distribution decision.
3. The product already has its own Electron/TypeScript/SQLite/KG/RAG architecture, so importing Tauri/Rust/DuckDB code would also violate the current no-second-database / no-second-knowledge-store boundary.

If verbatim GPL code is desired later, stop and run a separate Owner-approved licensing review first.

## Behavior mapping

| llm_wiki concept | Copilot clean-room adaptation | Canonical truth |
|---|---|---|
| Raw source → WIKI | Existing local note + digest-bound `WikiTruthReceipt` | local note bytes + local KG WIKI projection |
| Persistent ingest queue | Existing durable `kg_pending` / `knowledgeBuild` states surfaced as Activity | existing KB SQLite queue |
| Review Queue | Projection-bound local human review metadata + explicit retry | WIKI truth remains canonical; review metadata is UI-only local state |
| 4-Signal graph | New pure relevance model over existing local `KgSubgraph` | existing local KG nodes/edges/source notes |
| Three-column workbench | Sources / Wiki-Review-Graph / Activity-Connections | existing Electron demo shell |
| Ask / source traceability | Existing Ask conversation + source origin + full reader | existing local RAG/source receipts |
| Background recovery | Existing startup reconciliation and fail-closed background build state | existing KB/KG local persistence |

## 4-Signal relevance contract

The clean-room model uses the four public behavior signals while adapting them to Copilot's existing KG schema:

```text
direct relation      × 3.0
source-note overlap  × 4.0
Adamic-Adar          × 1.5
same entity type     × 1.0
```

The score is a discovery/ranking signal only. It does not create or mutate KG edges and does not become RAG truth by itself.

## Review Queue truth

Review decisions are intentionally separate from WIKI truth:

- `accepted`: Owner has reviewed the current projection identity;
- `deferred`: Owner wants to revisit it;
- a new projection/digest creates a new review identity;
- `failed`, `stale`, `missing`, `queued`, `running`, and `not-ready` remain visible and cannot be marked as current by the review UI;
- `重新整理` explicitly calls the existing local reindex path; there is no background surprise model spend triggered by opening the Studio.

Review metadata is local UI state. It cannot overwrite note bytes, WIKI status, KG rows, RAG sources, Todo truth, or schedule truth.

## Product surface

The new `KnowledgeStudioWorkspace` adds:

1. local Source rail with search and WIKI state chips;
2. Wiki panel with raw-source visibility, digest-bound summary, tags, entities and provenance;
3. human Review Queue with projection-bound local decisions;
4. Graph panel that reuses the existing Sigma/Graphology local KG renderer;
5. Activity panel exposing persistent knowledge-build states;
6. 4-Signal connection panel built from current local KG data;
7. explicit navigation back to the existing knowledge editor and Ask workspace.

The existing `KnowledgeWorkspace` remains intact and authoritative for note editing, full reader, Ask-source return continuity, MOC and current WIKI fail-closed behavior.

## Non-goals

This adaptation does not add:

- Tauri or Rust;
- DuckDB;
- LanceDB or another vector store;
- another database or knowledge base;
- llm_wiki MCP server;
- Deep Research;
- multi-project workspace management;
- cloud data truth;
- Windows or mobile MVP scope;
- 3D graph;
- automatic LLM writes without local receipts;
- GPL source bytes.

## Acceptance

Remote source acceptance requires the existing `copilot-source-gate` plus the new Knowledge Studio model/UI tests.

Local product acceptance remains separate:

```text
MiniMax Code: exact-SHA clean-worktree build/package/technical evidence
Codex:        independent real packaged Electron operation and experience verdict
Owner:        final Human Owner Gate
```

Until candidate-bound Electron evidence exists:

```text
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
