# DECISIONS

## D-2026-08-14-04: Prefetch Exact Electron Assets In Checksum-Gated Bounded Ranges

### Background

R6 consumed exact source `35b3c54059900528e33d79bbb15788479763a58d` after a complete GitHub source gate. Its sole hydration stopped during Electron `38.8.6` postinstall when the release-asset tunnel reset after `503434` bytes and approximately 20 minutes. The failure was not eligible for the R5 GitHub control-tunnel completion rule, and no Candidate or App was created.

### Decision

1. Do not treat a partial release-asset transfer as successful EOF and do not reuse R6 bytes.
2. After metadata-complete registry closure, resolve only the two reviewed Electron lifecycle packages (`38.8.6` and `33.4.11`) and their exact macOS arm64 filenames/checksums from the installed npm packages.
3. Fetch only exact official Electron GitHub release URLs in 1 MiB Range segments, concurrency 4, with at most 3 attempts per segment and no whole-hydration retry.
4. Retry only transport reset/timeout/pipe/abort codes. HTTP status, Content-Range, Content-Length, total-size and other protocol failures stop immediately.
5. Admit a ZIP to the fresh Electron cache only after the package-embedded SHA-256 matches; bind all identities/counts and the proxy request interval into hydration schema v2.
6. Make the proxy's recoverable asset disposition available only in the explicit prefetch phase and reviewed host/code/byte bounds. Every other use remains fatal.
7. Set modern Electron's `electron_config_cache` to the receipt-owned cache in both hydration and Candidate environments.
8. Preserve Candidate deny-network, official host set, port 443, IPv4, partial-cache nonreuse, source cleanliness and all release/Human Owner gates.
9. The Owner explicitly authorized migration of the legacy strict audit's stale online-registry lifecycle expectation on 2026-08-14. Require registry prefetch, deny-network closure, registry-offline lifecycle scripts, zero post-closure registry requests, the checksum-gated artifact receipt and final deny-network proofs; reject the old online-registry command. Do not authorize R7 until the resulting same-SHA source gate is green.

### Impact

Long Electron downloads no longer depend on one opaque 20-minute asset tunnel. A transient segment failure can make bounded forward progress, but only a complete exact-checksum ZIP can become cache authority. This is still source preparation, not hydration, Candidate, packaged runtime or milestone proof.

## D-2026-08-14-03: Gracefully Close Only A Completed-Enough GitHub Control Tunnel

### Background

R5 consumed exact source `6d609d9c989a16e143d38e7a33b2d69d01f1d442` once. Source contracts passed `112/112`; Candidate creation stayed at zero. Hydration transferred `121555082` bytes upstream-to-client, but the final fatal request was `github.com:443` with only `3088` response bytes and upstream `ETIMEDOUT`. The proxy then destroyed the downstream socket, and Electron `install.js` failed with `RequestError: socket hang up`.

### Decision

1. Treat only `github.com + ETIMEDOUT + 1..65536 received bytes` as a late control-response close eligible for graceful downstream EOF.
2. Record the error and exact disposition in the proxy receipt; receipt audit accepts it only when all bounds match and downstream lifecycle success proves protocol/content validation.
3. Keep release-assets, zero-byte, oversized, non-timeout and other-host errors fatal and fail-closed.
4. Preserve IPv4, allowlist, port 443, `automaticRetry=false`, `npmFetchRetries=0`, no mirror change, partial-cache nonreuse and Candidate deny-network.
5. Require a new exact source-gated PR head and all-new R6 identity; R5 cannot be resumed or reused.

### Impact

The proxy no longer manufactures a downstream `socket hang up` for the exact late GitHub redirect/control timeout seen in R5, while asset integrity and every broader transport failure remain fail-closed. This is source readiness only; it does not prove hydration, Candidate, packaged runtime, release or Human Owner acceptance.

## D-2026-08-14-02: Bind Native Hydration CONNECT To IPv4 In This macOS Authority

### Background

R4's sole hydration stopped at the first registry batch after an approximately 3.7-second Node upstream `ETIMEDOUT`, despite source policy allowing 15-minute npm fetches and 20-minute proxy idle time. A valid persistent-proxy preflight reproduced the default Node 24 path at only `1/3` success with two approximately three-second timeouts. Direct curl selected IPv4 and passed `3/3`; a temporary proxy differing only by `family:4` also passed `3/3`, with all nine allowlisted hosts proving A records.

### Decision

1. Bind the native hydration CONNECT proxy's single upstream socket to address family `4` and include `proxyUpstreamFamily=4` in the receipt-validated transport policy and proxy audit.
2. Preserve the exact official-host allowlist, destination port `443`, registry/mirror, npm fetch timeout, proxy idle timeout, keepalive, concurrency, command watchdog, and partial-cache nonreuse.
3. Preserve `automaticRetry=false` and `npmFetchRetries=0`; IPv4 selection is one deterministic upstream connection, not a hydration retry.
4. Require a new PR head and complete source gate before R5; no R4 or diagnostic asset is reusable.

### Impact

The owner macOS hydration path no longer depends on Node 24's 250ms auto-family address-attempt window, which was shorter than observed local IPv4 connect latency. IPv6 is not claimed or tested by this decision. Candidate, packaged runtime, release, and Human Owner gates remain pending.

## D-2026-08-14-01: Watchdog Contracts Use Injected Deterministic Time

### Background

Local deployment R3 ran the Candidate source contract once and stopped before hydration because the watchdog test expected `SIGTERM` and `SIGKILL` after a fixed 80ms wait but observed only `SIGTERM`. The production implementation schedules the 20ms hard-kill grace timer only when the 40ms timeout callback executes, so event-loop delay can make an 80ms wall-clock assertion premature.

### Decision

1. Preserve production process-group termination, timeout, grace, signals, audit events, and no-retry policy unchanged.
2. Inject manual timers into the unit contract and explicitly advance timeout then grace.
3. Add a separate contract proving that a child closing during grace cancels the hard kill.
4. Require repeated focused runs, the full Candidate source contract, and a fresh GitHub source gate before any new local deployment authority.
5. Keep R1/R2/R3 and source `b8b04819ac25629b0f2a5135858532902567b794` immutable and ineligible for reuse.

### Impact

The source gate becomes deterministic under scheduler load without weakening fail-closed hydration. Every future local deployment successor must bind the new exact PR #54 head and create entirely fresh evidence and Candidate identities.

## D-2026-08-13-01: Owner Demo HTML Is The UI Authority And Web Acceptance Precedes Packaging

### Background

An Electron app was opened before the HTML/browser UI had been revalidated, and its fifth primary `知识台` destination diverged from the Owner Demo's four-destination information architecture. The Owner explicitly required immediate correction and declared the Demo UI source authoritative.

### Decision

1. Bind `design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html` at `52046` bytes and SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205` as the sole UI source.
2. Develop and verify the same-source browser renderer before Electron integration or package work.
3. Keep the four primary destinations `今天 / 知识 / 对话 / 设置`.
4. Keep Wiki Studio as a secondary Knowledge action, preserving its implementation without allowing IA drift.
5. Require explicit NJX `OWNER_WEB_UI_ACCEPTANCE=PASS` before any successor may integrate Electron, package, or notify the local deployment executor.

### Impact

The browser prototype becomes the current product-experience acceptance surface but remains `NOT_RUNTIME_PROOF`. Existing candidate, signing, notarization, release, and Human Owner gates are unchanged and cannot be closed by this web work.

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
