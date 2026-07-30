# Copilot App Risk Register

**Status: `BLOCKED / MVP_NOT_COMPLETE`.** Authority remains `goal.md`, `plan.md`, `rules.md`, `delivery.md` v6.2 and root `PROJECT_STATE.yaml`.

| ID | Risk | Current control | Residual status |
|---|---|---|---|
| RISK-R28-REUSE | The rejected R28 runner, identity, path, or evidence is accidentally executed or copied. | R28 is `NEVER_RUN / PERMANENTLY_REJECTED`; R30 uses new committed files and deterministic identity. | Open monitoring risk. |
| RISK-NETWORK-AUTHORITY | npm, Electron packaging, tests, or provider code silently reaches the network. | Gate 2 requires macOS `sandbox-exec` with `deny network*`, removes proxy/registry environment authority, and uses `npm ci --offline`. | Cache miss blocks; separate owner approval is required for any future minimal network exception. |
| RISK-NPM-CACHE | Local cache lacks package or Electron bytes. | Fail with `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`; no automatic retry. | Could block MiniMax deployment. |
| RISK-SHA256-LEDGER | A malformed 63-character, missing, duplicate, unknown, symlinked, or stale SHA256 entry promotes an unbound runner. | Gate 3 computes real SHA256 values from an exact regular-file allowlist and validates 64 lower-case hex. | Must be verified in the local run receipt. |
| RISK-TEST-DISCOVERY-DRIFT | A broad `>=50` assertion hides missing or added tests. | Gate 9 requires one exact summary: `113 tests in 9 files`; Gate 10 requires 113/113. | Any legitimate future suite change requires a new reviewed runner contract. |
| RISK-SOURCE-DRIFT | Local deployment differs from the approved GitHub source. | Full 40-hex `--source-commit` must equal `git HEAD`; dirty tracked or untracked state fails. | MiniMax must use a clean checkout. |
| RISK-EVIDENCE-REUSE | Old artifact, runtime ID, screenshots, or test data is attached to a new source. | Evidence directory must be absolute, outside the repo, and nonexistent; candidate ID is commit-derived; receipts bind source/artifact/runtime. | Independent Codex review still required. |
| RISK-FIXTURE-INFLATION | Synthetic E2E fixtures are presented as user/runtime truth. | Test-data manifest labels all E2E material `SYNTHETIC_E2E_FIXTURE_ONLY` and `realUserDataUsed=false`. | Real-computer owner evidence remains separate. |
| RISK-SIGNING | An unsigned diagnostic package is presented as distributable. | R30 manifest explicitly says `UNSIGNED_DIAGNOSTIC_ONLY` and `BLOCKED_UNSIGNED_NOT_NOTARIZED`. | Developer ID, notarization, staple, and validation remain open. |
| RISK-ASR | Source tests are mistaken for embedded local-ASR success. | v6.2 requires same signed/notarized candidate, real offline decode, note persistence, restart readback, and knowledge visibility. | Runtime gate remains blocked. |
| RISK-ROLE-COLLAPSE | MiniMax or Codex silently fixes source during deployment/acceptance. | GitHub source is authoritative; MiniMax deploys exact commit only; Codex accepts/rejects only. | Any defect returns to a new bounded GitHub PR. |
| RISK-SCOPE-CREEP | Windows, Tencent, Remote/live, 3D, or dependency upgrades enter the candidate task. | Current changes are runner/governance only; deferred scope is explicit. | Maintain review discipline. |
| RISK-STALE-GENERATED-PREIMAGE | Ignored `dist/.vite/release/coverage/test-results/playwright-report` bytes contaminate a nominally clean candidate. | Gate 1 requires these paths absent and never silently cleans them. | MiniMax must use a new clean checkout. |
| RISK-EVIDENCE-SYMLINK-ALIAS | A lexically external evidence path resolves through a symlink into the repository or an existing evidence directory is overwritten. | Resolve existing ancestors with `realpath`, reject repository landings, create once, and write blocker receipts only to runner-owned directories. | MiniMax must supply a new absolute outside-repo path. |

No risk entry authorizes `MVP_READY`, signing, notarization, Release, or owner acceptance.
