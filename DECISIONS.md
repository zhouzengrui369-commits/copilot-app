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

## D-2026-07-29-10: Persist Only The Latest Completed Grounded Ask Exchange

Persist one versioned latest-completed grounded exchange in the local Electron
main process. Do not persist streaming, cancelled, failed, zero-source or
renderer draft state. Use atomic owner-only storage and revalidate local
sources and the optional canonical Todo receipt on load. This gives users
source-return and restart continuity without creating a second knowledge truth
or cloud/session-storage dependency.

## D-2026-07-29-11: Development Evidence Is Not Candidate Identity

Current-source focused tests, Electron runs, screenshots and task-local evidence
may establish development acceptance, but they do not establish a candidate.
Candidate identity begins only from clean committed P0+P1 bytes and binds an
immutable source snapshot, exact artifact SHA256, runtime ID, deterministic
test-data manifest and candidate-bound evidence. Independent Focused Retest is
still required before Human Owner Gate eligibility.

## D-2026-07-30-01: Electron Receipts Are Exclusively Owned Per Producer

Focused and full Electron runs must write one exclusive runtime/process receipt
pair per validated producer. Aggregation fails closed on duplicate or
mismatched producers, inconsistent runtime identity, count/index disagreement,
or unclean process exit. This prevents concurrent workers from overwriting or
blending evidence.

## D-2026-07-30-02: Manual Launch Owns Runtime Before Readiness

The shared manual-launch helper records runtime immediately after Electron
process creation, before page readiness. Any later failure closes and records
the process, flushes evidence, and preserves the original error. Provider close
is independent of recorder flush. This removes the R5 orphan-process and
cleanup ambiguity without changing product behavior.

## D-2026-07-30-03: Focused Receipt Profile Does Not Weaken The Full Gate

`exp-cop-008-009-focused` contains exactly the two named tests and producers
needed for the P0/P1 development slice. It is not a substitute for the
candidate-bound full gate, which remains at least 50 real Electron tests with
the required manual and fixture-worker producers.

## D-2026-07-30-04: Governance Must Bind Receipt Repair Before Candidate

Bind the independently accepted nine-file repair commit
`ee8e207b44fc5091564f292ac130d8f0bd9a492b` in mandatory handoff governance,
then reuse the existing candidate worktree to create a clean candidate from
the resulting governance HEAD. Do not create a new worktree or reuse old
artifact/runtime identity.

## D-2026-07-30-05: Mock Keychain Is Test-Harness Isolation, Not Runtime Proof

For macOS Electron E2E only, add exactly one `--use-mock-keychain` switch when
and only when Darwin, `NODE_ENV=test`, and `COPILOT_E2E=1` are all true. This
keeps synthetic packaged-E2E credentials out of the real user Keychain without
changing production `safeStorage` behavior.

The resulting evidence is labeled `PACKAGED_E2E_MOCK_KEYCHAIN`. It must never
be presented as proof of ordinary packaged runtime Keychain behavior, which
remains `REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`. Independent implementation
rereview PASS did not replace GREEN. The initial controller wrapper recorded
`RESOURCE_DEFER_NO_TEST` before command start and consumed no attempt; its
successor ran the exact focused unit command once and returned
`GREEN_15_OF_15_PASS` (`1 file / 15 tests`, exit `0`, no retry). This does not
replace packaged Electron, real macOS Keychain runtime, candidate, independent
Focused Retest, owner-gate, or release evidence.

The exact two-file test-only repair is committed at
`54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`. Governance remains a separate
postimage that requires independent review and its own bounded commit before a
new candidate attempt.

## D-2026-07-30-06: Restart Persistence Is Per Test Producer

R20 proved that one worker-scoped userData directory cannot be shared by the
EXP-COP-008 and EXP-COP-009 manual restart journeys: the first producer's
persisted note and Todo contaminated the second producer's exact-source
assertion.

Keep the wrapper-owned worker root, validate each producer with the existing
slug contract, and derive exactly
`<workerRoot>/producers/<producer>`. Each spec creates its producer directory
once and reuses it for both launches within that spec. Different producers must
never share the child directory, and tests must not delete another producer's
data or weaken exact source assertions to hide contamination.

This choice preserves the intended same-userData quit/relaunch proof while
isolating test ownership. It is a test-harness decision only and does not alter
product persistence. The accepted repair commit is
`92510816932d0683e95a148789227c6cda0d55a3`; it does not establish a candidate,
runtime ID, artifact SHA256, independent retest, owner-gate eligibility,
release, or MVP completion.
