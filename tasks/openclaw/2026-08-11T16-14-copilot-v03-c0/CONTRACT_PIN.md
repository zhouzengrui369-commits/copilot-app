# CONTRACT PIN — Copilot Shared Knowledge Engine v0.3 C0

## Ecosystem authority

```text
PROGRAM_ID=ECOSYSTEM-V03-DIGITAL-TWIN-R1
ECOSYSTEM_REPOSITORY=zhouzengrui369-commits/knowme-ecosystem
ECOSYSTEM_PR=17
ECOSYSTEM_PR_STATE=OPEN+DRAFT
ECOSYSTEM_CANDIDATE_SHA=e46c4be501c465884486a4417adca2e158a58ccc
ECOSYSTEM_VERSION=0.3.0
HUMAN_OWNER_COPILOT_USE_AUTHORIZATION=YES_2026-08-11
ECOSYSTEM_MERGE_AUTHORIZATION=NO
```

Human Owner authorization applies to Copilot implementation against this exact ecosystem candidate. It does not rewrite GitHub state and does not claim ecosystem PR #17 is merged or generally released.

## Shared Knowledge Engine contract

```text
CONTRACT_PATH=docs/architecture/shared-knowledge-engine.md
SHARED_ENGINE_CONTRACT_VERSION=0.3.0-draft
SHARED_ENGINE_CONTRACT_HASH_ALGORITHM=git-blob-sha1
SHARED_ENGINE_CONTRACT_HASH=caf9864f49dfb923f88f7125b7359d69b08865e4
```

Required invariant:

`physical storage != ecosystem contract`

The stable cross-product contract is the object/provenance/review/privacy/access behavior pinned above, not Copilot SQLite tables, renderer IPC types, Electron state or internal events.

## Personal Data Security contract

```text
SECURITY_STANDARD_PATH=docs/standards/personal-data-security.md
PERSONAL_DATA_SECURITY_VERSION=0.1.0
PERSONAL_DATA_SECURITY_HASH_ALGORITHM=git-blob-sha1
PERSONAL_DATA_SECURITY_HASH=43e75d53e5e4cdd5afbf182a5dad13a16dc28ee7
```

C0/C1 default ceiling:

- D0/D1 only for automated conformance fixtures.
- D2 implementation may be designed but requires explicit product/privacy acceptance before runtime enablement.
- D3 runtime enablement is forbidden in C0/C1.
- Agent read and write authority are separate.
- Agent writes default to reviewable proposal.
- Unknown identity/schema/policy fails closed.

## Canonical envelope fields pinned for C1

```text
object_id
object_type
namespace
schema_version
source_refs
content_hash
observed_at
valid_from
valid_to
assertion_type
confidence
review_state
privacy_class
permission_scope
supersedes
tombstone_state
created_by
updated_by
```

Implementation may use a richer internal model, but no required field may be silently dropped from the contract adapter.

## Assertion/review taxonomy pin

C1 must be able to represent at least:

```text
SOURCE_FACT
USER_DECLARED_FACT
DIRECT_OBSERVATION
SYSTEM_INFERENCE
TEMPORARY_HYPOTHESIS
DISPUTED
STALE
SUPERSEDED
```

If internal enums differ, adapter mapping must be explicit and testable.

## Agent authority pin

Read path:

`capability identity -> tenant/namespace/purpose/privacy policy -> filtered objects -> audit receipt`

Write path:

`WRITE_PROPOSAL -> REVIEW -> ACCEPT_OR_REJECT -> CANONICAL_WRITE`

No direct accepted Agent write is allowed without a separately accepted deterministic low-risk policy and rollback receipt.

## LLM Wiki boundary

```text
LLM_WIKI_USE=RESEARCH_CONCEPTS_ONLY
UPSTREAM_CODE_REUSE=BLOCKED
BLOCKER=BLOCKED_LLM_WIKI_LICENSE_OR_CLEAN_ROOM_DECISION_MISSING
```

The current repository report identifies `nashsu/llm_wiki` as GPL v3.0 research reference, but C0 has not pinned an exact upstream revision/transitive asset set or accepted a clean-room/reuse ADR. Therefore production source/assets must not be copied in C0/C1.