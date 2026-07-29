# EVIDENCE

## Exact source identity

- Branch: `codex/p0-owner-gate`
- HEAD before this lane's uncommitted change:
  `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- `ScheduleWorkspace.tsx`:
  `455ce3ace872a39e14b680f41b0e460e9c2e66218e384aef9d3b4402627f126b`
- `r44-h1-schedule-owner-feedback.test.tsx`:
  `40af6fe666456023d994d0c72413ea44eb4023168a58be0b84bad7e63449dfe1`
- Current EXP-COP-008 Electron spec:
  `417e9c254130f9debeaf8a502eb784e9fd9493af42c70bfe7378cd6da3f45a0a`

## RED evidence

Command:

`npm run test --workspace @copilot/desktop -- tests/r44-h1-schedule-owner-feedback.test.tsx`

Exit: `1`

Observed: 4 tests, 1 failed and 3 passed. After entering `Unscheduled`, clicking
the exact calendar date left the selected-day scope button with
`aria-pressed=false`.

## GREEN evidence

1. Same focused command: exit `0`, 4 / 4 passed.
2. `npm run test --workspace @copilot/desktop -- tests/r44-h1-schedule-owner-feedback.test.tsx tests/exp-cop-008-todo-closure-r1.test.tsx`
   - exit `0`
   - 2 files, 8 / 8 tests passed.
3. `npx tsc -p apps/copilot-desktop/tsconfig.renderer.json --noEmit`
   - exit `0`.
4. `npm run build --workspace @copilot/desktop`
   - exit `0`
   - `RENDERER_BUNDLE_VERIFIED: files=7`.

## Frozen current-source Electron evidence

The exact Playwright Electron command in `commands.log` was run once after the
build.

- Exit: `0`
- Result: 1 / 1 passed in 13.3 seconds.
- Electron: `38.8.6`
- Native ABI: `139`
- Pinned native binding SHA256:
  `77907e9952f0d2a4d2d6a751f8828cab96ab132dd52d6610cb0e9a7192f28696`
- Built main SHA256:
  `ae2f7dd761d3e864944cd281c6ac2c05d173ff3da02162053b40aff4cc960bff`
- Built preload SHA256:
  `73648ba0b941fb369c8a67b40af59963f69560bb2e5474d6de84d5934d7c21df`
- Built renderer entry SHA256:
  `50add65f4f92430c7e4cb6929bbb7ed1c5d458459a33de4378e329226c55fdc4`

The passing run retained no screenshot or trace under the configured
retain-on-failure policy. None is claimed.

## Scope control

Only the exact production handler, its focused regression test, and this lane's
task records were changed by this lane. No Git action was performed.
