# DECISIONS

## D-2026-08-07-01: Adapt llm_wiki Behavior Clean-Room Into Existing Copilot Architecture

### Background

The Owner directed the Parent PM to use the prior `nashsu/llm_wiki` research and the existing demo UI source as the foundation for Copilot App MVP delivery.

The upstream reference is pinned to:

```text
nashsu/llm_wiki@ad215b51252ffc1c6721d5b057f0449a2fb51530
v0.6.7
GNU GPL v3
```

Copilot App currently identifies its own internal source as `UNLICENSED`, while its v6.2 architecture requires Electron/TypeScript, local SQLite truth, one local KG, one local RAG/vector store and no second knowledge/data stack.

### Decision

1. Reuse upstream **behavior and architecture**, not GPL implementation bytes.
2. Do not vendor, copy, mechanically translate or transpile upstream source files.
3. Keep the existing Electron / TypeScript / SQLite / local KG / local RAG implementation and APIs.
4. Keep existing `KnowledgeWorkspace` as canonical note editor/source-reader/MOC surface.
5. Add a separate `知识台 / Wiki Studio` route in the current demo-first shell.
6. Adapt Raw → Wiki using existing local notes plus digest-bound `WikiTruthReceipt`.
7. Adapt persistent ingest visibility using the existing durable `kg_pending` / `knowledgeBuild` state; do not add another queue database.
8. Adapt Review Queue as projection-bound local human-review metadata. Review state does not mutate or supersede canonical note/WIKI/KG/RAG truth.
9. Adapt the upstream four-signal connection concept with a clean-room pure function over current `KgSubgraph`:
   - direct local KG relation × 3.0;
   - source-note overlap × 4.0;
   - Adamic-Adar shared-neighbour evidence × 1.5;
   - same entity type × 1.0.
10. Use the existing `demo-first-prototype.css` / `demo-source-v4.css` renderer shell and add a responsive three-column Studio layout; do not add another UI runtime.
11. Opening the Studio performs local reads only. Model/build work must remain explicit through current local reindex actions.
12. MCP, Deep Research, multi-project management, Tauri/Rust/DuckDB and broader llm_wiki features remain out of current MVP scope.

### Consequences

- The Owner gets the llm_wiki knowledge-workbench model without creating a GPL source-copy ambiguity in the current repository.
- Existing Ask → verified source → return continuity and Todo/schedule closure are preserved instead of reimplemented.
- A new WIKI projection/digest creates a new Review identity, preventing an old human decision from being silently applied to changed generated content.
- 4-Signal scores are discovery/ranking metadata only; they do not create KG edges or RAG truth.
- The implementation remains locally persistent and compatible with existing Candidate and Codex acceptance contracts.

## D-2026-08-03-03: Hydration Transport Is Hardened Without Hidden Retry

1. `automaticRetry=false` remains invariant.
2. Candidate Gate 1–12 remains `(deny network*)`.
3. Native hydration uses a localhost CONNECT proxy and exact source-defined official-host allowlist.
4. Tunnel sockets use keepalive/no-delay/long idle timeout and npm fetch retries remain zero.
5. Transport failures are explicit blockers; partial cache bytes cannot become Candidate inputs.
6. A new attempt requires a new exact source SHA, run stamp and fresh paths.

## D-2026-08-03-01: Gate 2 Uses A Receipt-Bound Native Toolchain Cache

1. Candidate Gate 2 remains `(deny network*)`.
2. Candidate lifecycle scripts remain enabled; `--ignore-scripts` cannot hide native runtime requirements.
3. A separate exact-commit hydration requires `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`.
4. The receipt binds source commit, lock SHA-256, reviewed lifecycle set, header root, cache layout, cache aggregate SHA-256, command logs, CONNECT audit and offline native proofs.
5. Candidate revalidates source, receipt and all cache bytes before and after offline install.
6. Old cache/receipt identities cannot be upgraded in place or reused after tracked source changes.
7. There is no automatic online retry or Candidate network fallback.

## D-2026-08-03-02: Deployment Bootstrap Is PR-Agnostic But Exact-Object Bound

- The handoff receives `PR_NUMBER` and `EXACT_FINAL_HEAD` externally.
- MiniMax fetches `refs/pull/${PR_NUMBER}/head`, proves equality with the supplied full SHA, then reads authority and runner from that exact Git object.
- A branch tip, current checkout or chat transcript cannot replace exact-object authority.

## Development Evidence Is Not Candidate Identity

Source tests, GitHub CI, static analysis, coverage, SBOM generation, renderer/browser fixtures, package commands and worker self-tests are development evidence. They are not Candidate identity and cannot prove Electron runtime, artifact identity, Experience, Release or MVP completion.

One Candidate identity requires exact source, source snapshot SHA-256, native-cache receipt and aggregate SHA-256, artifact SHA-256, app/executable/`app.asar` identities, runtime ID, ecosystem baseline, deterministic test-data manifest, command logs, screenshots, performance receipts and clean terminal state.

## Embedded-Local Is The Production Retrieval Embedding Default

R31 keeps `embedded-local-hash-v1` as the self-contained production default. Ollama remains an explicit user-operated local-service compatibility option. Durable local text remains authoritative across vector-model rotation.

The R47 Knowledge Studio does not add another vector store, database, knowledge base, Python service, cloud truth or external production embedding dependency.

## Twelve-Gate Exact-Commit Candidate Contract

The macOS Candidate executes exactly twelve ordered, fail-closed gates:

1. exact source and clean preimage;
2. receipt-bound lifecycle install under deny-network;
3. all-tracked-file SHA-256 ledger;
4. source contracts and ordered workspace build;
5. checks, unit, integration, strict coverage, desktop build, Phase 1 suite and SBOM;
6. canonical unsigned macOS arm64 authority;
7. source and artifact identities;
8. focused packaged Electron;
9. exact `113 tests in 9 files` discovery and test-data manifest;
10. packaged Electron `113/113` and clean termination;
11. three candidate-bound performance runs;
12. final source/artifact/runtime/test-data/evidence receipt.

No later gate can repair, reinterpret or bypass an earlier blocker.

## Deployment Authority Is Read From The Exact Git Object

MiniMax must not infer authority from the current checkout or stale worktree. It fetches the externally specified PR head, proves the exact full SHA, reads `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and controlling scripts from the exact Git object, and materializes a hash-bound authority receipt before Candidate state is created.

## D-2026-08-01-01: Reinstate Parent PM / MiniMax / Codex Separation

- ChatGPT Parent PM owns bounded GitHub remote source development, PR review and executable task contracts.
- MiniMax Code owns exact-SHA clean-worktree build/package/Candidate technical evidence after explicit handoff.
- Codex owns independent real-computer Electron product-experience and runtime acceptance.
- Worker self-test is never final acceptance.

## D-2026-07-30-01: Preserve macOS-First Local-First Scope

The current MVP remains a single-user macOS Electron desktop product. Windows is deferred to Phase 1.1. Mobile, cloud data truth, Remote, Backup, 3D graph, plugins, multi-user, commercial and enterprise expansion remain post-MVP.

Notes, KB, WIKI/MOC, KG, RAG sources, Todo and schedule truth remain on the local computer. Signing and notarization remain separate release gates.
