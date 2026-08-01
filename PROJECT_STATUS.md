# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`

Draft PR #14 (`agent/r31-source-completion`) is not currently green. Its HEAD
`c3bb0ecf64ab841707b954dfa05728fd44652a79` failed source-gate run
`30682977003` / job `91323461797` with four date-sensitive failures in two
test files (`1103/1107` passed). The clean local repair branch is
`codex/r32-ci-date-stability` at the same base. No current candidate, artifact
SHA256, runtime ID, packaged Electron result, or Human Owner Gate exists.

## R32 Takeover

- Current objective: land the two-test date-stability repair through clean
  GitHub CI, then freeze the final source SHA and build a reproducible unsigned
  macOS candidate.
- Completed: GitHub/local truth audit; independent focused rerun `47/47 PASS`.
- In progress: governance handoff update and clean-CI landing.
- Next: clean GitHub source gate, bounded dependency hydration, twelve-gate
  candidate, real Electron journeys, and three verify-fix rounds.
- Risk: reused local dependencies cannot prove tests TSC or phase1-release;
  those results remain NOT_ACCEPTED until clean CI. Apple signing/notary is
  owner-deferred post-MVP, while older v6.2 release wording still lists it as a
  release gate; do not silently resolve that conflict.
- Latest important change: the calendar tests no longer depend on July 2026.
- Branch: `codex/r32-ci-date-stability`.
- Latest committed base: `c3bb0ecf64ab841707b954dfa05728fd44652a79`.

## Authority

The owner-approved baseline remains `goal.md`, `plan.md`, `rules.md`, and `delivery.md` v6.2. `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md` define the GitHub → MiniMax Code → Codex role boundary. Root `PROJECT_STATE.yaml`, this file, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md` are current truth. The six `docs/*` handoff files are mirrors and cannot override root truth. The complete pre-R30 detail remains byte-preserved under `docs/history/`.

## Source Chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Original takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Original parent PR: #12
- Candidate-runner parent: `agent/r30-github-bound-candidate-runner`, PR #13
- Active branch: `agent/r31-source-completion`
- Active Draft PR: #14
- Local implementation branch: `codex/r32-ci-date-stability`
- Current under-repair PR HEAD: `c3bb0ecf64ab841707b954dfa05728fd44652a79`
- Final identity rule: use the externally reported final 40-character PR #14 HEAD after the last tracked commit passes all 17 source-gate steps. Tracked files do not self-embed their own containing commit.

## Closed Deployment-Authority Defects

MiniMax correctly stopped before candidate creation when old worktrees lacked the authority document and again when the exact-object verifier required a contiguous `git worktree add --detach` marker while the real document used `git -C "$REPO" worktree add --detach`.

The source now reads authority from the exact Git commit object, validates both detached-worktree command forms semantically, requires `--detach`, validates the real versioned authority document, hashes it, and creates no network/worktree/evidence state during bootstrap.

## Gate 2 Cache Incident And Source Resolution

The first local run against `4e46dad574804b38b2a10b05f70d1aa2b551c64b` passed authority bootstrap, source contracts, and dry-run, then correctly stopped at Gate 2:

```text
BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED
OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS
```

The failed worktree and evidence are `REFERENCE_ONLY` and may never be reused:

```text
/Users/njx/copilot-r31-4e46dad57480-20260731T140551Z
/Users/njx/copilot-evidence/copilot-r30-4e46dad574804b38b2a10b05f70d1aa2b551c64b-20260731T140551Z
```

The GitHub source now provides `scripts/candidate-r30/npm-cache-hydrate.mjs` and its RED→GREEN tests. The bounded recovery contract is:

1. Receive the exact owner token `OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS`.
2. Use a new clean detached hydration worktree at the final exact commit.
3. Use a new isolated cache and a new exclusive receipt outside the repository.
4. Validate `package-lock.json` version, SHA256, and every network-resolved origin.
5. Reject non-HTTPS, credential-bearing, GitHub, Git, SSH, or any non-reviewed origin.
6. Strip inherited proxy, registry, token, and npm user/global config authority.
7. Disable all lifecycle scripts during hydration.
8. Run the npm child under `sandbox-exec`, where it can connect only to a localhost CONNECT proxy.
9. Permit the parent proxy to connect only to `registry.npmjs.org:443`; record every CONNECT request.
10. Run a second `npm ci --ignore-scripts --offline` under `(deny network*)`.
11. Hash every regular cache file and bind the receipt to exact source commit, lock SHA256, cache path/aggregate SHA256, npm identity, commands, logs, proxy audit, and offline probe.
12. Create a separate clean candidate worktree and evidence directory.
13. Pass paired `--npm-cache-dir` and `--npm-cache-receipt` arguments to the candidate runner.
14. Revalidate receipt/source/lock/cache bytes before Gate 2.
15. Keep candidate Gate 2 as `npm ci --offline` under `(deny network*)`, with no automatic online fallback.

If the approved cache is incomplete, the candidate stops with `BLOCKED_NPM_APPROVED_CACHE_INCOMPLETE`; it does not ask for or perform another automatic network retry.

## GitHub Source Checkpoint

R31 remote source work retains the listed capabilities, but the current PR HEAD
is red because two calendar test files drifted with the real month. The R32
test-only repair is focused-green locally; clean GitHub CI remains mandatory.

- embedded-local deterministic production embeddings with no external service;
- explicit Ollama opt-in only;
- single-model vector rotation preserving durable local text;
- fail-closed Ask, Todo, WIKI, reversible Trash, local-ASR, IPC/preload, renderer, and native-binding contracts;
- the complete Node 24 macOS source gate;
- desktop Phase 1 checkpoint `1107/1107`;
- strict global and per-file critical coverage, including `local-knowledge-service.ts` branches at 90.00%;
- production CycloneDX SBOM;
- exact Electron list-only discovery `113 tests in 9 files`;
- clean tracked source.

These are source-development results, not packaged runtime or release evidence.

## Twelve-Gate Local Candidate Contract

1. Exact source identity and clean preimage.
2. Receipt-bound isolated cache accepted only after exact validation; candidate install remains deny-network/offline.
3. Complete SHA256 ledger for every Git-tracked regular file plus aggregate digest.
4. Candidate source contracts and ordered LLM → KB → KG → RAG build.
5. Checks, unit/integration tests, strict global/critical coverage, desktop build, Phase 1 suite, and CycloneDX SBOM.
6. Canonical unsigned macOS arm64 ZIP/DMG builder and independent authority wrapper.
7. Canonical source snapshot and ZIP/DMG/app/executable/`app.asar` identity.
8. Focused packaged Electron `2/2`.
9. Exact `113 tests in 9 files` discovery and complete E2E source manifest.
10. Full packaged Electron `113/113`, zero skipped/unexpected/flaky, clean process termination.
11. Three distinct candidate-bound `r31-v1` performance runs and aggregate.
12. Final manifest, SBOM, commands, screenshots, identities, runtime ID, performance evidence, and terminal state.

A successful local run remains an **unsigned diagnostic candidate**.

## Current Role Boundary

1. Codex is parent PM, writes bounded contracts, reviews exact diffs/tests, and
   owns final real-computer acceptance.
2. MiniMax Code CLI is the primary bounded implementation worker. It may edit
   only an exact task allowlist and cannot use its own self-test as acceptance.
3. GitHub commits/PRs remain durable source truth. ChatGPT may contribute by
   PR, but is no longer the sole source-authoring route.

## Remaining Blocks

- Final 17-step source gate on the exact deployment SHA.
- Owner-authorized local cache hydration receipt.
- Local twelve-gate candidate and complete evidence package.
- Independent Codex real-computer acceptance.
- Candidate-bound three verify-fix rounds.
- Real packaged offline local-ASR chain.
- Developer ID signing, Apple notarization, stapling, validation, Gatekeeper evidence, and Human Owner Gate.

## Next Single Action

Commit and push the two-test R32 repair, require the complete clean GitHub
source gate to pass, and freeze that exact SHA. Then MiniMax hydrates the
approved cache in one isolated worktree and executes the candidate runner once
in a separate detached worktree. Codex reviews the receipt and operates the
exact packaged candidate on the real Mac.
