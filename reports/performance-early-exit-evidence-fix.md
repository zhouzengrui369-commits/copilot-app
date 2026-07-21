# Direct-performance early-exit evidence durability fix

Date: 2026-07-15  
Scoped verdict: **PASS**  
Release verdict: **NOT EVALUATED** — 本任务未运行 raw、未构建 r27、未签名/公证/最终化。

## Problem and root cause

`measure-electron-direct-performance.mjs` 原先只在 ready、metrics、clean exit、候选/可执行文件/harness 复核全部完成后调用 `writePrivateProcessOutput(...)`。当 packaged Electron 在 ready/metrics 前退出并触发 `BLOCKED_DIRECT_PERF_CHILD_EXITED` 时，`finally` 只处理进程树与 harness 清理，导致已捕获的 stdout/stderr 不会持久化，结构失败根因不可观测。

## Exact change

- `apps/copilot-desktop/scripts/measure-electron-direct-performance.mjs`
  - 仅在 child 已成功 spawn，或 stdout/stderr 已实际捕获时，在 `finally` 写入 `<raw>.stdout.log` 与 `<raw>.stderr.log`。
  - 保持 `writeFile(..., { flag: 'wx', mode: 0o600 })`，因此目标只能创建一次且不会覆盖既有证据；成功路径不再提前写，避免 double-write。
  - spawn 前且没有 child 输出时返回 `written: false`，不创建误导日志。
  - 日志持久化失败统一 fail-closed 为 `BLOCKED_DIRECT_PERF_PROCESS_OUTPUT_EVIDENCE`。
  - 若已有主 blocker，主 blocker 保持为首要错误，日志/清理错误附加为 `finalizationErrors` 并以 `DIRECT_PERF_SECONDARY_FINALIZATION` 输出；不会静默替换原始证据不一致。
  - controller 增加 main-module guard，使 evidence helper 可直接单测；命令行入口行为保留。
- `apps/copilot-desktop/tests/direct-performance.test.ts`
  - 新增 finally wiring、early-exit/captured output、0600、O_EXCL no-overwrite、pre-spawn no-log、primary blocker retention 测试。
  - 标记 node test environment，避免 controller 间接加载 esbuild 时与 jsdom realm 的 `Uint8Array` 不一致。

No product UI/service/config/threshold/package/lock/candidate changes. Protected files `scripts/direct-performance-config.mjs` and `tests/r22-v3-run-identity-evidence-adversarial.test.ts` remained pre-existing modified files and were not edited by this task.

## Test-first evidence

Initial RED:

```text
node_modules/.bin/vitest run apps/copilot-desktop/tests/direct-performance.test.ts \
  -t "persists spawned child stdout"
exit 1
expected source to contain export async function persistSpawnedChildOutputEvidence
```

Final focused/related verification:

```text
cd apps/copilot-desktop
node --check scripts/measure-electron-direct-performance.mjs
../../node_modules/.bin/vitest run --config vitest.config.ts \
  tests/direct-performance.test.ts \
  tests/direct-performance-probe.test.ts \
  tests/r22-direct-diagnostics-review-fix.test.ts \
  tests/startup-performance.test.ts \
  tests/r22-startup-lazy-red.test.tsx \
  tests/r22-startup-review-fixes.test.tsx \
  tests/r22-kg-harness-binding.test.ts
exit 0 — 7 files, 64 tests PASS

npm run check
exit 0
```

Canonical coverage gates:

```text
node_modules/.bin/vitest run --coverage \
  --config apps/copilot-desktop/tests/vitest.desktop-coverage.config.ts
exit 0 — 50 files, 751 tests PASS
All files: statements 77.18%, branches 88.05%, functions 92.81%, lines 77.18%

node_modules/.bin/vitest run --coverage \
  --config apps/copilot-desktop/tests/vitest.critical-coverage.config.ts
exit 0 — 50 files, 751 tests PASS
All files: statements 97.86%, branches 94.55%, functions 97.37%, lines 97.86%
```

Build/static verification:

```text
npm run build --workspace @copilot/desktop
exit 0 — main + renderer build PASS; RENDERER_BUNDLE_VERIFIED files=7

node --check apps/copilot-desktop/scripts/measure-electron-direct-performance.mjs
exit 0

git diff --check -- \
  apps/copilot-desktop/scripts/measure-electron-direct-performance.mjs \
  apps/copilot-desktop/tests/direct-performance.test.ts
exit 0
```

Two intermediate invocation issues were resolved before final verification:

- Running jsdom startup tests from the repo root without the Desktop Vitest config produced three `document is not defined` failures; rerun under `apps/copilot-desktop/vitest.config.ts` passed.
- Directly importing the controller under jsdom exposed the esbuild/TextEncoder cross-realm invariant; the node environment marker made the controller test use its actual Node runtime. An initial TypeScript test-interface omission (`code` missing) was then fixed; final `check` is green.

## Diff and SHA256

```text
105 insertions, 28 deletions  apps/copilot-desktop/scripts/measure-electron-direct-performance.mjs
111 insertions, 0 deletions   apps/copilot-desktop/tests/direct-performance.test.ts

5d31d651be00cda48edabdefa2bdd1edc9e319e20bb0c8af61ed2e4de0fab61f  apps/copilot-desktop/scripts/measure-electron-direct-performance.mjs
3a3b7d0f75c3ba5ecbef29df40840e2264d1f09c8189318a3083b355ee97cc54  apps/copilot-desktop/tests/direct-performance.test.ts
```

## Remaining risk / next gate

- 本任务按合同未启动 packaged Electron，因此没有生成 raw 或伪 raw，也没有声明性能门禁完成。
- PM 应基于包含本修复的新、未使用候选 r27 运行 raw1；若仍 early-exit，必须验收同路径 `.stdout.log`/`.stderr.log`、mode 0600、原 blocker 与 secondary finalization 输出，再决定是否允许 raw2/raw3。
- 本修复不改变 `<2s / <500MB / KG100 >=30 FPS / final process zero` 阈值，也不解除双平台真机与签名门禁。
