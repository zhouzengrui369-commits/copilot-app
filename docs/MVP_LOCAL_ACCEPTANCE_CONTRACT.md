# Copilot App macOS MVP — Local Acceptance Contract

## Ownership

- ChatGPT: remote GitHub source, fix branch, Draft PR, and exact task contract.
- MiniMax Code: exact-SHA clean-worktree hydration, build, package, Electron execution, and technical evidence.
- Codex: independent real Electron product-experience and runtime acceptance.
- Owner: final scope, Human Owner Gate, and release decision.

## Immutable verdict before independent local evidence

```text
MVP_NOT_COMPLETE
NOT_RUNTIME_PROOF
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

CI, static source, a browser fixture, a package command, an unsigned artifact, or MiniMax self-test cannot change these values.

## Candidate identity gate

One candidate must bind:

- exact source commit and source snapshot SHA-256;
- native-toolchain hydration receipt SHA-256 and cache aggregate SHA-256;
- package-lock SHA-256 and exact lifecycle package set;
- artifact SHA-256;
- ZIP, DMG, app, executable and `app.asar` identities;
- runtime ID;
- ecosystem baseline commit;
- deterministic test-data manifest and SHA-256;
- all commands, exit codes, and durations;
- screenshots and hashes;
- three candidate-bound performance receipts;
- final clean process and Git state.

Dirty or untracked source, source-run Electron, a browser fixture, a different artifact, an old cache, an old receipt, or an unbound screenshot cannot satisfy the gate. Any tracked source change invalidates all earlier candidate identities.

## Gate 2 native-cache truth

The candidate is always deny-network and runs lifecycle scripts. The first PR #20 candidate correctly proved that a registry-only `--ignore-scripts` cache cannot satisfy that contract.

A valid successor requires a new receipt produced by:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The receipt must prove, before candidate execution:

1. exact detached clean source and exact lockfile;
2. exact reviewed `hasInstallScript` package set;
3. one bounded online full lifecycle install through a localhost CONNECT proxy;
4. every CONNECT host belongs to the source-defined official allowlist;
5. inherited credentials, Electron mirrors, npm registry/proxy/config, and native-build overrides are stripped;
6. `better-sqlite3` builds from source;
7. Electron distributions and Node/Electron headers are stored under the new receipt-bound cache root;
8. Electron 38 arm64 native rebuild succeeds during hydration;
9. all installed `node_modules` trees are removed;
10. a full lifecycle `npm ci --offline` succeeds under `(deny network*)`;
11. an Electron 38 arm64 native rebuild succeeds under `(deny network*)` using the exact receipt-bound header root;
12. the Electron executable is restored from cache;
13. source remains clean and no candidate/evidence is created;
14. every regular cache file and the aggregate cache identity are hashed.

The candidate revalidates the receipt and cache bytes, runs the same full lifecycle install under deny-network, redirects logs to evidence, proves the cache did not mutate, and supplies only the receipt-bound Electron headers to later native staging.

No candidate process receives online authority. No automatic online retry exists. A missing, partial, stale, tampered, or source-mismatched receipt is a fail-closed blocker.

## macOS MVP product gate

The same packaged candidate must prove:

```text
local material
→ grounded Ask answer
→ clickable real local source
→ full source reader
→ return to same Ask exchange
→ Todo create with canonical readback
→ exact Todo discoverable in All / Unscheduled
→ Todo edit and readback
→ optional due date / plan association
→ full Electron quit
→ relaunch and recover Ask + source + Todo
```

### Todo truth

- No success before canonical `todos.list()` readback.
- No success before the matching Ask conversation receipt is persisted.
- Unscheduled Todo must have a direct “查看待办” path.
- The exact Todo ID must be located, editable, and read back.
- Source links must survive create, edit, schedule association, quit, and relaunch.
- A failed or uncertain write cannot display success or encourage blind duplicate creation.

### Ask continuity

- The current exchange must be safely persisted before source navigation.
- Returning must preserve question, answer, source set, source truth, and Todo state.
- Stale, missing, unknown, or partially verified sources disable completion actions.
- Re-asking cannot be used to recover the journey.

### Candidate reproducibility

- MiniMax runs the exact final Draft PR head in new detached worktrees.
- Codex accepts only the exact source/artifact/runtime/test-data identity in MiniMax's receipt.
- A source edit, artifact replacement, different userData, or runtime mismatch invalidates acceptance.

## Technical gates

- Node 24 macOS source gate passes on the exact final PR head.
- Exact lockfile install and source tree remain clean.
- Candidate source contracts pass.
- TypeScript checks pass.
- Unit and integration suites pass.
- Strict global and per-file critical coverage pass.
- CycloneDX production SBOM validates.
- Electron list-only discovery is exactly `113 tests in 9 files`.
- Packaged Electron suite is exactly `113/113` with zero skipped, unexpected, or flaky results.
- Electron and Playwright processes terminate cleanly.
- Three distinct candidate-bound performance runs pass.
- Focused P0 journeys pass twice on the same candidate identity.

## Product-experience gates

Codex must operate the real packaged Electron app and record:

- 1229×768 and 1440×900 layout;
- keyboard and focus return for the critical journey;
- source-reader return continuity;
- Todo success, recovery, and failure language;
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
- TypeScript or unit tests;
- a renderer/browser prototype;
- successful cache hydration;
- a successful package command;
- an unsigned artifact;
- MiniMax self-test without Codex verification;
- source-run Electron from dirty or untracked code.

## Release boundary

This contract authorizes an unsigned diagnostic macOS candidate attempt after explicit Owner approval of the bounded native-toolchain hydration. Signing, notarization, stapling, Gatekeeper evidence, and broader release decisions remain separate gates unless the Owner explicitly changes the v6.2 baseline.
