# GOAL — Copilot v0.3 C0 Current-State Mapping and Contract Freeze

Goal ID: `COPILOT-SKE-V03-C0-R1`
Program: `ECOSYSTEM-V03-DIGITAL-TWIN-R1`
State: `ACTIVATED / C0_IN_PROGRESS`
Execution owner: `Copilot Project PM`
Date: `2026-08-11`

## Customer value

Protect the existing Copilot macOS MVP truth while creating a non-conflicting path that turns Copilot into an independent local-first knowledge-management product and the first complete Shared Knowledge Engine reference implementation.

The first bounded implementation slice must improve inspectability and portability of existing knowledge without changing the protected MVP candidate lane or exposing physical SQLite tables as the ecosystem contract.

## Protected current MVP lane

- Authoritative Draft PR: `#20`
- Current source Head: `d450badfc85b65d3eef20f05eeb0607c1bf6a912`
- Current source gate: `PASS` (`31461620914`, diagnostic job `93688293643`, 17/17)
- R75 local result: `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`
- Native-cache PASS receipt: absent
- Candidate/artifact/runtime: absent
- Current runtime gate: not started
- Current product-experience gate for current candidate: not started
- MVP/release/experience: not complete / not ready

R72/R73/R75 worktrees, caches, partial bytes, receipts, logs, task roots and prospective Candidate identities are immutable predecessor evidence and `FORBIDDEN_REFERENCE_ONLY`.

## v0.3 authority

Human Owner authorized Copilot to proceed under v0.3 requirements on 2026-08-11 without authorizing ecosystem PR merge.

Pinned ecosystem source:

- Repository: `zhouzengrui369-commits/knowme-ecosystem`
- Draft PR: `#17`
- Exact ecosystem SHA: `e46c4be501c465884486a4417adca2e158a58ccc`
- Ecosystem version: `0.3.0` (Draft candidate)
- Shared Knowledge Engine contract: `docs/architecture/shared-knowledge-engine.md`
- Exact Git blob SHA-1: `caf9864f49dfb923f88f7125b7359d69b08865e4`
- Personal Data Security Standard: `0.1.0`
- Security standard blob SHA-1: `43e75d53e5e4cdd5afbf182a5dad13a16dc28ee7`

## C0 outcome

C0 must establish one factual mapping from current Copilot Note/Source/Wiki/KG/RAG/Model/Todo/Schedule/ASR capabilities to the pinned storage-neutral contract, identify duplicate-truth and provenance/privacy/review gaps, and select the smallest C1 implementation slice.

## Hard boundaries

- No product runtime source change in C0.
- No change to PR #20 or its frozen source bytes.
- No reuse or mutation of R72/R73/R75 local evidence.
- No direct physical-table contract.
- No unrestricted Agent database read.
- Agent writes remain `WRITE_PROPOSAL -> REVIEW -> ACCEPT_OR_REJECT -> CANONICAL_WRITE`.
- No D3 enablement.
- No signing, notarization, merge-to-main or release authority.
- LLM Wiki implementation code/assets remain research-only until exact upstream revision, license/transitive review and clean-room/reuse ADR are accepted.

## Gate to C1

C1 may begin only when:

1. exact contract pin is recorded;
2. current physical schema mapping is reviewed;
3. current protected MVP lane is demonstrably untouched;
4. C1 scope is limited to an adapter/contract layer that preserves existing readable local knowledge and rollback;
5. tests can prove stable identity, provenance, review/privacy labels and no physical-schema exposure.