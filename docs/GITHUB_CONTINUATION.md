# GitHub continuation handoff

## Project truth

- Workspace baseline: root `goal.md`, `plan.md`, `rules.md`, and `delivery.md` v6.2.
- Product boundary: local-first Electron desktop app. Cloud remains an optional, stateless boundary.
- Current release truth: MVP and Phase 1 are not complete. Do not promote source-green, unit-test, or unsigned evidence to release completion.
- Current platform sequence: validate the macOS MVP milestone first; Windows remains a later Phase 1.1 lane. Existing Windows release/signing paths must remain intact.

## Current execution gate

- MiniMax provider Phase A evidence-recovery successor `r32e2` reached a terminal parser failure with stable reason `CALL_COUNT`.
- `STAGE_B_VERIFIED=false`; the protected r32 commands evidence was consumed once and must not be read or retried.
- Continue from a new, explicitly authorized successor based only on the fresh r32e2 RESULT/EVIDENCE summary. Never claim Stage B passed.

## Shared UI boundary

- Shared Know me / BaiLongma UI governance has been acknowledged.
- Preserve the accepted Knowledge page information architecture; do not add a sidebar or route shell.
- `UI_SOURCE_AUTHORITY=NOT_GRANTED_BY_SHARED_UI_HANDOFF`.
- UI source or baseline work remains sequenced after the precise test/TSC successor reaches a safe terminal state.

## Repository safety

- This GitHub repository is intended to be private.
- Local credentials, signing certificates, Developer ID/notary material, runtime databases, logs, build outputs, APKs, and ignored task transcripts are not repository artifacts.
- Never paste or commit secrets. Use GitHub/ChatGPT credential integrations or local secure stores.
- Before every push, run a redacted secret scan and inspect the exact staged diff.

## Next action

Close the r32 evidence-recovery failure honestly, define the smallest non-rereading successor, obtain the required bounded authority, and then resume the MVP critical path. Keep UI implementation blocked until its sequencing gate and source authority are both satisfied.
