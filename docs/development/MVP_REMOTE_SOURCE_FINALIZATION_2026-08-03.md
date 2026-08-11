# Copilot App macOS MVP — Remote Source Finalization

Date: 2026-08-03

## Status

```text
REMOTE_MVP_SOURCE = COMPLETE_FOR_LOCAL_CANDIDATE_ATTEMPT
ELECTRON_RUNTIME   = NOT_PROVEN
MVP                = MVP_NOT_COMPLETE
RELEASE            = NOT_RELEASE_READY
EXPERIENCE         = NOT_EXPERIENCE_READY
```

This document freezes the remote-development boundary only. It does not turn GitHub source, CI, a browser fixture, a package, or an unsigned build into Electron runtime proof.

## Source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Remote source baseline: `agent/r31-source-completion@feb93d6b87284ac68a62de0919d4ee10ca25ee9d`
- Consolidation branch: `chatgpt/mvp-source-finalization`
- PR base: `main@e91cafaa22ea100428b404b371aa35dce535c5bf`
- Exact deployment SHA: the final 40-character head of the Draft PR after its last tracked commit and successful `copilot-source-gate`; it is supplied externally and must equal `FETCH_HEAD` and local `git HEAD`.

The branch contains current `main` as an ancestor and consolidates the macOS-first product implementation, source tests, candidate runner, evidence contracts, governance documents, and the R41 offline-cache alignment fix.

## macOS MVP product closure represented in source

The source contains the bounded local-first loop:

```text
local note / KB / WIKI / KG / RAG
→ grounded Ask answer
→ verifiable local source receipts
→ full source reader
→ return to the same Ask exchange
→ create Todo only after canonical local readback
→ success receipt with View Todo
→ All / Unscheduled discovery
→ edit and canonical readback
→ quit / relaunch persistence gate
```

The source includes:

- local SQLite and Markdown truth surfaces;
- source-grounded Ask responses and explicit source detail contracts;
- Ask conversation persistence and source-reader return tokens;
- Todo canonical create/list/readback, source links, Unscheduled discovery, editing, and focused navigation;
- app-embedded local ASR source/package contracts;
- embedded-local RAG default and explicit Ollama compatibility;
- single-model vector rotation while retaining durable local text;
- macOS arm64 candidate identity, SBOM, coverage, Electron-suite discovery, artifact and runtime evidence contracts;
- fail-closed candidate cache hydration and offline installation authority.

## P0 truth contract

### Todo

A successful Todo receipt is valid only after:

1. create returns an ID;
2. canonical `todos.list()` returns the same object;
3. title, body, status, due date and source links match;
4. the current Ask exchange stores the matching Todo receipt;
5. the user can open the exact Todo in All or Unscheduled;
6. local Electron quit/relaunch readback is proven by MiniMax and independently repeated by Codex.

Any missing step remains fail-closed and cannot be promoted to runtime success.

### Ask → source → back

The exact Ask exchange ID, question, answer, source set and Todo receipt must survive source navigation and return. Stale or missing source truth disables source and Todo actions.

### Candidate identity

A candidate is valid only when one receipt binds:

- source commit and source snapshot SHA-256;
- artifact SHA-256;
- app, executable and `app.asar` identities;
- runtime ID;
- ecosystem baseline commit;
- deterministic test-data manifest;
- commands and exit codes;
- screenshots and hashes;
- performance receipts;
- final clean process and Git state.

## Source validation

The authoritative GitHub workflow is `.github/workflows/copilot-source-gate.yml` on Node 24 / macOS. It validates source and build contracts, not final Electron acceptance. Its scope includes:

- exact PR-head checkout;
- exact lockfile install;
- candidate fail-closed source tests;
- ordered workspace build;
- TypeScript checks;
- unit and integration suites;
- desktop build and Phase 1 source suite;
- strict global and per-file critical coverage;
- CycloneDX production SBOM;
- exact Electron discovery: `113 tests in 9 files`;
- clean tracked and untracked source state.

## Non-goals

This remote finalization does not:

- run or accept Electron on the Owner Mac;
- create a signed or notarized release;
- complete Human Owner Gate;
- expand Windows, mobile, cloud truth, Remote, Backup, 3D graph, plugins, multi-user or commercial scope;
- add a Python service, database, knowledge store, vector store, or alternative truth source;
- merge Dependabot major upgrades;
- change credentials, signing, notary, cloud resources, Tailnet or global configuration.

## Handoff

MiniMax Code must execute the exact final PR head in a new clean detached worktree and write its complete receipt package outside the repository. Codex may start real Electron product-experience acceptance only after that package is complete and internally consistent.
