# EVIDENCE

## RED → GREEN

### Executor preflight

The first sandboxed Vitest attempt exited `1` before collection because Vite
could not write its temporary config file in the isolated worktree:
`EPERM ... vitest.config.ts.timestamp-*.mjs`. This is executor evidence, not
the behavioral RED.

### Behavioral RED

- command: focused helper test
- exit: `1`
- result: `1 failed / 1 passed`
- expected:
  `...(来源: e2e/source-a) (来源: e2e/source-b)`
- received:
  `...(来源: e2e/source-a)`

### GREEN

- focused helper: exit `0`, `2/2` passed
- exact behaviors:
  - A+B emitted in prompt order;
  - repeated A emitted once;
  - prompt without a numbered path remains HTTP `422`.
- R2 regression set: exit `0`, `8/8 files`, `69/69 tests`
- renderer TSC: exit `0`
- desktop build: exit `0`
- build receipt: `RENDERER_BUNDLE_VERIFIED: files=7`

## Real Electron

- executor:
  - Electron `38.8.6`
  - ABI `139`
  - isolated `userData`
  - task-owned binding:
    `tasks/openclaw/2026-07-29-exp-cop-008-todo-canonical-closure-r1/run/native/better_sqlite3.node`
- first and only post-fix run: exit `1`
- failed assertion:
  `getByTestId('note-detail-meta')` not found after clicking source A
- visible product state:
  - Knowledge workspace opened;
  - breadcrumb ended in `e2e/exp-cop-008-source-a`;
  - document title was `EXP-COP-008 canonical source 1`;
  - exact path was visible;
  - status was `WIKI CURRENT`.

Artifacts:

- screenshot:
  `apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/test-failed-1.png`
  - SHA256:
    `99f11679d656eee5a14bdc1e3a3a5b2aa7240b90b9a222a538c79e9343d34b4a`
- trace:
  `apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/trace.zip`
  - SHA256:
    `f5de9a6005ff83ccb7b890834ad4a2791daef3fa555e200a2a944d441eff27e3`
- error context:
  `apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/error-context.md`
  - SHA256:
    `bfa56b764967fa21c798fb8650a50e59848617cd6b84cce6a5c28a235c836a67`

## Current file identities

- helper SHA256:
  `beb5d7778a615a3d05d5741f1821ed1becd9e9917ce394c4b6e83250306a67a2`
- focused test SHA256:
  `f044ad5296950a7718dc08f1c388105d42cfee0b6ba8733b6a5ef5d14ca93e93`

No production file, project status file, Git state, credential, network
provider, or E2E assertion was changed by this lane.
