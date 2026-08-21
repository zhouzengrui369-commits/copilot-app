# COPILOT_SELF_HOSTED_RUNNER_ADOPTION_R1

> Repository: `zhouzengrui369-commits/copilot-app`  
> Program: `ECOSYSTEM-CODEX-HARNESS-R1`  
> Capability: `github-self-hosted-runner@0.1.0-proposed`  
> State: `QUEUED / PLANNING_ONLY`  
> Owner: Copilot Project PM  
> Central capability: `zhouzengrui369-commits/knowme-ecosystem@fd01ef7619a31b7ffca5dd2205a2e31a96fac834`  
> Central PR: `knowme-ecosystem#21`  
> Parent PM execution plane: `chatgpt-parent-pm#12` / `chatgpt-parent-pm#14`  
> Local Harness plan: [`COPILOT_CODEX_HARNESS_R1.md`](./COPILOT_CODEX_HARNESS_R1.md)

## 1. Goal

Add a thin Copilot adapter to the Parent PM central GitHub Self-hosted Runner Local Execution Plane for exact-SHA Electron packaging, native module staging, local database, offline model, Shared Knowledge Engine conformance and full-relaunch technical evidence.

```text
Copilot Parent PM exact-SHA request
→ Parent PM central dispatcher
→ Owner Mac mini Runner
→ fresh Copilot worktree/task/evidence roots
→ local technical Gate
→ ExecutionReceipt
→ Copilot Parent PM audit and next authority
```

The Runner is not the Copilot Candidate, Shared Knowledge Engine, external knowledge Agent, Product Experience reviewer, signing/notarization service or release authority.

## 2. Protected current lanes

The Project PM must restore live GitHub truth before activation:

- authoritative MVP PR #20 and current successor;
- active web-first/hydration PR #54 and current local Candidate state;
- Shared Knowledge Engine PR #40 C6 Runtime and C7 lock;
- all consumed predecessor worktrees, caches, artifacts, snapshots, Runtime data and receipts;
- Harness PR #56 / Issue #57;
- any later successor not named here.

At plan creation, PR #40's planning Head was `5afb4cb78f6fd83c592fd699dc4499cab8bf88f5`. This is a discovery anchor only.

Protected invariants:

```text
PRODUCT_CANDIDATE_ID != RUNNER_ATTEMPT_ID
PREDECESSOR_ASSET_REUSE=NO
PR20_PR54_PR40_GATE_CHANGE=NO
SIGNING_NOTARIZATION_RELEASE_CHANGE=NO
```

## 3. Activation prerequisites

- [ ] live PR #20/#54/#40 current identity and Gate restored;
- [ ] explicit current-lane transition or non-conflicting Goal recorded;
- [ ] predecessor assets frozen/non-reusable;
- [ ] central Runner registration topology accepted;
- [ ] Parent PM dispatcher/schemas/security Pilot accepted;
- [ ] fresh Runner health/toolchain receipt;
- [ ] Shared Knowledge Engine contract version/hash pinned;
- [ ] repository-local GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log;
- [ ] exact product source SHA/tree and fresh task identity;
- [ ] synthetic test-data manifest;
- [ ] native staging/full-relaunch/evidence contract;
- [ ] rollback and no-main/no-release boundary.

Until then:

```text
COPILOT_RUNNER_STATE=QUEUED
```

## 4. Allowed R1 task kinds

- Electron production build/package;
- isolated Electron-version/architecture native rebuild;
- `better-sqlite3` or other declared native module stage/load proof;
- local SQLite schema/migration/readback;
- local Ollama/embedding model and expected dimension proof;
- Note/Source/Wiki/KG/RAG/Todo/Schedule technical paths;
- same-userData full quit/relaunch;
- Shared Knowledge Engine D0/D1 policy/conformance;
- synthetic performance runs;
- artifact, source, Runtime, network and process receipts.

## 5. Forbidden R1 task kinds

- reuse of consumed predecessor cache/worktree/receipt/evidence;
- physical SQLite schema exposed as ecosystem API;
- real personal D2/D3 data;
- direct canonical Agent write;
- local source repair outside exact allowlist;
- unapproved registry/mirror/proxy/VPN/system network change;
- silent model/provider/network fallback;
- signing, notarization or release;
- Runner PASS promoted to C7/Product Experience/Human Owner PASS.

## 6. Initial policy

```text
DATA=D0_OR_SYNTHETIC_D1
D2_D3=DENY
NETWORK=DENY_OR_EXACT_ALLOWLIST
SECRETS=NONE_OR_NAMED_MINIMAL
SOURCE_MUTATION=DENY_OR_EXACT_ALLOWLIST
MAX_LOCAL_CONCURRENCY=1
FRESH_WORKTREE_TASK_EVIDENCE_ROOT=REQUIRED
PREDECESSOR_CACHE_REUSE=NO
CODING=Luna/xhigh
PRODUCT_EXPERIENCE=Sol/xhigh
SILENT_FALLBACK=FORBIDDEN
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
```

## 7. Milestones

### CR0 — Current truth and task selection

- live PR #20/#54/#40 snapshot;
- current source/Candidate/Runtime identity;
- protected predecessor manifest;
- central contract pin;
- first task and claim layer;
- activation or factual blocker.

### CR1 — Request, profile and native toolchain

Create LocalExecutionRequest with:

- exact product repository/PR/branch/SHA/tree;
- exact request path/hash;
- required macOS ARM64 RunnerProfile;
- Node/Electron/native toolchain contract;
- allowed/protected paths;
- network/cache policy;
- expected checks/artifacts;
- product Candidate identity separate from attempt identity.

### CR2 — Fresh Electron build and native stage

- new attempt/worktree/task/evidence roots;
- fresh `dist:mac:dir` or repository-authoritative package path;
- isolated correct Electron/arm64 native rebuild;
- root Node native input unchanged where required;
- atomic packaged native stage;
- `PACKAGED_NATIVE_LOAD_OK`;
- domain smoke;
- exact test discovery and one authorized full E2E;
- complete source/build/artifact receipt.

### CR3 — Database, offline model and full relaunch

Prove with synthetic data:

- local database identity and migration;
- production Note/Source/KG/RAG paths;
- local embedding model and vector dimensions;
- same-userData full quit/relaunch/readback;
- deletion/portability technical truth;
- no cloud/provider fallback;
- processes terminal.

### CR4 — Shared Engine security conformance

- D0 positive and D2/wrong-consumer denial;
- Agent proposal-only write authority;
- physical schema hidden;
- no secret/private leakage;
- no product-data mutation outside task;
- exact conformance receipt.

### CR5 — Failure recovery and rollback

- inject bounded native-stage/workflow/timeout failure;
- upload partial evidence;
- Web ChatGPT Parent PM creates GitHub successor;
- new attempt and no predecessor reuse;
- uninstall/rollback and process/port cleanup.

### CR6 — Product audit and Owner decision

The Copilot Parent PM audits technical receipts before any C7 authorization. Independent product experience remains separate. Human Owner decides controlled rollout and any signing/notarization/release step.

## 8. Codex Harness relationship

An optional Codex engineering session may run only inside the Runner request:

```text
Runner LocalExecutionRequest
→ pinned Codex Gateway/Binary/Schema
→ Luna/xhigh bounded engineering task
→ nested Harness receipt
→ outer Runner ExecutionReceipt
```

Codex Thread/Items are not knowledge truth, and Codex cannot repair Runner authority automatically.

## 9. Evidence contract

Required:

- request/profile hashes;
- exact source SHA/tree and source snapshot identity;
- Runner version/OS/ARM64/toolchain;
- workflow run/job/attempt IDs;
- fresh worktree/task/evidence roots;
- cache and predecessor non-reuse proof;
- native stage/load/domain smoke;
- commands/exit codes/test discovery;
- artifact/Candidate identity and hashes;
- data manifest;
- Runtime/process/network receipts;
- source pre/post clean;
- claim layer/first blocker/next authority.

## 10. Claim ceiling

```text
PLANNING_ONLY
CURRENT_PR20_PR54_PR40_GATE_CHANGE=NO
RUNNER_ADAPTER=NOT_STARTED
PRODUCT_CANDIDATE=NOT_CREATED_BY_THIS_PLAN
SHARED_ENGINE_REFERENCE_IMPLEMENTATION_CLAIM=NO
PRODUCT_EXPERIENCE_PASS=NO
REAL_D2_D3_DATA=NO
PREDECESSOR_ASSET_REUSE=NO
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
PROJECT_PM_ACTIVATION_REQUIRED
```

## 11. First takeover output

```text
COPILOT_SELF_HOSTED_RUNNER_TAKEOVER_COMPLETE
CURRENT_PR20_SHA=
CURRENT_PR54_GATE=
CURRENT_PR40_C6_GATE=
CURRENT_C7_STATE=
PREDECESSOR_ASSETS_PROTECTED=
CENTRAL_CAPABILITY_SHA=
PARENT_PM_LOCAL_EXECUTION_PLANE_STATE=
RUNNER_PROFILE_STATE=
COPILOT_RUNNER_STATE=QUEUED|ACTIVATED|BLOCKED
FIRST_USE_CASE=
PRODUCT_SOURCE_SHA=
PRODUCT_CANDIDATE_ID=
RUNNER_ATTEMPT_ID=
DATA_CLASS=
CURRENT_FIRST_BLOCKER=
NEXT_GOAL=
NEXT_AUTHORITY=
PREDECESSOR_REUSE=NO
REAL_D2_D3_DATA=NO
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
```
