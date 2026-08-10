# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

R31 remains the authoritative Phase 1 source-completion baseline, including the historical Desktop Phase 1 source suite `1107/1107 PASS`. The R47 clean-room llm_wiki + Demo UI Knowledge Studio remains integrated in Draft PR #20. No packaged Electron Candidate, artifact SHA-256, runtime ID, Codex acceptance, signing/notarization, Release readiness, Experience readiness, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Consolidated MVP Draft PR: `#20`, branch `chatgpt/mvp-source-finalization`
- R31 pre-Studio source: `0131db4fb70ec4bb31ca10dc5ec11fafbf7eaf29`; source gate run `30819543111`, `17/17 PASS`; Desktop Phase 1 `1107/1107 PASS`
- R47 Knowledge Studio integration remains part of Draft PR #20.
- R65 root-closure completeness source is integrated and source-green.
- R66 consumed source: `beb951b95695233911da0a17543ef342acc6df93`; MiniMax source tests `106/106 PASS`; root exact-spec completeness `1361/1361 PASS`; one hydrator; zero Candidate executions.
- R66 terminal blocker: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH` at prefetch batch 51 on `string-width-cjs@4.2.3` `ETARGET`; predecessor cache/evidence is immutable reference-only.
- R67 repair branch: `chatgpt/r67-lockfile-alias-identity`, Draft PR #36.
- R67 code-green head: `20003b07b8137a369263e0fadb3b4f4171d7d392`; source gate run `31354821614`, job `93352458882`, `17/17 PASS`.
- R67 final evidence-containing head: pending final source gate.
- Electron list-only Candidate discovery remains exact `113 tests in 9 files`.

The **exact Git commit object**, not a branch name, stale worktree, browser fixture, CI summary, package output, or chat transcript, is the only deployment authority.

## R66 root cause / R67 repair

R66 did **not** prove that the root `package-lock.json` needs wholesale regeneration. The failed lock entry is an npm alias/install-path entry:

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

R65 exact-version-only fallback incorrectly treated the `node_modules/...` install-path tail as the npm registry package name. R67 repairs only that interpretation:

1. The entry must first be a real non-link `node_modules/...` path.
2. If that lock entry provides a valid `name`, the locked `name` is authoritative for registry prefetch.
3. Only entries without `name` fall back to the install-path package name.
4. Root/workspace entries outside `node_modules` remain excluded.
5. No package/lockfile regeneration, dependency version change, registry mirror/allowlist expansion, retry/resume change, or Candidate network change is used.

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

- Pass `copilot-source-gate` on the final evidence-containing R67 PR #36 head.
- Squash PR #36 only into Draft PR #20 with expected-head binding; do not merge `main`.
- Align PR #20 authority and pass `copilot-source-gate` on the resulting exact PR #20 head.
- Freeze that 40-character `EXACT_FINAL_HEAD` and make no later tracked source change.
- Issue MiniMax R68 with a new SOURCE_COMMIT, RUN_STAMP and six fresh local paths; R66 and all predecessor caches/evidence remain reference-only.
- Pass Candidate Gates 1–12, packaged Electron `113/113`, three performance runs, Wiki Studio, full Ask/source/Todo/schedule/quit-relaunch loop, local ASR, screenshots, identities/manifests, and clean termination.
- Let Codex independently operate that same packaged Candidate and report P0/P1/P2.

## Next single action

Pass the complete source gate on the final evidence-containing R67 PR #36 head, integrate only into Draft PR #20, then freeze a source-green exact PR #20 successor for MiniMax R68. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY` until independent packaged Electron evidence exists.
