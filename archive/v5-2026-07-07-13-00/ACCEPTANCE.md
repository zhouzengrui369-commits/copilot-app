# OpenClaw Mobile 随身助理 · 验收文档 v5.0（2026-07-07）

> PM: Mavis
> 创建: 2026-07-07 12:00 (UTC+8) v3.0
> v4.0 重置: 2026-07-07 12:30（NJX 拍"PM 不接管真机物理 ops" → 拆 §3-PM-CU-VERIFY（emulator 域）+ §3-NJX-REAL-VERIFY（真机域））
> v5.0 重置: 2026-07-07 13:00（NJX 拍"KB v3 提上主线" → 加 §3-KB-V3-VERIFY（V1-V4 4 verify）+ §0 三域分轨总览）
> 路径: `/Users/njx/openclaw/copilot/ACCEPTANCE.md`
> 配套: `GOAL.md` / `PLAN.md` / `RULES.md`

---

## 0. 四域分轨总览（v5 拍板 · 必须先看）

| 域 | 验收者 | 环境 | 工具 | 截图/证据存放 | 证据源 |
|---|--------|------|------|--------------|--------|
| **P1a mobile stream** | Mavis（PM） | `apps/mobile/**` git 工作树 | git + pnpm check | git log + 3 typecheck 输出 | PM 自验 |
| **P1b KB v3 stream** | Mavis（PM） | `njx-knowledge/` + `apps/server` knowledge 模块 + `~/.openclaw/{cron,skills}` + `apps/web` knowledge/chat 段 | python3 + mavis cron + curl + cu | `evidence/kb-v3-v{1,2,3,4}-*` | PM 自验 |
| **P2a mobile PM 域** | Mavis（PM） | **emulator**（Mac mini 上 pixel_6 API 33 ARM64） | cu 控 Mac 桌面 + adb -s emulator-5554 | `evidence/p2a-*.png` | PM 自验 |
| **P2c mobile NJX 域** | NJX 物理 | **真机** Mate60 | 物理触屏 + 物理 USB + 真麦 | `evidence/njx-real-*.png` | NJX 填清单 |

**v5 关系**（KB v3 是 mobile M3/M4/M5 后端依赖）：
```
P1a 绿 + P1b 绿 ─→ P1 gate ─→ P2a PM 域 ─→ P2b 真机交付 ─→ P2c NJX 真机反馈循环 ─→ P3 收口
                                              │
                                              └──→ 三域全绿才 P3 收口
```

**核心判断**：
- ❌ P1a 绿 ≠ P1b 绿（mobile commit 不验 KB v3）
- ❌ P1b 绿 ≠ P2a 绿（KB v3 通了才能在 emulator 验 M3/M4/M5 不假通）
- ❌ P2a 绿 ≠ P2c 绿（emulator ≠ 真机）
- ✅ **P1a + P1b + P2a + P2c 四域全绿** = 交付

**v3 铁律"emulator 不算真机 PASS" 在 v4 修正为双域，v5 升级为四域 + P1a/P1b 并行门控**：
- v3 = "emulator 通过就假装真机 OK" 禁止
- v4 = "emulator ≠ 真机，PM 必跑 emulator，NJX 必跑真机"
- v5 = "P1a 绿 + P1b 绿 + PM 域 + NJX 域 四域全绿"

---

## 1. 总门控（来自 `development-gates.json`）

| Gate | 命令 | 必跑时机 | Phase 1 状态 |
|------|------|----------|--------------|
| **prd_required** | read `development_documents.PRD` | 每个 task 启动前 | ✅ 当前 PRD 已存在 |
| **prototype_required** | verify prototype screenshot | UI 改动必跑 | ✅ R19B 截图全 |
| **test_evidence_required** | `npm run test:env && check && build && test:prd:staging && test:e2e:staging` | release 前必跑 | ✅ dev 全绿 |
| **security_scan** | `npm run security:scan` | 外部通知必跑 | ✅ 无外部通知 |
| **env_isolation** | assert `OPENCLAW_WORKBENCH_ENV` + port/data_dir | 每次写前 | ✅ dev env |
| **staging_acceptance_required** | staging evidence pack + `user_review=ACCEPTED` | prod 前 | N/A（Phase 1 无 prod） |
| **no_fake_ok** | degraded dependencies stay visible | 每次报完成前 | ✅ 强制 |

任何 gate 不通过 → **BLOCKER**，不进入下一阶段。

---

## 2. Per-task 验收标配

```
tasks/<scope>/<ts>-<slug>/
├── TASK.md              # PM 写（含 stream 标识）
├── PLAN.md              # sub-agent 写
├── RESULT.md            # sub-agent 写（含 comm-ack 已发）
├── EVIDENCE.md          # 截图 + logcat + 命令输出
├── ACCEPTANCE_LOG.md    # PM 写（P3 主要在这里）
├── commands.log         # 所有命令
├── changed-files.txt    # 实际改的文件（= TASK.md allowed files）
└── artifacts/           # 截图 / logcat / UI dump
```

缺任一 → BLOCKER。

---

## 3. 双域验收（v4 重写核心章节）

### 3-PM-CU-VERIFY · PM 域（emulator 端到端）

> **核心规则**：PM 用 `mavis mcp call cu desktop_*` 接管 **Mac mini 桌面** → adb 控 **emulator (pixel_6 API 33)** → 模拟用户视角操作 → **每步关键操作截图存档** → **全部 47 项 checklist PASS 才算 PM 域通过**。
>
> **不允**：单条 FAIL 后继续标 PASS / "sub-agent 说应该 OK" / `adb shell input keyevent` 模拟真机用户 / 假装 cu 接管真机 / 拿 emulator 截图当真机 PASS。

### 3-PM-CU-VERIFY · 启动检查（4 项 + 2 截图）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **P-01** | cu renderer toggle 已 enable | `mavis mcp call cu desktop_screenshot '{}'` 看返回 | 有响应（不是 error） | — |
| **P-02** | Mac mini 桌面看得到 | cu screenshot | 显示桌面（含 emulator 窗口） | `evidence/p2a-pm-cu-01-desktop.png` |
| **P-03** | emulator 设备连接 | `adb devices` | 显示 `emulator-5554 device` | — |
| **P-04** | server 在跑 | `curl http://127.0.0.1:38888/api/health` | 200 / ok | — |

### 3-M1 · Capture 验收（10 项 + 5 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M1-01** | 启动 app | cu 在 Mac 桌面打开 OpenClaw 图标 | 启动到 Today 主页 | `evidence/p2a-m1-01-cold-start.png` |
| **M1-02** | 显示 4 tab（记录/知识/日程/设备） | 肉眼可见 | ✅ | 同上 |
| **M1-03** | 切 tab 不丢状态 | cu 点击 知识 tab → 再切回 记录 | 录音浮动条仍在 | `evidence/p2a-m1-03-tab-switch.png` |
| **M1-04** | 长按录音按钮启动 | cu 在 `记录` tab 长按录音按钮 | recorder UI 打开 | `evidence/p2a-m1-04-recorder-open.png` |
| **M1-05** | emulator 麦克风收音 | cu 在 Mac 系统设置 → 选 host mic → 录 5 秒 | audio waveform 波动 + logcat hit | `evidence/p2a-m1-05-recording.png` |
| **M1-06** | 录音可见时长 | 录 30+ 秒 | UI timer 显示 mm:ss | 同上 |
| **M1-07** | 跨 tab 浮动条 | 切到 `知识` tab 不停录音 | 浮动条仍可见 + 显示 timer | `evidence/p2a-m1-07-floating-bar.png` |
| **M1-08** | 录音 WAV 文件落盘 | `adb -s emulator-5554 pull /sdcard/Android/data/com.openclaw.mobile/files/recordings/...` | 拉出 WAV 文件 size > 50KB | — |
| **M1-09** | 停止录音 | cu 点 停止 | preview UI 显示转写 + audio player | `evidence/p2a-m1-09-stop-and-preview.png` |
| **M1-10** | 文字输入入库 | cu 在 CaptureScreen 输入文字 → 提交 | 在 `知识` tab 看到新笔记 | `evidence/p2a-m1-10-text-input.png` |

### 3-M2 · Local ASR 验收（8 项 + 4 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M2-01** | ASR 引擎注册 | adb -s emulator-5554 logcat 看冷启动 | `native ASR registered: true` | — |
| **M2-02** | 模型加载 | logcat | `sherpa-onnx model detection OK: true` | — |
| **M2-03** | 端侧实时预览 | emulator 录 1 分钟（用 host mic） | textarea < 5s 延迟出现文字 | `evidence/p2a-m2-03-asr-live.png` |
| **M2-04** | 流式输出 | 录 30 秒后看 textarea | 持续追加转写，不是一次性 | 同上 |
| **M2-05** | logcat 端侧命中 | logcat | `transcribeOffline ok=true engine=sherpa-onnx segments=N` | — |
| **M2-06** | 不依赖远端兜底 | 断网（关闭 Mac server）再录 | 仍能转写 | `evidence/p2a-m2-06-offline.png` |
| **M2-07** | emulator 完整跑通 | emulator 端到端 | 同流程可重现 | `evidence/p2a-m2-07-emulator-done.png` |
| **M2-08** | 转写入 textarea 文本可肉眼识别 | 录普通话测试 | 转写文字肉眼可读 | — |

**注意**：M2-08 用 host mic 录，emulator 域的 mic 跟真麦物理收音有差异，**NJX 真机域需重跑 M2-08 验证真麦转写质量**。

### 3-M3 · Auto-organize 验收（6 项 + 3 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M3-01** | 录音结束触发后台整理 | 停止录音 | state 变 `transcribing` → `saved` | `evidence/p2a-m3-01-pre-saved.png` |
| **M3-02** | 5 分钟内入库 server | `sleep 300 && curl http://127.0.0.1:38888/api/knowledge/list` | 找到新笔记 | — |
| **M3-03** | 知识 tab 看到新笔记 | 切 `知识` tab 刷新 | 新笔记项出现在最前 | `evidence/p2a-m3-03-knowledge-list.png` |
| **M3-04** | 笔记含 Markdown | 点击新笔记 | Markdown 渲染（title + body） | — |
| **M3-05** | 笔记含摘要 + 标签 | 打开详情页 | 显示自动生成的 summary + tags | `evidence/p2a-m3-05-summary.png` |
| **M3-06** | 录音原始 WAV 路径可追溯 | 详情页 metadata 显示 path | 路径含 `recordings/` | — |

### 3-M4 · AI Decision 验收（5 项 + 2 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M4-01** | chat UI 入口 | app 内有 chat icon | ✅ | — |
| **M4-02** | 决策查询 | 输入 "我下周要出差吗？" | 200 响应 + 返回文字 | — |
| **M4-03** | 召回相关日程 | 响应含 ≥1 个日程/笔记 | `sources` 字段非空 | `evidence/p2a-m4-03-sources.png` |
| **M4-04** | 可解释性 | 30s 内肉眼可识别来源 | sources 列表清晰显示 | 同上 |
| **M4-05** | 决策可追溯 | 点击 source 跳转 | 跳到对应笔记/日程详情 | `evidence/p2a-m4-05-jump.png` |

### 3-M5 · Schedule/Task 验收（8 项 + 4 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M5-01** | 切到 日程 tab | cu 点击 | 显示当前日列表 | `evidence/p2a-m5-01-calendar-list.png` |
| **M5-02** | 日程 CRUD | cu 点 + 新建日程 | 模态弹出 + 表单 | — |
| **M5-03** | 创建事件（event） | 输入 title + 时间 + 保存 | 出现在今日列表 | `evidence/p2a-m5-03-event-created.png` |
| **M5-04** | 创建任务（task） | kind=task + 保存 | 出现在 task 列表 | `evidence/p2a-m5-04-task-created.png` |
| **M5-05** | 编辑/删除 | cu 点编辑 → 改 → 保存 / 删除 | UI 反映改动 | — |
| **M5-06** | 周/月视图切换 | 日/周切换可见 | 视图切换 | `evidence/p2a-m5-06-week-view.png` |
| **M5-07** | 提醒触发 | 设置 5 分钟后提醒 → 等 | emulator 通知弹出 | `evidence/p2a-m5-07-notification.png` |
| **M5-08** | 自动入库 knowledge | 创建 task 后看 knowledge tab | 关联笔记自动出现 | — |

**注意**：M5-07 emulator 通知 ≠ 真机通知，**NJX 真机域需重跑 M5-07 验证 Doze 模式下提醒是否准时**。

### 3-M6 · Sync 验收（6 项 + 3 截图 · emulator 域）

| # | checklist | 操作 | 期望 | 截图 |
|---|----------|------|------|------|
| **M6-01** | QR pairing 入口 | app 内 QR scan UI | ✅ | `evidence/p2a-m6-01-pairing.png` |
| **M6-02** | emulator 扫 QR | cu 操作扫码 / 输入 6 位码 | bootstrap 200 | `evidence/p2a-m6-02-paired.png` |
| **M6-03** | server 已注册设备 | `curl .../api/devices/list` | 看到 emulator device | — |
| **M6-04** | 离线操作不丢数据 | emulator 关 wifi → 创建 task | UI 仍提示操作成功（pending sync） | `evidence/p2a-m6-04-offline-creates.png` |
| **M6-05** | 重连 replay | emulator 开 wifi | pending task 同步到 server | `evidence/p2a-m6-05-sync-done.png` |
| **M6-06** | 双向同步 | Mac server 新建 → emulator 看到 | < 2s 出现 | — |

**注意**：M6 emulator wifi = Mac 共享网络，**NJX 真机域需重跑 M6 验证真机 wifi/cellular 切换时的同步行为**。

### 3-PM 总验收（emulator 域）

- **47 项 checklist** 全 PASS（任何 1 项 FAIL → P2a 整体 FAIL）
- **23+ 张关键步骤截图**全部存档在 `/Users/njx/openclaw/copilot/evidence/p2a-*.png`
- ACCEPTANCE_LOG.md 写明每模块 + 时间戳 + 截图 hash
- 任何"emulator 已通过" **不算** 真机通过 → 必须 NJX 真机域重跑

---

## 3-KB-V3-VERIFY · P1b 验收（v5 新增 · KB v3 V1-V4 4 verify · P2a gate）

> **核心规则**：KB v3 4 项 verify（V1 T2 端到端 / V2 T5 cron 真跑 / V3 T7 迁移完整 / V4 T8 UI 截图）**全部 PASS** 才算 P1b 全绿，**P1b 不全绿不能进 P2a**（因为 M3/M4/M5 在 emulator 跑通是假通）。
>
> **不允**：V1 响应缺字段假装过 / V2 静默 skip 假装 exit 0 / V3 老路径有 diff 假装 0 差异 / V4 截图缺元素假装 UI 闭环。

### V1 · T2 端到端验证（calendar create → njx-knowledge 同步 + html_path 回填）

| # | checklist | 操作 | 期望 | 证据 |
|---|----------|------|------|------|
| **V1-01** | server 在跑 | `curl http://127.0.0.1:38888/api/health` | 200 / ok | — |
| **V1-02** | calendar create 接受 rawContent + autoOrganize | `curl -X POST .../api/mobile/calendar/create -d '{rawContent, autoOrganize:true, qualityMode:"minimax-direct"}'` | 200 / ok | `evidence/kb-v3-v1-01-create-resp.json` |
| **V1-03** | 响应含 organizeJob 或 knowledgeHtmlPath | `jq '.organizeJob // .knowledgeHtmlPath'` | 非空 | 同上 |
| **V1-04** | 5min 后 sqlite 查 knowledge_html_path | `sleep 300 && sqlite3 .../knowledge.sqlite "SELECT knowledge_html_path, organized_at FROM calendar_notes WHERE date_key='2026-07-07' LIMIT 1"` | knowledge_html_path 非空 | `evidence/kb-v3-v1-02-sqlite-row.txt` |
| **V1-05** | markdown 文件落盘 | `ls /Users/njx/njx-knowledge/knowledge/notes/2026-07-07/ 2>&1` | 至少 1 个 .md 文件 | `evidence/kb-v3-v1-03-md-file.txt` |
| **V1-06** | minimax-direct 真直连（不 alias m3-html） | `grep "phase1_minimax_direct_alias_to_m3_html" apps/server/src/index.ts` | **0 命中** | — |

**V1 PASS 标准**：V1-01 ~ V1-06 全绿。

### V2 · T5 cron 真跑（njx-knowledge-daily-organize / incremental / validate）

| # | checklist | 操作 | 期望 | 证据 |
|---|----------|------|------|------|
| **V2-01** | 3 个 cron 已创建 | `mavis cron list \| grep "njx-knowledge"` | 3 个 v3-njx-knowledge-* 命中 | — |
| **V2-02** | daily-organize dry-run exit 0 | `mavis cron run v3-njx-knowledge-daily-organize --dry-run` | exit 0 + 3 步（daily_consolidate / ingest_raw / validate_note）全 OK | `evidence/kb-v3-v2-01-dryrun.log` |
| **V2-03** | daily-organize 实跑 exit 0 | `mavis cron enable v3-njx-knowledge-daily-organize && mavis cron run ...` | exit 0 + 至少 1 个 note 被 apply（不是 dry-run） | `evidence/kb-v3-v2-02-realrun.log` |
| **V2-04** | incremental 实跑 exit 0 | 同上 | exit 0 | `evidence/kb-v3-v2-03-incremental.log` |
| **V2-05** | validate 实跑 exit 0 | 同上 | exit 0 | `evidence/kb-v3-v2-04-validate.log` |
| **V2-06** | 实跑后回滚 enabled=false | `mavis cron disable v3-njx-knowledge-{daily-organize,incremental,validate}` | 全 disabled | `evidence/kb-v3-v2-05-disabled.txt` |
| **V2-07** | 实跑报告写 RESULT | 报告写入 `/Users/njx/openclaw/copilot/evidence/kb-v3-v2-report.md` | 存在 + 3 cron PASS | `evidence/kb-v3-v2-report.md` |

**V2 PASS 标准**：V2-01 ~ V2-07 全绿。

**V2 关键反例（不能静默 skip）**：
- ❌ cron dry-run 静默 exit 0 但没真跑脚本 → FAIL，PM 修 cron message 让其必跑
- ❌ 实跑后没回滚 disabled → FAIL，PM 立即 disable
- ❌ 实跑 crash 但 cron 报 exit 0 → FAIL，PM 加 `--strict-exit-code` 检查

### V3 · T7 数据迁移完整性

| # | checklist | 操作 | 期望 | 证据 |
|---|----------|------|------|------|
| **V3-01** | 老路径存在 | `ls /Users/njx/openclaw_data/memory/knowledge/notes/` | 非空 | — |
| **V3-02** | 新路径存在 | `ls /Users/njx/njx-knowledge/knowledge/notes/` | 非空 | — |
| **V3-03** | diff -rq 老 vs 新 | `diff -rq 老 新` | 0 diff（除 .DS_Store）| `evidence/kb-v3-v3-01-diff.log` |
| **V3-04** | 老路径独有文件 = 0 | `comm -23 <(find 老 -type f \| sort) <(find 新 -type f \| sort)` | 0 行 | `evidence/kb-v3-v3-02-only-old.txt` |
| **V3-05** | 新路径 ≥ 老路径（迁移不能少） | `find 新 -type f \| wc -l >= find 老 -type f \| wc -l` | yes | `evidence/kb-v3-v3-03-counts.txt` |
| **V3-06** | V3-04 非空时手动 rsync 补迁 | `rsync -av 老/ 新/` | 全量同步 | `evidence/kb-v3-v3-04-rsync.log` |

**V3 PASS 标准**：V3-01 ~ V3-05 全绿；V3-06 仅在 V3-04 非空时需要。

### V4 · T8 UI 截图（Web + Mobile 闭环）

| # | checklist | 操作 | 期望 | 证据 |
|---|----------|------|------|------|
| **V4-01** | cu 接管 Mac 桌面 | `mavis mcp call cu desktop_screenshot '{}'` | 有响应 | — |
| **V4-02** | Web Add Note 弹窗含 minimax-direct 选项 + nkx 落点 | cu 打开 Web → Knowledge → Add Note | 弹窗含 `qualityMode: minimax-direct` + `nkx` 选项 | `evidence/kb-v3-v4-01-web-addnote.png` |
| **V4-03** | Web chat @njx-knowledge 前缀支持 | cu 打开 Web → Assistant → chat | placeholder 含 `@njx-knowledge` + 5 知识源列表 | `evidence/kb-v3-v4-02-web-chat-prefix.png` |
| **V4-04** | Web 知识源状态卡 = 5 源（njx-knowledge / memory / wiki / nas / ima）| cu 打开 Web → KnowledgeSync | 5 源状态卡 | `evidence/kb-v3-v4-03-web-sources.png` |
| **V4-05** | Mobile CalendarScreen Switch + rawContent | `adb -s emulator-5554 exec-out screencap -p` after 新建日程 | EventEditor 可见 Switch + rawContent 入口 | `evidence/kb-v3-v4-04-mobile-eventeditor.png` |
| **V4-06** | Mobile 知识 tab 看到 V1 创建的 task | adb screencap 知识 tab | 列表中含 V1 创建的 task 笔记 | `evidence/kb-v3-v4-05-mobile-task-in-knowledge.png` |

**V4 PASS 标准**：V4-01 ~ V4-06 全绿（4-6 张截图齐 + 每张肉眼可看到对应 UI）。

### P1b 收口验收

- V1 PASS（response 含字段 + sqlite 非空 + markdown 落盘 + 0 alias 命中）
- V2 PASS（3 cron dry-run + 实跑全 exit 0 + 回滚 disabled）
- V3 PASS（0 diff / 0 老独有 / 新 ≥ 老）
- V4 PASS（4-6 张截图齐）
- 写 `/Users/njx/openclaw/copilot/evidence/kb-v3-p1b-receipt.md` 含 4 verify 的 evidence 链接

**任何 1 项 FAIL → 不进 P2a → raise NJX 决策**（continue / accept / rescope）。

---

## 3-NJX-REAL-VERIFY · NJX 域（真机验收 · v4 新增 · PM 写好 / NJX 填）

> **核心规则**：NJX 在 Mate60 真机上**重跑 47 项 checklist**，每项填 PASS/FAIL/DEGRADED + 备注 + 截图。**PM 不可代填**。
>
> **真机 vs emulator 差异重点（PM 标注）**：NJX 真机验收时**重点**查这 5 项 + 截图存档 `evidence/njx-real-*.png`：

| # | 真机差异点 | 为什么 | NJX 重点查什么 |
|---|----------|------|---------------|
| **R-01** | M1 后台录音 | 真机 EMUI 杀后台严格 | 跨 tab 浮动条是否被 EMUI 杀掉 / 重启 app 后录音是否恢复 |
| **R-02** | M2 真麦 ASR | emulator 用 host mic / 真机用真麦物理收音 | 转写准确率、方言支持、噪声环境 |
| **R-03** | M5 通知 | 真机 Doze / AppStandby | 5min 后提醒是否准时 / 杀后台后通知是否漏发 |
| **R-04** | M6 离线 replay | 真机 wifi/cellular 切换 | 关 wifi → 开 cellular / 4G-5G 切换时同步是否正常 |
| **R-05** | 权限二次确认 | 真机华为系统级二次弹窗 | 录音权限 / 通知权限 / 存储权限第一次会卡在哪一步 |

**真机验收清单模板**（PM 写好，NJX 填反馈）：

位置：`/Users/njx/openclaw/copilot/evidence/njx-real-verify-checklist.md`

```markdown
# NJX 真机验收清单 v1.0

**APK**: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB)
**版本**: versionCode=9, versionName=1.0.8
**sha256**: <hash>
**APK built**: 2026-07-07 13:30 (commit <hash>)
**PM emulator 域**: ✅ 全绿 47/47（PM 已验）
**验收人**: NJX 物理
**验收时间**: ____
**真机**: 华为 Mate60 (Android 14)

## 真机 vs emulator 差异重点（5 项必查）
- [R-01] M1 后台录音（EMUI 杀后台）: ___ (PASS/FAIL/DEGRADED + 备注)
- [R-02] M2 真麦 ASR（真麦物理收音）: ___ (PASS/FAIL/DEGRADED + 备注)
- [R-03] M5 通知（Doze 模式）: ___ (PASS/FAIL/DEGRADED + 备注)
- [R-04] M6 离线 replay（wifi/cellular 切换）: ___ (PASS/FAIL/DEGRADED + 备注)
- [R-05] 权限二次确认（华为系统弹窗）: ___ (PASS/FAIL/DEGRADED + 备注)

## 47 项 checklist 真机重跑
（详见 §3-PM-CU-VERIFY 47 项表，NJX 把 emulator 验收改为真机验收）
- M1 Capture (10 项): ___ (X/10 PASS)
- M2 Local ASR (8 项): ___ (X/8 PASS)
- M3 Auto-organize (6 项): ___ (X/6 PASS)
- M4 AI Decision (5 项): ___ (X/5 PASS)
- M5 Schedule/Task (8 项): ___ (X/8 PASS)
- M6 Sync (6 项): ___ (X/6 PASS)
- 启动检查 (4 项): ___ (X/4 PASS)
- **合计**: ___ (X/47 PASS)

## NJX 整体反馈
- 任何 C1/C2 FAIL → PM 立即修 + 重打 → 复验
- 仅 C3 cosmetic 可计入 backlog 不阻塞 P3 收口
- NJX 签字: ____ 日期: ____
```

**PM 不代填这条清单**。NJX 跑完后 `mavis communication send --to $PM_SESSION` 发反馈。

---

## 4. R19B 验收特别项（PM emulator 域独立 verify · P2a 进入前必跑）

PM 独立 verify（R19B 写完后才能进 P2a）：

| 验证项 | 命令 | 标准 |
|--------|------|------|
| sherpaOnnxEngine 切换 | `rg "createStreamingSTT\|zipformer2_ctc" apps/mobile/src/lib/engines/sherpaOnnxEngine.ts` | 命中 |
| wavDecoder 新文件 | `ls apps/mobile/src/lib/engines/wavDecoder.ts` | 存在 + 4-6KB |
| diff scope | `git diff HEAD~1 apps/mobile/src/lib/engines/sherpaOnnxEngine.ts` | 仅 1 文件 |
| 无 base64 roundtrip | `rg "atob\|btoa\|base64" apps/mobile/src/lib/engines/wavDecoder.ts` | 0 命中 |
| 16-bit mono PCM | `rg "Int16Array\|Float32Array" apps/mobile/src/lib/engines/wavDecoder.ts` | 命中 |
| Hermes-safe TextDecoder | `rg 'TextDecoder\("utf-8"\)' apps/mobile/src/lib/engines/wavDecoder.ts` | 命中 |

**v4 修正**：这 6 项验证现在在 **emulator 域** 跑（不是真机），因为 wavDecoder 逻辑层跟真机/emulator 无关。但实际 ASR 端到端效果在真机域由 NJX 重跑 M2 系列验证。

---

## 5. PM 独立 verify 流程

### 5.1 触发

任何 sub-agent 报"完成" → PM / Verifier 立即启动独立 verify。

### 5.2 流程

1. 看 RESULT.md + EVIDENCE.md（不全 → BLOCKER）
2. 跑 changed-files.txt 提到的 verify 命令（exit 0）
3. 抽检 2-3 个关键文件（grep 命中）
4. **跑 PM cu 操作验收**（§3，本章核心）
5. 写 ACCEPTANCE_LOG.md（PASS/FAIL + timestamp + 模块 + 截图 hash）
6. 通知 NJX（PASS → 证据 + commit hash；FAIL → BLOCKER）

### 5.3 Verify 8 件套 checklist

```
□ 文件存在 (ls -la <path>)
□ mtime 新 (stat -f %m <path> ≥ recent)
□ size 合理 (wc -c <path> > 0 && < max)
□ 内容 grep (rg "<key>" <path> 命中)
□ 路径可访问 (绝对路径 /Users/njx/openclaw/copilot/...)
□ HTML cache-busting (?t=<ts> 或 no-cache meta)
□ 关键步骤截图齐 (ls evidence/p3-*.png ≥ 23 张)
□ checklist 全 PASS (47 项 全绿)
```

不达任一 → **BLOCKER**，不报 PASS。

---

## 6. BLOCKER 模板

```markdown
❌ BLOCKER — <phase> · <module> · <checklist_id>

**现象**: <截图 + 期望描述>
**实际**: <EVIDENCE 截图失败原因>
**期望（ACCEPTANCE 标准）**: <47 项中具体某项>
**最小修复 contract**: <退回 sub-agent / 自己修的指令>
**影响范围**: <是 1 项 FAIL 还是多模块 FAIL>
**PM 已操作**: <已经做的 steer / 还未操作>
**NJX 决策点（如 P1）**: <是否需要 NJX 拍板>
```

---

## 7. PASS 报告模板（v5 四域 · P1a + P1b + P2a + P2c）

```markdown
✅ PASS — <phase> · 全部 checklist（四域全绿）

**verdict**: PASS_P3_<V1-4>+<47_emulator>+<47_real>_<98_of_98>

**P1a (mobile stream commit 收口)**:
- 3 commits: <hash_A> <hash_B> <hash_C>
- typecheck: 3/3 exit 0
- stream 隔离: apps/server/src/index.ts knowledge 模块未改 ✓

**P1b (KB v3 stream V1-V4 验证)**:
- V1 T2 端到端: ✓ (response + sqlite + md 落盘)
- V2 T5 cron 真跑: ✓ (3 cron 实跑 + 回滚 disabled)
- V3 T7 迁移完整: ✓ (0 diff 老 vs 新)
- V4 T8 UI 截图: ✓ (5+ 张 web+mobile)
- evidence: evidence/kb-v3-p1b-receipt.md

**P2a (PM 域 emulator 端到端)**:
- 47 项 checklist: 47/47 PASS（emulator 域）
- 截图: 23+ 张 evidence/p2a-*.png
- emulator: pixel_6 API 33 ARM64

**P2b (真机交付)**:
- APK: /Users/njx/openclaw/copilot/openclaw-mate60.apk
- sha256: <hash>
- 真机验收清单: evidence/njx-real-verify-checklist.md

**P2c (NJX 域真机反馈循环)**:
- NJX 真机 47 项: 47/47 PASS
- 截图: evidence/njx-real-*.png
- NJX 签字: <NJX 物理>

**交付路径**:
- commits: /Users/njx/openclaw/copilot/.git
- APK: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB, sha256: <hash>)
- KB v3 receipt: /Users/njx/openclaw/copilot/evidence/kb-v3-p1b-receipt.md
- emulator 截图集: /Users/njx/openclaw/copilot/evidence/p2a-*.png
- NJX 真机验收清单: /Users/njx/openclaw/copilot/evidence/njx-real-verify-checklist.md

**NJX 拍板点**: <是否进入 Phase 2>
```

---

## 8. ACCEPTANCE_LOG.md 格式（v5 四域 + P1a/P1b 并行）

```markdown
# ACCEPTANCE_LOG — OpenClaw Mobile MVP Sprint（v5 四域）

## 2026-07-07 13:30 P1a mobile stream commit 收口

**verdict**: PASS_P1a_COMMIT_3_OF_3
**commit**: <hash_A> <hash_B> <hash_C>
**verify 8 件套**: 8/8 ✓
**stream 隔离**: apps/server/src/index.ts knowledge 模块未改 ✓
**NJX notified**: 2026-07-07 13:30

## 2026-07-07 14:30 P1b KB v3 stream V1-V4 验证

**verdict**: PASS_P1b_V4_OF_4
- V1 T2 端到端: ✓ (response 含字段 + sqlite 非空 + md 落盘)
- V2 T5 cron 真跑: ✓ (3 cron dry-run + 实跑 exit 0 + 回滚 disabled)
- V3 T7 迁移完整: ✓ (0 diff 老 vs 新)
- V4 T8 UI 截图: ✓ (5 张 web+mobile)
**evidence**: evidence/kb-v3-v{1,2,3,4}-* + kb-v3-p1b-receipt.md
**NJX notified**: 2026-07-07 14:30

## 2026-07-07 15:00 P1 gate 双绿

**verdict**: PASS_P1_GATE_DUAL_GREEN
- P1a: ✓
- P1b: ✓
- 进 P2a 决策: ✓

## 2026-07-07 18:00 P2a PM 域 emulator 端到端

**verdict**: PASS_P2a_47_OF_47 (emulator 域)
**全模块**: M1+M2+M3+M4+M5+M6 = 47/47 PASS
**截图**: 23+ 张在 evidence/p2a-*.png
**emulator**: pixel_6 API 33 ARM64

## 2026-07-07 18:30 P2b 真机交付

**verdict**: PASS_P2b_DELIVERY
**APK**: /Users/njx/openclaw/copilot/openclaw-mate60.apk (96MB, sha256=<hash>)
**真机验收清单**: evidence/njx-real-verify-checklist.md (PM 写好)
**NJX notified**: 2026-07-07 18:30

## 2026-07-07 19:30 P2c NJX 真机反馈循环 #1

**verdict**: PASS_P2c_NJX_47_OF_47 (真机域)
**C1 触发**: <如有>
**C2 触发**: <如有>
**C3 触发**: <如有>
**截图**: evidence/njx-real-*.png
**NJX 签字**: <NJX>

## 2026-07-07 20:00 P3 收口 + 通知（四域全绿）

**verdict**: PASS_P3_QUAD_GREEN
**P1a mobile stream**: 3 commit 全绿
**P1b KB v3 stream**: V1-V4 全绿
**P2a PM 域**: 47/47 (emulator)
**P2c NJX 域**: 47/47 (真机)
**C1/C2 全修完，C3 入 backlog**
**SPRINT_RECEIPT**: /Users/njx/openclaw/copilot/SPRINT_RECEIPT_v1.md
**NJX notified**: 2026-07-07 20:00
```

---

## 9. 当前 sprint 验收节奏（v5 · P1a + P1b 并行 · 四域全绿）

### P1a · mobile stream · commit 收口（与 P1b 并行）

- 3 commit + 3 typecheck 全 exit 0
- `git diff HEAD~3 --check` clean
- verify 8 件套第 1-5 项
- **stream 隔离 verify** — `apps/server/src/index.ts` knowledge 模块没被改

### P1b · KB v3 stream · V1-V4 验证（与 P1a 并行）

- **V1 T2 端到端**（calendar create → njx-knowledge 同步）
- **V2 T5 cron 真跑**（3 cron dry-run + 实跑 + 回滚）
- **V3 T7 迁移完整性**（0 diff 老 vs 新）
- **V4 T8 UI 截图**（4-6 张 Web+Mobile 闭环）
- 任一 FAIL → 修 + 重跑

### P1 gate · P1a + P1b 双绿才进 P2a

- 双 stream 都全绿 → 推 P2a
- 任意一项 FAIL → raise NJX 决策（continue / accept / rescope）

### P2a · PM 域 emulator 端到端

- **47 项 checklist 全 PASS**（emulator 域，核心硬规则）
- **23+ 张关键步骤截图**存档 evidence/p2a-*.png
- verify 8 件套全 8 项
- 不允单条 FAIL 后继续
- emulator: pixel_6 API 33 ARM64
- **前置**：P1a + P1b 双绿

### P2b · 真机交付

- APK 落盘验证
- sha256 + versionCode 记录
- 真机验收清单模板写好 `evidence/njx-real-verify-checklist.md`
- 通知 NJX 物理 install

### P2c · NJX 域真机反馈循环（持续到 NJX 全绿）

- NJX 物理 install APK
- NJX 跑 47 项 checklist + 5 项差异重点
- NJX 反馈：PASS / C1 立即修 / C2 ≤4h 修 / C3 backlog
- 修完重打 APK → NJX 复验
- 循环直到 NJX 全绿（最多 3 轮后 raise NJX 决策）

### P3 · Sprint 收口（四域全绿才收口）

- P1a + P1b + P2a + P2b + P2c 全部 PASS
- 写 SPRINT_RECEIPT_v1.md（含四域证据 + KB v3 receipt）
- 通知 NJX
- 任何 C1/C2 真机 FAIL 未修完 → **不算 P3 收口**
- 任何 V1-V4 KB v3 verify FAIL 未修完 → **不算 P3 收口**

---

## 10. 不允许的验收方式（v3 → v4 → v5 升级禁令）

- ❌ 只看 sub-agent self-report 不 verify
- ❌ verify 只跑命令不看输出
- ❌ PASS 报无 evidence 链接
- ❌ FAIL 不给最小修复 contract 甩回
- ❌ cross-stream 改动混在 1 commit
- ❌ **emulator 通过就报真机 PASS**（v3 加 — 必须 NJX 物理真机 verify）
- ❌ **PM 假装 cu 接管真机**（v4 加 — cu 只能控 Mac 桌面）
- ❌ **PM 假装读真机 logcat**（v4 加 — PM 域只能读 emulator logcat）
- ❌ **PM 假装物理 install APK 到真机**（v4 加 — NJX 物理操作）
- ❌ **PM 代填 NJX 真机验收清单**（v4 加 — NJX 物理）
- ❌ **emulator 截图当真机 PASS 截图**（v4 加 — 必须分目录 p2a-* vs njx-real-*）
- ❌ **单条 checklist FAIL 后继续标 PASS**（v3 加）
- ❌ **截图只截前后 1 张**（v3 加 — 必须 23+ 张覆盖关键步骤）
- ❌ 把 degraded 状态标 OK
- ❌ **用 adb shell input keyevent 模拟真机用户**（v3 加 — emulator 域内 OK，但真机域 = NJX 物理）
- ❌ **P1a 绿但 P1b 红就推 P2a**（v5 加 — M3/M4/M5 在 emulator 是假通）
- ❌ **P1b V1-V4 任一 FAIL 跳过**（v5 加 — 4 verify 必跑全）
- ❌ **KB v3 verify 拿代码存在当 PASS**（v5 加 — 必须端到端跑）
- ❌ **V2 cron dry-run 静默 skip 假装 exit 0**（v5 加 — 实跑必跑）
- ❌ **V3 老路径有 diff 假装 0 差异**（v5 加 — 必须 rsync 补迁）
- ❌ **V4 截图缺元素假装 UI 闭环**（v5 加 — 每张肉眼可看到对应 UI）

## 11. NJX 物理 click 范围 vs PM ops 范围对照（v4 双域）

| 操作 | NJX | PM | 域 |
|------|-----|----|----|
| cu 接管 **Mac 桌面**（点击 / 输入 / 截图） | — | ✅ | PM |
| cu 接管 **真机屏幕** | ❌ 不可行 | ❌ 不可行 | — |
| adb 远端调试 **emulator** (`-s emulator-5554`) | — | ✅ | PM |
| adb 远端调试 **真机** (`-d`) | ✅ 物理 USB | ❌ 无物理连接 | NJX |
| adb 设备插拔 / 解锁 | ✅（物理 USB） | — | NJX |
| cu renderer toggle ON | ✅（1 click） | 提示 NJX 1 次 | NJX |
| OAuth / 2FA | ✅（物理 click） | — | NJX |
| macOS sudo / Accessibility 授权 | ✅（系统弹窗） | — | NJX |
| **Mate60 物理 install APK** | ✅（物理操作） | ❌ 不能 | NJX |
| **app 启动 / 输入 / 录音**（emulator 域） | — | ✅（cu 操作） | PM |
| **app 启动 / 输入 / 录音**（真机域） | ✅（物理触屏） | ❌ 不能 | NJX |
| **mic 物理收音**（emulator = host mac mic） | — | ✅（Mac 录） | PM |
| **mic 物理收音**（真机 = Mate60 真麦） | ✅（真人对 Mate60 说话） | ❌ 不能 | NJX |
| emulator 截图存档 | — | ✅（cu + adb screencap） | PM |
| **真机截图存档** | ✅（真机截图） | ❌ 不能 | NJX |
| 写 NJX 真机验收清单 | — | ✅（PM 写模板） | PM |
| 填 NJX 真机验收清单 | ✅（NJX 物理填） | ❌ 不代填 | NJX |
| **mavis communication send** ack 收 | — | ✅ | PM |
| 通知 NJX 验收结果 | — | ✅ | PM |

**核心判断**：
- ✅ PM 域 = Mac mini 桌面 + emulator（pixel_6 API 33 ARM64）
- ❌ PM 不能接管真机屏幕、装真机 APK、读真机 logcat、点真机 NFC
- ✅ NJX 域 = Mate60 真机 + 物理操作 + 填真机验收清单

---

*本文件由 Mavis（PM）于 2026-07-07 13:00 重写（v4 → v5，加 §0 三域分轨总览升级四域 + §3-KB-V3-VERIFY V1-V4 完整 4 verify + §7/8/9/10 v5 升级 + stream 隔离 + KB v3 ops 边界 + V1-V4 必跑硬规则）。NJX 拍板后所有 P 必跑。*
