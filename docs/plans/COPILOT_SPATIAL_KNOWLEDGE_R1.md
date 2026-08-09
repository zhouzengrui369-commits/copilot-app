# COPILOT-SPATIAL-KNOWLEDGE-R1 — Deferred Planned Goal

Status: `DEFERRED_CURRENT_MVP`

## Why deferred

Copilot Phase 1 is macOS-first and its current baseline explicitly excludes a 3D knowledge graph. Existing final-candidate coverage, Electron E2E, performance, signing, notarization and installation gates take priority. Geo Context must not become scope creep.

## Future outcome

Provide a local-first spatial view of knowledge that connects authorized place context with notes, entities, relationships, Todo/events and source evidence.

## First implementation when activated

1. map local knowledge/location entities to GeoScene;
2. implement a **2D local-first** spatial view first;
3. preserve local-source IDs, bidirectional references and offline behavior;
4. support filtering/search/details consistent with existing KG UX;
5. only evaluate 3D after the 2D spatial task proves user value and current MVP is shipped;
6. keep all current security/credential/local-authority rules.

## Activation gate

- current Phase 1 MVP gates closed;
- separate Owner-approved Goal;
- central Geo Context capability version revalidated at exact SHA;
- no regression of local-first/offline behavior.

No runtime code is authorized by this planning PR.
