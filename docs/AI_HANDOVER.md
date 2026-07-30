# Copilot App AI Handover

**Status: `BLOCKED / MVP_NOT_COMPLETE`.** This file is an authoritative mirror and routing index. It is not a replacement for the root v6.2 baseline.

## Documentation Authority

Read in this order before changing code:

1. `AGENTS.md` — repository execution and role boundaries.
2. `goal.md`, `plan.md`, `rules.md`, `delivery.md` v6.2 — owner-approved scope and acceptance authority. The 2026-07-16 MiniMax-first/Tencent-post-MVP amendment and the 2026-07-15 macOS-first amendment override conflicting historical text preserved later in those files.
3. Root `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, `CHANGELOG.md` — current detailed project truth.
4. `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_WORKFLOW.md` — architecture and development workflow.
5. `docs/PROJECT_STATUS.md`, `docs/PROJECT_PROGRESS.json`, `docs/RISKS.md`, `docs/TODO.md` — mirrors for navigation and automation only.

A shorter or newer-looking document must not override a higher-authority source. Conflicts fail closed and must be reported.

## Exact Remote Source

- Repository: `zhouzengrui369-commits/copilot-app`
- Parent source branch: `codex/p0-owner-gate`
- Parent source commit: `6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Current `main` observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Bounded successor branch: `agent/r30-github-bound-candidate-runner`
- Draft parent PR: `#12`
- R28: `NEVER_RUN / PERMANENTLY_REJECTED`; do not execute, repair, copy, or reuse it.

## Role Boundary

- **ChatGPT** changes source only through bounded GitHub branches and PRs. ChatGPT does not run the local Electron candidate and does not claim runtime acceptance.
- **MiniMax Code** checks out one exact approved GitHub commit and runs the R30 runner locally without editing source. On any blocker it stops and reports; it never silently repairs the repository.
- **Codex** performs independent real-computer experience and Release Gate verification only after MiniMax returns candidate-bound evidence. Codex does not fix product source in the acceptance lane.

## Current Work Product

R30 is a brand-new successor contract, not a continuation of R28. Its source implementation closes:

- Gate 2: macOS `sandbox-exec` denies all network; `npm ci --offline` is the only install path. Cache insufficiency returns `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED` and requests separate minimal read-only registry authority. There is no automatic online retry.
- Gate 3: a complete control-input ledger is generated from regular files and every digest must be a real lower-case 64-character SHA256.
- Gate 9: list-only discovery must be exactly `113 tests in 9 files`; `>=50`, `112/9`, `113/8`, and `114/9` all fail closed.

The runner also defines source binding, tracked/untracked cleanliness, fail-closed rejection of stale ignored candidate outputs, realpath validation of the new outside-repository evidence destination, ordered builds, unsigned arm64 packaging, source/artifact identity, focused packaged Electron, exact full packaged Electron, deterministic synthetic test-data manifest, screenshots, runtime ID, and process terminal-state receipts. A pre-existing evidence directory is never modified.

## Truth Boundary

No R30 local execution has occurred. Therefore all of the following remain unset:

- current candidate
- source snapshot receipt
- artifact SHA256
- runtime ID
- runtime screenshots
- packaged Electron result
- independent Codex verdict
- Developer ID signing
- notarization/stapling
- Release readiness
- Human Owner Gate

The only permitted conclusion is `BLOCKED / MVP_NOT_COMPLETE`.
