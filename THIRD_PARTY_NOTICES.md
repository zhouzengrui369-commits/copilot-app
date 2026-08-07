# Third-Party Notices Index

This file is an index, not a license grant for Copilot App itself.

The repository and its internal packages currently identify as `UNLICENSED` unless an owner-approved license file says otherwise. Public repository visibility does not grant redistribution rights. This index does not change that status and does not select a license on the owner's behalf.

## Architectural reference — nashsu/llm_wiki

Copilot App's MVP Knowledge Studio uses a **clean-room architectural adaptation** of ideas documented by `nashsu/llm_wiki` at upstream commit `ad215b51252ffc1c6721d5b057f0449a2fb51530` (v0.6.7).

The upstream repository is licensed under GNU GPL v3. Copilot App does **not** vendor, copy, transpile, or mechanically translate upstream GPL source files. The implementation in this repository was written against Copilot's existing Electron / TypeScript / SQLite contracts using behavior-level concepts only, including:

- local raw source → persistent WIKI organization;
- explicit human Review Queue;
- recoverable/background ingest or build-state visibility;
- a four-signal knowledge-connection relevance model;
- a three-column knowledge-workbench interaction pattern.

The exact clean-room mapping and non-copy boundary are documented in `docs/development/LLM_WIKI_CLEAN_ROOM_MVP.md`. If the owner later chooses to incorporate verbatim or derivative GPL code, licensing and distribution terms must be reviewed again before that source is merged or distributed.

## Candidate-bound dependency inventory

Every R30 successor candidate must generate a production CycloneDX Software Bill of Materials from the exact installed lockfile using the candidate runner. The resulting document is stored in the private candidate evidence directory as:

```text
software-bill-of-materials.cdx.json
```

Its SHA256, component count, dependency-relation count, source commit, and candidate manifest binding are part of the required deployment receipt. The SBOM is generated from the exact candidate dependency tree; a historical SBOM must not be reused for another commit.

## Embedded local ASR assets

The packaged local-ASR bundle carries its own asset and license evidence:

- `apps/copilot-desktop/resources/local-asr/BUNDLE-MANIFEST.json`
- `apps/copilot-desktop/resources/local-asr/THIRD-PARTY-NOTICES.md`
- `apps/copilot-desktop/resources/local-asr/licenses/Apache-2.0.txt`

The model files, runtime files, hashes, architecture support, and redistribution evidence must remain bound to the same final candidate. Source presence alone is not runtime, signing, notarization, or redistribution approval.

## npm packages

Third-party npm packages remain governed by their respective upstream licenses and notices. The generated CycloneDX SBOM is the machine-readable dependency inventory for a candidate; package metadata and upstream license texts remain the authority for each dependency.

## Owner decision still required

Before any public distribution, the owner must separately approve:

1. the Copilot App source/distribution license, if any;
2. the final candidate SBOM and dependency-license review;
3. model and binary redistribution rights;
4. Developer ID signing, Apple notarization, installation, and release evidence.

Until those gates close, status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY`.
