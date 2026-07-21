# Sprint1 Task4 — GoalVerifyTab (dev-center 桌面验收 Tab)

**Plan**: plan_b88df441 / Task4
**Status**: COMPLETE (owner override-accept, worker killed at 15min cap during wrap-up)
**Date**: 2026-06-10

## 范围交付

- `apps/web/src/GoalVerifyTab.tsx` (NEW, 558 行, export default)
- `apps/web/src/styles.css` (+589 行,在末尾追加 `.goal-verify-tab` section)
- `apps/web/src/App.tsx` (+28 行,引入 + tab 挂载,符合 ≤30 行 cap)

## Tab 集成

- 在 Goal 详情页 tab 列表加入 `"verify"` 键:`["overview", "plan", "result", "verify", "timeline"]`
- Verify tab 内容:由 `GoalVerifyTab` 渲染,父组件传入 `goal` + `evidencePack`
- 端点契约 (server 端已就绪, 见 `apps/server/src/index.ts:1829/1844/1861`):
  - `POST /api/development/goals/<id>/verify/accept` → `goal.status → completed`
  - `POST /api/development/goals/<id>/verify/reject` → `goal.status → blocked`
  - `POST /api/development/goals/<id>/verify/redo`   → `goal.status → blocked/running`, 清空 blockers
- 用户决策按钮:ACCEPT / REJECT / REQUEST_REDO
- 截图缩略图序列:暂用 evidence pack 的 artifacts/coverage/events(因 base64 截图未通过 REST 暴露,Sprint2 desktop verify harness 接入后直接显示,无需改本组件 contract)
- 元数据:app / action / 时间戳 / diff score 全部在 evidence 列表中展示

## Owner 独立 verify

| 检查项 | 结果 |
| --- | --- |
| `GoalVerifyTab.tsx` export default | ✅ |
| `fetch /verify/${decision}` 三分支全在 | ✅ (line 261) |
| props-only,不读全局状态 | ✅ (types `VerifyGoal` / `VerifyArtifact` 内联) |
| `App.tsx` diff ≤ 30 行 | ✅ (+28) |
| `styles.css` 仅末尾追加 | ✅ (+589 追加,89 处 `goal-verify-tab` 引用) |
| `npm run check` 0 error | ✅ |
| `npm run build` 0 error | ✅ (✓ built in 5.29s) |
| 服务端三 endpoint 已存在 | ✅ (line 1829/1844/1861) |

## 设计约束 (来自 openclaw-workbench.md memory)

1. ✅ 不引入新依赖,仅 `useEffect`/`useMemo`/`useState` + 原生 fetch
2. ✅ 不在 App.tsx 主体堆叠,独立文件 export default
3. ✅ props-only,父组件最小接入成本(挂载 + 传 goal/evidencePack)
4. ✅ 截图缺失场景有 graceful degradation:无 evidencePack 时显示 loading skeleton + "等待 desktop harness 写入证据"

## 浏览器 E2E

未做(desktop verify harness 截图通过 REST 暴露是 Sprint2 范围,Task4 仅做 UI 接线)。curl 验端点已存在,本任务不要求。

## 收尾

- commit 由 owner 完成 (与 Task3 相同 wrap-up 流程)
- Sprint1 Day1 (前端) 全部前置 tasks 完成,后续 Sprint2 接入 desktop verify harness 截图流即可点亮完整视觉验收

---

## Coder 独立 re-verify (commit 20871c89, 2026-06-10 16:08)

**Owner override-accept at commit 20871c89** — owner 在上一个 15min cap kill 后独立 verify 工作树并完成 commit。本轮 coder 只做独立 re-verify,未触碰任何代码。

### Verify 输出

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git log --oneline -3` | `20871c89 feat(workbench-ui): Sprint1 Task4 — GoalVerifyTab 独立组件 (Verify/ACCEPT/REJECT/REDO)` ✅ |
| 2 | `git show --stat 20871c89` | 4 files changed, 1222 insertions(+), 5 deletions(-) — `apps/web/src/App.tsx` (+28)、`apps/web/src/GoalVerifyTab.tsx` (NEW, +558)、`apps/web/src/styles.css` (+589)、`reports/sprint1-task4-verify-tab.deliverable.md` (+52) ✅ |
| 3 | `cd apps/web && npm run check` | exit 0,0 error ✅ (tsc --noEmit PASS) |
| 4 | `cd apps/web && npm run build` | `✓ built in 4.76s` 0 error ✅(chunk size warning 跟本任务无关) |

### 收尾

- 代码未改动 (per owner override 指令)
- 此 deliverable 已 append 完整 verify 输出
- 同步写入 plan output 路径:`/Users/njx/.mavis/plans/plan_b88df441/outputs/sprint1-task4-verify-tab/deliverable.md`
- board.md 已 append done
- 已 report 给 owner
