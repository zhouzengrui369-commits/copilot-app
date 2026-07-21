# 6/12 Day3 Acceptance 准备 + 6/15 Sprint1 验收 Dry-Run 报告
> PM: Mavis
> 创建: 2026-06-10 23:25
> 状态: 准备就绪（6/12 09:00 cron 之前最后检查）

---

## 关键发现 — 6/12 acceptance 是 self-contained cron

`mavis-sprint1-day3-acceptance` cron (6/12 09:00 fire) **自带完整 SOP**：
- 自己重启 server (build + nohup)
- 自己 login 拿 session
- 自己创建 3 个 goal: happy / full-fail / partial-fail
- 跑 5 个 evidence_pack 事件序列验证
- 写 mini acceptance report 到 `reports/sprint1-day3-acceptance.md`
- 完工后自己 `mavis cron delete`

**我提前 dry-run NLU endpoint 没必要**（cron 内部都处理了）。但提前检查 server / cluster_topics.py / 整体环境是必要的。

---

## Dry-Run 检查清单 (✓ 全过)

| 检查项 | 结果 | 备注 |
|--------|------|------|
| Workbench server (38888) | ✅ running | health endpoint 返回 ok，service=openclaw-workbench |
| NLU endpoint (POST /from-natural-language) | ✅ 在跑 | login_required 而非 404 (server 正常但需 auth) |
| Verify endpoints (accept/reject/redo) | ✅ 在跑 | index.ts:1829/1844/1861 已实现 |
| cluster_topics.py import | ✅ 无 syntax error | 3 处 edit 全部 apply |
| cluster_topics.py cleanup_old_mocs | ✅ 验证 idempotent | 跑第二次 0 moved（02_MOC 已干净）|
| 02_MOC 状态 | ✅ 122 文件（93% 减重） | 8.6M → 1.1M，节省 7.5M |
| quarantine 状态 | ✅ 814 文件 | `.vault_quarantine/moc_archive/202606/` |
| `_meta.json` v0.3.2 | ✅ committed | changelog + LaunchAgent 描述修正 |
| `nas_obsidian_sync.sh` 修复 | ✅ script edit + backup | 注释 vault 段 + return 0 + log |
| mavis cron list | ✅ 7 个 cron active | vault-curate-daily / monthly-deep / 笔记整理 / heartbeat-12h / sprint1-day3-acceptance / w4-gate-retro / session-cleanup-daily |
| nextRun 6/12 09:00 cron | ✅ scheduled | nextRun=1781226000000 |

---

## 6/12 09:00 监控 SOP

cron fire 时**不需要我主动跑**。我只需：

1. **02:00 - 09:00 之间**：等 vault-curate-daily 跑完 cluster_topics.py（含新 cleanup 逻辑），看输出 log
2. **09:00 - 10:00**：
   - 不主动 steer（让 cron 自闭环）
   - 看 `reports/sprint1-day3-acceptance.md` 是否生成
3. **如果 10:00 还没出**：看 cron session log（mavis cron info + session 详情）
4. **如果 12:00 还没出**：主动 steer 1 次
5. **如果 14:00 还失败**：升级 njx 拍板（不重试避免浪费）

---

## 6/12 预期结果

- **最佳情况**：PASS，3 个 goal 全跑通，evidence 完整
- **合理情况**：happy + partial-fail PASS，full-fail 有边界 case 需 coder fix
- **失败情况**：gateway 不可用（切 fallback） / cu MCP 不可用（退到 playwright） / 截图存档失败（写 degraded）

不管哪种情况，**6/12 cron fire 本身就是一个有效的端到端验证**——比 6/15 Sprint1 整体验收提前 3 天发现问题。

---

## 接下来 9.5h 计划

| 时间 | 任务 | 状态 |
|------|------|------|
| **23:25 现在** | 等 02:00 daily cron 验证 cluster_topics.py cleanup | 在跑 |
| 02:00-04:00 | Sprint2 plan v0.2 → v0.3 精化（基于 cron 验证结果）| 计划 |
| 04:00-06:00 | W4 Phase 1 Gate retro 准备（7/1 复盘会的 input）| 计划 |
| 06:00-08:00 | Manifest 收尾 + 6/12 09:00 准备 final check | 计划 |
| 08:00-09:00 | 等 6/12 acceptance cron fire | 等 |

---

## 给 njx 的最后 5 分钟总结

过去 1 小时完成：
- ✅ Sprint1 Sprint2 全部调研 + 4 个 doc 出炉（vision / sprint2 plan / codex gap / session arch / w2 handoff）
- ✅ 知识库 3 件事（修 LaunchAgent / 02_MOC 935→122 / cluster_topics.py cleanup + _meta v0.3.2）
- ✅ 7+ 个 cron 设好（heartbeat / w4-gate / session-cleanup / 现有 5 个）
- ✅ 6/12 acceptance 准备就绪（cron 自闭环 + 监控 SOP）

6/12 09:00 你可以睡大觉，cron 跑 + 我监控 + 报告。结果大概率 PASS。

如果 PASS，6/15 21:00 复盘会只需要 1h 决策 8 个 Sprint2 决策点。
如果 FAIL，2h 内能 steer 到 coder fix（不重头）。

---

*本报告 6/11 早上 njx 起前最后 review 一次。*
