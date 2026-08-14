# Copilot App Architecture — R45 Current Mirror

> Authority: this document is a maintained architecture mirror. Root `goal.md`, `plan.md`, `rules.md`, `delivery.md`, `PROJECT_STATE.yaml`, and `PROJECT_STATUS.md` override it. The complete pre-R30 detailed architecture remains byte-preserved at [`history/ARCHITECTURE_PRE_R30.md`](history/ARCHITECTURE_PRE_R30.md).
>
> Status: `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`. The remote macOS MVP source is complete enough for another candidate attempt, but no current candidate, artifact identity, runtime ID, independent Electron acceptance, signing, notarization, or Human Owner Gate exists.

## 1. Local-First Product Authority

Copilot App is a single-user macOS Electron desktop product. Its core truth remains on the Owner computer:

```text
local notes / Markdown
        ↓
local KB index + SQLite metadata
        ↓
local WIKI / MOC / KG projections
        ↓
local RAG retrieval and source receipts
        ↓
Ask conversation
        ↓
Todo and schedule application
```

Notes, KB, WIKI, MOC, KG, RAG, Todo, and schedule records are not delegated to cloud data truth. Cloud providers may be optional stateless model boundaries, but they cannot become the canonical store for user knowledge or work state.

The architecture does not add a Python resident service, a second database, a second knowledge base, or a second vector store. Existing TypeScript/Electron boundaries and local stores remain authoritative.

## 2. Product Process Boundaries

### Web-first UI development gate

The renderer must first run as a browser prototype from the same React source used by the desktop renderer. The Owner-pinned HTML and its SHA256 define the UI journey and information architecture. Browser fixture data must remain labeled `PROTOTYPE / NOT_RUNTIME_PROOF`.

Primary information architecture is exactly:

```text
Today / Schedule
Knowledge / default readable MOC
Conversations / grounded Ask
Settings
```

Wiki Studio is a secondary organizer tool entered from Knowledge, not a fifth top-level destination. Electron main/preload integration, native staging, packaging, signing, notarization, and deployment are downstream gates and remain blocked until explicit Owner web acceptance.

The browser evidence may close the Parent PM web technical gate, but it cannot close packaged runtime or Human Owner milestone gates. Every downstream executor must fetch and prove the exact source-gated PR head; a failed predecessor run, cache, worktree, receipt, artifact, or runtime identity is immutable and cannot be resumed or reused.

### Native hydration watchdog timing

Hydration child commands run in detached process groups under a bounded watchdog. Timeout sends `SIGTERM`; a still-open child group receives `SIGKILL` only after the configured grace period; close during grace cancels hard kill. Unit contracts inject and advance timers directly so scheduler latency cannot turn the timeout-plus-grace sequence into a flaky source gate. Durable production audit events remain the runtime authority.

### Native hydration upstream address family

The owner-authorized macOS native hydration proxy accepts only CONNECT requests for the exact official-host allowlist on port `443`. Its one upstream socket is receipt-bound to IPv4 (`proxyUpstreamFamily=4`). This avoids Node 24 auto-family attempt windows that were shorter than observed owner-environment IPv4 connect latency. It does not add a request retry, alternate mirror, host, port, or Candidate network permission; every failed hydration remains terminal and its partial cache remains non-reusable.

### Native hydration GitHub control-tunnel completion

Electron's downloader uses an initial `github.com` HTTPS control/redirect tunnel and a separate `release-assets.githubusercontent.com` asset tunnel. R5 transferred approximately 121.6 MB through the bounded proxy, then the control tunnel reported a late upstream `ETIMEDOUT` after 3,088 received bytes. Destroying the downstream socket converted that late control error into Electron `install.js` `socket hang up` even though the large asset tunnel had already progressed.

The proxy now has one narrow completion rule: `github.com`, `ETIMEDOUT`, and `1..65536` already received bytes may end downstream with graceful EOF. The request remains receipt-visible and requires downstream command success plus Electron's embedded checksum validation. Any release-asset error, zero-byte response, response above 64 KiB, other error code or other host still destroys the tunnel and fails hydration. The rule does not retry, resume, reuse partial cache, add a mirror, or grant Candidate network access.

### Electron main process

The main process owns:

- local file and SQLite access;
- canonical Todo persistence and readback;
- note and knowledge indexing orchestration;
- Ask conversation persistence;
- local ASR worker lifecycle;
- secure IPC registration;
- packaged-resource path selection;
- candidate runtime identity surfaces.

The renderer cannot open arbitrary filesystem or database handles. It communicates through the preload bridge and explicit typed IPC contracts.

### Preload bridge

Preload exposes a bounded product API for:

- notes;
- knowledge graph;
- RAG / Ask;
- Todo and reminders;
- Ask conversation state;
- Trash;
- WIKI truth;
- local ASR;
- settings and runtime metadata.

The bridge is not a second truth store. It validates requests and carries structured receipts.

### Renderer

The renderer owns interaction state only. Critical views are:

- Today / Schedule;
- Knowledge;
- Ask / Conversations;
- Settings;
- local voice capture and editable transcript draft.

Browser prototype adapters are fixture-only and remain labeled `NOT_RUNTIME_PROOF`.

## 3. Fail-Closed Truth

The product uses fail-closed receipts rather than optimistic success language.

### Grounded Ask

A completed answer is actionable only when:

1. the terminal answer exists;
2. the exact source set and source details exist;
3. each source path resolves to the matching local note;
4. source state is `LOCAL_PRESENT`;
5. the completed exchange is persisted;
6. stale, missing, unknown, unavailable, duplicate, or mismatched sources disable completion actions.

The renderer displays source reason codes and previews. No source means no green truth state.

### Ask → source → return

Before opening a full source reader, the current exchange is persisted. Navigation carries an origin token containing the exact exchange ID and source path. Returning is valid only for the matching exchange. The same question, answer, source set, source truth, and Todo action/receipt must reappear without re-asking.

### Todo truth

A Todo success receipt requires:

1. `todos.create()` returns a canonical ID;
2. `todos.list()` returns the same ID;
3. title, body, status, due date, and source links match;
4. the matching Ask exchange stores the same Todo receipt;
5. “查看待办” opens the exact object;
6. unscheduled objects open in All / Unscheduled;
7. edit/update returns the same canonical object and is read back again;
8. full Electron quit and relaunch persistence is proven on the candidate.

If the Todo object exists but the Ask receipt cannot be safely persisted, the UI must not claim complete success. It may report the partial truth explicitly, but it cannot encourage blind duplicate creation.

## 4. Embedded-Local Production Default

The production retrieval embedding default is `embedded-local-hash-v1`:

- no HTTP service;
- no process spawn;
- no model download;
- no native addon;
- no cloud fallback;
- deterministic local output.

Ollama remains explicit opt-in compatibility for a user-operated local service. It is not silently selected and does not replace durable local text.

## 5. Single-Model Vector Scope

Only one embedding-model vector scope is authoritative at a time. On model rotation:

- incompatible vector rows are removed or rotated;
- durable Markdown/local text remains;
- deterministic local fallback remains available;
- re-indexing rebuilds projections from the durable source.

This prevents mixed vector spaces from appearing comparable and keeps source text recoverable.

## 6. WIKI, KG, and RAG Ordering

The ordered dependency and runtime chain is:

```text
LLM client
→ KB
→ KG
→ RAG
→ desktop product
```

A locally saved note can exist before its WIKI/KG/RAG projection becomes current. The UI distinguishes:

- queued;
- running;
- current;
- failed;
- not-ready.

A WIKI or KG failure does not erase the saved local note. A successful projection receipt must bind the same note path, revision/content digest, and current build state.

## 7. Local ASR Boundary

The macOS MVP carries an app-embedded local ASR package contract:

- model and runtime resources are bundled in the application source/package contract;
- voice capture produces an editable draft;
- the draft is written to local notes only after user confirmation;
- remote ASR fallback is not silently enabled;
- real packaged offline execution remains a candidate acceptance gate.

Source/package presence is not the same as successful packaged runtime proof.

## 8. Electron Trust

Electron runtime truth requires one exact candidate identity. The accepted candidate must bind:

- exact source commit;
- source snapshot SHA-256;
- native-cache receipt SHA-256 and aggregate cache SHA-256;
- package-lock SHA-256;
- ZIP and DMG identities;
- `.app`, main executable, and `app.asar` identities;
- runtime ID;
- ecosystem baseline commit;
- deterministic test-data manifest;
- command and exit-code log;
- screenshots and SHA-256;
- performance receipts;
- process terminal state.

Source-run Electron, dirty/untracked code, a browser fixture, a different artifact, or an unbound screenshot is not candidate truth.

## 9. Exact-Object Deployment Authority

The deployment controller receives two external values:

```text
PR_NUMBER
EXACT_FINAL_HEAD
```

MiniMax fetches `refs/pull/${PR_NUMBER}/head`, proves `FETCH_HEAD == EXACT_FINAL_HEAD`, and reads the authority, hydrator, and runner directly from that exact Git object. A stale worktree cannot grant or deny authority.

The authority bootstrap itself creates no cache, worktree, evidence, or network activity. It emits a SHA-256 receipt with:

- `executionAuthority=git-object-at-exact-commit`;
- `networkUsed=false`;
- `worktreeCreated=false`;
- `evidenceCreated=false`.

## 10. Gate 2 — Receipt-Bound Native Toolchain Cache

### Incident resolved by R45

The first exact PR #20 candidate used a registry-only cache hydrated with lifecycle scripts disabled. Gate 2 then ran a full lifecycle `npm ci --offline` under `(deny network*)`. `better-sqlite3` attempted a prebuilt download and then a node-gyp header download, both correctly denied. The source was safe, but the cache proof was incomplete.

The architecture rejects two unsafe shortcuts:

- candidate `--ignore-scripts`, because it hides native runtime requirements;
- candidate network access, because dependency execution must remain offline and reproducible.

### Hydration phase

A separate owner-approved hydrator is allowed one bounded egress operation for one exact source commit. It requires:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The hydrator runs in a new detached clean worktree. Child processes are sandboxed so they can reach only a localhost CONNECT proxy. The proxy resolves and connects only to the exact source-defined official npm, Node, Electron, and GitHub release-asset allowlist. Every request is recorded; one denied host fails the hydration.

Inherited authority is removed:

- npm user/global configs;
- registry and proxy variables;
- npm/GitHub tokens;
- Electron mirrors/custom filenames;
- node-gyp dist URLs and native target overrides.

The cache root contains:

```text
native-cache-root/
├── npm/
├── electron/
├── electron-builder/
├── node-gyp/
├── prebuild/
├── npm-config/
├── home/
└── xdg-cache/
```

The exact package-lock `hasInstallScript` set is locked by source tests. Hydration enables lifecycle scripts, forces source builds where appropriate, downloads official Node/Electron headers and Electron distributions through the allowlisted proxy, and performs an Electron 38 arm64 `better-sqlite3` rebuild.

Before a PASS receipt, hydration deletes all `node_modules` trees and repeats:

1. full lifecycle `npm ci --offline` under `(deny network*)`;
2. Electron 38 arm64 native rebuild under `(deny network*)` using the exact hydrated header root;
3. Electron executable cache restoration;
4. source-clean verification.

The receipt binds every regular cache file, aggregate SHA-256, source commit, lockfile, lifecycle set, proxy audit, header root, npm identity, commands, logs, and both offline proofs. The hydrator creates no candidate or candidate evidence.

### Candidate phase

Candidate Gate 2:

1. validates the receipt, source, lockfile, lifecycle set, header root, and all cache bytes;
2. runs full lifecycle `npm ci --offline` under `(deny network*)`;
3. directs native packages to build from source with receipt-bound Node headers;
4. uses receipt-bound Electron and electron-builder caches;
5. redirects npm logs to evidence;
6. revalidates the cache identity after install;
7. adds the exact receipt-bound Electron header root for later native staging.

The candidate has no proxy and no online fallback. A missing, stale, tampered, source-mismatched, or mutated cache is a blocker.

## 11. Gate 3 — Complete Source Ledger

Gate 3 enumerates every Git-tracked regular file through `git ls-files -z`, reads each without following symlinks, records a lower-case SHA-256, and computes an aggregate digest. Missing, duplicate, unknown, malformed, symlinked, or nonregular entries fail closed.

The native-cache policy, runtime, hydrator, Gate 2 controller, and candidate runner are named critical controls; all tracked files remain in the complete ledger regardless of the critical list.

## 12. Gates 4–7 — Build and Artifact Identity

### Gate 4

- candidate source contracts;
- ordered workspace dependency build.

### Gate 5

- local-first TypeScript checks;
- core unit and integration suites;
- strict global and per-file critical coverage;
- desktop Phase 1 source suite;
- desktop build;
- production CycloneDX SBOM.

### Gate 6

The R31 authority wrapper validates the canonical unsigned macOS arm64 ZIP/DMG candidate. Legacy x64/Windows matrix blockers may be quarantined only after the selected arm64 authority passes. An arm64 blocker remains fatal.

### Gate 7

Binds:

- source snapshot;
- ZIP;
- DMG;
- `.app`;
- executable;
- `app.asar`;
- release identity;
- runtime identity.

## 13. Gates 8–10 — Packaged Electron

### Gate 8

Runs the focused packaged Electron journeys first, including the critical local-first closure and candidate identity surfaces.

### Gate 9

Requires exact list-only discovery:

```text
113 tests in 9 files
```

It also hashes every E2E spec, fixture, and helper into the deterministic test-data/source manifest.

### Gate 10

Requires:

```text
passed     = 113
skipped    = 0
unexpected = 0
flaky      = 0
clean process exit = true
```

Browser fixture results cannot satisfy Gates 8–10.

## 14. Gate 11 — Candidate-Bound Performance

Gate 11 requires three distinct performance run IDs, each bound to the same source/artifact/runtime identity, plus one aggregate receipt. Current source thresholds include:

- launch below 2,000 ms exclusive;
- resident set below 500 MB exclusive;
- 100-node KG frame rate at least 30 FPS.

A single run or an unbound benchmark is insufficient.

## 15. Gate 12 — Final Receipt

Gate 12 assembles:

- candidate manifest;
- source and control ledger;
- native-cache receipt;
- SBOM;
- artifact/runtime identities;
- exact test results;
- test-data manifest;
- screenshots and hashes;
- performance receipts;
- command/exit log;
- final process terminal state;
- final clean Git state.

Expected durable evidence files include `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json` outside the repository.

## 16. Role and Acceptance Boundary

- ChatGPT: bounded GitHub source development and Draft PR contract.
- MiniMax Code: exact-SHA clean-worktree hydration, candidate execution, build/package work, and technical evidence.
- Codex: independent real-computer Electron product-experience and runtime acceptance.
- Owner: Human Owner Gate and release decision.

MiniMax self-test is not acceptance. Only a complete MiniMax receipt can unlock Codex. Only a candidate-bound Codex focused retest with `P0=0` can make Human Owner Gate eligible.

## 17. Deferred Scope

Deferred beyond the current macOS MVP:

- Windows real-machine, signing, installation, and screenshots;
- mobile/web clients;
- cloud data truth;
- Tencent deployment, Remote/live, and optional Backup;
- 3D graph;
- plugins and i18n;
- multi-user and enterprise expansion;
- commercial scope;
- major dependency upgrades.

The R45 Gate 2 repair changes only candidate dependency/native-toolchain evidence. It does not expand product architecture or release authority.
