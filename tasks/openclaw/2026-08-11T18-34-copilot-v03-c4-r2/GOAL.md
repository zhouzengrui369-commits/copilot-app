# GOAL — Copilot Shared Knowledge Engine C4 R2

Goal ID: `COPILOT-SKE-V03-C4-R2`
State: `SOURCE_IMPLEMENTATION_ACTIVE_STACKED`
Parent: `COPILOT-SKE-V03-C3-R1`
Base accepted C3 Head: `7236d102013d2b909f4c0bd62f14516cf0e99939`
Dependency: PR #46 source accepted but not merged because Draft -> Ready transition is blocked by the GitHub connector/tool layer.
Predecessor: `chatgpt/v03-c4-agent-capability-api-r1` is `PRE_GATE_REJECTED_IMPLEMENTATION` after Parent PM static review found write-proposal privacy/consumer-scope enforcement incomplete. It is not a candidate and must not be merged.

## Goal

Create the first versioned, transport-neutral, least-privilege Agent capability/API contract over the Shared Knowledge Engine without exposing physical databases, renderer IPC or permanent-write authority.

C4 R2 owns:

- deterministic capability manifests and exact contract-version negotiation;
- namespace/purpose/D0-D1/object-type/consumer bounded authority;
- policy-filtered canonical reads;
- C3 stale-safe and policy-first retrieval delegation;
- `WRITE_PROPOSAL` only, with the proposed object required to pass the same canonical read-policy scope before a proposal can be created;
- short machine-code Agent reasons/audit metadata;
- deterministic D0/D1 conformance fixtures.

## Hard boundaries

- C4 cannot merge ahead of C3 PR #46.
- PR #20 and R72/R73/R75 evidence are immutable and untouched.
- no current KB/KG/RAG/Wiki physical store or renderer/main IPC is a cross-product API.
- no network/MCP server deployment in C4; contract remains transport-neutral.
- automated fixtures use D0/D1 only; D3 disabled.
- write authority is `NONE | WRITE_PROPOSAL`; no terminal review/conflict/canonical-write/delete/sync/admin authority.
- every Agent operation revalidates capability version, integrity and expiry.
- proposal target must pass capability namespace, purpose, consumer, privacy and object-type policy; D2/D3 or wrong-consumer objects fail closed even if write_mode is `WRITE_PROPOSAL`.
- no package/lock/dependency or Electron Runtime change.

## Source gate

Complete KB regression + strict per-file >=90% statements/lines/branches/functions for all Shared Engine source + storage-neutral scan + source-clean.

Source PASS does not claim an MCP server, real Agent client, packaged Electron Runtime, customer-value gate or reference implementation completion.