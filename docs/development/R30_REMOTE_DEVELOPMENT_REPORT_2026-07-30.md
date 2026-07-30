# R30 Remote Development Report — 2026-07-30

## Verdict

`SOURCE_READY_FOR_REVIEW / LOCAL_EXECUTION_NOT_RUN / BLOCKED / MVP_NOT_COMPLETE`

This report covers GitHub-source work only. ChatGPT did not execute a local Electron candidate, package, signing, notarization, independent Codex acceptance, Release, or Human Owner Gate.

## Source Identity

- Repository: `zhouzengrui369-commits/copilot-app`
- Parent branch: `codex/p0-owner-gate`
- Parent commit: `6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- `main` observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Bounded branch: `agent/r30-github-bound-candidate-runner`
- Parent Draft PR: `#12`
- Final successor commit: supplied by the GitHub PR head after commit creation. At local execution, `--source-commit` must equal `git HEAD`; this avoids an impossible self-referential commit field inside the same commit.

## Scope

1. Reconcile the six low-confidence documents added to `main` without allowing them to replace detailed v6.2/local-first/fail-closed truth.
2. Preserve the exact pre-R30 root state/status/TODO/changelog/architecture so concise current mirrors cannot erase accepted evidence.
3. Create a brand-new successor to rejected R28.
4. Close the source contracts for Gate 2, Gate 3, and Gate 9.
5. Define the remaining candidate-bound receipt path for MiniMax Code.
6. Preserve `BLOCKED / MVP_NOT_COMPLETE` and the GitHub → MiniMax Code → Codex role split.

No product feature, data schema, provider behavior, dependency version, Windows scope, Tencent deployment, Remote/live, backup, signing, or notarization implementation changed.

## Exact Changed Files

1. `PROJECT_STATE.yaml`
2. `PROJECT_STATUS.md`
3. `TODO.md`
4. `CHANGELOG.md`
5. `docs/AI_HANDOVER.md`
6. `docs/ARCHITECTURE.md`
7. `docs/PROJECT_PROGRESS.json`
8. `docs/PROJECT_STATUS.md`
9. `docs/RISKS.md`
10. `docs/TODO.md`
11. `docs/development/R30_REMOTE_DEVELOPMENT_REPORT_2026-07-30.md`
12. `docs/history/PROJECT_STATE_PRE_R30.yaml` (exact pre-R30 blob preserved)
13. `docs/history/PROJECT_STATUS_PRE_R30.md` (exact pre-R30 blob preserved)
14. `docs/history/TODO_PRE_R30.md` (exact pre-R30 blob preserved)
15. `docs/history/ARCHITECTURE_PRE_R30.md` (exact pre-R30 blob preserved)
16. `docs/history/CHANGELOG_PRE_R30.md` (exact pre-R30 blob preserved)
17. `scripts/candidate-r30/README.md`
18. `scripts/candidate-r30/contract.mjs`
19. `scripts/candidate-r30/contract.test.mjs`
20. `scripts/candidate-r30/document-authority.test.mjs`
21. `scripts/candidate-r30/io.mjs`
22. `scripts/candidate-r30/gates-build.mjs`
23. `scripts/candidate-r30/gates-electron.mjs`
24. `scripts/candidate-r30/run-candidate.mjs`
25. `scripts/candidate-r30/runner.test.mjs`

## RED→GREEN Commands and Exit Codes

| Stage | Command | RED | GREEN |
|---|---|---:|---:|
| Gate contract | `node --test scripts/candidate-r30/contract.test.mjs` | `1` — module absent; later hardening RED also `1` on missing fail-closed exports | `0` — final 11/11 PASS |
| Runner plan | `node --test scripts/candidate-r30/runner.test.mjs` | `1` — runner absent | `0` — final 6/6 PASS, including existing-evidence no-overwrite |
| Documentation authority | `node --test scripts/candidate-r30/document-authority.test.mjs` | `1` — target mirrors absent | `0` — 6/6 PASS |
| Combined source tests | `node --test scripts/candidate-r30/*.test.mjs` | n/a | `0` — 23/23 PASS |
| Runtime module syntax | `node --check` on `contract.mjs`, `io.mjs`, `gates-build.mjs`, `gates-electron.mjs`, and `run-candidate.mjs` | n/a | all `0` |
| JSON validation | `python -m json.tool docs/PROJECT_PROGRESS.json` | n/a | `0` |
| YAML validation | `yaml.safe_load(PROJECT_STATE.yaml)` | n/a | `0` |
| Plan-only smoke | `node scripts/candidate-r30/run-candidate.mjs --source-commit 6aa6b8c0792c5549b818107a0f64e4f32651dacd --evidence-dir /tmp/copilot-r30-plan-only --dry-run` | n/a | `0`; `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE` |

These tests are pure Node/static validation. Electron, npm install, build, package, network, and local runtime were not executed.

Pre-commit fail-closed hardening also proved that a symlink alias cannot redirect the evidence directory into the repository, ignored generated candidate inputs cannot be blended into a nominally clean build, and a pre-existing evidence directory remains byte-for-byte untouched.

## Gate Closure

### Gate 2

- macOS-only `/usr/bin/sandbox-exec` profile includes `(deny network*)`.
- inherited proxy and registry environment authority is removed;
- `npm ci --offline --no-audit --no-fund` is the only install route;
- missing cache returns `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`;
- automatic online retry is absent.

### Gate 3

- ledger scope is an exact allowlist of R30 and directly controlling package/Electron inputs;
- every entry is a regular non-symlink file;
- every SHA256 is real, lower-case, and exactly 64 characters;
- missing, duplicate, unknown, 63-character, symlinked, or nonregular entries fail closed.

### Gate 9

- one and only one list summary is accepted;
- exact requirement is `113 tests in 9 files`;
- `>=50`, `112/9`, `113/8`, and `114/9` are rejected;
- Gate 10 separately requires exact packaged Electron 113/113 with zero skipped/unexpected/flaky and clean process exit.

## Risks

- Local npm/Electron cache may be insufficient; this is a deliberate blocker, not authorization to reach the network.
- `sandbox-exec` availability and package command behavior require MiniMax's real macOS run.
- R30 creates an unsigned diagnostic package only; signing/notarization remain open.
- Synthetic E2E data cannot count as real owner data or real-computer experience acceptance.
- Final suite-count changes require a separately reviewed contract update; the current runner intentionally fails on drift.
- Any MiniMax or Codex source edit invalidates the source binding and requires a new GitHub PR.

## Rollback

Revert the bounded R30 PR commits or delete the unmerged branch. There is no database migration, product data mutation, external deployment, candidate runtime, signing credential action, or dependency major upgrade to reverse.

## MiniMax Code Handoff

After review, use the exact final PR head:

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_GITHUB_COMMIT> \
  --evidence-dir <ABSOLUTE_NEW_DIRECTORY_OUTSIDE_REPO>
```

Return source snapshot SHA256, artifact SHA256, runtime ID, test-data manifest, commands/exit codes, screenshots, process terminal state, final clean `git status`, and the complete private manifest. Stop on the first blocker and never silently modify source.

## Codex Handoff Gate

Do not notify Codex to begin local acceptance until the complete MiniMax receipt package exists. Codex then independently operates the exact packaged candidate and reports acceptance findings without changing product source.
