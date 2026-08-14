# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

## 2026-08-14 R6 Electron release-asset transport repair preparation

- R6 consumed PR #54 exact source `35b3c54059900528e33d79bbb15788479763a58d`, tree `8e931876dc705c33e743a554a69e5bd2640f68d6`, after source gate run `31769650208`, job `94672767727`, `17/17 PASS`.
- R6 ran the source contract once (`117/117 PASS`) and hydration once. It stopped immutable with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` during Electron `38.8.6` postinstall: `release-assets.githubusercontent.com:443`, upstream `ECONNRESET`, `503434` received bytes after `1195994ms`.
- R6 correctly did not apply the R5 `github.com + ETIMEDOUT + 1..65536` control-tunnel exception. Dry-run, Candidate, package, App, E2E and performance counts remained zero; the failed cache is non-reusable.
- The bounded repair under test prefetches only Electron `38.8.6` and `33.4.11` macOS arm64 ZIPs from their exact official release URLs in 1 MiB Range segments, concurrency 4, at most 3 attempts per segment, then requires each npm package's embedded SHA-256 before cache admission.
- Recoverable asset resets are eligible only in the explicit `electron-artifact-range-prefetch` proxy phase; other phases, hosts, codes, oversized transfers, protocol/range/length failures and final checksum mismatches remain fail-closed. Whole-hydration retry and partial-cache reuse remain false.
- Modern Electron's exact `electron_config_cache` variable is now bound to the receipt-owned cache for hydration and Candidate environments.
- Before the audit migration, focused contracts passed `33/33` and the complete non-nested macOS source contract passed `122/122`.
- Owner explicitly authorized the strict receipt-audit migration on 2026-08-14. The audit now rejects the superseded `npm ci --prefer-online --registry` lifecycle command and requires metadata-complete registry prefetch, deny-network offline closure, registry-offline lifecycle scripts, zero post-closure registry requests, the checksum-gated Electron artifact receipt, and the final deny-network proofs.
- The migrated focused contract passes `44/44`; the complete non-nested macOS Candidate source contract passes `124/124`, with zero failures, skips or cancellations. The same-SHA GitHub source gate remains pending; these remain source evidence only and R7 has not been created.
- Current state: `SOURCE_REPAIR_LOCAL_VALIDATION_PASS / OWNER_AUDIT_MIGRATION_AUTHORIZED / GITHUB_SOURCE_GATE_PENDING / R7_NOT_CREATED / APP_LAUNCHES=0`.

## 2026-08-14 R5 Electron control-tunnel repair

- R5 exact authority was PR #54 SHA `6d609d9c989a16e143d38e7a33b2d69d01f1d442`, tree `1b2ffaf673617393f42234f7a54bc1ded801687d`, source gate run `31761937329`, job `94649962981`, `17/17 PASS`.
- R5 ran the source contract once (`112/112 PASS`) and hydration once. It stopped immutable with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`; dry-run, Candidate, package, App, E2E and performance counts remained zero.
- Receipt evidence shows the large Electron release transfer reached `121555082` upstream-to-client bytes, while the fatal tunnel was the separate `github.com` control/redirect connection after `3088` bytes with upstream `ETIMEDOUT`; forced downstream destruction surfaced as Electron `install.js` `socket hang up`.
- The source repair allows graceful EOF only for `github.com + ETIMEDOUT + 1..65536 received bytes`. It remains fail-closed for release-assets, zero-byte, oversized, non-timeout and other-host errors. Downstream command success and the Electron package's embedded checksum remain mandatory.
- `automaticRetry=false`, `npmFetchRetries=0`, IPv4, allowlist, port, cache nonreuse and Candidate deny-network boundaries are unchanged.
- Complete source contract: `117/117 PASS` in the non-nested macOS environment. Nested execution produced the expected environment-only `sandbox_apply: Operation not permitted` on the existing Darwin grammar smoke while all other `116/117` passed.
- The source repair was committed and pushed as `3e1d742c5e76829e01c0a8c77bd0353fc301a268`, tree `94c520fd59191c863c8e6cf42449c6fb24ddec5e`. Its first GitHub source gate run `31768811097`, job `94670211578`, reached Step 14 and failed on one ambiguous test query: two legitimate Demo UI nodes contained `Current note`.
- Test-only commit `a4801a78` scopes both assertions to `studio-source-rail`; it changes no UI, production code, coverage threshold, transport policy or runtime behavior. Focused Studio tests pass `2/2`; the exact critical coverage command passes `101/101` files, `1113/1113` tests, `96.02%` statements and `91.89%` branches.
- Current state: durable handoff update and a new complete GitHub source gate are pending. R5 and all predecessor paths are immutable and ineligible for R6 reuse.
- Next step: push the final documentation-bearing PR #54 head, require the complete GitHub source gate on that exact SHA/tree, then issue all-new R6 authority. Packaged runtime and Human Owner milestone gates remain pending.

## 2026-08-13 web-first UI correction

- Exact base: Draft PR #20 `d450badfc85b65d3eef20f05eeb0607c1bf6a912`.
- Active branch: `codex/demo-ui-web-first-r1`.
- Sole UI authority: `design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html`, `52046` bytes, SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`.
- Objective: align and accept the browser renderer at 1440x900 before any Electron integration or package work.
- Completed: exact authority copied byte-for-byte; primary navigation corrected to four Demo destinations; Wiki Studio retained as a secondary Knowledge action; web-only typecheck/build, focused `21/21` UI tests, 1440x900 browser journey, zero console errors, `design-qa.md`, Draft PR #54, and GitHub source gate run `31751463041` job `94617911618` all passed.
- Parent PM technical decision: `PARENT_PM_WEB_ACCEPTANCE=PASS`; `HUMAN_OWNER_MILESTONE_GATE=PENDING` remains separate.
- Local deployment R1/R2 stopped during one-shot hydration on allowed-host transport failures; R3 exposed and stopped on a wall-clock watchdog test race. The deterministic test repair became source `c9ed8b346e60b580860e58dde459372a2f8384c4`, tree `a69b39aead99fc88b4b11de3e9598e650ddcd12b`, and passed source gate run `31758923541`, job `94640840476`, `17/17`.
- R4 proved exact authority and `111/111` source contracts, then its sole hydration stopped on `registry.npmjs.org:443` upstream `ETIMEDOUT`; Candidate and App executions remained zero.
- Transport diagnosis reproduced Node 24's default-family instability at `1/3` proxy success while direct curl IPv4 passed `3/3`. A diagnostic-only `family:4` proxy passed `3/3`, all nine allowlisted hosts exposed A records, and its audit was requests `3`, allowed `3`, denied `0`, errors `0`.
- Completed after that checkpoint: IPv4 source `6d609d9c989a16e143d38e7a33b2d69d01f1d442` passed source gate; R5 consumed it once and stopped on the later GitHub control-tunnel error described above.
- In progress: commit and source-gate the narrow graceful-control-close repair before any R6 authorization.
- Risks: browser fixture is not runtime proof; R1/R2/R3/R4/R5 are not Candidate evidence; no packaged Candidate, artifact identity, E2E, performance, signing, notarization, release, or Human Owner PASS exists.
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

Commit/push the authorization-bearing repair to a new exact PR #54 SHA/tree and require the complete GitHub source gate. Only that new green exact source may authorize an all-new R7; R1–R6 remain immutable reference-only.

Tracked status documents describe the current branch HEAD but do not self-reference their own commit hash. The exact pushed commit and Draft PR URL are the external Git authority for this web-only change.

Web-only typecheck, build, focused `21/21` UI tests, browser journey, zero browser console errors, and `design-qa.md` pass. The informational broad Desktop suite is explicitly `NOT PASS` (`112/142` files and `1208/1293` tests passed) because native/Electron lifecycle installation was intentionally excluded and the exact tree contains unrelated historical test blockers; see `reports/web-first-ui-r1/TEST_RECEIPT.md`. The watchdog repair changes only test timing determinism; production termination behavior is unchanged. The bounded IPv4 proxy repair is documented in `reports/native-proxy-family4-r1/TEST_RECEIPT.md`; the R5 control-tunnel repair is documented in `reports/native-proxy-graceful-control-r1/TEST_RECEIPT.md`; the R6 range-prefetch source preparation is documented in `reports/native-electron-range-prefetch-r1/TEST_RECEIPT.md`.
