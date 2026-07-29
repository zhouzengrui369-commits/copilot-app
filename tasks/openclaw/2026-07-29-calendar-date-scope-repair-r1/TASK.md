# TASK

## Confirmed runtime defect

In the current real Electron EXP-COP-008 journey:

- scope was `未安排`;
- the explicit due date was clicked in the calendar;
- selected date changed;
- scope remained `未安排` for at least 8 seconds;
- the explicit-date Todo was therefore not discoverable from the calendar
  action.

This conflicts with the accepted product contract that the calendar is the
direct way to inspect each day's notes/Todos.

## Allowed production

- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.module.css`
  only if required

## Allowed tests

- `apps/copilot-desktop/tests/r44-h1-schedule-owner-feedback.test.tsx`
- `apps/copilot-desktop/tests/exp-cop-008-todo-closure-r1.test.tsx`
- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- this task's evidence files

## Required behavior

- Clicking any calendar date sets `selectedDate` and switches scope to
  `所选日期` in one user action.
- `所选日期` is visibly/semantically selected.
- Exact explicit-due Todo appears for that day.
- `未安排` and `全部` remain available and unchanged when explicitly clicked.
- Preserve canonical persistence, source links, logs/notes, and blank-due
  discoverability.

## RED → GREEN

Add a focused test that begins in `未安排`, clicks a calendar date, and proves
the scope and exact-day list switch. Capture RED before production repair.

Run:

- exact focused Schedule/P0 tests;
- renderer TSC;
- desktop build;
- one current-source Electron 38.8.6 / ABI-139 EXP-COP-008 journey.

## Forbidden

- no E2E workaround that clicks scope separately;
- no other production/helper/status/Git/network/credential changes;
- no redesign.
