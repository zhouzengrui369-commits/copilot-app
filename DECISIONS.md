# DECISIONS

## D-2026-07-29-01: Git Baseline And Product Input

GitHub `main@96c861706126317c27965fcb64c765973df9ac89` is the Git baseline. r3 is the new candidate product-layer input and must remain distinct from review branches and review reports.

## D-2026-07-29-02: Worktree Reuse

Use the existing clean worktree `/Users/njx/openclaw/copilot.wt-S15C`. Do not create another worktree for Stage 0 recovery.

## D-2026-07-29-03: Todo Due-Date Route Pending Source Audit

Do not assume unscheduled Todo is complete. If the current domain and persistence model already support it end-to-end, expose a discoverable All/Unscheduled route with canonical view/edit/restart readback. Otherwise, require a due date before creation. The P0 implementation audit selects the smaller reliable route and records the final decision.

## D-2026-07-29-04: Focused Retest Is Owner-Gate Authority

Only an independent Focused Retest can make the Human Owner Gate eligible. r3 materialization, static review, or worker self-report cannot make the release or MVP ready.

## D-2026-07-29-05: Keep Unscheduled Todo And Close Its Full Contract

The existing domain and local persistence represent `due_at_ms=null`. For MVP,
keep that capability and add canonical readback, All/Unscheduled discovery,
“查看待办”, persisted editing, source retention, and full quit/relaunch
recovery. Do not force a due date merely to hide an incomplete user path.

## D-2026-07-29-06: Success Requires Two Canonical Readbacks

Todo create/update success is not inferred from the returned write object.
Main must re-read and compare the canonical stored object, then renderer must
perform one list/readback by the returned ID before showing success. Any
absent/mismatched readback fails closed and keeps editable user input visible.

## D-2026-07-29-07: Persist Notes And Execution Logs In Canonical Todo Truth

The accepted Todo card behavior includes editable notes and append-only
execution logs. Keep that UX, but do not restore its former page-memory
implementation. Encode both deterministically in the existing Todo body so the
main process, renderer readback, and full restart share one local truth.

## D-2026-07-29-08: Calendar Dates Navigate To Day Scope

Clicking a calendar date must immediately show that day's local items. A prior
Unscheduled or All filter must not remain selected after the calendar action.
Users can explicitly return to those scopes.

## D-2026-07-29-09: Readiness Requires Exact Revision Completion

WIKI digest current is necessary but insufficient for Knowledge build
readiness. Only the exact current note revision with completed durable KG/RAG
work may report ready. Running, failed, missing, or stale work fails closed.
