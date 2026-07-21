# OpenClaw Mobile × Huawei Mate 60 — Goal Run

> 创建: 2026-06-18 16:44 by PM (mvs_3f011d25f2f940cd82c0ad5ef5996635)
> NJX 指令 (16:41): "安装在华为 mate60 上(软件版本 4.2.0.210),具备知识库管理和日程管理功能,同步 njx-copilot 知识库,日程,笔记等"

---

## 1. 目标 (Goal)

把 **njx-copilot** (知识库 + 日程 + 笔记) 推到 **Huawei Mate 60 (HarmonyOS 4.2.0.210)** 真机,3 个核心能力:

1. **知识库管理** — 浏览/读/编辑 njx-copilot vault 中的 markdown + html 笔记
2. **日程管理** — 浏览/新增/编辑今日日程,跟 Mac 工作台双向同步
3. **快速笔记** — 语音转文字 → 通过 "添加笔记" 入库 (markdown + html)

---

## 2. 当前阶段 (Current Stage)

**现状摸底 (PM 16:42 调研):**

| 项 | 状态 | 备注 |
|---|---|---|
| 现有 mobile app | OpenClaw Mobile v1.0.7 | RN 0.81.5 + Expo 54, 2 screens |
| 现有 screens | TodayConsoleScreen + DeviceScreen | iOS-first, Android 已配 |
| Android build 链路 | ✅ 已配 EAS | projectId `1cf237b9-...`, `eas.json` + `app.json` 完整 |
| 语音笔记 | ✅ 已实现 | `expo-audio` native + auto transcription |
| "添加笔记" 入库 | ✅ 已实现 | `voice-note-organize` API → 笔记 + 日程 |
| 同步 njx-copilot | ✅ 已实现 | `workbench bootstrap.mobile` 协议 |
| **Markdown/HTML 编辑器** | ❌ **缺失** | 无 RN markdown editor 组件 |
| **KB 文件树浏览** | ❌ **缺失** | 无 KnowledgeScreen |
| **日历视图** | ❌ **缺失** | 无 CalendarScreen, 只有 "calendar_notes" tab |
| HarmonyOS 工具链 | ❌ 缺失 | `hdc` not found, DevEco Studio 未装, Java Runtime missing |

**关键技术判断:**
- Mate 60 (HarmonyOS 4.2) 仍保留 **Android 兼容层** → APK 可装可跑
- HarmonyOS NEXT (5.0+) 才砍 Android 兼容层, Mate 60 4.2 不受影响
- 选项 B (Android APK) 是 3-5 天可上的路径

---

## 3. 下一步 (Next Step)

按选项 B 推进,3 阶段交付:

| 阶段 | 内容 | 时长 | 验收 |
|---|---|---|---|
| **Sprint 0** | KnowledgeScreen (KB 文件树 + 读 MD/HTML) | 1.5 天 | PM 模拟数据验收 |
| **Sprint 1** | NoteEditorScreen (markdown/html 编辑 + 保存) | 1.5 天 | PM 编辑后入库验证 |
| **Sprint 2** | CalendarScreen (日历 view + 新增/编辑) + App.tsx 改 4 tabs | 1 天 | PM 同步验证 + NJX 真机 |

**EAS build 触发节点**: Sprint 1 完成后 → Sprint 2 启动前, 一次性 build Android APK
**NJX 真机验收节点**: Sprint 2 完成 + APK 出包 → 给安装步骤 + 验收清单

---

## 4. Sub-agents (Agent 分配)

| 角色 | Session ID | 任务 |
|---|---|---|
| **PM (主)** | mvs_3f011d25f2f940cd82c0ad5ef5996635 | 拆任务 + 验收 + 给 NJX 安装步骤 + 决策 |
| **Coder T1** | mvs_741e1272473f43eca605263eb5d67b3f | Sprint 0/1/2 mobile app 编码 (复用现有 session) |
| **Workbench 后端** | TBD (fire on demand) | KB API (`/api/kb/list`, `/api/kb/read`, `/api/kb/write`) + Calendar API |
| **Verifier T7** | TBD (fire on demand) | 验收 mobile build + API contract |

**子智能体 SOP:**
- PM 给明确任务卡 (PRD + 验收清单 + 上下文包)
- Coder 完成后 PM 跑 verification (build + smoke test + 截图)
- 不合格 → 打回 Coder, 附明确修改要求
- NJX 真机验收 → 反馈 → PM 决策 (改 / 收)

---

## 5. 上下文包 (Context Package)

**给 Coder T1 的上下文:**
```
- 现有 mobile app: /Users/njx/openclaw_data/openclaw_workbench/apps/mobile/
- 现有 screens: src/screens/{TodayConsoleScreen,DeviceScreen}.tsx
- 现有 lib: src/lib/{api,storage,types}.ts
- 现有 API 端点: bootstrap.mobile, today, voice-notes, voice-note-organize, pair
- 现有 constants: src/constants/design.ts (Color/Space/Type/Motion/Radius)
- 设计 token: openclaw teal (#0F766E / #0D5C56)
- 目标用户: NJX 个人, ToB 数智化背景
- 平台: Huawei Mate 60 HarmonyOS 4.2.0.210 (Android 兼容层)
```

**给 NJX 的设备上下文:**
- Mate 60: HarmonyOS 4.2.0.210
- 安装方式: 通过 EAS 出 Android APK, sideload 安装 (非应用市场)
- 网络: 跟 Mac mini 同一 Wi-Fi (LAN IP) 或 Cloudflare Tunnel (外网)

---

## 6. 工具健康 (Tool Health)

| 工具 | 状态 | 备注 |
|---|---|---|
| Node + pnpm | ✅ OK | `npm run mobile:android:preview` 可跑 |
| EAS CLI | ✅ OK | projectId 已配 |
| Expo SDK 54 | ✅ OK | RN 0.81.5 兼容 |
| Android build local | ⚠️ 未 verify | `mobile:android:preview:local` 需装 JDK + Android SDK |
| EAS cloud build | ✅ OK | 推荐路径, 不需本地 SDK |
| **DevEco Studio (HarmonyOS)** | ❌ 缺 | 选项 A 才需要 |
| **hdc (HarmonyOS device)** | ❌ 缺 | 选项 A 才需要 |
| **JDK 17** | ❌ 缺 | 当前 `java -version` 报 "Unable to locate a Java Runtime" |
| **Android SDK** | ❌ 缺 | 当前 `~/Library/Android/sdk` 不存在 |
| Mac mini EAS 凭证 | ⚠️ 待 verify | EAS login 状态未知 |

**关键风险:** 如果 EAS cloud build 失败 (凭证 / 配额), 需本地装 JDK + Android SDK (0.5-1 天)

---

## 7. 产出 (Deliverables)

| 阶段 | Deliverable | 路径 |
|---|---|---|
| Sprint 0 | KnowledgeScreen.tsx + API 端点 | apps/mobile/src/screens/, workbench src/api/ |
| Sprint 1 | NoteEditorScreen.tsx + 保存 API | apps/mobile/src/screens/, workbench src/api/ |
| Sprint 2 | CalendarScreen.tsx + App.tsx 改 4 tabs + Calendar API | apps/mobile/src/, workbench src/api/ |
| EAS build | Android APK (signed, install-ready) | EAS dashboard 下载链接 |
| 文档 | 安装步骤 + 验收清单 | /Users/njx/openclaw/copilot/openclaw-mobile-mate60-install.md |
| 验收报告 | PM 验收 + NJX 真机反馈 | /Users/njx/openclaw/copilot/openclaw-mobile-mate60-acceptance.md |

---

## 8. 验收 (Acceptance)

**PM 验收硬指标 (每个 Sprint 结束):**
1. `npm run test:mobile-release` 全过
2. `npm run build` (tsc --noEmit) 0 error
3. 新 screen 截图 ≥ 3 张 (冷启 / 操作 / 保存后)
4. API 端点 curl 200 + JSON 验证
5. Android EAS build 成功 (download link 给 NJX)

**NJX 真机验收硬指标 (Sprint 2 完成后):**
1. APK sideload 安装成功, app 启动无 crash
2. 配对流程: 输入 Workbench URL + 6 位码 → 设备进入 "已配对" 状态
3. 知识库 tab: 列出 vault 根目录文件 ≥ 3 个, 点开能读 markdown
4. 编辑器: 修改 markdown → 保存 → 重新打开看到修改
5. 日历 tab: 显示今日日程 (跟 Mac today console 一致)
6. 语音笔记: 录音 10 秒 → 自动转写 → "添加笔记" 入库 → 笔记列表出现
7. 离线模式: 拔网后, 笔记列表仍可读 (read-only cache)
8. 重启 app: 数据保留 (无丢失)

---

## 9. 决策点 (PM 推荐 + 备选)

### ⭐ PM 推荐: 选项 B (Android APK via Expo)

**理由:**
- 现有 OpenClaw Mobile v1.0.7 已支持 Android build (EAS + 配置完整)
- 复用 100% RN 代码 + Expo 54 + expo-audio
- Mate 60 4.2 Android 兼容层支持 APK
- 3-5 天可上, 不需搭 HarmonyOS 工具链 (Mac 全缺)
- 3 个新 screens (KB / Editor / Calendar) 是增量开发, 风险可控

**已知 trade-off:**
- 不是原生 HarmonyOS 体验 (无 ArkUI 流畅度)
- 后续 HarmonyOS NEXT 5.0 砍 Android 兼容层时需迁移
- EAS cloud build 需网络 + 凭证 (备选本地 build 需装 JDK + Android SDK)

### 备选 A: HarmonyOS NEXT 原生 (ArkTS)

**适用场景:** 长期投入, 鸿蒙生态主战场
**时间:** 3-4 周 (搭环境 + 重写 + 调试)
**前置:** 装 DevEco Studio + HarmonyOS SDK + 华为开发者账号 + Mate 60 USB 调试
**优点:** 平台原生体验 + 鸿蒙生态能力 (分布式 / 原子化服务)
**缺点:** 不能复用 RN 代码, 全部重写

### 备选 C: Tauri / Capacitor 套壳

**适用场景:** 极简 demo, 不追求体验
**时间:** 1 周
**优点:** 复用 web 端代码
**缺点:** 体验最差, 不推荐 (mobile app 不是 web 页面)

---

## 10. 给 NJX 的安装步骤 + 验收清单 (草稿)

**Sprint 2 完成后, 文档写到:** `/Users/njx/openclaw/copilot/openclaw-mobile-mate60-install.md`

包含:
1. APK 下载链接 (EAS dashboard)
2. Mate 60 sideload 安装步骤 (设置 → 安全 → 允许未知来源安装)
3. 配对流程 (Workbench URL + 6 位码)
4. 验收清单 (8 项硬指标)
5. 反馈渠道 (回 PM 这个 session 或 飞书)

---

## 11. 暂停项 (Standby)

NJX 16:41 给新目标 → 之前 v6 cron / mobile-t1-t4-watch cron 已 **disable** (NJX 嫌重复 + 该停就停):
- `mavis cron disable mavis v6-tick-2m` ✅
- `mavis cron disable mavis mobile-t1-t4-watch` ✅
- `openclaw-mobile-cloudbase-5min` 保留 (broker health check, 跟新目标相关)

T1 v6 iOS sprint 状态: **standby 维持** (NJX 没拍板 fire cycle 5 worker)
T1 自主 5min cadence loop: 已自停 (NJX 16:41 scope shift 后 T1 会自己判断)

---

**等 NJX 拍板:**
1. 选 B / A / C ?
2. 接受 3-5 天时间线 ?
3. 接受 EAS cloud build (vs 本地 build) ?

NJX 拍板后, PM fire Coder T1 + Workbench 后端 worker, 启动 Sprint 0.