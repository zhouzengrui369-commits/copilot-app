# MiniMax Code Local Deployment — R31 Exact-Commit Handoff

Status before execution: `BLOCKED / MVP_NOT_COMPLETE / LOCAL_CANDIDATE_NOT_RUN`.

This document is executable guidance for MiniMax Code. It does not authorize source changes. Obtain the exact final 40-character PR #14 HEAD from the owner-facing handoff or PR conversation after the final GitHub source gate succeeds.

## Non-Negotiable Rules

- Use the exact supplied commit SHA, not `main`, not the current checkout, not the branch tip, and not a shortened SHA.
- The deployment authority is the file stored in the **exact Git commit object**. Absence from a stale checkout is not proof that the exact commit lacks the file.
- Fetch and compare PR #14 HEAD before reading authority. Never search only the current worktree and infer `MISSING_DEPLOYMENT_AUTHORITY`.
- Create a new clean detached worktree.
- Use a new absolute evidence directory outside the repository; it must not exist, including through symlink aliases.
- Do not run R28.
- Do not edit source, tests, the candidate runner, or governance.
- Do not delete stale candidate inputs in place and continue; create another clean worktree.
- Do not reuse a prior candidate ID, artifact/runtime identity, screenshot, performance record, manifest, or evidence directory.
- Do not retry online. On npm offline-cache failure, stop and return the blocker.
- A passing run is an unsigned diagnostic candidate, not MVP completion or Release.
- A cron/file-presence probe is not execution authority and must never auto-run the candidate.

## 0. Bootstrap Authority From The Exact Git Object

This step resolves the stale-worktree failure mode. It performs one explicit GitHub source fetch, verifies the externally supplied SHA, and reads the authority and bootstrap program directly from that commit. It does **not** create a candidate worktree or evidence directory, and it does not authorize npm registry access.

```bash
set -euo pipefail

REPO="/Users/njx/openclaw/copilot.wt-S15C"
SOURCE_COMMIT="<EXACT_FINAL_40_HEX_PR14_HEAD>"
AUTHORITY_PATH="docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
BOOTSTRAP_PATH="scripts/candidate-r30/minimax-authority.mjs"
BOOTSTRAP_ROOT="$(mktemp -d /tmp/copilot-r31-authority.XXXXXX)"
BOOTSTRAP_SCRIPT="$BOOTSTRAP_ROOT/minimax-authority.mjs"
AUTHORITY_COPY="$BOOTSTRAP_ROOT/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
AUTHORITY_RECEIPT="$BOOTSTRAP_ROOT/deployment-authority.json"

case "$SOURCE_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "BLOCKED: SOURCE_COMMIT must be exactly 40 lower-case hex characters" >&2; exit 2 ;;
esac

test -d "$REPO" || {
  echo "BLOCKED_DEPLOYMENT_AUTHORITY_REPOSITORY: $REPO" >&2
  exit 2
}
git -C "$REPO" rev-parse --is-inside-work-tree | grep -qx true

# Explicit source synchronization only. This is not npm/registry authority.
git -C "$REPO" fetch --no-tags --prune origin refs/pull/14/head
FETCHED_COMMIT="$(git -C "$REPO" rev-parse FETCH_HEAD)"
test "$FETCHED_COMMIT" = "$SOURCE_COMMIT" || {
  echo "BLOCKED_PR_HEAD_MISMATCH: expected=$SOURCE_COMMIT fetched=$FETCHED_COMMIT" >&2
  exit 2
}

git -C "$REPO" cat-file -e "${SOURCE_COMMIT}^{commit}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${AUTHORITY_PATH}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${BOOTSTRAP_PATH}"

git -C "$REPO" show "${SOURCE_COMMIT}:${BOOTSTRAP_PATH}" > "$BOOTSTRAP_SCRIPT"
node "$BOOTSTRAP_SCRIPT" \
  --repository "$REPO" \
  --source-commit "$SOURCE_COMMIT" \
  --authority-output "$AUTHORITY_COPY" \
  --receipt-output "$AUTHORITY_RECEIPT"

python3 -m json.tool "$AUTHORITY_RECEIPT" >/dev/null
grep -q '"status": "PASS"' "$AUTHORITY_RECEIPT"
grep -q '"executionAuthority": "git-object-at-exact-commit"' "$AUTHORITY_RECEIPT"
grep -q '"networkUsed": false' "$AUTHORITY_RECEIPT"
grep -q '"worktreeCreated": false' "$AUTHORITY_RECEIPT"
grep -q '"evidenceCreated": false' "$AUTHORITY_RECEIPT"
grep -q 'MiniMax Code Local Deployment' "$AUTHORITY_COPY"

echo "Authority verified from exact Git object:"
cat "$AUTHORITY_RECEIPT"
```

Stop with the exact emitted blocker when:

- `BLOCKED_EXACT_COMMIT_NOT_FETCHED`
- `BLOCKED_DEPLOYMENT_AUTHORITY_MISSING`
- `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`
- `BLOCKED_DEPLOYMENT_RUNNER_MISSING`
- `BLOCKED_PR_HEAD_MISMATCH`

Do not substitute the current worktree copy, a chat transcript, or a locally reconstructed document.

## 1. Set Candidate Inputs

Use the same verified `REPO` and `SOURCE_COMMIT`. The worktree and evidence paths must be new for this run.

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKTREE="$HOME/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}"
EVIDENCE="$HOME/copilot-evidence/copilot-r30-${SOURCE_COMMIT}-${RUN_STAMP}"

printf '%s\n' \
  "repo=$REPO" \
  "source_commit=$SOURCE_COMMIT" \
  "authority_copy=$AUTHORITY_COPY" \
  "authority_receipt=$AUTHORITY_RECEIPT" \
  "planned_worktree=$WORKTREE" \
  "planned_evidence=$EVIDENCE"
```

## 2. Read-Only Reuse Inventory

Record what already exists before creating the candidate. Reuse valid tools and npm/Electron/native caches only. Do not reuse old evidence or candidate identity.

```bash
git -C "$REPO" worktree list --porcelain
node --version || true
npm --version || true
command -v node || true
command -v npm || true
/usr/bin/python3 --version || true
test -x /usr/bin/sandbox-exec && echo "sandbox-exec=present"

npm config get cache || true
ls -ld "$HOME/.npm" 2>/dev/null || true
find "$HOME" -maxdepth 3 -type f \
  \( -name 'CANDIDATE-MANIFEST.json' -o -name 'R30-COMPLETE.json' -o -name 'R30-BLOCKED.json' \) \
  -print 2>/dev/null | head -200 || true
```

Classify discovered assets as:

- `REUSE`: toolchain or cache usable without changing source or candidate identity.
- `REFERENCE_ONLY`: historical command, diagnosis, or directory structure.
- `REBUILD_REQUIRED`: every source snapshot, artifact, runtime identity, screenshot, performance record, manifest, and candidate-bound receipt.

## 3. Create A Clean Detached Worktree

```bash
test ! -e "$WORKTREE"
test ! -e "$EVIDENCE"

git -C "$REPO" worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"
cd "$WORKTREE"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git branch --show-current)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

test -f "$AUTHORITY_PATH"
test -f "$BOOTSTRAP_PATH"
shasum -a 256 "$AUTHORITY_PATH" "$AUTHORITY_COPY"
test "$(shasum -a 256 "$AUTHORITY_PATH" | awk '{print $1}')" = \
  "$(shasum -a 256 "$AUTHORITY_COPY" | awk '{print $1}')"
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

This must pass before dry-run or candidate execution. It includes the exact-Git-object deployment-authority contract.

## 7. Dry-Run The Exact Plan

Dry-run is planning only. It must not create the candidate evidence directory or launch Electron.

```bash
DRY_RUN_LOG="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-dry-run.json"

node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE" \
  --dry-run | tee "$DRY_RUN_LOG"

grep -q 'PLAN_ONLY_NOT_A_CANDIDATE' "$DRY_RUN_LOG"
grep -q 'MVP_NOT_COMPLETE' "$DRY_RUN_LOG"
grep -q 'macos-arm64-only' "$DRY_RUN_LOG"
test ! -e "$EVIDENCE"
```

## 8. Execute The Candidate Once

```bash
EXECUTION_LOG="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-execute.log"

set +e
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE" \
  2>&1 | tee "$EXECUTION_LOG"
RUN_STATUS="${PIPESTATUS[0]}"
set -e

printf 'candidate_runner_exit=%s\n' "$RUN_STATUS"
```

Do not rerun against the same evidence directory. The runner creates it exclusively.

## 9. Success Verification

Only execute this block when `RUN_STATUS=0`.

```bash
test "$RUN_STATUS" -eq 0
test -f "$EVIDENCE/CANDIDATE-MANIFEST.json"
test -f "$EVIDENCE/R30-COMPLETE.json"
test ! -f "$EVIDENCE/R30-BLOCKED.json"

test -f "$EVIDENCE/gates/gate-03-sha256-ledger.json"
test -f "$EVIDENCE/gates/gate-05-sbom.json"
test -f "$EVIDENCE/gates/gate-06-canonical-release.json"
test -f "$EVIDENCE/gates/gate-07-artifact-identity.json"
test -f "$EVIDENCE/gates/gate-08-focused-electron.json"
test -f "$EVIDENCE/gates/gate-09-discovery.json"
test -f "$EVIDENCE/gates/gate-10-full-electron.json"
test -f "$EVIDENCE/gates/gate-11-performance.json"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

RETURN_HASHES="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-evidence-sha256.txt"
find "$EVIDENCE" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort > "$RETURN_HASHES"

shasum -a 256 \
  "$EVIDENCE/CANDIDATE-MANIFEST.json" \
  "$EVIDENCE/R30-COMPLETE.json"
```

## 10. Blocker Handling

The runner exits `2` for a fail-closed blocker and writes `R30-BLOCKED.json` only after it owns the new evidence directory.

```bash
if test "$RUN_STATUS" -eq 2; then
  test -f "$EVIDENCE/R30-BLOCKED.json"
  python3 -m json.tool "$EVIDENCE/R30-BLOCKED.json"
  git rev-parse HEAD
  git status --porcelain=v1 --untracked-files=all
  exit 2
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

For any other blocker, return the exact blocker code, gate, detail, command receipt, stdout/stderr logs, source commit, authority receipt, evidence path, and final Git status. Do not conceal or repair it locally.

## 11. Required Return Package

Return to the parent PM:

1. `SOURCE_COMMIT`, fetched PR HEAD equality, detached HEAD proof, worktree path, evidence path, and clean final Git status.
2. Exact-Git-object deployment-authority receipt and authority-document SHA256.
3. Gate 3 ledger path/SHA256, aggregate SHA256, scope, and file count.
4. Canonical manifest, release identity, canonical snapshot, and authoritative source-input manifest.
5. CycloneDX SBOM path/SHA256 and root/component counts.
6. ZIP, DMG, `.app`, executable, and `app.asar` paths/SHA256.
7. Focused packaged Electron 2/2 receipt.
8. Exact discovery `113 tests in 9 files` receipt.
9. Full packaged Electron 113/113 receipt with zero skipped/unexpected/flaky and clean process exit.
10. Complete `SYNTHETIC_E2E_FIXTURE_ONLY` source manifest and content aggregate SHA256.
11. Three raw `r31-v1` performance files, aggregate, hashes, threshold results, and candidate binding.
12. Runtime ID and runtime identity.
13. Commands/exit codes and stdout/stderr logs.
14. Screenshot list and SHA256 values.
15. Process terminal state.
16. `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json` with their SHA256 values.

Only after this package is complete may Codex begin independent real-computer acceptance.
