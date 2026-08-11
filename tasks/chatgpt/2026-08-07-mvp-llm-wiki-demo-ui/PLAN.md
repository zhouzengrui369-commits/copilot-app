# PLAN — Copilot MVP llm_wiki + Demo UI Integration

## Goal

Deliver one bounded remote-source slice that turns the existing Copilot Electron MVP into a more coherent local-first knowledge workbench by clean-room adapting the researched `nashsu/llm_wiki` architecture and reusing the existing demo UI shell.

## Base

```text
repository: zhouzengrui369-commits/copilot-app
base branch: chatgpt/mvp-source-finalization
base commit: 0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29
work branch: chatgpt/mvp-llm-wiki-demo-ui
```

## Upstream reference

```text
nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530
GNU GPL v3
```

No GPL implementation bytes may be copied. Behavior and architecture are reimplemented against Copilot's existing Electron/TypeScript/SQLite contracts.

## Allowed product files

- `apps/copilot-desktop/src/renderer/App.tsx`
- `apps/copilot-desktop/src/renderer/startup-shell.tsx`
- `apps/copilot-desktop/src/renderer/components/Assistant/types.ts`
- `apps/copilot-desktop/src/renderer/workspaces/KnowledgeStudioWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/KnowledgeStudioWorkspace.module.css`
- `apps/copilot-desktop/src/renderer/workspaces/knowledge-studio-model.ts`
- bounded tests for the new model/UI/navigation

## Preserved product source

Do not rewrite the existing `KnowledgeWorkspace`, Ask/source continuity, Todo canonical persistence, schedule, RAG, KG, local-ASR, candidate runner, package versions, or native cache controls in this slice.

## Deliverable behavior

- explicit `知识台` route in the existing demo-first shell;
- Sources / Wiki-Review-Graph / Activity-Connections three-column layout;
- digest-bound WIKI truth and provenance;
- projection-bound human Review Queue;
- Activity view over existing durable knowledge-build states;
- clean-room four-signal connection score over existing local KG;
- explicit reindex/retry, no surprise model spend on open;
- local-first and GPL clean-room boundary visible in product/docs.

## Remote gates

1. TypeScript check.
2. New model tests.
3. New Knowledge Studio renderer tests.
4. Existing source-contract suite.
5. Existing complete `copilot-source-gate` after the stacked Draft PR is opened.
6. Clean tracked/untracked source.

## Runtime boundary

CI/browser tests are source evidence only. MiniMax and Codex must still operate the same later exact candidate SHA.

```text
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
