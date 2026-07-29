# TASK

## Scope

Read-only project/test execution. No production, test, package, config, or
governance edits. Only this task's evidence files may be updated.

## Execution identity

The clean worktree uses an untracked root `node_modules` dependency bridge to
the original checkout. Before the global run, create an ignored app-local
Electron package wrapper under
`apps/copilot-desktop/node_modules/electron` using only:

- local package metadata/path from the already installed Electron 38.8.6;
- an execution-only link to its existing `dist`.

The wrapper must make `resolveSourceElectronExecutable()` resolve an app-local
package identity while leaving repository files unchanged. Record paths,
version, ABI, file types, and hashes. It is execution evidence only.

After all commands and classification, remove both worktree execution bridges:

- root `node_modules`;
- app-local Electron wrapper.

Confirm neither appears in final `git status`.

## Commands

1. Run exactly one global desktop Vitest command with JSON reporter/output:

```text
npm run test:copilot-desktop -- --reporter=json --outputFile=/private/tmp/copilot-p0-current-global.json
```

2. Run the desktop workspace TypeScript check once.
3. Run `git diff --check`.

Do not rerun the global suite. Do not run full Electron E2E in this lane.

## Classification

Persist every failed file/test with first exact error and classify:

- `CURRENT_P0_REGRESSION`
- `EXECUTION_BRIDGE`
- `BASELINE_CONTRACT_OR_EVIDENCE`
- `UNCLASSIFIED`

For `BASELINE_CONTRACT_OR_EVIDENCE`, cite the current missing historical file,
fixed preimage/hash contract, or unrelated production area. Never call a
failure pre-existing merely because the worker says so.

If any current P0 regression or unclassified failure remains, result is
`BLOCKED`. If only independently evidenced baseline/evidence failures remain,
return `PARTIAL_PASS / GLOBAL_PRODUCT_REGRESSION_GREEN /
RELEASE_BASELINE_STILL_RED`.

## Deliverables

- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `changed-files.txt`
- `DISPATCH_STATUS.md`
- `ACCEPTANCE_LOG.md`
- one bounded classification JSON/Markdown file inside this task directory

No Git/network/credentials.
