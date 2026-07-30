# R30 GitHub-Bound Candidate Runner

`BLOCKED / MVP_NOT_COMPLETE` until local execution, independent Codex acceptance, signing, notarization, and owner gates close.

R30 is a new successor to the rejected, never-run R28. It binds one clean checkout to one exact GitHub commit and emits private candidate-bound evidence. It has no online fallback and cannot promote an unsigned diagnostic package to Release.

## Remote source validation

```bash
node --test scripts/candidate-r30/*.test.mjs
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_GITHUB_COMMIT> \
  --evidence-dir <ABSOLUTE_NEW_DIRECTORY_OUTSIDE_REPO> \
  --dry-run
```

Dry-run is planning only. It does not create a candidate or run Electron.

## MiniMax Code execution

Use a new clean checkout of the exact approved commit. Relevant ignored `dist`, `.vite`, `release`, `coverage`, `test-results`, and `playwright-report` inputs must be absent. The evidence directory must not exist and must resolve outside the repository even through symlink aliases.

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_GITHUB_COMMIT> \
  --evidence-dir <ABSOLUTE_NEW_DIRECTORY_OUTSIDE_REPO>
```

A blocker exits `2` and writes `R30-BLOCKED.json` only after R30 owns the new directory. A pre-existing directory is never modified. Never edit source, clean stale output in place, chmod old evidence, reuse a directory, or retry online.

On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop and return the receipt. A separate reviewed source revision is required before any minimal read-only registry exception.

## Required return package

MiniMax returns the exact source commit and clean status, source snapshot and SHA256, Gate 3 ledger, ZIP/DMG/app/executable SHA256, runtime ID/identity, `SYNTHETIC_E2E_FIXTURE_ONLY` test-data manifest, focused/full Electron evidence, commands and exit codes, screenshots and SHA256, process terminal state, `CANDIDATE-MANIFEST.json`, and `R30-COMPLETE.json`.

Only then may Codex begin independent real-computer acceptance.
