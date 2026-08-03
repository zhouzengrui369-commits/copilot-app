# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The macOS MVP product source, fail-closed candidate runner, and R46 hydration-transport patch are under GitHub review. There is no current Candidate, artifact SHA-256, runtime ID, packaged Electron result, independent Codex acceptance, signing, notarization, Release, or Human Owner Gate.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Original product takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R45 frozen source: `43f151a3a1eb7e0592ff833f0e42892db47d3d65`
- R45 source gate: run `30793536929`, all 17 steps PASS
- Active transport-fix branch: `chatgpt/r45-native-hydration-transport-fix`
- Exact successor deployment SHA: externally supplied only after the final fix is merged into PR #20 and the resulting PR #20 head passes the complete source gate.

The exact Git commit object, not a branch tip, stale worktree, partial cache, or chat transcript, is the only deployment authority.

## Product source checkpoint

The consolidated macOS-first source contains:

- local-first notes, KB, WIKI, MOC, KG, RAG, Todo, schedule, and persistence boundaries;
- embedded-local production embeddings and explicit Ollama compatibility;
- grounded Ask answers with verifiable local sources;
- Ask → full source reader → same-exchange return continuity;
- canonical Todo create/list/readback, source links, All/Unscheduled discovery, editing, and focused navigation;
- app-embedded local-ASR source and package contracts;
- twelve fail-closed Candidate Gates;
- desktop Phase 1 source suite and strict global/per-file critical coverage;
- production CycloneDX SBOM;
- exact Electron list-only discovery `113 tests in 9 files`;
- clean tracked and untracked source.

These are source results, not Electron runtime proof.

## R44 first exact Candidate attempt

MiniMax executed exact source `74454d21910f0c01e0b9d4f8117b4394defe3228`. Exact authority, registry-only hydration, source contracts, and dry-run passed. The one Candidate execution stopped at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED` because registry-only hydration had disabled lifecycle scripts while Candidate truth required full lifecycle installation under deny-network. No source was changed and no artifact or runtime was established.

R45 added an exact-commit, receipt-bound native-toolchain hydration rather than hiding lifecycle scripts or granting Candidate network access.

## R45 native hydration incident

MiniMax then executed exact R45 source `43f151a3a1eb7e0592ff833f0e42892db47d3d65`:

- exact fetch, authority, new-path checks, and clean detached hydration worktree PASS;
- all source contracts `83/83` PASS;
- one Owner-approved bounded native hydration started;
- npm fetched thousands of packages over high-latency official-host tunnels and stopped with `ECONNRESET`;
- no PASS hydration receipt, candidate worktree, artifact, runtime ID, Electron process, screenshot, or performance evidence was created.

The failed cache is approximately 477 MiB and remains immutable diagnostic evidence. It cannot be reused, removed, upgraded, or supplied to a Candidate.

A second hydrator invocation was attempted in violation of the one-invocation contract and was immediately rejected by `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`. It performed no second online hydration and created no Candidate state. The deviation is retained in the evidence and does not change the canonical first blocker.

## R46 transport patch

The active patch does not change product behavior or release authority. It preserves:

- one Owner authorization and one hydration invocation;
- no automatic or hidden retry;
- exact official-host allowlist unchanged;
- localhost CONNECT proxy only;
- Candidate `(deny network*)` unchanged;
- partial-cache reuse forbidden.

It adds:

- TCP keepalive and no-delay on both sides of each CONNECT tunnel;
- twenty-minute idle timeout for long artifact transfers;
- explicit npm fetch timeout, zero retries, and bounded socket concurrency;
- per-CONNECT timestamps, duration, directional byte counts, socket policy, and terminal error;
- stable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_*` classifications;
- exclusive `HYDRATION-FAILED.json` marker with `partial_failed_transport`, `reusable=false`, and `passReceiptCreated=false`;
- receipt validation that rejects partial markers, retry-policy drift, or fatal tunnel evidence.

No failed hydration can emit a PASS receipt.

## Role boundary

1. ChatGPT develops the bounded GitHub source repair and Draft PR only.
2. MiniMax Code remains stopped until the successor handoff contains `SOURCE_COMMIT`, `PR`, `SOURCE_GATE=PASS`, and a new `RUN_STAMP`.
3. MiniMax may execute only that exact SHA in entirely new detached worktrees and may not repair source locally or retry hydration.
4. Codex may begin independent real Electron acceptance only after a complete source/artifact/runtime-bound MiniMax evidence package exists.
5. CI, source tests, browser fixtures, package success, or worker self-test cannot substitute for Codex acceptance.

## Remaining gates

- Pass all source contracts and the complete 17-step source gate on the exact R46 fix head.
- Merge the bounded R46 fix into Draft PR #20 only; do not merge PR #20 to `main`.
- Pass the complete source gate on the resulting exact PR #20 head.
- Freeze and externally report the new exact `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, and unique `RUN_STAMP`.
- Run one new hydration and one new Candidate using entirely new paths and identities.
- Pass Candidate Gates 1–12, including packaged Electron `113/113`, three performance runs, persistence, screenshots, identities, and clean terminal state.
- Independently verify the exact candidate through Codex on the real Mac.
- Complete candidate-bound verify-fix rounds.
- Prove real packaged offline local ASR.
- Complete signing, notarization, stapling, Gatekeeper, and Human Owner Gate unless the Owner explicitly revises the v6.2 release boundary.

## Next single action

Complete GitHub review and the full source gate for the R46 transport patch, merge it into Draft PR #20, pass the source gate on the resulting PR #20 head, and issue the four-field exact-object handoff. MiniMax and Codex remain stopped until then.
