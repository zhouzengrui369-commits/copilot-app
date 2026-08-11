# EVIDENCE — R45 Gate 2 Native-Toolchain Cache Repair

## MiniMax blocker evidence received

```text
source commit:             74454d21910f0c01e0b9d4f8117b4394defe3228
setup and authority:       PASS
registry cache contracts:  34/34 PASS
cache files:               5388
cache size:                approximately 464 MiB
online hydration:          PASS
ignore-scripts offline:    PASS
candidate source tests:    68/68 PASS
dry-run:                   PASS
candidate executions:      1
failed gate:               2
blocker:                   BLOCKED_NPM_OFFLINE_INSTALL_FAILED
source changes:            NONE
candidate established:     false
artifact SHA-256:           null
runtime ID:                null
```

The Gate 2 stderr showed `better-sqlite3` lifecycle execution attempting a GitHub prebuilt asset, then node-gyp Node headers. Candidate sandbox denial was correct.

## Source evidence added

- exact new Owner token;
- exact official-host allowlist;
- exact package-lock lifecycle set;
- bounded localhost CONNECT proxy;
- inherited npm/Electron/native authority stripping;
- online full lifecycle install contract;
- online Electron 38 arm64 native rebuild contract;
- offline full lifecycle install proof contract;
- offline Electron arm64 native rebuild proof contract;
- receipt-bound header root and cache layout;
- all-regular-file cache ledger and aggregate SHA-256;
- candidate full lifecycle offline install and post-install cache identity check;
- PR-agnostic exact-object bootstrap;
- fail-closed MiniMax and Codex handoff.

## Remote evidence not produced

```text
Owner Mac native hydration PASS
Gate 2 local successor PASS
packaged Electron
artifact SHA-256
runtime ID
113/113 packaged suite
three performance receipts
critical product journeys
quit/relaunch persistence
Codex focused retest
signing/notarization/Gatekeeper
Human Owner Gate
```

## Required next evidence

The exact final repair SHA must pass the complete source gate. MiniMax must then create new worktrees, cache, receipt, evidence, artifact, and runtime identities. Old local assets are reference-only and cannot satisfy the new receipt schema.
