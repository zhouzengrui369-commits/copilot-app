# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The macOS MVP product source and fail-closed Candidate pipeline are source-complete. R46 transport hardening is under GitHub review. There is no current Candidate, artifact SHA-256, runtime ID, packaged Electron result, independent Codex acceptance, signing, notarization, Release, or Human Owner Gate.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Original product takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R45 frozen source: `43f151a3a1eb7e0592ff833f0e42892db47d3d65`
- R45 source gate: run `30793536929`, all 17 steps PASS
- Desktop Phase 1 source suite: `1107/1107`
- Electron list-only discovery: exact `113 tests in 9 files`
- Active transport-fix branch: `chatgpt/r45-native-hydration-transport-fix`
- Exact successor deployment SHA: supplied only after R46 is merged into PR #20 and the resulting PR #20 exact head passes the complete source gate.

The exact Git commit object, not a branch tip, stale worktree, chat transcript, or partial cache, is the only deployment authority.

## Product source checkpoint

The source contains:

- local-first notes, KB, WIKI, MOC, KG, RAG, Todo, schedule, and persistence;
- grounded Ask answers with verifiable local sources;
- Ask → full reader → same-exchange return continuity;
- canonical Todo create/list/readback, source links, All/Unscheduled discovery, edit, and schedule association;
- embedded-local retrieval default and explicit Ollama compatibility;
- app-embedded local-ASR source/package contracts;
- twelve fail-closed Candidate Gates;
- strict global and per-file critical coverage;
- production CycloneDX SBOM;
- clean tracked and untracked source.

These are source results, not Electron runtime proof.

## R44 first Candidate blocker

MiniMax executed source `74454d21910f0c01e0b9d4f8117b4394defe3228`. Exact authority, registry-only hydration, `68/68` source contracts, and dry-run passed. The single Candidate execution stopped at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED` because lifecycle scripts needed native toolchain inputs not present in the registry-only cache. No source was changed and no artifact or runtime was established.

R45 added exact-commit, receipt-bound native-toolchain hydration rather than hiding lifecycle scripts or granting Candidate network access.

## R45 hydration transport blocker

On exact R45 source `43f151a3a1eb7e0592ff833f0e42892db47d3d65`:

- exact fetch, authority, new-path checks, and clean detached worktree PASS;
- `83/83` Candidate source contracts PASS;
- one Owner-authorized bounded hydration started;
- npm fetched thousands of package objects through the official-host proxy and stopped with `ECONNRESET`;
- no PASS receipt, Candidate worktree, artifact, runtime ID, Electron process, screenshot, or performance receipt was created.

The approximately 477 MiB partial cache and its logs are immutable `EVIDENCE_ONLY` assets. They cannot be reused, upgraded, removed, or supplied to a Candidate.

A prohibited second hydrator invocation was immediately rejected by `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`; no second online hydration or Candidate state occurred. The process deviation remains recorded.

## R46 transport patch

R46 does not change product behavior, package versions, host allowlist, Candidate network authority, database, credentials, signing, notarization, cloud resources, or release scope.

It preserves:

- one Owner authorization and one hydration invocation;
- `automaticRetry=false` and no hidden resume;
- localhost CONNECT proxy and exact official-host allowlist;
- Candidate `(deny network*)`;
- partial-cache reuse forbidden.

It adds:

- TCP keepalive and no-delay on both tunnel sockets;
- twenty-minute idle timeout;
- explicit npm fetch timeout, zero retries, and bounded socket concurrency;
- per-CONNECT timestamps, duration, directional bytes, socket policy, and terminal error;
- stable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_*` classifications;
- exclusive `HYDRATION-FAILED.json` marker with `status=partial_failed_transport`, `reusable=false`, and `passReceiptCreated=false`;
- receipt validation that rejects partial markers, retry-policy drift, or fatal tunnel records.

No failed hydration can emit a PASS receipt.

## Role boundary

1. ChatGPT owns the bounded GitHub patch and Draft PR.
2. MiniMax Code remains stopped until a handoff contains `SOURCE_COMMIT`, `PR`, `SOURCE_GATE=PASS`, and a new `RUN_STAMP`.
3. MiniMax may execute only that exact SHA in entirely new detached worktrees, once, without local source repair or retry.
4. Codex starts only after a complete source/artifact/runtime-bound evidence package and independently operates the real packaged Electron Candidate.
5. CI, browser fixtures, builds, packaging, or worker self-test cannot substitute for Codex acceptance.

## Remaining gates

- Pass all source contracts and the complete 17-step source gate on the exact R46 fix head.
- Merge R46 into Draft PR #20 only; do not merge PR #20 to `main`.
- Pass the complete source gate on the resulting exact PR #20 head.
- Issue the four-field exact-object handoff with a new SHA and run stamp.
- Run one fresh hydration and one fresh Candidate using new paths and identities.
- Pass Gates 1–12, including packaged Electron `113/113`, three performance runs, persistence, screenshots, identities, and clean termination.
- Complete independent Codex acceptance, packaged offline ASR, verify-fix rounds, signing, notarization, Gatekeeper, and Human Owner Gate unless the Owner revises the v6.2 boundary.

## Next single action

Complete GitHub review and source CI for R46, merge it into Draft PR #20, pass source CI on the resulting PR #20 exact head, then issue the new MiniMax handoff. MiniMax and Codex remain stopped until then.
