# PLAN

1. Reproduce the independently identified Schedule/Today regressions.
2. Restore durable notes/execution-log semantics while retaining canonical
   Todo editing and readback.
3. Add the missing Ask/Todo negative, multi-source, blank-due, explicit-due,
   source-open, and restart assertions.
4. Run focused tests, TSC, build, and real Electron.
5. Run the global desktop suite once and classify every remaining failure.
6. Update task and durable handoff evidence.

Risk: old page-memory tests must be migrated to durable local truth without
weakening the user-visible capability or converting failures into fixture PASS.
