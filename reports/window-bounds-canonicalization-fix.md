# Window bounds canonicalization fix

Status: `PASS` for the bounded r28 `SETTINGS_APPLY` source fix. This report does not claim a new candidate, performance raw, signing, or release completion.

## Root cause

`mergeWithDefaults` and the settings IPC handler materialized optional coordinates as own properties with `undefined` values. Electron 33 `BrowserWindow.setBounds` requires a complete numeric Rectangle (`x`, `y`, `width`, `height`), even though initial `BrowserWindow` construction may omit `x` and `y`.

## Fix

- `canonicalizeWindowBounds` keeps `width`/`height`, omits non-numeric optional coordinates entirely, and preserves numeric coordinates (including zero and negative multi-display positions).
- `parseWindowBoundsMutation` applies the same rule at the untrusted settings IPC boundary.
- `mergeWithDefaults` applies the same canonicalizer to persisted/default bounds.
- `applyPersistedSettings` canonicalizes and clamps persisted dimensions, then reads `mainWindow.getBounds()` and fills only missing `x`/`y` before calling `setBounds`; persisted numeric coordinates take precedence.
- Initial `BrowserWindow` options no longer materialize absent coordinates as own `undefined` properties.

## Test-first evidence

RED, before implementation:

- focused file: 4 failures
- failures proved own `x`/`y` were present, the canonicalizer was absent, a strict Electron-like `setBounds` rejected fresh bounds, and a real fresh `createSettingsStore(temp)` returned own undefined coordinates.

GREEN:

- focused settings store: `36/36`, exit `0`
- settings/startup/direct related: `116/116`, exit `0`
- Desktop check: exit `0`
- Desktop build: exit `0`; renderer verifier `files=7`
- canonical Desktop global: `50/50` files, `764/764` tests; statements/lines `77.70%`, branches `88.52%`, functions `93.17%`; exit `0`
- canonical Desktop critical: `50/50` files, `764/764` tests; statements/lines `97.86%`, branches `94.55%`, functions `97.37%`; per-file 90 gate passed; exit `0`
- `git diff --check`: exit `0`
- Node source-contract probe: `WINDOW_BOUNDS_SOURCE_CONTRACT_OK`

The canonical runs retained pre-existing non-fatal jsdom/React warnings; no test or threshold failed.

## Changed files and SHA-256

```text
bc9085c39de58a6d570060860ea6db75057a341dd04c1e19977eda72d0f0a5f7  apps/copilot-desktop/src/main/settings-store.ts
30e779881211906b36b70dce8a8cc88b3236ffdb74f0f2598bc43f918e6e2227  apps/copilot-desktop/src/main/main.ts
05a54d0d27cd4a8930e4cf2bf9ba2a83a546fec746374bdbecaf5c71a18e1094  apps/copilot-desktop/tests/settings-store.test.ts
```

No performance controller/config, protected file, package/lock file, release candidate, signing/notary/finalization path, commit, or push was changed by this fix.
