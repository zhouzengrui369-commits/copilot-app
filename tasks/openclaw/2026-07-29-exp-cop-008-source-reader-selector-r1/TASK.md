# TASK

## Evidence

The post-helper Electron run reached the exact Knowledge source successfully.
The current screenshot shows:

- breadcrumb `知识 / 本地 MOC / e2e/exp-cop-008-source-a`;
- summary title `EXP-COP-008 canonical source 1`;
- exact path `e2e/exp-cop-008-source-a`;
- `WIKI CURRENT`;
- `全页阅读`.

The test then failed only because it waited for retired
`data-testid="note-detail-meta"`.

## Allowed files

- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- this task's evidence files

## Required repair

- Remove only the retired selector.
- Assert the exact current-source breadcrumb/title/path.
- Click `全页阅读`.
- Assert the full reader contains exact source body text/path.
- Return to the same journey and continue all existing assertions:
  unscheduled persistence, explicit-date discovery, durable logs/notes,
  source links, full quit/relaunch readback.
- Do not weaken any A+B source assertion or skip the source reader.

## Required verification

After the readiness lane is complete, run the exact app-local Electron
38.8.6 / ABI-139 spec once. Record source/runtime identity, exit code,
duration, screenshot/trace path, and final persisted Todo IDs.

## Forbidden

- no production/helper/unit-test changes;
- no fixture success shortcut;
- no Git/network/credentials;
- no run while readiness production bytes are still changing.
