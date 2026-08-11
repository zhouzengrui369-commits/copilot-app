# EVIDENCE

## Receipt validation

- file:
  `/private/tmp/copilot-p0-current-global-r3.json`
- type: regular file
- size: `675208` bytes
- nlink: `1`
- SHA256:
  `ba7386294fec7b7ad2a55b05d6aaf543b6a57a02d9793f8dcbf0ac4728a261e2`
- JSON parse: PASS
- totals match TASK.md exactly.

## Exhaustive record count

The receipt contains `124` `testResults` records. Independent traversal
captured:

- `33` failed assertion records;
- `4` failed suite records with zero assertions;
- `37` classified failure records total.

Every record, full test name, first exact error and evidence basis is persisted
in `failure-classification.json`.

## CURRENT_P0_REGRESSION

Count: `0`.

No failed assertion maps to the changed Ask/Todo canonical create/readback,
source retention, exact-ID routing, or restored Todo log/note implementation.
The focused EXP-COP-008 evidence remains separate; this classification does not
replace Electron acceptance.

## EXECUTION_BRIDGE

Count: `7`.

Every item has the same first exact failure:

```text
Failed to resolve entry for package "electron".
```

Affected records:

- `direct-performance-probe.test.ts`: suite startup, zero assertions;
- `preload-domain-coverage.test.ts`: two assertions;
- `preload.test.ts`: suite startup, zero assertions;
- `r22-startup-lazy-red.test.tsx`: suite startup, zero assertions;
- `r22-startup-review-fixes.test.tsx`: suite startup, zero assertions;
- `reversible-trash-preload-r1.test.ts`: one assertion.

These failures occur at Vite package resolution before product behavior. They
do not establish a product regression, but they leave the candidate global gate
incomplete.

## BASELINE_CONTRACT_OR_EVIDENCE

Count: `30`.

- Knowledge WIKI truth: `6`. The unchanged old test expects
  `moc-wiki-current` / `note-detail-panel`, which are absent in both HEAD and
  current Knowledge source. Newer focused Knowledge truth evidence passed.
- Demo-first UI: `2`. The unchanged test expects a page-local `floating-ai`
  class absent at HEAD/current and skips the discard-confirmation interaction
  already present at HEAD.
- Distribution/performance evidence: `7`.
  - fixed package preimage mismatch: `1`;
  - external distribution evidence remains `BLOCKED`: `1`;
  - unchanged r22 evidence contracts: `2`;
  - unchanged r31 evidence contracts: `3`, including two exact missing
    historical proposal/runner paths.
- Backup: `3`. Unchanged Backup-only source/tests; failures are an evidence
  object mismatch, an obsolete single-alert query, and an incomplete API mock.
- Reversible Trash integration: `5`. Failing schema/restore test files are
  unchanged. The exact restore reindex source slice producing `WIKI_MISSING`
  has identical HEAD/current SHA256
  `820eaea8394187e5d4738001e65c4739dbf478a3a88d42682ab24e74a841c21a`.
- Remote pairing: `7`. Source/tests are unchanged. The test fixture uses
  `/var/folders/...` while `realpath` is `/private/var/folders/...`; the fixed
  canonical-directory guard rejects before each scenario.

## UNCLASSIFIED

Count: `0`.

## Gate conclusion

Current P0 assertion regression classification is green, but the overall
global gate is blocked until the seven Electron package-resolution records are
rerun with a truthful execution identity. Release/performance baselines remain
red independently.
