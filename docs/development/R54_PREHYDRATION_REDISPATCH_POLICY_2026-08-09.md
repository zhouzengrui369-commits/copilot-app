# R54 — Pre-Hydration Redispatch Policy and Durable Hydrator Invocation

## Status

`SOURCE_GOVERNANCE_ONLY / NOT_RUNTIME_PROOF / MVP_NOT_COMPLETE / NOT_RELEASE_READY / NOT_EXPERIENCE_READY`

## Trigger

R53 on exact source `0e097811650e2ca79a79a1ab095fdbad1f933ce3` never invoked the hydrator. It created task/worktree/evidence paths, then the local dispatcher/tool envelope failed. A second dispatch using the same run stamp correctly stopped on path freshness. Reported execution counts were `HYDRATION_EXECUTIONS=0` and `CANDIDATE_EXECUTIONS=0`; native cache, PASS receipt and Candidate worktree were absent.

## Problem

The prior exact-object handoff treated every attempted dispatch as consuming the source SHA. That is stricter than the actual fail-closed boundary and caused governance-only source churn for failures that occurred before any hydration or Candidate state existed.

## Decision

R54 introduces a two-tier identity rule:

1. **Tier A — pre-hydration dispatch failure**: same exact source may be explicitly reauthorized by Parent PM only when hydration/candidate execution counts are both zero, source is unchanged, native cache/receipt/Candidate worktree are absent, PR head is unchanged and the source gate remains PASS. Re-dispatch requires a new run stamp and six entirely new local paths; predecessor paths remain immutable evidence.
2. **Tier B — consumed hydration/Candidate**: a new source SHA is mandatory once hydration starts, a native-cache output exists, a PASS/partial receipt exists, Candidate execution starts, or source changes.
3. A clean predecessor hydration worktree is never reused. Tier A still creates a new detached hydration worktree.
4. The hydrator remains one invocation only. No retry, resume, cache reuse, mirror switching, allowlist expansion or Candidate network authority is added.
5. Long-running hydration must use a persistent single background process. Preferred MiniMax mode is `run_in_background=true`; shell-only fallback is one `nohup` process with recorded PID and polling. Outer wall-clock allowance remains at least 3600 seconds.
6. If the background process disappears without a terminal hydrator receipt/error, stop and preserve evidence; do not launch a replacement.

## Unchanged source/runtime boundaries

- R50 registry metadata closure implementation unchanged.
- Product/UI/database/KG/RAG/ASR behavior unchanged.
- `package.json` and `package-lock.json` unchanged.
- Candidate Gate 1–12 remains deny-network.
- `automaticRetry=false`.
- Signing/notarization/cloud/global credentials unchanged.

## Acceptance

The final R54 stacked head must pass the complete Node 24/macOS `copilot-source-gate`. R54 may merge only into Draft PR #20. The resulting exact PR #20 head must then pass the complete source gate before a new MiniMax local run is authorized.
