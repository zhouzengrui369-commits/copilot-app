# DECISIONS

## D-2026-08-07-03: Prove Npm Registry Metadata Closure Before Lifecycle Hydration

### Background

R49 executed exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2`. Exact Git-object authority and `95/95` Candidate source contracts passed, but no Candidate was created. R48 had prefetched exact tarball URLs; the following strict `npm ci --offline` reported `ENOTCACHED` for `https://registry.npmjs.org/typescript`. Therefore tarball content alone was insufficient to prove npm's packument/metadata cache required by offline reify.

### Decision

1. Do not choose “wait for registry stability” as the fix for this deterministic cache-coverage defect.
2. Do not reuse any predecessor cache/receipt; exact-source/cache identity remains fail-closed.
3. Keep one Owner authorization, one hydration invocation, `automaticRetry=false`, no retry/backoff/resume, unchanged official-host allowlist, and Candidate Gate 1–12 `(deny network*)`.
4. Build a deterministic exact package-lock v3 manifest containing `name`, exact `version`, `name@version` spec, canonical tarball URL, and integrity.
5. Prefetch in bounded 24-item `npm pack --ignore-scripts <name@version>` batches so npm warms registry packument/metadata and tarball cache.
6. Before any lifecycle script or online asset work, require a strict `(deny network*) npm ci --offline --ignore-scripts` registry-cache closure proof.
7. If closure is incomplete, stop with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`; partial cache remains non-reusable and cannot emit a PASS receipt.
8. Remove the closure-proof install tree, then run the full lifecycle `npm ci --offline` with the existing bounded proxy available only for reviewed lifecycle/native assets.
9. Require zero `registry.npmjs.org` requests after the closure proof; any such request is `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`.
10. Bind prefetch strategy, metadata mode, manifest identity, closure proof, zero post-closure registry requests and existing final deny-network install/native proofs into the PASS receipt and Candidate receipt validator.

### Consequences

- An incomplete registry cache is diagnosed deterministically under deny-network instead of being reclassified by an unrelated historical proxy error.
- Registry network authority ends logically at the closure proof; later bounded network traffic may only serve already-reviewed lifecycle/native asset hosts.
- No product behavior, dependency version, package-lock, network allowlist or Candidate authority expands.
- Every predecessor source/cache/evidence identity remains reference-only; a new exact PR #20 SHA and fresh MiniMax paths are required.

## D-2026-08-07-02: Segment Registry Prefetch Before Native Lifecycle Hydration

R48 split the monolithic registry-heavy online install into bounded deterministic prefetch batches and preserved one invocation, zero retry, partial-cache nonreuse, unchanged host allowlist and Candidate deny-network. R50 supersedes R48's tarball-only cache assumption with an explicit metadata-complete closure proof.

## D-2026-08-07-01: Adapt llm_wiki Behavior Clean-Room Into Existing Copilot Architecture

The Owner-directed `nashsu/llm_wiki` reference is GPLv3. Copilot clean-room reimplements behavior/architecture only, preserves Electron/TypeScript/SQLite/local KG/local RAG, adds `知识台 / Wiki Studio`, and copies no upstream GPL implementation bytes. Review metadata and 4-Signal ranking never supersede canonical local truth.

## D-2026-08-03-03: Hydration Transport Is Hardened Without Hidden Retry

`automaticRetry=false`, Candidate `(deny network*)`, localhost CONNECT proxy, exact source-defined host allowlist, transport evidence, partial-cache nonreuse, and fresh exact-source identity remain invariant.

## D-2026-08-03-01: Gate 2 Uses A Receipt-Bound Native Toolchain Cache

Candidate Gate 2 remains deny-network. Hydration requires `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`; receipt binds source/lock/lifecycle set/cache/header/commands/network and offline proofs. Old cache/receipt identities cannot be upgraded or reused after source changes.

## D-2026-08-03-02: Deployment Bootstrap Is PR-Agnostic But Exact-Object Bound

MiniMax receives `PR_NUMBER` and `EXACT_FINAL_HEAD`, fetches `refs/pull/${PR_NUMBER}/head`, proves the full SHA, then reads authority and runner from that exact Git object. Branch tips, stale worktrees and chat text cannot replace authority.

## Development Evidence Is Not Candidate Identity

Source tests, GitHub CI, static analysis, coverage, SBOM generation, renderer/browser fixtures, package commands and worker self-tests are development evidence. They are not Candidate identity and cannot prove Electron runtime, artifact identity, Experience, Release or MVP completion.

One Candidate identity requires exact source, source snapshot SHA-256, native-cache receipt and aggregate SHA-256, artifact SHA-256, app/executable/`app.asar` identities, runtime ID, ecosystem baseline, deterministic test-data manifest, command logs, screenshots, performance receipts and clean terminal state.

## Embedded-Local Is The Production Retrieval Embedding Default

R31 keeps `embedded-local-hash-v1` as the self-contained production default; Ollama is an explicit compatibility option. R47/R50 add no second vector store, database, knowledge base, Python service or cloud truth.

## Twelve-Gate Exact-Commit Candidate Contract

The macOS Candidate executes exactly twelve ordered fail-closed gates: exact source; deny-network receipt-bound install; tracked SHA ledger; source/build chain; tests/coverage/build/SBOM; canonical unsigned arm64 package; identities; focused packaged Electron; exact `113 tests in 9 files`; packaged Electron `113/113`; three performance runs; final source/artifact/runtime/test-data/evidence receipt. No later gate may repair or reinterpret an earlier blocker.

## Deployment Authority Is Read From The Exact Git Object

MiniMax must not infer execution authority from a current checkout, branch tip, stale worktree, CI summary or chat transcript. It fetches the externally supplied PR head, proves the full `EXACT_FINAL_HEAD`, reads `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and controlling scripts from that exact Git object, and materializes a hash-bound authority receipt before hydration or Candidate state is created.
