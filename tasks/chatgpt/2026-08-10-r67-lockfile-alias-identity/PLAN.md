# PLAN — R67

1. Freeze R66 evidence as consumed/fail-closed; never reuse its 686 MB partial cache or local paths.
2. Independently inspect root `package-lock.json` and distinguish install-path aliases from registry package identity.
3. Patch only registry-prefetch exact-version identity derivation.
4. Add synthetic alias regression plus exact-repository regression.
5. Run the complete `copilot-source-gate` on the code Head.
6. If green, write Parent PM RESULT/EVIDENCE/status/handoff truth.
7. Run the complete source gate again on the final evidence-containing Head.
8. Squash only into Draft PR #20 with expected-head binding; never merge `main`.
9. Align PR #20 authority and run one final exact-head source gate.
10. Issue a new MiniMax successor with a new SOURCE_COMMIT and RUN_STAMP; Codex remains waiting for one coherent Candidate identity.
