# Copilot v0.3 Shared Knowledge Engine Reference Implementation Plan

> **Plan ID**: `COPILOT-SHARED-KNOWLEDGE-ENGINE-V03-R1`  
> **State**: `QUEUED / PLANNING_ONLY`  
> **Execution owner**: Copilot Project PM  
> **Ecosystem authority**: `zhouzengrui369-commits/knowme-ecosystem@e46c4be501c465884486a4417adca2e158a58ccc`  
> **Ecosystem PR**: `knowme-ecosystem#17`  
> **Date**: 2026-08-11

---

## 1. Purpose

Establish Copilot App as:

1. an independent local-first knowledge-base management product; and
2. the first complete reference implementation of the ecosystem Shared Knowledge Engine contract.

Copilot remains useful to users who do not use KnowMe. The shared-engine work turns Copilot's existing Note, Source, Wiki, KG, RAG, model and desktop capabilities into a versioned, inspectable and reusable knowledge service without making its physical database or Electron UI the ecosystem contract.

---

## 2. Protected current truth

Before activating this plan, the Copilot Project PM must read current GitHub truth, including:

- repository takeover/governance entry and current Project Profile;
- authoritative macOS MVP Draft PR #20 and its current exact source/candidate status;
- R72 and R73 local lifecycle terminal receipts and Parent PM adjudication;
- any current successor authorization added after R73;
- current source-gate, local candidate, product-experience, signing/notarization and release Gates;
- open Geo Context planning PR #28 and legacy Draft lanes.

Known predecessor constraints that remain immutable:

- R72 used one fresh hydration and fail-closed on the Electron online lifecycle transport abort;
- R73 used one separate fresh lifecycle and fail-closed on the authorized outer-driver timeout before a native-cache PASS receipt;
- R72/R73 worktrees, caches, partial bytes, receipts, logs, task roots and prospective candidate identities are predecessor evidence and cannot be reused, repaired, deleted or relabelled;
- no native-cache PASS receipt, candidate artifact, Runtime identity or product acceptance was produced by those runs;
- the exact current GitHub PR description, not this plan, is the final source of truth if a later successor exists.

Hard protection:

- no Shared Knowledge Engine change may be added to a frozen MVP/candidate SHA;
- no predecessor result may be presented as conformance or Runtime proof;
- no source, dependency, network policy, signing/notarization or release Gate is changed by this planning branch;
- migration remains `QUEUED` until the Copilot Project PM records a clean transition from the current MVP lane.

---

## 3. Product and architecture ownership

Copilot owns:

- source adapters, import and incremental ingestion;
- canonical knowledge objects, typed relations, revisions and provenance;
- deterministic parsing and model-assisted knowledge proposals;
- review queue, conflict sets, expiry, correction and supersession;
- Note, Source, Wiki, 2D card and knowledge-graph management experiences;
- full-text, vector and graph retrieval bound to stable object IDs;
- grounded model use and provider configuration;
- MCP, API, SDK and versioned policy-filtered read-only views;
- capability/Agent authorization and access/write receipts;
- backup, restore, export, import, migration, deletion and optional sync;
- local-first Electron desktop operation and independent Copilot customer value;
- exact-version Shared Knowledge Engine conformance artifacts.

Copilot does not own:

- KnowMe's personal digital-twin policy;
- dynamic `ContextSnapshot`;
- proactive recommendation timing and interruption policy;
- personal decision/outcome learning policy;
- product-specific AOG, Lingxi or ebook experiences.

The ecosystem contract is storage-neutral. Copilot may use SQLite, vector indexes or other internal components, but physical tables and process boundaries are implementation details unless exposed through a separately versioned, policy-filtered interface.

---

## 4. Reference implementation shape

```text
Copilot desktop management product
        ↕
versioned Shared Knowledge Engine boundary
        ├── ingestion gateway
        ├── raw source vault
        ├── knowledge compiler
        ├── review/conflict lifecycle
        ├── canonical object store
        ├── full-text/vector/graph/Wiki projections
        ├── retrieval/context assembly
        ├── MCP/API/SDK/read-only views
        ├── backup/export/import/deletion
        └── permission/audit plane
        ↕
KnowMe and other contract-compatible consumers
```

The first release may run in-process inside Copilot if the contract boundary is real and testable. A later service/daemon shape is an implementation ADR, not a prerequisite to define the contract.

---

## 5. Milestone plan

### C0 — Current-state mapping and transition

Activation deliverables:

- factually close or transition the current MVP candidate lane under its existing governance;
- create repository-local Goal/TASK/PLAN/RESULT/EVIDENCE/commands.log;
- pin the accepted/frozen ecosystem commit and Shared Knowledge Engine contract version/hash;
- inventory current Note/Wiki/KG/RAG/Source/Model/Today/Schedule/ASR components;
- classify each component as `CONFORMS`, `ADAPT`, `MIGRATE`, `DEPRECATE`, `PRODUCT_UI_ONLY` or `OUT_OF_SCOPE`;
- identify physical schema leakage, duplicate object identities and missing provenance/review/privacy behavior;
- preserve all predecessor evidence and rollback paths.

Gate:

> A bounded implementation slice can be selected without modifying the current protected candidate or pretending current code already conforms.

### C1 — Canonical object and provenance adapter

Implement the ecosystem object envelope over the smallest useful current objects:

- source/document;
- note/knowledge;
- Wiki page or section;
- entity/relation;
- conversation/answer evidence where currently supported.

Required behavior:

- stable IDs and revisions;
- `tenant_id` and namespace;
- source refs and observed/valid time;
- assertion type and confidence;
- review status;
- privacy class and purpose policy;
- relation lineage, contradiction and supersession;
- deterministic migration and rollback receipts.

Gate:

> Existing user knowledge remains readable and recoverable; index rebuild does not change canonical identity; source and migration evidence are exact.

### C2 — Ingestion, compiler and review lifecycle

- versioned adapter manifests and cursors;
- idempotent import and explicit partial/stale/failure states;
- deterministic parsing before model assistance;
- model/provider/recipe/source/cost/confidence receipts;
- review queue with policy auto-accept only for low-risk deterministic transforms;
- conflict set, expiry and revalidation;
- proposed personal facts and sensitive inferences never auto-promote silently.

Gate:

> Repeating an import is idempotent, failures preserve prior verified knowledge, and every accepted object can be traced to source/transformation/review.

### C3 — Stable-ID retrieval and projections

- full-text, vector and graph retrieval over the same canonical object identity;
- permission and namespace filtering before context assembly;
- evidence-bearing result envelopes;
- Wiki, card and graph projections with source/review/privacy state;
- deterministic rebuild of indexes/projections;
- missing/unknown information represented explicitly.

Gate:

> Search, Wiki, graph and grounded answer return the same object IDs and citations; disputed/proposed/inferred claims remain visibly labelled.

### C4 — Agent access gateway

Deliver versioned:

- MCP resources/tools;
- local API/SDK;
- optional policy-filtered read-only database views;
- capability manifest and scoped short-lived tokens;
- request purpose, privacy ceiling and rate limits;
- read receipts;
- write-proposal receipts and rollback;
- delegation restrictions;
- emergency lock behavior.

Hard rule:

> “Let any Agent read the database” means an explicit policy-filtered, versioned interface. Unrestricted physical table access is not a production contract.

Gate:

> An unauthorized namespace/privacy/purpose read and an unapproved Agent write fail closed and produce content-safe audit evidence.

### C5 — Portability, backup, deletion and sync

- complete export manifest with objects, relations, provenance, review state and allowed source bytes;
- import round trip with checksums and schema negotiation;
- backup/restore and corruption/failure behavior;
- deletion propagation through sources, canonical objects, Wiki/card/graph/vector/full-text projections, caches and replicas;
- tombstone behavior without retained deleted content;
- optional object-level sync and explicit conflicts;
- no last-write-wins for permissions, review, D2/D3 or accepted personal facts.

Gate:

> A clean environment can restore/export/import the accepted slice, and deletion receipts accurately state what is complete or pending.

### C6 — Security and conformance release

Required conformance areas:

1. object/version negotiation;
2. provenance and fact/inference/review labels;
3. tenant/namespace isolation;
4. D0–D3 policy and D3 ordinary-index exclusion;
5. idempotent ingestion/conflict behavior;
6. stable-ID retrieval/projection parity;
7. Agent read/write/rollback receipts;
8. export/import/backup/restore;
9. deletion propagation;
10. offline/failure truth where claimed;
11. restricted-upstream contamination/license checks;
12. exact source/artifact/runtime binding.

Deliver a versioned local artifact/library/service boundary consumable without importing Copilot UI code.

Gate:

> `REFERENCE_IMPLEMENTATION_CANDIDATE` may be claimed only from exact conformance evidence and a reproducible Copilot Runtime; source tests alone are insufficient.

### C7 — Copilot product value and Human Owner Gate

Independent product review must test real knowledge-management journeys:

- import and truthful failure/recovery;
- browse/search/Wiki/graph/source continuity;
- review/conflict/correction;
- model-grounded answer and evidence;
- Agent permission transparency;
- backup/export/delete/restore;
- full quit/relaunch and offline behavior where claimed;
- local-first usability and performance.

Human Owner separately decides whether Copilot is a useful knowledge product and whether the reference implementation is ready to be consumed by KnowMe/other products.

---

## 6. LLM Wiki boundary

LLM Wiki remains an architectural research reference for incremental Wiki compilation, graph metadata, review queues, MCP/skills and research workflows.

Before using any upstream code or assets:

- pin repository and exact revision;
- inspect license and transitive assets;
- decide clean-room, process isolation, allowed reuse or no-use in an accepted ecosystem ADR;
- preserve required attribution;
- add contamination checks;
- prove the Copilot distribution model is compatible.

Until then, only independently designed concepts/contracts may be implemented. “Similar feature” is not permission to copy source.

---

## 7. Compatibility and release claims

Allowed states:

```text
QUEUED
ACTIVATED
CONTRACT_MAPPING_COMPLETE
CONFORMANCE_SLICE_SOURCE_PASS
REFERENCE_IMPLEMENTATION_CANDIDATE
LOCAL_RUNTIME_PASS
PRODUCT_EXPERIENCE_PASS
HUMAN_OWNER_GATE_REQUIRED
ACCEPTED_REFERENCE_IMPLEMENTATION_<VERSION>
BLOCKED_<FACTUAL_CAUSE>
```

Forbidden shortcuts:

- `SHARED_ENGINE_COMPLETE` from documents/types only;
- `AGENT_READY` from unrestricted local database reads;
- `LOCAL_FIRST` while core use silently depends on cloud;
- `DELETE_COMPLETE` before projections/replicas/backups reach declared state;
- `MVP_COMPLETE` or `RELEASE_READY` from reference-conformance tests alone.

---

## 8. Initial implementation slice recommendation

After the current MVP transition, prioritize:

```text
Source + Knowledge/Note + Wiki + Entity/Relation
→ stable object/provenance/review adapter
→ full-text/vector/graph retrieval
→ read-only MCP/API
→ export/import
```

Defer broad write APIs, sync, D3, multi-user and cloud service operation until the core read/review/portability slice is accepted.

---

## 9. Project PM first action

Return one current-truth snapshot:

```text
COPILOT_CURRENT_PROTECTED_PR=
CURRENT_SOURCE_SHA=
CURRENT_LOCAL_CANDIDATE=
CURRENT_GATE=
CURRENT_FIRST_BLOCKER=
R72_R73_ASSETS_IMMUTABLE=YES
V03_MIGRATION_STATE=QUEUED|ACTIVATED|BLOCKED
ACTIVATION_PREREQUISITE=
PINNED_ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
PINNED_SHARED_ENGINE_CONTRACT=NOT_YET_PINNED
NEXT_REPOSITORY_LOCAL_GOAL=
```

Do not create implementation commits until this snapshot and the current PR authority agree.
