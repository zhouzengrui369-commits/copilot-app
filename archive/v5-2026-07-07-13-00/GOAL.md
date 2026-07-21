# OpenClaw Mobile 随身助理 · 项目目标 v5.0（2026-07-07 重置基线）

> PM: Mavis
> 创建: 2026-07-07 12:00 (UTC+8) v3.0
> v4.0 重置: 2026-07-07 12:30（NJX 拍"PM 不接管真机 install/USB/物理 ops" → 双域分轨）
> v5.0 重置: 2026-07-07 13:00（NJX 拍"KB v3 必在 P2 之前 + 与 P1 并行；先验证 KB v3 全部通过再推 P2a"）
> 路径: `/Users/njx/openclaw/copilot/GOAL.md`
> 配套: `PLAN.md` / `RULES.md` / `ACCEPTANCE.md`

---

## 一句话定位

> **OpenClaw Mobile = 用户的随身助理（第二大脑）：随时随地语音/文字记录 + 后台自动整理入库 + AI 辅助决策 + 日程任务管理。**

- 用户说一句话 / 打几个字 → 后台自动整理入库 → AI 帮你决策 / 提醒 / 串联日程。
- 当前开发机 = Mate60 真机（NJX 主力 Android）；后台 = OpenClaw Workbench server（Fastify @ 38888，已在跑）+ Mac mini。
- **不重复造轮子**：现有 mobile app 已经 13 个版本迭代（R4→R19B），DOM 单元 / 录音链路 / ASR 引擎 / Calendar / Knowledge / Capture 五界面 / QR pairing / 离线 ASR 模型都已存在，**基线不是从零写，是把已有功能收口 + 真机验证 + 缺什么补什么**。

---

## 当前主线（NJX 7/7 拍板）

| 战略点 | 决策 | 基线落地 |
|--------|------|---------|
| 主线产品 | **手机 app**（非 Workbench 控制台） | Phase 1 = mobile，desktop 控制台 Sprint 化 |
| 目标用户 | **先个人，再消费** | Phase 1 = NJX OPC 自用；Phase 2 = ToC |
| MVP 范围 | **完整 6 模块**（M1-M6 全有） | 录音/ASR/整理/决策/日程/同步 |
| AI 架构 | **以现有 app 为基础，不重复造轮子** | 不推倒重写；现有 R19B + R11-R18 链路是基础 |
| 隐私边界 | **以现在为基础，未来多选项** | Phase 1 现有；Phase 2 预留本地/加密云/信任云 |
| KB v3 关联性（v5 重写） | **KB v3 是主线先决条件** | P1b 与 P1a 并行，**KB v3 全验证通过后才推 P2a** |

### KB v3 与手机 app 主线的真实关联（v5 重写 · NJX 7/7 拍板）

KB v3 = `njx-knowledge` 本地知识库（`/Users/njx/njx-knowledge/`）的全面优化（minimax-direct 直连 / calendar 同步 / cron / 默认知识源 / 数据迁移 / Web+Mobile UI 闭环），T1-T8 共 8 项。7/2 REJECTED 时 "T1-T8 至少 6 项未做"。**7/7 实测已修复 5/8，剩 4 项需端到端 verify**。

**v5 战略拍板（NJX 7/7 13:00 反转）**：
- ❌ v4 写"KB v3 跟 mobile 几乎无关" = 错判
- ✅ v5 = KB v3 是 mobile MVP 6 模块的**后端依赖**：
  - M3 Auto-organize（5min 内入库）→ 走 `createKnowledgeNoteOrganizeJob` → 落 njx-knowledge
  - M4 AI Decision（"我下周要出差吗？"）→ 召回 sources 来自 njx-knowledge MOC + summaries
  - M5 Schedule/Task（创建 task 自动入库 knowledge）→ 走 calendar create → njx-knowledge 同步
- ✅ 如果 KB v3 没全验证通过就推 P2a emulator 端到端 → **M3/M4/M5 在 emulator 跑通也是假通**（后端没真直连 + 没真默认 + 没真迁移）
- ✅ 所以 P1b（KB v3 4 verify）必须**与 P1a 并行**，P1b 全绿才能进 P2a

**v5 阶段关系**（不是 v4 的"KB v3 后置"）：

| 阶段 | 范畴 | 关系 |
|------|------|------|
| **P1a** | mobile stream（commit 收口） | 与 P1b 并行 |
| **P1b** | KB v3 stream（V1-V4 验证） | 与 P1a 并行，**P2a 前必全绿** |
| **P2a** | mobile MVP 6 模块 emulator 端到端 | **依赖 P1b 全绿**（否则 M3/M4/M5 是假通） |

---

## Phase 1 · 个人 OPC 自用（当前 MVP）

- **目标用户**：NJX 本人（OPC 工作流 + 航材主业记录/决策辅助）
- **形态**：Mate60 真机 + 1 台 Mac mini server（Workbench @ 38888 持续在跑）
- **成功指标**（v5 升级）：
  - **P1b 全绿**：KB v3 V1-V4 4 项验证全过（T2 端到端 / T5 cron 真跑 / T7 迁移完整 / T8 UI 闭环）
  - **PM 域**：emulator 端到端 M1-M6 全 6 模块跑通（47 项 checklist + 23+ 截图全 PASS）
  - **NJX 域**：真机 install + 全功能验收（NJX 物理执行，按 PM 写的真机验收清单，PM 修复 → 循环到全绿）
  - NJX 日活记录 ≥3 次 / 决策命中率 ≥70% / 日程完成率 ≥80%
  - **P1b + PM 域 + NJX 域 三域全绿才交付**（NJX 7/7 拍）

## Phase 2 · ToC 消费化（backlog）

- iOS + Android（保留 Expo）+ AppGallery / App Store
- 隐私 3 选项（纯本地 / 本地+加密云 / 信任云）
- 商业模式：免费 + Pro 订阅（云端 AI 整理 + 多设备同步）

---

## MVP 6 大功能模块（M1-M6 = 既有代码已覆盖大部分）

### 6 模块 vs 现有 mobile 4 tab 现状对照（不造轮子核心依据）

| # | 模块 | 现有 mobile 4 tab 对应 | 现有代码 | 缺口 | MVP 验收 anchor |
|---|------|----------------------|---------|------|----------------|
| **M1** | Capture | `记录` tab + RecorderWorkspace + CaptureScreen | `apps/mobile/src/components/RecorderWorkspace.tsx` (656 行) + `screens/CaptureScreen.tsx` (22KB) + `App.tsx` 浮动条 + ChatPanel | 已有录音+转写+文字入库；缺：长按→快速录音 / 图片附件 / 后台被系统杀不死 | 真机长按录音 → 录 1min → 文字落盘 + 浮动条跨 tab 可见 |
| **M2** | Local ASR | (M1 内嵌) RecorderWorkspace + offlineAsr | `lib/offlineAsr.ts` (32KB) + `lib/engines/{sherpaOnnxEngine,whisperRnEngine}.ts` (28+10KB) + `wavDecoder.ts` (R19B 新建) + `engines/index.ts` | 已有 sherpa-onnx 流式 + whisper.rn + mac-fallback 兜底；R19B 已 EMULATOR_VERIFIED 但**未在 Mate60 真机 install** | 真机录音 → 端侧实时 < 5s 延迟显示 + 不依赖 mac 后端 |
| **M3** | Auto-organize | 录音结束后 → 通过 server API → 入库（现有 `apps/server/src/knowledge*`） | server `apps/server/src/index.ts` 已知 `knowledge/*` 端点 + autoOrganize flag（KB v3 留下的能力） | 已有路径；缺：5min 内的真正自动入库（不需要用户点保存）+ 摘要 + 标签 + 实体识别 | 真机录完 5min 内 → knowledge/<date>/*.md 自动出现 + Markdown 含摘要 |
| **M4** | AI Decision | 调用 server `/api/decision/*` + `/api/mobile/chat` | server `apps/server/src/index.ts:4906+` 已有 `minimax-direct` 路径（虽然被 alias 到 m3-html）+ chat API | 已有 API 路径；缺：决策可解释性（30s 内说清"基于哪些笔记/日程"） | "我下周要出差吗？" → 召回相关日程/笔记 + sources 显示 |
| **M5** | Schedule/Task | `日程` tab | `apps/mobile/src/screens/CalendarScreen.tsx` (1632 行) - 含 event/reminder/task 3 kind + 日/周视图 + 全 CRUD + Switch + rawContent 入口（Phase6 已加） | 已有 CRUD；缺：提醒推送后台唤醒（notification scheduling） + 任务自动入库 knowledge | 真机新增日程/任务 → 跨设备同步 + 提醒准时 |
| **M6** | Sync | QR pairing + CloudBase 公网 relay + 本地缓存 | `apps/mobile/src/lib/qrPairing.ts` (6.6KB) + `QRScanModal.tsx` (16KB) + CloudBase relay `https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay` | 已有 QR + 公网 relay；缺：本地 SQLite 写入（断网不丢） + 重连后自动 replay | 真机断网操作 → 上线后 sync；离线 0 数据丢失 |

**关键判断**：现有代码 80% 已覆盖 MVP 6 模块，**主线不是开发新功能，是把现有功能在 Mate60 真机上一项项验证通过**。这就是"不重复造轮子"。

---

## 不重复造轮子 — 硬清单

### 复用现有（不改）

| 资产 | 路径 | 状态 |
|------|------|------|
| **mobile app** | `apps/mobile/**` 13 个版本迭代（R4-R19B） | 现有 96MB APK = versionCode 9 / versionName 1.0.8 |
| **App 4 tab 骨架** | `apps/mobile/src/App.tsx` (627 行) | 记录/知识/日程/设备 4 tab + Shell 层 RecorderWorkspace 兜底 + 跨 tab 浮动条 |
| **OpenClaw Workbench server** | `apps/server/**` Fastify @ 38888 | 现有 server 已跑，mobile 调 `/api/mobile/calendar/*` `/api/knowledge/*` `/api/today/*` 等 |
| **OpenClaw Workbench web** | `apps/web/**` Vite @ 38889 | Workbench 控制台（Codex 五件套）— **不在 mobile 主线** |
| **OpenClaw desktop 包装** | `apps/desktop/**` Electron njx-copilot.app | Wraps web — **不在 mobile 主线**（mobile 不依赖 desktop） |
| **离线 ASR 模型** | `apps/mobile/assets/models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/` (26MB) | 已 bundled 进 APK |
| **knowledge 集成路径** | `apps/server/src/index.ts` knowledge 模块 + `apps/mobile/src/screens/KnowledgeScreen.tsx` (522 行) | 现有 vault 浏览 + Markdown 编辑 + HTML 阅读 |

### 不动（明确 out of scope）

- ❌ **不做新 sprint 文档 / 新模型选型 / 新架构**（沿用 R19B + existing code）
- ❌ **不改 v3 笔记生成 pipeline**（kb_ingest.py / quality gate / lock — 已稳定）
- ❌ **不推倒 mobile 重写**（现有 R19B + capture / calendar / knowledge / pairing / offline ASR 是基础）
- ❌ **不重启 KB v3 任何项**（T1-T8 全部后置到 backlog）
- ❌ **不做 Sprint1/2 Codex 五件套**（NLU + session + computerUse harness + Verify tab — 已 DRAFT 化，不再追，PRIORITY = Phase 2 backlog）
- ❌ **不做 iOS**（仅 Android/Mate60 — Phase 1）
- ❌ **不做 Phase 2 ToC 商业化**（订阅 / 多用户 / RBAC / 多模态 — 全部 backlog）

### 加什么（基于缺口）

| 缺口 | 加的位置 | 用什么方式 |
|------|---------|----------|
| Mate60 真机 install | 现有 `openclaw-mate60.apk` (96MB) | adb install -r，真机跑现有 APK，不改 |
| 后台录音不被杀 | AppDelegate / AndroidManifest foreground service | 现有代码已有 micro config，PM 验收时观察 |
| 录音 5min 内真自动入库 | server `/api/mobile/calendar/create?autoOrganize=true` + 后台 job | 现有 API 路径已通，PM 真机验证 |
| 决策可解释性 | server chat API 返回 sources 字段 | 不改 server API schema，只验 NJX 截图能看到 |
| 本地 SQLite 写入 | mobile `apps/mobile/src/lib/storage.ts` (10KB) 已有 | 验证断网操作 replay |
| 后台整理 5min 内 | server `createKnowledgeNoteOrganizeJob` 后台 queue 已有 | 验证 NJX 真机时间窗 |

---

## 永远不做（铁律）

- ❌ 不 fake OK（Coder self-report PM 不接受）
- ❌ 不绕过 NJX 拍板做战略转向
- ❌ 不在 cron loop 里连续 fire 0-evidence tick
- ❌ 不在 PROMPT 一次完整写 MVP（分 stream 推进）
- ❌ 不允许任何单条 checklist FAIL 后继续标 PASS
- ❌ 不把 emulator 通过当真机 PASS（emulator 跑通后 NJX 必走真机 verify）
- ❌ **不接管真机物理 ops**（USB 插拔 / 锁屏 / 解锁 / 触屏 / 真麦物理收音 / 系统弹窗 = NJX 域）
- ❌ **不假装 cu 能接管真机屏幕**（cu = Mac mini 桌面控制，**无法**控制 Android 设备屏幕）
- ❌ 不单方升级 dev/staging/prod env（NJX 显式授权）
- ❌ **不在 KB v3 V1-V4 任意一项未通过时进 P2a**（v5 加）
- ❌ **不让 mobile stream 改 njx-knowledge 仓库 / KB cron / KB skill**（v5 stream 隔离）
- ❌ **不让 KB stream 改 apps/mobile/** （v5 stream 隔离）

---

## 当前 sprint 边界（NJX 7/7 拍 v5 · 🅰 + 🅰 + KB v3 上主线）

| 在内 ✅ | 在外 ❌ |
|---------|---------|
| **P1a mobile stream**（R19B / add-note rework / mobile misc 3 commit） | chat-agent / aog-copilot / autonomy-core / system-ops |
| **P1b KB v3 stream**（V1-V4 4 verify — 与 P1a 并行） | Sprint1/2 Codex 五件套 |
| mobile MVP 6 模块（基于现有代码收口） | iOS / 订阅 / 多设备（Phase 2 ToC） |
| Mate60 真机 install + 录屏 + logcat + UI dump（NJX 物理） | 鸿蒙 AGC |
| 全部 checklist PASS 才算交付（NJX 硬要求） |  |
| verify 6 件套 + 关键步骤截图 |  |
| QA-验收用 PM cu 操作电脑 |  |
| KB v3 = 主线先决条件（v5 拍，非 backlog） |  |

---

## 依赖与上下游

- **上游**：
  - Coder session `mvs_740d51ac72054e17aeeeabb0eef97c7a` 已 finished（无 ack，工作落盘未 commit，需 PM 独立 verify）
  - R19B APK ready：`openclaw-mate60-r19-emulator-verified.apk` = `openclaw-mate60.apk` (96,840,577 bytes, versionCode=9, versionName=1.0.8)
- **下游（双域分轨 — v4 拍板）**：
  - **emulator 域（PM 全权）**：Mac mini 上的 Android emulator (pixel_6 API 33 ARM64) + adb shell 远端调试 + uiautomator dump
  - **真机域（NJX 全权）**：Mate60 真机 + 物理 USB 插拔 + 触屏 + 真麦物理录音 + 系统级弹窗
  - PM 用 `mavis mcp call cu desktop_*` 接管 NJX Mac mini 桌面（emulator 截图 + 键鼠模拟）+ `adb` 远端调试 emulator
  - **PM 不能**：接管真机屏幕、读真机 logcat、装真机 APK、点真机 NFC
  - OpenClaw Workbench server（Fastify @ 38888，已在跑，PM 不重写只验接口）
- **旁路 cron**：
  - 无 pending；`mavis watch-r19b-recovery` 已 self-cleanup
  - 12h heartbeat cron（异常才报 NJX）

---

## 给 NJX 的检查点（v5 · 双 stream 并行）

| 检查点 | 时间 | P1a mobile stream | P1b KB v3 stream | NJX 域（真机） |
|--------|------|------------------|------------------|---------------|
| P0 基线 v5 拍板 | 7/7 13:00 | NJX 拍 GOAL/PLAN/RULES/ACCEPTANCE v5（KB v3 上主线） | 同 | — |
| P1a + P1b 并行 | 7/7 13:30 - 16:00 | 3 commit + typecheck 全绿 | V1-V4 4 verify 全绿 | — |
| P1b gate | 7/7 16:00 | — | **全绿才进 P2a，否则 raise NJX** | — |
| P2a emulator 端到端验证 | 7/7 16:00 - 19:00 | 47 项 checklist + 23+ 截图全 PASS | — | — |
| P2b 真机交付 | 7/7 19:30 | PM 给 APK + 真机验收清单 | — | **NJX 物理 install + 跑真机验收清单** |
| P2c 真机反馈循环 | 7/7 20:00 起 | PM 修 + 重打 APK → 复验 | — | NJX 复跑 → 反馈 → 循环到全绿 |
| P3 Sprint 收口 + 通知 | 三域全绿后 | 写 SPRINT_RECEIPT_v1.md + 通知 NJX | — | — |

---

*本文件由 Mavis（PM）于 2026-07-07 13:00 重写（v4 → v5，KB v3 从 backlog 提到主线先决条件，关联性段重写，P1a + P1b 并行，P1b 全绿才进 P2a）。NJX 拍板后启动 P1a + P1b 双 stream。*
