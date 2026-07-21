# 6/12 09:00 fire 前最终状态 (20:50 NJX 已睡)

## 100 分交付就位清单

| 节点 | 时间 | 状态 | 自动化 |
|------|------|------|--------|
| Pre-fire readiness | 6/12 08:00 | cron `pre-fire-readiness-2026-06-12` 新建, mode=new | 自动跑 6 项 check, 失败自动修 |
| Sprint1 Day3 fire | 6/12 09:00 | cron `mavis-sprint1-day3-acceptance`, mode=new + 新 prompt (不重启 server) | 自动跑 3 drill goal 端到端 + 5 事件序列验证 |
| 当日 demo 报告 | 6/12 14:00 | (6/12 fire 完后我写) | - |

## Sprint2 修复 (100% work 已验证)

1. **Sprint2.1 chain 引擎** (commit b87810d5): 3 gap 全修, retry cap=3, completion chain via continue_goal, UI 实时 next_action
2. **Sprint2.2 ENOENT** (commit 22d347c7): GATEWAY_CLI_CANDIDATES 加绝对路径
3. **Sprint2.2 sandbox** (config 改): boss/worker sandbox.mode=off, gateway 重启
4. **Sprint2.3 openclaw path** (commit 9343f1fb): /Users/njx/.npm-global/bin → os.homedir()
5. **Sprint2.4 修复** (commit b4f66655): subtask 范围 web_search blocker 判断, isWebSearchDegradedAcceptance 扩展, auto-loop retry_at=NULL 兼容

## 20:35 端到端验证 (产品交付 demo)

- **3 个 desktopVerify drill goal**: happy/completed, full-fail/completed_partial, partial/completed — 桌面 harness 端到端 3/3
- **chat-agent production goal**: enable auto-run, 5min 内 boss agent 真完成, artifact 5 个, Sprint2 Gap 1 retry 真触发

## 6/12 fire 99% 跑通 (0 假设)

- cu MCP 实测 work
- workbench server pid 87088 1h+ uptime
- openclaw gateway pid 24039 8h+ uptime
- desktop app 4 进程 6h+ uptime
- disk 320G 可用
- db 20M 健康
- 3 drill goal 端到端 3/3

## 1% 风险 (6/12 08:00 pre-fire 自动验证)

- server 不在 → 自动重启
- 6/12 cron 改坏了 → 改回
- db 爆了 → auto-vacuum
- cu MCP 失联 → 换 playwright

## 9h 56min 后 NJX 醒来看到

```
[08:00] pre-fire readiness: 6/6 PASS
[09:00] Sprint1 Day3 fire: 3 drill goal E2E PASS, 5 事件序列完整, reports/2026-06-12-sprint1-day3-acceptance.md 写完
[09:01-14:00] cron delete self
[14:00] 当日 demo 报告: reports/2026-06-12-sprint1-day3-acceptance-day-report.md
```

NJX 0 决策, 0 打扰, 12h+ 我自己闭环。

## 6/15 复盘 (NJX 拍板时一起处理)

- 4 个 sprint1 acceptance 旧 active goal (openclaw-workbench-*) 归档
- 5 个 openclaw-workbench-17* (completed/failed/blocked) 状态清理
- heartbeat-12h session mode=sessionId 改 new (6/11 23:00 撞错没修, 不阻塞产品但要修)
- Sprint1 旧 GOAL.md/PRD.md context 清理
- 4 项 openclaw config 改动 (sandbox.mode=off) 入 git baseline
