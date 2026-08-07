# TASK — R48 Segmented Registry Prefetch

## Trigger evidence

MiniMax exact source: `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`.

Observed blocker: `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` during the single bounded native-toolchain hydration. No Candidate was created, no PASS native-cache receipt existed, and source remained unchanged.

## Allowed work

- add deterministic lockfile registry-prefetch planning;
- use bounded npm processes to seed the isolated npm cache;
- keep lifecycle scripts disabled during registry prefetch;
- make the subsequent npm dependency install registry-offline while retaining the existing lifecycle asset proxy;
- add fail-closed source tests and Parent PM receipts.

## Forbidden work

- retry/backoff/resume;
- reuse of the failed partial cache;
- host allowlist expansion;
- Candidate online authority;
- source/package/lockfile product changes;
- credentials, signing, notarization, cloud, or global-config changes;
- direct merge to `main`.

## Acceptance

- `scripts/candidate-r30/*.test.mjs` PASS;
- complete `copilot-source-gate` PASS;
- merge only into Draft PR #20 source branch;
- re-run complete source gate on resulting exact PR #20 head;
- issue a new exact-SHA MiniMax handoff with all-new local paths.