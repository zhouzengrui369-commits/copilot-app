# ACCEPTANCE LOG

## Controller Decision

`STAGE0_ACCEPTANCE_PASS / COMMIT_PENDING / MVP_NOT_COMPLETE`

Accepted only as a reproducible product-layer source baseline:

- Git base: `main@96c861706126317c27965fcb64c765973df9ac89`
- active branch: `codex/p0-owner-gate`
- r3 source entries: `414`
- tracked deletions: `7`
- bytes: `51,347,389`
- aggregate SHA256:
  `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`
- current materialized manifest SHA256:
  `157a29c17b65562c3c0fbe61c08757067a15d2a9b64033e2429405e621876f99`
- scope: `PASS`
- unclassified secret matches: `0`
- `git diff --check`: `PASS`

This does not accept tests, Electron runtime, package, signing, release, owner
experience, or MVP completion. `EXP-COP-008` and `EXP-COP-009` remain open.
