# Copilot Development Workflow

## Status And Authority

This is the owner-approved repository development mode. It supersedes older
OpenClaw-first, MiniMax-primary, and Codex-to-Mavis product-development
routing in this repository.

It changes role ownership only. The root v6.2 baseline, macOS-first scope,
strict local-first truth, quality thresholds, integration/coverage/Electron
E2E/performance gates, candidate-bound evidence, signing/notarization,
independent Focused Retest, Human Owner Gate, and fail-closed claims remain
unchanged.

GitHub commits and PRs are the only product-source authority.

## Role Separation

### ChatGPT: remote product-code developer

- Starts from an exact GitHub commit.
- Works in a bounded branch and PR.
- Changes only the approved product/test/docs scope.
- Records implementation, tests, risks, migrations, rollback, and exact
  changed files in the PR.
- Does not claim local deployment, Electron runtime, independent acceptance,
  signing, release, or MVP completion.

### MiniMax Code: local exact-commit deployment executor

- Checks out one approved Git commit without adding product changes.
- Runs the exact dependency, build, package, launch, and evidence commands
  authorized for that candidate.
- Stops and returns the defect to a new GitHub PR if source changes are needed.
- Produces a deployment receipt that binds:
  - source commit and immutable source snapshot SHA256;
  - artifact SHA256;
  - runtime ID;
  - deterministic test-data manifest and classification;
  - exact commands and exit codes;
  - packaged Electron identity and screenshots;
  - process launch and terminal state;
  - dirty/untracked and source/runtime drift checks.

### Codex: independent local acceptance and Release Gate

- Verifies that deployed source, artifact, runtime, and test data match the
  MiniMax receipt.
- Uses the real computer and exact deployed Electron candidate for product
  acceptance.
- Reviews sources, persistence, quit/relaunch, failure states, local/cloud
  boundary, and the required candidate-bound quality evidence.
- Fails closed when evidence is missing, stale, synthetic without labeling, or
  bound to different bytes.
- Does not author a product fix and then count its own result as independent
  acceptance. A failed check returns to ChatGPT through a new GitHub PR.

## End-To-End Flow

1. **Source handoff** — owner/controller identifies the exact GitHub base
   commit and bounded change contract.
2. **Remote development** — ChatGPT implements and opens a PR with tests and
   precise handoff evidence.
3. **Source review** — the PR is reviewed; accepted product bytes are committed
   and immutable.
4. **Local deployment** — MiniMax checks out and deploys exactly that commit,
   without source edits, and writes the candidate receipt.
5. **Independent acceptance** — Codex validates identity and performs
   real-computer acceptance on that same runtime.
6. **Focused Retest** — an independent retest must return P0=0 before the Human
   Owner Gate is eligible.
7. **Distribution gates** — signing, notarization, installation, Gatekeeper,
   final coverage/E2E/performance, screenshots, verify-fix rounds, SHA256, and
   delivery evidence remain separately required.

No earlier step may claim a later gate.

## Fail-Closed Rules

- Dirty or untracked product input is not a candidate.
- A browser prototype, fixture, static screenshot, build output, or worker
  summary is not Electron runtime proof.
- A packaged artifact without exact source/runtime/test-data binding is not a
  candidate.
- A successful write without canonical readback and restart recovery is not a
  product PASS.
- MiniMax source edits invalidate the deployment receipt and require a new PR.
- Codex self-authored product fixes invalidate independence for that result.
- P0 greater than zero, source/runtime drift, missing evidence, unsigned
  distribution, or incomplete v6.2 gates remain blocking.
- A runner with an incomplete/malformed SHA ledger, unresolved network
  authority, or a discovered-suite assertion weaker than the accepted exact
  count is not executable and cannot be promoted.

## Current R29 Handoff

- branch: `codex/p0-owner-gate`
- pre-R29 committed head:
  `ce21c3f4f29fff8a2f8426e36c22306c6f282583`
- active candidate: none
- artifact SHA256: unset
- runtime ID: unset
- independent candidate retest: pending
- Human Owner Gate: not eligible
- MVP: `MVP_NOT_COMPLETE`

The R28 runner was never executed and established no candidate. Independent
review returned `FAIL / STAGE_B_REJECTED / P0=1 / P1=2 / P2=0`:

- its persisted Gate 3 SHA ledger value was malformed and only 63 hex
  characters;
- Gate 2 still named the npm registry without enforcing offline/no-network;
- Gate 9 accepted `>=50` rather than exactly `113 tests in 9 files`.

R28 is rejected and cannot be promoted. The R29 governance postimage
supersedes its frozen source target. Because this postimage is not yet
committed, no replacement runner target exists yet. After independent review
and the controller-created governance commit, every future runner must bind
that new exact head and obtain a fresh independent review of its complete SHA
ledger, network authority, and exact `113 / 9` assertions.

## ChatGPT Takeover Contract

Use the following handoff after the R29 governance commit is independently
reviewed, committed, pushed, and available on GitHub:

> Start from the exact GitHub commit supplied by the controller. Read
> `README.md`, `AGENTS.md`, `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`,
> `TODO.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md`,
> `DECISIONS.md`, `CHANGELOG.md`, and the four root v6.2 baseline documents.
> Work only in a bounded GitHub branch/PR. Do not expand scope, weaken
> local-first truth, alter quality/release gates, or treat historical
> candidate evidence as current. Implement the single highest-priority TODO,
> add the required tests, update handoff documents, and report exact changed
> files, commands, results, risks, rollback, and the resulting commit. Do not
> claim local deployment, independent acceptance, signing, release, or MVP
> completion.

The controller must replace “the exact GitHub commit supplied” with the real
post-R29 commit. Never infer or reuse the pre-R29 head.
