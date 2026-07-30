# ARCHITECTURE

## Authority Model

Copilot Desktop is the local-first product authority for notes, KB, KG, Todo, schedule, RAG source references, and user-visible review flows. Cloud or remote paths are optional support surfaces and cannot replace local truth.

## Stage 0 Baseline

- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`.
- Active branch: `codex/p0-owner-gate`.
- Current accepted P0+P1 product/test commit:
  `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`.
- r3 snapshot: Desktop product-layer input only, verified as `414 files / 7 tracked deletions / 51,347,389 bytes`.
- r3 aggregate: `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`.

Review artifacts remain independent fact references. They are not product code and must not be copied into product source as fixes.

## Current Product Gates

P0 is `EXP-COP-008`. P1 first is `EXP-COP-009`. Old source/runtime IDs are not reproducible and must not be reused for candidate, release, or owner-gate evidence.

EXP-COP-008 and EXP-COP-009 have development-acceptance implementations.
Neither is independently closed until both are materialized into one clean,
reproducible candidate and pass the independent Focused Retest. Candidate,
release and owner-gate identities remain unset until that boundary.

Current-source focused Electron evidence is development evidence only; a clean
commit, packaged artifact SHA256, runtime ID and test-data manifest are required
for candidate identity.

## Canonical Grounded-Answer Todo Flow

The focused EXP-COP-008 implementation uses one local canonical chain:

1. Ask exposes “转为待办” only after a terminal answer whose complete source
   receipt set is `LOCAL_PRESENT`.
2. The question, final answer, and source paths are frozen before confirmation.
3. Main create/update performs an immediate canonical storage readback and
   rejects absent, wrong-ID, or mismatched title/body/due/status/source truth.
4. Renderer performs exactly one list/readback by returned ID before showing
   success.
5. A null due date is a supported Unscheduled Todo, discoverable in both
   `未安排` and `全部`.
6. “查看待办” routes the exact ID, focuses and expands it; title, body, due,
   and source paths are persisted edits with another canonical readback.
7. Same-userData Electron quit/relaunch is the persistence boundary. Renderer
   remount or browser fixture evidence cannot replace it.

Todo notes and execution logs reuse the canonical persisted Todo body through a
deterministic, backward-compatible structured encoding. They are not stored in
renderer page memory. Editing, append-log, readback, and restart recovery use
the same main-process canonical comparison as title, due date, and sources.

Calendar date selection is a navigation action: it sets the selected date and
switches the list to the selected-day scope. `全部` and `未安排` remain explicit
alternate scopes.

## Grounded Ask Continuity

The latest completed grounded Ask exchange is a versioned local main-process
projection under Electron `userData`; it is not renderer page memory,
localStorage, sessionStorage or cloud truth.

The persisted projection contains one immutable completed exchange: exchange
ID, submitted question, terminal answer, aligned source/sourceDetails, optional
canonical Todo receipt and completion time. Main IPC serializes save, load and
clear operations. Writes are atomic and owner-only (`0600`); load uses
`O_NOFOLLOW`, validates the opened handle as bounded, regular, owner-controlled
and single-link, then reads from that same handle.

Before exposing source or Todo actions after restore, the main process
revalidates every local source against current note bytes and re-reads the Todo
canonically. Missing, changed, stale, corrupt, unsafe, nonterminal or mismatched
state loses current/success actions. Ask-to-Knowledge navigation carries the
exact exchange ID, note path and full-reader intent; return restores only the
still-matching exchange.

## Knowledge Build Readiness

`knowledgeBuild.ready` is revision-bound and fail-closed:

- missing or stale pending row: `not-ready`;
- exact pending row: `queued`;
- exact processing row: `running`;
- exact failed row: `failed`;
- exact done row plus current WIKI digest: `ready`.

WIKI digest current alone is not KG/RAG readiness. Retrieval ranking and
production citation filtering remain unchanged; answer sources contain only
paths actually cited by the model and validated against retrieval hits.

## Electron Candidate Receipt Architecture

Electron evidence has two explicit profiles:

- `exp-cop-008-009-focused` is fixed to exactly two tests and the exact
  producers `exp-cop-008` and `exp-cop-009`.
- the full candidate gate is unchanged: it must list and run at least 50 real
  Electron tests and include the required manual and fixture-worker producers.

Each producer owns an exclusive runtime/process receipt pair in its absolute
receipt directory. Producer slugs are validated before file creation and
receipt files use exclusive owner-only creation. Aggregation rejects duplicate
or mismatched producers, count/index disagreement, inconsistent runtime
identity, and unclean process exit. Compatibility top-level process fields are
retained for existing evidence consumers.

Manual Electron launch uses one shared launch/receipt owner. It records runtime
identity immediately after process creation, before page readiness. If
readiness fails, the shared owner closes the launched application, records the
process postimage, and rethrows the original error; the caller's `finally`
boundary flushes receipts. Successful callers receive the application, page,
and already-recorded runtime without adding a duplicate runtime row. Provider
cleanup remains in an outer `finally` boundary even when receipt flushing
fails.

The initial independent review (R5) rejected the launch ownership and cleanup
gaps. R6 closed them with focused TSC/tests and failure injection; R7
independent read-only re-review returned
`PASS / P1_CLOSED / MVP_NOT_COMPLETE`. The exact nine-file repair is committed
at `ee8e207b44fc5091564f292ac130d8f0bd9a492b`.

This architecture validates source-side evidence ownership only. It does not
create a candidate identity. Candidate commit, artifact SHA256, runtime ID,
package proof, full Electron evidence, and independent product-experience
retest remain unset.

## Packaged E2E Credential-Protection Boundary

R18 proved offline packaging through the supported
`--config.electronDist` path, then failed in focused packaged Electron before
the synthetic settings credential save completed. It did not establish a
candidate.

R19 changes only the Electron E2E launch harness and its unit contract.
Production preload, main IPC, settings persistence, credential binding, and
Electron `safeStorage` code are unchanged. On macOS, the harness adds exactly
one mock-keychain switch only when all three conditions hold:

1. platform is Darwin;
2. `NODE_ENV=test`;
3. `COPILOT_E2E=1`.

This boundary is `PACKAGED_E2E_MOCK_KEYCHAIN`. It isolates synthetic E2E
credentials from real user Keychain state. It does not prove normal packaged
runtime Keychain behavior; that truth remains
`REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`.

The exact rereviewed test-only postimages are fixture
`b9e0d32b23bcf82e0c03f05855cb741b3b3931a5e196cb0aac9e36f992044df5`
and unit test
`ed3b85357c8b347669c4888613dac55f6ca16d6bac4bb4f9d065d0504f1bdbf9`.
Independent implementation rereview returned
`PASS / P0=0 / P1=0 / P2=0`. The initial controller wrapper preserved
`RESOURCE_DEFER_NO_TEST` before command start and consumed no attempt. Its
successor ran the exact focused unit command once and returned
`GREEN_15_OF_15_PASS` (`1 file / 15 tests`, exit `0`, no retry). This unit
GREEN did not run Electron and does not change
`REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`.
The exact two-file test-only repair is committed at
`54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`; this is still not a candidate
identity.

## Explicit Non-Goals

This stage does not include Windows expansion, Remote/Backup expansion, major
dependency upgrades, visual redesign, signing, notarization, or release
readiness claims. Focused development evidence does not replace the
candidate-bound project-wide Electron, release, or independent experience
gates.
