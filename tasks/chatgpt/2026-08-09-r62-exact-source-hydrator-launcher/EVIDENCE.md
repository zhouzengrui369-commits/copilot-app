# EVIDENCE

## GitHub source identity

- Repository: `zhouzengrui369-commits/copilot-app`
- Draft source PR: #20
- R62 stacked PR: #33
- R62 branch: `chatgpt/r62-exact-source-hydrator-launcher`
- R62 base: `d805c6570366bc181612f712073ef7dd0e2912a8`
- Code-green Head: `4eefd70786c8e8a4c5c5a5b7aeda1205e8918735`

## R61 terminal evidence accepted by Parent PM

R61 exact source and source gate were valid. `101/101` source contracts and the pre-network registry-manifest proof passed. The manifest bound canonical `typescript@6.0.3`, batch size 24, `npmPackMaxSockets=12`, 834 entries, 4 supplemental lockfiles, 501 supplemental identities and SHA-256 `95100e2918a013170591656ac2d8d5e902133b34c11621f78bef7c1ce4551061`.

The one real hydrator invocation stopped `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS` because an ad-hoc local shell wrapper created the cache directory before hydrator preflight. Cache content remained empty; no PASS receipt or Candidate existed. Under Tier B, `SOURCE_CONSUMED=true`.

## R62 implementation proof

Exact diff from the source-green PR #20 base to R62 code Head contains only:

```text
scripts/candidate-r30/native-cache-background-launch.mjs
scripts/candidate-r30/native-cache-background-launch.test.mjs
```

No Desktop/product/package/lockfile/workflow source changed.

The launcher source contract proves:

- explicit absolute one-shot arguments;
- exact-source hydrator path under the supplied repository;
- cache/PASS-receipt absent at spawn;
- cache/PASS-receipt still absent after launcher setup;
- only exclusive stdout/stderr/launch-receipt evidence created;
- evidence paths under cache target rejected;
- existing cache target rejected without deletion;
- detached Node child, `shell:false`, no `setsid`;
- `automaticRetry=false`, `replacementProcessAllowed=false`.

## Source gate

Workflow: `copilot-source-gate`
Run: `31311068596`

First job `93238866921`:
- Candidate source contracts PASS;
- RAG PASS;
- ordered workspace PASS;
- local-first checks PASS;
- core suites PASS;
- desktop build PASS;
- Desktop Phase 1 FAIL;
- later steps skipped.

Because the exact diff has no Desktop/product/test/package/lock/workflow changes, Parent PM allowed one same-SHA GitHub job verification with no tracked or threshold change.

Final job `93239595966`:

```text
17/17 SUCCESS
```

This adjudicates the first Desktop Phase 1 failure as CI transient, not source regression.

## Safety

```text
PRODUCT_SOURCE_CHANGED=false
PACKAGE_OR_LOCKFILE_CHANGED=false
WORKFLOW_CHANGED=false
HOST_ALLOWLIST_EXPANDED=false
MIRROR_CHANGED=false
AUTOMATIC_RETRY=false
CANDIDATE_NETWORK_AUTHORITY=deny-network
MAIN_CHANGED=false
LOCAL_CANDIDATE_EXECUTED_BY_CHATGPT=false
```

## Remaining gate

The evidence/authority commits change the R62 Head. That final evidence-containing exact Head must pass the complete source gate before PR #33 can squash-merge into Draft PR #20. After integration, the resulting PR #20 exact Head must pass the complete source gate before R63 local execution is authorized.
