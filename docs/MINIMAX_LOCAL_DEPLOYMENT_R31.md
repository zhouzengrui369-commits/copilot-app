# MiniMax Code Local Deployment — Exact-Commit Native-Cache Handoff

Status before execution: `BLOCKED / MVP_NOT_COMPLETE / LOCAL_CANDIDATE_NOT_RUN`.

This document is executable guidance for MiniMax Code. It authorizes no source repair, no PR merge, no signing, no notarization, and no cloud or global-configuration change. Use the exact supplied commit SHA from the owner-facing handoff after the final GitHub source gate succeeds.

## 1. Non-negotiable truth

- GitHub source, CI, a package command, a browser fixture, or an unsigned artifact is not Electron runtime acceptance.
- The candidate must use one externally supplied full 40-character `EXACT_FINAL_HEAD`.
- The current branch tip, `main`, a stale worktree, a prior candidate, or an earlier PR head is not authority.
- The deployment authority is read from the exact Git object.
- A dirty or untracked source tree is invalid.
- The candidate remains under `(deny network*)` for every Gate 1–12 command.
- One separate owner-approved hydration may access only the exact official allowlist defined in `scripts/candidate-r30/native-cache-policy.mjs`.
- Hydration and candidate execution use separate clean detached worktrees.
- Every cache, receipt, evidence directory, candidate identity, screenshot, artifact identity, and runtime ID must be new.
- Do not retry online. Stop on the first fail-closed blocker.
- Do not run R28 or reuse an old R30/R31 worktree, cache, receipt, evidence directory, artifact, runtime ID, or screenshot.
- A successful run remains an unsigned diagnostic candidate and does not prove MVP completion.

The historical blocker token `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED` remains documented for audit compatibility. The active successor requires a native-toolchain receipt and fails with `BLOCKED_NATIVE_CACHE_RECEIPT_REQUIRED`, `BLOCKED_NATIVE_CACHE_INCOMPLETE`, or another exact native-cache blocker when the new proof is absent or invalid.

## 2. Exact-object bootstrap

Receive these values from the final PR conversation:

```bash
set -euo pipefail

REPO="<ABSOLUTE_EXISTING_COPILOT_REPOSITORY>"
PR_NUMBER="<OPEN_DRAFT_PR_NUMBER>"
EXACT_FINAL_HEAD="<EXACT_FINAL_40_HEX_HEAD>"
SOURCE_COMMIT="$EXACT_FINAL_HEAD"

AUTHORITY_PATH="docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
BOOTSTRAP_PATH="scripts/candidate-r30/minimax-authority.mjs"
HYDRATOR_PATH="scripts/candidate-r30/npm-native-cache-hydrate.mjs"
RUNNER_PATH="scripts/candidate-r30/run-candidate.mjs"
BOOTSTRAP_ROOT="$(mktemp -d /tmp/copilot-authority.XXXXXX)"
BOOTSTRAP_SCRIPT="$BOOTSTRAP_ROOT/minimax-authority.mjs"
AUTHORITY_COPY="$BOOTSTRAP_ROOT/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
AUTHORITY_RECEIPT="$BOOTSTRAP_ROOT/deployment-authority.json"
```

Validate the inputs and fetch the exact PR object:

```bash
case "$SOURCE_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "BLOCKED: EXACT_FINAL_HEAD must be exactly 40 lower-case hex characters" >&2; exit 2 ;;
esac

case "$PR_NUMBER" in
  ''|*[!0-9]*) echo "BLOCKED: PR_NUMBER must be a positive integer" >&2; exit 2 ;;
esac

test -d "$REPO"
git -C "$REPO" rev-parse --is-inside-work-tree | grep -qx true

git -C "$REPO" fetch --no-tags --prune origin "refs/pull/${PR_NUMBER}/head"
FETCHED_COMMIT="$(git -C "$REPO" rev-parse FETCH_HEAD)"
test "$FETCHED_COMMIT" = "$SOURCE_COMMIT" || {
  echo "BLOCKED_PR_HEAD_MISMATCH: expected=$SOURCE_COMMIT fetched=$FETCHED_COMMIT" >&2
  exit 2
}

for path in "$AUTHORITY_PATH" "$BOOTSTRAP_PATH" "$HYDRATOR_PATH" "$RUNNER_PATH"; do
  git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:${path}"
done

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
```

Absence from a stale checkout is not proof that the exact Git object lacks authority. Stop on `BLOCKED_EXACT_COMMIT_NOT_FETCHED`, `BLOCKED_DEPLOYMENT_AUTHORITY_MISSING`, `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`, `BLOCKED_DEPLOYMENT_RUNNER_MISSING`, or `BLOCKED_PR_HEAD_MISMATCH`.

## 3. New paths only

```bash
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HYDRATION_WORKTREE="$HOME/copilot-native-cache-${SOURCE_COMMIT:0:12}-${RUN_STAMP}"
NATIVE_CACHE_DIR="$HOME/copilot-native-cache/${SOURCE_COMMIT}-${RUN_STAMP}"
NATIVE_CACHE_RECEIPT="$HOME/copilot-native-cache-receipts/${SOURCE_COMMIT}-${RUN_STAMP}.json"
CANDIDATE_WORKTREE="$HOME/copilot-candidate-${SOURCE_COMMIT:0:12}-${RUN_STAMP}"
EVIDENCE_DIR="$HOME/copilot-evidence/${SOURCE_COMMIT}-${RUN_STAMP}"

for path in \
  "$HYDRATION_WORKTREE" \
  "$NATIVE_CACHE_DIR" \
  "$NATIVE_CACHE_RECEIPT" \
  "$CANDIDATE_WORKTREE" \
  "$EVIDENCE_DIR"
do
  test ! -e "$path" || {
    echo "BLOCKED_NEW_PATH_ALREADY_EXISTS: $path" >&2
    exit 2
  }
done
```

The cache root contains receipt-bound npm, Electron, electron-builder, node-gyp/header, and prebuild surfaces. It must remain outside the repository.

## 4. Owner-approved bounded native-toolchain hydration

The required exact owner authority token is:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

This is broader than the retired registry-only token but remains bounded. The source allowlist contains only official npm, Node, Electron, and GitHub release-asset hosts. All child processes run inside a sandbox that permits only a localhost CONNECT proxy. The proxy rejects any host outside the source allowlist and records every CONNECT request. Inherited npm configs, registry, proxy authority, GitHub tokens, Electron mirrors, dist URLs, and native-build overrides are stripped.

Create the clean hydration worktree and run the source contracts:

```bash
git -C "$REPO" worktree add --detach "$HYDRATION_WORKTREE" "$SOURCE_COMMIT"
cd "$HYDRATION_WORKTREE"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git branch --show-current)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

node --test scripts/candidate-r30/*.test.mjs
```

Execute the hydration once:

```bash
node scripts/candidate-r30/npm-native-cache-hydrate.mjs \
  --repository "$HYDRATION_WORKTREE" \
  --source-commit "$SOURCE_COMMIT" \
  --cache-dir "$NATIVE_CACHE_DIR" \
  --receipt-output "$NATIVE_CACHE_RECEIPT" \
  --owner-authority OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The hydrator must prove all of the following before emitting a PASS receipt:

1. the source is exact, detached, clean, and has no repository `.npmrc`;
2. the package-lock install-script package set exactly matches the reviewed source set;
3. the online lifecycle install runs only through the allowlisted CONNECT proxy;
4. lifecycle scripts are enabled and `better-sqlite3` is built from source;
5. Node and Electron headers, Electron distributions, and builder caches are stored under the new cache root;
6. an Electron 38 arm64 `better-sqlite3` rebuild succeeds;
7. all installed `node_modules` trees are removed;
8. a second full `npm ci --offline` with lifecycle scripts succeeds under `(deny network*)`;
9. a second Electron arm64 native rebuild succeeds under `(deny network*)` using the exact receipt-bound `npm_config_nodedir`;
10. the desktop Electron executable is restored from cache;
11. all `node_modules` trees are removed again and Git status is clean;
12. every regular cache file and the aggregate cache identity are hashed.

Validate the receipt:

```bash
python3 -m json.tool "$NATIVE_CACHE_RECEIPT" >/dev/null
grep -q '"status": "PASS"' "$NATIVE_CACHE_RECEIPT"
grep -q '"ownerAuthority": "OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION"' "$NATIVE_CACHE_RECEIPT"
grep -q '"lifecycleScriptsEnabled": true' "$NATIVE_CACHE_RECEIPT"
grep -q '"candidateInstallMode": "offline-lifecycle-scripts-enabled"' "$NATIVE_CACHE_RECEIPT"
grep -q '"offlineInstallProof"' "$NATIVE_CACHE_RECEIPT"
grep -q '"offlineNativeProof"' "$NATIVE_CACHE_RECEIPT"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Do not broaden the host allowlist, enable an unrecorded mirror, reuse a partial cache, or perform a second online attempt. Do not retry online.

## 5. Candidate worktree and dry-run

```bash
git -C "$REPO" worktree add --detach "$CANDIDATE_WORKTREE" "$SOURCE_COMMIT"
cd "$CANDIDATE_WORKTREE"

test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
test -z "$(git branch --show-current)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

test "$(shasum -a 256 "$AUTHORITY_PATH" | awk '{print $1}')" = \
  "$(shasum -a 256 "$AUTHORITY_COPY" | awk '{print $1}')"

node --test scripts/candidate-r30/*.test.mjs

node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE_DIR" \
  --npm-cache-dir "$NATIVE_CACHE_DIR" \
  --npm-cache-receipt "$NATIVE_CACHE_RECEIPT" \
  --dry-run
```

Dry-run must report `PLAN_ONLY_NOT_A_CANDIDATE` and `MVP_NOT_COMPLETE`, create no evidence directory, and launch no Electron process.

## 6. Candidate execution exactly once

```bash
set +e
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit "$SOURCE_COMMIT" \
  --evidence-dir "$EVIDENCE_DIR" \
  --npm-cache-dir "$NATIVE_CACHE_DIR" \
  --npm-cache-receipt "$NATIVE_CACHE_RECEIPT"
RUN_STATUS="$?"
set -e
printf 'candidate_runner_exit=%s\n' "$RUN_STATUS"
```

The candidate runner revalidates the receipt and all cache bytes before Gate 2. Gate 2 then performs a full lifecycle `npm ci --offline` under `(deny network*)`, redirects npm logs to evidence, and revalidates the cache identity after install. Subsequent native staging receives only the exact receipt-bound Electron headers. No candidate command receives online authority.

Stop at the first blocker. Do not edit source, tests, runner, workflow, package files, lockfile, or governance. Do not rerun the candidate against the same or a different cache without a new reviewed GitHub source task and explicit Owner authority.

## 7. Twelve candidate gates

The candidate still owns the complete ordered contract:

1. exact source and clean preimage;
2. receipt-bound full lifecycle install under deny-network;
3. complete SHA-256 ledger for all tracked regular files;
4. candidate source contracts and ordered LLM → KB → KG → RAG build;
5. checks, tests, integration, strict coverage, desktop build, Phase 1 suite, and production SBOM;
6. canonical unsigned macOS arm64 authority;
7. source, ZIP, DMG, app, executable, `app.asar`, and native identities;
8. focused packaged Electron tests;
9. exact `113 tests in 9 files` discovery and complete test-data manifest;
10. packaged Electron `113/113` with zero skipped, unexpected, or flaky results and clean termination;
11. three distinct candidate-bound performance runs and aggregate;
12. final receipts, screenshots, hashes, runtime identity, and terminal state.

## 8. Required output package

The evidence package must contain or reference:

```text
PLAN.md
RESULT.md
EVIDENCE.md
commands.log
changed-files.txt
CANDIDATE-MANIFEST.json
R30-COMPLETE.json
```

It must bind the source commit, source snapshot SHA-256, native-cache receipt SHA-256, cache aggregate SHA-256, artifact SHA-256, ZIP/DMG/app/executable/`app.asar` identities, runtime ID, ecosystem baseline commit, deterministic test-data manifest, all commands and exit codes, screenshots and hashes, three performance receipts, and final clean process/Git state.

`changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`. Evidence stays outside the product repository.

## 9. Codex and release boundary

MiniMax technical evidence is not product acceptance. Only after this complete package exists may Codex independently launch and operate the exact same source/artifact/runtime identity on the real Mac. Codex must verify the grounded Ask → source → return → Todo → edit → schedule → quit/relaunch loop and issue a candidate-bound PASS, FAIL, or BLOCKED verdict.

Even if all twelve gates pass, the maximum MiniMax verdict is:

```text
PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
BLOCKED_UNSIGNED_NOT_NOTARIZED
```

MiniMax must not merge the PR, modify `main`, sign, notarize, staple, change credentials, alter cloud resources, update global configuration, or declare `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY`, or `HUMAN_OWNER_GATE_PASS`.
