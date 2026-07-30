# Copilot App Development Workflow

Status: `BLOCKED / MVP_NOT_COMPLETE`.

This document defines the owner-approved GitHub → MiniMax Code → Codex execution boundary. Root `AGENTS.md`, `goal.md`, `plan.md`, `rules.md`, `delivery.md`, and current root state files remain authoritative.

## 1. Source Authority

GitHub commits and pull requests are the only product-source authority. A local dirty worktree, pasted patch, generated artifact, worker narrative, screenshot, or review branch does not supersede the exact Git commit.

Current chain:

- original takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`, PR #12;
- candidate-runner parent: `agent/r30-github-bound-candidate-runner`, PR #13;
- source completion: `agent/r31-source-completion`, Draft PR #14.

The final commit is reported externally after the last tracked-document commit passes CI. Tracked documents do not attempt to embed their own containing commit.

## 2. Roles

### ChatGPT — GitHub Source Developer

May:

- read repository authority and PR history;
- create/update source and governance on the bounded branch;
- add fail-closed tests and GitHub Actions source gates;
- inspect CI logs and repair source failures;
- update PR metadata and handoff documentation.

Must not:

- execute the local candidate or packaged Electron app;
- create local runtime, signing, notarization, installation, or owner-use evidence;
- claim source tests establish product completion;
- send MiniMax an unverified branch tip.

### MiniMax Code — Exact-Commit Local Executor

May:

- perform a read-only inventory of existing worktrees, caches, tools, manifests, screenshots, signing/notary tooling, and performance tooling;
- reuse valid tools and npm cache;
- create a new clean detached worktree at the exact approved commit;
- execute the reviewed candidate runner once;
- return candidate-bound evidence.

Must not:

- silently modify product source or governance;
- execute R28;
- reuse old candidate identity, artifact identity, runtime identity, or evidence directory;
- clean stale ignored output in place and continue;
- retry online after an offline-cache blocker;
- relabel an unsigned diagnostic candidate as Release.

### Codex — Independent Real-Computer Acceptance

Starts only after MiniMax returns a complete internally consistent receipt. It independently verifies source/artifact/runtime identity, operates the packaged application, performs focused product-experience journeys and Release Gate checks, and reports P0/P1/P2 findings.

Codex must not repair source in the acceptance lane or use self-authored fixes as independent acceptance.

## 3. GitHub Source Gate

The PR workflow runs on Node 24/macOS and must be green on the exact final HEAD. It performs:

1. exact HEAD checkout and toolchain identity;
2. exact lockfile install;
3. candidate fail-closed pure Node contracts;
4. embedded-local RAG focused tests;
5. ordered workspace dependency build;
6. all local-first workspace checks;
7. core unit and integration suites;
8. desktop product build;
9. desktop Phase 1 release source suite;
10. core strict global and critical coverage;
11. desktop strict global and per-file critical coverage;
12. production CycloneDX SBOM validation;
13. exact Electron list-only `113 tests in 9 files` discovery;
14. clean tracked source verification.

GitHub source CI does not launch the candidate Electron runtime. It authorizes the next executor; it does not establish a candidate or Release.

## 4. Final Commit Handoff

After the final docs/source commit passes the source gate:

1. Read the exact 40-character PR #14 head SHA.
2. Record it in the PR conversation and owner-facing deployment instruction.
3. Do not commit again. Any later commit invalidates that reported final SHA.
4. MiniMax uses the SHA, not a mutable branch name, to create a detached worktree.
5. The runner compares `--source-commit` with `git rev-parse HEAD` before candidate work.

## 5. MiniMax Preflight

MiniMax must verify:

- macOS and `/usr/bin/sandbox-exec`;
- Node 24;
- Python `/usr/bin/python3` with required packaging compatibility;
- an executable npm resolved from the reviewed PATH;
- exact detached Git HEAD;
- empty `git status --porcelain=v1 --untracked-files=all`;
- absence of every governed generated candidate input;
- a new absolute evidence directory outside the repository that does not exist through any symlink alias.

Governed generated inputs include desktop `.vite`, `coverage`, `dist`, `release`, `test-results`, `playwright-report`, root report directories, and KB/KG/LLM/RAG `dist`/`coverage` directories.

If a governed path exists, stop and create another clean worktree. Do not delete it in place and continue.

## 6. Candidate Execution

First run source contracts and dry-run:

```bash
node --test scripts/candidate-r30/*.test.mjs

node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_40_HEX_HEAD> \
  --evidence-dir <NEW_ABSOLUTE_OUTSIDE_REPO_DIR> \
  --dry-run
```

Dry-run must report `PLAN_ONLY_NOT_A_CANDIDATE` and `MVP_NOT_COMPLETE`. It must not create the evidence directory or launch Electron.

Then execute once:

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_40_HEX_HEAD> \
  --evidence-dir <NEW_ABSOLUTE_OUTSIDE_REPO_DIR>
```

The runner owns twelve ordered gates described in `scripts/candidate-r30/README.md` and `docs/ARCHITECTURE.md`.

## 7. Network and Cache Rule

All recorded commands run through macOS `sandbox-exec` with `deny network*`. npm authority is offline-only. Proxy and registry environment authority is removed. The runner does not automatically fall back online.

If npm cache is insufficient, the runner exits `2` and writes a blocker with:

```text
BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED
```

MiniMax must stop and return that receipt. A separate GitHub-reviewed owner approval is required before any minimal read-only registry exception. MiniMax may not retry or edit the runner.

## 8. Required MiniMax Return

Return one package containing:

- exact commit and final clean Git status;
- all-tracked-file ledger path/SHA256, aggregate SHA256, scope, and file count;
- canonical source snapshot and authoritative input manifest;
- CycloneDX SBOM and SHA256;
- canonical manifest and release identity;
- arm64 ZIP, DMG, app, executable, and `app.asar` SHA256;
- focused packaged Electron 2/2 evidence;
- exact list-only 113/9 evidence;
- full packaged Electron 113/113 evidence with zero skipped/unexpected/flaky and clean exit;
- complete E2E source manifest and aggregate SHA256;
- three raw performance records and one aggregate, all hashes and candidate bindings;
- runtime ID and runtime identity;
- commands and exit codes;
- screenshots and SHA256;
- process terminal state;
- `CANDIDATE-MANIFEST.json`;
- `R30-COMPLETE.json`.

A blocker return includes `R30-BLOCKED.json`, existing command/log receipts, exact source identity, and final Git status. Do not conceal partial failure.

## 9. Codex Acceptance

Codex first verifies the receipt and exact source/artifact/runtime bindings. It then independently exercises the installed/packaged app on the real computer, including grounded Ask/source navigation, Todo closure/restart continuity, quick capture, WIKI truth, Trash recovery, local-ASR offline behavior, startup/performance, and product-language/accessibility findings.

Codex reports:

- exact identity checked;
- P0/P1/P2 findings;
- focused retest verdict;
- Release Gate verdict;
- whether a source-fix cycle is required.

If a source fix is required, work returns to a new bounded GitHub revision. All candidate-bound evidence must then be regenerated for the new final commit.

## 10. Completion Boundary

Even a complete unsigned candidate is not MVP complete. Remaining gates include three verify-fix rounds on one final candidate, Developer ID signing, Apple notarization/stapling/validation, Gatekeeper install/launch, real packaged offline ASR, independent acceptance, Human Owner Gate, and required owner-use evidence.

Windows is Phase 1.1. Tencent deployment, Remote/live, and optional Backup are post-MVP unless the owner explicitly changes scope.
