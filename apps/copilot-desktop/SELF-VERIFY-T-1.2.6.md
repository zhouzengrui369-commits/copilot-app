# SELF-VERIFY · Sprint 1.2 · T-1.2.6 · Settings Panel + Theme + Model API Config

> v2 (RETRY) · worktree `wt-T126v2` · branch `sp1.2-T-1.2.6-v2`
> Author: coder · Date: 2026-07-10

## Scope (钉子 #14 v2)

Extend Sprint 1.1 T-1.1.1 settings panel with:
- **ThemeSelector** — radio tiles for 深 / 浅 / 自动
- **ModelApiConfig** — 4 providers (minimax default / OpenAI / Claude / 自托管)
- **ResetButton** — gated by 3s arm + window.confirm
- **useSettings** — zustand facade hook + providerDefaults helper
- **packages/llm-client** — new providers (openai, claude, custom) + factory

Decision red lines respected:
- ✗ no Electron native theme API (CSS variables + React Context)
- ✗ no LLM provider schema switch at runtime (config only; restart hint shown)
- ✗ no changes to Sprint 1.1 cloud-backup toggle (钉子 #2)
- ✗ no changes to main / apps/web / apps/server / apps/mobile

## Verification

```
packages/llm-client : npm run check ✓ / npm test ✓ 198/198 / npm run build ✓
apps/copilot-desktop: npm run check ✓ / npm test ✓ 87/87 / npm run build:main ✓
```

### Acceptance cases (钉子 #14 v2 · 5 件齐)

1. **ThemeSelector flips store theme (深/浅/自动)** — `ThemeSelector.test.tsx` (5 cases) + `T-1.2.6-settings.test.tsx` 3-case group
2. **ModelApiConfig switches provider + persists** — `Settings.ModelApiConfig.test.tsx` (5) + `T-1.2.6-settings.test.tsx` 4-provider group
3. **Persist round-trip through bridge** — `Settings.useSettings.test.tsx` (3 cases) + `T-1.2.6-settings.test.tsx` hydrate group + `settings-store.test.ts` modelApi merge/validate (7 cases)
4. **ResetButton gates reset** — `Settings.ResetButton.test.tsx` (5 cases) + `T-1.2.6-settings.test.tsx` gated-confirm group
5. **LLM client reinit (createProvider dispatch)** — `T-1.2.6-settings.test.tsx` 4-provider factory group + `config.test.ts` (17 cases) + openai.test.ts (6) + claude.test.ts (4) + custom.test.ts (5)

## Changed files

```
M apps/copilot-desktop/src/main/main.ts
M apps/copilot-desktop/src/main/preload.ts
M apps/copilot-desktop/src/main/settings-store.ts
M apps/copilot-desktop/src/renderer/components/SettingsPanel.tsx
M apps/copilot-desktop/src/renderer/stores/settings.ts
M apps/copilot-desktop/src/renderer/types/settings.ts
M apps/copilot-desktop/src/shared/ipc-channels.ts
M apps/copilot-desktop/tests/SettingsPanel.test.tsx
M apps/copilot-desktop/tests/preload.test.ts
M apps/copilot-desktop/tests/settings-store.test.ts
M packages/llm-client/src/index.ts
A apps/copilot-desktop/src/renderer/components/Settings/
  ├ index.tsx
  ├ ThemeSelector.tsx
  ├ ModelApiConfig.tsx
  ├ ResetButton.tsx
  ├ useSettings.ts
  └ styles.module.css
A apps/copilot-desktop/src/renderer/types/css-modules.d.ts
A apps/copilot-desktop/tests/Settings.ModelApiConfig.test.tsx
A apps/copilot-desktop/tests/Settings.ResetButton.test.tsx
A apps/copilot-desktop/tests/Settings.ThemeSelector.test.tsx
A apps/copilot-desktop/tests/Settings.useSettings.test.tsx
A apps/copilot-desktop/tests/T-1.2.6-settings.test.tsx
A packages/llm-client/src/config.ts
A packages/llm-client/src/providers/{claude,custom,index,openai}.ts
A packages/llm-client/tests/{claude,config,custom,openai}.test.ts
```

## Notes for verifier

- **Field-name translation at IPC boundary**: main process stores `provider` (e.g. "minimax"), renderer side stores `id` (matches @copilot/llm-client ProviderConfig). The renderer-side `stores/settings.ts` translates between the two via `toRendererModelApi` / `toMainModelApi` helpers in `applyToState` and `setModelApi`. This is the **production-correct** path; v1 lacked this translation and tests passed by mocking the bridge with `id` directly, which masked the gap. v2's test mocks send the main-shape (`provider`) so the round-trip exercises the real translation.
- **`@copilot/llm-client` consumer**: ModelApiConfig uses `import { listProviders, PROVIDER_IDS } from '@copilot/llm-client'` so the renderer picks up new providers automatically without forking the settings panel.
- **4 IPC channels added**: `copilot:settings:set-model-api` for the LLM config; pre-existing channels for theme/cloud/shortcuts/window unchanged.
- **decision #2 (云备份默认 OFF)**: still intact — Sprint 1.1 toggle behavior preserved, `cloudBackupEnabled` defaults to `false`.
- **No Electron theme API**: theme is rendered via `<select>` radio tiles writing to a Zustand store; the actual `<html data-theme>` swap is in App.tsx (Sprint 1.1 territory, untouched).
- **No runtime provider schema switch**: the renderer saves config + shows "needs restart" hint; the main process reads the new config on next boot.
- **Self-tested via @testing-library/react** with jsdom — no Electron spawn required.