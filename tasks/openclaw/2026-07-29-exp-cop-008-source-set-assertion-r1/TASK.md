# TASK

## Evidence

The previous current-source run passed:

- two-source grounded Ask and Todo creation;
- exact source click;
- full-page local reader;
- Todo title/body/due/log/notes editing;
- full Electron exit;
- relaunch with the same userData.

Final assertion failed because expected sources were comma-separated in A,B
order while canonical UI readback was newline-separated B,A. Both exact paths
were present.

## Allowed files

- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- this task's evidence files

## Required repair

- Parse the source textarea using supported separators.
- Compare a deduplicated unordered set against the two exact expected paths.
- Preserve exact-count and no-extra-source assertions.
- Do not change product/helper code or relax exact path equality.
- Before running, statically inspect every assertion after the changed line for
  retired selectors or delimiter/order assumptions.

## Required verification

Run the exact app-local Electron 38.8.6 / ABI-139 spec once against frozen
current production/helper bytes. Record exit code, duration, source/runtime
identity, final Todo IDs, screenshots/trace, and full quit/relaunch.

## Forbidden

- no production/helper/unit/status/Git/network/credential changes;
- no skipped journey steps;
- no count/path weakening.
