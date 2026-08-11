# GOAL — Copilot Shared Knowledge Engine C3

Goal ID: `COPILOT-SKE-V03-C3-R1`
State: `SOURCE_IMPLEMENTATION_ACTIVE`
Parent: `COPILOT-SKE-V03-C2-R1`
Base planning SHA: `266af98cde6c947df8ceb092d67f0197bd69ced0`

## Goal

Prove that one canonical knowledge object can be projected into multiple product/retrieval surfaces without creating duplicate truth, losing provenance, bypassing permission policy or leaking stale/denied content.

C3 contract surfaces:

- 2D Card projection;
- Wiki projection;
- Full-text projection;
- Vector projection;
- Graph projection;
- Dialogue Context projection;
- permission-filtered multi-retrieval;
- grounded context receipts.

## Customer value

Users can view, search, explore and ask across the same knowledge without wondering which UI/index has the authoritative truth. Every result remains traceable to the same canonical object/source/revision, and denied or stale data cannot silently enter answers.

## Contract authority

- ecosystem SHA: `e46c4be501c465884486a4417adca2e158a58ccc`
- Shared Knowledge Engine blob: `caf9864f49dfb923f88f7125b7359d69b08865e4`
- contract version: `0.3.0-draft`
- Personal Data Security: `0.1.0`

## Hard boundaries

- PR #20 and R72/R73/R75 evidence untouched.
- existing KB/KG/RAG/Wiki physical schemas and Runtime untouched.
- no package/lock/dependency change.
- projection records are rebuildable and explicitly non-authoritative.
- all projection surfaces preserve canonical `object_id`, content hash, revision, source refs and permission fingerprint.
- policy filtering happens before ranked result/context exposure.
- denied objects may produce content-safe audit counts/reasons but no denied content, score or projection payload.
- stale projection hits are rejected from grounded context.
- D3 disabled in C3 automated fixtures.
- no Agent write expansion.

## Source gate

C3 source completion requires complete KB regression plus strict per-file >=90% statements/lines/branches/functions for every Shared Engine source file, storage-neutral boundary enforcement and source-clean proof.

Source PASS does not imply real KG/RAG/Wiki persistence, packaged Electron Runtime, Agent client, product experience or reference-implementation completion.