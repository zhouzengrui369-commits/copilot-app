# GOAL — Copilot Shared Knowledge Engine C1

Goal ID: `COPILOT-SKE-V03-C1-R1`
State: `SOURCE_IMPLEMENTATION_ACTIVE`
Parent: `COPILOT-SKE-V03-C0-R1`
Base planning SHA: `66509b4eda084f08aa3bc957d92a59a59e097a4a`

## Goal

Introduce the first real, storage-neutral Shared Knowledge Engine source slice without modifying the protected MVP branch, current SQLite schemas, package lock or product Runtime.

C1 implements canonical objects and provenance for:

- Source
- Knowledge/Note
- Entity
- Relation

## Customer value

Existing local knowledge gains a stable, inspectable identity and provenance/review/privacy envelope that can later support Wiki, graph, retrieval, export and controlled Agent access without tying users or other products to Copilot's physical database layout.

## Contract authority

- ecosystem SHA: `e46c4be501c465884486a4417adca2e158a58ccc`
- Shared Knowledge Engine Git blob: `caf9864f49dfb923f88f7125b7359d69b08865e4`
- contract version: `0.3.0-draft`
- Personal Data Security: `0.1.0`

## Hard boundaries

- PR #20 and `d450badfc85b65d3eef20f05eeb0607c1bf6a912` untouched.
- R72/R73/R75 evidence untouched.
- no SQLite/KG/RAG schema migration in C1.
- no new npm dependency or package-lock change.
- no physical table name in the Shared Engine public contract.
- no unrestricted Agent database access.
- Agent writes are proposals only.
- automated C1 conformance data is D0/D1 only; D3 disabled.
- no LLM Wiki implementation code/assets.

## Source gate

C1 source completion requires build/check/tests plus focused conformance evidence. Source PASS does not imply Runtime, product experience, release or reference implementation acceptance.