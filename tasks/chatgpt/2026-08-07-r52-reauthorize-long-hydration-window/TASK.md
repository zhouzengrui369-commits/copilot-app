# TASK — R52 reauthorize long hydration window

Scope is governance/handoff only.

## Inputs

- PR #20 source: `2835e36ee37a417bd88e5a8dc1187421eb61e966`
- Source gate: run `31162006562`, job `92814322597`, `17/17 PASS`
- R51 prior invocation: same source and fixed run stamp `20260807T083607Z`
- Prior invocation terminal state: outer dispatcher/shell timeout at 120 seconds during hydration; no PASS receipt, Candidate, artifact, or runtime ID
- Second R51 dispatch: `BLOCKED_NEW_PATH_ALREADY_EXISTS` before authority/hydration because prior R51 paths already existed

## Required changes

1. Keep product code, R50 registry metadata closure, package files, lockfile, tests, network allowlist and Candidate gates unchanged.
2. Create a new tracked source identity only to reauthorize a successor after R51 was consumed.
3. Update exact-object MiniMax handoff to mark all R51 assets `FORBIDDEN_REFERENCE_ONLY`.
4. Require the next source SHA and run stamp to be new.
5. Require outer caller/dispatcher wall-clock allowance `>=3600s` while keeping hydrator `automaticRetry=false` and one invocation only.
6. Run complete Node 24/macOS source gate and freeze the resulting exact PR #20 head before local execution.

No merge to `main`; no local Candidate execution by ChatGPT.