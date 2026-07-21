# EVIDENCE — 知识库管理全面优化 v3（**返工 v2 验收不通过证据**）

## 1. 路径核查证据

```
$ ls -la "/Users/njx/njx- knowledge"
total 0
drwxr-xr-x@   2 njx  staff    64 Jul  2 17:07 .
drwxr---+ 125 njx  staff  4000 Jul  2 20:21 ..

$ ls -la /Users/njx/njx-knowledge
drwxr-xr-x@  11 njx  staff   352 Jul  2 10:44 .
# 11 项目录文件，含 SCHEMA.md, scripts/, raw/, logs/, knowledge/

$ ls /Users/njx/njx-knowledge/knowledge/
(empty - 只有 .mavis/plans)
```

**结论**：附件里的 `/Users/njx/njx- knowledge`（含空格）存在但是个 Jul 2 17:07 新建的空目录，几乎肯定是笔误或中间产物。真实路径是 `/Users/njx/njx-knowledge`。需要 NJX 确认目标根路径再开工。

## 2. T1 minimax-direct 未生效证据

```
$ rg -n "minimax-direct" apps/server/src/index.ts | head -5
4906:  if (requested === "minimax-direct") {
4907:    return { requested, effective: "m3-html", aliasReason: "phase1_minimax_direct_alias_to_m3_html" };
4908:  }

$ rg -n "apiKeyRef|api.minimax.chat|model_configs" apps/server/src/connectors/ apps/server/src/config.ts
(no matches)
```

**结论**：minimax-direct 在 `normalizeKnowledgeNoteQualityMode` 被强制 alias 为 m3-html，aliasReason 写明是 Phase 1 v1 留下的过渡。connectors/ 下也找不到任何 `model_configs.apiKeyRef` 或 `api.minimax.chat` 的真实直连实现。

## 3. T2 calendar create 同步写 njx-knowledge 未闭环证据

```
$ rg -n "createKnowledgeNoteOrganizeJob|knowledgeNoteOrganizeQueue" apps/server/src/index.ts | head -5
4602:  const { job, reused } = createKnowledgeNoteOrganizeJob(body);
1148:  if (autoOrganize) {
1169:    organizeJob = publicKnowledgeNoteOrganizeJob(created.job);
```

**结论**：当前 `/api/mobile/calendar/create?autoOrganize=true` 走 `createKnowledgeNoteOrganizeJob`（即后台 job queue），不是同步写 njx-knowledge；响应只有 organizeJob 占位，没有 html_path / organized_at / markdown_path 回填。

## 4. T3 validate_terms.py 无 --apply 证据

```
$ head -50 /Users/njx/njx-knowledge/scripts/validate_terms.py
"""
validate_terms.py — 知识库字典校验工具
...
  典型用法：
    python3 scripts/validate_terms.py "RFID"
    python3 scripts/validate_terms.py "RIFD"
...
"""
# 文件内部是只读校验（CANONICAL/VIA_ALIAS/WARNING/SUGGESTION/UNKNOWN 4 档判定）
# 无任何写入 / 改写 Markdown 的代码路径
```

**结论**：validate_terms.py 是**只读校验器**，未实现 `--apply` 选项或类似改写机制。RIFD → RFID 类纠错无法落盘。

## 5. T4 njx-knowledge-organize skill 未落地证据

```
$ ls ~/.openclaw/skills/njx-knowledge-organize/
(no such file or directory)

$ ls /Users/njx/njx-knowledge/scripts/
# 实际存在的脚本（部分）
validate_terms.py
build_topology.py
clean_manifest.py
dedup.py
extract_text.py
scan_raw.py
# 缺失的脚本（NJX 验收要求）
# organize_note.py
# ingest_raw.py
# daily_consolidate.py
# validate_note.py
```

**结论**：skill 目录和 4 个关键脚本全部缺失。

## 6. T5 新 cron 未创建证据

```
$ rg -n "njx-knowledge" ~/.openclaw/cron/jobs.json
(no matches)

$ rg -n "njx-knowledge-daily-organize|njx-knowledge-incremental|njx-knowledge-validate" ~/.openclaw/cron/jobs.json
(no matches)
```

**结论**：jobs.json 中无任何 njx-knowledge 命名空间 cron，现有仍是旧的 mirror job。

## 7. T6 njx-knowledge 默认知识源未切换证据

```
$ rg -n "allowed.*knowledgeSources|knowledgeSources.*allowed" apps/server/src/index.ts
26772:  const allowed = new Set(["all", "memory", "wiki", "nas", "ima"]);

$ rg -n "@(all|memory|wiki|nas|ima|njx-knowledge)" apps/web/src/App.tsx
4232:              placeholder={backendUnavailable ? "..." : "输入消息，使用 @all/@memory/@wiki/@nas/@ima 或 @skill 选择上下文..."}
14622:  const cleanQuery = query.replace(/@(all|memory|wiki|nas|ima)/g, "").trim();
15102:    const searchText = rawQuery.replace(/@(all|memory|wiki|nas|ima)/g, "").trim();
```

**结论**：
- 服务端 knowledgeSources 白名单不含 `njx-knowledge`
- Web 端 chat 输入占位 / 解析正则仍只认 `@all/@memory/@wiki/@nas/@ima`
- 默认 knowledgeSources 没有 `["njx-knowledge"]` 形态

## 8. T7 数据迁移未完成证据

```
$ ls /Users/njx/openclaw_data/memory/knowledge/notes/
calendar  daily  mobile_audio  mobile_audio_chunks  nas  openclaw  voice_raw  worker_runs
# 老路径有大量笔记

$ ls /Users/njx/njx-knowledge/knowledge/
(empty)
```

**结论**：老路径仍有笔记，新路径空。Phase7 切换的只是 mirror skill 的默认源指向，没有首次迁移（rsync / organize）执行。

## 9. T8 Web/Mobile UI 闭环证据

| 子项 | 状态 | 证据 |
|---|---|---|
| Mobile CalendarScreen.EventEditor Switch + rawContent 入口 | ✅ | apps/mobile/src/screens/CalendarScreen.tsx:1138-1180 |
| Web Assistant 日程分支 opt-in checkbox + rawContent | ✅ | apps/web/src/App.tsx:16985-17020 |
| Web Add Note 弹窗 minimax-direct 选项 | ❌ | 未实现（应可在 Web 知识页面或 chat 输入处选 qualityMode） |
| Web knowledge 页面 quick-note 入口 | ❌ | 未实现（计划说"不改知识库主页面布局"，但 NJX 验收要求补） |
| T2 html_path / organized_at 实时回显 | ❌ | 未实现（T2 没做，自然没回显） |

## 已确认（Phase 5-7 真实成果）

```
$ npm run check --workspace @openclaw-workbench/server  → 0 errors
$ npm run check --workspace @openclaw-workbench/web    → 0 errors
$ npm run check --workspace @openclaw-workbench/mobile → 0 errors
$ git diff --check                                    → clean
$ rg -n "WORKSPACE_DIR/memory/knowledge/notes" /Users/njx/.openclaw/skills/copilot-note-mirror/  → 0 命中
$ rg -n "njx-knowledge/knowledge/notes" /Users/njx/.openclaw/skills/copilot-note-mirror/scripts/_common.py
19:# Phase7 v2: default moved to /Users/njx/njx-knowledge/knowledge/notes
23:    or "/Users/njx/njx-knowledge/knowledge/notes"
```

## 状态

**未完成，不可验收**。附件 T1-T8 至少 6 项未实现，2 项部分实现。
