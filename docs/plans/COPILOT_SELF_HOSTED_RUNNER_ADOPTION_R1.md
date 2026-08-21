# COPILOT_SELF_HOSTED_RUNNER_ADOPTION_R1 — SUPERSEDED

> Repository: `zhouzengrui369-commits/copilot-app`  
> Visibility: `public`  
> Status: `SUPERSEDED_BY_ADR_0009`  
> Superseding plan: [`COPILOT_LOCAL_AGENT_DEPLOYMENT_R1.md`](./COPILOT_LOCAL_AGENT_DEPLOYMENT_R1.md)

## Decision

The Human Owner accepted:

```text
PRIVATE_REPOSITORY -> MAC_MINI_SELF_HOSTED_RUNNER
PUBLIC_REPOSITORY  -> OWNER_DESIGNATED_LOCAL_AGENT
```

`copilot-app` is public. Therefore this repository must not register or route GitHub Actions jobs to the Owner Mac mini Self-hosted Runner.

This file remains as planning history only. No Runner implementation, registration, workflow or product Gate is authorized from it.

## Preserved boundaries

- PR #20, PR #54 and PR #40 current identities/Gates remain protected;
- predecessor worktrees/caches/artifacts/receipts remain immutable and non-reusable;
- Product Candidate identity remains separate from local execution attempt identity;
- Shared Knowledge Engine remains separate from Codex Harness and local deployment;
- no D2/D3, signing, notarization, merge or release authority.

## Current authority

Use:

```text
docs/plans/COPILOT_LOCAL_AGENT_DEPLOYMENT_R1.md
```

and the current Local Agent tracker.
