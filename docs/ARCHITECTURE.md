# ARCHITECTURE

## Authority Model

Copilot Desktop is the local-first product authority for notes, KB, KG, Todo, schedule, RAG source references, and user-visible review flows. Cloud or remote paths are optional support surfaces and cannot replace local truth.

## Stage 0 Baseline

- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`.
- Active branch: `codex/p0-owner-gate`.
- Current accepted P0 product/test commit:
  `0c69b8643ca4dcf20a86623f2528195a34f402a4`.
- r3 snapshot: Desktop product-layer input only, verified as `414 files / 7 tracked deletions / 51,347,389 bytes`.
- r3 aggregate: `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`.

Review artifacts remain independent fact references. They are not product code and must not be copied into product source as fixes.

## Current Product Gates

P0 is `EXP-COP-008`. P1 first is `EXP-COP-009`. Old source/runtime IDs are not reproducible and must not be reused for candidate, release, or owner-gate evidence.

The next engineering pass must close `EXP-COP-008` Todo false-success/discoverability/readback and `EXP-COP-009` Ask source-return continuity. It must then produce fresh runtime, artifact, screenshot, and independent Focused Retest evidence before Human Owner Gate can become eligible.

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

## Explicit Non-Goals

Stage 0 does not include Windows expansion, Remote/Backup expansion, major dependency upgrades, visual redesign, tests, build, Electron runtime, package generation, or release readiness claims.
