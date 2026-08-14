# Native Electron artifact range-prefetch R1 test receipt

## Verdict

`OWNER_AUDIT_MIGRATION_AUTHORIZED / SOURCE_CONTRACT_PASS / GITHUB_SOURCE_GATE_PENDING / LOCAL_CANDIDATE_NOT_RUN / NOT_RUNTIME_PROOF`

## R6 immutable evidence basis

- Exact source: `35b3c54059900528e33d79bbb15788479763a58d`
- Exact tree: `8e931876dc705c33e743a554a69e5bd2640f68d6`
- Evidence root: `/Users/njx/copilot-evidence/35b3c54059900528e33d79bbb15788479763a58d-20260814T043156Z`
- Source gate: run `31769650208`, job `94672767727`, `17/17 PASS`
- Source contract: one execution, `117/117 PASS`
- Hydration: one execution, exit `2`, no automatic retry, failed cache non-reusable
- Terminal phase: `bounded-native-toolchain-lifecycle-install`, Electron `38.8.6` postinstall
- Terminal tunnel: `release-assets.githubusercontent.com:443`, upstream `ECONNRESET`, `503434` received bytes, `1195994ms`
- Proxy audit: requests `4`, allowed `4`, denied `0`, transport errors `1`, IPv4
- Dry-run, Candidate, package, App, E2E and performance executions: `0`

R6 remains immutable. Its worktree, failed cache, evidence and any partial asset bytes are not successor inputs.

## Repair contract

The repair does not convert a release-asset reset into a successful EOF. It adds an explicit pre-lifecycle phase after the strict registry-cache closure proof:

1. Install the exact lock graph under deny-network with lifecycle scripts disabled.
2. Resolve only the reviewed Electron lifecycle packages:
   - `apps/copilot-desktop/node_modules/electron@38.8.6`
   - `node_modules/electron@33.4.11`
3. Download each official macOS arm64 ZIP from the exact Electron GitHub release URL in `1 MiB` HTTP Range segments, concurrency `4`.
4. Permit at most `3` attempts per segment and no whole-hydration retry; protocol/status/range/length errors are never retried.
5. Permit a recoverable tunnel reset only while the proxy is in the exact `electron-artifact-range-prefetch` phase, only on reviewed Electron asset hosts/codes, and only below the receipt-bound encrypted-byte ceiling.
6. Validate the complete ZIP against the Electron npm package's embedded SHA-256 before it can enter the fresh Electron cache.
7. Bind versions, URLs, filenames, hashes, byte counts, segment/request/retry counts, proxy request indexes and the command receipt into hydration schema v2.
8. Keep the final Candidate install and native rebuild under deny-network. Candidate network authority remains unchanged.

Modern Electron reads `electron_config_cache`; the repair binds that exact variable to the receipt-owned cache in both hydration and Candidate environments while retaining `ELECTRON_CACHE` compatibility.

## Verification

Focused range downloader, transport, hydrator and strict receipt-audit suites:

```text
tests=33
pass=33
fail=0
```

Complete source-contract command, rerun outside the nested Codex sandbox so the real macOS `sandbox-exec` grammar smoke could execute:

```text
node --test scripts/candidate-r30/*.test.mjs
tests=122
pass=122
fail=0
skipped=0
cancelled=0
```

The first nested run passed `121/122`; its sole failure was `sandbox_apply: Operation not permitted` from the outer sandbox. The approved non-nested rerun passed the identical test.

## Owner-authorized strict audit migration

The production hydrator has used the stricter post-closure lifecycle command `npm ci --offline` since the metadata-complete registry design. The legacy strict audit still names and expects the superseded `npm ci --prefer-online --registry ...` command.

On 2026-08-14 the Owner explicitly authorized the complete local-deployment scope, including this exact audit migration. The updated audit simultaneously requires:

- metadata-complete registry prefetch PASS;
- deny-network `npm ci --offline --ignore-scripts` closure PASS;
- lifecycle `npm ci --offline` with scripts enabled;
- zero `registry.npmjs.org` requests after closure;
- the checksum-gated Electron range-prefetch receipt;
- final deny-network install and native proofs.

It also rejects the superseded online-registry lifecycle command. The migrated focused suites pass:

```text
tests=44
pass=44
fail=0
```

The post-authorization complete Candidate source contract passed in the non-nested macOS environment:

```text
node --test scripts/candidate-r30/*.test.mjs
tests=124
pass=124
fail=0
skipped=0
cancelled=0
```

The same-SHA GitHub source gate must still pass before R7 authority. No Candidate, package or App launch has occurred.
