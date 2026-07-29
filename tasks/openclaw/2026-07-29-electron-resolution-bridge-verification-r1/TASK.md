# TASK

## Scope

Controller executor repair only. No product/test/config/governance edits.

## Execution bridge

Create ignored worktree dependencies:

1. root `node_modules` link to the existing local dependency tree;
2. app-local `apps/copilot-desktop/node_modules/electron` containing the
   existing Electron 38.8.6 package's non-generated package files:
   `LICENSE`, `README.md`, `checksums.json`, `cli.js`, `electron.d.ts`,
   `index.js`, `install.js`, `package.json`, `path.txt`;
3. link `dist` to the existing Electron 38.8.6 dist.

The package must resolve its real `main` entry. Do not copy or modify product
source.

## Focused verification

From `apps/copilot-desktop`, run once:

```text
/Users/njx/openclaw/copilot/node_modules/.bin/vitest run \
  tests/direct-performance-probe.test.ts \
  tests/preload-domain-coverage.test.ts \
  tests/preload.test.ts \
  tests/r22-startup-lazy-red.test.tsx \
  tests/r22-startup-review-fixes.test.tsx \
  tests/reversible-trash-preload-r1.test.ts \
  --reporter=json \
  --outputFile=/private/tmp/copilot-electron-resolution-focused-r1.json
```

Validate exact totals and failures. Do not rerun.

Afterwards remove both execution bridges and confirm no node_modules git
status entry.

## Deliverables

`RESULT.md`, `EVIDENCE.md`, `commands.log`, `changed-files.txt`,
`DISPATCH_STATUS.md`, `ACCEPTANCE_LOG.md`.

No Electron GUI, Git, network, credentials, or second run.
