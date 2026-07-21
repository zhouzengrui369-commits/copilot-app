# OpenClaw Multi-Agent Development Ownership

Status: active from 2026-06-16.

This file is the working contract for Codex, MiniMax Code, Mavis, and OpenClaw agents when they develop in the same product area.

## Environment Truth

| Environment | API port | Data root | Purpose | Write permission |
|---|---:|---|---|---|
| DEV | 38889 | `<project>/data/env/dev/data` | agent development and fixture testing | agents may write |
| STAGING | 38890 | `<project>/data/env/staging/data` | NJX acceptance and E2E | agents may write before acceptance |
| PROD | 38888 | `<project>/data` | real workbench | NJX approval only |
| WEB PREVIEW | 38901 | none | Vite renderer preview | no API state by itself |

`38889` and `38890` mean API environments. Vite preview must use `38901` by default so a frontend preview is not confused with a safe backend environment.

## Required Work Header

Every agent-run task must state these fields before editing code:

```text
owner:
worktree:
branch:
environment:
api_url:
web_preview_url:
data_dir:
allowed_files:
forbidden_files:
acceptance:
rollback:
```

If any field is unknown, the agent must inspect and fill it before editing. If `environment=prod`, the task is read-only until NJX explicitly approves the write.

## Ownership Boundaries

| Owner | Primary responsibility | Allowed by default | Requires explicit coordination |
|---|---|---|---|
| Codex | code integration, environment isolation, tests, final verification | `scripts/**`, `tests/**`, small targeted changes in `apps/**`, package scripts | broad UI rewrites, production restart, data migration |
| MiniMax Code | product exploration, prototype branches, long-running implementation spikes | design docs, preview branches, isolated worktrees | touching `main`, changing `package-lock.json`, editing shared runtime files |
| Mavis | PM docs, PRD, acceptance criteria, scorecards | `*.md`, `design/**`, reports | claiming implementation complete, promoting prod |
| OpenClaw boss/worker | background task execution, reports, evidence collection | task folders, recovery reports, non-prod generated artifacts | code changes on shared files, prod writes |
| NJX | product decision and release approval | final ACCEPT/REJECT | none |

## Hot Files

Only one owner may edit a hot file at a time:

```text
apps/web/src/App.tsx
apps/web/src/styles.css
apps/server/src/index.ts
apps/server/src/workbenchV11.ts
apps/desktop/src/main.ts
apps/desktop/src/server-runner.ts
package.json
package-lock.json
development-gates.json
```

Before touching a hot file, run `git status --short` and `git diff -- <file>`. If the file already has unrelated edits, make a narrow patch around the target lines or stop and report the conflict.

## Test Rules

Writable smoke tests must not target PROD by default.

Use DEV or STAGING:

```bash
npm run env:dev
npm run env:staging
npm run test:prd:staging
npm run test:e2e:staging
```

Production smoke writes require explicit intent:

```bash
OPENCLAW_ALLOW_PROD_SMOKE_WRITE=YES-I-KNOW npm run test:prd
```

UI verification must name the exact surface:

```text
API: http://127.0.0.1:38888
Vite: http://127.0.0.1:38901
Staging API: http://127.0.0.1:38890
```

## Conflict Protocol

1. Do not overwrite unrelated dirty files.
2. Do not trust a port label. Verify the process and URL.
3. Do not treat `38901` as a safe data environment; it is only a renderer preview.
4. Do not promote to PROD from an agent-generated report alone.
5. If two agents need the same hot file, split by branch/worktree and merge through Codex after tests.
6. If the live UI disagrees with terminal output, the live UI and generated artifact are the acceptance source.

## Acceptance Contract

A development task is accepted only when all are true:

- The intended environment is named and matches the URL under test.
- The changed files match the declared ownership boundary.
- `npm run check` passes or the exact pre-existing failure is recorded.
- Relevant smoke/e2e commands are run against DEV or STAGING.
- Screenshots or generated artifacts are tied to the exact URL/path reviewed.
- NJX explicitly accepts before PROD promotion.
