# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

## 2026-08-13 web-first UI correction

- Exact base: Draft PR #20 `d450badfc85b65d3eef20f05eeb0607c1bf6a912`.
- Active branch: `codex/demo-ui-web-first-r1`.
- Sole UI authority: `design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html`, `52046` bytes, SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`.
- Objective: align and accept the browser renderer at 1440x900 before any Electron integration or package work.
- Completed: exact authority copied byte-for-byte; primary navigation corrected to four Demo destinations; Wiki Studio retained as a secondary Knowledge action; web-only typecheck/build, focused `21/21` UI tests, 1440x900 browser journey, zero console errors, `design-qa.md`, Draft PR #54, and GitHub source gate run `31751463041` job `94617911618` all passed.
- Parent PM technical decision: `PARENT_PM_WEB_ACCEPTANCE=PASS`; `HUMAN_OWNER_MILESTONE_GATE=PENDING` remains separate.
- Local deployment R1/R2 stopped during one-shot hydration on allowed-host transport failures; R3 stopped before hydration on a wall-clock watchdog test race. All three evidence roots are immutable and bound only to `b8b04819ac25629b0f2a5135858532902567b794`.
- In progress: publish the deterministic watchdog test repair as a new exact PR #54 head and rerun the complete source gate.
- Next step: only after that new head passes GitHub source gate, issue an all-new local deployment successor bound to the new exact SHA.
- Risks: browser fixture is not runtime proof; R1/R2/R3 are not Candidate evidence; no packaged Candidate, artifact identity, E2E, performance, signing, notarization, release, or Human Owner PASS exists.
- Latest important change: `PARENT_PM_WEB_ACCEPTANCE=PASS / LOCAL_PACKAGED_ACCEPTANCE=PENDING / HUMAN_OWNER_MILESTONE_GATE=PENDING`.

R31 remains the authoritative Phase 1 source-completion baseline, including the historical Desktop Phase 1 source suite `1107/1107 PASS`. The R47 clean-room llm_wiki + Demo UI Knowledge Studio remains integrated in Draft PR #20. No packaged Electron Candidate, artifact SHA-256, runtime ID, Codex acceptance, signing/notarization, Release readiness, Experience readiness, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R31 pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`; source gate run `30819543111`, `17/17 PASS`; Desktop Phase 1 `1107/1107 PASS`
- R47 Knowledge Studio remains integrated in Draft PR #20.
- R65 root-closure completeness remains integrated and source-green.
- R66 consumed source: `beb951b95695233911da0a17543ef342acc6df93`; `106/106` source tests; root exact-spec completeness `1361/1361`; one hydrator; zero Candidate executions.
- R66 terminal blocker: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH` at batch 51 on invalid spec `string-width-cjs@4.2.3` `ETARGET`; all R66 local identities are immutable reference-only.
- R67 PR #36 final evidence head: `05185bf6d8239da22b80e89cf1c27edf1bb3d4c6`.
- R67 final source gate: run `31355390496`, final rerun job `93354715454`, `17/17 PASS`; initial Step 12 failure adjudicated CI transient by exact-diff proof and same-SHA rerun.
- R67 squash integration into Draft PR #20: `68e9cb99f65bfb79562c9e6d49cf9351cb8a70a5`.
- PR #20 exact head after the final authority-alignment commits must still complete the full source gate before MiniMax R68 is authorized.
- Electron list-only Candidate discovery remains exact `113 tests in 9 files`.

The **exact Git commit object**, not a branch name, stale worktree, browser fixture, CI summary, package output, or chat transcript, is the only deployment authority.

## R66 root cause / R67 repair

R66 did **not** prove that root `package-lock.json` requires wholesale regeneration. The failed entries are npm alias/install-path lock entries:

```text
node_modules/string-width-cjs
  name=string-width
  version=4.2.3

node_modules/strip-ansi-cjs
  name=strip-ansi
  version=6.0.1

node_modules/wrap-ansi-cjs
  name=wrap-ansi
  version=7.0.0
```

R65 exact-version-only fallback incorrectly treated the `node_modules/...` install-path tail as the registry package name. R67 repairs only that interpretation:

1. The entry must first be a real non-link `node_modules/...` path.
2. If that lock entry provides a valid `name`, the locked `name` is authoritative for registry prefetch.
3. Only entries without `name` fall back to the install-path package name.
4. Root/workspace entries outside `node_modules` remain excluded.
5. No package/lockfile regeneration, dependency version change, mirror/allowlist expansion, retry/resume change, Candidate network change, product runtime change, signing/notarization or `main` change is used.

R67 focused source contracts require:

```text
string-width@4.2.3        present
strip-ansi@6.0.1          present
wrap-ansi@7.0.0           present

string-width-cjs@4.2.3    absent
strip-ansi-cjs@6.0.1      absent
wrap-ansi-cjs@7.0.0       absent
```

Root exact-spec completeness remains fail-closed.

## Integrated product source

The demo-first Electron shell includes `知识台 / Wiki Studio` while retaining canonical `KnowledgeWorkspace`. The Studio provides Sources, digest-bound Wiki truth/provenance, projection-bound local Review Queue metadata, Activity over existing durable knowledge-build state, existing local Sigma/Graphology KG, clean-room 4-Signal Connections, and explicit `重新整理`. The GPLv3 `nashsu/llm_wiki` reference is clean-room adapted; no upstream implementation bytes, Tauri/Rust/DuckDB runtime, second DB/KB/vector store, Python daemon, or cloud truth is added.

## Preserved MVP critical loop

```text
local material
→ grounded Ask answer
→ clickable verified local source
→ full source reader
→ same Ask exchange after return
→ canonical Todo create/readback
→ All / Unscheduled exact Todo discovery
→ Todo edit and source preservation
→ schedule association
→ full Electron quit/relaunch persistence gate
```

## Role boundary

1. ChatGPT Parent PM owns bounded GitHub source work, exact-source freeze, PR review, and MiniMax task contract.
2. MiniMax starts only after the final exact PR #20 SHA passes the complete source gate; it cannot repair source during Candidate execution.
3. Codex starts independent product acceptance only after a complete source/artifact/runtime/test-data-bound MiniMax receipt exists.
4. Development Evidence Is Not Candidate Identity: CI, static tests, renderer/jsdom/browser fixture, build/package success, merge, or MiniMax self-test cannot substitute for packaged Electron acceptance.

## Remaining gates

- Pass `copilot-source-gate` on the resulting exact PR #20 head after the R67 authority alignment.
- Freeze that 40-character `EXACT_FINAL_HEAD` and make no later tracked source change.
- Issue MiniMax R68 with that new SOURCE_COMMIT, a new RUN_STAMP and six fresh local paths; R66 and all predecessor caches/evidence remain reference-only.
- Pre-network manifest must prove root completeness, `typescript@6.0.3`, `zustand@4.5.7`, real alias registry specs present and fake `*-cjs` registry specs absent.
- Pass bounded registry prefetch, strict registry-cache closure, zero post-closure registry requests and native hydration PASS receipt.
- Pass Candidate Gates 1–12, packaged Electron `113/113`, three performance runs, Wiki Studio, full Ask/source/Todo/schedule/quit-relaunch loop, local ASR, screenshots, identities/manifests, and clean termination.
- Let Codex independently operate that same packaged Candidate and report P0/P1/P2.

## Next single action

Push the deterministic watchdog-contract repair to Draft PR #54 and require the complete GitHub source gate on its new exact head. Only then may the existing local deployment executor receive a new independent successor identity; R1/R2/R3 remain immutable reference-only.

Tracked status documents describe the current branch HEAD but do not self-reference their own commit hash. The exact pushed commit and Draft PR URL are the external Git authority for this web-only change.

Web-only typecheck, build, focused `21/21` UI tests, browser journey, zero browser console errors, and `design-qa.md` pass. The informational broad Desktop suite is explicitly `NOT PASS` (`112/142` files and `1208/1293` tests passed) because native/Electron lifecycle installation was intentionally excluded and the exact tree contains unrelated historical test blockers; see `reports/web-first-ui-r1/TEST_RECEIPT.md`. The watchdog repair changes only test timing determinism; production termination behavior is unchanged. See `reports/watchdog-contract-r1/TEST_RECEIPT.md`.
