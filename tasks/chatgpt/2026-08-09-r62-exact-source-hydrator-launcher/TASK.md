# TASK

## Trigger

R61 pre-network registry-manifest proof passed, then one real hydrator invocation failed `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS` because an ad-hoc local shell wrapper created the cache target before the hydrator. R61 is consumed and immutable evidence-only.

## Scope

- Add one exact-source Node background launcher.
- Require cache target and PASS receipt to be absent before spawn.
- Do not create either target in the launcher.
- Create only exclusive launcher evidence/log files outside the cache target.
- Start exactly one detached Node hydrator with `shell:false` and no `setsid` dependency.
- Preserve zero retry/resume/replacement, existing registry/host policy, and Candidate deny-network.
- Add focused source contracts.
- Update exact-object handoff truth and standard Parent PM evidence.
- Merge only into Draft PR #20 after complete source gates.

## Out of scope

Product features, package/lockfile changes, workflow changes, host/mirror changes, credentials, signing/notarization, cloud/global config, `main` merge, and local Candidate execution by ChatGPT.
