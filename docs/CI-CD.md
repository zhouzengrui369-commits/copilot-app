# CI/CD Pipeline

> Owner: T-1.1.6 worker ζ | Created: 2026-07-09 (Sprint 1.1)
> Status: scaffold ready. Real CI runs from the first push after Sprint 1.1 freeze.

This document is the developer-facing view of the GitHub Actions pipelines,
helper scripts, and the performance-baseline loop that ship with the copilot
app. If you are looking for the contracts, see
[`sprint1.1/T-1.1.6-CI-CD-pipeline.md`](../sprint1.1/T-1.1.6-CI-CD-pipeline.md).

---

## 1. Workflows at a glance

| Workflow | Trigger | Runner | Purpose |
|---|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every PR + push to `main`/`sp1.1-*` | ubuntu + macos | lint → unit → integration → e2e → build → screenshot-diff → bench |
| [`release-mac.yml`](../.github/workflows/release-mac.yml) | `v*` tag | macos-14 | build `.dmg` + `.zip` for x64/arm64 and publish via `softprops/action-gh-release` |
| [`release-win.yml`](../.github/workflows/release-win.yml) | `v*` tag | ubuntu+wine (default) / windows | build `.exe` / `.msi` via electron-builder |
| [`release-cloud.yml`](../.github/workflows/release-cloud.yml) | `staging-*` tag | ubuntu | package server bundle, deploy to Tencent CloudBase staging |
| [`nightly-bench.yml`](../.github/workflows/nightly-bench.yml) | cron `0 2 * * *` | ubuntu | snapshot perf baseline + emit delta report |

Dependency updates are driven by [`.github/dependabot.yml`](../.github/dependabot.yml)
on a weekly cadence, with major bumps held back for human review.

## 2. Job graph

```
lint ──► unit ──► integration ──► e2e ──► build ──► screenshot-diff
                                              └► bench
```

Each job caches `node_modules` keyed by `package-lock.json` so a hot cache
hits in < 30 s on rerun. PRs that only touch `.github/**`, `docs/**`, or
`benchmarks/baseline.json` still trigger lint + bench but skip the e2e/build
chain (path filter).

## 3. Helper scripts

All scripts live under `scripts/ci/` and are designed to be runnable both
locally and inside CI:

| Script | What it does |
|---|---|
| `lint.sh` | walks declared workspaces, runs `npm run lint` on each, writes `reports/lint/*.log` |
| `unit-test.sh` | walks declared workspaces, runs `npm test`, writes `reports/unit/*.log` + `_summary.json` |
| `integration-test.sh` | prefers `test:integration` / `test:int` scripts, falls back to `test` with `INTEGRATION=1` |
| `e2e-test.sh` | runs `npx playwright test` + `npm run test:e2e` if defined |
| `screenshot-diff.sh` + `.mjs` | pixelmatch diff of `tests-e2e/baseline/*.png` vs `tests-e2e/current/*.png` |
| `bench-collect.sh` + `.mjs` | snapshots previous baseline, runs the collector, writes `benchmarks/baseline.json` |
| `bench-validate.mjs` | asserts `benchmarks/baseline.json` satisfies `benchmarks/schema.json` |
| `bench-compare.mjs` | emits `reports/bench/delta.json` (used by nightly job) |
| `run-ci-local.sh` | orchestrates the whole chain on a dev machine |

### Tolerant while Sprint 1.1 is in flight

CI is designed so that an empty / not-yet-merged workspace does not break the
build. Every script detects missing workspaces and emits a
`::warning::`/`::notice::` annotation rather than failing the run. Once
Sprint 1.1 freeze lands all 5 workspaces, switch each script from "warn"
to "fail" by removing the early `exit 0` branches.

### Running locally

```bash
bash scripts/ci/run-ci-local.sh
# equivalent to:
bash scripts/ci/lint.sh && bash scripts/ci/unit-test.sh && \
  bash scripts/ci/integration-test.sh && bash scripts/ci/e2e-test.sh && \
  SCREENSHOT_DIFF=warn bash scripts/ci/screenshot-diff.sh && \
  bash scripts/ci/bench-collect.sh && node scripts/ci/bench-validate.mjs
```

## 4. Performance baseline

`benchmarks/baseline.json` is the canonical store of headline perf numbers.
Each run emits the four required metrics:

| id | label | unit | target |
|---|---|---|---|
| `metric_001_app_start` | macOS app cold start | ms | 2000 |
| `metric_002_app_memory` | idle memory | MB | 500 |
| `metric_003_kb_query` | 100 notes query avg | ms | 50 |
| `metric_004_kg_render` | 100 nodes FPS | FPS | 30 |

Initial values ship at 0 (placeholder). The nightly workflow writes the
real measurements as features land; `bench-compare.mjs` flags any metric
that regressed > 10% versus the previous snapshot.

To trigger a fresh snapshot locally:

```bash
bash scripts/ci/bench-collect.sh
node scripts/ci/bench-validate.mjs
cat benchmarks/baseline.json | jq .
```

## 5. Adding a new metric

1. Edit `benchmarks/schema.json` — add the metric to `metrics[]`, bump `version`.
2. Extend `scripts/ci/bench-collect.mjs` with a new `measureMetric00X*()` and
   wire it into `main()`.
3. Update `benchmarks/baseline.json` so the entry passes `bench-validate.mjs`.
4. Bump `benchmarks/baseline.json#schema_version` to match the schema.

## 6. Visual regression

Baseline shots land in `tests-e2e/baseline/`. Captured shots go to
`tests-e2e/current/`. `screenshot-diff.mjs` writes the red-mask overlay to
`reports/screenshot-diff/*.png` and a machine summary to
`reports/screenshot-diff/result.json`.

A 320×180 dark-blue placeholder (`00_default_placeholder.png`) is committed
so that the very first CI run is green and the contract is testable before
real screenshots exist. Replace it as real references arrive.

On `main` and `sp1.*` branches, screenshot diff failures are surfaced as
`::error::` annotations and fail the build. On feature branches they are
warned so contributors can iterate without first updating the baseline.

## 7. Release flow

```
git tag v0.1.0          # → release-mac.yml + release-win.yml build & publish
git tag staging-2026-07-09  # → release-cloud.yml deploys to CloudBase staging
```

Required secrets (set under Settings → Secrets):

- `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `TENCENTCLOUD_ENV_ID`
  — used by `release-cloud.yml`. Until these are populated the cloud job
  exits with code 78 (EX_CONFIG) and skips cleanly.

## 8. Known limitations

- **macOS runner is GitHub-hosted** — 30 min / job cap. A self-hosted runner
  is on the Sprint 1.3 backlog (T-1.3.2 follow-up).
- **Windows builds use Wine + electron-builder.** Code signing on real
  Windows VMs is intentionally deferred to Sprint 1.3 / T-1.3.2.
- **Visual-regression baseline is empty by design.** First real reference
  shots land with T-1.3.3 (E2E integration).
- **Cloud deploy is staging-only.** Production promotion is a separate
  workflow owned by T-1.4.x.

---

*Maintained by worker ζ (T-1.1.6). Update together with the matching
contract in `sprint1.1/T-1.1.6-CI-CD-pipeline.md`.*
