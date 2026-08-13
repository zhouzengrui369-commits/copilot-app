# EVIDENCE — COPILOT-SKE-V03-C0-R1

## GitHub current truth

### Copilot repository

- Default branch: `main`
- `main` observed SHA: `e67c7465a168ffc3fea94171722f7c1a211b4f1b`
- Authoritative MVP Draft PR: `#20`
- PR #20 Head: `d450badfc85b65d3eef20f05eeb0607c1bf6a912`
- Planning PR #40 Head: `0bc309c506826ebc1b7865748398953ad814e6da`
- v0.3 tracker: Issue #41
- Geo Context planning PR #28 remains separate/deferred.

### R75 local evidence supplied by Human Owner

```text
FINAL_VERDICT=BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET
registry prefetch=57/57
source tests=110/110 PASS
failure destination=release-assets.githubusercontent.com:443
failure=ECONNRESET
source watchdog=SIGTERM after 20 minutes
outer timeout=false
native-cache PASS receipt=absent
Candidate=not created
artifact/runtime=absent
retry=false
predecessor assets reused=false
source changes=none
```

Parent PM wrote the R75 terminal adjudication to PR #20 and classified the current local deployment gate as `BLOCKED_LOCAL_NETWORK_TRANSPORT_STABILITY`.

## Governance evidence read

- `AGENTS.md`
- `README.md`
- `goal.md`
- `plan.md`
- `rules.md`
- `delivery.md`
- `docs/PROJECT_STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/TODO.md`
- current open PR/Issue set relevant to MVP/v0.3

Repository does not currently expose every requested legacy name at root; `PROJECT_STATE.yaml`, root `PROJECT_STATUS.md`, root `TODO.md`, root `ARCHITECTURE.md` and a standalone current `DECISIONS.md`/`CHANGELOG.md` are not the active main-branch governance surface. Root v6.2 documents plus `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TODO.md` and live PR authority are treated as the factual equivalents. Historical candidate branches contain additional governance snapshots but do not override `main` plus live PR #20.

## Existing implementation evidence read

### KB

`packages/kb/SCHEMA-FROZEN-1.1.md`

Key facts:

- metadata SQLite + Markdown body split;
- `notes.path` product-local canonical note path;
- `notes`, `note_links`, `kg_pending`;
- source hash/confidence/agent metadata;
- append-only trash lifecycle added by later migrations.

### KG

`packages/kg/src/store/sqlite-store.ts`

Key facts:

- local `kg.sqlite`;
- `kg_nodes`, `kg_edges`, `note_entities`, `kg_tags`, `note_tags`;
- `entity_id`, evidence/source-note references and confidence/weight exist;
- graph remains local.

### RAG

`packages/rag/SCHEMA-FROZEN-1.2.md`

Key facts:

- separate `.rag/rag.db`;
- `chunks` and `rag_index_meta`;
- chunk ID `<notePath>#<ordinal>`;
- `note_path` is citation linkage;
- RAG store is additive/projection-oriented.

### Product-internal domain contract

`apps/copilot-desktop/src/shared/domain-api.ts`

Key facts:

- renderer/main contract includes Note, KG, RAG, Todo and Trash;
- secrets and filesystem paths are deliberately excluded from renderer responses;
- contract lacks ecosystem capability identity, purpose/privacy policy, version negotiation and shared object envelope.

## Ecosystem authority evidence

Repository: `zhouzengrui369-commits/knowme-ecosystem`

PR #17:

```text
state=OPEN+DRAFT
head=e46c4be501c465884486a4417adca2e158a58ccc
version=0.3.0
```

Shared Knowledge Engine:

```text
path=docs/architecture/shared-knowledge-engine.md
blob=caf9864f49dfb923f88f7125b7359d69b08865e4
status=Proposed v0.3 reference architecture
```

Personal Data Security:

```text
path=docs/standards/personal-data-security.md
version=0.1.0
blob=43e75d53e5e4cdd5afbf182a5dad13a16dc28ee7
status=Proposed normative standard for ecosystem v0.3
```

## License boundary evidence

Main currently contains `docs/llm-wiki-ecosystem-fit-report.md`, which identifies `nashsu/llm_wiki` as a GPL v3.0 research reference and recommends further study. C0 has not established an accepted exact-upstream clean-room/reuse decision. Therefore implementation-code reuse remains blocked; independent contract/product concepts are allowed.

## Evidence limitations

- R75 local files are not copied into GitHub by this C0 lane; their paths remain local predecessor evidence and are represented here only by the Human Owner-supplied terminal facts plus PR #20 adjudication.
- No v0.3 Runtime, local database migration, MCP client, packaged Electron artifact or Codex product acceptance has been executed by C0.
- Contract blob IDs are Git blob SHA-1 identifiers, not SHA-256 content digests. Future release/conformance manifests should include explicit SHA-256 payload digests in addition to Git identity.