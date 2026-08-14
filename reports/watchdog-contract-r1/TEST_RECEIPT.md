# Native-cache watchdog deterministic contract receipt

Date: 2026-08-14

## Trigger

Local deployment R3 evidence root:

`/Users/njx/copilot-evidence/b8b04819ac25629b0f2a5135858532902567b794-20260814T003315Z`

R3 ran the source contract once and stopped before hydration with `109/110`; the watchdog test expected `SIGTERM,SIGKILL` and observed only `SIGTERM`.

## Classification

`ASYNC_TIMING_TEST_DEFECT`

The production timeout callback schedules the hard-kill grace timer when it executes. The prior test used a fixed 80ms wait for a 40ms timeout plus 20ms grace. Under event-loop delay, the timeout callback could execute near the assertion and the grace callback was still pending.

## Bounded change

- File changed: `scripts/candidate-r30/native-cache-command-watchdog.test.mjs`
- Production watchdog code changed: `NO`
- Timeout/grace/signal/process-group/audit/retry policy changed: `NO`
- Added deterministic injected manual timers: `YES`
- Added close-during-grace cancellation regression: `YES`

## Verification

```text
node --test scripts/candidate-r30/native-cache-command-watchdog.test.mjs
3/3 PASS

100 consecutive focused executions
300/300 PASS

node --test scripts/candidate-r30/*.test.mjs
111/111 PASS
```

The full command was run outside the nested Codex sandbox because the in-sandbox `/usr/bin/sandbox-exec` grammar smoke is denied by the outer sandbox with exit 71. The non-nested macOS run passed that real sandbox grammar check and all other contracts.

## Gate statement

This receipt proves source-contract determinism only. It is not hydration, Candidate, packaged Electron, E2E, performance, signing, notarization, release, or Human Owner evidence. A new local successor requires the new exact PR #54 head and a complete GitHub source gate PASS.
