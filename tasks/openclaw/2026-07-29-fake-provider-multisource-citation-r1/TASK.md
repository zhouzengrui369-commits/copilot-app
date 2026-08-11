# TASK

## Allowed files

- `apps/copilot-desktop/tests/e2e/helpers/fake-minimax-provider.ts`
- one new focused unit test under `apps/copilot-desktop/tests/`
- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts` only if an
  assertion needs exact receipt wiring; do not weaken it
- this task's evidence files
- project status files only for result recording

## Required behavior

- Parse all numbered local note paths from the exact grounded user prompt.
- Preserve prompt order and deduplicate exact paths.
- Emit a deterministic grounded answer that explicitly cites every parsed
  valid path using the production citation syntax.
- If no valid path exists, preserve existing fail-closed/no-source behavior.
- Do not fabricate paths absent from the prompt.

## RED → GREEN

- RED: a two-source prompt produces only the first citation.
- GREEN:
  - two-source prompt produces both citations in order;
  - duplicates are emitted once;
  - no-source prompt remains fail-closed;
  - EXP-COP-008 real Electron returns aligned A+B sources/sourceDetails and
    continues the full Todo/restart journey.

## Forbidden

- no production changes;
- no Top-K/ranking/readiness changes;
- no assertion weakening or fixture-only success label;
- no Git/network/credentials.

## Required commands

Run the focused helper test, R2 focused 69-test set, renderer TSC/build, then
the exact app-local Electron 38.8.6 / ABI-139 EXP-COP-008 spec once. Record the
first result exactly.

## Deliverables

`RESULT.md`, `EVIDENCE.md`, `commands.log`, `changed-files.txt`,
`DISPATCH_STATUS.md`, and `ACCEPTANCE_LOG.md`.
