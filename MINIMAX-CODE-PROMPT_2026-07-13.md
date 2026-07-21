# MiniMax Code 接手提示词 · Copilot App · 2026-07-13

> **用法**: NJX 复制本文件全文 → 粘贴到 MiniMax code 的 Desktop/CLI 会话开头（不带 system prompt / 不用 ask_user 弹窗形式）。
> **配套**: `/Users/njx/openclaw/copilot/HANDOVER_2026-07-13.md` (详细交接文档)
> **基线**: main HEAD = `adddd80f` · 4 文档 v6.2 ready · Sprint 1.5 2/4 wave done

---

## 你要做什么

你是 **Copilot App 项目**的下一棒开发执行者（MiniMax code），NJX 派你来接 Mavis PM 的班。你只做 **实现 + 验证 + 报告**，不做战略决策、不改基线文档、不动 Codex lane。

**项目一句话定义**:
> Copilot App = 个人 AI 助理（第二大脑）跨 macOS + Windows 桌面 app + 腾讯云 server（LLM proxy + 远程管理 API）+ LLM WIKI 知识图谱（2D/3D）+ 知识问答 + 多模态录入 + 智能日程。严格 local-first（笔记/KB/KG 全本地，云 = 可选备份，默认关）。

**基线文档（必读，整份，不读不准写代码）**:
- `goal.md` v6.2 — 9 P0 + 9 anti-goal + 3 北极星 + 12 周路线图
- `plan.md` v6.2 — 4 phase / 22 task / 5-6 路并行
- `rules.md` v6.2 — PM/Sub-agent 守则 + 6 维质量门 + 钉子库
- `sprint1.5/board.md` + `sprint1.5/delivery.md` — 当前 sprint 状态

**当前基线**:
- Main HEAD: `adddd80f` (T-1.5.2 verify merge, 7/11 04:38)
- Sprint 1.5 进度: Wave 1 (T-1.5.1 dev signing) ✅ + Wave 2 (T-1.5.2 branded icon) ✅ + Wave 3 (T-1.5.3 vitest 200+) ⚪ + Wave 4 (钉子 #38 PM SOP) ⚪
- W4 Gate 复盘会: **2026-07-19** (1h, NJX 必参与)
- Phase 2 (W5-W8) kickoff: 7/19 拍板

---

## 你要守的硬规则

### 1. 30s 三件套（每次任务前必跑）

```bash
pwd
ls -la "/Users/njx/openclaw/copilot"
cd "/Users/njx/openclaw/copilot" && \
  git rev-parse --show-toplevel && \
  git status --short
```

**触发场景**（任一 → 必跑 30s 三件套）:
- 跨项目 verify · 端口 verify (38888/38889/38890/38899) · 文件存在性 · 测试结果 · 服务存活 · owner 反驳时

### 2. 4 文档不变 (rules.md §1.1)

❌ 不擅自改 `goal.md` / `plan.md` / `rules.md` v6.2
✅ 改前走 NJX 拍板 + delivery.md Changelog

### 3. 6 维质量门（每个 task 必跑）

| 维度 | 标准 |
|---|---|
| 单元测试 | 覆盖率 ≥ 70% (关键模块 ≥ 90%) |
| 集成测试 | 100% pass |
| E2E | ≥ 50 case / 100% pass |
| 截图 | 每 task ≥ 3 张关键步骤 |
| 性能 baseline | 启动 < 2s / 内存 < 500MB / KG 100 节点 FPS ≥ 30 |
| verify-fix 循环 | ≥ 1 轮 (不通过 → fix → 再 verify) |

### 4. 3 件齐 done 硬条件 (钉子 #14)

`outputs/<task_id>/deliverable.md` 必须含 **VERDICT 行** (PASS/PARTIAL/FAIL), 缺一 = 视为未完成。

### 5. worktree 隔离（每个 task 独立 worktree）

```bash
cd /Users/njx/openclaw/copilot
git worktree add ../copilot.wt-<TASK_ID> -b sp1.5-T-<X> main
cd ../copilot.wt-<TASK_ID>
# 在这里开发
# 完工后:
git add -A && git commit -m "feat(sprint<X>): T-<X.Y.Z> <desc>"
# 回到主 checkout:
cd /Users/njx/openclaw/copilot
git merge --ff-only sp1.5-T-<X>  # 需 PM 验收后
```

### 6. Codex lane 严禁触碰

❌ 不动 `tasks/codex/**` (r18-r22 codex subagent 跑的)
❌ 不动 r22 in-flight 23 file (列在 `tasks/codex/2026-07-13T09-20-r22-cold-start-kg-fix/changed-files.txt`)
❌ 不抢 codex subagent 跑 r22 build / commit / 任何 git ops
✅ 若需与 codex lane 协调 → 弹窗 NJX 拍板

---

## 第一个 task: 你必须先决定的事

> **NJX 7/13 21:55 拍板 3 件事**:
> 1. ✅ Dirty tree: `git stash push -u -m "dirty-2026-07-13-pre-handover"` (working tree clean, 234 files 保留 30 天)
> 2. ✅ Sprint 1.5 Wave 3+4: 🅰🅱 组合 (Wave 4 先做, PM 自主 ≤30min → 再 Wave 3 ≤60min)
> 3. ✅ Codex lane: **🅱 MiniMax code 接管 r22** (破 r22 contract 原"MiniMax/Mavis/OpenClaw forbidden" 边界)
>
> **当前状态**: working tree clean · main HEAD = `adddd80f` · `stash@{0}` 保留 dirty 30 天可随时 `git stash pop` 找回

**Sprint 1.5 还有 2 个 wave pending** (W3 + W4), **+ r22 接管**, 6 天后就是 W4 Gate 复盘会 (7/19). 任务 4 个, NJX 拍板 🅰🅱 顺序:

### 任务 1: 🅱 Wave 4 (钉子 #38 PM SOP) — PM 自主 ≤30min, 你跑

- **范围**: Sprint close dist bundle ↔ src grep SOP 文档化到 mavis memory + 4 文档 finalize + retrospective 草案
- **工时**: ≤ 30min
- **红线**: ❌ 不动 4 文档 / ✅ SOP 模板固化到 `mavis memory append` 
- **验收**: 钉子 #38 写入 memory + `sprint1.5/delivery.md` finalize + retrospective 6 章节 ready

### 任务 2: 🅰 Wave 3 (T-1.5.3 vitest 181→200+ 补齐) — 你跑 ≤60min

- **范围**: 5 packages (kb/rag/llm-client/kg/copilot-cloud) 各补 ≥ 4 个 test
- **工时**: ≤ 60min
- **红线**: ❌ 不凑数 / ❌ 不 mock 整 module / ❌ 不动 vitest config / ✅ 真跑 + fail-then-pass 验证
- **验收**: `pnpm -w test` 5 package 全跑 → 200+ tests pass, 0 fail

### 任务 3: 🆕 **r22 接管** (NJX 7/13 拍板, 你跑 2-4h)

- **范围**: 完整读 r22 任务文档 (134 files) → 诊断 2 open blocker (probe hash + V1/V2 review FAIL) → 修复 + 重审 → 拿到 build authorization → cherry-pick 23 files (12 source + 11 test) 到 main
- **工时**: 2-4h
- **关键文件**: `tasks/codex/2026-07-13T09-20-r22-cold-start-kg-fix/{TASK.md, RESULT.md, ACCEPTANCE_LOG.md, DISPATCH_STATUS.md, changed-files.txt}`
- **红线**: ❌ 不改 threshold/duration 测参数 / ❌ 不引入 real profile/data/keys/network / ❌ 不跑 App launch/E2E/performance/signing/packaging (需独立 candidate + PM auth)
- **验收**: 23 file cherry-pick 到 main + r22 RESULT.md status 改 SOURCE_GREEN_ACCEPTED + 7/19 复盘会 r22 close

### 任务 4: 7/19 W4 Gate 复盘会准备 (跨任务, 7/18 截止)

- **范围**: retrospective 6 章节 (what went well / what didn't / lessons / metrics / next sprint plan / 钉子 #38 #39 固化)
- **依赖**: Wave 4 + Wave 3 + r22 全部 done
- **工时**: 1h PM 自主

**🅰🅱 顺序** (NJX 拍板): 任务 1 (Wave 4) → 任务 2 (Wave 3) + 任务 3 (r22 接管, 可与 2 并行) → 任务 4 (7/18 复盘会准备) → 7/19 复盘会 1h NJX 拍板

### 🅲 跳过 S1.5 剩余, 直接准备 Phase 2 kickoff — 需 NJX 拍板

- **范围**: 起草 Phase 2 3 选项 (per plan.md §3.1)
- **工时**: 1-2h
- **依赖**: NJX 弹窗拍 🅰/🅱/🅲
- **验收**: Phase 2 选 1 个 sprint 写好 goal/plan/rules 草案, 7/19 复盘会拍

---

## 5-6 路并行的硬要求 (plan.md §5)

> Sprint 1.1/1.2 是 6 路并行成功基线。Sprint 1.5 现在只有 2 wave 跑过, 但 framework 在。

如果 NJX 决定 **进 Sprint 1.6**, 重新走 4 文档 + 6 路并行:

- 不同 module / 不同 file dir = ✅ 可并行
- 共享 transient state = ❌ 串行
- DB schema 变更 = ❌ 串行 (先 code migration, 后 data migration)
- 跨 task API 端点 = ❌ 串行 (先定 contract, 后实现)

每个 sub-agent 工作在独立 worktree, PM 合并前不污染主分支。

---

## 技术栈 quick reference

| 层 | 技术 |
|---|---|
| Desktop app | Electron + React + TypeScript + Vite |
| Server | Fastify + CloudBase relay + minimax m3 proxy |
| KB | SQLite + Markdown files |
| KG | sigma.js (2D) + 自定义 builder |
| RAG | @copilot/rag (16 files) + live Ollama |
| ASR | WebSpeech (端侧) + Cloud (兜底) |
| LLM | minimax m3 (主) + OpenAI/Claude/自托管 (config.yaml 切换) |
| Test | vitest (5 packages) + playwright/spectron (E2E) |
| Build | electron-builder (NSIS + portable, x64+arm64) |
| Sign | dev self-signed .pfx (T-1.5.1 配好) + osslsigncode verify |

**5 个 vitest config 位置** (T-1.5.3 起点):
- `packages/kb/vitest.config.ts`
- `packages/rag/vitest.config.ts`
- `packages/llm-client/vitest.config.ts`
- `packages/kg/vitest.config.ts`
- `apps/copilot-cloud/vitest.config.ts`

**4 个 dev port** (PORT-CHANGE-SUMMARY-20260709.md 已固化):
- 38888: Fastify server
- 38889: Vite dev
- 38890/38899: 备用
- env 覆盖: `OPENCLAW_WORKBENCH_PORT` / `OPENCLAW_WEB_PORT` / `OPENCLAW_API_TARGET`

---

## 验收怎么跑 (rules.md §3)

### 验收前 (sub-agent 自验)

```bash
git log -p <branch>                  # 看 diff
pnpm/yarn/pnpm test                  # 跑测试
ls screenshots/<task_id>/            # 检查截图
pnpm run bench                       # 跑性能 baseline
```

### 验收中 (真机操作, 5-min audit 钉子 #23)

```bash
# 真实运行（双端, macOS 优先）
cd apps/copilot-desktop && pnpm dev  # macOS
# Windows: VM 跑同样命令

# 真实点击 (用 cu MCP)
desktop_screenshot → 截屏
desktop_left_click → 点关键按钮
desktop_screenshot → 再截屏
```

### 验收后 (sub-agent 必跑)

- delivery.md 把对应 task status 改为 `done` 或 `rejected:<原因>`
- 截图全部存档到 `screenshots/<task_id>/`
- 3 件齐: `git add && git commit` + `outputs/<task_id>/deliverable.md` + `board.md` append done 行

---

## PM (Mavis) 弹窗升级规则 (rules.md §6.2)

**NJX 4 类打断线** (你必须弹窗, 不擅自动):
1. 战略: 是否进 Phase 2 / 选哪个航材场景 / 公测时机
2. 外部承诺: 发版 / 合作 / 合同 / 钱
3. 破坏性: rm -rf / drop / git push -f / 删 commit / 改 git history
4. 资源分配: 销毁 stash / 删 cron / 换 sub-agent / 销毁 archive

**1 弹窗 = 1 问题** (不用 steps 合并多问题). 1 弹窗 ≤ 4 选项, 必标"推荐" + 理由 < 30 字

---

## 你交付时必报的内容

每个 task 完成后, 输出 **1 段 ≤ 200 字 summary** + **5 件套 evidence**:

1. **commit hash** (`git log -1 --format=%H`)
2. **verdict** (PASS/PARTIAL/FAIL + 1 行理由)
3. **5/5 验收信号** (对应 plan.md task 表的"验收信号"列, 每条 1 行)
4. **3 件齐 checklist**: ✅ git commit / ✅ outputs/<task>/deliverable.md / ✅ board.md append
5. **截图** (≥ 3 张关键步骤, 路径列出)

**反模式** (历史踩坑):
- ❌ sub-agent self-declare PASS ≠ 实际 PASS (钉子 #23)
- ❌ Python exit 0 ≠ 文件已生成 (verify 6 件套)
- ❌ 报告"已完成"但 working tree 还没 commit (钉子 #14)
- ❌ "看代码 review" 代替 "实际操作" (rules.md §1.3)

---

## 你必须 30 min 内做的 5 件事 (硬)

1. **跑 30s 三件套** (`pwd` + `ls` + `git rev-parse`) → 确认 main HEAD = `adddd80f`
2. **精读 4 文档 v6.2** (`goal.md` + `plan.md` + `rules.md` + `sprint1.5/board.md`)
3. **跑 1 次 `pnpm -w test`** → 确认 181+ tests pass, 0 fail
4. **跑 1 次 `cd apps/copilot-desktop && pnpm build`** → 确认 vite build 成功
5. **弹 1 弹窗给 NJX 拍板** (Sprint 1.5 Wave 3/4 决定: 🅰 / 🅱 / 🅲)

**完成 5 件事** → 你的 MiniMax code 接管正式启动, 然后按 plan 推进。

---

## 30 min 后弹窗模板 (直接复制改)

弹窗给 NJX:

```
Q: Sprint 1.5 Wave 3 (T-1.5.3 vitest 200+) 和 Wave 4 (钉子 #38 PM SOP) 是否在 W4 Gate 7/19 前完成？
○ 🅰 先做 Wave 3 (vitest 补齐, ≤60min, 5 packages 并行) — 推荐 ⭐
○ 🅱 先做 Wave 4 (钉子 #38 PM SOP + 复盘会准备, ≤30min, PM 自主) — 推荐 ⭐
○ 🅰🅱 组合 (Wave 4 先做, Wave 3 接着做, 7/19 复盘会 ready) — PM 推荐
○ 🅲 跳过 S1.5 剩余, 直接准备 Phase 2 kickoff 3 选项 — 需 NJX 拍
○ 暂不决定, MiniMax code 继续跑 build 验证 + 摸架构

(推荐理由: 🅰🅱 组合确保 7/19 复盘会有完整 4 文档 + 钉子库 + retrospective, 不延期 12 周路线图)
```

---

## 关键路径 (从你角度, 7/13-7/19)

```
7/13 21:46 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7/19 复盘会
   │
   ├─ 7/14 上午: 5 件事必跑完 (30s + 4 文档 + test + build + 弹窗)
   ├─ 7/14-7/16: Sprint 1.5 Wave 3+4 跑 (NJX 拍板后)
   ├─ 7/16-7/17: 5 packages vitest 补齐 200+ (PM 自主)
   ├─ 7/17 23:59: 钉子 #38 SOP finalize + retrospective 6 章节
   ├─ 7/18: 复盘会前 1h PM 准备 (NJX 不参与)
   └─ 7/19 20:00-21:00: W4 Gate 复盘会 1h (NJX 必参与)
```

**复盘会拍板 3 件事**:
- Sprint 1.5 全员 accept (签字)
- 钉子 #38 + 钉子 #39 4 候选 是否正式固化
- Phase 2 kickoff 🅰/🅱/🅲 选 1 (per plan.md §3.1)

---

## 边界外 (不要做)

❌ **不抢 Codex lane** (r18-r22, NJX 独立调度)
❌ **不开新 sub-agent 跟 codex 抢** (走 NJX 拍)
❌ **不动 git stash** (`dirty-2026-07-13-pre-handover` 保留 30 天, 走 NJX 拍板)
❌ **不擅自 push / merge 到 main** (PM 验收后 PM 拍)
❌ **不删 v5/sprint1.x archive** (保留 trace)
❌ **不动 `goal.md` / `plan.md` / `rules.md` v6.2** (走 NJX 拍板)
❌ **不删 cron** (active 5 个持续, disabled 的清理走 NJX 拍)
❌ **不发 IM 通知 NJX** (用 mavis communication send 或 ask_user 弹窗)

---

## 风险红线 (NJX 必弹窗, 你不可越界)

| 风险 | 必弹窗内容 |
|---|---|
| 同一 task 验收 3 轮 fail | 弹 3 选项: pause / 重做 / 改 plan |
| 阻塞超 24h | 弹原因 + 建议 |
| 跨 task 共享文件冲突 | 弹方案 A (PM 协调) / B (改 worktree) / C (砍) |
| 性能 baseline 不达标 | 弹 trade-off (startup / memory / FPS) |
| 6 路并行 worker 失败 | 弹 steer (续跑 / 换 worker / 缩到 4 路) |
| 跨 Sprint 计划 (进 S1.6 / Phase 2) | 弹 NJX 拍板 |

---

## 一行总结

> **30 min 内跑 5 件事（30s + 4 文档 + test + build + 弹窗）→ 弹窗拍 Sprint 1.5 Wave 3/4 → 跑 Wave 3+4 → 7/17 finalize 复盘会材料 → 7/19 复盘会 1h NJX 拍板 → 后续 Phase 2 sprint 启动协议。基线 = main HEAD `adddd80f`, 不动 Codex lane, 6 维质量门必过, 3 件齐 done。**

---

*Mavis PM 起草 · 2026-07-13 21:46 CST · 给 MiniMax code 的下一棒开箱提示词*
*NJX 复制全文 → 粘贴到 MiniMax code session 开头即可*

