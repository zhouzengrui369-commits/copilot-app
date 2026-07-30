# MiniMax Code Local Deployment — R31 Exact-Commit Handoff

Status before execution: `BLOCKED / MVP_NOT_COMPLETE / LOCAL_CANDIDATE_NOT_RUN`.

This document is executable guidance for MiniMax Code. It does not authorize source changes. Obtain the exact final 40-character PR #14 HEAD from the owner-facing handoff or PR conversation after the final GitHub source gate succeeds.

## Non-Negotiable Rules

- Use the exact supplied commit SHA, not `main`, not the branch tip, and not a shortened SHA.
- Create a new clean detached worktree.
- Use a new absolute evidence directory outside the repository; it must not exist, including through symlink aliases.
- Do not run R28.
- Do not edit source or governance.
- Do not delete stale candidate inputs in place and continue; create another clean worktree.
- Do not reuse a prior candidate ID, artifact/runtime identity, screenshot, performance record, manifest, or evidence directory.
- Do not retry online. On npm offline-cache failure, stop and return the blocker.
- A passing run is an unsigned diagnostic candidate, not MVP completion or Release.

## 1. Set Explicit Inputs

Replace the repository path and exact SHA. The evidence path below is deliberately new for each run.

```bash
set -euo pipefail

REPO="/absolute/path/to/existing/copilot-app"
SOURCE_COMMIT="<EXACT_FINAL_40_HEX_PR14_HEAD>"
WORKTREE="$HOME/copilot-r31-${SOURCE_COMMIT:0:12}"
EVIDENCE="$HOME/copilot-evidence/copilot-r30-${SOURCE_COMMIT}-$(date -u +%Y%m%dT%H%M%SZ)"

case "$SOURCE_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "BLOCKED: SOURCE_COMMIT must be exactly 40 lower-case hex characters" >&2; exit 2 ;;
esac

test -d "$REPO/.git" || git -C "$REPO" rev-parse --git-dir >/dev/null
```

## 2. Read-Only Reuse Inventory

Record what already exists before creating the candidate. Reuse valid tools and npm cache only. Do not reuse old evidence.

```bash
printf '%s\n' \
  "repo=$REPO" \
  "source_commit=$SOURCE_COMMIT" \
  "planned_worktree=$WORKTREE" \
  "planned_evidence=$EVIDENCE"

git -C "$REPO" worktree list --porcelain
node --version || true
npm --version || true
command -v node || true
command -v npm || true
/usr/bin/python3 --version || true
test -x /usr/bin/sandbox-exec && echo "sandbox-exec=present"

# Read-only cache/tool inventory; absence is not repaired here.
npm config get cache || true
ls -ld "$HOME/.npm" 2>/dev/null || true
find "$HOME" -maxdepth 3 -type f \
  \( -name 'CANDIDATE-MANIFEST.json' -o -name 'R30-COMPLETE.json' -o -name 'R30-BLOCKED.json' \) \
  -print 2>/dev/null | head -200 || true
```

## 3. Fetch And Create A Clean Detached Worktree

```bash
cd "$REPO"
git fetch --prune origin

git cat-file -e "${SOURCE_COMMIT}^{commit}"
test ! -e "$WORKTREE"
test ! -e "$EVIDENCE"

git worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"
cd "$WORKTREE"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Do not switch this detached worktree to a branch.

## 4. Verify Toolchain And Sandbox

```bash
node --version | grep -E '^v24\.'
npm --version
/usr/bin/python3 --version
/usr/bin/python3 -c 'import distutils; print(distutils.__file__)'
test -x /usr/bin/sandbox-exec
command -v npm | grep '^/'
```

If Node is not v24, stop. Do not edit package files or lower the engine/source-gate contract.

## 5. Verify Governed Generated Inputs Are Absent

```bash
for p in \
  apps/copilot-desktop/.vite \
  apps/copilot-desktop/coverage \
  apps/copilot-desktop/dist \
  apps/copilot-desktop/playwright-report \
  apps/copilot-desktop/release \
  apps/copilot-desktop/test-results \
  coverage \
  playwright-report \
  test-results \
  packages/kb/coverage \
  packages/kb/dist \
  packages/kg/coverage \
  packages/kg/dist \
  packages/llm-client/coverage \
  packages/llm-client/dist \
  packages/rag/coverage \
  packages/rag/dist
do
  test ! -e "$p" || {
    echo "BLOCKED: stale governed input exists: $p" >&2
    exit 2
  }
done

test -z "$(git status --porcelain=v1 --untracked-files=all)"
test ! -e "$EVIDENCE"
```

If this fails, abandon this worktree and create a different clean worktree. Do not remove the path and continue in the same candidate preimage.

## 6. Run Candidate Source Contracts

```bash
node --test scripts/candidate-r30/*.test.mjs
```

This must pass before dry-run or candidate execution.

## 7. Dry-Run The Exact Plan

Dry-run is planning only. It must not create the candidate evidence directory or launch Electron.

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE" \
  --dry-run | tee /tmp/copilot-r31-dry-run.json

grep -q 'PLAN_ONLY_NOT_A_CANDIDATE' /tmp/copilot-r31-dry-run.json
grep -q 'MVP_NOT_COMPLETE' /tmp/copilot-r31-dry-run.json
test ! -e "$EVIDENCE"
```

## 8. Execute The Candidate Once

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE"
```

Do not rerun against the same evidence directory. The runner creates it exclusively.

## 9. Success Verification

```bash
test -f "$EVIDENCE/CANDIDATE-MANIFEST.json"
test -f "$EVIDENCE/R30-COMPLETE.json"
test ! -f "$EVIDENCE/R30-BLOCKED.json"

test -f "$EVIDENCE/gates/gate-03-sha256-ledger.json"
test -f "$EVIDENCE/gates/gate-05-sbom.json"
test -f "$EVIDENCE/gates/gate-07-artifact-identity.json"
test -f "$EVIDENCE/gates/gate-08-focused-electron.json"
test -f "$EVIDENCE/gates/gate-09-discovery.json"
test -f "$EVIDENCE/gates/gate-10-full-electron.json"
test -f "$EVIDENCE/gates/gate-11-performance.json"

git status --porcelain=v1 --untracked-files=all

git rev-parse HEAD
shasum -a 256 \
  "$EVIDENCE/CANDIDATE-MANIFEST.json" \
  "$EVIDENCE/R30-COMPLETE.json"
```

The final Git status must be empty and the printed HEAD must equal `SOURCE_COMMIT`.

## 10. Blocker Handling

The runner exits `2` for a fail-closed blocker and writes `R30-BLOCKED.json` only after it owns the new evidence directory.

```bash
if test -f "$EVIDENCE/R30-BLOCKED.json"; then
  cat "$EVIDENCE/R30-BLOCKED.json"
  git rev-parse HEAD
  git status --porcelain=v1 --untracked-files=all
fi
```

For:

```text
BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED
```

stop immediately. Do not:

- run `npm ci` online;
- change npm registry/proxy authority;
- edit the candidate runner;
- rerun against the same evidence directory;
- substitute a different commit.

Return the blocker for a separately reviewed minimal read-only registry decision.

For any other blocker, return the exact blocker code, gate, detail, command receipt, stdout/stderr logs, source commit, evidence path, and final Git status. Do not conceal or repair it locally.

## 11. Required Return Package

Return to the parent PM:

1. `SOURCE_COMMIT`, detached HEAD proof, worktree path, evidence path, and clean final Git status.
2. Gate 3 ledger path/SHA256, aggregate SHA256, scope, and file count.
3. Canonical manifest, release identity, canonical snapshot, and authoritative source-input manifest.
4. CycloneDX SBOM path/SHA256 and root/component counts.
5. ZIP, DMG, `.app`, executable, and `app.asar` paths/SHA256.
6. Focused packaged Electron 2/2 receipt.
7. Exact discovery `113 tests in 9 files` receipt.
8. Full packaged Electron 113/113 receipt with zero skipped/unexpected/flaky and clean process exit.
9. Complete `SYNTHETIC_E2E_FIXTURE_ONLY` source manifest and content aggregate SHA256.
10. Three raw `r31-v1` performance files, aggregate, hashes, threshold results, and candidate binding.
11. Runtime ID and runtime identity.
12. Commands/exit codes and stdout/stderr logs.
13. Screenshot list and SHA256 values.
14. Process terminal state.
15. `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json` with their SHA256 values.

Only after this package is complete may Codex begin independent real-computer acceptance.
