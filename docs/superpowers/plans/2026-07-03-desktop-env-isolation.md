# Desktop Env Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure OpenClaw desktop development cannot overwrite or conflict with the production `njx-copilot.app`.

**Architecture:** Runtime environment is inferred from explicit `OPENCLAW_WORKBENCH_ENV` or app bundle path. DEV uses `njx-copilot-dev.app`, port `38889`, isolated repo data under `data/env/dev`, and a DEV CloudBase mac id. PROD remains `/Users/njx/Applications/njx-copilot.app` on port `38888` and requires explicit promotion.

**Tech Stack:** Electron main process, Fastify server env variables, CloudBase forwarder, electron-builder, Node.js install/promote scripts.

---

### Task 1: Runtime Environment Contract

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/server/src/cloudbaseForwarder.ts`
- Test: `scripts/env-isolation-contract-smoke.mjs`

- [x] Add runtime env inference for `dev`, `staging`, and `prod`.
- [x] Make DEV default to port `38889`, data `data/env/dev/data`, workspace `data/env/dev/workspace`.
- [x] Keep PROD on port `38888` and existing production data.
- [x] Give DEV and PROD different CloudBase mac id files.

### Task 2: Build and Install Guardrails

**Files:**
- Create: `scripts/desktop-dev-install.mjs`
- Create: `scripts/desktop-prod-promote.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

- [x] Add `npm run desktop:dev:install` that only writes `/Users/njx/Applications/njx-copilot-dev.app`.
- [x] Add `npm run desktop:prod:promote` that refuses to run without `OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW`.
- [x] Add `dist:mac:arm64:dir` for fast local app bundle builds.

### Task 3: Verification

**Commands:**
- `npm run test:env-isolation`
- `npm run check --workspace @openclaw-workbench/desktop`
- `npm run build --workspace @openclaw-workbench/server`
- `npm run desktop:dev:install`

- [x] Confirm DEV app launches on `38889`.
- [x] Confirm PROD app path is untouched during DEV install.
- [ ] Confirm mobile pairing is tested only against DEV until acceptance.

**Evidence 2026-07-03:**

- `npm run test:env-isolation` passed.
- `npm run check --workspace @openclaw-workbench/desktop` passed.
- `npm run build --workspace @openclaw-workbench/server` passed.
- `npm run desktop:dev:install` installed only `/Users/njx/Applications/njx-copilot-dev.app`.
- DEV runtime log: `/Users/njx/Library/Application Support/njx-copilot-dev/startup.log`
  - `port=38889`
  - `server=/Users/njx/Applications/njx-copilot-dev.app/Contents/Resources/resources/server/index.js`
  - `data=/Users/njx/openclaw/copilot/data/env/dev/data`
  - `macId=mac_dev_njxdeMac-mini_local_10e0d1ab`
- `curl http://127.0.0.1:38889/api/health` returned `{"ok":true,"service":"openclaw-workbench",...}` from outside the sandbox.
- `/Users/njx/Applications/njx-copilot.app` remained timestamped `2026-06-29 21:52:02`; DEV install did not overwrite PROD.
