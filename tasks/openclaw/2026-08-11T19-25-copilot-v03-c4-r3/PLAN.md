# PLAN — COPILOT-SKE-V03-C4-R3

1. Freeze R3 from exact R1 post-fix source Head.
2. Replace only `capability.ts` with the stronger R2 structural validator.
3. Add focused structural fail-closed capability tests; do not lower coverage.
4. Open a fresh Draft review PR against the v0.3 planning branch solely to trigger the existing source gate.
5. Run exact Node 24/macOS gate: package/lock identity, build/check, complete KB tests, global coverage, strict Shared Engine per-file coverage, storage-neutral scan, source-clean.
6. Stop on first real source failure and repair on a new SHA; never rerun the failed R1 SHA.
7. On PASS, write RESULT/EVIDENCE/commands.log and prove the post-gate diff is evidence-only.
8. Parent PM may source-accept R3, but C4 cannot merge while C3 PR #46 remains Draft/unmerged.
