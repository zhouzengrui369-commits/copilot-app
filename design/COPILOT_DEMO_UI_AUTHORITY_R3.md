# Copilot Demo UI Authority R3

Status: `OWNER_GRANTED / WEB_FIRST / ELECTRON_AND_PACKAGE_BLOCKED_PENDING_OWNER_WEB_ACCEPTANCE`

## Exact authority

- Owner-pinned source: `design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html`
- Bytes: `52046`
- SHA256: `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`
- Original owner path: `/Users/njx/.codex/visualizations/2026/07/21/019f8389-47b3-7463-9cfe-b859bdc2c545/copilot-phase1-mvp-demo-v3-calendar-moc.html`

The file name plus this SHA256 identify the sole UI source. The internal HTML title says v4 and its historical footer says `UI_SOURCE_AUTHORITY=NOT_GRANTED`; neither value creates a second source or overrides the Owner's 2026-08-13 authorization.

## Required sequence

1. Develop and test the browser HTML/renderer at 1440x900.
2. Present the live browser page and source-bound screenshots to NJX Owner.
3. Keep `OWNER_WEB_UI_ACCEPTANCE=PENDING` until NJX explicitly accepts the web result.
4. Only after that acceptance may a new, separate successor integrate or validate Electron, package an app, or notify the local deployment executor.

No source test, browser fixture, screenshot, commit, GitHub check, Electron launch, or package output may infer Owner web acceptance.

## Product mapping

- The top-level navigation is exactly `今天 / 知识 / 对话 / 设置`.
- Today is the existing Schedule composition, not a new store or product route.
- Knowledge defaults to the readable MOC. The persisted 2D relationship graph remains a secondary in-Knowledge view.
- Wiki Studio remains reachable from Knowledge as a secondary organizer tool; it is not a fifth primary navigation destination.
- Ask must remain source-backed and fail closed when sources are absent, stale, or unverified.
- Contextual AI stays attached to the current object and collapsed by default.
- Settings keeps local-first truth; Remote and Backup remain OFF / POST-MVP.

## Explicitly deferred from the Demo

The Demo's 3D star-ocean, PPT/photo import, speaker diarization, cross-app background recording dock, additional provider integration, and all fixture data are reference-only and outside Phase 1 implementation truth. They must not be presented as working product behavior.

## Gate state

```text
UI_SOURCE_AUTHORITY=OWNER_GRANTED
WEB_FIRST_GATE=PASS_PENDING_OWNER_REVIEW
OWNER_WEB_UI_ACCEPTANCE=PENDING
ELECTRON_INTEGRATION_AUTHORITY=BLOCKED
PACKAGE_AUTHORITY=BLOCKED
LOCAL_DEPLOYMENT_NOTIFICATION=BLOCKED
MVP_NOT_COMPLETE
NOT_RUNTIME_PROOF
NOT_RELEASE_READY
```
