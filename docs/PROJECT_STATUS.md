# Copilot App Project Status

**Verdict: `BLOCKED / MVP_NOT_COMPLETE`.** This is an authoritative mirror of the root status, not an independent baseline.

## Authority and Reading Order

Read `AGENTS.md`, then `goal.md` / `plan.md` / `rules.md` / `delivery.md` v6.2, then root `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md`. Only after those may this mirror and `docs/ARCHITECTURE.md` be used. `docs/PROJECT_STATUS.md` never overrides root truth.

## Exact Source

- Repository: `zhouzengrui369-commits/copilot-app`
- Parent branch: `codex/p0-owner-gate`
- Parent commit: `6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- `main` observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Successor branch: `agent/r30-github-bound-candidate-runner`
- Parent Draft PR: `#12`

The R30 runtime source identity is not hard-coded through an impossible self-referential commit. MiniMax Code must pass the final GitHub PR head as `--source-commit`, and the runner fails unless it exactly equals `git HEAD`.

## Preserved Detailed Truth

Exact pre-R30 copies of root state, status, TODO, changelog, and architecture are retained under `docs/history/`. The shorter R30 current view is additive and does not delete accepted development evidence or historical blockers.

## Completed Remotely

- Read the full root v6.2 baseline and all six low-confidence `main` handoff documents.
- Replaced generic handoff/status/risk/todo/progress content with explicit mirrors subordinate to root authority.
- Preserved and expanded the detailed local-first, Electron, grounded Ask/Todo, ASR, candidate-receipt, and deferred-scope architecture.
- Created a brand-new R30 candidate runner; old R28 remains `NEVER_RUN / PERMANENTLY_REJECTED` and is neither copied nor repaired.
- Added pure Node RED→GREEN contract tests for source binding, dirty-tree rejection, Gate 2, Gate 3, Gate 9, runner planning, and documentation authority.
- Confirmed syntax, dry-run planning, and 23/23 pure Node tests without launching Electron.

## R30 Gate Truth

- Gate 1 binds a full 40-hex owner-approved commit and clean worktree.
- Gate 2 defaults to no network and requires macOS `sandbox-exec` with `(deny network*)`; `npm ci --offline` cannot fall back online.
- Gate 3 generates a complete regular-file control ledger with exact 64-character SHA256 digests.
- Gates 4–7 define deterministic workspace builds, TSC/build, one unsigned macOS arm64 package, source snapshot, and artifact identity.
- Gate 8 requires focused packaged Electron 2/2.
- Gate 9 requires exactly `113 tests in 9 files`.
- Gate 10 requires exact packaged Electron 113/113, zero skipped/unexpected/flaky, and clean terminal state.
- Gate 11 binds test-data manifest, screenshots, artifact SHA256, runtime ID, commands, and process terminal state.

## Not Completed

No R30 local run or Electron candidate exists. Artifact SHA256, runtime ID, source snapshot receipt, packaged Electron evidence, real-computer screenshots, Codex verdict, signing, notarization, Release, and Human Owner Gate remain unset.

## Role Boundary

- ChatGPT develops through GitHub only.
- MiniMax Code deploys and executes one exact approved commit; it does not edit source.
- Codex independently performs real-computer acceptance after MiniMax evidence; it does not fix source.

## Next Single Action

After the bounded PR is reviewed, MiniMax Code checks out its exact final commit and runs:

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_GITHUB_COMMIT> \
  --evidence-dir <ABSOLUTE_NEW_OUTSIDE_REPO_DIRECTORY>
```

On any blocker, MiniMax stops and returns the blocker receipt. Only after complete source snapshot, artifact SHA256, runtime ID, test-data manifest, commands, screenshots, and process terminal state are returned may Codex begin independent acceptance.
