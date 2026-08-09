# PLAN

1. Freeze R61 as consumed evidence-only; do not reuse its source/run/paths.
2. Add `scripts/candidate-r30/native-cache-background-launch.mjs` with explicit absolute authority and no shell/`setsid`.
3. Add source contracts proving the launcher never pre-creates cache/PASS-receipt targets and rejects existing cache targets without deletion.
4. Run the complete Node 24/macOS `copilot-source-gate` on the implementation Head.
5. If a Desktop-only CI failure occurs while exact diff contains no Desktop input changes, allow one same-SHA GitHub job verification with zero tracked/threshold changes.
6. Update `PROJECT_STATE.yaml` and `docs/MINIMAX_LOCAL_DEPLOYMENT_MVP.md` to record R61 terminal truth and make the R62 launcher authoritative for the next local successor.
7. Add standard R62 Parent PM evidence.
8. Run the complete source gate on the final evidence-containing R62 Head.
9. Only after final source-green, squash PR #33 into Draft PR #20.
10. Align PR #20 authority, run one final complete source gate, freeze exact SHA, and issue MiniMax R63 with new RUN_STAMP/six fresh paths.
11. Keep PR #20 Draft and do not merge `main`.
