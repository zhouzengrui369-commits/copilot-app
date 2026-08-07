# GOAL — R50 Metadata-Complete Registry Prefetch

Repair the exact-source native-toolchain hydration so npm's offline reify has both registry packument metadata and tarball bytes before lifecycle scripts run, while preserving one Owner-authorized hydration invocation, `automaticRetry=false`, no partial-cache reuse, unchanged official-host allowlist, and Candidate Gate 1–12 deny-network.

The triggering R49 source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` is consumed reference-only evidence after `npm ci --offline` reported `ENOTCACHED` for `typescript`; no Candidate/artifact/runtime was created.
