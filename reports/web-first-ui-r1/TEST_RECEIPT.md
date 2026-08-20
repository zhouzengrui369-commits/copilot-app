# Web-first UI R1 test receipt

Status: `WEB_TEST_GATE=PASS / FULL_DESKTOP_TEST_SUITE=NOT_PASS_OUTSIDE_WEB_GATE`

## Passing web gate

- Desktop renderer typecheck: PASS.
- Browser-only Vite build: PASS (`dist/web-acceptance`).
- Focused UI contracts: PASS, `3` files and `21` tests.
- In-app browser primary navigation: PASS for Today, Knowledge, secondary Wiki Studio, Conversations, Settings, and return to Today.
- Primary navigation count: exactly `4`; no `nav-studio` primary item.
- Browser console warnings/errors: `0`.
- Design QA: `design-qa.md`, `final result: passed`.

## Broad-suite diagnostic (not a web gate)

An informational `npm run test --workspace @copilot/desktop` attempt returned exit `1`:

```text
Test Files  30 failed | 112 passed (142)
Tests       85 failed | 1208 passed (1293)
```

The browser-only checkout was intentionally installed with lifecycle scripts disabled. The broad suite therefore cannot load Electron or the `better-sqlite3` native binding. It also reaches historical candidate-task fixtures absent from this exact PR #20 tree and unrelated pre-existing assertions. This run is recorded as `NOT PASS`; it is not converted into a browser failure or a release claim.

Per the Owner's web-first correction, this change does not install/rebuild native modules, launch Electron, execute packaged E2E, package an app, or repair unrelated candidate/release tests. Those actions remain blocked until explicit web acceptance and a separate successor.

## Gate boundary

```text
WEB_TEST_GATE=PASS
DESIGN_QA=PASS
OWNER_WEB_UI_ACCEPTANCE=PENDING
FULL_DESKTOP_TEST_SUITE=NOT_PASS_OUTSIDE_WEB_GATE
ELECTRON_RUNTIME_GATE=NOT_RUN
PACKAGE_GATE=NOT_RUN
NOT_RUNTIME_PROOF
NOT_RELEASE_READY
```
