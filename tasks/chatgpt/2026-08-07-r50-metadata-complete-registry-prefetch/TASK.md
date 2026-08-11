# TASK — R50

## Trigger

MiniMax R49 on exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` passed exact-object authority and `95/95` source contracts, then stopped before Candidate creation. R48 tarball-only prefetch left npm packument metadata incomplete; `npm ci --offline` reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`.

## Allowed

- `scripts/candidate-r30/registry-prefetch.mjs`
- `scripts/candidate-r30/npm-native-cache-hydrate.mjs`
- `scripts/candidate-r30/native-cache-policy.mjs`
- direct candidate-r30 tests and R50 task/governance records

## Forbidden

- product/UI changes
- package or lockfile changes
- host allowlist expansion
- retry/backoff/resume
- predecessor cache reuse
- Candidate network authority
- credentials/global configuration/signing/notarization/main merge

## Acceptance

1. Lockfile registry entries become deterministic exact `name@version` specs while retaining canonical tarball + integrity identity.
2. Bounded `npm pack --ignore-scripts` uses `name@version` so npm caches registry metadata and tarball data.
3. A strict `(deny network*)` `npm ci --offline --ignore-scripts` proves registry cache closure before lifecycle scripts.
4. Lifecycle/native online-asset phase may use only the existing bounded proxy and must produce zero `registry.npmjs.org` requests after closure.
5. PASS receipt binds registry-prefetch strategy, manifest, closure proof, and zero post-closure registry requests.
6. Complete Node 24/macOS `copilot-source-gate` passes on final source.
