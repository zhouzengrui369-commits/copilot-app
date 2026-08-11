# PLAN — COPILOT-SKE-V03-C6-R1

1. Keep `packages/kb/src/shared-engine/**` storage-neutral. Put real implementation binding in the desktop main-process layer where KB/KG/RAG narrow ports already coexist.
2. Implement `shared-engine-runtime-adapter.ts` as pure mapping/conformance helpers over desktop domain DTOs plus `@copilot/kb` Shared Engine exports; no direct SQLite/KG/RAG store import.
3. Implement D0/D1 hermetic tests for note/KG/RAG/projection/Agent/portability/deletion/restart identity behavior.
4. Extend CI with a C6 desktop conformance step while preserving all C1-C5 KB strict per-file gates and existing desktop tests.
5. Open one Draft C6 source PR; stop on first real compile/test/coverage failure and repair only on new SHAs.
6. On source PASS, write RESULT/EVIDENCE/commands.log and prove evidence-only post-gate drift.
7. Merge source only into the v0.3 planning branch.
8. Freeze exact C6 local Runtime successor authority and dispatch MiniMax with fresh local identities; no R75 retry/reuse.
9. Parent PM independently adjudicates MiniMax evidence. Only a complete Runtime PASS may unlock C7 Codex product-experience review.
