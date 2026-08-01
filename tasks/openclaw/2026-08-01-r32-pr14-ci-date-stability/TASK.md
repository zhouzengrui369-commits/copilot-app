# R32 PR #14 CI Date Stability

## Executor

MiniMax Code CLI implementation agent. Codex remains PM and acceptance owner.

## Goal

Repair the current GitHub source-gate failures caused by hard-coded July 2026 dates becoming inaccessible after the real month changed. Preserve current product date-picker behavior.

## Workspace and frozen base

- Workspace: `/private/tmp/copilot-r32-ci-date-stability`
- Branch: `codex/r32-ci-date-stability`
- Base HEAD: `c3bb0ecf64ab841707b954dfa05728fd44652a79`
- GitHub PR under repair: `#14`

Verify HEAD and a clean worktree before edits. Stop and record BLOCKED on drift.

## Allowed source/test files

- `apps/copilot-desktop/tests/coverage-renderer-critical.test.tsx`
- `apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx`

Task-owned evidence files under this task directory may also be updated.

## Required implementation

- Replace date-sensitive assumptions with a deterministic clock or dates derived from the rendered current month.
- Preserve the original assertions: date selection, confirmation, display, and existing UX contract.
- Prefer the smallest test-only patch; do not change production code unless the evidence proves a production defect, in which case stop and report it instead.

## Forbidden

- No product redesign, dependency changes, lockfile changes, package upgrades, Electron candidate, packaging, signing, credentials, Windows, cloud, remote/backup, broad security audit, commit, push, PR mutation, or unrelated edits.
- Do not weaken or delete assertions merely to make CI green.
- Do not use worker prose as evidence.

## Required checks

1. Show exact pre/post SHA256 for both allowed test files.
2. Run the two focused test files.
3. Run desktop tests TypeScript check.
4. If dependencies are present and the focused checks pass, run the same desktop release test command used by `copilot-source-gate`; otherwise record the exact dependency blocker without changing dependencies.
5. Record commands, exit codes, focused diff, and changed files.

## Deliverables

Update:

- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `changed-files.txt`
- `DISPATCH_STATUS.md`

## Acceptance

PASS only if the exact two focused failures are fixed with stable tests, assertions remain meaningful, no production behavior changed, all executed checks exit 0, and the touched-file allowlist is exact.

## Successor addendum — incomplete first worker

The first implementation worker completed only the `coverage-renderer-critical.test.tsx` repair and then exited before repairing `r44-h4e-today-product-polish.test.tsx` or writing evidence. A successor must:

1. preserve and verify the existing first-file diff;
2. change only `r44-h4e-today-product-polish.test.tsx`, using a deterministic frozen clock/date that keeps the keyboard targets visible;
3. run both focused files and desktop test TSC using the existing local dependencies if feasible;
4. remove exactly these task-created temporary symlinks before final status:
   - `/private/tmp/copilot-r32-ci-date-stability/node_modules`
   - `/private/tmp/copilot-r32-ci-date-stability/apps/copilot-desktop/node_modules`
   - `/private/tmp/copilot-r32-ci-date-stability/apps/copilot-desktop/dist`
5. write all required task deliverables and stop.

No other deletion is authorized.
