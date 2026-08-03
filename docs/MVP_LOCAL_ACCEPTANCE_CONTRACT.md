# Copilot App macOS MVP — Local Acceptance Contract

## Ownership

- ChatGPT: remote GitHub source and Draft PR.
- MiniMax Code: exact-SHA clean-worktree execution, build, package and evidence.
- Codex: independent real Electron product-experience and runtime acceptance.
- Owner: final scope and release decision.

## Immutable verdict before local evidence

```text
MVP_NOT_COMPLETE
NOT_RUNTIME_PROOF
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

## Candidate identity gate

One candidate must bind:

- exact source commit;
- source snapshot SHA-256;
- artifact SHA-256;
- app, executable and `app.asar` SHA-256;
- runtime ID;
- ecosystem baseline commit;
- deterministic test-data manifest;
- command log and exit codes;
- screenshots and hashes;
- performance receipts;
- clean process terminal state.

Dirty or untracked source, source-run Electron, a browser fixture, a different artifact, or an unbound screenshot cannot satisfy the gate.

## macOS MVP product gate

The same packaged candidate must prove:

```text
local material
→ grounded Ask answer
→ clickable real local source
→ full reader
→ return to same Ask exchange
→ Todo create with canonical readback
→ exact Todo discoverable in All / Unscheduled
→ Todo edit and readback
→ optional due date / plan association
→ full Electron quit
→ relaunch and recover Ask + source + Todo
```

### Todo truth

- No success before canonical list/readback.
- No success before the matching Ask conversation receipt is persisted.
- Unscheduled Todo must have a direct View Todo path.
- The exact Todo must be editable.
- A failed or uncertain write cannot encourage blind duplicate creation.
- Source links must survive create, edit and relaunch.

### Ask continuity

- Opening a source must save the current exchange first.
- Returning must preserve question, answer, source set, source truth and Todo action/receipt.
- Stale or missing local sources disable completion actions.
- No re-asking is allowed to recover the journey.

### Candidate reproducibility

- MiniMax runs the exact PR head once in a clean detached worktree.
- Codex accepts only the exact source/artifact/runtime identity from the MiniMax receipt.
- Any source edit after the receipt invalidates the candidate.

## Technical gates

- Node 24 macOS source gate passes on the exact PR head.
- Exact lockfile install and source tree remain clean.
- TypeScript checks pass.
- Unit and integration suites pass.
- Strict global and critical coverage pass.
- CycloneDX production SBOM validates.
- Electron list-only discovery is exactly `113 tests in 9 files`.
- Packaged Electron suite is exactly `113/113` with zero skipped, unexpected or flaky results.
- Three candidate-bound performance runs pass.
- Focused P0 journeys pass twice on the same candidate.

## Product-experience gates

Codex must operate the real packaged Electron app and record:

- 1229×768 and 1440×900 layout;
- keyboard and focus return for the critical journey;
- source-reader return continuity;
- Todo success, recovery and failure language;
- All / Unscheduled discoverability;
- Todo editing and plan association;
- full quit/relaunch persistence;
- local-first and model-egress truth language;
- P0/P1/P2 findings.

Human Owner Gate is ineligible unless the independent focused retest reports `P0=0` on the same candidate identity.

## Explicit non-acceptance

The following never prove MVP completion by themselves:

- GitHub CI green;
- a Draft PR or merge;
- TypeScript/unit tests;
- a renderer/browser prototype;
- a successful package command;
- an unsigned artifact;
- MiniMax self-test without Codex verification;
- source-run Electron from dirty/untracked code.

## Release boundary

This contract authorizes an unsigned diagnostic macOS candidate attempt. Signing, notarization, stapling, Gatekeeper evidence and broader release decisions remain separate gates unless the Owner explicitly changes the v6.2 baseline.
