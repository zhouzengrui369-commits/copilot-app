# ASR strict-local source repair

Date: 2026-07-15  
Scope: `apps/copilot-desktop` source/tests and owned macOS purpose strings only  
Verdict: **SOURCE_FIX_PASS / RUNTIME_BLOCKED_ELECTRON33**

## Decision

The Phase 1 production path now fails closed unless Chromium exposes the forced
on-device WebSpeech contract. Electron 33 embeds Chromium 130, while the
`processLocally` / static `available({ processLocally: true })` contract is not
available there. Therefore the honest current runtime result is the stable,
visible `local-api-unavailable` state with no microphone capture and no network
or cloud ASR call. This repair does not claim GUI, microphone, TCC, or real-audio
runtime success.

## Implemented source contract

- `WebSpeechProvider.prepareLocal('zh-CN')` requires both static
  `available({ langs: ['zh-CN'], processLocally: true }) === 'available'` and an
  instance-owned `processLocally` property. It creates exactly one instance,
  sets `processLocally = true`, and `transcribe()` starts that same instance.
- `stop()` ends and awaits the original recognition promise; it never aborts and
  creates no replacement recognition session. `cancel()` is the only hook path
  that calls `abort()`.
- Strict local is the hook default. Missing/downloadable/downloading/unavailable
  capability states are stable and visible, and never enter ordinary WebSpeech
  or cloud fallback.
- Cloud audio upload defaults disabled. A call is possible only when all are
  explicit: `strictLocal: false`, `enableCloudFallback: true`,
  `cloudConsent: true`, and a configured HTTP(S) `serverBaseUrl`. Phase 1
  production supplies none of these opt-ins.
- Recognition and recorder stop/end races have bounded timeouts and idempotent
  settlement. Provider transitions are ordered in the result and rendered in
  the VoiceInput status list.
- Each completed capture result carries `runId`, in-memory Blob SHA-256, MIME,
  byte count, capture duration, and ordered provider transitions. The Blob is
  not persisted by this module and no evidence IPC was added.
- The release accuracy gate is frozen as NFC normalization, removal of Unicode
  whitespace/punctuation, corpus-level Levenshtein character accuracy, and
  exact critical-token presence. The old LCS helper remains compatibility-only
  and is not used by the new gate.
- `electron-builder.yml` now owns explicit
  `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`
  strings that state audio is not automatically uploaded.

## RED -> GREEN evidence

Initial focused RED:

```text
tests/VoiceInput/strict-local-source-contract.test.ts
4 tests, 4 failed
- prepareLocal / same-session stop absent
- forced-local fail-closed capability check absent
- frozen NFC + Levenshtein corpus gate absent
- owned macOS purpose strings absent
```

Final focused GREEN:

```text
npm test -- --run tests/VoiceInput
9 files passed, 62 tests passed
```

Final repository checks:

```text
npm run check
PASS

npm run build
PASS (main + renderer + RENDERER_BUNDLE_VERIFIED)

npm test
51 files passed, 774 tests passed
```

Coverage-related run, with no threshold changes:

```text
npm run test:coverage
50 files passed; 773 tests passed; 1 unrelated timeout
FAIL: release-identity-evidence.test.ts
      streams app.asar entries larger than 16 MiB by offset...
      timed out at the existing 5000 ms limit under coverage overhead
```

The coverage command is therefore recorded as **BLOCKED by an unrelated test
timeout**, not PASS. The ASR focused and renderer critical suites passed inside
that run. The existing coverage configuration only includes settings/preload
sources, so no coverage threshold or include list was changed to manufacture an
ASR percentage.

`git diff --check`: PASS.

## Files changed

- `apps/copilot-desktop/src/renderer/components/VoiceInput/WebSpeechProvider.ts`
- `apps/copilot-desktop/src/renderer/components/VoiceInput/useTranscriber.ts`
- `apps/copilot-desktop/src/renderer/components/VoiceInput/CloudAsrProvider.ts`
- `apps/copilot-desktop/src/renderer/components/VoiceInput/index.tsx`
- `apps/copilot-desktop/electron-builder.yml`
- focused VoiceInput tests, including
  `tests/VoiceInput/strict-local-source-contract.test.ts`
- the existing renderer critical coverage test was aligned with the new
  fail-closed and cancel semantics

No package/lock/Electron version, cloud server, candidate/release protected
artifact, four main index, GUI permission, TCC, or network change was made.

## Acceptance boundary

This is a source-level repair only. Electron 33 cannot prove forced local
WebSpeech at runtime, so runtime ASR remains blocked. A later runtime lane may
only claim success after a supported Electron/Chromium baseline is explicitly
approved and real microphone/TCC evidence is captured; neither was authorized
here.

