# EVIDENCE — R50

## Trigger evidence

MiniMax R49 exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2` stopped before Candidate creation. Source contracts were `95/95 PASS`; the strict lifecycle `npm ci --offline` reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`, proving R48 tarball-only prefetch had not closed npm registry metadata cache requirements.

R49 source, partial cache, task/evidence paths and run stamp are immutable reference-only evidence and are not inputs to R50.

## R50 source evidence

Implementation head: `88d66a34b3416a917ef1a39ac6d1e72ea8540922`

`copilot-source-gate`:

- run `31160628979`
- job `92809916272`
- Node 24 macOS
- 17/17 workflow steps SUCCESS

Passed surfaces include exact-head checkout/toolchain identity, exact lockfile install, candidate fail-closed source contracts, R31 embedded RAG slice, ordered workspace build, local-first checks, unit/integration, desktop build, Desktop Phase 1 source suite, strict core/Desktop coverage, production CycloneDX SBOM, exact Electron suite discovery, and final tracked-source unchanged verification.

## New fail-closed contracts

- `lockfile-batched-name-version-npm-pack-v2`
- `metadataMode=name-version-packument-and-tarball`
- batch size `24`
- registry cache closure: `(deny network*) npm ci --offline --ignore-scripts`
- closure failure: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`
- registry request after closure: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`
- `automaticRetry=false`
- predecessor partial-cache reuse remains forbidden
- Candidate network remains denied

## Runtime boundary

`NOT_RUNTIME_PROOF`. No successful local hydration, Candidate, artifact SHA-256, runtime ID, packaged Electron result, Codex acceptance, signing, notarization, or release action is claimed here.
