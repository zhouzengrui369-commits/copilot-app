# R65 Registry Closure Completeness

## Trigger

R64 consumed source `5924aa96df9a15399fde281c9a4935392c8123b8` after one real hydrator launch. Exact-source launcher and all 35 bounded registry-prefetch batches passed, but strict deny-network closure failed on `ENOTCACHED zustand@4.5.7`.

## Adjudication

The raw comparison `1548 package-lock paths vs 834 manifest entries` is not an authoritative completeness metric because the manifest deduplicates by exact `name@version`. The concrete bug is that root `package-lock.json` contains closure-required `node_modules/zustand@4.5.7` without `resolved`/`integrity`, and no tracked supplemental lock provides that exact tarball identity. The previous manifest silently skipped the exact spec.

## Repair

`buildRegistryPrefetchManifest` now covers every unique non-link root-lock `node_modules/**` entry with an exact version. Identity modes are:

- `lockfile-resolved-integrity` — root lock contains reviewed registry resolved URL and integrity;
- `tracked-supplemental-lock` — root exact spec is unresolved but a Git-tracked nested lock provides the same exact `name@version` identity;
- `root-lock-exact-version-only` — the root lock requires an exact `name@version` but no lock authority contains resolved/integrity.

Exact-version-only entries remain explicit with `resolved=null` and `integrity=null`; the source does not invent identity absent from the lock. `npm pack` receives only the exact spec.

Completeness is enforced before batching:

```text
completenessMode=root-unique-exact-specs-covered-v1
coveredRootClosureSpecCount=rootClosureSpecCount
entryCount=rootClosureSpecCount
```

Current-repository regression tests require `typescript@6.0.3` supplemental identity and `zustand@4.5.7` exact-version-only presence.

## Scope

No product UI/runtime, package/lockfile, workflow, mirror, reviewed-host allowlist, retry/resume policy, Candidate network authority, signing/notarization or `main` change.

## Code gate

Implementation Head `cb7cbd5051da759c388564ee87d6dc21f55d2e83` passed `copilot-source-gate` run `31348549679`, job `93334962219`, `17/17 SUCCESS`.

The final evidence-containing Head must independently pass the complete source gate before merge into Draft PR #20.
