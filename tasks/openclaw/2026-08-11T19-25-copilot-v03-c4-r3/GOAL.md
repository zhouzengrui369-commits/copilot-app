# GOAL — Copilot Shared Knowledge Engine C4 R3

Goal ID: `COPILOT-SKE-V03-C4-R3`
State: `SOURCE_SUCCESSOR_ACTIVE`
Parent: `COPILOT-SKE-V03-C3-R1`
Base implementation SHA: `3ea8301357212604468a8573fec21680873c1f58`
C3 accepted Head: `7236d102013d2b909f4c0bd62f14516cf0e99939`

## Why R3 exists

- C4 R1 functionality passed build/check and the complete KB suite, but strict per-file coverage failed only because `capability.ts` branch coverage was `89.83%` against a hard `90%` threshold.
- The repository already contained a C4 R2 governance successor with stronger capability/session structural validation, but it was incomplete as a full C4 implementation.
- R3 preserves the fully tested R1 implementation, adopts the R2 structural-hardening source, and adds focused structural fail-closed tests. R1 and R2 are predecessor/reference branches only; R3 is the sole C4 successor candidate.

## Goal

Prove the complete C4 transport-neutral Agent capability/API contract under the unchanged v0.3 source gate with every Shared Engine file meeting strict per-file >=90% statements/lines/branches/functions.

## Hard boundaries

- C3 PR #46 remains source-accepted but not merged; C4 cannot merge ahead of C3.
- PR #20 and `main` are untouched.
- D0/D1 test data only; D3 disabled.
- Agent authority is policy-filtered read + `WRITE_PROPOSAL` only.
- no canonical commit, terminal review/conflict resolution, delete/sync/admin, physical DB contract, dependency/lock change, Electron Runtime change, signing/notarization/release.
