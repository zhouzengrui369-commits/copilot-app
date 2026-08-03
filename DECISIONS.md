# DECISIONS

## D-2026-08-03-03: Hydration Transport Is Hardened Without Hidden Retry

### Background

The first R45 native-toolchain hydration used exact source `43f151a3a1eb7e0592ff833f0e42892db47d3d65`, a new cache root, a localhost-only CONNECT proxy, and the exact Owner authority token. Source authority and `83/83` contracts passed. During the single online hydration, npm fetched thousands of package objects over unusually slow connections and then stopped with `ECONNRESET`. No PASS receipt or candidate was created.

A second hydrator invocation was attempted contrary to the one-invocation contract and was immediately rejected because the partial cache path already existed. It performed no second online hydration. The first transport failure and the process deviation remain immutable evidence.

### Decision

1. `automaticRetry=false` remains an invariant. The hydrator performs no hidden retry, resume, or second npm invocation after a failed online install.
2. Candidate Gate 1–12 remains `(deny network*)`; no candidate egress or fallback is added.
3. The exact official-host allowlist and localhost CONNECT proxy architecture remain unchanged.
4. Both client and upstream tunnel sockets use TCP keepalive, no-delay, and a twenty-minute idle timeout.
5. npm fetch retries are explicitly zero, fetch timeout is explicit, and socket concurrency is bounded.
6. Each CONNECT receipt records start/end time, duration, directional bytes, socket policy, and any terminal transport error.
7. Transport resets, timeouts, pipe failures, and aborts use stable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_*` codes.
8. A transport-failed cache receives exclusive `HYDRATION-FAILED.json` with `status=partial_failed_transport`, `reusable=false`, `passReceiptCreated=false`, and `automaticRetry=false`.
9. Candidate receipt validation rejects any partial marker, transport-policy mismatch, fatal tunnel record, or nonzero transport error count.
10. A new attempt requires a new exact source SHA, explicit Owner handoff, new run stamp, new paths, and a fresh single hydration invocation. The partial R45 cache is evidence only.

### Consequences

- Slow official downloads can remain connected longer without weakening network authority.
- A network reset remains an explicit blocker rather than an automatic retry.
- Partial cache bytes cannot be promoted to a valid receipt or candidate input.
- The next MiniMax handoff is valid only when it includes `SOURCE_COMMIT`, `PR`, `SOURCE_GATE=PASS`, and a new `RUN_STAMP`.
- This decision changes no product feature, package version, database, local-first truth store, credential, signing configuration, or release authority.

## D-2026-08-03-01: Gate 2 Uses A Receipt-Bound Native Toolchain Cache

### Background

The first exact PR #20 candidate completed source authority, registry-only hydration, source contracts, and dry-run, then stopped at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.

The old hydration deliberately disabled lifecycle scripts. The candidate correctly enabled them while denying network. `better-sqlite3` therefore could not obtain a prebuilt binary or node-gyp headers. The registry-only receipt proved npm tarballs but did not prove native lifecycle closure.

### Decision

1. Candidate Gate 2 remains `(deny network*)`.
2. Candidate lifecycle scripts remain enabled; `--ignore-scripts` is not accepted as runtime truth.
3. A separate exact-commit hydration may run once only after the Owner supplies `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`.
4. Hydration children can connect only to a localhost CONNECT proxy.
5. The proxy accepts only the exact official npm, Node, Electron, and GitHub release-asset hosts defined in source and records every CONNECT request.
6. Inherited credentials, npm configs, mirrors, registry, proxy, dist URLs, and native-build overrides are stripped.
7. The exact package-lock `hasInstallScript` set is a source contract.
8. Hydration must prove a full lifecycle install, Electron 38 arm64 native rebuild, full lifecycle offline install under deny-network, and offline Electron arm64 native rebuild before emitting a receipt.
9. The receipt binds source commit, lock SHA-256, lifecycle set, header root, cache layout, every cache file, aggregate SHA-256, commands, logs, and proxy audit.
10. Candidate Gate 2 revalidates the receipt and all cache bytes, runs a full lifecycle offline install, proves the cache remained immutable, and passes only the receipt-bound Electron headers to later native staging.
11. Old registry-only caches and receipts cannot be upgraded in place or reused after a tracked source change.
12. There is no automatic online retry or candidate network fallback.

### Consequences

- Hydration is more expensive but now matches candidate lifecycle truth.
- A new source SHA, cache, receipt, hydration worktree, candidate worktree, evidence directory, artifact identity, and runtime ID are required.
- A denied or unexpected host remains an auditable blocker rather than an implicit network expansion.
- The candidate still cannot be described as runtime proof, MVP completion, Release, or Experience acceptance without MiniMax evidence and independent Codex operation.

## D-2026-08-03-02: Deployment Bootstrap Is PR-Agnostic But Exact-Object Bound

### Decision

- The final handoff receives `PR_NUMBER` and `EXACT_FINAL_HEAD` externally.
- MiniMax fetches `refs/pull/${PR_NUMBER}/head`, proves equality with the supplied full SHA, and reads authority, hydrator, and runner from that exact Git commit object.
- Historical PR #14 literals are removed from active executable authority.
- Tracked source never self-embeds its own containing commit.

### Consequence

The same reviewed authority contract can be used by a stacked fix PR without accidentally executing an older branch head.

## Development Evidence Is Not Candidate Identity

Source tests, GitHub CI, static analysis, coverage, SBOM generation, browser fixtures, package commands, and worker self-tests are development evidence. They are not candidate identity and cannot prove Electron runtime, artifact, runtime ID, Experience, Release, or MVP completion.

One candidate identity requires exact source, source snapshot SHA-256, native-cache receipt and aggregate SHA-256, artifact SHA-256, app/executable/`app.asar` identities, runtime ID, ecosystem baseline, deterministic test-data manifest, command logs, screenshots, performance receipts, and clean terminal state.

## Embedded-Local Is The Production Retrieval Embedding Default

R31 keeps `embedded-local-hash-v1` as the self-contained production default. Ollama remains an explicit local-service compatibility option. Durable local text remains authoritative across vector-model rotation.

No Gate 2 repair may add a second database, second knowledge base, second vector store, Python service, cloud truth, or external production embedding dependency.

## Twelve-Gate Exact-Commit Candidate Contract

The macOS candidate executes exactly twelve ordered, fail-closed gates:

1. exact source and clean preimage;
2. receipt-bound lifecycle install under deny-network;
3. all-tracked-file SHA-256 ledger;
4. source contracts and ordered workspace build;
5. checks, unit, integration, strict coverage, desktop build, Phase 1 suite, and SBOM;
6. canonical unsigned macOS arm64 authority;
7. source and artifact identities;
8. focused packaged Electron;
9. exact `113 tests in 9 files` discovery and test-data manifest;
10. packaged Electron `113/113` and clean termination;
11. three candidate-bound performance runs;
12. final source/artifact/runtime/test-data/evidence receipt.

No later gate can repair, reinterpret, or bypass an earlier blocker.

## Deployment Authority Is Read From The Exact Git Object

MiniMax must not infer authority from the current checkout or a stale worktree. It fetches the externally specified PR head, proves the exact full SHA, reads `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and controlling scripts from the exact object, and materializes a hash-bound authority receipt before creating hydration or candidate state.

## D-2026-08-01-01: Reinstate Codex PM And MiniMax Implementation

- ChatGPT owns bounded GitHub remote source work and Draft PR contracts.
- MiniMax Code owns exact-SHA clean-worktree implementation, hydration, build, package, and technical evidence when explicitly authorized.
- Codex owns independent real-computer Electron product-experience and runtime acceptance.
- Worker self-test is never final acceptance.

## D-2026-07-30-01: Preserve macOS-First Local-First Scope

The current MVP remains a single-user macOS Electron desktop product. Windows is deferred to Phase 1.1. Mobile, cloud data truth, Remote, Backup, 3D graph, plugins, multi-user, commercial, and enterprise expansion remain post-MVP.

Notes, KB, WIKI, MOC, KG, RAG, Todo, and schedule truth remain on the local computer. Signing and notarization remain separate release gates.
