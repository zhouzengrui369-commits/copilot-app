# Desktop Environment Runbook

## Production

- App: `/Users/njx/Applications/njx-copilot.app`
- Bundle id: `ai.njx.copilot`
- Port: `38888`
- Data: `/Users/njx/openclaw_data/copilot/data`
- Rule: do not overwrite during development. Use only after explicit production promotion.

## Development

- App: `/Users/njx/Applications/njx-copilot-dev.app`
- Bundle id: `ai.njx.copilot.dev`
- Port: `38889`
- Data: `/Users/njx/openclaw/copilot/data/env/dev/data`
- Workspace: `/Users/njx/openclaw/copilot/data/env/dev/workspace`
- Password: `openclaw2026`
- UI: must show `DEV 测试环境 · 38889`.

## Commands

- Install/update dev app: `npm run desktop:dev:install`
- Refresh dev data from production snapshot: `npm run desktop:dev:seed`
- Promote to production: `OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW npm run desktop:prod:promote`
- Isolation contract smoke: `npm run test:env-isolation`

## Recovery

If production shows `Workbench 服务不可连接`, check whether another process owns port `38888`.
Only the packaged server path under `/Users/njx/Applications/njx-copilot.app` should own production port `38888`.
