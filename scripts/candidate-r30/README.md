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

## Executed source gates

Before packaging, the runner must pass under the same fail-closed no-network sandbox:

1. exact full Git commit, clean tracked/untracked source, and no stale ignored candidate input;
2. `npm ci --offline --no-audit --no-fund` with no automatic online retry;
3. a same-handle, no-follow SHA256 ledger for every path returned by `git ls-files -z`, including an aggregate digest;
4. all candidate source-contract tests and the existing ordered LLM → KB → KG → RAG build chain;
5. check, unit, explicit integration, strict global coverage, strict critical coverage, and build gates for the local-first workspaces;
6. unsigned macOS arm64 diagnostic packaging;
7. source snapshot plus artifact identity;
8. exact focused packaged Electron `2/2`;
9. exact discovery `113 tests in 9 files` plus hashes for every E2E spec, fixture, and helper;
10. exact packaged Electron `113/113`, zero skipped/unexpected/flaky, and clean process termination;
11. complete candidate receipt.

No earlier source/static result establishes Electron runtime, signing, notarization, Release, or MVP completion.

## MiniMax Code execution

Use a new clean checkout of the exact approved commit. First perform the owner-required read-only reuse inventory of existing worktrees, caches, candidate records, release tools, manifests, screenshots, signing/notary tooling, and performance tooling. Reuse valid tools and caches; do not reuse an old candidate identity or old candidate-bound evidence.

Relevant ignored `dist`, `.vite`, `release`, `coverage`, `test-results`, and `playwright-report` inputs must be absent from the selected clean worktree. The evidence directory must not exist and must resolve outside the repository even through symlink aliases.

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_GITHUB_COMMIT> \
  --evidence-dir <ABSOLUTE_NEW_DIRECTORY_OUTSIDE_REPO>
```

A blocker exits `2` and writes `R30-BLOCKED.json` only after R30 owns the new directory. A pre-existing directory is never modified. Never edit source, clean stale output in place, chmod old evidence, reuse a directory, execute R28, or retry online.

On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop and return the receipt. A separate reviewed source revision is required before any minimal read-only registry exception.

## Required return package

MiniMax returns the exact source commit and clean status, source snapshot and SHA256, complete Gate 3 ledger and aggregate SHA256, ZIP/DMG/app/executable SHA256, runtime ID/identity, `SYNTHETIC_E2E_FIXTURE_ONLY` test-data manifest with all E2E source hashes, focused/full Electron evidence, commands and exit codes, screenshots and SHA256, process terminal state, `CANDIDATE-MANIFEST.json`, and `R30-COMPLETE.json`.

Only then may Codex begin independent real-computer acceptance.
