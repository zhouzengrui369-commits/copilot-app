# EVIDENCE

- fake provider exact defect:
  `apps/copilot-desktop/tests/e2e/helpers/fake-minimax-provider.ts`
  `selectGroundedRagContent` uses one non-global match and emits one citation.
- R2 runtime artifacts:
  `apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/`
- production retrieval behavior:
  - `VectorStore.replaceNoteIndex` deletes only the matching `note_path`;
  - retrieval fusion deduplicates by distinct note path;
  - no evidence shows source B replaced source A.
- readiness defect:
  `local-knowledge-service.ts::readKnowledgeBuildStatus` can return ready at
  digest-current before checking the exact pending KG/RAG entry.
- no files changed by the diagnostic sub-agent; no command/test/Git executed.
