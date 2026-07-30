# Changelog

## 2026-07-30 — R30 GitHub-Bound Candidate Runner

Status remains `BLOCKED / MVP_NOT_COMPLETE`.

- Reconciled all six low-confidence `main` handoff documents. `docs/ARCHITECTURE.md` now routes to the byte-preserved detailed architecture at `docs/history/ARCHITECTURE_PRE_R30.md`; generic placeholders cannot override root v6.2 truth.
- Added a brand-new R30 successor. R28 remains `NEVER_RUN / PERMANENTLY_REJECTED` and is not copied, repaired, executed, or reused.
- Gate 1 binds the full GitHub commit, clean tracked/untracked state, absence of stale ignored build/test outputs, and a new realpath-validated evidence directory outside the repository.
- Gate 2 uses macOS `sandbox-exec` with `(deny network*)`, strips proxy/registry authority, and permits only `npm ci --offline --no-audit --no-fund`. Cache miss stops for separate approval; no online retry exists.
- Gate 3 computes a complete regular-file control ledger with real exact 64-character lower-case SHA256 values and rejects missing, duplicate, unknown, 63-character, symlinked, or nonregular entries.
- Gate 9 requires exactly `113 tests in 9 files`; broad `>=50` acceptance is rejected. Gate 10 subsequently requires exact 113/113 with zero skipped/unexpected/flaky and clean process exit.
- RED→GREEN evidence: initial contract, runner, and documentation tests each failed before implementation; final pure Node suite is 23/23 PASS, all five runtime modules pass `node --check`, JSON/YAML validation passes, and dry-run returns `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- No npm install, product build, package, Electron candidate, network access, signing, notarization, independent Codex acceptance, Release, or Human Owner Gate was executed by ChatGPT.

Rollback: revert the bounded R30 PR. No database migration, product feature rewrite, dependency major upgrade, local runtime, or external deployment was created by this remote source work.

## Preserved history

The complete pre-R30 changelog from `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd` is preserved byte-for-byte at [`docs/history/CHANGELOG_PRE_R30.md`](docs/history/CHANGELOG_PRE_R30.md).
