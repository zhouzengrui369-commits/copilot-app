# RESULT — R48 Segmented Registry Prefetch

## Remote source result

Implemented a bounded source repair for repeated npm registry transport resets during native-toolchain hydration.

The old source ran one registry-heavy `npm ci --prefer-online`, allowing a small number of CONNECT tunnels to carry hundreds of MiB over long durations. R48 now derives exact registry tarballs from package-lock v3, canonicalizes reviewed registry origins to `registry.npmjs.org`, deduplicates by tarball URL/integrity, and prefetches them in deterministic 24-item `npm pack --ignore-scripts` batches. Each batch is a fresh npm child process with existing zero-retry transport policy.

After prefetch, the lifecycle install executes `npm ci --offline` inside the existing bounded online-asset sandbox. npm registry access is therefore cache-only at that stage; lifecycle-only official Node/Electron/GitHub assets can still use the unchanged localhost CONNECT proxy. Existing Electron arm64 native hydration and later full deny-network install/native proofs remain unchanged.

## Preserved controls

- one Owner authority / one hydrator invocation;
- `automaticRetry=false`;
- no retry/backoff/resume;
- no partial-cache reuse;
- official host allowlist unchanged;
- Candidate Gate 1–12 deny-network unchanged;
- no package/lockfile/product/database/vector-store/cloud changes.

## Source validation

Implementation head `a3f87e71930857ac71abe626fea115aa709996ee` passed `copilot-source-gate` run `31155823536` with all 17 workflow steps successful. This task receipt is tracked afterward, so the final evidence-containing PR head is revalidated separately before merge.

## Truth boundary

No local hydration, Candidate, Electron runtime, artifact, runtime ID, signing, notarization, or Codex acceptance was executed by ChatGPT. Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY`.