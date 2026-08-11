# PLAN — COPILOT-SKE-V03-C1-R1

1. Add a pure TypeScript `shared-engine` submodule under `@copilot/kb`; it must not import SQLite, filesystem, Electron, KG or RAG modules.
2. Define the v0.3-draft canonical envelope and runtime validator.
3. Implement deterministic canonical JSON + SHA-256 identities/content hashes.
4. Implement Note -> Source + Knowledge mapping; keep note path as source identity input, never public database identity.
5. Implement structural Entity/Relation adapters using plain input interfaces so KG storage remains replaceable.
6. Emit mapping/revision receipts with previous/next hashes and revision numbers.
7. Add policy-filtered read decisions for namespace, purpose, consumer and D0/D1 ceiling; D2/D3 denied by default C1 fixture policy.
8. Add write-proposal creation only; no method may accept it into canonical truth in C1.
9. Export the submodule from `@copilot/kb` without changing existing exports.
10. Add focused tests, open stacked Draft PR, run complete GitHub Source Gate, inspect diff and CI before any merge.

## Rollback

C1 is additive source only. Rollback is closing/reverting the C1 PR; existing KB/KG/RAG schemas/data are unchanged.