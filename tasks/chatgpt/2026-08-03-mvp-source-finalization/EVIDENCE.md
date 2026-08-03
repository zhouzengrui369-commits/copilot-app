# EVIDENCE — macOS MVP Remote Source Finalization

## GitHub facts at branch creation

```text
main:                       e91cafaa22ea100428b404b371aa35dce535c5bf
product source baseline:    feb93d6b87284ac68a62de0919d4ee10ca25ee9d
source baseline workflow:   copilot-source-gate / 30697461817 / SUCCESS
review branch:               review/copilot-product-experience-baseline
review branch head:          31dfd0c7f9feca77da82f4a02bf359d85818742c
latest focused review:       NOT_READY / BLOCKED_EXP_COP_008
```

The focused review used dirty/untracked source-run Electron and therefore remains non-reproducible runtime evidence.

## Source evidence found in the consolidated branch

- `AskWorkspace.tsx` persists completed exchanges and matching Todo receipts.
- Local source actions require `LOCAL_PRESENT` source truth.
- `App.tsx` carries source-origin and exact Todo navigation state across workspaces.
- `ScheduleWorkspace.tsx` exposes `day`, `all` and `unscheduled` scopes, focuses the exact requested Todo, supports editing and performs canonical readback.
- `exp-cop-008-todo-closure-r1.test.tsx` covers multi-source Todo creation, Unscheduled discovery and editing.
- `ask-source-back-continuity-p1.test.tsx` covers persisted Ask restore, exact source reader return, stale-source fail-closed behavior and async receipt races.
- the source workflow requires Node 24 macOS checks, builds, tests, strict coverage, production SBOM and exact Electron discovery `113 tests in 9 files`.

## Evidence not produced remotely

```text
Electron runtime launch
packaged candidate PASS
artifact SHA-256
runtime ID
candidate-bound screenshots
113/113 packaged Electron result
three performance receipts
full quit/relaunch readback
Codex focused retest
signing/notarization/Gatekeeper
Human Owner Gate
```

## Required next evidence

MiniMax Code must return a complete exact-SHA technical package. Codex must independently operate the same candidate. Until both complete, GitHub source evidence is not runtime or product-experience acceptance.
