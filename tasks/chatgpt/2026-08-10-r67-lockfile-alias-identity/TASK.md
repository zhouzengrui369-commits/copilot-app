# TASK — R67

## Problem

R65 made registry-prefetch root-closure complete, but `exactVersionOnlyIdentity()` derived package names only from `node_modules/...` paths. npm alias lock entries therefore became invalid registry specs such as `string-width-cjs@4.2.3`, even though the same lock entry explicitly records `name: string-width`.

## Scope

Allowed:
- `scripts/candidate-r30/registry-prefetch.mjs`
- focused candidate-r30 tests
- Parent PM status/handoff/evidence docs

Forbidden:
- package/lockfile regeneration
- dependency upgrades/downgrades
- registry mirror or host allowlist changes
- retry/resume policy changes
- Candidate network changes
- product UI/runtime changes
- `main`

## Acceptance

1. Exact-version-only identity prefers a valid lock entry `name` only for `node_modules/...` paths.
2. Entries outside `node_modules` (including the root workspace entry) remain excluded.
3. Exact repository manifest includes `string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0`.
4. Exact repository manifest excludes `string-width-cjs@4.2.3`, `strip-ansi-cjs@6.0.1`, `wrap-ansi-cjs@7.0.0`.
5. Root exact-spec completeness remains fail-closed.
6. Full macOS source gate = 17/17 PASS on implementation Head and final evidence Head.
