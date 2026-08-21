# COPILOT_CODEX_HARNESS_R1

> Repository：`zhouzengrui369-commits/copilot-app`  
> Program：`ECOSYSTEM-CODEX-HARNESS-R1`  
> State：`QUEUED / PLANNING_ONLY`  
> Execution owner：Copilot Project PM  
> Central capability：`zhouzengrui369-commits/knowme-ecosystem@8ccb543804a7881fd37b31e1ce35085ca7285a76`  
> Central Draft PR：`knowme-ecosystem#21`  
> Reference Gateway plan：`chatgpt-parent-pm#12`  
> Planning creation base：`chatgpt/v03-shared-knowledge-engine-plan-r1@5afb4cb78f6fd83c592fd699dc4499cab8bf88f5`

## 1. Purpose

Adopt the centrally governed Codex Harness in two explicitly separated roles:

1. **Engineering worker runtime** for bounded Copilot/Shared Knowledge Engine source and test tasks;
2. **Policy-filtered external Agent Pilot** that can read shared knowledge contracts and submit reviewable write proposals.

It must not become:

- the Shared Knowledge Engine;
- a Copilot physical database API;
- a persistent knowledge store through Codex Thread history;
- an unreviewed canonical knowledge writer;
- the existing macOS Candidate/hydration harness;
- product Runtime, signing, notarization or release acceptance.

## 2. Current protected lanes

Before activation, the Copilot PM must restore live GitHub truth for:

- authoritative macOS MVP PR #20 and current successor authority;
- web-first UI / hydration PR #54 and current local Candidate state;
- Shared Knowledge Engine PR #40, C6 fresh Runtime successor and C7 lock;
- all consumed predecessor worktrees, caches, artifacts, snapshots, Runtime data and receipts;
- Geo Context PR #28;
- any later successor not listed in this planning document.

At plan creation, PR #40 Head was `5afb4cb78f6fd83c592fd699dc4499cab8bf88f5`, with C6 Runtime requiring a fresh R5 successor and C7 locked pending Parent PM audit. This is a creation anchor, not permission to ignore later commits.

## 3. Critical architecture distinction

```text
SHARED_KNOWLEDGE_ENGINE=
  canonical objects + source/provenance + review/conflict + retrieval +
  policy-filtered interfaces + portability/deletion/sync

CODEX_HARNESS=
  engineering/agent session runtime + tools + approvals + event/evidence
```

Required invariants:

```text
CODEX_THREAD != KNOWLEDGE_OBJECT
CODEX_ITEM != CANONICAL_SOURCE
CODEX_APP_SERVER != SHARED_KNOWLEDGE_ENGINE
COPILOT_SQLITE_TABLE != CODEX_OR_ECOSYSTEM_CONTRACT
AGENT_WRITE_DEFAULT=PROPOSAL_ONLY
```

## 4. Allowed R1 use cases

### Engineering

- canonical adapter/MCP/API/SDK/migration/test development;
- Electron source/test engineering;
- synthetic D0/D1 fixtures;
- exact source/test/build evidence;
- bounded read-only diagnostics.

### Policy-filtered external Agent

- read-only D0 synthetic Knowledge/Source/Entity/Relation retrieval through a versioned contract;
- exact consumer/namespace/purpose/operation permission;
- grounded source IDs returned;
- wrong consumer/namespace denied without leakage;
- write proposal creation;
- user/reviewer accept/reject;
- idempotent canonical application after acceptance;
- audit receipt and full restart proof.

## 5. Forbidden R1 use cases

- physical SQLite tables as the integration API;
- direct permanent Knowledge writes from model output;
- using thread history as product truth;
- real personal D2/D3 knowledge in ordinary coding context;
- predecessor cache/worktree/receipt reuse;
- modifying PR #40/54/20 protected candidates through this planning lane;
- silent model/provider fallback;
- custom global proxy/VPN/network configuration;
- direct main, merge, signing, notarization or release;
- Harness receipt promoted to C6/C7/Product/Human Owner PASS.

## 6. Model, data and approval policy

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
```

## 7. Activation prerequisites

- [ ] PR #54, PR #40 C6 Runtime/C7 and authoritative MVP live truth restored;
- [ ] explicit transition or non-conflicting lane recorded;
- [ ] predecessor assets protected and non-reusable;
- [ ] central capability SHA revalidated;
- [ ] accepted Gateway/Binary/Protocol Lock available;
- [ ] exact Luna/xhigh profile available;
- [ ] Shared Knowledge Engine contract version/hash pinned;
- [ ] repository-local GOAL/TASK/PLAN/RESULT/EVIDENCE/commands.log;
- [ ] synthetic test-data manifest;
- [ ] policy-filtered read and proposal/review/audit contracts;
- [ ] product/runtime candidate identity separated from Harness task identity.

Until then：`COPILOT_HARNESS_STATE=QUEUED`.

## 8. Milestones

### CH0 — Current truth, duplicate-harness mapping and activation

Deliverables:

- current PR #20/#54/#40 exact identities and Gates;
- map repository-owned Candidate/hydration scripts versus official Codex Harness;
- identify code that remains product packaging authority versus possible central Gateway reuse;
- protected predecessor manifest;
- first use case, data and approval class;
- queue/activation decision.

No existing Candidate runner is replaced until an exact migration/parity/rollback Goal exists.

### CH1 — Engineering adapter Pilot

Use Luna/xhigh on one bounded Shared Knowledge Engine adapter or focused test task with:

- fresh worktree/task identity;
- exact allowed files;
- synthetic data;
- no product Runtime or native Candidate claim;
- test/build receipt;
- Draft PR only.

### CH2 — Policy-filtered read-only knowledge Agent

Prove against synthetic D0 objects:

```text
Codex Harness session
→ versioned policy-filtered API/MCP/SDK
→ Source/Knowledge/Entity/Relation with stable IDs
→ grounded response with source refs
```

Required denials:

- wrong consumer;
- wrong namespace;
- wrong purpose;
- expired permission;
- D2/D3 object;
- physical-table access attempt.

No canonical write occurs.

### CH3 — Write proposal and review lifecycle

Prove:

```text
Agent proposal
→ proposal object + source/session/evidence
→ canonical store unchanged
→ review accept or reject
→ accepted idempotent write only
→ audit and full restart readback
```

Rejected proposals remain non-canonical. Replayed approvals cannot duplicate writes.

### CH4 — Security, portability and lifecycle

Validate:

- model/provider/local/cloud transparency;
- network/egress receipt;
- Secret redaction;
- export/import without leaking physical schema;
- delete/tombstone and Agent-view disappearance;
- session cleanup and rollback;
- no thread data promoted to canonical objects without explicit accepted proposal.

### CH5 — Independent Copilot product and Human Owner review

Codex Sol/xhigh or Product Experience Reviewer operates the exact Copilot product independently. Review:

- Agent transparency;
- grounded sources;
- proposal/review experience;
- denial truth;
- offline/local behavior;
- product remains useful without KnowMe;
- no confusion between knowledge engine and coding agent.

Harness technical PASS is only a prerequisite. Human Owner decides product and reference-integration value.

## 9. Existing Candidate harness migration rule

Copilot already owns extensive exact-SHA packaging/hydration/Candidate scripts. Do not delete or replace them merely because Codex Harness exists.

Required migration sequence:

```text
INVENTORY
→ classify product packaging vs generic agent runtime
→ central Gateway capability comparison
→ adapter or coexistence plan
→ deterministic parity tests
→ fresh exact-SHA Candidate
→ rollback proof
→ only then retire duplicate generic code
```

Any predecessor receipt remains immutable and cannot be relabelled as Codex Harness evidence.

## 10. Evidence contract

Record:

- central capability and Shared Engine contract pins;
- Gateway/Binary/Schema/model identities;
- source/final SHA and task worktree;
- synthetic test-data identity;
- policy grants and denials;
- proposal/review/canonical write receipts;
- commands/checks/diff/artifacts;
- network/redaction/process state;
- first blocker, claim layer and next authority.

## 11. Claim ceiling

```text
PLANNING_ONLY
CURRENT_MVP_PR20_CHANGE=NO
CURRENT_PR54_GATE_CHANGE=NO
CURRENT_PR40_C6_C7_GATE_CHANGE=NO
CODEX_HARNESS_ADAPTER=NOT_STARTED
SHARED_ENGINE_REFERENCE_IMPLEMENTATION_CLAIM=NO
PRODUCT_RUNTIME_CHANGE=NO
REAL_PERSONAL_DATA=NO
AGENT_DIRECT_CANONICAL_WRITE=NO
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
PROJECT_PM_ACTIVATION_REQUIRED
```
