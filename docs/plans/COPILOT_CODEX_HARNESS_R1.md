# COPILOT_CODEX_HARNESS_R1

> Repository: `zhouzengrui369-commits/copilot-app`  
> Program: `ECOSYSTEM-CODEX-HARNESS-R1`  
> State: `QUEUED / PLANNING_ONLY`  
> Owner: Copilot Project PM  
> Central capability: `zhouzengrui369-commits/knowme-ecosystem@fd01ef7619a31b7ffca5dd2205a2e31a96fac834`  
> Central PR: `knowme-ecosystem#21`  
> Parent PM Gateway/Runner: `chatgpt-parent-pm#12` / `chatgpt-parent-pm#14`  
> Runner plan: [`COPILOT_SELF_HOSTED_RUNNER_ADOPTION_R1.md`](./COPILOT_SELF_HOSTED_RUNNER_ADOPTION_R1.md)

## 1. Purpose

Adopt the centrally governed Codex Harness in two separated roles:

1. bounded engineering worker runtime;
2. policy-filtered external knowledge Agent with proposal-only writes.

It must not become the Shared Knowledge Engine, a physical database API, a persistent knowledge store through Codex Thread history, an unreviewed canonical writer, the product packaging/Candidate harness, product Runtime or release acceptance.

## 2. Execution-plane boundary

```text
GitHub Self-hosted Runner
  = outer local Mac execution, worktree/process/cache/artifact authority

Codex Harness
  = optional Agent session inside an authorized Runner request
```

Every local Codex session requires a valid LocalExecutionRequest. It may not widen paths, commands, network, secrets, data or claim layer.

## 3. Protected lanes

Before activation, restore live GitHub truth for:

- authoritative MVP PR #20;
- active PR #54;
- Shared Knowledge Engine PR #40 C6 Runtime and C7;
- all consumed predecessor worktrees/caches/artifacts/receipts;
- Geo Context PR #28;
- Harness PR #56 / Issue #57;
- Runner plan/tracker;
- any later successor.

Creation anchor `5afb4cb78f6fd83c592fd699dc4499cab8bf88f5` does not replace live truth.

Required invariants:

```text
CODEX_THREAD != KNOWLEDGE_OBJECT
CODEX_ITEM != CANONICAL_SOURCE
CODEX_APP_SERVER != SHARED_KNOWLEDGE_ENGINE
COPILOT_SQLITE_TABLE != ECOSYSTEM_API
AGENT_WRITE_DEFAULT=PROPOSAL_ONLY
PRODUCT_CANDIDATE_ID != RUNNER_ATTEMPT_ID
PREDECESSOR_ASSET_REUSE=NO
```

## 4. Allowed R1 use cases

### Engineering

- adapter/MCP/API/SDK/migration/test development;
- Electron source/test engineering;
- synthetic D0/D1 fixtures;
- exact source/test/build evidence;
- bounded read-only diagnostics.

### Policy-filtered external Agent

- read-only D0 synthetic Source/Knowledge/Entity/Relation retrieval through a versioned interface;
- exact consumer/namespace/purpose/operation permission;
- grounded source IDs;
- wrong scope denied without leakage;
- write proposal creation;
- review accept/reject;
- idempotent canonical application only after acceptance;
- audit and full-restart readback.

## 5. Forbidden R1 use cases

- physical SQLite tables as integration API;
- direct permanent model-output write;
- thread history as product truth;
- real D2/D3 knowledge;
- predecessor cache/worktree/receipt reuse;
- PR #20/#54/#40 Candidate mutation through this plan;
- silent model/provider/network fallback;
- global proxy/VPN/system network change;
- direct main, merge, sign, notarize or release;
- Harness/Runner receipt promoted to C6/C7/Product/Owner PASS.

## 6. Policy

```text
CODING_PROFILE=Luna/xhigh
PRODUCT_EXPERIENCE_PROFILE=Sol/xhigh
SILENT_FALLBACK=FORBIDDEN
CONTRACT_LABEL_strongest=FORBIDDEN
INITIAL_ENGINEERING_DATA=D0_D1_SYNTHETIC
INITIAL_AGENT_DATA=D0_SYNTHETIC
ENGINEERING_MAX_APPROVAL=A2_TEST_BUILD
AGENT_READ_MAX_APPROVAL=A0_READ_ONLY
AGENT_WRITE=PROPOSAL_ONLY
NETWORK=DENY_UNLESS_EXACT_TASK_GRANT
RUNNER_REQUEST_REQUIRED=YES
```

## 7. Activation prerequisites

- [ ] PR #20/#54/#40 live truth restored;
- [ ] explicit transition or non-conflicting lane;
- [ ] predecessor assets protected;
- [ ] central Runner registration topology and Gateway accepted;
- [ ] exact Runner health and toolchain;
- [ ] stable Codex Binary/Protocol Lock;
- [ ] Luna/xhigh available;
- [ ] Shared Knowledge Engine contract version/hash pinned;
- [ ] repository-local GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log;
- [ ] synthetic data manifest;
- [ ] policy-filtered read/proposal/review/audit contracts;
- [ ] product Candidate identity separated from Runner/Harness task identity.

Until then:

```text
COPILOT_HARNESS_STATE=QUEUED
```

## 8. Milestones

### CH0 — Current truth and duplicate-runtime mapping

Map current product packaging/hydration/Candidate scripts, central Runner plane and Codex Harness. Do not delete product-owned packaging authority without parity/rollback.

### CH1 — Engineering adapter Pilot

Use Luna/xhigh on one bounded adapter/test task with fresh Runner/Harness identities, synthetic data, exact files and source/test/build receipts only.

### CH2 — Policy-filtered read-only Agent

Prove grounded D0 retrieval and denials for wrong consumer/namespace/purpose/expiry/data class/physical-table attempt. No canonical write.

### CH3 — Proposal/review lifecycle

```text
Agent proposal
→ proposal object + source/session/evidence
→ canonical store unchanged
→ review accept/reject
→ accepted idempotent write only
→ audit + full restart readback
```

### CH4 — Security, portability and lifecycle

Validate local/cloud transparency, network receipt, secret redaction, export/import without physical-schema leakage, delete/tombstone and session cleanup.

### CH5 — Runner/Harness failure recovery and product review

- injected Runner or Harness failure uploads evidence;
- Web Parent PM creates GitHub successor;
- no automatic Codex Runner repair;
- independent Copilot product review remains separate;
- Human Owner decides integration value.

## 9. Existing Candidate harness migration rule

```text
INVENTORY
→ classify product packaging vs generic Agent runtime
→ compare central Runner/Gateway
→ adapter/coexistence plan
→ deterministic parity tests
→ fresh exact-SHA Candidate
→ rollback proof
→ only then retire duplicate generic code
```

Predecessor receipts remain immutable and cannot become central Runner/Harness evidence.

## 10. Evidence contract

Record central Runner/Harness and Shared Engine pins, RunnerProfile/request hashes, Binary/Schema/model, source/final SHA/tree, synthetic data identity, policy grants/denials, proposal/review receipts, commands/checks/diff/artifacts, network/redaction/process state, nested Harness receipt, outer Runner receipt, first blocker, claim layer and next authority.

## 11. Claim ceiling

```text
PLANNING_ONLY
CURRENT_MVP_PR20_CHANGE=NO
CURRENT_PR54_GATE_CHANGE=NO
CURRENT_PR40_C6_C7_GATE_CHANGE=NO
RUNNER_ADAPTER=NOT_STARTED
CODEX_HARNESS_ADAPTER=NOT_STARTED
SHARED_ENGINE_REFERENCE_IMPLEMENTATION_CLAIM=NO
PRODUCT_RUNTIME_CHANGE=NO
REAL_PERSONAL_DATA=NO
AGENT_DIRECT_CANONICAL_WRITE=NO
PREDECESSOR_ASSET_REUSE=NO
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
PROJECT_PM_ACTIVATION_REQUIRED
```
