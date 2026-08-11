# EVIDENCE

## Source identity

- branch: `codex/p0-owner-gate`
- HEAD: `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- command workspace: `/Users/njx/openclaw/copilot.wt-S15C`

## Execution bridges

The task created the two ignored execution-only bridges required by the
contract:

1. `node_modules` -> `/Users/njx/openclaw/copilot/node_modules`
2. `apps/copilot-desktop/node_modules/electron`
   - package version: `38.8.6`
   - `package.json` SHA256:
     `348dbf8cba44a4925b2764f496cd6738b58c1b544ba7f3808db1a44aabd757b1`
   - `index.js` SHA256:
     `46a7d3a2da5d96cd693612e5c3ec407c38ac9c15c44f97ad2be478cbcf80b43c`
   - `path.txt` SHA256:
     `3e0e50495f130af5c4349169f9a109d7a1543b8eca72ec2b5c9b3e8028b7a596`
   - `dist` was a symlink to the already installed Electron 38.8.6 dist.
   - resolved executable:
     `/Users/njx/openclaw/copilot.wt-S15C/apps/copilot-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`

No dependency install or network action occurred.

## Exact direct global run

Command, run exactly once:

```text
/Users/njx/openclaw/copilot/node_modules/.bin/vitest run --config apps/copilot-desktop/vitest.config.ts --reporter=json --outputFile=/private/tmp/copilot-p0-current-global-r2.json
```

- exit: `1`
- first exact output:

```text
include: tests/**/*.test.{ts,tsx}
exclude: **/node_modules/**, **/dist/**, ...
No test files found, exiting with code 1
```

- JSON path:
  `/private/tmp/copilot-p0-current-global-r2.json`
- JSON exists: `false`
- JSON parses: `false` (file absent)
- suite totals: unavailable
- assertion totals: unavailable
- classification: `EXECUTION_BRIDGE`

The config's relative `tests/**` include resolved from the repository root
rather than `apps/copilot-desktop`. The contract forbade a second global run,
so the command was not corrected or repeated.

## Desktop workspace check

Command, run once:

```text
npm run check --workspace @copilot/desktop
```

- exit: `2`
- main and renderer checks reached the tests check.
- diagnostics:
  - `src/renderer/main.tsx:7`: `ImportMeta.env` missing.
  - `src/renderer/workspaces/KnowledgeWorkspace.tsx:286`:
    `ImportMeta.env` missing.
  - `src/renderer/workspaces/ScheduleWorkspace.tsx:586`:
    `ImportMeta.env` missing.
  - `tests/r44-h4c-knowledge-truth-reader.test.tsx:95`:
    `string[] | undefined` not assignable to `string[]`.
  - `tests/vitest.critical-coverage.config.ts:10` and
    `tests/vitest.desktop-coverage.config.ts:15`:
    duplicate root/nested Vite plugin types disagree.

Current/HEAD comparison shows the three `import.meta.env` expressions are
unchanged at their corresponding HEAD locations; the H4C and coverage config
files are also outside the current diff. The duplicate Vite provenance names
the temporary root dependency bridge. Exact classifications are in
`failure-classification.json`.

## Diff check

```text
git diff --check
```

- exit: `0`
- output: empty

## Cleanup proof

- `test ! -L node_modules`: exit `0`
- `test ! -e apps/copilot-desktop/node_modules/electron`: exit `0`
- final `git status --short --untracked-files=all` has no `node_modules`
  entry.

The pre-existing ignored app-local `.vite` cache directory was not created or
deleted by this task.
