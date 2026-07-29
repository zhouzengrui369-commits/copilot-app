# TASK

## R1 executor failure

The R1 command ran plain `vitest run`, but npm consumed
`--reporter/--outputFile`; no JSON was created. R1 must remain recorded as
`EXECUTION_BRIDGE_FAIL`, not product PASS.

## Scope

No product/test/config/governance edits. Only this task's evidence and
classification files may change.

## Exact execution

Recreate the same two ignored execution-only dependency bridges described in
R1, then invoke Vitest directly, not through nested npm:

```text
/Users/njx/openclaw/copilot/node_modules/.bin/vitest run \
  --config apps/copilot-desktop/vitest.config.ts \
  --reporter=json \
  --outputFile=/private/tmp/copilot-p0-current-global-r2.json
```

Run exactly once. Validate that the JSON exists, parses, and contains suite and
assertion totals.

Then run desktop workspace `check` once and `git diff --check`.

Finally remove the root `node_modules` and app-local Electron execution wrapper
and confirm no node_modules entry in `git status`.

## Classification

Persist every failed file/assertion with first exact error and classify:

- `CURRENT_P0_REGRESSION`
- `EXECUTION_BRIDGE`
- `BASELINE_CONTRACT_OR_EVIDENCE`
- `UNCLASSIFIED`

Use current file/diff evidence. Do not infer pre-existing status from a worker
summary. Any current-P0 or unclassified result blocks candidate formation.

## Deliverables

- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `changed-files.txt`
- `DISPATCH_STATUS.md`
- `ACCEPTANCE_LOG.md`
- `failure-classification.json`

No Electron E2E, Git, network, credentials, or second global run.
