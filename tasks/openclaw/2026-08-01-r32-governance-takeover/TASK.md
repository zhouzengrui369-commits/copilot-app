# R32 governance takeover

## Executor

MiniMax Code CLI. Codex remains PM and acceptance owner.

## Workspace

- `/private/tmp/copilot-r32-ci-date-stability`
- branch `codex/r32-ci-date-stability`
- base HEAD `c3bb0ecf64ab841707b954dfa05728fd44652a79`

## Goal

Update project handoff documents to the current verified truth. Do not claim source, candidate, MVP, release, or experience readiness.

## Allowed files

- `PROJECT_STATE.yaml`
- `PROJECT_STATUS.md`
- `TODO.md`
- `CHANGELOG.md`
- `DECISIONS.md`
- `docs/ARCHITECTURE.md` only if needed to record the PM/MiniMax/Codex role split; otherwise leave unchanged
- task-owned deliverables in `/Users/njx/openclaw/copilot/tasks/openclaw/2026-08-01-r32-governance-takeover/`

## Verified truth to record

- GitHub Draft PR #14 head/base under repair: `c3bb0ecf64ab841707b954dfa05728fd44652a79` on `agent/r31-source-completion`.
- Latest source-gate run `30682977003`, job `91323461797`, is red only at the current recorded GitHub head: 4 failures across two date-sensitive tests, 1103/1107 passed.
- Clean implementation worktree branch: `codex/r32-ci-date-stability` based on that exact head.
- Local date-stability patch touches exactly the two test files listed in the sibling R32 task. Independent focused check: 47/47 PASS, exit 0.
- Local tests TSC is NOT accepted because the available reused dependency tree produces Vite/Vitest type-identity drift; full phase1-release is NOT accepted because symlinked dependencies fail the app-local Electron guard. The definitive next source proof is clean GitHub CI after commit/push/PR.
- No current clean packaged Electron candidate, artifact SHA256, or runtime ID exists for this head.
- Verdict remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`.
- Operating model: Codex is parent PM and acceptance owner; MiniMax Code CLI is primary bounded implementation worker; GitHub is durable source truth; Codex real-computer verification and independent product review remain distinct gates.
- MVP is single-user macOS-first. Defer Windows Phase 1.1, Tencent deployment/Remote/Backup, 3D, mobile/web, multi-user, plugins, i18n, broad enterprise security, and major dependency upgrades. Do not remove local-first, credential, no-egress, persistence, or evidence-integrity safety controls.
- Immediate ordered path: land date-stability patch through clean CI; freeze final source SHA; hydrate dependencies under existing bounded contract; create reproducible unsigned macOS candidate; perform real Electron journeys and verify-fix rounds; then owner gate. Apple Developer ID/notary remains post-MVP owner-deferred unless current v6.2 explicitly proves otherwise; record any conflict as a risk, not a decision.

## Required document content

- `PROJECT_STATE.yaml` must contain the fields required by current governance and must not invent artifact/runtime values; use explicit `NOT_ESTABLISHED`/null.
- `PROJECT_STATUS.md`: current phase/objective/completed/in progress/next/risk/latest important change/branch/latest commit.
- `TODO.md`: P0/P1/P2 with exact unlock conditions.
- `CHANGELOG.md`: dated R32 takeover entry with reason and impact.
- `DECISIONS.md`: record the new operating model and single-user security prioritization without weakening existing local-first/credential integrity controls.
- Preserve historical evidence and existing statuses; update only stale current-state sections.

## Forbidden

No production/test/source change beyond the allowed governance files. No Git add/commit/push/PR/network, dependency install, Electron/build/test, credentials, signing, packaging, or deletion. Do not edit v6.2 baseline files.

## Deliverables

Write `RESULT.md`, `EVIDENCE.md`, `commands.log`, `changed-files.txt`, and `DISPATCH_STATUS.md` in this task directory. Include exact diff/check output and file SHAs.

## Acceptance

PASS only if every current-state claim matches the supplied verified truth, the handoff remains understandable within ten minutes, no readiness is upgraded, and the allowlist is exact.

## Controller salvage addendum

The MiniMax governance worker was stopped after attempting a forbidden package
install and replacing `PROJECT_STATE.yaml` wholesale. Codex restored the file
to the exact base, then performed a minimal `apply_patch` salvage. Because the
owner's current takeover instruction must supersede the stale top-level role
mode, `AGENTS.md` is added to the controller-only governance allowlist. No
other scope is expanded.
