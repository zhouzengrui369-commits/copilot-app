# RESULT

`BLOCKED / FOCUSED_DEVELOPMENT_ACCEPTANCE_PASS / GLOBAL_BASELINE_RED / MVP_NOT_COMPLETE`

## Completed

- Main-process create/update now returns only a canonical Todo read back from
  local persistence and fails closed on absent, wrong-ID, or mismatched
  readback.
- Ask freezes one completed grounded exchange, retains the final answer and all
  `LOCAL_PRESENT` source paths, supports optional due date, performs one
  renderer canonical readback, and exposes `查看待办` only after verification.
- Today now exposes `所选日期 / 全部 / 未安排`; `查看待办` opens, focuses, and
  expands the exact Todo ID.
- Todo title, body, due date, and local source links can be persisted and are
  read back before success.
- Focused real Electron E2E created an unscheduled sourced Todo, opened and
  edited it, fully closed Electron, relaunched with the same userData, and
  recovered the same persisted object.

## Focused evidence

- canonical persistence: `7/7` PASS
- renderer/product focused set: `33/33` PASS
- renderer TypeScript: PASS
- desktop build: PASS
- native binding probe: `1/1` PASS
- focused Electron quit/relaunch: `1/1` PASS, `3.520s` test /
  `3.996s` suite
- `git diff --check`: PASS

## Why the result is BLOCKED

`npm run test:copilot-desktop` failed: `19` files failed, `104` passed;
`42` tests failed, `1266` passed. The failures span pre-existing/global
release-contract, static-shell, backup/remote/trash, materialization, Knowledge,
dependency-resolution, and other lanes. Under the contract's stop-on-failure
order, the full Electron suite was not run.

No clean candidate commit, artifact SHA, runtime ID, or independent product
experience retest is bound by this task. Execution-only `node_modules` and
task-owned native-binding files are explicitly not candidate/package inputs.

## Next action

Controller acceptance must inspect the focused diff and evidence, exclude the
execution-only dependency bridge, establish a clean committed candidate, and
request the independent Focused Retest. Do not mark `EXP-COP-008` or the MVP
closed from this worker result alone.
