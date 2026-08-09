# COPILOT-SPATIAL-KNOWLEDGE-R1 — Copilot Project PM Delivery Plan

Status: `DEFERRED_CURRENT_MVP`
Execution owner: **Copilot Project PM**
Capability authority: `zhouzengrui369-commits/knowme-ecosystem@6edb5401084de24491038ac55525f584e9943bd7`
GeoScene schema SHA-256: `8695f3d9d376bf5591138d78b1460c17758845312aeca52a4a0597ee873032df`

## Ownership contract

This plan is deliberately deferred. The Copilot Project PM owns activation, implementation, worker assignment, candidate freeze, local Electron deployment/testing, independent review and product delivery. The ecosystem capability PM must not add Geo Context runtime to Copilot simply because the central capability exists.

## Why deferred

Copilot Phase 1 is macOS-first and the current baseline explicitly excludes a 3D knowledge graph. Existing final-candidate coverage, Electron E2E, performance, signing, notarization and installation gates take priority. Geo Context must not become scope creep.

## Activation gate

Before creating an active Goal, the Copilot PM must confirm:
- current Phase 1 MVP gate is closed or Owner explicitly reprioritizes;
- the then-current central Geo Context version is revalidated by exact SHA/hash;
- local-first/offline authority remains unchanged;
- a real customer task justifies spatial knowledge view;
- current signing/notarization/release work is not displaced silently.

## Product outcome

Provide a local-first spatial view of knowledge that connects authorized place context with notes, entities, relationships, Todo/events and source evidence.

The first release is **2D local-first**. 3D remains optional and requires separate product-value evidence.

## Milestones

### M0 — Copilot PM activation and baseline freeze

Record:
- final completed/current release state;
- exact source preimage;
- central capability lock;
- target platform(s);
- customer journey and acceptance criteria;
- standard Goal/TASK/PLAN/RESULT/EVIDENCE chain.

Exit: active Goal exists without weakening local-first/security/release gates.

### M1 — Local spatial entity adapter

Map existing local notes/KG/entities/tasks/events to GeoScene-compatible spatial objects only when authoritative location evidence exists.

Exit:
- source IDs and bidirectional references preserved;
- missing coordinates remain unknown;
- no cloud requirement for core view;
- adapter fixtures/conformance pass.

### M2 — 2D local-first spatial knowledge view

Deliver the first customer-visible view integrated with existing KG/search/detail UX.

Required:
- search/filter;
- node selection/detail;
- source reference back to local note/KG entity;
- offline operation;
- empty/unknown state;
- no mandatory remote tiles/service for core truth where project policy forbids it.

Exit: one real local knowledge journey completes end-to-end offline where applicable.

### M3 — Knowledge/RAG context integration

Use spatial relations as retrieval context without making map coordinates the authority for unrelated knowledge.

Exit:
- answers preserve source references;
- location filters are inspectable;
- uncertain relations remain uncertain;
- no credential or local truth egress regression.

### M4 — Reliability/performance/migration

Copilot PM defines budgets for:
- large graph/location set rendering;
- Electron memory/CPU;
- startup/load latency;
- offline index rebuild;
- migration/rollback;
- deletion consistency.

Exit: representative macOS evidence and failure recovery pass.

### M5 — Exact-SHA Electron acceptance

Freeze one candidate and execute normal Copilot Electron E2E/device process.

Evidence:
- exact SHA/build artifact;
- real Electron runtime;
- offline/online behavior;
- search/filter/detail journeys;
- source parity;
- performance;
- screenshots/logs.

CLI/static tests cannot substitute for Electron evidence.

### M6 — Independent spatial product-experience review

Review:
- spatial usefulness vs duplicate KG view;
- local-first clarity;
- discoverability/navigation;
- source/freshness/uncertainty;
- accessibility/keyboard;
- empty/failure/recovery;
- product taste consistent with Copilot.

P0/P1 findings create successor candidates.

### M7 — Optional 3D decision gate

Only after the 2D product is accepted may the Copilot PM evaluate 3D.

3D activation requires:
- a customer task materially improved by depth/3D;
- performance budget;
- fallback strategy;
- no conflict with current product design;
- separate Goal/acceptance scope if material.

### M8 — Human Owner delivery gate

Final release/customer-value decision remains Human Owner-only and follows Copilot's normal signed/notarized/installable delivery contract when those gates apply.

## Explicit non-goals

- adding 3D during current Phase 1;
- replacing the existing local KG;
- making cloud services authoritative for spatial knowledge;
- copying upstream GPL Vue/Three.js source/templates/assets;
- starting implementation from this planning PR alone;
- weakening Electron E2E/signing/notarization gates to ship Geo Context faster.

## Definition of Done

This capability has zero Copilot product-completion weight until the **Copilot Project PM** activates the post-MVP Goal and completes exact-SHA Electron acceptance, independent review and Human Owner delivery.
