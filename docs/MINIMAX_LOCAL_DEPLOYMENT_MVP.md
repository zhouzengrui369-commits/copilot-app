# MiniMax Code Local Handoff — Copilot App macOS MVP

This document coordinates the final macOS local candidate attempt. It supplements, but does not replace, the exact-object authority and runner contracts already versioned in:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/npm-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## 1. Fixed status

```text
REMOTE_SOURCE_READY_FOR_LOCAL_ATTEMPT
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

A successful source gate, build, package, CI job, browser fixture, or PR merge does not prove Electron runtime acceptance.

## 2. Exact source binding

The executor receives externally:

```text
EXACT_FINAL_HEAD=<40-character final Draft PR head>
```

MiniMax must:

1. fetch the Draft PR head directly;
2. prove `FETCH_HEAD == EXACT_FINAL_HEAD`;
3. materialize every authority document and runner from that exact Git object;
4. create a new detached worktree at that exact commit;
5. prove local `git HEAD == EXACT_FINAL_HEAD` and `git status --porcelain=v1 --untracked-files=all` is empty;
6. never repair source in the deployment worktree.

Any mismatch is a blocker. Earlier source SHAs, dirty local worktrees, old candidate folders and old evidence directories are reference-only and cannot be reused.

## 3. Allowed platform and scope

- macOS only;
- arm64 authority for this MVP attempt;
- local-first desktop truth only;
- synthetic deterministic test data must be labeled `SYNTHETIC_E2E_FIXTURE_ONLY`;
- no Windows, mobile, cloud deployment, Remote, Backup, signing, notarization or global configuration changes.

## 4. Cache hydration

The candidate remains offline and deny-network. A separate bounded cache hydration is permitted only when the exact authority token is supplied:

```text
OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS
```

Hydration must use:

- a new clean detached hydration worktree;
- a new cache directory outside the repository;
- two distinct exclusive empty npm user/global config files;
- inherited proxy, registry, token and npm-config authority stripped;
- lifecycle scripts disabled;
- a localhost CONNECT proxy whose only allowed upstream is `registry.npmjs.org:443`;
- an offline `npm ci --ignore-scripts --offline --replace-registry-host=always` probe under `(deny network*)`;
- an exclusive receipt binding source commit, lock SHA-256, npm identity, command logs, proxy audit, cache file hashes and aggregate SHA-256.

The candidate runner must receive the cache directory and receipt as a pair. No automatic online fallback or second retry is allowed.

## 5. Candidate execution

Use a new evidence directory outside the repository. Run source contracts and dry-run first. Dry-run must end with:

```text
PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE
```

Then execute the candidate once. The twelve gates remain:

1. exact source identity and clean source;
2. receipt-bound offline install under deny-network authority;
3. SHA-256 ledger for every tracked regular file;
4. source contracts and ordered LLM → KB → KG → RAG build;
5. checks, tests, integration, strict coverage, desktop build, Phase 1 suite and SBOM;
6. canonical unsigned macOS arm64 ZIP/DMG authority;
7. source, ZIP, DMG, app, executable and `app.asar` identities;
8. focused packaged Electron journeys;
9. exact `113 tests in 9 files` discovery and source manifest;
10. packaged Electron `113/113`, zero skipped/unexpected/flaky and clean termination;
11. three distinct candidate-bound performance runs and aggregate;
12. final manifest, receipts, screenshots, hashes, runtime ID and terminal state.

Stop at the first blocker. Do not edit source or retry online.

## 6. Required product journeys

On the exact packaged candidate, MiniMax must exercise and record:

1. local material is visible in Knowledge;
2. Ask returns the expected answer from the local fixture;
3. every source can be opened and matched to the exact local text;
4. returning from the full reader restores the same question, answer, sources and action state;
5. creating an unscheduled Todo preserves answer text and source links;
6. the success receipt opens the exact Todo in Unscheduled;
7. the Todo can be edited and canonically read back;
8. a due date can be added and the Todo becomes visible in the matching day/plan view;
9. Electron fully quits;
10. the same packaged candidate relaunches with the Ask exchange, sources and Todo still discoverable.

Failures in persistence, canonical readback or source continuity are fail-closed and must not be described as success.

## 7. Required output package

Create outside the repository:

```text
PLAN.md
RESULT.md
EVIDENCE.md
commands.log
changed-files.txt
CANDIDATE-MANIFEST.json
R30-COMPLETE.json
```

The package must include:

- exact source commit and source snapshot SHA-256;
- artifact SHA-256 and artifact paths;
- app, executable and `app.asar` identities;
- runtime ID;
- ecosystem baseline commit;
- test-data manifest and explicit synthetic label;
- all commands, exit codes and durations;
- Gate 2 cache/hydration receipt and audit;
- test and coverage summaries;
- exact Electron suite summary;
- three performance receipts;
- screenshots and SHA-256;
- process terminal state;
- final source and evidence Git status;
- exact blocker if incomplete.

## 8. Codex boundary

MiniMax's package is technical execution evidence, not product acceptance. Codex must independently launch and operate the same source/artifact/runtime identity on the real Mac. Until Codex returns a candidate-bound verdict:

```text
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
