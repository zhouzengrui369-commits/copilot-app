# OpenClaw Mobile 随身助理 · 项目计划 v5.0（2026-07-07）

> PM: Mavis
> 创建: 2026-07-07 12:00 (UTC+8) v3.0
> v4.0 重置: 2026-07-07 12:30（NJX 拍"PM 不接管真机 install/USB/物理 ops" — 双域分轨）
> v5.0 重置: 2026-07-07 13:00（NJX 拍"KB v3 必在 P2 之前 + 与 P1 并行；先验证 KB v3 全部通过再推 P2a"）
> 路径: `/Users/njx/openclaw/copilot/PLAN.md`
> 配套: `GOAL.md` / `RULES.md` / `ACCEPTANCE.md`

---

## 阶段总览（v5 · 双 stream 并行 · KB v3 上主线）

| Phase | 名称 | 工期 | 阻塞门控 | Stream | 域 | 状态 |
|-------|------|------|----------|--------|----|-----|
| **P0** | 基线 v5 对齐 | 0.5h | NJX 拍 GOAL/PLAN/RULES/ACCEPTANCE v5 | — | PM | 🟡 当前 |
| **P1a** | Mobile commit 收口 | 1h | 3 commit + typecheck 全绿 | mobile | PM | ⏳ |
| **P1b** | KB v3 V1-V4 验证 | 2-3h | V1+V2+V3+V4 全绿（**4 verify 必跑**） | kb-v3 | PM | ⏳ |
| **P1 gate** | P1a + P1b 双绿 | 0.1h | 任意一项 FAIL → 不进 P2a | — | PM | ⏳ |
| **P2a** | Emulator 端到端验证 | 4-6h | 47 项 checklist 全 PASS + 23+ 截图 | mobile | **PM** | ⏳ |
| **P2b** | 真机交付 | 0.5h | APK 落盘 + 真机验收清单写好 | mobile | PM | ⏳ |
| **P2c** | 真机反馈循环 | 0.5-2h/loop | NJX 真机 verify 反馈 → PM 修 → 复验 | mobile | **NJX + PM** | ⏳ |
| **P3** | Sprint 收口 + 通知 | 0.5h | 三域全绿（mobile emulator + mobile 真机 + KB v3）+ 通知 NJX | — | PM | ⏳ |
| **P4** | Phase 2 ToC 化（backlog） | 1-2 月 | iOS + 订阅 + 多设备同步 | — | PM | 📋 |

---

## 不重复造轮子 — 每个 P 锚定复用（v5 双 stream）

| Phase | 复用现有 | 不动现有 | 新增（最少） |
|-------|---------|----------|--------------|
| **P1a** | `apps/mobile/**` 现有改 | `apps/web/**` `apps/desktop/**` `apps/server/**`（不重启 server） | 0（只 commit） |
| **P1b** | `apps/server/src/index.ts` 已有 minimax-direct 直连 + `apps/web/src/App.tsx` 已有 @njx-knowledge / `~/.openclaw/skills/njx-knowledge-organize/` 已有 4 脚本 / `~/.openclaw/cron/jobs.json` 已有 3 cron（disabled）/ `/Users/njx/njx-knowledge/` 已有 1190 文件 | `apps/mobile/**`（mobile stream 独占） | 0（只 verify + 必要时 enable cron） |
| **P2a** | mobile 4 tab + RecorderWorkspace + offlineAsr + CalendarScreen + KnowledgeScreen + CaptureScreen + Pairing 全套 + Android emulator | server (`apps/server/**` 不重启) + web + desktop | 0（只验收不改代码） |
| **P2b** | `openclaw-mate60.apk` 现有 R19B APK | app code | 0（只 install） |
| **P2c** | 全复用 | — | NJX 反馈后 PM 修代码 + 重打 APK |
| **P3** | 全复用 | — | commit history + 截图集 + 收口通知 |

**核心判断**：P1a / P1b / P2a / P3 **零新增代码**（除非 PM 验收发现真正 blocker 或 NJX 真机反馈），只做 commit 收口 + KB v3 verify + emulator 端到端 + 真机反馈循环。代码改动是 sub-agent / NJX 提的，不是 PM 自己提的。

---

## v5 双 stream 并行图（核心 · KB v3 与 mobile 并行）

```
    P1a mobile stream                P1b KB v3 stream
    ─────────────────                ─────────────────
    3 commit + typecheck     并行    V1 T2 端到端
    收口 dirty tree                  V2 T5 cron 真跑
                                     V3 T7 迁移完整性
                                     V4 T8 UI 截图
            │                                │
            └──────┬─────────────────────────┘
                   ▼
              P1 gate (双绿才进)
                   │
                   ▼
              P2a PM 域 emulator 端到端 (47 项 + 23+ 截图)
                   │
                   ▼
              P2b 真机交付 (APK + 验收清单)
                   │
                   ▼
              P2c NJX 真机反馈循环 ←── NJX 物理 install
                   │
                   ▼
              P3 三域全绿 → Sprint 收口
```

**关键约束**：
- **P1a 范围**：`apps/mobile/**` 改 → 3 commit
- **P1b 范围**：`/Users/njx/njx-knowledge/**` + `apps/server/src/index.ts` knowledge 模块 + `apps/web/src/App.tsx` knowledge/chat + `~/.openclaw/skills/njx-knowledge-organize/**` + `~/.openclaw/cron/jobs.json` (njx-knowledge-* 段)
- **stream 隔离**：mobile stream **不**碰 KB v3 范围，KB stream **不**碰 `apps/mobile/**`（除非 V1 T2 验证需要重启 server — 允许）
- **P1 gate**：P1a + P1b 都全绿才进 P2a，**任何一项 FAIL → raise NJX 决策（继续修 / 接受降级 / 重新 scope）**

---

## P0 · 基线 v5 对齐（当前）

**目标**：写 4 份基线文档 v5，NJX 拍板。

**已完成（v4→v5 改动 — KB v3 提上主线）**：

| 项 | v4 问题 | v5 解决 |
|----|---------|---------|
| KB v3 关联性误判 | v4 写"KB v3 跟 mobile 几乎无关" — 错判 | KB v3 是 mobile M3/M4/M5 后端依赖，**主线先决条件** |
| KB v3 阶段位置 | v4 写"P4 backlog" | 改 P1b，**与 P1a 并行**，P1b 全绿才进 P2a |
| KB v3 验证状态没追踪 | v4 不验证 KB v3 完成度 | P1b V1-V4 4 项 verify（端到端 / cron / 迁移 / UI） |
| 双 stream 隔离 | v4 没写 stream 边界 | RULES §1.2 加 mobile stream vs KB v3 stream 文件 scope 隔离表 |
| 三域全绿才交付 | v4 写"双域" | 升级 **三域全绿**（mobile emulator + mobile 真机 + KB v3） |

**待完成**：
- ⏳ NJX 拍 v5 GOAL/PLAN/RULES/ACCEPTANCE
- ⏳ NJX 确认 KB v3 提上主线（P1b 与 P1a 并行）
- ⏳ NJX 确认 V1-V4 4 verify 必跑

**验收**：NJX "GO v5 ✓"。

---

## P1a · Mobile stream · Dirty tree commit 收口（1h · v5 重命名）

**目标**：working tree 拆 3 commit（R19B / add-note rework / mobile misc），typecheck 全绿。

**前置**：P0 ✓

**scope（stream 隔离 · v5）**：
- ✅ `apps/mobile/**` 改
- ✅ `apps/web/src/styles.css` / `apps/web/src/App.tsx`（mobile 间接影响 — UI 改动）
- ❌ **不**碰 `apps/server/src/index.ts` knowledge 模块（KB stream 独占）
- ❌ **不**碰 `~/.openclaw/cron/jobs.json` njx-knowledge-* 段
- ❌ **不**碰 `/Users/njx/njx-knowledge/**`
- ❌ **不**碰 `~/.openclaw/skills/njx-knowledge-organize/**`

**子任务**：

### 1a.1 分类 + 拆 commit

当前 dirty tree（`git status --short` 命中）：

```
M apps/mobile/app.json
M apps/mobile/package.json
M apps/mobile/src/App.tsx
M apps/mobile/src/components/RecorderWorkspace.tsx
M apps/mobile/src/lib/RecorderContext.tsx
M apps/mobile/src/lib/api.ts
M apps/mobile/src/screens/TodayConsoleScreen.tsx
M apps/server/src/index.ts
M apps/web/src/App.tsx
M apps/web/src/styles.css
M package-lock.json
M scripts/test-knowledge-add-note-direct-runtime.mjs
+ 9 new files (QRScanModal, offlineAsr, qrPairing, engines/, assets/models/, plugins/with-openclaw-ios-model.js, scripts/check-css.mjs, ...)
+ 6 APK binaries in root (r12/r12b/r16/r17/r19/r5)
```

**v5 拆分（3 commit · mobile-only）**：

1. **commit A — R19B emulator-verified sherpa ASR 切换**
   - `apps/mobile/src/lib/engines/sherpaOnnxEngine.ts` (改)
   - `apps/mobile/src/lib/engines/wavDecoder.ts` (新)
   - `apps/mobile/src/lib/engines/index.ts` (新)
   - `apps/mobile/src/screens/TodayConsoleScreen.tsx` (改)
   - `apps/mobile/assets/models/` (新)
   - **不 commit APK**

2. **commit B — mobile QR pairing + offline ASR UI hook**
   - `apps/mobile/src/components/QRScanModal.tsx` (新)
   - `apps/mobile/src/lib/offlineAsr.ts` (改)
   - `apps/mobile/src/lib/qrPairing.ts` (改)
   - `apps/mobile/src/lib/RecorderContext.tsx` (改)
   - `apps/mobile/src/components/RecorderWorkspace.tsx` (改)

3. **commit C — mobile misc + add-note HTML render rework + css + scripts**
   - `apps/mobile/src/App.tsx` (改)
   - `apps/mobile/src/lib/api.ts` (改)
   - `apps/mobile/app.json` (改)
   - `apps/mobile/package.json` (改)
   - `package-lock.json` (改)
   - `apps/web/src/App.tsx` (改 — 但**只 mobile 相关部分**，KB v3 关联的 @njx-knowledge / useNkxLanding / nkx 选项等已在 v3 fixed，**不**改）
   - `apps/web/src/styles.css` (改)
   - **注意**：`apps/server/src/index.ts` 在 v5 中由 KB stream 改，**不**进 mobile commit
   - `scripts/*.mjs` (改/新)

### 1a.2 每 commit 后跑 typecheck

```bash
cd /Users/njx/openclaw/copilot
for commit in A B C; do
  git commit -m "<message>"
  pnpm run check --workspace @openclaw/workbench-mobile
  pnpm run check --workspace @openclaw/workbench-web
  pnpm run check --workspace @openclaw/workbench-server
done
```

### 1a.3 APK 处理

- 6 个 APK（r12/r12b/r16/r17/r19/r5）**不 commit**
- 写 `release/APK_MANIFEST.md`（含 sha256 + versionCode + 用途）
- `openclaw-mate60.apk` = `openclaw-mate60-r19-emulator-verified.apk`（同内容）的规范路径

### 1a.4 验收

- `git log --oneline -5` 看到 3 commit
- `git diff HEAD~3 --check` clean
- 3 次 typecheck 全 exit 0
- APK 在 `/Users/njx/openclaw/copilot/openclaw-mate60.apk` 存在（96,840,577 bytes, mtime new）
- **`apps/server/src/index.ts` 知识库模块没被 mobile commit 改**（stream 隔离 verify）

---

## P1b · KB v3 stream · V1-V4 验证（2-3h · v5 新增 · 与 P1a 并行）

**目标**：KB v3 4 项 verify 全绿（T2 端到端 / T5 cron 真跑 / T7 迁移完整 / T8 UI 闭环），作为 P2a 进入的 gate。

**前置**：P0 ✓

**scope（stream 隔离 · v5）**：
- ✅ `/Users/njx/njx-knowledge/**` 验
- ✅ `apps/server/src/index.ts` knowledge 模块验（**只读**验，不改 — V1 端到端跑已修代码）
- ✅ `apps/web/src/App.tsx` knowledge/chat 部分验（**只读**验，不改）
- ✅ `~/.openclaw/skills/njx-knowledge-organize/` 验
- ✅ `~/.openclaw/cron/jobs.json` njx-knowledge-* 段（**V2 允许 enable 跑 1 次**）
- ❌ **不**碰 `apps/mobile/**`
- ❌ **不**碰 `apps/web/src/styles.css`
- ❌ **不**碰 `package-lock.json`（除非依赖锁需要更新）

### 1b.1 现状诊断（已完成 7/7 12:55）

| T# | 项 | 7/7 状态 | 验证方式 |
|----|----|---------|----------|
| T1 | minimax-direct 真直连 | ✅ 已修复 | grep 验证代码 + V1 端到端跑 |
| T2 | calendar create → njx-knowledge 同步 + html_path 回填 | ✅ 已修复 | **V1 端到端** |
| T3 | validate_terms.py --apply | ✅ 已修复 | `python3 ... --apply` 跑 1 个 RIFD 文件 |
| T4 | njx-knowledge-organize skill + 4 脚本 | ✅ 已修复 | `ls ~/.openclaw/skills/njx-knowledge-organize/scripts/` + 各脚本 --help |
| T5 | 新 cron (daily / incremental / validate) | ⚠️ cron 已创建但全 disabled | **V2 dry-run + enable 跑 1 次** |
| T6 | njx-knowledge 作默认知识源 | ✅ 已修复 | grep + Web UI 截图（V4 覆盖） |
| T7 | 数据迁移 | ⚠️ 1190/1203 = 99% | **V3 diff -rq** |
| T8 | Web/Mobile UI 闭环 | ⚠️ 大部分完成 | **V4 cu 截图** |

### 1b.2 V1 · T2 端到端验证（30 min）

**目标**：跑一次 calendar create，确认响应含 `knowledgeHtmlPath` + `organizedAt` + `markdownPath`。

```bash
# 1. server 已经在跑（@ 38888），不重启
curl http://127.0.0.1:38888/api/health
# 期望: {"status":"ok",...}

# 2. 准备测试 rawContent
RAW='{"dateKey":"2026-07-07","title":"P1b V1 test","kind":"task","rawContent":"# V1 test\n\nThis is a test for KB v3 T2 end-to-end verification.","autoOrganize":true,"qualityMode":"minimax-direct"}'

# 3. 调 calendar create
RESP=$(curl -s -X POST http://127.0.0.1:38888/api/mobile/calendar/create \
  -H "Content-Type: application/json" \
  -d "$RAW")
echo "$RESP" | jq .

# 4. 验响应
echo "$RESP" | jq '.knowledgeHtmlPath // .organizeJob // .html_path // .markdown_path'
# 期望: 非空

# 5. 等 5min 让 job 跑（如果走 job queue），再查 knowledge 表
sleep 300
sqlite3 /Users/njx/openclaw_data/dev/knowledge.sqlite \
  "SELECT knowledge_html_path, organized_at FROM calendar_notes WHERE date_key='2026-07-07' LIMIT 1"
# 期望: knowledge_html_path 非空
```

**PASS 标准**：
- 响应含 organizeJob（job queue 路径走通）或 knowledgeHtmlPath（同步路径走通）
- 5 min 后 sqlite 查询非空
- markdown 文件在 `/Users/njx/njx-knowledge/knowledge/notes/2026-07-07/` 出现

**FAIL 升级**：response 缺字段 / sqlite 空 / markdown 文件没落 → PM 立即修（≤2h）→ 重跑 V1。

### 1b.3 V2 · T5 cron 真跑（30-45 min）

**目标**：3 个 cron 全跑通（dry-run → enable → 1 次实跑）。

```bash
# 1. 看 cron 当前状态
mavis cron list | grep "njx-knowledge"

# 2. dry-run daily-organize（关键：不允许 dry-run 静默 skip）
mavis cron run v3-njx-knowledge-daily-organize --dry-run 2>&1 | tee /tmp/kb-v3-v2-dryrun.log
# 期望: 
# - daily_consolidate.py exit 0
# - ingest_raw.py exit 0  
# - validate_note.py exit 0
# - 报告写入 evidence/kb-v3-v2-report.md

# 3. dry-run 通过后，enable cron + 1 次实跑
mavis cron enable v3-njx-knowledge-daily-organize
mavis cron run v3-njx-knowledge-daily-organize 2>&1 | tee /tmp/kb-v3-v2-realrun.log
# 期望: 3 步 exit 0 + 真实 apply 至少 1 个 note

# 4. 同样跑 incremental + validate
mavis cron enable v3-njx-knowledge-incremental
mavis cron run v3-njx-knowledge-incremental 2>&1 | tee /tmp/kb-v3-v2-incremental.log

mavis cron enable v3-njx-knowledge-validate
mavis cron run v3-njx-knowledge-validate 2>&1 | tee /tmp/kb-v3-v2-validate.log

# 5. 3 个 cron 全跑通后，**回滚 enable=false**（保持原状，不要常驻）
mavis cron disable v3-njx-knowledge-daily-organize
mavis cron disable v3-njx-knowledge-incremental
mavis cron disable v3-njx-knowledge-validate
```

**PASS 标准**：
- 3 个 cron dry-run exit 0
- 1 次实跑 exit 0
- 至少 1 个 note 被 apply（不是 dry-run）
- 实跑后回滚到 disabled（不常驻）

**FAIL 升级**：dry-run 失败 / 脚本 crash / 静默 skip → 修脚本 → 重跑。

### 1b.4 V3 · T7 数据迁移完整性（10 min）

**目标**：确认 njx-knowledge 与老 openclaw_data 路径 100% 一致（除 mtime 差异）。

```bash
# diff 老 vs 新
diff -rq \
  /Users/njx/openclaw_data/memory/knowledge/notes/ \
  /Users/njx/njx-knowledge/knowledge/notes/ \
  2>&1 | tee /tmp/kb-v3-v3-diff.log
# 期望: 0 diff（除 .DS_Store / 系统 metadata）

# 找差异点
diff -rq /Users/njx/openclaw_data/memory/knowledge/notes/ /Users/njx/njx-knowledge/knowledge/notes/ 2>&1 | grep -v ".DS_Store"
# 期望: 0 行

# 老路径独有文件（可能没迁过来）
find /Users/njx/openclaw_data/memory/knowledge/notes/ -type f | sort > /tmp/v3-old.txt
find /Users/njx/njx-knowledge/knowledge/notes/ -type f | sort > /tmp/v3-new.txt
comm -23 /tmp/v3-old.txt /tmp/v3-new.txt | tee /tmp/kb-v3-v3-only-old.txt
# 期望: 0 行（如果非空，需要 PM 手动 rsync）
```

**PASS 标准**：
- `comm -23 old new` 输出 0 行
- 新路径比老路径文件数 ≥ 老路径（可能新增了更多）

**FAIL 升级**：有差异 → 手动 rsync 老→新 → 重跑 V3。

### 1b.5 V4 · T8 UI 截图（30 min）

**目标**：用 cu 截 4-6 张图，证 Web+Mobile UI 闭环。

```bash
# 1. cu 接管 Mac 桌面
mavis mcp call cu desktop_screenshot '{}'  # 看 Mac 桌面（Web 在 Mac 浏览器）
# 期望: Web Workbench 页面

# 2. 截 Web Add Note 弹窗（含 minimax-direct 选项 + useNkxLanding + nkx 选项）
# 路径: Web → Assistant / Knowledge 页面 → Add Note 弹窗
mavis mcp call cu desktop_screenshot '{}' > evidence/kb-v3-v4-01-web-addnote.png

# 3. 截 Web chat @njx-knowledge 输入（默认 knowledgeSources 验证）
# 路径: Web → Assistant → chat 输入框
mavis mcp call cu desktop_screenshot '{}' > evidence/kb-v3-v4-02-web-chat-prefix.png

# 4. 截 Web 知识源状态（njx-knowledge / memory / wiki / nas / ima 5 个）
# 路径: Web → KnowledgeSync 状态卡 / dashboard
mavis mcp call cu desktop_screenshot '{}' > evidence/kb-v3-v4-03-web-sources.png

# 5. 截 Mobile CalendarScreen Switch + rawContent（emulator 内）
# 路径: emulator → 日程 tab → + 新建 → EventEditor
adb -s emulator-5554 exec-out screencap -p > evidence/kb-v3-v4-04-mobile-eventeditor.png

# 6. 截 Mobile CalendarScreen kind=task 自动入库（用 V1 刚创建的 task）
# 路径: emulator → 日程 tab → 看到新 task
adb -s emulator-5554 exec-out screencap -p > evidence/kb-v3-v4-05-mobile-task-in-knowledge.png
```

**PASS 标准**：
- 4-6 张截图存档 `evidence/kb-v3-v4-*.png`
- 每张截图肉眼可看到对应 UI（addnote 弹窗、chat 前缀、5 知识源、EventEditor Switch、knowledge tab 新笔记）
- 截图含 timestamp

**FAIL 升级**：UI 元素缺失 / minimax-direct 选项不在 / 知识源不含 njx-knowledge → 修前端 → 重截。

### 1b.6 P1b 收口验收

- V1 PASS（response 含字段 + sqlite 非空 + markdown 落盘）
- V2 PASS（3 cron dry-run + 实跑全 exit 0 + 回滚 disabled）
- V3 PASS（0 diff / 0 老独有）
- V4 PASS（4-6 张截图齐）
- 写 `/Users/njx/openclaw/copilot/evidence/kb-v3-p1b-receipt.md` 含 4 verify 的 evidence 链接

**任何 1 项 FAIL → 不进 P2a → PM退回重做，项目进入loop循环开发直到验收通过**。

---

## P1 gate · P1a + P1b 双绿才进 P2a（v5 新增）

**目标**：双 stream 都全绿才能推 P2a（mobile MVP 6 模块 emulator 端到端）。

**前置**：
- P1a mobile commit 收口全绿（3 commit + typecheck + APK 落盘）
- P1b KB v3 V1-V4 4 verify 全绿（response / cron / 迁移 / UI）

**规则**：
- ✅ 双绿 → 推 P2a
- ❌ 任何一项 FAIL → **raise NJX 决策**（continue / accept / rescope）
  - continue：PM 自主修，2 次仍 fail 升 NJX
  - accept：NJX 接受 P2a 在该 FAIL 项下运行（例：KB v3 T2 没真直连，emulator M3 测出来再补）
  - rescope：NJX 重写 P1b 范围

**不能**：
- ❌ P1a 绿但 P1b 红 → 推 P2a（M3/M4/M5 在 emulator 跑通是假通）
- ❌ P1b 绿但 P1a 红 → 推 P2a（mobile 代码没 commit 收口，emulator 跑的不是 R19B 最新）

---

## P2a · PM 域 · Emulator 端到端验证（核心 4-6h · v4 重写 · v5 改前置）

**目标**：PM 用 `mavis mcp call cu desktop_*` 接管 Mac mini 桌面 + adb 远端调试 **emulator** (pixel_6 API 33)，模拟用户视角跑 M1-M6 全 6 模块的 checklist，**每步关键操作附截图 + 全部 47 项 PASS 才算交付**。

**前置**：P1 gate ✓（P1a + P1b 双绿）

**关键修正（v4）**：
- ❌ v3 "PM 用 cu 接管真机" **不可行** — cu = Mac 桌面控制，**无法**控制 Android 设备屏幕
- ✅ v4 = PM 在 **emulator** 上跑（Mac mini 上 pixel_6 API 33 ARM64），cu 接管 Mac 桌面 + adb shell 远端调试 emulator
- ✅ 真机验证 = NJX 物理执行（见 P2b / P2c）

### 2a.1 Emulator 启动 + 检查

```bash
# 启动 emulator（如果没在跑）
$ANDROID_HOME/emulator/emulator -avd pixel_6_api_33_arm64 &
adb wait-for-device
adb devices
# 期望: emulator-5554    device
```

### 2a.2 装 APK 到 emulator

```bash
adb -s emulator-5554 uninstall com.openclaw.mobile || true
adb -s emulator-5554 install -r /Users/njx/openclaw/copilot/openclaw-mate60.apk
# 期望: Performing Streamed Install / Success
```

### 2a.3 Cold start + logcat 收

```bash
adb -s emulator-5554 shell pm clear com.openclaw.mobile
adb -s emulator-5554 shell pm grant com.openclaw.mobile android.permission.RECORD_AUDIO
adb -s emulator-5554 shell pm grant com.openclaw.mobile android.permission.POST_NOTIFICATIONS
adb -s emulator-5554 shell am start -n com.openclaw.mobile/.MainActivity
sleep 10
adb -s emulator-5554 logcat -d > /tmp/emulator-cold-start.log
# 期望命中:
# - ReactNativeJS: native ASR registered in JS: true
# - ReactNativeJS: sherpa-onnx model detection OK: true
# - RECORD_AUDIO / POST_NOTIFICATIONS granted
```

### 2a.4 PM cu 操作 47 项 checklist（核心 4h）

**机制**（**仅对 emulator 生效**，非真机）：

```bash
# PM 接管 Mac mini 桌面
mavis mcp call cu desktop_screenshot '{}'  # 看 Mac 桌面（emulator 窗口在 Mac 上显示）
mavis mcp call cu desktop_left_click '{"x":540,"y":1200}'  # 点击 emulator 窗口内坐标
mavis mcp call cu desktop_type '{"text":"..."}'  # 输入到 emulator
mavis mcp call cu desktop_screenshot '{}'  # 操作后看效果
# 或用 adb shell input 模拟（emulator 内 OK，真机 = 不允）
adb -s emulator-5554 shell input tap 540 1200
adb -s emulator-5554 shell input text "test"
```

**47 项 checklist + 23+ 截图**（详尽清单在 ACCEPTANCE.md §3-PM-CU-VERIFY，**全部基于 emulator 跑**）：

| 模块 | checklist 项数 | 关键步骤数 | 截图要求 |
|------|--------------|-----------|----------|
| **M1 Capture** | 10 项 | 5 步 | 5+ 张（emulator 窗口截图） |
| **M2 Local ASR** | 8 项 | 4 步 | 4+ 张 |
| **M3 Auto-organize** | 6 项 | 3 步 | 3+ 张 |
| **M4 AI Decision** | 5 项 | 2 步 | 2+ 张 |
| **M5 Schedule/Task** | 8 项 | 4 步 | 4+ 张 |
| **M6 Sync** | 6 项 | 3 步 | 3+ 张 |
| **启动检查** | 4 项 | 2 步 | 2+ 张 |
| **合计** | **47 项** | **23 步** | **23+ 张** |

**验收**：
- 47 项 checklist 全部 PASS（emulator 端）
- 23+ 张关键步骤截图齐（emulator 窗口截图）
- `ACCEPTANCE_LOG.md` 写明每模块 + 时间戳 + 截图 hash
- 任何单条 FAIL → 整个 P2a FAIL → PM 立即修复（不依赖 NJX）

### 2a.5 Emulator vs 真机差异说明（v4 关键澄清）

emulator 跟真机有以下差异，PM 在验收时**需记录差异**，NJX 真机验收时重点查：

| 差异 | emulator | 真机 | 风险 |
|------|---------|------|------|
| 麦克风 | emulator 麦克风 = host Mac mic，sherpa-onnx 走 Mac audio driver | 真麦物理收音 | ASR 转写质量可能不同 |
| 通知调度 | emulator 通知能弹，但无真实后台 | 真机 Android Doze/AppStandby 会杀后台 | M5 reminder 触发可能延迟 |
| 后台录音 | emulator 后台稳定 | 真机华为 EMUI 杀后台严格 | M1 跨 tab 浮动条可能被杀 |
| 网络 | emulator 共享 Mac 网络 | 真机 wifi/cellular 切换 | M6 离线 replay 时机不同 |
| 权限弹窗 | emulator 一次给齐 | 真机华为系统级二次确认 | M1 录音权限第一次会卡 |

**这些差异是 NJX 真机验收清单重点查的项目**（不是 PM 域 blocker）。

---

## P2b · 真机交付（0.5h · v4 新增）

**目标**：PM 把 APK 落盘 + 写好 NJX 真机验收清单 + 通知 NJX 物理 install。

**前置**：P2a ✓

### 2b.1 APK 落盘 + 元信息

```bash
# 验证 APK 仍在原位
ls -la /Users/njx/openclaw/copilot/openclaw-mate60.apk
shasum -a 256 /Users/njx/openclaw/copilot/openclaw-mate60.apk
# 期望: 96,840,577 bytes, sha256=<hash>
# versionCode=9, versionName=1.0.8
```

### 2b.2 写 NJX 真机验收清单（PM 写）

**位置**：`/Users/njx/openclaw/copilot/evidence/njx-real-verify-checklist.md`

**格式**（NJX 逐项填 PASS/FAIL + 备注 + 截图）：

```markdown
# NJX 真机验收清单 v1.0

**APK**: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB)
**版本**: versionCode=9, versionName=1.0.8
**sha256**: <hash>
**APK built**: 2026-07-07 13:30 (commit <hash>)
**PM emulator 域**: ✅ 全绿 47/47（PM 已验）
**验收人**: NJX 物理
**验收时间**: ____

## 真机环境
- 设备: 华为 Mate60
- Android: 14 (HarmonyOS NEXT 不在范围)
- 物理 USB 已接
- 麦克风 = 真麦

## 真机 vs emulator 差异重点（PM 标注）
- [ ] M1 后台录音：真机 EMUI 杀后台 → 跨 tab 浮动条是否被保持
- [ ] M2 真麦 ASR：emulator 用 Mac mic vs 真表物理收音 → 文字是否更准
- [ ] M5 通知：真机 Doze 模式 → 5min 后提醒是否准时
- [ ] M6 离线：真机 wifi 切换 → 同步 replay 是否正常
- [ ] 权限：真机华为系统级二次确认 → 录音权限第一次会卡

## 47 项 checklist 全部复用（NJX 在真机上重跑）
（详见 ACCEPTANCE.md §3-PM-CU-VERIFY 47 项表，NJX 把 emulator 验收改为真机验收）

## NJX 反馈格式
每项：
- ✅ PASS
- ❌ FAIL（附截图 + logcat + 复现步骤）
- ⚠️ DEGRADED（功能可跑但有降级）
```

### 2b.3 通知 NJX

```markdown
📦 Sprint 收口 (PM 域全绿) — 等你真机验收

✅ P1 commit 收口：3 commit + typecheck 全绿
✅ P2a emulator 端到端：47/47 checklist + 23+ 截图

📦 真机交付：
- APK: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB, sha256=<hash>)
- 真机验收清单: /Users/njx/openclaw/copilot/evidence/njx-real-verify-checklist.md
- 截图集: /Users/njx/openclaw/copilot/evidence/p3-*.png

🟢 下一步（**你**的 ops 范围）：
1. 物理 USB 接 Mate60
2. `adb install -r /Users/njx/openclaw/copilot/openclaw-mate60.apk`
3. 按真机验收清单逐项跑（重点查真机 vs emulator 差异）
4. 填反馈（PASS/FAIL/DEGRADED + 备注 + 截图）
5. 任何 FAIL → 我立即修 + 重打 APK → 你复验

预计反馈时间：<2h 一次循环
```

---

## P2c · 真机反馈循环（v4 新增 · 0.5-2h/loop · 持续到 NJX 全绿）

**目标**：NJX 真机反馈 → PM 修复 → 重打 APK → NJX 复验 → 循环到全绿。

**前置**：P2b 通知发出

### 2c.1 反馈接收 + 分级

NJX 反馈分 3 级：

| 级别 | 触发 | PM 响应 |
|------|------|---------|
| **C1 core blocker** | 真机 crash / 录音失败 / 入库失败 / 数据丢失 | PM 立即修（≤ 2h）→ 重打 APK → NJX 复验 |
| **C2 functional fail** | 单项 checklist FAIL（非 crash） | PM ≤ 4h 修 → 重打 → 复验 |
| **C3 cosmetic** | 视觉/UX 略差 | 记 backlog，**不阻塞 sprint 收口** |

### 2c.2 修复流程

```bash
# 1. PM 收到反馈，5min 内 acknowledge
echo "ACK P2c C<X> — <checklist_id> — <现象> — 修起 ETA <H>h" >> evidence/p2c-log.md

# 2. 改代码（如果是 C1/C2 触发代码改动）
cd /Users/njx/openclaw/copilot
# ... 改代码 ...
pnpm run check --workspace @openclaw/workbench-mobile

# 3. 重打 APK
npx expo export --platform android
# 或: cd apps/mobile && npx expo prebuild && npx expo run:android --variant release

# 4. 更新 release/APK_MANIFEST.md（新 sha256 + versionCode +1）
# 5. 通知 NJX 复验
```

### 2c.3 循环收口条件

- NJX 真机验收 47 项全绿 → P2c 收口 → 进 P3
- C3 cosmetic 不阻塞 P3 收口（仅 backlog）
- 循环 ≥ 3 次仍 fail → PM raise NJX 决策（继续修 or 接受降级 or 重新 scope）

---

## P3 · Sprint 收口 + 通知（v4 重写 · 0.5h）

**目标**：PM 域全绿 + NJX 域全绿（无 C1/C2 pending）→ 汇总证据 + 通知 NJX。

**前置**：P1 ✓ + P2a ✓ + P2b 通知发出 + P2c 循环到全绿

**关键修正（v4）**：
- ❌ v3 P3 "PM cu 真机验收" **不成立** — 已迁到 P2a emulator 域
- ✅ v4 P3 = 双域全绿后的**收口通知**，不重复验收工作

### 3.1 写 `/Users/njx/openclaw/copilot/SPRINT_RECEIPT_v1.md`

包含：
- 3 commit hash（P1 收口）
- APK 路径 + sha256（P2a emulator 验过版本）
- 23+ emulator 截图路径 + 关键操作标注（P2a）
- NJX 真机验收清单结果（P2c 全绿状态）
- 47 项 checklist 全 PASS 状态（emulator 47 + 真机 47）
- "双域全绿通知 NJX" 块

### 3.2 通知 NJX

```markdown
🎉 Sprint 收口 — OpenClaw Mobile MVP（双域全绿）

✅ P1 (commit 收口)：3 commit + typecheck 全绿
✅ P2a (emulator 端到端 — PM 域)：47 项全 PASS + 23+ 截图
✅ P2b (真机交付)：APK 落盘 + 真机验收清单
✅ P2c (真机反馈循环 — NJX 域)：NJX 真机 47 项全绿

📦 交付：
- commits: <hash A> <hash B> <hash C>
- APK: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB)
- emulator 截图集: /Users/njx/openclaw/copilot/evidence/p2a-*.png
- 真机验收清单: /Users/njx/openclaw/copilot/evidence/njx-real-verify-checklist.md (NJX 填的)

🟢 下一步：
- 决定 KB v3 / Phase 2 timing
- 考虑 Sprint 2 立项（PM cu 控制台 / chat-agent / aog / 等）
```

### 3.3 收口硬规则（v4）

- 任何 C1/C2 真机 FAIL 没修完 → **不算 P3 收口**
- C3 cosmetic 计入 backlog 但不阻塞 P3
- NJX 域有未反馈项 → PM raise NJX 一次（不在沉默中假设通过）

---

## P4 · Phase 2 ToC 化（backlog · v5 重排）

iOS + 订阅 + 多设备同步 + 多用户 + RBAC + 多模态。Phase 1 跑通 + 真实用户用 3 个月后再立项。

**KB v3 已在 v5 提到主线先决条件**（P1b），不在 P4 backlog。

---

## 风险与缓解（v5 — 双 stream + 双域 + KB v3）

| 风险 | 缓解 |
|------|------|
| **P1a / P1b 并行冲突**（mobile 改 server knowledge 模块 / KB 改 mobile） | RULES §1.2 stream 隔离表，文件 scope 严格分开 |
| **P1a 绿但 P1b 红**（M3/M4/M5 假通） | P1 gate 拦截，不进 P2a |
| **P1b V1 calendar create 端到端失败** | PM 修代码（≤2h）→ 重跑 |
| **P1b V2 cron 实跑 crash** | 修脚本 → dry-run → 实跑 → 回滚 disabled |
| **P1b V3 迁移 diff > 0** | 手动 rsync 老→新 → 重跑 |
| **P1b V4 UI 截图缺元素** | 修前端 → 重截 |
| **PM 不能接管真机**（cu 只能控 Mac 桌面） | 双域分轨：PM 域 = emulator，NJX 域 = 真机 |
| Emulator 通过但真机不通过（差异点） | NJX 真机验收清单重点查：M1 后台 / M2 真麦 / M5 通知 / M6 离线 / 权限二次确认 |
| Mate60 真机 install fail | PM 修代码 + 重打 APK → NJX 复验（最多 3 轮） |
| 真机麦克风收音不上 | wavDecoder 已含 8k→16kHz resampler |
| M3 5min 内自动入库未触发 | P1b V1 已端到端验，PM emulator 截图 |
| M4 decision API 返回无 sources | P1b V1 + T6 默认知识源已验，PM emulator 验 |
| 某模块单条 FAIL 持续 30min | PM 立即修（emulator 域）/ raise NJX（真机域） |
| P2c 真机反馈循环 ≥ 3 轮仍 fail | PM raise NJX 决策 |
| cross-env 数据污染 | dev/staging/prod 三 tier 严格隔离 |

---

## 故障分级（与 RULES.md §12 对齐 · v5 调整）

| 级别 | 触发 | PM 响应 |
|------|------|---------|
| **P0** | 战略转向 / 外部承诺 / 破坏性 / 资源分配 | 立即 raise NJX |
| **P1** | core blocker（typecheck fail / 真机 crash / 数据丢失 / checklist FAIL） | PM 自主 ≤ 2 次 steer，2 次仍 fail 升 NJX |
| **P1b-V** | KB v3 V1-V4 任意 verify FAIL | PM 立即修，2 次仍 fail 升 NJX |
| **P1-gate** | P1a + P1b 双绿门控失败 | 立即 raise NJX 决策（continue / accept / rescope） |
| **P2** | non-blocker（lint warn / 单测 fail / cosmetic） | PM 自主修，记 backlog |
| **P3** | knowledge / docs 过期 | backlog 项，不抢主线 |
| **P2c-C1** | NJX 真机 core blocker | PM 立即修（≤ 2h）→ 重打 → 复验 |
| **P2c-C2** | NJX 真机 functional fail | PM ≤ 4h 修 → 重打 → 复验 |
| **P2c-C3** | NJX 真机 cosmetic | 记 backlog，不阻塞 P3 收口 |

---

*本文件由 Mavis（PM）于 2026-07-07 13:00 重写（v4 → v5，KB v3 从 backlog 提上主线先决条件，拆 P1a + P1b 双 stream 并行 + P1 gate 双绿门控 + V1-V4 4 verify 全任务化 + 风险表升级）。NJX 拍板后启动 P1a + P1b 双 stream 并行。*
