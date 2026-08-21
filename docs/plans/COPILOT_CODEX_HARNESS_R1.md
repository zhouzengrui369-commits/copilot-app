# COPILOT_CODEX_HARNESS_R1

> Repository: `zhouzengrui369-commits/copilot-app`  
> Visibility: `public`  
> Program: `ECOSYSTEM-CODEX-HARNESS-R1`  
> State: `QUEUED / PLANNING_ONLY`  
> Owner: Copilot Project PM  
> Local deployment plan: [`COPILOT_LOCAL_AGENT_DEPLOYMENT_R1.md`](./COPILOT_LOCAL_AGENT_DEPLOYMENT_R1.md)

## 1. Purpose

Adopt Codex Harness in two separated roles:

1. bounded engineering runtime;
2. policy-filtered external knowledge Agent with proposal-only writes.

Because this repository is public, local deployment uses an Owner-designated Local Agent. No Self-hosted Runner may be registered for this repository.

## 2. Architecture

```text
Local Agent Deployment
  = exact-SHA local checkout/build/runtime/artifact execution

Codex Harness
  = optional Agent runtime selected by a LocalAgentDeploymentRequest

Shared Knowledge Engine
  = canonical source/knowledge/review/retrieval/permission truth
```

Required invariants:

```text
CODEX_THREAD != KNOWLEDGE_OBJECT
CODEX_ITEM != CANONICAL_SOURCE
CODEX_APP_SERVER != SHARED_KNOWLEDGE_ENGINE
COPILOT_SQLITE_TABLE != ECOSYSTEM_API
AGENT_WRITE_DEFAULT=PROPOSAL_ONLY
PRODUCT_CANDIDATE_ID != LOCAL_AGENT_ATTEMPT_ID
```

## 3. Protected lanes

Read live before activation:

- PR #20, PR #54 and PR #40 C6/C7;
- all predecessor worktrees/caches/artifacts/receipts;
- current Candidate/signing/notarization/release truth;
- Local Agent tracker and current visibility.

## 4. Policy

When Codex is selected:

```text
ENGINEERING_OR_DEPLOYMENT=Luna/xhigh
PRODUCT_EXPERIENCE=Sol/xhigh
SILENT_FALLBACK=FORBIDDEN
APP_SERVER=stdio-jsonl
PRODUCTION_WEBSOCKET=FORBIDDEN
```

Default deployment mode:

```text
SOURCE_MUTATION=NO
LOCAL_REPAIR=NO
PUSH=NO
MERGE=NO
```

## 5. Allowed use cases

- adapter/MCP/API/SDK/migration/test engineering;
- Electron and native staging engineering;
- synthetic D0/D1 fixtures;
- policy-filtered D0 read-only knowledge Agent;
- proposal/review/audit lifecycle;
- source/test/build receipts.

## 6. Forbidden

- Self-hosted Runner registration;
- physical SQLite schema as API;
- thread history as product truth;
- direct canonical model write;
- real D2/D3 data;
- predecessor reuse;
- source repair during deployment;
- silent model/provider/network fallback;
- direct main, signing, notarization or release;
- Harness/Local Agent PASS promoted to C6/C7/Product/Owner PASS.

## 7. Milestones

```text
CH0 current truth and runtime mapping
CH1 bounded engineering Pilot
CH2 policy-filtered read-only Agent
CH3 proposal/review lifecycle
CH4 security/portability/lifecycle
CH5 Local Agent failure handback and product review
```

Failure:

```text
Local Agent or Harness FAIL
→ terminal receipt
→ Web ChatGPT Parent PM GitHub successor
→ fresh local-Agent task
```

No silent local repair.

## 8. Claim ceiling

```text
PLANNING_ONLY
SELF_HOSTED_RUNNER=FORBIDDEN
CURRENT_PR20_PR54_PR40_GATE_CHANGE=NO
LOCAL_AGENT_DEPLOYMENT=NOT_STARTED
CODEX_HARNESS_ADAPTER=NOT_STARTED
REAL_D2_D3_DATA=NO
AGENT_DIRECT_CANONICAL_WRITE=NO
PREDECESSOR_ASSET_REUSE=NO
AUTO_MERGE_SIGN_NOTARIZE_RELEASE=NO
PROJECT_PM_ACTIVATION_REQUIRED
```
