# MiniMax Code Local Deployment — R31 Exact-Commit Handoff

Status before execution: `BLOCKED / MVP_NOT_COMPLETE / LOCAL_CANDIDATE_NOT_RUN`.

This document is executable guidance for MiniMax Code. It does not authorize source changes. Obtain the exact final 40-character PR #14 HEAD from the owner-facing handoff or PR conversation after the final GitHub source gate succeeds.

## Non-Negotiable Rules

- Use the exact supplied commit SHA, not `main`, not the current checkout, not the branch tip, and not a shortened SHA.
- The deployment authority is the file stored in the **exact Git commit object**. Absence from a stale checkout is not proof that the exact commit lacks the file.
- Fetch and compare PR #14 HEAD before reading authority. Never search only the current worktree and infer `MISSING_DEPLOYMENT_AUTHORITY`.
- Create a dedicated clean detached cache-hydration worktree and a separate clean detached candidate worktree.
- Use a new isolated npm cache, a new exclusive hydration receipt, and a new absolute candidate evidence directory outside the repository. None may already exist, including through symlink aliases.
- Do not run R28.
- Do not edit source, tests, the candidate runner, the cache hydrator, workflow, package files, or governance.
- Do not delete stale candidate inputs in place and continue; create another clean worktree.
- Do not reuse a prior cache receipt, candidate ID, artifact/runtime identity, screenshot, performance record, manifest, or evidence directory.
- Do not retry online automatically.
- The only permitted dependency-network operation is one owner-authorized run of `scripts/candidate-r30/npm-cache-hydrate.mjs` with the exact token `OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS`.
- Cache hydration disables lifecycle scripts, confines the npm child to a localhost CONNECT proxy, and allows that proxy to connect only to `registry.npmjs.org:443`.
- The cache hydrator must complete a deny-network `npm ci --ignore-scripts --offline` probe and emit an exact source/lock/cache-bound receipt before candidate execution.
- The candidate itself always remains under `sandbox-exec` with `(deny network*)` and performs `npm ci --offline`; the hydration receipt does not authorize candidate egress.
- A passing run is an unsigned diagnostic candidate, not MVP completion or Release.
- A cron/file-presence probe is not execution authority and must never auto-run the candidate.

## 0. Bootstrap Authority From The Exact Git Object

This step performs one explicit GitHub source fetch, verifies the externally supplied SHA, and reads the authority/bootstrap files directly from that commit. It creates no worktree, cache, candidate, or evidence and grants no npm registry authority.

```bash
set -euo pipefail

REPO="/Users/njx/openclaw/copilot.wt-S15C"
SOURCE_COMMIT="<EXACT_FINAL_40_HEX_PR14_HEAD>"
AUTHORITY_PATH="docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
BOOTSTRAP_PATH="scripts/candidate-r30/minimax-authority.mjs"
HYDRATOR_PATH="scripts/candidate-r30/npm-cache-hydrate.mjs"
RUNNER_PATH="scripts/candidate-r30/run-candidate.mjs"
BOOTSTRAP_ROOT="$(mktemp -d /tmp/copilot-r31-authority.XXXXXX)"
BOOTSTRAP_SCRIPT="$BOOTSTRAP_ROOT/minimax-authority.mjs"
AUTHORITY_COPY="$BOOTSTRAP_ROOT/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
AUTHORITY_RECEIPT="$BOOTSTRAP_ROOT/deployment-authority.json"

case "$SOURCE_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "BLOCKED: SOURCE_COMMIT must be exactly 40 lower-case hex characters" >&2; exit 2 ;;
esac

test -d "$REPO" || {
  echo "BLOCKED_DEPLOYMENT_AUTHORITY_REPOSITORY: $REPO" >&2
  exit 2
}
git -C "$REPO" rev-parse --is-inside-work-tree | grep -qx true

git -C "$REPO" fetch --no-tags --prune origin refs/pull/14/head
FETCHED_COMMIT="$(git -C "$REPO" rev-parse FETCH_HEAD)"
test "$FETCHED_COMMIT" = "$SOURCE_COMMIT" || {
  echo "BLOCKED_PR_HEAD_MISMATCH: expected=$SOURCE_COMMIT fetched=$FETCHED_COMMIT" >&2
  exit 2
}

git -C "$REPO" cat-file -e "${SOURCE_COMMIT}^{commit}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${AUTHORITY_PATH}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${BOOTSTRAP_PATH}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${HYDRATOR_PATH}"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${RUNNER_PATH}"

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
grep -q 'npm-cache-hydrate.mjs' "$AUTHORITY_COPY"

cat "$AUTHORITY_RECEIPT"
```

Stop with the exact emitted blocker when:

- `BLOCKED_EXACT_COMMIT_NOT_FETCHED`
- `BLOCKED_DEPLOYMENT_AUTHORITY_MISSING`
- `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`
- `BLOCKED_DEPLOYMENT_RUNNER_MISSING`
- `BLOCKED_PR_HEAD_MISMATCH`

Do not substitute the current worktree copy, a chat transcript, or a locally reconstructed document.

## 1. Set New Run Inputs

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HYDRATION_WORKTREE="$HOME/copilot-r31-cache-${SOURCE_COMMIT:0:12}-${RUN_STAMP}"
NPM_CACHE_DIR="$HOME/copilot-cache/copilot-r31-${SOURCE_COMMIT}-${RUN_STAMP}"
NPM_CACHE_RECEIPT="$HOME/copilot-cache-receipts/copilot-r31-${SOURCE_COMMIT}-${RUN_STAMP}.json"
WORKTREE="$HOME/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}"
EVIDENCE="$HOME/copilot-evidence/copilot-r30-${SOURCE_COMMIT}-${RUN_STAMP}"

printf '%s\n' \
  "repo=$REPO" \
  "source_commit=$SOURCE_COMMIT" \
  "authority_copy=$AUTHORITY_COPY" \
  "authority_receipt=$AUTHORITY_RECEIPT" \
  "hydration_worktree=$HYDRATION_WORKTREE" \
  "npm_cache_dir=$NPM_CACHE_DIR" \
  "npm_cache_receipt=$NPM_CACHE_RECEIPT" \
  "candidate_worktree=$WORKTREE" \
  "candidate_evidence=$EVIDENCE"
```

Every path above must be new. The prior failed worktree/evidence and `/tmp` probes are `REFERENCE_ONLY` and must not be reused.

## 2. Read-Only Reuse Inventory

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

- `REUSE`: installed toolchain or platform caches that do not define candidate identity.
- `REFERENCE_ONLY`: historical commands, diagnoses, worktrees, evidence, or directory structure.
- `REBUILD_REQUIRED`: the isolated npm cache/receipt and every source snapshot, artifact, runtime identity, screenshot, performance record, manifest, and candidate-bound receipt.

## 3. Owner-Approved Registry-Only Cache Hydration

This is the only online dependency operation. It is separate from candidate execution.

```bash
test ! -e "$HYDRATION_WORKTREE"
test ! -e "$NPM_CACHE_DIR"
test ! -e "$NPM_CACHE_RECEIPT"

git -C "$REPO" worktree add --detach "$HYDRATION_WORKTREE" "$SOURCE_COMMIT"
cd "$HYDRATION_WORKTREE"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git branch --show-current)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test -f "$HYDRATOR_PATH"

node --test \
  scripts/candidate-r30/npm-cache-hydrate.test.mjs \
  scripts/candidate-r30/runner.test.mjs \
  scripts/candidate-r30/contract.test.mjs

node "$HYDRATOR_PATH" \
  --repository "$HYDRATION_WORKTREE" \
  --source-commit "$SOURCE_COMMIT" \
  --cache-dir "$NPM_CACHE_DIR" \
  --receipt-output "$NPM_CACHE_RECEIPT" \
  --owner-authority OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS

python3 -m json.tool "$NPM_CACHE_RECEIPT" >/dev/null
grep -q '"status": "PASS"' "$NPM_CACHE_RECEIPT"
grep -q '"ownerAuthority": "OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS"' "$NPM_CACHE_RECEIPT"
grep -q '"allowedHost": "registry.npmjs.org"' "$NPM_CACHE_RECEIPT"
grep -q '"allowedPort": 443' "$NPM_CACHE_RECEIPT"
grep -q '"allRequestsAllowed": true' "$NPM_CACHE_RECEIPT"
grep -q '"lifecycleScriptsDisabled": true' "$NPM_CACHE_RECEIPT"
grep -q '"offlineProbe"' "$NPM_CACHE_RECEIPT"
grep -q '"networkAuthority": "deny-network"' "$NPM_CACHE_RECEIPT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Hydration guarantees:

- exact clean detached commit;
- lockfile version/origin validation;
- no repository `.npmrc`;
- stripped proxy, registry, token, and user-config inheritance;
- lifecycle scripts disabled;
- npm child sandboxed to a localhost CONNECT proxy only;
- proxy permits only `registry.npmjs.org:443`;
- online command uses explicit canonical registry and `--replace-registry-host=always`;
- isolated cache is hashed as an all-regular-file ledger;
- a second `npm ci --ignore-scripts --offline` runs under `(deny network*)`;
- receipt is bound to exact commit, package-lock SHA256, cache path, cache aggregate SHA256, npm executable/version, commands, logs, and proxy audit;
- no candidate or candidate evidence is created.

Any hydration blocker stops the run. Do not broaden the host allowlist, enable lifecycle scripts, reuse the partial cache/receipt, or perform an unrecorded retry.

## 4. Create A Separate Clean Candidate Worktree

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
test -f "$HYDRATOR_PATH"
test -f "$RUNNER_PATH"
shasum -a 256 "$AUTHORITY_PATH" "$AUTHORITY_COPY"
test "$(shasum -a 256 "$AUTHORITY_PATH" | awk '{print $1}')" = \
  "$(shasum -a 256 "$AUTHORITY_COPY" | awk '{print $1}')"
```

Do not switch this detached worktree to a branch.

## 5. Verify Toolchain And Sandbox

```bash
node --version | grep -E '^v24\.'
npm --version
/usr/bin/python3 --version
/usr/bin/python3 -c 'import distutils; print(distutils.__file__)'
test -x /usr/bin/sandbox-exec
command -v npm | grep '^/'
```

## 6. Verify Governed Generated Inputs Are Absent

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

If this fails, abandon this candidate worktree and create another one. Do not clean stale inputs in place.

## 7. Run Candidate Source Contracts

```bash
node --test scripts/candidate-r30/*.test.mjs
```

This must pass, including the real authority document, cache hydrator, lock-origin policy, proxy profile, cache receipt binding, and paired runner arguments.

## 8. Dry-Run The Receipt-Bound Offline Plan

```bash
DRY_RUN_LOG="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-dry-run.json"

node "$RUNNER_PATH" \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE" \
  --npm-cache-dir "$NPM_CACHE_DIR" \
  --npm-cache-receipt "$NPM_CACHE_RECEIPT" \
  --dry-run | tee "$DRY_RUN_LOG"

grep -q 'PLAN_ONLY_NOT_A_CANDIDATE' "$DRY_RUN_LOG"
grep -q 'MVP_NOT_COMPLETE' "$DRY_RUN_LOG"
grep -q 'macos-arm64-only' "$DRY_RUN_LOG"
grep -q 'offline-only-after-exact-receipt-validation' "$DRY_RUN_LOG"
test ! -e "$EVIDENCE"
```

Dry-run creates no evidence and launches no Electron process.

## 9. Execute The Candidate Exactly Once

```bash
EXECUTION_LOG="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-execute.log"

set +e
node "$RUNNER_PATH" \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE" \
  --npm-cache-dir "$NPM_CACHE_DIR" \
  --npm-cache-receipt "$NPM_CACHE_RECEIPT" \
  2>&1 | tee "$EXECUTION_LOG"
RUN_STATUS="${PIPESTATUS[0]}"
set -e

printf 'candidate_runner_exit=%s\n' "$RUN_STATUS"
```

The runner validates the receipt/source/lock/cache identity before Gate 2. Gate 2 still invokes `npm ci --offline` under `(deny network*)`. No candidate online fallback exists.

Do not rerun against the same evidence directory.

## 10. Success Verification

Only execute when `RUN_STATUS=0`.

```bash
test "$RUN_STATUS" -eq 0
test -f "$EVIDENCE/CANDIDATE-MANIFEST.json"
test -f "$EVIDENCE/R30-COMPLETE.json"
test ! -f "$EVIDENCE/R30-BLOCKED.json"

test -f "$EVIDENCE/gates/gate-02-network.json"
test -f "$EVIDENCE/gates/gate-03-sha256-ledger.json"
test -f "$EVIDENCE/gates/gate-05-sbom.json"
test -f "$EVIDENCE/gates/gate-06-canonical-release.json"
test -f "$EVIDENCE/gates/gate-07-artifact-identity.json"
test -f "$EVIDENCE/gates/gate-08-focused-electron.json"
test -f "$EVIDENCE/gates/gate-09-discovery.json"
test -f "$EVIDENCE/gates/gate-10-full-electron.json"
test -f "$EVIDENCE/gates/gate-11-performance.json"

grep -q '"candidateNetworkUsed": false' "$EVIDENCE/gates/gate-02-network.json"
grep -q '"receiptSha256"' "$EVIDENCE/gates/gate-02-network.json"
grep -q '"cacheAggregateSha256"' "$EVIDENCE/gates/gate-02-network.json"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

RETURN_HASHES="/tmp/copilot-r31-${SOURCE_COMMIT:0:12}-${RUN_STAMP}-evidence-sha256.txt"
find "$EVIDENCE" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort > "$RETURN_HASHES"

shasum -a 256 \
  "$NPM_CACHE_RECEIPT" \
  "$EVIDENCE/CANDIDATE-MANIFEST.json" \
  "$EVIDENCE/R30-COMPLETE.json"
```

## 11. Blocker Handling And Required Return Package

When `RUN_STATUS=2`:

```bash
test -f "$EVIDENCE/R30-BLOCKED.json"
python3 -m json.tool "$EVIDENCE/R30-BLOCKED.json"
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
exit 2
```

Stable cache blockers include:

- `BLOCKED_NPM_CACHE_HYDRATION_*`: owner-approved hydration did not complete; no candidate should run.
- `BLOCKED_NPM_CACHE_RECEIPT_*`: source, lockfile, receipt, path, or cache bytes do not match.
- `BLOCKED_NPM_APPROVED_CACHE_INCOMPLETE`: the exact receipt-bound cache still cannot satisfy candidate `npm ci --offline`.
- `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`: no approved receipt was supplied and existing local cache is incomplete.

For every blocker, stop and return the exact code, gate, detail, commands, exit codes, logs, source commit, authority receipt, hydration receipt or non-generation reason, cache/worktree/evidence paths, and final Git status. Do not repair locally or retry against the same paths.

For success, return:

1. `SOURCE_COMMIT`, fetched PR HEAD equality, both detached worktree proofs, paths, and clean final Git status.
2. Exact-object deployment authority receipt and authority SHA256.
3. Owner token, hydration receipt/SHA256, package-lock SHA256, proxy audit, npm identity, isolated cache path/scope/file count/bytes/aggregate SHA256, online/offline command receipts and logs.
4. Gate 2 receipt proving candidate `networkAuthority=offline-only` and `candidateNetworkUsed=false`.
5. Gate 3 ledger path/SHA256, aggregate SHA256, scope, and file count.
6. Canonical manifest, release identity, canonical snapshot, and source-input manifest.
7. CycloneDX SBOM path/SHA256 and root/component counts.
8. ZIP, DMG, `.app`, executable, and `app.asar` paths/SHA256.
9. Focused packaged Electron 2/2.
10. Exact discovery `113 tests in 9 files`.
11. Full packaged Electron 113/113 with zero skipped/unexpected/flaky and clean process exit.
12. Complete `SYNTHETIC_E2E_FIXTURE_ONLY` manifest and aggregate SHA256.
13. Three raw `r31-v1` performance files, aggregate, hashes, thresholds, and candidate binding.
14. Runtime ID and runtime identity.
15. All commands/exit codes/stdout/stderr logs.
16. Screenshot list and SHA256 values.
17. Process terminal state.
18. `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json` with SHA256 values.

Only after this complete package exists may Codex begin independent real-computer acceptance.
