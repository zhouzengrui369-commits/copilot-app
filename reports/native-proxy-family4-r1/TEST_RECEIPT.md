# Native hydration proxy IPv4 repair receipt

Date: 2026-08-14

## Trigger

R4 evidence root:

`/Users/njx/copilot-evidence/c9ed8b346e60b580860e58dde459372a2f8384c4-20260814T010224Z`

R4 passed exact authority and `111/111` source contracts, then its sole hydration stopped at registry batch `1/57` with upstream `ETIMEDOUT`. Candidate, App, artifact, E2E, and performance executions were zero.

## Diagnosis

- Exact default-family proxy preflight: `1/3` HTTP success, two upstream `ETIMEDOUT` events at approximately 3.7s and 3.0s.
- Direct curl IPv4 metadata: `3/3` HTTP 200.
- Diagnostic-only proxy differing only by `family:4`: `3/3` HTTP 200, TLS verify 0.
- Diagnostic proxy audit: requests `3`, allowed `3`, denied `0`, transport errors `0`, positive bidirectional bytes.
- Exact allowlist DNS A records: `9/9 PASS`.
- Diagnostic root: `/private/tmp/copilot-owner-transport-family4-preflight-20260814T013803Z`.

## Bounded source change

- The native hydration CONNECT proxy creates one upstream socket with `family:4`.
- `proxyUpstreamFamily=4` is included in the receipt-bound transport policy and proxy socket audit.
- Automatic retry remains `false`; npm fetch retries remain `0`.
- Host allowlist, destination port, registry/mirror, timeouts, concurrency, watchdog, partial-cache nonreuse, Candidate network denial, and package/lockfile bytes are unchanged.

## Verification

```text
node --test \
  scripts/candidate-r30/native-cache-transport.test.mjs \
  scripts/candidate-r30/native-cache-receipt-audit.test.mjs \
  scripts/candidate-r30/npm-native-cache-hydrate.test.mjs

23/23 PASS

node --test \
  scripts/candidate-r30/document-authority.test.mjs \
  scripts/candidate-r30/native-cache-transport.test.mjs \
  scripts/candidate-r30/native-cache-receipt-audit.test.mjs \
  scripts/candidate-r30/npm-native-cache-hydrate.test.mjs

30/30 PASS

node --test scripts/candidate-r30/*.test.mjs

112/112 PASS
```

The complete command was run outside the nested Codex sandbox so the real `/usr/bin/sandbox-exec` grammar smoke could execute. GitHub source-gate identity is recorded after push.

## Gate statement

This receipt proves the bounded source repair and its diagnostic basis only. It is not hydration PASS, Candidate, packaged Electron, E2E, performance, signing, notarization, release, or Human Owner evidence. R5 requires the repaired exact PR head and complete GitHub source gate PASS.
