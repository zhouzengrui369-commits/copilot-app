# Sprint 1.2 · T-1.2.4 · Voice Input · BUGFIX SELF-VERIFY v2

> PM: Mavis | Worker δ (coder) | Branch: `sp1.2-T-1.2.4-bugfix`
> Worktree: `/Users/njx/openclaw/copilot.wt-T124v3/wt-T124v3`
> Base: main HEAD `6dcee235` (post cycle-2 close audit)
> Parent commit: `99d588a8` (Merge T-1.2.4 v2: voice input — NJX 07:09 hybrid 🅰)
> Plan: `plan_a745f301` · Attempt 5 (Attempts 1-4: 1 KILLED cap + 2 race-loop + 1 worktree native-binary crash)

---

## 1. Scope (轻量 bug fix only)

Two real bugs found by NJX hand-audit of attempt 1 (`cf52275f` merged as `99d588a8`):

| # | Bug | Fix |
|---|-----|-----|
| 1 | `CloudAsrProvider.DEFAULT_SERVER_BASE` = `'http://127.0.0.1:8787'` (wrong) | → `'http://127.0.0.1:38888'` (matches `apps/server/src/config.ts:31 PORT = 38888`) |
| 2 | Orchestrator had implicit primary path — `webSpeechPrimary` and `cloudAsrSecondary` ran in parallel, cloud POST was the source of truth | Refactored into 3 named, individually-testable functions: `webSpeechPrimary()`, `cloudAsrSecondary()`, `nativeFallback()` |

## 2. Files changed (3)

```
M apps/copilot-desktop/src/renderer/components/VoiceInput/CloudAsrProvider.ts
   - DEFAULT_SERVER_BASE 8787 → 38888
   - Doc comment explaining the source-of-truth discipline (钉子 #23)

M apps/copilot-desktop/src/renderer/components/VoiceInput/useTranscriber.ts
   - Added 3 module-level exported functions:
     webSpeechPrimary(deps)  → PRIMARY (webkitSpeechRecognition, macOS Siri)
     cloudAsrSecondary(deps) → SECONDARY (form-data POST to /api/asr/transcribe)
     nativeFallback(deps)    → NATIVE FALLBACK (Sprint 1.3 reserved; today returns
                               typed `no-fallback-available` so the orchestrator
                               surfaces a clear "no provider worked" state)
   - useTranscriber.stop() now chains: primary → if empty/throws → secondary → if empty/throws → native
   - TranscriberResult.provider now typed as 'web-speech' | 'cloud' | 'native' (钉子 #23 explicit markers)
   - status contract refined: 'recording' once start() resolves (regardless of WebSpeech availability — orchestrator decides in stop() whether to call primary)

?? apps/copilot-desktop/tests/VoiceInput/paths.test.ts  (NEW — 9 cases)
   - DEFAULT_SERVER_BASE points to 38888 (not 8787)
   - webSpeechPrimary returns text / empty-with-below-threshold / not-supported
   - cloudAsrSecondary returns text / no-audio / http-503
   - nativeFallback returns no-fallback-available
   - Orchestrator chain: primary preferred over secondary when both succeed
```

**Not touched** (per dispatch §3):
- ❌ apps/web/, apps/server/ source — only `CloudAsrProvider.ts` port + `useTranscriber.ts` refactor
- ❌ VoiceInput UI components (index.tsx, RecorderButton.tsx, Waveform.tsx, WebSpeechProvider.ts, styles.module.css) — already on main
- ❌ Tests/fixtures — kept, added 1 new file
- ❌ main branch — work on `sp1.2-T-1.2.4-bugfix`

## 3. Verification — all green

```bash
$ tsc -p tsconfig.main.json --noEmit       # 0 errors
$ tsc -p tsconfig.renderer.json --noEmit   # 0 errors
$ tsc -p tsconfig.tests.json --noEmit      # 0 errors
$ vitest run tests/VoiceInput               # 54/54 PASS (45 pre + 9 new paths.test.ts)
$ node scripts/test-asr-accuracy.mjs --min-accuracy 0.9
# web 1.0000 / cloud 0.9944 / combined 0.9972 — VERDICT: PASS
```

## 4. 钉子 #23 self-audit (PM Independent Verification)

| Self-audit check | Status | Evidence |
|------------------|--------|----------|
| Default port matches workbench config (`apps/server/src/config.ts:31`) | ✅ | `paths.test.ts > DEFAULT_SERVER_BASE points to actual workbench port` |
| Orchestrator primary path is explicit | ✅ | `webSpeechPrimary` exported, named, testable in isolation; orchestrator chains PRIMARY → SECONDARY → FALLBACK |
| Orchestrator secondary path is explicit | ✅ | `cloudAsrSecondary` exported; only invoked when primary returns empty/throws |
| Orchestrator fallback marker exists | ✅ | `nativeFallback` exported; reserved for Sprint 1.3 Whisper.cpp sidecar |
| Type markers ('web-speech' / 'cloud' / 'native') | ✅ | `Provider` union; `TranscriberResult.provider` typed |
| `tsc --noEmit exit 0` | ✅ | all 3 configs clean |
| Real audio input (cu MCP E2E) | ⚠️ DEFERRED | cu MCP not connected for this branch; static analysis + 54/54 vitest covers behavior |

## 5. Architecture — explicit path markers

```
              ┌─────────────────────────────┐
              │      useTranscriber()       │
              │      orchestrator hook      │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  webSpeechPrimary(deps)     │  ← PRIMARY (macOS Siri)
              │  provider: 'web-speech'     │
              │  errorCode: below-threshold │
              │            | not-supported  │
              │            | engine-error   │
              └──────────────┬──────────────┘
                             │ if !primary.text
                             ▼
              ┌─────────────────────────────┐
              │  cloudAsrSecondary(deps)    │  ← SECONDARY (Tencent via /api/asr/transcribe)
              │  provider: 'cloud'          │
              │  errorCode: http-503 | network | bad-json | no-audio | below-threshold
              └──────────────┬──────────────┘
                             │ if !secondary.text
                             ▼
              ┌─────────────────────────────┐
              │  nativeFallback(deps)       │  ← FALLBACK (Sprint 1.3 reserved)
              │  provider: 'native'         │
              │  errorCode: no-fallback-available (today)
              └─────────────────────────────┘
```

## 6. Notes for verifier

### 6.1 Why the orchestrator was borderline in attempt 1
- Original `useTranscriber.stop()` used a single `cloud.transcribe(audioBlob)` call as the authoritative source.
- WebSpeech ran in parallel via `ws.transcribe(...).catch(...)` whose result was discarded.
- This meant end-side success + cloud silent = cloud (empty) wins, not end-side. **That violates "WebSpeech primary" task contract**.
- Bugfix v2 makes PRIMARY the actual source of truth: orchestrator calls `webSpeechPrimary(deps)` FIRST, only invokes secondary if primary's `text` is empty.

### 6.2 Why port 8787 was hardcoded
- Original agent (me, attempt 1) guessed a "round number" port (8787) when writing the client constant.
- Actual workbench port (per `apps/server/src/config.ts:31`) is `38888` — set as the fallback when `OPENCLAW_WORKBENCH_PORT` env is unset.
- 钉子 #23 (PM discipline): when writing a client that talks to an existing same-repo server, ALWAYS grep `<server>/src/config.ts` for `PORT` / `HOST` before guessing. Round-number ports (8787, 3000, 5000) are a smell — real monorepo ports tend to be 38888 / 38777 / specific.

### 6.3 What is preserved from attempt 1 (cf52275f → 99d588a8)
- All other VoiceInput source files (index.tsx, RecorderButton.tsx, Waveform.tsx, WebSpeechProvider.ts, styles.module.css)
- CSS modules type declaration
- 7 test files in tests/VoiceInput/ (45 cases)
- 1 fixture (asr-samples-zh.json, 12 zh-CN samples)
- 1 accuracy probe script
- App.tsx wiring (Voice nav + VoiceInput)
- 3 screenshots

### 6.4 What is new in bugfix v2
- DEFAULT_SERVER_BASE port fix
- 3 named orchestrator paths (`webSpeechPrimary` / `cloudAsrSecondary` / `nativeFallback`)
- 1 new test file (`paths.test.ts`, 9 cases asserting the markers + port)

## 7. Retry context

| Attempt | Outcome | Lesson |
|---------|---------|--------|
| 1 | KILLED @ 15min cap | Wrap-up first; commit before polish |
| 2 | Cycle-2 wrap-up commit cf52275f | Post-kill grace + race detection |
| 3 | Re-dispatch race loop | PM stand-down discipline |
| 4 | Worktree native-binary crash | 钉子 #22 node_modules fresh-install path |
| **5 (this)** | **Bugfix v2 PASS** | 钉子 #23 self-audit (port + primary-path) |

---

VERDICT: PASS