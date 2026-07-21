# VoiceInput once-per-runId fix r1 — independent static review

- Date: 2026-07-15 (Asia/Shanghai)
- Verdict: **PASS_STATIC_REVIEW / TESTS_NOT_RUN / MVP_NOT_COMPLETE**
- Mode: source-only, read-only verification; this report is the only write

## 1. Bound evidence

| Input | Required SHA256 | Observed SHA256 | Result |
|---|---|---|---|
| `tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/asr-production-readiness-gap-audit-r1.md` | `c18eeb406ecf924c84a20b93417425bfb9bf69d7781252062cb3eece4af723ee` | `c18eeb406ecf924c84a20b93417425bfb9bf69d7781252062cb3eece4af723ee` | MATCH |
| `tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/voiceinput-once-per-runid-fix-r1.md` | `1fbaa72d5ecd8e991206297e7cc4f0fd6178246560a860272ed12cfb484ed82f` | `1fbaa72d5ecd8e991206297e7cc4f0fd6178246560a860272ed12cfb484ed82f` | MATCH |

The implementation report truthfully retains `SOURCE_FIX_ONLY / REGRESSION_TEST_ADDED_NOT_RUN / MVP_NOT_COMPLETE`.

## 2. Allowed-file identity and focused change

| Allowed file | Contract preimage | Reported postimage | Current observed | Result |
|---|---|---|---|---|
| `apps/copilot-desktop/src/renderer/components/VoiceInput/index.tsx` | `e1f11c0857d12f39bfa86f141b1254572549516b235c58ab3c6167500903d115` | `d47c1c4f7724634987ff43c28b463502834d3b6449c6ec41cceed54d4ef7eb0e` | `d47c1c4f7724634987ff43c28b463502834d3b6449c6ec41cceed54d4ef7eb0e` | MATCH |
| `apps/copilot-desktop/tests/VoiceInput/VoiceInput.test.tsx` | `d53a2c69fd30b8e73348dfb718d45e450d6b0ed8f8c27e1d282f077b5535ab3a` | `f7c0cf9bfcdb66d227fe4cd1ecee3db79782ea83a596a6e05caa18df98f7a490` | `f7c0cf9bfcdb66d227fe4cd1ecee3db79782ea83a596a6e05caa18df98f7a490` | MATCH |

Focused source inspection found only the contract-shaped behavior:

- `VoiceInput` adds a component-lifetime `Set<string>` of delivered run IDs.
- Completion/error banner handling is separate from transcript persistence delivery.
- Delivery dependencies are scalar status, run ID, text and callback, not the full props/result object identity.
- The regression test adds a stable completed transcriber helper, corrects the render-only test name/comment, and covers the same `run-1` across a parent props rerender followed by distinct `run-2`.

## 3. Required semantic checks

| Requirement | Static finding | Result |
|---|---|---|
| Same completed run ID across props/parent rerender calls at most once | A rerender may re-run the effect when callback identity changes, but `deliveredRunIdsRef.current.has(runId)` blocks redelivery. New props/result object identity alone is no longer a dependency. The focused regression changes `showProviderBadge` while `run-1` remains done and asserts one call. | PASS_STATIC |
| Later distinct run ID calls once | `run-2` is absent from the Set, changes the scalar dependency and is marked/delivered once. The regression asserts total calls rise from one to two and checks the second text. | PASS_STATIC |
| Mark before callback | `deliveredRunIdsRef.current.add(runId)` executes before `onTranscribe(text)`. Failure cannot cause an implicit retry on a later render. | PASS_STATIC |
| Synchronous throw isolation | Callback invocation is inside `try/catch`; a synchronous throw is swallowed at the VoiceInput boundary. | PASS_STATIC |
| Asynchronous rejection isolation | `Promise.resolve(...).catch(() => undefined)` consumes rejection. The authored regression uses `mockRejectedValue`, then confirms transcript UI remains rendered. | PASS_STATIC; TEST_NOT_RUN |
| Empty/invalid completion is not delivered | Delivery returns unless status is `done`, trimmed run ID is non-empty, text is non-empty and callback exists. | PASS_STATIC |
| Old test overclaim corrected | `runs a full start → stop → transcript cycle` is now `renders the initial idle recorder controls`; its comment explicitly delegates the full media flow elsewhere. | PASS_STATIC |
| Existing UI/provider behavior retained | Banner, badge, provider transitions, recorder controls, waveform and transcript rendering remain present; the change is confined to effect structure and duplicate-delivery guard. | PASS_STATIC |

## 4. Scope containment

The current hashes of all other ASR/source identities explicitly bound by the audit remain exact:

- `VoiceWorkspace.tsx` `4c883cd82d4103ac680def7265e9d8a839c37ac5637768893ba8b9149d402fbb`
- `VoiceInput/useTranscriber.ts` `b50285b3e5f1a456227ad95a155fa550feb1b11ce5b52a15bdad094d59c18b16`
- `VoiceInput/WebSpeechProvider.ts` `c3a4350ad492cdd8956d61d63ee1bfdb5b49656caf56bc75460977c471611d61`
- `VoiceInput/CloudAsrProvider.ts` `89aff823eb5f19cdfae19648617cb0cb6422567bb481d22c0d546320d3fa8bd8`
- `main/main.ts` `0b7338a0513803479ba2898981eff45660cd6d612fc0b19617fb8dda422ef9cc`
- `main/preload.ts` `06eae4c5f99f2734bc6014d46c2f240d8e817308432208c26a6b8bf5d8a801a9`
- `main/media-permission.ts` `d979de2adb6c4f524941edae395a96284096c6ef15256be95eb22cef2a93208b`
- `shared/runtime-meta.ts` `ebc33c1e9718e6696bdb6e62eb774a15933b980e918c465b4248db5391d81ab0`
- desktop `package.json` `368100e3fd208ff3bd122b1263abb275e8df8abfd772eb852bde20585d0e8541`
- `electron-builder.yml` `09fb05a84878cbbe9475b3fb013a320e93a5cee5b73d91fa77522b44d31eaf2a`

This independently confirms no drift in the audit-bound forbidden ASR/provider/main/preload/permission/package/builder surface. The implementation report also declares no scope-out change. No claim is made about unrelated pre-existing workspace changes outside this hash-bound repair.

## 5. Explicit non-runs and final decision

Per the review contract, no test, npm command, type-check, Electron, build, network, Git operation or application shutdown was performed. Therefore authored regression coverage is not an executed PASS.

**Final decision:** `PASS_STATIC_REVIEW / TESTS_NOT_RUN / PRODUCTION_ASR_STILL_ABSENT / MVP_NOT_COMPLETE`.

The two-file change statically satisfies the once-per-runId data-integrity contract. It does not provide a production ASR provider, licensed model, native Electron decode, microphone/TCC proof, signed candidate or Phase 1 completion.
