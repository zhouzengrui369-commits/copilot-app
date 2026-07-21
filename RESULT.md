# RESULT — 知识库管理全面优化 v3 起点（**返工 v2 验收不通过，撤回完成判定**）

上一版把"Phase5-7 任务计划"误当成"附件 T1-T8 全部需求"宣告完成。附件中 T1-T8 大多数项未真正落地：

## 路径前置问题（待 NJX 确认）

| 路径 | 状态 |
|---|---|
| `/Users/njx/njx-knowledge`（无空格） | 存在，目录 11 项；`knowledge/` 子目录基本为空（仅有 `.mavis/plans`） |
| `/Users/njx/njx- knowledge`（含空格） | 存在，**空目录**，建于 Jul 2 17:07 |

附件里写的 `/Users/njx/njx- knowledge` 是笔误还是另有所指？需要 NJX 先确认目标根路径，本任务所有 v3 改动的写目标以此为准。

## T1-T8 真实缺口（按 NJX 验收口径）

| 编号 | 项 | 真实状态 | 证据 |
|---|---|---|---|
| T1 | **minimax-direct 真直连** | ❌ 未生效 | `apps/server/src/index.ts:4906-4909` 把 `minimax-direct` 归一化为 `m3-html`，alias 原因 `phase1_minimax_direct_alias_to_m3_html`；直连分支基本走不到。API key/baseUrl 也未按附件 `model_configs.apiKeyRef` + `https://api.minimax.chat/v1` 配齐（`rg "minimax|apiKeyRef|api.minimax.chat"` 在 connectors/ 0 命中） |
| T2 | **calendar create → njx-knowledge 同步 + html_path 回填** | ❌ 未闭环 | Phase5 patch 后 `autoOrganize=true` 走 `createKnowledgeNoteOrganizeJob`（后台队列），**不是同步写 njx-knowledge**；响应只有 `organizeJob` 占位，没有 `html_path` / `organized_at` / `markdown_path` 回填字段（这些字段只在 job 完成后才出现） |
| T3 | **字典校验 validate_terms.py --apply 改写 Markdown** | ❌ 未执行 | `/Users/njx/njx-knowledge/scripts/validate_terms.py` 已存在，但是**只读校验器**（输出 CANONICAL/VIA_ALIAS/WARNING/SUGGESTION/UNKNOWN），**无 `--apply` 选项**，不能改写 Markdown 原文。RIFD → RFID 类纠错无任何路径落盘 |
| T4 | **njx-knowledge-organize skill (organize_note.py / ingest_raw.py / daily_consolidate.py / validate_note.py)** | ❌ 未落地 | `~/.openclaw/skills/njx-knowledge-organize/` 不存在；`/Users/njx/njx-knowledge/scripts/{organize,ingest_raw,daily_consolidate,validate_note}.py` 全部缺失 |
| T5 | **新 cron (njx-knowledge-daily-organize / incremental / validate)** | ❌ 未创建 | `~/.openclaw/cron/jobs.json` 中 `njx-knowledge*` cron 0 命中；现有仍是旧的 mirror job |
| T6 | **njx-knowledge 作 Copilot 默认知识源** | ❌ 未切换 | `apps/server/src/index.ts:26772` 白名单 `["all", "memory", "wiki", "nas", "ima"]`，**没有 njx-knowledge**；`apps/web/src/App.tsx:14622,15102` chat 输入仍是 `@all/@memory/@wiki/@nas/@ima`，没有 `@njx-knowledge`；默认 knowledgeSources 没有 `["njx-knowledge"]` 形态 |
| T7 | **数据迁移** | ❌ 未完成 | 老路径 `/Users/njx/openclaw_data/memory/knowledge/notes/` 有 daily/calendar/voice_raw/mobile_audio/openclaw/worker_runs 笔记；新路径 `/Users/njx/njx-knowledge/knowledge/` 基本为空；copilot-note-mirror skill 默认路径已切换但无首次 rsync/migrate |
| T8 | **Web/Mobile UI 全闭环** | ⚠️ 部分 | Mobile: CalendarScreen.EventEditor 加了 Switch + rawContent 入口（OK）；Web: Assistant 页日程分支加了 opt-in checkbox（OK）；**Web Add Note 弹窗 minimax-direct 选项 + Web knowledge 页面 quick-note 入口 + T2 html_path 实时回显**均未做 |

## 已确认（Phase 5-7 真实成果，不撤）

- ✅ `apps/server/src/index.ts` `/api/mobile/calendar/create` 接受 `rawContent/autoOrganize/...` 字段
- ✅ 旧 payload `{ok:true,event}` 形态保留
- ✅ `apps/mobile/src/lib/{api,types}.ts` 类型扩展
- ✅ Mobile `CalendarScreen.EventEditor` 用户可见 Switch + rawContent 入口
- ✅ Web `Assistant` 日程分支 opt-in UI
- ✅ `copilot-note-mirror` skill 默认路径改到 `/Users/njx/njx-knowledge/knowledge/notes`，保留 `COPILOT_NOTES_SRC` env 覆盖；`_common.py` / `SKILL.md` / `mirror_knowledge.py` docstring 全部对齐
- ✅ 三个 workspace `npm run check` 全绿
- ✅ `git diff --check` 干净

但**以上只是 Phase5-7 范围**，附件 T1-T8 的核心闭环（minimax-direct 真直连 / calendar create 同步写 njx-knowledge / 默认知识源切换 / 数据迁移）**未做**。

## 下一步（按 NJX 指示退回开发线程）

不擅自开工 T1-T8。先把任务交回开发线程，由开发线程按附件 T1-T8 逐条实现，每条带：
1. 目标 / 范围 / 边界
2. 必跑命令 / 验收命令
3. 落地证据（命令输出 + diff + 行为验证）
4. 失败兜底与回滚路径

开发线程交付后，本验收线程再做端到端的功能闭环验收。

## 状态

**未完成，不可验收**。附件 T1-T8 至少 6 项未实现，2 项部分实现。
