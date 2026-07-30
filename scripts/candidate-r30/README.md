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

## Executed source and candidate gates

Before a candidate receipt may be emitted, the runner must pass under the same fail-closed no-network sandbox:

1. exact full Git commit, clean tracked/untracked source, and no stale ignored candidate input;
2. absolute reviewed `npm` executable plus `npm ci --offline --no-audit --no-fund`, with no automatic online retry;
3. a same-handle, no-follow SHA256 ledger for every path returned by `git ls-files -z`, including an aggregate digest;
4. all candidate source-contract tests and the existing ordered LLM → KB → KG → RAG build chain;
5. check, unit, explicit integration, strict global coverage, strict critical coverage, desktop build, and production CycloneDX SBOM gates for the local-first Phase 1 scope;
6. the existing canonical builder producing the exact unsigned macOS arm64 ZIP and DMG for `v6.2-phase1-candidate-r31`;
7. canonical source snapshot, artifact, app, executable, `app.asar`, and runtime identity;
8. exact focused packaged Electron `2/2`;
9. exact discovery `113 tests in 9 files` plus hashes for every E2E spec, fixture, and helper;
10. exact packaged Electron `113/113`, zero skipped/unexpected/flaky, and clean process termination;
11. three distinct candidate-bound `r31-v1` performance runs plus one hash-bound aggregate, all under the exclusive launch/RSS and minimum KG FPS thresholds;
12. complete candidate receipt, including source and artifact identities, SBOM, commands, screenshots, performance records, test-data manifest, runtime ID, and terminal process state.

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

MiniMax returns:

- exact source commit, branch/detached-HEAD truth, and final clean status;
- Gate 3 all-tracked-file ledger, aggregate SHA256, file count, and ledger SHA256;
- canonical source snapshot, canonical manifest, release identity, SBOM, ZIP, DMG, app, executable, and `app.asar` SHA256 values;
- runtime ID and packaged runtime identity;
- `SYNTHETIC_E2E_FIXTURE_ONLY` test-data manifest with every E2E source hash;
- focused `2/2`, discovery `113 tests in 9 files`, and full `113/113` Electron evidence;
- three raw performance records, aggregate performance record, and every corresponding SHA256;
- commands and exit codes, screenshots and SHA256, and clean process terminal state;
- `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json`.

Only then may Codex begin independent real-computer acceptance.
