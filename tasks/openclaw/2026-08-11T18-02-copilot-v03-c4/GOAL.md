# GOAL — Copilot Shared Knowledge Engine C4

Goal ID: `COPILOT-SKE-V03-C4-R1`
State: `SOURCE_IMPLEMENTATION_ACTIVE_STACKED`
Parent: `COPILOT-SKE-V03-C3-R1`
Base accepted C3 Head: `7236d102013d2b909f4c0bd62f14516cf0e99939`
Dependency: PR #46 source accepted but not yet merged because the GitHub connector could not transition Draft -> Ready.

## Goal

Create the first versioned, transport-neutral Agent capability/API contract over the Shared Knowledge Engine without exposing physical databases, renderer IPC or permanent-write authority.

C4 owns:

- capability manifest and deterministic manifest identity;
- explicit version negotiation;
- bounded namespace/purpose/privacy/object-type read grants;
- optional `WRITE_PROPOSAL` authority only;
- policy-filtered canonical object reads;
- C3 unified retrieval delegation;
- proposal submission;
- content-safe Agent audit receipts;
- deterministic conformance fixtures.

## Customer value

External Agents can use Copilot knowledge through a predictable, auditable and least-privilege interface without direct database access. Users keep control of what an Agent can read, why it can read it and whether it may merely propose a write. No Agent can silently accept permanent knowledge, resolve conflicts, delete data or expand its own permissions.

## Contract authority

- ecosystem SHA: `e46c4be501c465884486a4417adca2e158a58ccc`
- Shared Knowledge Engine blob: `caf9864f49dfb923f88f7125b7359d69b08865e4`
- contract version: `0.3.0-draft`
- Personal Data Security: `0.1.0`

## Hard boundaries

- C4 is stacked on C3 and cannot merge ahead of PR #46.
- PR #20 and R72/R73/R75 evidence remain untouched.
- no current KB/KG/RAG/Wiki physical store/API exposure.
- no renderer/main IPC promotion to ecosystem API.
- no network server or MCP transport implementation in this bounded source slice; the API is transport-neutral and conformance-testable.
- automated fixtures are D0/D1 only; D3 disabled.
- write mode is only `NONE` or `WRITE_PROPOSAL`.
- no Agent endpoint for accept/reject/dispute/conflict resolution/canonical commit/delete/sync/admin permission changes.
- expired, malformed or version-mismatched capability fails closed.
- no package/lock/dependency change.
- no Electron Runtime/product UI change.

## Source gate

C4 source completion requires complete KB regression, strict per-file >=90% statements/lines/branches/functions for all Shared Engine files, content-safe conformance tests, storage-neutral boundary enforcement and source-clean proof.

Source PASS does not prove a real MCP server, network API, Agent client, Electron Runtime, customer-value gate or reference implementation completion.