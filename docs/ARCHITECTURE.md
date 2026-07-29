# ARCHITECTURE

## Authority Model

Copilot Desktop is the local-first product authority for notes, KB, KG, Todo, schedule, RAG source references, and user-visible review flows. Cloud or remote paths are optional support surfaces and cannot replace local truth.

## Stage 0 Baseline

- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`.
- Active branch: `codex/p0-owner-gate`.
- r3 snapshot: Desktop product-layer input only, verified as `414 files / 7 tracked deletions / 51,347,389 bytes`.
- r3 aggregate: `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`.

Review artifacts remain independent fact references. They are not product code and must not be copied into product source as fixes.

## Current Product Gates

P0 is `EXP-COP-008`. P1 first is `EXP-COP-009`. Old source/runtime IDs are not reproducible and must not be reused for candidate, release, or owner-gate evidence.

The next engineering pass must close `EXP-COP-008` Todo false-success/discoverability/readback and `EXP-COP-009` Ask source-return continuity. It must then produce fresh runtime, artifact, screenshot, and independent Focused Retest evidence before Human Owner Gate can become eligible.

## Explicit Non-Goals

Stage 0 does not include Windows expansion, Remote/Backup expansion, major dependency upgrades, visual redesign, tests, build, Electron runtime, package generation, or release readiness claims.
