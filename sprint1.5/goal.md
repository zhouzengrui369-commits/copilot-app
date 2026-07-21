# Sprint 1.5 Goal · Win Dev Signing Wire + Branded Icon + PM SOP 固化

> **Sprint**: 1.5 — Sprint 1.4 follow-up 主线 (产品化)
> **触发**: NJX 2026-07-10 19:34 popup 拍板「Sprint 1.4 partial close 验收通过 + PM 自动起 S1.5 prep」
> **Close 目标**: W4 Gate (2026-07-19 预计) — Phase 1 W4 复盘会前 S1.5 全员 close + 4 文档 ready
> **Owner**: NJX (OPC) · **PM**: Mavis (mavis)
> **依赖**: Sprint 1.4 partial close PASS (commit `32950d8c`, 4/5 wave done, Wave 4 deferred → S1.5 T-1.5.1)

---

## 1. 北极星 (single measurable target)

**Sprint 1.5 DONE 的定义**:
> NJX 在 Windows 10/11 真机双击安装带 **branded icon + self-signed dev cert** 的 njx-copilot-v6 installer 后, 应用成功启动, 桌面/开始菜单 shortcut 出现, **Windows SmartScreen 提示"未知发布者"但 byte-level 已 signed** (signature 验证 PASS), **PM 抓到 0 critical gap, W4 Gate 复盘会前 S1.5 4 文档全员 ready**。

**量化验收**:
- T-1.5.1: dev cert wire PASS (signed artifact byte-level 验证, signtool verify ok)
- T-1.5.2 (候选): branded icon 替换 T-1.3.2 placeholder, 4 artifact rebuild, NSIS 显示正确
- 钉子 #38: PM SOP 加 Sprint close dist bundle ↔ src grep 校验 (PM 自动化, 无需 NJX 验收)
- 4 文档 (goal/plan/rules/delivery) 全员 ready + W4 Gate retrospective 草案 ready

---

## 2. Sprint 1.5 In-Scope

| 范畴 | In/Out | 理由 |
|------|--------|------|
| **T-1.5.1** dev cert self-signed .pfx wire (deferred from S1.4) | ✅ IN | S1.4 board.md 明确写到 S1.5 T-1.5.1, NJX 拍板 19:44 |
| **T-1.5.2** branded icon (替换 T-1.3.2 placeholder) | ✅ IN | NJX 19:44 拍板, NSIS 显示需要真 branded icon, 跟 dev cert 一起 rebuild 一次 |
| **T-1.5.3** vitest 181 → 200+ 补齐 (5 packages) | ✅ IN | NJX 19:44 拍板 with-tests, test coverage 补齐, 7/19 W4 Gate 前可 close |
| **钉子 #38** Sprint close dist bundle grep SOP | ✅ IN (PM 自主) | 暴露 S1.4 Welcome 文案漂移 gap, PM 自主加进 SOP, W4 Gate 复盘会拍固化 |
| **T-1.5.4** RAG Electron renderer UI | ❌ OUT (推 S1.6 / Phase 2) | 产品功能级, 跨 Sprint 不属于 S1.5 W4 Gate 前必跑 |
| **Sprint 1.4 deferred macOS WIP** | ❌ OUT | 属 KnowMe 项目, 不属 copilot 桌面 app |
| **Code signing 真实 prod cert** | ❌ OUT | 需要实名 cert + 钱, S1.6+ Phase 2 才做 |
| **Win SmartScreen 信誉积累** | ❌ OUT | 需要 prod cert + 时间, S1.6+ |
| **Auto-update publishing** | ❌ OUT | electron-builder.yml `publish: null` 保持 |
| **Mac packaging** | ❌ OUT | S1.2 已 PASS, 维持 |
| **Linux packaging** | ❌ OUT | 不在 Sprint 1.5 范围 |

---

## 3. Sprint 1.5 Anti-Goals (明确不做的)

- ❌ 不要升级 electron-builder major version (保持 25.x 兼容 S1.4 baseline)
- ❌ 不要 commit `build/dev-cert.pfx` 到 git (gitignore 加固, S1.4 rules.md §3.2)
- ❌ 不要 commit `CSC_KEY_PASSWORD` 到任何 tracked 文件 (env-only)
- ❌ 不要引入 prod cert material (self-signed 仅, S1.4 rules.md §3.1 红线)
- ❌ 不要在 Win runner 上跑 Mac build (Mac-only feature flag, S1.4 rules.md §5.2)
- ❌ 不要在 S1.5 范围内动 Sprint 1.2 已知 worktree / Sprint 2 macOS WIP (跨项目隔离)
- ❌ 不要把 T-1.5.3 / T-1.5.4 强行塞进 S1.5 (W4 Gate 7/19 前时间窗不够, 推 S1.6)

---

## 4. Sprint 1.5 Exit Criteria

**Sprint 1.5 可以 CLOSE 当且仅当**:
1. T-1.5.1 PASS: dev cert self-signed .pfx + electron-builder wire → 4 artifact signed byte-level PASS + signtool verify ok
2. T-1.5.2 PASS (如纳入): branded icon 替换, 4 artifact rebuild, NSIS 显示正确, NJX 真机看截图 PASS
3. 钉子 #38 SOP 落地: Sprint close PM 必跑 `dist bundle vs src grep` 抓漂移 (固化为 PM SOP, W4 Gate 复盘会拍板)
4. 4 文档 (goal/plan/rules/delivery) 全员 ready
5. PM hand-audit 抓 + 修任何 critical gap (钉子 #23)
6. 全员 NJX acceptance pass
7. Sprint 1.5 archive 闭环 (含 retrospective + W4 Gate summary 草案)
8. NJX 重装新版后发 "Welcome 1.4 release" 截图闭环 (S1.4 遗留)

---

## 5. 与 OPC 12 周路线图对齐

- Sprint 1.5 = **Phase 1 W4 Gate 准备最后冲刺** (7/10-7/19, 6 工作日)
- Wave 1 (T-1.5.1) 7/10-7/11 (NJX 周末有空可参与)
- Wave 2 (T-1.5.2 如纳入) 7/14-7/15 (周一周二)
- Wave 3 (W4 Gate 准备 + 钉子 #38 SOP) 7/16-7/17
- **7/19 W4 Gate 复盘会**: 1h retrospective + Phase 2 kickoff 拍板
- S1.5 不抢 Phase 2 任务, 主线收尾 + 复盘准备

---

## 6. 与 Sprint 1.4 的衔接

Sprint 1.4 board.md 明确:
- **Wave 4 (T-1.4.1d dev signing wire) → S1.5 T-1.5.1** (已 deferred, NJX 默认接受)
- **新发现 (待 NJX 拍板是否固化为钉子 #38)**: Sprint close 必须 verify dist bundle ↔ src 关键字符串一致性 (S1.5 起加进 PM SOP)
- **等 NJX 重装新版后发 "Welcome 1.4 release" 截图闭环** (S1.4 遗留, S1.5 exit criteria 之一)
- **W4 Gate 复盘会 (7/19 预计) 前 1h PM 准备 retrospective + summary** (S1.5 close 节点)

**S1.3 follow-up 候选 backlog** (S1.4 goal.md §6 留底):
- T-1.4.4 vitest 181 → 200+ → 推 S1.6
- T-1.4.2 branded icon → S1.5 T-1.5.2 (推荐纳入)
- T-1.4.3 RAG Electron renderer UI → 推 S1.6 / Phase 2
- T-1.3.0b spec baseline → S1.6 (跟 vitest 一起)

---

## 7. PM 自主决策边界 (per §0.1)

**S1.5 内 PM 自主** (无需弹窗 NJX):
- 技术分叉 (dev cert 算法选型 / icon 格式 / file path 决策)
- Wave 顺序调整
- 错误修复 / 验证策略调整
- 钉子 #38 SOP 加进 PM workflow (PM 自身规则)
- 滚动更新 board.md / 文档 typo 修订

**S1.5 内 NJX 拍板** (必弹窗):
- S1.5 范围 (本 goal.md §2 候选 task 选几个)
- Dev cert 真实部署 vs 仅 wire 验证 (本 sprint 仅 wire, 但要 NJX 确认)
- Branded icon 设计方向 (用现成 logo vs 设计师新做)
- 任何外部承诺 (发 release / 共享 cert / etc)
- 任何破坏性操作 (删旧 cert / 改 git history / etc)

---

**Goal.md close**: 2026-07-10 19:35 CST (PM Mavis) · 等待 NJX 范围拍板
**Next**: Sprint 1.5 plan.md 起草 (基于 NJX 拍板范围) → 启动 Wave 1 sub-plan (T-1.5.1 dev signing wire)
