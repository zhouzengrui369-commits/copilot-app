# 6/12 09:00 Sprint1 Day3 Acceptance Cron 准备清单

> 触发: 6/11 12:00 PM 自查（fire 21h 前）
> cron: mavis-sprint1-day3-acceptance (6/12 09:00 Asia/Shanghai)
> 作用: build + login + 3 goal 端到端跑（happy/full-fail/partial-fail）+ 写 mini report + delete self

---

## Fire 前必查（08:30 / 12h pre-fire）

### 1. 环境健康

| 检查项 | 命令 | 期望 |
|--------|------|------|
| workbench server | `curl -s http://127.0.0.1:38888/api/health` | 200 + setupRequired:false |
| orbstack docker | `docker info \| grep "Server Version"` | 有 Server Version 行 |
| desktop app 进程 | `ps aux \| grep "njx-copilot Helper (Renderer)" \| grep -v grep` | 在跑 |
| cu MCP | `mavis mcp ls \| grep cu` | enabled |
| mavis cron daemon | `mavis cron list mavis \| grep sprint1-day3` | enabled + nextRun 1781226000000 |

### 2. 当前阻塞

| 阻塞 | 已知/未知 | 缓解 |
|------|-----------|------|
| Docker daemon 没启 | **已知**（6/11 11:50 启了 orbstack） | 再确认 daemon 还在跑；没启就 open -a OrbStack |
| gateway_unavailable | **已知**（boss 派发需要 sandbox） | 启 docker + 接受可能 retry 1-2 次 |
| session cleanup daily 没跑 | 已知（6/16 起才生效） | 忽略 |

### 3. 不会触发的

- vault-curate-daily 已 PASS（6/11 02:00 跑通 cluster_topics.py cleanup）
- heartbeat-12h 在跑（下次 12:30）
- w4-gate-retro 6/16 才 fire
- session-cleanup-daily 6/16 才生效

---

## Fire 时监控 SOP（09:00 - 14:00）

1. **09:00 - 10:00**：**不主动 steer**（让 cron 自闭环）
   - 看 `reports/sprint1-day3-acceptance.md` 是否生成
2. **如果 10:00 还没出**：
   - 查 cron session 状态：`mavis cron list mavis | grep day3`
   - 看 cron session id 对应的 stdout / stderr
3. **如果 12:00 还没出**：主动 steer 1 次
   - `mavis communication send --to <cron-session-id> --command prompt --content "状态报告"` 拉它出来报
4. **如果 14:00 还失败**：升级 njx 拍板（不重试避免浪费 cron 窗口）

---

## 预期结果分级

| 情况 | 标准 | 行动 |
|------|------|------|
| **PASS** | 3 goal 全跑通，evidence 完整 | 0 行动；6/15 复盘会 review |
| **合理** | happy + partial-fail PASS，full-fail 边界 case | 6/13-14 coder fix |
| **FAIL** | gateway 不可用 / cu 不可用 / 截图失败 | 写 degraded report；不重试 |

**任何结果都是有效验证**——比 6/15 整体验收提前 3 天发现问题。

---

## 我已准备的输入

1. ✅ 验证 baseline 真实工作（6/11 11:30 端到端验证报告）
2. ✅ 清理测试 project（不污染 6/12 数据）
3. ✅ Sprint2.1 plan v0.3 备份（6/12 不动它）
4. ✅ Gap 1 retry 探针跑通 + commit
5. ✅ orbstack 已启（如果 fire 时 docker daemon 又挂了，重启即可）

---

## Cron TTL 提醒

```
[self-reminder TTL] This reminder expires at 2026-06-24 15:10:43
TTL 14 天，不会自动删；6/12 fire + self-delete 后这条 cron 物理消失
```

---

*本清单 6/12 08:30 复查一次，fire 完后归档到 reports/sprint1-day3-acceptance-aftermath.md*
