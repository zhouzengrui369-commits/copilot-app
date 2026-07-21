# v3.3 + v3.4 修复总结（2026-06-06）

**v3.3**：删 `validateKnowledgeNoteTopicCoverage` 硬门槛（v3 哲学贯彻）。
**v3.4**：修 `withGatewayCliLock` 锁残留 + start.sh 主动清锁（v3.3 验证时触发的下一个 bug）。

## 时间线

1. **9:00 v3.3 first try**：build + kill 41498 + start（PID 61881）
2. **9:08 v3.3 验证失败**：用户试昨日工作总结 → 8 分钟 `background_job_timeout_after_480000ms`（新 bug）
3. **9:18 v3.3 根因 2 排查**：m3 直调 42 秒 ok → 锁卡 → v3.4 设计
4. **9:18-9:25 v3.3 锁清掉后第一次 m3 organize 跑通**（6:11，ok=True）
5. **9:25-9:31 v3.3 第二次 m3 organize 跑通**（验证稳定性）
6. **9:37 v3.4 修代码**（`connectors/gateway.ts` + `start.sh`）
7. **9:38-9:44 v3.4 锁残留场景验证**：写 mtime 43 分钟前假锁 → curl organize → **5:34 跑通**（v3.4 stale unlink 250ms 内 retry 成功）

---

# v3.3 修复总结（2026-06-06）

## 背景

v3（"不限制模型输出"哲学）已经做了这些事：
- 删 profanity 强制 mask（保留真脏话"我操/卧槽"等强违规词）
- 拆 `low_source_overlap` 硬阈值
- 拆 `sectionHits >= N` section 数量硬约束
- 拆白名单 section 名
- 拆自动加"低信息密度/仅供参考"标签
- 拆置信度 / sourceCoverage 阈值阻断保存

**还漏掉一个** → 这次报错。

## 这次报错（2026-06-06 早晨）

```
Gateway/MiniMax 整理失败：Knowledge 添加笔记已经禁用本地 fallback；必须通过 Gateway/MiniMax 完成整理。
reason=gateway_quality_gate:insufficient_topic_coverage:AI 工具使用_产品开放式变革定革
```

用户的原文是一个"昨日工作总结"格式（带"AI 工具使用_产品开放式变革"等 title 词），LLM 返回的 markdown 用了同义表达，没硬塞原词，触发硬门槛。

## 根因

`apps/server/src/index.ts` line 6291 的 `validateKnowledgeNoteTopicCoverage`：

```ts
const expected = expectedKnowledgeNoteTopics(rawContent);  // 关键词匹配出 4-10 个 topic
const required = Math.min(6, Math.max(4, Math.ceil(expected.length * 0.68)));
if (covered.length >= required) return { ok: true, reason: "" };
return { ok: false, reason: `gateway_quality_gate:insufficient_topic_coverage:${...}` };
```

匹配规则是 `allExpectedKnowledgeNoteTopics`（line 6317）里的 10 个白名单 topic：
- 《浪潮将至》共读
- AI 工具使用
- Obsidian 与知识管理
- AI 项目推进
- 产品开发模式变革
- 编程成本趋近于零
- 马斯克与星际文明
- 芯片算力与能源竞争
- 共读活动调整
- 成本与模型配置

**问题**：原文只要命中 4+ 个 topic，markdown 必须覆盖 ≥ 6 个 preset 输出词（"AI 工具" / "PRD" / "马斯克" 等），LLM 用同义词立刻 fail。

**违反 v3 哲学**："不限制模型输出"——这是硬门槛，应该是反例。

## 修复

`apps/server/src/index.ts` line 6291：

```diff
 function validateKnowledgeNoteTopicCoverage(rawContent, draft, parsed) {
-  const expected = expectedKnowledgeNoteTopics(rawContent);
-  if (expected.length < 4) return { ok: true, reason: "" };
-  const coverageText = normalizeValidationText([...].join("\n"));
-  const covered = expected.filter((topic) => topic.outputTerms.some(...));
-  const required = Math.min(6, Math.max(4, Math.ceil(expected.length * 0.68)));
-  if (covered.length >= required) return { ok: true, reason: "" };
-  return { ok: false, reason: `gateway_quality_gate:insufficient_topic_coverage:${missing.join(",")}` };
+  // v3.3 修复：删 topic coverage 硬门槛。LLM 用同义词/重写时会触发"insufficient_topic_coverage"误杀。
+  // v3 哲学"不限制模型输出"——只留 XSS / HTML 完整性 + sourceHash 校验，其他全删。
+  return { ok: true, reason: "" };
 }
```

## v3.3 保留的硬校验

- ✅ XSS 防护（script / on* 注入检测）
- ✅ HTML 完整性（未配对标签检测）
- ✅ sourceHash 一致性（避免 LLM 改原文）
- ✅ 强脏话 mask（我操/卧槽/他妈的等 6 个词）—— 真的会让合规/人不舒服的
- ✅ 说话人+时间戳格式（仅"会议纪要"类型）

## v3.3 删除的硬校验（累计）

| 函数 / 规则 | 报错 | 原因 |
|---|---|---|
| profanity 强制 mask | "已自动 mask 强脏话" 标签 | LLM 被绕晕 |
| section 名白名单 | "missing_section" | LLM 自由组织结构 |
| sectionHits >= 4 阈值 | "low_section_count" | LLM 可能 3 个 section 就够 |
| `low_source_overlap` 阈值 | 0.5 / 0.35 数字门 | LLM 改写但忠于事实 |
| `insufficient_topic_coverage` | **本次** | LLM 用同义词 |
| 自动加"低信息密度/仅供参考"标签 | 标签 | 同上 |
| 置信度 / sourceCoverage 阻断保存 | 400/422 | 同上 |
| "必须含 X pipeline 标记" | "missing_pipeline_marker" | pipeline 标记不该是保存关卡 |

## 验证

### 第一次验证：v3.3 topic coverage 修复

build + kill PID 41498 + restart → 9:07 用户在 UI 试一条"昨日工作总结"。

**结果**：v3.3 修复成功（topic coverage 不再卡），但**触发新错误**：
```
stage=knowledge_note_background_wait
reason=background_job_timeout_after_480000ms
```
8 分钟超时。底栏 `Gateway: unavailable`。

### 第二次验证：根因不在 LLM，在 server 锁等待

调查链路：
- mavis daemon 在 PID 1215 / port 15321 ✅ 健康
- `openclaw gateway call agent --expect-final` 直接调 → **42 秒**返回 200 完整 markdown（绕过 server）
- 同样 prompt 走 server 端 `gatewayCall("agent", ...)` → 8 分钟 timeout
- 关键代码：`apps/server/src/connectors/gateway.ts` 的 `withGatewayCliLock`

### 根因（v3.3 之外，server 端锁 bug）

**`withGatewayCliLock` 拿锁逻辑**：
```ts
const lockPath = "/tmp/openclaw-workbench-gateway-cli.lock";
const staleMs = Math.max(timeoutMs + 15_000, 180_000);
const deadline = Date.now() + Math.max(timeoutMs + 5_000, 10_000);
while (Date.now() <= deadline) {
  try { fd = fs.openSync(lockPath, "wx"); break; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // 检查 stale
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > staleMs) fs.unlinkSync(lockPath);
    } catch {}
    await sleep(250, signal);
  }
}
```

**问题**：
- 默认 `timeoutMs = 540_000`（9 分钟）
- deadline = `timeoutMs + 5_000` = **545 秒 ≈ 9 分钟**
- staleMs = `max(timeoutMs + 15_000, 180_000)` = **555 秒 ≈ 9.25 分钟**
- 即**先到 9 分钟 deadline 失败，再过 15 秒才能清锁**——死循环

**触发路径**：
1. 旧 server (41498) 9:00 之前调 m3，m3 agent 调用时间飘到 8 分钟
2. `execFile` child 进程完成但 stdio 没正常 EOF（m3 session 大 JSON 输出）→ Node 端没及时 settle
3. 锁没释放
4. 我 9:00 kill 41498 → child 死了，**但锁文件没被清**（因为 unlock 在 `finally` 里，server 死了根本没跑 finally）
5. 9:00-9:08 你的新 organize 进 lock 死等 8 分钟 → 报 `background_job_timeout_after_480000ms`
6. 客户端 8 分钟内轮询 145+ 次 `GET organize-jobs/<id>`，最后才看到 failed

### 第三次验证：删锁后跑通

```
$ ls -la /tmp/openclaw-workbench-gateway-cli.lock
(空)
$ kill 61881 && 重启带 OPENCLAW_WORKBENCH_TEST_TOKEN=test-token-1234567890abcdef-test
$ curl -X POST /api/knowledge/notes/organize -H "Cookie: owb_test_session=..." -d '{...}'
开始 09:18:59
结束 09:25:10 (6 分 11 秒)
ok=True, knowledgeNotePipelineVersion=...
keys: ['ok', 'knowledgeNotePipelineVersion', 'qualityMode', 'draft', 'agentDecision',
       'quality', 'htmlDraft', 'htmlQuality', 'generationPipeline', 'attempts', ...]
```

第二次跑（09:25 → 09:31）= 6 分多，**m3 m27 path 稳定**。

### 验证产物（m3 输出质量）

```yaml
title: v3.3 markdown 质量验证
type: 工作记录 / status: 已完成
tags: [v33-q, 工作记录, 跨部门]
related: ['[[跨部门]]', '[[下周一安监法规对接浦东东区仓库]]']
markdown: 727 chars（含 frontmatter + 4 sections + source-hash）
html: 12,862 chars
source-hash: 9bd6aa7a73abe4d7852c88cba251b7d3ef7c41fa7135e818a62ce55fc000d749
```

LLM 主动标注"原文未说明"（5 处），不编造。✅

## v3.3 之外的新问题（待办，**未修复**）

| 问题 | 位置 | 影响 | 优先级 |
|---|---|---|---|
| 锁文件无外部强清机制 | `withGatewayCliLock` | m3 长调用 + server 崩溃 → 锁残留 8 分钟 | 高 |
| `execFile` child zombie / stdio 未 EOF 兜底 | `execGatewayCli` watchdog 已加 | 部分场景 | 中 |
| `staleMs` 计算太宽松（依赖 timeoutMs 自身） | `withGatewayCliLock` | 长 timeoutMs 下 stale 几乎不触发 | 中 |

**建议下次修法**：
1. `withGatewayCliLock` 加：拿锁前先 `fs.statSync(lockPath)`，如果 mtime 超过 `MIN_STALE_MS`（如 60 秒）**主动 unlink** + retry 一次
2. 锁释放从 `finally` 改成 robust：监听 `process.on('exit')` / `SIGTERM` / `SIGINT`
3. `staleMs` 改成**固定值**（如 5 分钟），不跟 timeoutMs 联动

## 教训（写进 memory 候选）

1. **v3 哲学落地时**必须审计所有"硬门槛"。任何"必须覆盖 X 个词"/"必须有 N 个 section"/"覆盖率 ≥ 0.X" 检查都是反 v3 哲学的。
2. **server 端锁文件 + detach 进程**：detached server（PPID=1）死时锁文件残留是经典坑。restart script 应该**先清锁**。
3. **CLI execFile 长调用 + stdio EOF**：m3 agent 输出大 JSON，stdio 没及时 EOF 时 Node 端 settle 慢。watchdog 已有但没覆盖所有路径。
4. **超时链太长**：`timeoutMs` 9 分钟 → 锁 deadline 9 分钟 → 8 分钟后用户开始怀疑系统死了。链路要短。

---

**文件**：`/Users/njx/openclaw_data/openclaw_workbench/SUMMARY_V3.3_FINAL.md`
**修改**：
- `apps/server/src/index.ts` line 6291-6295（v3.3 topic coverage 修复）
- 服务器当前 PID 98504，带 `OPENCLAW_WORKBENCH_TEST_TOKEN`
- `/tmp/openclaw-workbench-gateway-cli.lock` 已清
**重启时间线**：
1. 9:00 build ✅ → kill PID 41498 → start.sh（PID 61881）— v3.3 first try
2. 9:08 用户测 → 8 分钟锁等待 → 失败
3. 9:18 kill 61881 → start with test token（PID 98504）— 清锁
4. 9:18-9:25 第一次 m3 organize 跑通 6:11
5. 9:25-9:31 第二次 m3 organize 跑通（验证稳定性）
