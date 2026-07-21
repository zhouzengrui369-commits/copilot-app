# Copilot Desktop Phase 1 用户手册 v0.1

状态：**可用于内部演练；macOS final candidate 证据待完成，MVP 未完成**。

## 1. 使用前先确认

Copilot Desktop 的本地笔记、KB、知识图谱、RAG 索引和日程都以当前电脑为真值。模型调用可以访问本地或远程 endpoint；腾讯云只允许做无状态 LLM 代理、远程管理指令转发和用户主动开启的可选备份。

当前没有可对外分发的最终签名候选。历史诊断包不能作为正式安装包。当前安装信息统一为 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。只有同时满足以下条件的 macOS 包才可按本手册安装：

1. 来自 owner 指定的同一个 final candidate；
2. 实际 final manifest 明确给出该包的精确路径/文件名、字节数、SHA256 与 release identity；
3. macOS 显示 Developer ID、公证和 Gatekeeper 通过；
4. manifest 的状态为最终 `PASS`，不是 `PARTIAL_BLOCKED`。

Windows 原生安装、签名和截图是 `OWNER-DEFERRED → Phase 1.1`，当前既不阻塞 macOS-first MVP，也不代表 Windows 已交付。

## 2. 安装

### 2.1 macOS（最终候选就绪后）

1. 从实际 final manifest 读取与本机架构匹配的精确 artifact 文件名和路径；不要根据本文猜测包名。
2. 在终端计算 SHA256，并与 final manifest 逐字节核对。以下路径是命令占位符，不是当前文件或证据：

   ```bash
   shasum -a 256 '<exact-artifact-path-from-final-manifest>'
   ```

3. 按 final manifest 指定的 artifact 类型打开安装介质，并将其中实际 App 拖入 Applications。
4. 正常双击打开；系统应识别已验证开发者，不应要求绕过安全检查。
5. 如果出现“无法验证开发者”、签名损坏或公证失败，立即停止并保留截图；不要运行 `xattr`、不要右键强行打开。

### 2.2 Windows（Phase 1.1）

`OWNER-DEFERRED / NOT DELIVERED`。当前文档不提供可执行的 Windows 安装步骤、包名或签名结论；Phase 1.1 必须由其真实 manifest、原生机器、Authenticode/RFC3161 与安装证据另行生成手册修订。

## 3. 首次使用

1. 打开 App；产品名、版本与 candidate identity 必须与实际 final manifest/sidecar 对齐，当前值为 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。
2. 确认导航包含 `Knowledge`、`Ask`、`Voice`、`Schedule`、`Settings`。
3. 查看底部状态栏：

   - `Local API: connected` 才能使用本地知识能力；
   - `Cloud backup: UNAVAILABLE (metadata-only)` 是当前真实状态；
   - 备份能力未连接时，不要把设置开关理解为已经完成云备份。

4. 打开 `Settings`，确认 `Cloud backup` 默认是 `OFF`。
5. 选择主题 `Dark`、`Light` 或 `Auto`。
6. 在 `Model API` 中配置 provider、Base URL 和 Model。默认是 MiniMax-M3 的 loopback endpoint；OpenAI、Claude 或自托管配置在修改后需要重启 App 才完整生效。
7. API key 只通过受批准的私密渠道填入，不要写进笔记、仓库、教程示例或截图。输入框应为密码类型。

如果本地状态栏显示 offline，先重启 App；仍失败时停止录入敏感内容并把安全错误文案、OS、candidate ID 和时间记录给验收人。

## 4. Knowledge：文字笔记、WIKI 与 2D 图谱

### 4.1 新建笔记

1. 打开 `Knowledge`，点击 `新建笔记`。
2. 填写 `笔记标题`。
3. `笔记路径` 可留空，App 会生成 `inbox/...`；也可以输入稳定路径，例如 `inbox/opc-overview`。
4. `笔记标签` 用逗号分隔。
5. 在 `笔记正文` 输入 Markdown；可用 `[[另一条笔记路径]]` 建立 wikilink。
6. 点击 `保存并更新图谱`。

预期：笔记先写入本机 KB，然后触发摘要、标签、实体、关系和 RAG 索引更新。若模型或索引失败，本地笔记可能已成功保存；不要重复创建，先从左侧笔记列表确认，再重试索引或记录错误。

### 4.2 编辑、删除和详情

- 点击左侧笔记打开编辑器和详情。
- 修改后再次点击 `保存并更新图谱`。
- 详情支持 Markdown、wikilink 和反向引用；点击关联项应在 App 内跳转。
- 删除笔记会进入本地可恢复 Trash，并显示 `撤销删除`；它不是立即永久删除。
- 可在 `Settings → Data & Privacy` 的 Trash 管理中查看并恢复。冲突或 `recovery-required` 时停止覆盖并按提示处理。
- 永久 purge 是独立操作，必须再次明确确认；只有 purge 才不可恢复。

### 4.3 2D 知识图谱

- 图谱只在本机读取和渲染。
- 使用 `Search nodes by name…` 按名称搜索。
- 使用 `Filter by type` 的 person/org/concept/event/place/product/document/topic/other 筛选。
- 点击节点应打开其来源笔记；拖拽、缩放用于浏览。
- 如果显示 0 nodes，先确认至少一条笔记已完成索引；不要把空图谱解释为云端数据丢失。

## 5. Ask：RAG 问答与 Sources

1. 先在 Knowledge 保存至少一条与问题相关的笔记。
2. 打开 `Ask`，在 `问题` 中输入只应由本地知识回答的问题。
3. 点击 `提问`；流式生成时可点击 `取消`。
4. 阅读 `回答`，并逐条核对 `Sources`。
5. 点击 source 路径，应回到对应 Knowledge 笔记。

验收原则：

- 回答必须基于本地检索结果；Sources 为空时 App 必须如实显示“本次回答没有可引用来源”。
- `[CONFIG_REQUIRED]` 对应模型未配置；`本地 AI 服务暂不可用` 对应 endpoint/offline；两者都不是答案。
- 不根据没有 source 的回答做关键决策；重新补充本地笔记或修复模型配置后再问。

## 6. Voice：语音录入

1. 打开 `Voice`，点击 `开始录音`。
2. 首次使用时，只批准麦克风/audio 权限。
3. 按钮变为 `正在录音… 点击结束` 后说话，再点击结束。
4. 等待 strict-local 转写结果；当前 production Voice 不会自动上传到云 ASR。
5. 出现 `语音笔记已入库` 后，到 Knowledge 检查新建的 `inbox/voice-<timestamp>` 笔记和图谱更新。

失败处理：

- `麦克风权限被拒绝`：到系统隐私设置为实际 final manifest 对应的 App 开启麦克风，再重试；
- `未检测到语音输入`：检查输入设备和音量；
- strict-local 不支持或识别失败：应 fail closed 且不发送音频；保留错误文案并改用文字录入；
- 转写成功但入库失败：复制当前转写文本到本地临时安全位置，再按错误提示重试。

当前 production Voice screen 没有配置 cloud endpoint、consent 或 fallback enablement。云 ASR 只能在另行配置的 non-strict 路径中同时具备显式启用、consent 和明确 HTTP endpoint 后使用；本手册不承诺该路径可用。真实 macOS 麦克风与 strict-local 准确率仍待 final-candidate 原生复验。Windows Voice 属于 Phase 1.1。

## 7. Schedule：知识关联日程

1. 打开 `Schedule`。
2. 填写 `待办`、`到期与提醒时间`，可选填 `关联笔记路径`。
3. 点击 `添加待办`。
4. 在 `列表视图` 或 `日历视图` 查看。
5. 点击圆形状态按钮切换完成状态；点击关联笔记路径回到 Knowledge。
6. 到期提醒出现后点击 `知道了`；删除 Todo 会进入本地可恢复 Trash 并提供撤销，永久清除需在 Settings 单独确认。

提醒数据保存在本地。系统通知依赖 OS 授权；系统通知没有出现时仍应在 App 内看到到期提醒。macOS final candidate 的提醒与重启持久化仍待复验；Windows 属于 Phase 1.1。

## 8. Settings：模型、主题、Backup、Remote、Trash 与重置

- **Encrypted Backup** 默认 OFF，需要配置、显式 consent 和选择 scope。当前 UI 可描述手动 snapshot/upload/download-verify/restore-preview/delete；没有 schedule/background upload，restore apply 当前不可用。footer 显示 `UNAVAILABLE (metadata-only)` 时，不得宣称 live COS 上传、下载或恢复成功。
- **Remote management** 默认 OFF，需要已验证 pairing；online-only、无离线队列，每条命令需桌面批准，可 revoke/disable。production issuer mount、TLS/WSS 和 readiness 未关闭，不能宣称已部署或可远程控制。
- **Trash / Data & Privacy** 列出可恢复 note/Todo，支持 restore；冲突/recovery-required 必须 fail closed。永久 purge 需要单独明确确认。
- `Theme` 立即切换并保存。
- `Model API` 支持 MiniMax、OpenAI、Claude、自托管；切换 provider 会填入对应默认 endpoint/model。
- 非默认 provider 修改后按提示重启 App。
- `Reset to defaults` 需要在 3 秒内第二次点击并确认；它会重置主题、模型、快捷键和窗口设置。重置前确保能够重新取得模型凭据。

## 9. 隐私与故障上报

上报问题时只提供：OS/架构、candidate ID、artifact SHA256、操作步骤、时间、安全错误码和去敏截图。不要提供：API key、证书、token、完整笔记正文、个人路径中的身份信息、私有数据库或模型请求全文。

遇到以下任一情况应停止并标记 BLOCKED：

- 安装包 SHA 或签名不匹配；
- App 请求非 audio 权限；
- Backup 显示已上传/恢复但没有正式 adapter、live COS 与 candidate-bound 证据；
- Remote 在 authority/readiness 未通过时仍显示 ready、接受连接或降级到非 TLS；
- RAG 引用与打开的笔记不一致；
- Trash restore/purge、删除或索引导致其他笔记/Todo 丢失；
- 错误或日志暴露笔记正文、API key 或凭据；
- macOS final candidate 的任一当前门禁没有同一候选验证证据。

## 10. Phase 1 不包含

本版本不提供 3D 图谱、mobile/web 客户端、多用户/多租户、商业化、插件、i18n、端侧 LLM，也不恢复已退役的 njx-knowledge Sprint 2。
