# tests-e2e/baseline

Reference PNG shots consumed by `scripts/ci/screenshot-diff.sh`.

Workflow:

1. Land a real reference screenshot here (e.g. `01_settings_panel.png`).
2. CI captures a current shot under `tests-e2e/current/`.
3. `screenshot-diff.mjs` overlays both via pixelmatch. < 0.1% drift passes.

A 200×200 dark-blue placeholder is committed so that, before any real
screenshot has landed, the diff job is green and the contract is testable.
Remove the placeholder file (and any others) as real references arrive.

CI on `main` enforces the diff. CI on feature branches tolerates it so
contributors can iterate without first having to update the baseline.
