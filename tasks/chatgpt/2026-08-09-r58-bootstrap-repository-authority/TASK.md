# TASK

## Trigger

MiniMax R57 on source `2927d0e3cd81e3997bb229ce544b95a1e3cbce8b` started one durable hydrator and stopped fail-closed in `registry_prefetch_manifest_enumeration` because R56 inferred the repository root from an extracted module path under `/private/tmp`.

## Required repair

- remove module-location repository-root inference;
- obtain repository authority from the hydration `--repository` contract or explicit library option;
- require exactly one absolute repository path;
- preserve root-lock closure authority and exact nested-lock identity supplementation only;
- add bootstrap-path regression coverage;
- run the complete Node 24/macOS source gate;
- merge only into Draft PR #20 after final exact-head source-green proof;
- require a new PR #20 source SHA for the next local run because R57 consumed hydration.

## Forbidden

No product feature changes, package/lockfile changes, workflow changes, host expansion, retry/resume, partial-cache reuse, Candidate network expansion, signing/notarization, cloud/global configuration, or merge to `main`.
