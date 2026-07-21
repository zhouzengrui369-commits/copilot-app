# Copilot App · 项目规则 v6.2（2026-07-09 立项基线 · 7*24h AI 修订 + PM 反思硬规则）

> PM: Mavis
> 创建: 2026-07-09 11:52 (UTC+8) v6.0
> 更新: 2026-07-09 11:53 v6.1（NJX 7/9 11:47 修订：7*24h AI + 质量第一）
> 更新: 2026-07-09 12:22 v6.2（NJX 12:21 拍板：sprint 2 越界退役 → 加 §6 PM 5 条硬伤修复 + 永不信任 worker 自报硬规则）
> 配套: `goal.md` v6.2 / `plan.md` v6.2 / `delivery.md` v6.2
> 路径: `/Users/njx/openclaw/copilot/rules.md`
> 适用: 所有 sub-agent + PM 自约束

> **质量底线**：违反任何一条 = 不通过验收。质量第一（NJX 7/9 11:47）≠ 妥协。

---

## 2026-07-16 Owner Amendment · MiniMax-first / Tencent post-MVP 强制规则（最高优先级，v6.2 保持不变）

> **规则优先级**：本节是当前 Phase 1 MVP 的最高优先级规则；保留 2026-07-15 macOS-first 规则及全部历史原文。下文旧腾讯云必部署、Remote/live 必验收、云 ASR 兜底或云备份阻塞条款与本节冲突时，按本节执行。

- **模型不是数据层**：当前 MVP 可使用现有/可配置 MiniMax 能力，但 MiniMax 只允许无状态推理；不得把模型输出、provider 会话或远程缓存当作笔记、KB、KG、RAG、日程或设置真值。可持久、可追溯的应用状态必须落在本机受控数据层。
- **严格 local-first**：本地笔记/KB/KG/RAG sources/日程是唯一真值。模型不可用、超时或拒答时必须保留本地数据与可操作性，不得静默改走腾讯云持久化或远程管理路径。
- **模型配置可扩展**：MiniMax 是当前 MVP 的可用默认能力，不得硬编码成唯一永久 provider；密钥不得进入仓库、日志、截图、manifest 或交付包。默认验收不得依赖腾讯云配置存在。
- **ASR 必须本地内嵌且绑定 final candidate**：不得使用腾讯模型或云 ASR 作为实现或兜底。语音录入只有在同一已打包、Developer ID 有效签名、Apple 公证成功并 staple/validate 通过的 macOS Electron final candidate 上，完成以下证据链才可 PASS：macOS 真机关闭网络且无任何云 fallback；Electron runtime 从该 candidate 包内加载随包内嵌、SHA256 与许可/再分发清单绑定的本地模型并执行真实 decode；真实转写写入本地 note，App 重启后可 readback，且 KG/知识关联可见；同时提供资源占用和失败提示证据。standalone helper/sidecar、OS WebSpeech/系统语音服务、开发浏览器、未打包 harness、其他 candidate、source/test/mock 均不得替代。Windows 等价证据继续 `OWNER-DEFERRED → Phase 1.1`。
- **腾讯云统一 owner-deferred**：保留已有 source/test/docs 历史证据；deployment、Remote/live、COS 可选备份、TLS/WSS、生产 issuer authority 与生产权限验收统一 `OWNER-DEFERRED → post-MVP`，当前不阻塞 MVP。`source PASS` 不等于 `deployment/live PASS`，完成前禁止任何腾讯云已交付声明。
- **发布和质量门不降级**：macOS final candidate 仍必须 Developer ID 签名、公证、可安装包/SHA256、真机截图；规定覆盖率、集成测试、至少 50 条真实 Electron E2E、candidate-bound 性能、3 轮 verify-fix、文档/RESULT/EVIDENCE 和 owner gate 缺一不可。Windows 继续按 2026-07-15 修订标记 `OWNER-DEFERRED → Phase 1.1`。

---

## 2026-07-15 Owner Amendment · macOS-first MVP 验收规则（v6.2 保持不变）

> **规则优先级**：NJX 已明确授权当前 MVP 先完成 macOS、Windows 移至 MVP 后。为保留审计历史，下文旧“双端同步”规则不删除；其与本节冲突时，本节是当前 Phase 1 MVP 的强制规则。Phase 1.1 启动后，Windows 原生门另行恢复并独立验收。

- **当前 MVP 平台门**：只要求 macOS 真机，但必须真实安装和操作同一 final candidate；不得以浏览器、mock、静态截图或开发服务器替代 Electron 真机证据。
- **发布门**：final candidate 必须有 Developer ID 有效签名、Apple 公证成功、可安装的 macOS 包及 SHA256；签名、公证、安装任一缺失都不得宣称 MVP 完成。
- **质量门不降级**：规定覆盖率、集成测试 100% pass、至少 50 条真实 Electron E2E 100% pass、candidate-bound 性能基线、3 轮 macOS verify-fix、真机截图及文档/`delivery.md` RESULT/EVIDENCE 缺一不可。
- **候选绑定**：3 轮 verify-fix、性能、E2E、签名、公证、安装和截图必须可追溯到同一 final candidate；旧 r22 或其他旧候选证据只保留历史价值，不能替代当前 candidate-bound 证据。
- **Windows 状态**：`OWNER-DEFERRED` / post-MVP Phase 1.1。当前保留跨平台源码、平台抽象、静态兼容检查及后续验证计划；未完成 Windows 真机、签名、安装与截图前，禁止宣称 Windows 或双平台已交付。
- 本修订不授权降低任何功能、local-first、腾讯云边界、安全或证据要求，也不授权改写旧证据。

---

## 1. PM 工作守则（强制）

### 1.1 文档先行
- 4 个文档（goal/plan/rules/delivery）齐全 → 才能开工
- 任何 4 文档变化 → delivery.md 留 `## Changelog` 记录
- v5 4 文档归档保留 trace（`archive/v5-2026-07-07-13-00/`），W27 工作按需复用（NJX 拍）

### 1.2 多 Agent 并行循环（NJX 7/9 11:47 修订）
- **同 Sprint 同层 = 5-6 路并行**（AI 7*24h 撑得住，sub-agent 持续跑）
- sub-agent 在 git worktree 隔离工作（`git worktree add ../wt-<id>`）
- 合并前 PM 跑项目级 smoke test
- **单 task 3 轮验收不过 → 自动升级 owner**（禁止 PM 自我循环）
- **token 成本暂不考虑**（NJX 7/9 11:47）→ sub-agent 可用 LLM 多次（verify / 重试 / 深推理 / 多 verifier）

### 1.3 验收 = 真实操作 + 截图（NJX 7/9 11:47 强化）
- **禁止仅看代码判断"通过"**
- 必须用 cu MCP 工具**真机操作**（macOS + Windows 双端）：
  - `desktop_screenshot` → 截屏存档
  - `desktop_left_click` / `desktop_type` → 真实按钮点击
  - `desktop_window_list` → 确认应用已开启
  - `bash` → 真实命令运行
- **每个 task 至少 3 张关键截图**：
  - S1: 操作前的状态
  - S2: 操作中的关键节点
  - S3: 操作后的最终结果
- 截图路径：`project/copilot/screenshots/<task_id>/<seq>_<step>.png`

### 1.4 基线迭代需要 owner 确认
- PM 自己**不能擅自改** goal.md / plan.md / rules.md
- 发现需要改 → 写变更提案（diff）给 owner → owner 确认 → 再改
- 例外：拼写 / 占位符 / 路径错误 → 直接改 + delivery.md 留 update 痕迹

### 1.5 质量永远是最高要求（NJX 7/9 11:47 升级为红线）
- 功能实现 ≠ 完成，必须满足 delivery.md 全部验收项
- 不合格 → 打回重做，**写明原因 + 截图证据**
- 拒绝"差不多就行""先用着""明天再说"这种妥协
- 质量门（单测 ≥ 70% / 集成 / E2E / 截图 / 性能 baseline / verify-fix）缺一不可

---

## 2. Sub-agent 守则

### 2.1 必读必遵循
开工前必读：
- `goal.md` v6.1（整份）
- `plan.md` v6.1 涉及自己的那段
- `rules.md`（当前文件 · 整份）
- `delivery.md` v6.x 涉及自己的那段

**不读 = 不准开始写代码**。

### 2.2 工作约束
- 工作目录：自己分配的 worktree（`git worktree add ../wt-<id> <base-branch>`）
- 不得修改主分支 / 其他 sub-agent 任务目录
- 不使用共享 transient state（要用 → 写到自己的 worktree 文件）
- **独立 schema/API contract**（Sprint 1.1 末尾 freeze）

### 2.3 交付输出
- PR / commit message 引用 task_id（如 `T-1.1.1: Electron app 骨架 macOS`）
- 自行跑完 task 级验收（自测报告 + 单元测试 + 截图）
- 输出"自测报告"附在 PR / commit 描述里

### 2.4 失败处理
- **3 轮 PM 验收失败 → 自动升级 owner**（NJX 7/9 11:47 强化）
- 阻塞超过 24h → 升级 owner
- 不可逆操作（rm -rf / drop table / 删 commit）→ 必须先征得 PM 同意

### 2.5 自我验证（NJX 7/9 11:47 强化 · 7*24h AI capacity）
- sub-agent 提交前**必须自验**：
  - 单元测试通过
  - 关键路径截图 ≥ 2 张
  - 性能 baseline 数据（如适用）
  - 集成 / E2E 测试通过
- 自验报告含：**已跑命令 + 输出 + 截图路径 + 已知 limitations**

### 2.6 Done 硬条件（Mavis 7/9 14:30 补强 · 防止 silent contract failure）
- sub-agent 报"done"**前必须完成 3 件齐**（缺一 = 视为未完成）：
  1. **`git add && git commit`**：所有改动（含新增文件、tests、screenshots、deliverable.md、board entry）必须落 commit。**working tree 状态 ≠ done**。
  2. **`outputs/<task_id>/deliverable.md` 写入**：含 VERDICT 行（PASS/PARTIAL/FAIL）+ 已跑命令 + 截图清单 + 已知 limitations。**verifier 必读此文件**。
  3. **board.md append**：在 `outputs/<task_id>/` 或 plan-level `board.md` 加 in_progress → done 行。**board entry 是早期信号**（verifier / PM / owner 靠它盯进度）。
- 反例（T-1.1.2 教训）：worker β 写了 ~329 行 platform/ 代码 + tests + electron-builder.yml + package.json dist:win 脚本，**但 0 commit + 0 deliverable.md + 0 board entry** → 引擎与 PM 都不知道失败 → Sprint 1.1 集成收口才暴露。
- 补救：worker 自检脚本（可选）— `git status --porcelain` 应为空 + `outputs/<task_id>/deliverable.md` 存在 + `board.md` 含 done 行。

---

## 3. 验收规范（PM 用 · NJX 7/9 11:47 强化）

### 3.1 验收前必做

```bash
# 检查 sub-agent 自测报告
git log -p <branch>    # 看 diff
npm/yarn/pnpm test     # 跑测试
# 检查截图
ls screenshots/<task_id>/
# 跑性能 baseline（如适用）
npm run bench
```

### 3.2 验收中必做

```bash
# 真实运行（双端）
<the project's actual run command>  # macOS
<windows equivalent>                # Windows VM

# 真实点击（用 cu MCP · macOS 优先）
desktop_screenshot → 截屏
desktop_left_click → 点关键按钮
desktop_screenshot → 再截屏
```

### 3.3 验收后必做
- 在 delivery.md 把对应 task status 改为 `done` 或 `rejected:<原因>`
- 截图全部存档到 `screenshots/<task_id>/`
- 向 owner 简报（汇报进度报告）

### 3.4 质量门（每个 Sprint 必跑 · NJX 7/9 11:47 内嵌）

| 维度 | 标准 | 验证方式 |
|------|------|----------|
| **单元测试覆盖率** | ≥ 70%（关键模块 ≥ 90%） | `npm run test:coverage` |
| **集成测试** | 100% pass | `npm run test:integration` |
| **E2E 测试** | ≥ 50 case / 100% pass | `npm run test:e2e` (playwright / spectron) |
| **截图存档** | 每 task ≥ 3 张关键步骤 | `ls screenshots/<task_id>/` |
| **性能 baseline** | 启动 < 2s / 内存 < 500MB / KG 100 节点 FPS ≥ 30 | `npm run bench` |
| **verify-fix 循环** | 至少 1 轮（不通过 → fix → 再 verify） | delivery.md 记录 |

**任一质量门不过 → 该 Sprint 不通过验收**。

### 3.5 跨平台双验（macOS + Windows 同步）
- 每个 task **必须双端跑通**（macOS 本机 + Windows VM）
- Windows 验收用 cu MCP 远程桌面（njx 域） / Wine CI
- 跨平台 bug 单独建 issue 跟踪

---

## 4. 文档/工具红线（不可违反）

| ❌ 禁止 | ✅ 必须 |
|---|---|
| 跳过验收直接 merged | 验收前所有 sub-agent 改动停留在 worktree |
| 验收只看代码不看实际行为 | cu MCP 真机操作 + 双端截图 |
| PM 私自改基线文档 | 改基线 → 走 owner 确认 + delivery.md Changelog |
| 短时间迭代基线 > 2 次/天 | 警惕基线不稳，先收敛 |
| 任务没明确产出就开工 | task 没产出物 / 验收信号 → 不准开工 |
| 用 Codex/M3/Claude 直接推 PR 到 main | PR 必须先 PM 验收 + owner 点头 |
| 把 4 文档塞进代码注释 | 文档独立 .md，跟 code 分开维护 |
| 跳过质量门 | 6 个质量门全过才能验收（NJX 7/9 11:47 红线） |
| sub-agent 跳过自验 | 提交前必须自验（单测 / 截图 / 性能） |
| 双端只验一端 | macOS + Windows 都必须跑通 |

---

## 5. 并行规则（强制 · 6 路并行）

### 5.1 可以并行的任务
- 不同 module / 不同文件目录
- 没有共享临时状态
- 没有强依赖（plan.md 依赖图已分清）
- AI 7*24h 撑得住（NJX 7/9 11:47）

### 5.2 必须串行的任务
- 后任务依赖前任务的产出
- 修改同一文件 / 同一目录（即使 git merge 也算）
- 数据库 schema 变更（先代码 migration，后 data migration）
- 跨 task 的 API 端点（先定 contract，后实现）

### 5.3 并行产物合并
- PM 用 `git merge --no-ff` 合并 worktree
- 合并后跑项目级 smoke test（不是 sub-agent 单测）
- 合并冲突 → 不允许自动合并，必须由该 task sub-agent 处理
- 6 路并行时尤其注意 contract freeze（Sprint 1.1 末尾）

### 5.4 6 路并行 Sprint 协调（NJX 7/9 11:47 新增）
- 6 路 sub-agent（α / β / γ / δ / ε / ζ）分配到不同 task
- Sprint 1.1 末尾 **freeze 跨 task API contract**（包括 schema / IPC / 端口）
- 冲突域划分：每个 sub-agent 只写自己分配的目录
- 公共文件（如 package.json）由 PM 集中管理，sub-agent 提 PR 修改

---

## 6. 通讯/汇报（一问一弹窗 + 推荐标注）

### 6.1 sub-agent → PM
- 任务完成 → 输出"自测报告"（截图 + 关键日志 + 命令输出）
- 阻塞 → 立即报告，附已尝试方案
- ⚠️ 这是 sub-agent 跟 PM 交互 → 用纯文本即可

### 6.2 PM → owner（必须弹窗 + 推荐）

**铁律 1**：每个问题单独一个 `ask_user` 调用（不用 `steps` 合并多问题）。
**铁律 2**：每个选项标"推荐" + 简短具体理由。

**选项标签规范**：
- `<选项名>（推荐 - <理由>）` ← 标准格式
- 推荐理由要"具体可验证"：最快 / 最稳 / 最低成本 / 符合 OPC 模式 / 覆盖 95% 场景
- 选项文字总长 < 30 字（中文算字符）

**适用弹窗（每个独立弹窗）**：

| 场景 | 选项数量 | 推荐标注要求 |
|---|---|---|
| 头脑风暴每个问题 | 2-4 | 必须有 1 个"推荐" |
| 4 文档每完成一个 | 2-3 | 批准选项必须标"推荐" |
| 验收清单每个 item | 3（通过/不通过/跳过）| "通过"标"推荐"时附证据 |
| 验收失败的下一步 | 3-4 | "打回重写"标"推荐" |
| 基线变更 | 3-4 | 至少 1 个"推荐" |
| Phase 收尾 | 3 | "进入下一 Phase"标"推荐" |
| 死循环升级 | 3-4 | "暂停项目"或"换 sub-agent"标"推荐" |
| cron 清理确认 | 2 | "已清理"标"推荐" |

**不适用弹窗（直接纯文本）**：
- 进度报告（每任务完成时同步汇报）
- 状态通知（"任务 T-1.3 self_check 通过，待 PM 验收"）
- 单选项 yes/no
- 知识解释

### 6.3 owner → PM
- 弹窗里选选项 → PM 立即执行
- 不在弹窗里写长文本 — 长文本意见 → 弹窗后另起一个对话讨论
- 24h 不回弹窗 → PM 再发一次（最多 2 次），仍不回 → 暂停车

---

## 7. 工具白名单

### 7.1 PM 工具
- **截图**：cu MCP `desktop_screenshot` / `desktop_screenshot_region`
- **点击**：cu MCP `desktop_left_click` / `desktop_right_click` / `desktop_type`
- **应用管理**：cu MCP `desktop_window_list` / `desktop_window_focus`
- **命令行**：`bash` 工具（真实执行，不允许 dry-run 验收）
- **文件读取**：Read / Glob / Grep
- **文件改动**：Edit / Write / MultiEdit
- **Git**：bash 调用 git
- **sub-agent 调度**：mavis team engine / `mavis communication send`
- **cron 管理**：`mavis cron self` / `mavis cron list` / `mavis cron rm`
- **LLM 调用**：`llm-call` skill（多 verifier / 多 verify 循环 / 跨模型对比）

### 7.2 sub-agent 工具
- 同上（除 cu MCP 部分由 PM 执行真机验收）
- **可调用 mavis LLM 多次**（NJX 7/9 11:47 · token 不约束）

### 7.3 禁止
- 用 `webfetch` 替代真实访问
- 用「看代码 review」代替「实际操作」
- 跳过截图直接验收
- 跳过双端验证（macOS + Windows）

---

## 8. 持续跟踪规则（无人值守 · 7*24h AI 强化）

### 8.1 任务分级跟踪（NJX 7/9 11:47 修订）

| 任务时长 | 跟踪机制 | 工具 |
|---|---|---|
| < 30min | 当前会话同步等待 | session |
| 30min ~ 2h | **PM 轮询**（5-10min 检查状态文件） | session 循环 |
| ≥ 2h | **创建 cron 定时监控**（30min~1h 跑一次） | `mavis cron self` |
| 7*24h sub-agent 持续跑 | **心跳扫描 cron**（项目级兜底） | `mavis cron self` |

### 8.2 轮询实现（中任务）

```bash
# 在 session 内循环检查
while true; do
  state=$(cat .worktree/$TASK_ID/STATUS 2>/dev/null || echo "unknown")
  case "$state" in
    done)      break ;;
    blocked|failed)
              # 升级到 Step 4 弹窗
              break ;;
    working)  sleep 600 ;;  # 10 min
  esac
  # 超时 2h 还没动静 → 升级为长任务监控
done
```

### 8.3 cron 监控实现（长任务 · 7*24h AI capacity）

**单任务监控**（具体 task）：
```bash
mavis cron self copilot-<phase>-<task>-monitor \
  --every 30m \
  --prompt "<读取 project/copilot/delivery.md 最新状态。
           如有 sub-agent 失败 / 阻塞 / 超时 → 立即弹窗升级。
           如一切正常 → 静默退出。
           超 24h 同一状态 → 弹窗升级 owner>
           跨平台验证（macOS+Windows）任一未跑 → 弹窗升级"
```

**项目级心跳**（Phase 兜底）：
```bash
mavis cron self copilot-heartbeat \
  --every 12h \
  --prompt "<扫 project/copilot/4 文档状态：
           - 4 文档是否完整
           - delivery.md 死循环征兆（同 task 3 轮不过 / 24h 阻塞 / 迭代 > 2 次/天）
           - 当前 phase 进度
           - 质量门状态（单测/集成/E2E/截图/性能/verify-fix）
           触发任一死循环征兆 → 立即弹窗升级 owner
           否则静默退出>"
```

### 8.4 死循环判断（任一触发立即升级 · NJX 7/9 11:47 强化）
- 同一 task 验收失败 ≥ 3 轮
- 同一阻塞点 > 24h 无进展
- 同一基线变更 > 2 次/天
- sub-agent 持续输出无效重复内容（状态文件趋势判断）
- **质量门连续 2 个 Sprint 不过**（新增）

### 8.5 死循环升级弹窗（必须给止损选项）
```
Q: 项目 copilot 进入死循环征兆（<具体描述>），如何处理？
○ 暂停所有 sub-agent，owner 接管
○ 重做 plan（拆掉当前 phase）
○ 暂停当前 task，缩窄范围
○ 收摊（归档项目，关闭 cron）
```

### 8.6 Cron 清理
- **Phase 结束** → 立即清理对应的 cron（避免 cron 漂移）
- 清理命令：`mavis cron rm <name>`
- 必须在 delivery.md 的 Phase 验收段记录清理动作

### 8.7 Cron 不允许做的事
- ❌ 改 plan / rules / goal（只监测，不修改）
- ❌ 调用 sub-agent（如果需要 sub-agent 工作，由 PM 在 session 内做）
- ❌ 跳 PM 直接联系 owner 升级（先 upgrade PM session，再 PM 弹窗 owner）

### 8.8 项目级心跳 vs 单任务监控的关系
```
项目级心跳（12h）── 全程在 → 仅监测 → 死循环征兆升级
单任务监控（30m）── task 期间 → 仅监测 → 阻塞/失败立即升级
PM session 轮询   ── 中等任务期间 → 直接验收
7*24h sub-agent   ── AI 持续跑 → 不间断工作
```
四层各管一段，**没有冗余**。

---

## 9. 项目特定红线（NJX 7/9 11:31 + 11:40 强约束）

### 9.1 严格 local-first（决策 2 · NJX 7/9 11:40）
- ❌ **知识图谱不上云 compute**（本地 app 内存 + 持久化）
- ❌ **笔记 / KB / KG 同步云 = 默认关**（app 配置开关）
- ✅ 腾讯云 server = 轻量 LLM proxy + 远程管理 API（不承载图谱计算）
- ✅ 云备份 = 用户显式开启（明示知情）

### 9.2 双端对等（macOS + Windows 同步）
- ❌ 不能"先 macOS 后 Windows"
- ✅ 每个 Sprint 双端跑通才能验收
- ✅ Windows 验收用 cu MCP 远程桌面 / Wine CI / VM

### 9.3 LLM API 起步用 minimax m3
- ✅ config.yaml 配置 minimax m3 优先
- ✅ 后期可加 OpenAI / Claude / 自托管
- ❌ 不在代码里硬编码 API key（用 env / secret store）

### 9.4 数据隐私
- ❌ 笔记内容不上第三方 LLM（除非用户显式开启云端推理）
- ❌ embedding 缓存不上传（本地 SQLite）
- ✅ 错误日志脱敏（去除个人数据）

### 9.5 Mac mini 关系（决策 3）
- ✅ 腾讯云 = 唯一 server（生产 + 开发共用）
- ❌ Mac mini 不再跑 server（v5 期间 W27 server 逐步下线）
- ✅ Mac mini 角色弱化 = 降低 NJX 维护负担

---

## 10. 完成度自检

- [x] PM 守则清楚（5 条 + 质量第一红线）
- [x] Sub-agent 守则清楚（5 条 + 自我验证）
- [x] 验收规范有具体可执行步骤（双端 + 质量门 6 维度）
- [x] 文档/工具红线明确（10 条）
- [x] 并行规则覆盖 3 个分桶 + 6 路协调
- [x] 通讯 / 汇报路径明确（一问一弹窗 + 推荐标注）
- [x] 工具白名单明确（PM / sub-agent / 禁止清单）
- [x] 持续跟踪规则覆盖 3 类任务 + 7*24h AI + 死循环处理
- [x] 每个弹窗都标"推荐"+ 具体理由
- [x] 项目特定红线（local-first / 双端对等 / LLM / 数据隐私 / Mac mini）

**任一项缺 → 不能进入 delivery.md 起草**。当前全部通过。

---

*本文件由 Mavis（PM）起草：*
- *v6.0 · 2026-07-09 11:52（基于 skill 标准 rules-template + project-pm 标准 PM 守则）*
- *v6.1 · 2026-07-09 11:53（NJX 7/9 11:47 修订：7*24h AI + 质量第一 + 质量门 6 维度 + 项目特定红线 5 条）*

*NJX 拍板后启动 delivery.md 起草（delivery.md 是 plan + rules 派生，无需 NJX 单独拍板）。*
