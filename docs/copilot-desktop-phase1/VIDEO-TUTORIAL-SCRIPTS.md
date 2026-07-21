# Copilot Desktop Phase 1 视频教程脚本 v0.1

状态：**4 个录制脚本已就绪；全部画面证据为 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`，MVP 未完成**。

## 统一录制规范

- 每条视频开始 3 秒展示：由真实 final manifest 提供的 candidate ID、OS/架构、artifact SHA256 前 12 位；当前这些字段统一为 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`，不得自行填写示例值。
- 只使用去敏演示数据，不录制 API key、证书、token、数据库文件或私人笔记。
- 右下角始终保留 App 状态栏，能看到 `Local API` 与 `Cloud backup` 状态。
- 当前 Phase 1 只录制同一 macOS final candidate；Windows 是 `OWNER-DEFERRED → Phase 1.1 / NOT DELIVERED`，不在当前录制集内。
- 当前无最终签名候选，以下脚本只可做走位演练，不可发布为完成证据。表格中的“成功信号”是未来拍摄验收点，不是已观察结果。
- 包名、路径、candidate、SHA256、签名、公证、截图和视频文件名必须来自真实 final manifest/EVIDENCE；任何 placeholder 都必须保留 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE` 标签。

## 教程 1：安全安装与首次 local-first 配置（约 3 分钟）

目标：在真实 macOS final candidate 存在后，证明安装包身份可核对，首次启动后 Backup/Remote 默认关、模型可配置且凭据不出镜。

前置：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。未来必须提供最终 manifest、manifest 指定的 macOS 签名安装包、测试用模型 endpoint；屏幕录制隐藏通知和个人文件名。

| 时间 | 画面与操作 | 旁白 | 成功信号 |
|---|---|---|---|
| 00:00-00:15 | 显示 candidate/OS/SHA sidecar，不显示完整本地路径 | “本教程使用同一份已签名 Phase 1 最终候选，先核对身份再安装。” | sidecar 可读 |
| 00:15-00:40 | 对 manifest 指定的实际 macOS artifact 运行 `shasum -a 256` | “SHA 必须匹配 manifest；macOS 需 Developer ID、公证、staple 与 Gatekeeper。” | 未来拍摄：hash/identity 匹配 |
| 00:40-01:05 | 正常安装并启动，不做任何安全绕过 | “签名或系统信任不通过就停止，不能强行运行。” | App 正常首启 |
| 01:05-01:30 | 展示标题、5 个导航和底部状态栏 | “笔记、KB、图谱、RAG 索引和日程都以本机为真值。” | `Local API: connected` |
| 01:30-02:00 | 打开 Settings，展示 Encrypted Backup OFF、Remote OFF、Trash 与 footer UNAVAILABLE | “Backup/Remote 默认关闭；当前 production 边界未关闭时，只能如实显示 unavailable/blocked。” | 未来拍摄：OFF + UNAVAILABLE/blocked |
| 02:00-02:35 | 选择主题；选择 provider、Base URL、Model；API key 输入区用遮罩覆盖 | “模型可扩展；非默认 provider 修改后重启生效。凭据只走私密渠道。” | 设置保存，key 不可见 |
| 02:35-03:00 | 重启 App，回到 Settings 核对非敏感字段 | “重启后只核对 provider、endpoint、model；不展示密钥。” | 设置持久化 |

失败分支必须录：签名/SHA 不匹配时停在验证窗口；Local API offline 时展示安全错误并停止后续录入。

证据状态：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。

## 教程 2：文字笔记 → LLM WIKI → 本地 2D 知识图谱（约 4 分钟）

目标：从去敏 Markdown 笔记生成可检索的本地知识实体/关系，并演示详情与反向引用。

演示数据：

```markdown
# OPC 维护决策

OPC 用本地知识库整理维护决策，并关联 [[inbox/aircraft-mro]]。
关键概念：MRO、可追溯来源、local-first。
```

| 时间 | 画面与操作 | 旁白 | 成功信号 |
|---|---|---|---|
| 00:00-00:20 | 展示 candidate sidecar，进入 Knowledge | “Knowledge 的笔记和图谱都保存在本机。” | Knowledge 可用 |
| 00:20-01:10 | 点击 `新建笔记`，填标题、路径 `inbox/opc-decision`、标签和 Markdown | “路径稳定后，RAG sources 和日程都能回跳同一条笔记。” | 字段完整 |
| 01:10-01:35 | 点击 `保存并更新图谱` | “本地笔记先落盘；本机编排摘要、标签、实体、关系和 RAG 索引，推理使用当前配置的本地或无状态远程 provider。” | 未来拍摄：笔记出现在列表 |
| 01:35-02:15 | 展示详情、Markdown、wikilink 与反向引用 | “详情可核对原文；关联点击只在 App 内跳转。” | 详情正确 |
| 02:15-03:00 | 在 2D 图谱搜索 `OPC`，按 concept/topic 筛选 | “KG 持久化、编排和产品真值在本机；远程模型如被配置只能做本次无状态推理，不能保存或成为 KG 真值。” | 未来拍摄：节点计数变化 |
| 03:00-03:35 | 点击节点打开来源笔记，拖拽与缩放 | “节点必须能回到真实来源，不能出现无来源的装饰节点。” | 来源回跳正确 |
| 03:35-04:00 | 重启 App 后再次打开笔记与图谱 | “重启后仍存在，才证明本地持久化。” | 笔记/图谱仍在 |

失败分支必须录：索引失败时先确认笔记已保存，不重复创建；图谱为空时展示错误/空状态，不伪造节点。

证据状态：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。

## 教程 3：RAG 问答、Sources 核对与取消（约 3 分钟）

目标：证明回答从本地知识召回，来源可点击，并演示无来源、配置失败或取消的安全终态。

前置：教程 2 的去敏笔记已入库并完成索引。

| 时间 | 画面与操作 | 旁白 | 成功信号 |
|---|---|---|---|
| 00:00-00:20 | 打开 Ask，展示“仅基于本地知识库回答”文案 | “Ask 先从本地 KG 和向量索引召回，再调用配置的模型。” | Ask 可用 |
| 00:20-00:55 | 输入“OPC 的维护决策如何保证可追溯？”并点击 `提问` | “问题和最小必要上下文进入本次推理；KB/KG 真值不迁移到云。” | 出现流式回答 |
| 00:55-01:25 | 展示回答和 Sources | “答案必须带可核对来源；来源为空就不能作为有依据的回答。” | Sources 非空且对齐 |
| 01:25-01:50 | 点击 source，回到 Knowledge 核对原文 | “点击引用直接回到本地原文。” | 路径/原文匹配 |
| 01:50-02:20 | 发起第二个问题并在生成时点击 `取消` | “取消必须成为终态，取消后不能继续追加内容。” | 生成停止 |
| 02:20-02:45 | 提问一个知识库没有覆盖的问题 | “没有来源时如实显示空状态，不补造引用。” | 无来源提示 |
| 02:45-03:00 | 展示配置/offline 错误示例的去敏截图 | “模型未配置或离线时修配置，不把错误当答案。” | 安全文案，无秘密 |

失败分支必须录：source 路径打不开、引用原文不一致、取消后继续输出，任一出现即标记 BLOCKED。

证据状态：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。

## 教程 4：语音笔记 + 知识关联日程（约 4 分钟）

目标：演示 production strict-local audio-only 权限、转写入库、图谱增量更新、日程关联、可恢复删除和提醒。

前置：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`；系统麦克风可用；使用固定去敏语句“明天下午复查 OPC 维护决策”。

| 时间 | 画面与操作 | 旁白 | 成功信号 |
|---|---|---|---|
| 00:00-00:20 | 打开 Voice，展示 candidate/OS sidecar | “语音是录入方式，最终文本仍进入本地 KB。” | Voice 可用 |
| 00:20-00:45 | 点击 `开始录音`，只批准麦克风权限 | “App 只应请求 audio；其他权限一律拒绝。” | 状态进入 recording |
| 00:45-01:20 | 说固定句子，点击结束，等待转写 | “当前 production Voice 是 strict-local；不支持或失败时不发送音频，也不会自动进入云 ASR。” | 未来拍摄：本地转写或 fail-closed 提示 |
| 01:20-01:50 | 展示 `语音笔记已入库`，转到 Knowledge 找到 `inbox/voice-...` | “转写成功后创建本地笔记并增量更新图谱。” | 笔记与图谱可见 |
| 01:50-02:30 | 打开 Schedule，填写待办、1 分钟后的时间、语音笔记路径，点击 `添加待办` | “待办、提醒和知识关联也保存在本机。” | 待办出现 |
| 02:30-03:00 | 切换 `列表视图` / `日历视图`，点击关联路径 | “日程可以回跳到知识原文。” | 回到正确笔记 |
| 03:00-03:35 | 等待 App 内和系统到期提醒，点击 `知道了` | “系统通知依赖 OS 授权；App 内提醒仍应存在。” | 提醒触发并确认 |
| 03:35-04:00 | 删除演示 Todo，立即点击撤销；再展示 Settings 的 Trash restore 与独立 purge 确认（不实际 purge 演示数据） | “note/Todo 删除进入可恢复 Trash；永久清除必须单独明确确认。” | 未来拍摄：撤销/恢复路径可见 |

失败分支必须录：非 audio 权限、strict-local 不支持时仍发生音频上传、macOS 实际转写不准确、提醒不触发、关联路径错误或 Trash 无法恢复。任一问题保持 BLOCKED。不要把 cloud fallback 当作 production Voice 的预期行为。

证据状态：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。

## 录制后验收清单

- [ ] macOS 4 条视频，全部绑定同一 macOS final candidate；Windows 录制留待 Phase 1.1；
- [ ] 安装包 SHA/签名验证画面存在，且无安全绕过；
- [ ] 每条视频含 candidate/OS/arch/time sidecar；
- [ ] 没有 API key、token、证书、真实私人笔记或完整用户路径；
- [ ] Knowledge/WIKI/KG、RAG Sources、Voice、Schedule、Model 与隐私兜底均出现；
- [ ] 失败分支保留真实结果，没有剪辑成虚假 PASS；
- [ ] 视频文件 SHA256 写入最终 `EVIDENCE.md`。

当前清单状态：全部 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`；未录制、未生成视频 SHA256、未形成 PASS。
