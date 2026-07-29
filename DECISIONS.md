# DECISIONS

## D-2026-07-29-01: Git Baseline And Product Input

GitHub `main@96c861706126317c27965fcb64c765973df9ac89` is the Git baseline. r3 is the new candidate product-layer input and must remain distinct from review branches and review reports.

## D-2026-07-29-02: Worktree Reuse

Use the existing clean worktree `/Users/njx/openclaw/copilot.wt-S15C`. Do not create another worktree for Stage 0 recovery.

## D-2026-07-29-03: Todo Due-Date Route Pending Source Audit

Do not assume unscheduled Todo is complete. If the current domain and persistence model already support it end-to-end, expose a discoverable All/Unscheduled route with canonical view/edit/restart readback. Otherwise, require a due date before creation. The P0 implementation audit selects the smaller reliable route and records the final decision.

## D-2026-07-29-04: Focused Retest Is Owner-Gate Authority

Only an independent Focused Retest can make the Human Owner Gate eligible. r3 materialization, static review, or worker self-report cannot make the release or MVP ready.
