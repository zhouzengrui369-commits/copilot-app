# ACCEPTANCE LOG

`PASS — FOCUSED DEVELOPMENT ACCEPTANCE ONLY`

Acceptance criteria:

- [x] A test reproduces `Unscheduled` -> calendar date failing to switch scope.
- [x] The calendar handler synchronously sets the selected date and day scope.
- [x] The selected-day Todo appears; the unscheduled Todo does not leak into
      that scoped list.
- [x] Focused Schedule and EXP-COP-008 unit tests pass.
- [x] Renderer TypeScript passes.
- [x] Desktop build passes.
- [x] The exact current-source Electron journey passes after a full
      close/relaunch and proves calendar-date scope switching.
- [x] No retry was used for the Electron run.
- [x] No screenshot or trace is falsely claimed.
- [x] No project status, credential, package, Git, or unrelated production file
      was changed.

Remaining gates:

- clean committed candidate identity;
- independent Focused Retest with P0=0;
- Human Owner Gate;
- packaging/signing/release evidence.

`MVP_NOT_COMPLETE`
