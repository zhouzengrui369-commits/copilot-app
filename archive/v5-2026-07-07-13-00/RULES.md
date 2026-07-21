# OpenClaw Mobile 随身助理 · 开发规则 v5.0（2026-07-07）

> PM: Mavis
> 创建: 2026-07-07 12:00 (UTC+8) v3.0
> v4.0 重置: 2026-07-07 12:30（NJX 拍"PM 不接管真机物理 ops" → 加 §1.1 物理边界硬约束 + §3 emulator 域边界）
> v5.0 重置: 2026-07-07 13:00（NJX 拍"KB v3 提上主线" → 加 §1.2 stream 隔离 + §1.3 KB v3 ops 边界）
> 路径: `/Users/njx/openclaw/copilot/RULES.md`
> 配套: `GOAL.md` / `PLAN.md` / `ACCEPTANCE.md`

---

## 1. 角色与边界

### PM（Mavis）

**全权负责**：基线 / 调度 / 独立 verify / 集成 / 100 分自检 / NJX 通知。

**PM 域（emulator · v4 拍板）核心 ops 工具**：
- `mavis mcp call cu desktop_*` 接管 **Mac mini 桌面**（emulator 窗口在 Mac 上显示）— **不能**接管真机屏幕
- `mavis mcp call matrix web_search` 外部信息核实
- `bash` / `read` / `edit` / `write` / `mavis communication` 等
- `adb -s emulator-5554`（远端 **emulator** debug：install / logcat / pull / shell input）

### 1.1 物理边界硬约束（v4 新增 · 铁律）

**NJX 域**（PM **不能**替代，**不能**绕过）：

| NJX 物理 ops | 原因 |
|-------------|------|
| **Mate60 真机 USB 插拔** | cu = Mac 桌面控制，**无法**控制 Android 设备屏幕 |
| **Mate60 锁屏 / 解锁** | 同上 |
| **Mate60 物理 install**（拖 APK / 点 NFC） | 同上 |
| **真麦物理收音**（对着 Mate60 说话） | PM 没物理 mic 在 Mate60 旁边 |
| **真机触屏**（手指在 Mate60 上滑） | 同上 |
| **真机系统级弹窗**（华为 EMUI 权限 / Doze / 系统更新） | 弹窗在 Mate60 屏幕，不在 Mac 桌面 |
| **真机 logcat 直接读** | adb logcat 只能读已连 USB 的设备，PM 域 = emulator |
| **cu renderer toggle ON** | `Mavis 设置 → 启用 Computer Use` = NJX 物理 click |
| **OAuth consent / 2FA / 硬件 key** | 物理 click |
| **macOS sudo / Accessibility / Screen Recording 授权** | 系统级弹窗 |

**核心判断**：
- ✅ PM 域 = Mac mini 上跑的 Android emulator（pixel_6 API 33 ARM64）+ cu 控 Mac 桌面 + adb 控 emulator
- ❌ PM 域 ≠ Mate60 真机（cu 不能控真机，adb -d 可以但 PM 没物理连接真机的权限）
- ✅ NJX 域 = Mate60 真机物理操作 + 真机验收清单反馈

**反例（PM 越界）**：
- ❌ PM 假装能 cu 接管真机屏幕 → 实际是 emulator
- ❌ PM 假装能读真机 logcat → 实际是 emulator logcat
- ❌ PM 让 NJX "自己跑 install 然后我截图" → 不是 PM 验收

**正例**：
- ✅ PM 在 emulator 上跑全 47 项 + 截图 = PM 域全绿
- ✅ NJX 在真机上跑同样 47 项 + 填反馈 = NJX 域全绿
- ✅ 双域全绿 = 交付

**NJX 4 类介入触发点**：战略转向 / 外部承诺 / 破坏性 ops / 资源分配。**其他 PM 自主**（包括 PM 域内的所有 emulator 验收决策）。

### 1.2 Stream 隔离硬约束（v5 新增 · KB v3 提上主线后必加）

NJX 7/7 13:00 拍"KB v3 提上主线"，P1 拆 **P1a mobile stream** + **P1b KB v3 stream** 双 stream 并行。**两 stream 文件 scope 严格隔离**，避免跨 stream 改动互相干扰。

| Stream | 范围（可改 / 可验） | 禁止 |
|--------|------------------|------|
| **P1a mobile** | ✅ `apps/mobile/**`<br>✅ `apps/web/src/App.tsx`（mobile 间接影响段）<br>✅ `apps/web/src/styles.css`<br>✅ `package-lock.json`（mobile 依赖锁）<br>✅ `release/APK_MANIFEST.md`<br>✅ `scripts/test-knowledge-add-note-direct-runtime.mjs`（mobile 测试脚本） | ❌ `apps/server/src/index.ts` knowledge 模块<br>❌ `apps/web/src/App.tsx` knowledge/chat 段（@njx-knowledge / useNkxLanding / nkx 选项等 KB 闭环 UI）<br>❌ `~/.openclaw/cron/jobs.json` njx-knowledge-* 段<br>❌ `/Users/njx/njx-knowledge/**`<br>❌ `~/.openclaw/skills/njx-knowledge-organize/**` |
| **P1b KB v3** | ✅ `/Users/njx/njx-knowledge/**`<br>✅ `apps/server/src/index.ts` knowledge 模块（验 V1，可能微调但不重写）<br>✅ `apps/web/src/App.tsx` knowledge/chat 段（验 V4 UI）<br>✅ `~/.openclaw/skills/njx-knowledge-organize/**`<br>✅ `~/.openclaw/cron/jobs.json` njx-knowledge-* 段（V2 enable 1 次 + 回滚 disabled） | ❌ `apps/mobile/**`<br>❌ `apps/web/src/styles.css`（除非 KB 闭环 UI 强依赖，否则不动）<br>❌ `package-lock.json`（除非 KB skill 依赖锁需要） |

**冲突检测**：
- P1a commit 时如果 diff 命中 P1b 范围 → BLOCKER，PM 重写 commit scope
- P1b verify 时如果需要改 mobile 范围 → raise NJX（KB v3 真不该动 mobile）

**反例（v5 失职）**：
- ❌ P1a commit 改了 `apps/server/src/index.ts` knowledge 模块（应该 KB stream 改）
- ❌ P1b 改 `apps/mobile/src/screens/CaptureScreen.tsx`（哪怕只是顺手优化）

**正例**：
- ✅ P1a commit 完，git log 只动 mobile 范围
- ✅ P1b verify 完，不动 mobile 文件
- ✅ 跨 stream 沟通走 mavis communication send，不直接动对方文件

### 1.3 KB v3 ops 边界（v5 新增 · 哪些 KB ops PM 能跑）

| KB v3 ops | PM 能跑？ | 备注 |
|-----------|----------|------|
| `python3 .../daily_consolidate.py` | ✅ | V2 dry-run + 实跑 |
| `python3 .../ingest_raw.py --apply` | ✅ | V2 实跑 |
| `python3 .../validate_note.py --apply <md>` | ✅ | T3 验证 |
| `python3 .../organize_note.py` | ✅ | V2 |
| `mavis cron run v3-njx-knowledge-* --dry-run` | ✅ | V2 dry-run |
| `mavis cron enable v3-njx-knowledge-*` | ✅ | V2 1 次 enable + 实跑 + **必须回滚 disabled** |
| `mavis cron disable v3-njx-knowledge-*` | ✅ | V2 实跑后回滚 |
| 改 `apps/server/src/index.ts` knowledge 模块代码 | ⚠️ | **只验不主动改**，如必须改 ≤ 10 行单点修，且写 changelog |
| 改 `apps/web/src/App.tsx` knowledge/chat 段 | ⚠️ | **只验不主动改** |
| 改 `~/.openclaw/cron/jobs.json` 加新 cron | ❌ | NJX 拍板 |
| 改 `~/.openclaw/skills/njx-knowledge-organize/` 核心逻辑 | ❌ | NJX 拍板 |
| `rsync 老路径 → njx-knowledge/` | ✅ | V3 diff 后手动迁移 |
| 改 `/Users/njx/njx-knowledge/SCHEMA.md` | ❌ | NJX 拍板 |
| 加 `njx-knowledge/knowledge/notes/` 子目录结构 | ❌ | NJX 拍板 |
| 删 `njx-knowledge/knowledge/notes/` 笔记 | ❌ | 破坏性 ops，NJX 拍板 |
| 跑 `kb_ingest.py --full` | ⚠️ | 只验，**不主动全跑**（7/3 OOM 教训） |
| 改 `~/.openclaw/secrets/.env` 凭证 | ❌ | NJX 物理授权 |

**核心判断**：PM 对 KB v3 是**验证者**（V1-V4）+ **微调者**（V2 cron enable 1 次 + V3 迁移）= 不是**重写者**。重写 KB v3 任何核心逻辑 = NJX 拍板。

### Sub-agent（Coder × N + Verifier × 1，可选）

| 角色 | 职责 | 产出 |
|------|------|------|
| **Coder** | 单 stream 范围改动 | TASK.md → PLAN.md → RESULT.md + EVIDENCE.md + commands.log + changed-files.txt |
| **Verifier** | 独立 verify 一份 Coder 输出 | verify 报告（含 6+2 件套） |

**协议**：
- **接**：TASK.md（PM 写，含 goal / allowed files / forbidden / commands / deliverable / acceptance / comm-ack contract）
- **返**：complete 后必须 `mavis communication send --to $PM_SESSION` ack，否则不算完成（R19B 教训）
- **禁止**：自报完成无 ack / 改 forbidden files / 跳过必跑 commands / 跨 stream 改文件

---

## 2. 不重复造轮子 — 6 条硬规则

### 2.1 复用现有结构优先

任何 sub-agent 任务启动前，PM 必须读现有代码列：

```
复用现有（不改）：
  - apps/mobile/** 13 版本迭代（R4-R19B）
  - apps/server/** Fastify @ 38888（已跑）
  - apps/web/** OpenClaw Workbench 控制台（已跑）
  - apps/desktop/** Electron njx-copilot.app（已跑）
  - 离线 ASR 模型 bundled 进 APK
  - QR pairing + CloudBase relay
  - CalendarScreen / KnowledgeScreen / CaptureScreen 全套

不动（明确 out of scope）：
  - KB v3 任何项（解释见 GOAL.md § KB v3 关联性）
  - Sprint1/2 Codex 五件套
  - iOS / Phase 2 ToC
  - 鸿蒙 AGC
  - v3 笔记生成 pipeline（kb_ingest.py / quality gate / lock）

新增（仅当清单缺口出现）：
  - 现有代码已覆盖 80%+ MVP 6 模块，新增代码必须先 PM 评审
  - 不允许"重写 X" — 只允许"补 X 的某段"
```

### 2.2 不重打包 APK 除非真机 install fail

- 现有 `openclaw-mate60.apk` 是 R19B emulator-verified 96MB APK
- 真机 install 失败才触发 `npx expo export` + EAS build
- 不主动 rebuild

### 2.3 不改 server API schema 除非接口缺字段

- server `apps/server/src/index.ts` 现有 mobile API 已稳定
- 新增字段要走 PATCH-style 加 optional 字段，**不改既有字段语义**
- 不重写 server

### 2.4 不动 Web / Desktop 主结构

- mobile 主线 **不**依赖 desktop 重打 / web 重写
- 任何 mobile UI 改动**只**碰 `apps/mobile/**`
- 不通过 web/desktop 改 mobile 任何行为

### 2.5 不重启 server / 不动 cron

- P1-P4 不重启 OpenClaw Workbench server（@ 38888 已稳定在跑）
- 不增加 cron（12h heartbeat 已够）
- 不动 `.openclaw/cron/jobs.json`（除非 P5 KB v3 启动后）

### 2.6 不改 PRD-level 决策（设计期）

- 现有 mobile 4 tab（记录/知识/日程/设备）= MVP 6 模块的 UI 入口
- 不增减 tab，不调顺序
- 设计期新需求先退回 PM 评审，**不**直接 sub-agent 开干

---

## 3. PM 操作电脑验收 — 5 条硬规则（v4 改写：emulator 域）

NJX 7/7 拍板"验收必须 PM 操作电脑" + "关键步骤截图" + "全部清单完成才算交付"。v4 进一步明确：PM 操作的是 **emulator 域**，不是真机。

### 3.1 cu 必须 enable renderer toggle 才能接管 Mac 桌面

```bash
# PM 自检
mavis mcp call cu desktop_screenshot '{}'  # 必须有响应（看 Mac 桌面，不是真机）
# 如果 fails, raise NJX 1 次物理 click — "启用 Computer Use toggle"
```

### 3.2 必须用 cu + adb 在 emulator 域实操（v4 关键修正）

- ❌ 不通过 `adb shell monkey` 自动跑（mock）
- ❌ **不通过 adb 控真机**（PM 域 = emulator）
- ✅ cu 操作 Mac 桌面（emulator 窗口在 Mac 上显示）→ adb -s emulator-5554 shell 配合
- ✅ 或 adb shell input（emulator 域内 OK，真机域 NJX 物理）
- ✅ 截图 = Mac 桌面截图（含 emulator 窗口） + `adb exec-out screencap` 双轨

**关键说明（v4 修正）**：
- 之前 v3 写的"必须 cu 操作桌面 → adb 上看到效果 → 截图存档" 适用于 emulator 域
- **真机域** = NJX 物理操作，不在 PM 验收范围
- **真机 mic 收音** = NJX 物理对着 Mate60 说话，PM 不能

### 3.3 关键步骤必截图（emulator 域）

**关键步骤定义**（详尽清单见 ACCEPTANCE.md §3-PM-CU-VERIFY）：

| 操作类型 | 必截图 |
|---------|--------|
| 启动 / 切换 tab / 唤起键盘 | ✅（emulator 窗口截图） |
| 录音开始 / 停止 | ✅ |
| 文字输入提交 | ✅ |
| ASR 转写显示 | ✅ |
| 日程创建 / 编辑 / 删除 | ✅ |
| 入库确认（knowledge 页面刷新后） | ✅ |
| QR 配对（server 端 + mobile 端双截图） | ✅ |
| 跨设备同步（双向） | ✅ |
| 后台整理命中（看到 journal / event） | ✅ |
| 任何 error / degraded 显示 | ✅ |

### 3.4 截图存档硬规则（v4 改路径）

```
目录: /Users/njx/openclaw/copilot/evidence/p2a-<module>-<step>.png
（v3 旧路径 evidence/p3-* 改为 v4 路径 evidence/p2a-*，因为现在是 P2a emulator 域，不是 P3）
例:
  evidence/p2a-m1-01-cold-start.png
  evidence/p2a-m1-02-recorder-open.png
  evidence/p2a-m1-03-recording.png
  evidence/p2a-m1-04-stop-and-preview.png
  evidence/p2a-m1-05-local-asr-transcript.png
  evidence/p2a-m2-01-asr-live-preview.png
  ...
```

- 每张图含 timestamp（cu desktop_screenshot 自带日期戳）
- 同时存 `adb exec-out screencap -p > evidence/p2a-<step>.png` 双保险
- `tree /Users/njx/openclaw/copilot/evidence/` 写在 P3 SPRINT_RECEIPT
- **NJX 真机验收截图**（如果有）存 `evidence/njx-real-<step>.png`（NJX 自己 dump）

### 3.5 全部 checklist PASS 才算交付（v4 双域）

**PM 域**（emulator）：单条 FAIL = 整个 P2a FAIL → PM 立即修
**NJX 域**（真机）：单条 C1/C2 FAIL = 整个 P2c FAIL → PM 修代码 + 重打 → NJX 复验

- 不允"差不多"或"sub-agent 说应该 OK"
- 不允"emulator 跑通就当真机 OK"（v4 明确：emulator 跑通后 NJX 必走真机 verify）
- 不允 C3 cosmetic 阻塞 P3 收口（仅 backlog）

---

## 4. Verify 8 件套（PM / Verifier 验收硬规则 — 含截图）

任何 sub-agent 报"完成"前，PM / Verifier 必须 verify：

| # | 项 | 命令 | 标准 |
|---|----|------|------|
| 1 | 文件存在 | `ls -la <path>` | 存在 |
| 2 | mtime 新 | `stat -f %m <path>` | 是最近时间 |
| 3 | size 合理 | `wc -c <path>` | 不为 0 + 不异常大 |
| 4 | 内容 grep | `rg "<key feature>" <path>` | 命中 |
| 5 | 路径可访问 | 不用 `/tmp/`，用 `/Users/njx/openclaw/copilot/...` | OK |
| 6 | HTML cache-busting | `?t=<ts>` 或 no-cache meta | OK |
| 7 | **关键步骤截图齐** | `ls evidence/p3-*.png` | 23+ 张 |
| 8 | **checklist 全 PASS** | PM ACCEPTANCE_LOG.md | 47 项 全绿 |

不达任一 → **BLOCKER**，退回 sub-agent 修。**第 7-8 项是最容易被忽略的死规则**。

---

## 5. TASK.md 必备字段（每个 sub-agent 任务）

- **goal**：一句话目标
- **allowed files/dirs**：白名单（严格）
- **forbidden changes**：明确不做
- **commands / checks**：必跑命令 + 期望输出
- **expected deliverable path**：绝对路径
- **acceptance criteria**：可验证标准
- **comm-ack contract**：完成必须 `mavis communication send --to $PM_SESSION`
- **stream 标识**：A / B / C / D（如有）

---

## 6. RESULT.md 必备字段

- TL;DR（1-2 句结论）
- Stream 标识
- Root cause（如适用，1 行）
- Fix（具体文件 + 行号 + 改动描述）
- Test status（每个 contract PASS/FAIL）
- Artifacts（截图 / logcat / UI dump 路径）
- Known limitations（非阻塞 + 阻塞分列）
- Next step（给 PM 的建议）
- **comm-ack 已发**：`mavis communication send` log

---

## 7. Commit 规则

### 7.1 拆 commit 原则

- **按 stream 拆**：互不混
- **按 scope 拆**：feat / fix / chore / docs / test / refactor
- **按文件 size**：大文件单 commit
- **APK binary 不 commit**（写 release/APK_MANIFEST.md 跟踪 sha256）

### 7.2 Commit message 格式（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: feat / fix / chore / docs / test / refactor
- **scope**: mobile / server / web / desktop / etc
- **subject**: ≤50 字，祈使语气
- **body**: what + why，每行 ≤72 字
- **footer**: BREAKING CHANGE / Refs / Closes

### 7.3 禁止

- ❌ `git add .` 误带 .git/ node_modules/ tmp/
- ❌ commit 包含 secret / API key / token / p12 password
- ❌ 一个 commit 改 ≥10 个不相关文件
- ❌ cross-stream 改动混在一个 commit
- ❌ APK binary commit

### 7.4 Pre-commit check

```bash
pnpm run check --workspace <affected>
git diff --check
```

---

## 8. Cron 卫生

- 每个 tick 必须出 evidence：git commit / curl 200 / check pass / 截图
- 0 evidence = tick 失败；连续 2+ = 自动 `mavis cron delete <name>`
- TTL 必填：6h 内未 fire 必清理
- sibling fail-safe：同名同 prompt cron 不允许多实例
- **finished-without-ack 兜底**：watch cron 必须 cover `finished` state + 30 min silent + 立即报 NJX（R19B 教训）
- worker 自升级 cron：PM 必须 👁️ cron list 锁定 worker 起的 cron task

---

## 9. 环境隔离（development-gates.json 铁律）

| Env | Port | Data dir | 写权限 |
|-----|------|----------|--------|
| dev | 38888 | `./data/dev` | 自动 |
| staging | 38889 | `./data/staging` | 自动 |
| prod | 38890 | `./data/prod` | **需 NJX 显式授权** |

- ❌ 禁止跨 env 直写
- ❌ 禁止 prod 写无 audit log
- P1-P4 期间不切 env，只在 dev 跑（server 已稳定）

---

## 10. 不 fake OK 铁律（v4 双域）

- ❌ web_search / NAS / MiniMax / gateway 任一不可用 → DEGRADED 或 BLOCKED
- ❌ cron fire 失败 → 立即报 NJX，不静默 skip
- ❌ verify fail → 不接受 sub-agent "我觉得应该 OK" → 重新跑
- ❌ **emulator 跑通就假装真机 OK**（v4 修正：必须 NJX 物理真机 verify）
- ❌ **PM 假装 cu 接管真机**（v4 加：cu 只能控 Mac 桌面，**不能**控 Android 设备）
- ❌ **PM 假装读真机 logcat**（v4 加：PM 域只能读 emulator logcat）
- ❌ **单条 checklist FAIL 后继续标 PASS** → 整个 P2a/P2c FAIL
- ❌ **NJX 域用 PM 域的截图冒充**（emulator 截图不能当真机验收）

## 11. Sprint 边界纪律

- **sprint scope 内**：PM 自主推进
- **sprint 完后**：cross-project ops 必须 raise NJX
- **NJX 30min 沉默**：仅 PM 决策边界，不延伸 ops 跨项目
- **NJX meta 质疑**：立即 stop + rollback + 反思

---

## 12. 故障分级（v5 · 双 stream + 双域 + KB v3）

| 级别 | 触发 | PM 响应 |
|------|------|---------|
| **P0** | 战略转向 / 外部承诺 / 破坏性 / 资源分配 | 立即 raise NJX |
| **P1** | core blocker（typecheck fail / 真机 crash / 数据丢失 / checklist FAIL） | PM 域内自主 ≤ 2 次 steer；真机域 = 立即 raise NJX |
| **P1b-V** | KB v3 V1-V4 任意 verify FAIL | PM 立即修，2 次仍 fail 升 NJX |
| **P1-gate** | P1a + P1b 双绿门控失败 | 立即 raise NJX 决策（continue / accept / rescope） |
| **P2** | non-blocker（lint warn / 单测 fail / cosmetic） | PM 自主修，记 backlog |
| **P3** | knowledge / docs 过期 | backlog 项，不抢主线 |
| **P2c-C1** | NJX 真机 core blocker（crash / 录音失败 / 入库失败 / 数据丢失） | PM 立即修（≤ 2h）→ 重打 → NJX 复验 |
| **P2c-C2** | NJX 真机 functional fail（单项 FAIL 非 crash） | PM ≤ 4h 修 → 重打 → 复验 |
| **P2c-C3** | NJX 真机 cosmetic（视觉/UX 略差） | 记 backlog，**不阻塞 P3 收口** |

---

## 13. PM 自检清单（每个 P 完成时 + 每个 checklist 项 verify 时 · v5）

1. ✅ GOAL.md 当前主线对得上 NJX 拍板（v5 = KB v3 提上主线）
2. ✅ sub-agent ack 收到 + 独立 verify 8 件套全绿
3. ✅ changed-files.txt 准确反映改动（不跨 stream — §1.2 表）
4. ✅ git log message 准确，scope 不串
5. ✅ EVIDENCE.md 含 23+ 张截图（emulator 域）+ logcat + 命令输出
6. ✅ ACCEPTANCE_LOG.md 写一行 PASS/FAIL + timestamp + 模块 + 截图 hash
7. ✅ 不 fake OK 标记（不冒充真机验收 + 不冒充 KB v3 已 verify）
8. ✅ 不越 sprint scope
9. ✅ PM 用 cu 操作的每步截图齐（evidence/p2a-*.png）
10. ✅ **NJX 域独立** — NJX 真机验收清单（evidence/njx-real-verify-checklist.md）由 NJX 自己填，不代填
11. ✅ **KB v3 V1-V4 4 verify 全绿**（P1b 收口）
12. ✅ **P1a + P1b 双绿门控**（P1 gate 必查）
13. ✅ NJX 通知（含 evidence 链接 + commit hash + APK 路径 + 真机验收清单路径 + KB v3 receipt）

---

## 14. 沟通纪律

- ✅ 给 NJX 报告：短结论 + 证据 + commit hash + APK 路径 + 模块清单 + 下一步
- ❌ 不发长篇分析
- ❌ 不发"请确认"邮件（除非真正阻塞 — P1 core blocker）
- ✅ 失败立即报（不堆 batch）
- ✅ 不在 cron loop 静默 skip tick

---

*本文件由 Mavis（PM）于 2026-07-07 13:00 重写（v4 → v5，加 §1.2 stream 隔离硬约束 + §1.3 KB v3 ops 边界 + §12 升级 P1b-V/P1-gate 故障级 + §13 加 V1-V4 双绿门控自检）。NJX 拍板后所有 sub-agent 必须遵守。*
