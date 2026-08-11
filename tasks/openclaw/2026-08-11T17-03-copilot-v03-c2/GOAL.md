# GOAL — Copilot Shared Knowledge Engine C2

Goal ID: `COPILOT-SKE-V03-C2-R1`
State: `SOURCE_IMPLEMENTATION_ACTIVE`
Parent: `COPILOT-SKE-V03-C1-R1`
Base planning SHA: `1e65b20f5b0874d23419a3f4a625b8761b775fe4`

## Goal

Add the storage-neutral lifecycle that turns C1 canonical objects into trustworthy managed knowledge without touching the protected MVP lane or current physical database schemas.

C2 owns the contract-level lifecycle for:

- ingestion receipts and idempotency;
- compiler outcomes and provenance;
- review queue and explicit decisions;
- contradiction/conflict records;
- supersession and user-correction lineage.

## Customer value

The product must never pretend that a failed import, partial compile, stale source, unreviewed model inference or conflicting assertion is accepted knowledge. Users and future Agents must be able to inspect what happened, why a fact is pending/disputed/superseded, and who accepted or rejected a change.

## Contract authority

- ecosystem SHA: `e46c4be501c465884486a4417adca2e158a58ccc`
- Shared Knowledge Engine blob: `caf9864f49dfb923f88f7125b7359d69b08865e4`
- contract version: `0.3.0-draft`
- Personal Data Security: `0.1.0`

## Hard boundaries

- PR #20 / `d450badfc85b65d3eef20f05eeb0607c1bf6a912` untouched.
- R72/R73/R75 evidence immutable.
- current KB/KG/RAG physical schemas unchanged.
- no package/lock/dependency change.
- no Electron/product Runtime change.
- C2 automated fixtures use D0/D1 only; D3 disabled.
- no Agent may self-accept permanent canonical knowledge.
- no failed/partial/stale lifecycle may emit a successful canonical-write result.
- conflicts preserve both competing assertions until an explicit resolution.
- no LLM Wiki implementation code/assets.

## Source gate

C2 source completion requires complete KB regression, focused lifecycle tests, strict per-file >=90% statements/lines/branches/functions for every Shared Engine lifecycle file, storage-neutral boundary enforcement and source-clean proof.

Source PASS does not imply persistence, Electron Runtime, Agent-client, product-experience or reference-implementation completion.