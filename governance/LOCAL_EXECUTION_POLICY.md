# Copilot App Local Execution Policy

Status: HUMAN_OWNER_ACTIVE_DECISION
Effective: 2026-09-08
Authority: `zhouzengrui369-commits/knowme-ecosystem#32`

This policy changes only the project-development/local-execution topology. It does not remove or restrict the product capability to connect to a user-operated self-hosted OpenAI-compatible LLM endpoint.

## Canonical execution topology

```text
GITHUB=SINGLE_AUTHORITATIVE_FACT_SOURCE_AND_REMOTE_CONTROL_PLANE
LOCAL_EXECUTOR=OWNER_DESIGNATED_LOCAL_AGENT
LOCAL_EXECUTION_ROUTE=LOCAL_AGENT_ONLY
SELF_HOSTED_RUNNER_EXECUTION=RETIRED
SELF_HOSTED_RUNNER_FALLBACK=FORBIDDEN
SILENT_EXECUTOR_FALLBACK=FORBIDDEN
```

The existing OpenClaw/MiniMax worker route in `AGENTS.md` may act as the Owner-designated Local Agent when the Owner authorizes it for the task. This policy does not authorize any local agent to expand beyond the current task contract.

## Local Agent boundary

For a frozen exact-SHA local execution request, the Local Agent may materialize the authorized candidate, use approved Owner-machine credentials/tooling, run prescribed build/runtime/browser/device/data/deployment observations, and return sanitized evidence.

Unless an explicit project contract grants narrower non-product setup authority, it must not mutate candidate source/tests/locks, repair the candidate, commit/push, expand scope, issue product acceptance, or merge/release.

## Self-hosted Runner migration

Any active roadmap, CI/CD plan, task contract, workflow, script or bootstrap instruction that proposes GitHub Self-hosted Runner as the project-development/local-execution mechanism is superseded prospectively by this policy.

Normal GitHub-hosted CI may remain where useful. Product-facing references to a self-hosted LLM/model endpoint are outside this migration and must not be removed merely because they contain the words `self-hosted`.

Historical disabled-workflow notes, receipts and prior execution evidence remain immutable history for their original context.

Technical CI/CD documentation or workflow cleanup is performed by a separate Engineering Delivery context rather than Product Governance.
