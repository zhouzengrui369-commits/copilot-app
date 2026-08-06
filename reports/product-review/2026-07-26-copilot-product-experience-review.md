# Owner Decision Brief

Review Mode: `EXPLORATORY_PRODUCT_REVIEW` <br>
Coverage: `FULL_EXPERIENCE_REVIEW`（首次评审） <br>
Candidate: dirty current-source Electron window `njx-copilot-v6` <br>
Commit: `09a918d6db01c2447985f78c4b4f0c25e91304c8`（仅评审基线；产品候选含 307 项 dirty state） <br>
Artifact SHA-256 / Deployment ID: `MISSING`

Product Experience Verdict: `NOT_READY` <br>
Release Evidence Verdict: `BLOCKED_NON_REPRODUCIBLE_CANDIDATE` <br>
Domain blockers: `BLOCKED_SOURCE_TRUST / BLOCKED_LOCAL_FIRST_BOUNDARY` <br>
Prototype Concept Verdict: `PROTOTYPE_PROMISING` <br>
Prototype-to-Runtime Parity: `PARITY_MAJOR_GAP`

本轮核心承诺：资料被可信地组织、调用、核验，并帮助用户形成判断和下一步行动。 <br>
核心承诺是否成立：**否**。真实笔记可以本地保存，但 WIKI、RAG、来源、行动和完整重启链未闭合。

上一轮 P0 状态：

- 没有可继承的上一轮正式产品体验报告。
- 既有 Browser H 门与测试是原型/子门证据，不是本轮 Electron Runtime PASS。

本轮新 P0：

1. `EXP-COP-001`：真实知识 → 可核验回答 → 行动链断裂。
2. `EXP-COP-002`：完整退出后，标准 current-source 启动命令无法重新启动 App。
3. `EXP-COP-003`：用户无法从设置与提问界面判断哪些内容会经本地代理离开本机。

最重要的正面信号：

1. 本地保存成功与 WIKI 失败被明确分开，没有虚假成功。
2. 未配置模型时明确返回 `RAG_CONFIG_REQUIRED / NO_SOURCE`，没有用常识冒充个人知识。
3. Renderer reload 后真实笔记仍能在 Knowledge 中打开，MOC 计数来自真实本地路径。

开发线程必须完成：

1. 先关闭 `EXP-COP-002`，产出可重复启动的 current-source Electron 候选。
2. 再关闭 `EXP-COP-001`，用唯一事实完成 WIKI → RAG → 可点击来源 → 本地行动 → 重启 readback。
3. 关闭 `EXP-COP-003`，在模型调用前呈现清楚、可确认的本机/外部数据边界。

下一轮只需定向复验：

1. 标准启动、完整退出、二次启动和原笔记 readback。
2. `MSTAR-417` 唯一事实问答、来源点击、无来源 fail-closed。
3. 回答转 Todo、重启保留，以及 provider egress disclosure。

Owner 当前建议：

- [ ] 放行
- [x] 修复后定向复验
- [ ] 继续探索，不进入发布候选
- [ ] 退回重新定义

---

## 1. 候选身份

| Field | Value |
|---|---|
| Repository | `/Users/njx/openclaw/copilot` |
| Branch | `review/copilot-product-experience-baseline` |
| Commit SHA | `09a918d6db01c2447985f78c4b4f0c25e91304c8` |
| Working Tree Status | `DIRTY`；身份采集时 307 项 |
| Candidate App | pre-existing real Electron source-runtime |
| Window | `njx-copilot-v6` |
| Electron path | `/Users/njx/openclaw/copilot/apps/copilot-desktop/node_modules/electron/dist/Electron.app` |
| Renderer | `file:///Users/njx/openclaw/copilot/apps/copilot-desktop/dist/renderer/index.html` |
| Candidate SHA-256 | `MISSING` |
| Build Command | `npm run dev:copilot-desktop` |
| Existing-window build time | `UNKNOWN` |
| Restart attempt | 2026-07-26 20:53 CST；失败 |
| OS / Architecture | macOS 26.2 (25C56) / arm64 |
| Electron | app dependency `38.8.6` |
| Backend | Local API `PRESENT / HEALTH NOT_PROBED` |
| Dataset | 复用既有 Electron userData；新增一条非敏感合成测试笔记 |
| Model / Provider | MiniMax default；credential `not-configured` |
| Network | 未改变系统网络；离线项未执行 |
| Previous Review | 无正式 product-experience report |

Release Evidence Verdict:

```text
BLOCKED_NON_REPRODUCIBLE_CANDIDATE
```

原因：产品候选不属于单一 Commit；现有窗口的构建时间和 artifact hash 未固定；完整退出后的标准启动命令失败。

## 2. 评审模式

- 候选含大量未提交 current bytes。
- 现有 Electron 窗口不可绑定到唯一 artifact SHA。
- 标准启动命令在本轮不能重建可用窗口。

因此选择 `EXPLORATORY_PRODUCT_REVIEW`。由于这是首次正式产品体验评审，旅程覆盖按 `FULL_EXPERIENCE_REVIEW` 执行；该报告不能作为发布签字。

## 3. 阶段 A 冻结结果

隔离 Blind User Reviewer 未读取 README、Profile、PRD、计划、状态、历史报告、源码或测试，只得到用户身份、Electron 入口、任务和安全边界。

阶段 A 结论：`BLOCKED`。

> 仅根据实际使用，我认为该产品是一个强调本地保存、状态透明的个人知识工作台：首屏记录路径清楚，失败也不伪装成功；但知识索引失败后进入“知识”即白屏，无法完成提问与行动推进。我愿继续用虚构资料试用，但在检索、恢复与日期正确性被证明前，不会交付真实数据。

冻结证据：`evidence/blind-user-stage-a.md`。

## 4. 阶段 B 理念对照

自然感受到的产品：以 Today 为入口，整合本地记录、日程、待办、知识和 AI 的谨慎型个人工作台。

设计者希望传达的产品：local-first 个人知识引擎和专业知识工作台；资料可以被组织、检索、RAG 核验并转化为执行对象。

真实 Runtime 当前承诺：

- 真实本地笔记保存和路径回显；
- 本地 MOC/Knowledge 阅读；
- 对话、sources、设置和 Todo 入口；
- Remote / Backup 默认关闭。

实际差距：

- WIKI 在真实笔记上失败；
- RAG 因配置缺失在检索前失败；
- 没有回答、来源或行动对象；
- 完整重启失败；
- 外部模型数据边界未让用户形成明确判断。

结论：

> 产品理念在真实 UI 中已有清晰骨架和诚实状态语言，但核心独特价值主要仍存在于文档与 Browser fixture 中，尚未在可重复启动的 Electron Runtime 闭合。

## 5. 当前范围与 N/A

### `IN_CURRENT_RELEASE_SCOPE`

- F0 current-source Electron shell。
- Today、Knowledge 基础导航和真实本地笔记保存。
- 真值标签、空态/失败态、基础设置边界。
- 当前候选的启动、退出、恢复与数据可达性。

### `OUT_OF_CURRENT_RELEASE_SCOPE`

- Windows Phase 1.1。
- 3D 节点可视化知识图谱。
- Remote / Backup 生产能力。
- signed/notarized/package release gate。

### `AMBIGUOUS_SCOPE`

- 文件导入、WIKI、RAG、来源、回答转行动、provider 配置。

项目计划把 F1–F5 锁在 F0 之后，但当前 Electron UI 已向用户暴露这些入口、状态和操作。对用户可操作且承载产品承诺的 surface 不能仅因开发队列锁定而记作 N/A；要么真实可用，要么在 UI 中明确 gated。

## 6. Runtime 用户旅程

| Journey | Result | Evidence / observation |
|---|---|---|
| C1 首次启动与价值理解 | `PARTIAL` | Today 价值骨架清楚；工程标签密集；盲测初始日期显示 7/25，但系统日期为 7/26。 |
| C2 建立自己的知识 | `PARTIAL` | 合成笔记真实保存到本地并显示路径；无可见文件导入；WIKI `FAILED`；reload 后可打开原文和 Edit。 |
| C3 个人知识问答 | `FAIL` | 唯一事实问题返回 `RAG_CONFIG_REQUIRED`；`NO_SOURCE`；无回答、无来源。 |
| C4 知识组织与图谱 | `PARTIAL / BLOCKED` | reload 后 MOC 展示 1 条真实笔记/1 个分组；WIKI 字段全失败；2D 图谱未能在完整重启前完成评审。 |
| C5 从知识走向执行 | `FAIL` | 没有答案可转 Todo/计划；“生成今天的待办”只是建议提问，不是回答到行动的闭环。 |
| C6 退出、重启、连续性 | `FAIL` | Renderer reload 后笔记可见；完整退出后 `npm run dev:copilot-desktop` 因缺失 `bufferutil` 无法恢复 App。 |
| C7 模型、配置、安全 | `FAIL` | 密钥为空、Backup/Remote OFF 是正面信号；但用户无法判断 MiniMax local proxy 会把哪些内容发到本机外。 |
| C8 失败闭合与信任 | `PARTIAL / BLOCKED` | WIKI/RAG 失败诚实；首次 Knowledge 出现无恢复白屏；重启失败阻断其余损坏文件、空库、离线和索引异常旅程。 |

### 关键复现

1. 在真实 Electron Today 输入：`项目「晨星」冻结日期为 2031-04-17，唯一决策码 MSTAR-417。`
2. 保存为本地笔记。
3. 实际：本地保存成功；路径 `inbox/2026-07-25/capture-1785069912177`；WIKI `FAILED`。
4. 进入 Knowledge：Blind Reviewer 看到持续白屏。
5. `Command+R` 后，Today 恢复为 7/26；再次进入 Knowledge 能看到原笔记和本地 MOC，但 WIKI 字段全失败。
6. 进入对话提问唯一事实。
7. 实际：`RAG_CONFIG_REQUIRED / NO_SOURCE`，没有回答。
8. 完全退出 App，运行标准启动命令。
9. 实际：Electron load error，`ws` 无法 resolve `bufferutil`，无可用窗口。

## 7. Prototype 独立评审

开发线程提供：

`http://127.0.0.1:41744/?prototype=ready#today`

该页面明确标记 `PROTOTYPE / BROWSER FIXTURE / NOT_RUNTIME_PROOF / MVP_NOT_COMPLETE`，没有把 fixture 冒充 Runtime。

正面概念信号：

- Today 将日历、记录、笔记、时间线、Todo 和上下文助手放进同一工作流。
- Knowledge 具有文件夹目录、2D MOC 阅读、阅读路径、主题、最近变化、WIKI 状态和详情。
- 进入 Knowledge 有可见 loading state；当前 Browser warning/error log 为空。

Prototype Concept Verdict:

```text
PROTOTYPE_PROMISING
```

## 8. Prototype-to-Runtime Parity

| Surface | Prototype | Electron Runtime |
|---|---|---|
| Today | 两条 fixture 笔记、Todo、时间线完整 | 真实记录可保存；初始日期曾 stale |
| Knowledge | `WIKI CURRENT`、MOC/阅读路径稳定 | 真实笔记 WIKI `FAILED`；首次进入出现白屏 |
| Ask / Sources | 概念与 truth surface 在位 | `RAG_CONFIG_REQUIRED / NO_SOURCE` |
| Continuity | 不适用，数据只在页面内存 | 标准完整重启失败 |
| Action | Todo fixture 与交互完整 | 无回答到行动闭环 |

Prototype-to-Runtime Parity:

```text
PARITY_MAJOR_GAP
```

## 9. 历史问题继承矩阵

没有上一轮正式产品体验报告，无法合法关闭任何历史产品体验问题。

| Prior evidence | Current status | New evidence | Closed? | Regression? |
|---|---|---|---|---|
| R44 Browser `F0_CONTROLLER_H_PASS` | Prototype sub-gate only | Electron WIKI fail、白屏、restart fail | No | Runtime gap |
| R17 real Electron local-knowledge call failed | Historical runtime failure | 本轮真实 note 可保存/reload 后可读，但 restart fail | No | Not proven |

## 10. Runtime 评分

评分方向：1 = 明显不成立/高阻力，5 = 稳定成立/低阻力。N/A 不计。

| Dimension | Score | Applicable | Evidence / reason |
|---|---:|---|---|
| 首次价值理解 | 3 | Yes | 工作台骨架清楚；工程状态与日期错位削弱理解。 |
| “知识属于我”的感受 | 3 | Yes | 真保存、真路径、reload 可读；WIKI 与完整重启不成立。 |
| local-first 可信感 | 2 | Yes | Backup OFF、保存 fail-closed；provider egress 不透明。 |
| 来源与回答可核验性 | 1 | Yes | 无回答、无来源，`RAG_CONFIG_REQUIRED`。 |
| 知识组织的实际价值 | 2 | Yes | MOC 有真实计数；WIKI 组织字段失败。 |
| 知识到行动的转化能力 | 1 | Yes | 无可转化回答；未产生行动对象。 |
| 信息架构和交互一致性 | 2 | Yes | 主导航清楚；Knowledge 白屏且无恢复。 |
| 产品差异化 | 2 | Yes | local-first 方向明确；Runtime 尚像工程预览。 |
| 失败状态中的信任感 | 2 | Yes | 错误诚实，但白屏和 restart 无恢复。 |
| 与 KnowMe 生态定位的一致性 | 2 | Yes | 本地骨架一致；组织、调用、核验、执行未闭合。 |
| 预测持续使用阻力 | 1 | Yes | 用户不愿交付真实数据，核心链和重启阻塞。 |

总分：`21 / 55`，归一化约 `38 / 100`。P0 存在，分数不能覆盖阻塞裁决。

## 11. P0–P3 问题

### EXP-COP-001 / 真实知识到可核验行动链断裂

Severity: `P0` <br>
Journey: `C2 / C3 / C5` <br>
User Promise Violated: 资料被组织、调用、核验并形成下一步行动。 <br>
Observed Behavior: 本地 note 保存后 WIKI `FAILED`；唯一事实问答返回 `RAG_CONFIG_REQUIRED / NO_SOURCE`；无回答、来源或行动对象。 <br>
Expected Behavior: 唯一事实进入 current WIKI/index；回答只根据该事实；来源可打开同一原文；回答可转本地 Todo。 <br>
Evidence: `blind-02-save-wiki-failed.png`, `main-04-knowledge-recovered.jpg`, `main-05-rag-config-required.jpg`。 <br>
Likely User Impact: 产品退化为只能保存的记录工具，核心差异化不可用。 <br>
Current Scope: `AMBIGUOUS_SCOPE`，但 UI 已暴露并承诺该路径。 <br>
Required Behavior: 当前版本如不支持必须明确 gated；如支持必须端到端闭合。 <br>
Acceptance Criteria: 使用新 userData 创建/导入含 `MSTAR-417` 的资料；WIKI current；唯一答案正确；source 点击回原文；转 Todo；重启后全部 readback。 <br>
Focused Retest Steps: 按 C2→C3→C5→C6 串行执行一次。 <br>
Required Retest Evidence: current candidate identity、逐步截图、source preview、Todo readback、restart receipt。 <br>
Regression Risk: fixture 或模型常识再次冒充个人知识。

### EXP-COP-002 / 完整退出后标准 Electron 启动失败

Severity: `P0` <br>
Journey: `C6` <br>
User Promise Violated: local-first 数据可持续、可返回、可恢复。 <br>
Observed Behavior: `npm run dev:copilot-desktop` 构建后，Electron load error：`Could not resolve "bufferutil" imported by "ws"`；无可用窗口。 <br>
Expected Behavior: 固定 current-source 命令可重复启动同一候选，且此前 note 可读。 <br>
Evidence: `runtime-restart-receipt.txt`。 <br>
Likely User Impact: 完整退出后产品不可用，本地知识不可达。 <br>
Current Scope: `IN_CURRENT_RELEASE_SCOPE`。 <br>
Required Behavior: canonical source-runtime 与候选依赖闭合；启动失败有可诊断、可恢复路径。 <br>
Acceptance Criteria: 冷启动 PASS；退出 PASS；第二次启动 PASS；原 note/WIKI/Todo/设置 readback PASS；候选 SHA 固定。 <br>
Focused Retest Steps: start → read note → quit → start → read note，至少两轮。 <br>
Required Retest Evidence: 命令/exit、窗口 identity、artifact/source SHA、两次 readback 截图。 <br>
Regression Risk: root/app-local Electron、native dependency 或打包依赖漂移。

### EXP-COP-003 / local-first 外部推理边界不可判断

Severity: `P0` <br>
Journey: `C7` <br>
User Promise Violated: 用户知道哪些数据留在本机、哪些会离开本机。 <br>
Observed Behavior: 设置显示 `127.0.0.1` local MiniMax proxy、provider/model/credential；数据隐私强调本地真值，但未说明提问、命中的 note chunk、上下文或元数据是否经代理发送到外部 MiniMax。 <br>
Expected Behavior: 调用前明确目的地、发送字段、是否保存、可关闭方式和确认点。 <br>
Evidence: `main-06-settings-boundary.jpg`。 <br>
Likely User Impact: 用户可能把“localhost”误解为完整本地推理，错误交付私密资料。 <br>
Current Scope: UI 已暴露，必须计入。 <br>
Required Behavior: 设置与每次模型调用的 trust surface 明确区分本地存储、本地代理和外部推理。 <br>
Acceptance Criteria: 未确认时不发送；UI 可读出 destination、data classes、retention/unknown、开关；Ask 页面显示当前 egress 状态。 <br>
Focused Retest Steps: 未配置、配置本地模型、配置外部 provider 三种状态。 <br>
Required Retest Evidence: 设置与 Ask 的 before/confirm/after 截图及 no-egress receipt。 <br>
Regression Risk: 文案更新但真实网络路径不一致。

### EXP-COP-004 / 首次进入 Knowledge 出现无恢复白屏

Severity: `P1` <br>
Journey: `C4 / C8` <br>
User Promise Violated: 用户始终知道系统状态和下一步。 <br>
Observed Behavior: Blind Reviewer 点击 Knowledge 后内容区持续白屏；无 loading、错误、返回或重试。主评审官通过 `Command+R` 才恢复，后续再次进入可加载。 <br>
Expected Behavior: Suspense loading、错误边界和可见恢复动作始终存在。 <br>
Evidence: `blind-03-knowledge-blank.png`；reload 后 `main-04-knowledge-recovered.jpg`。 <br>
Likely User Impact: 用户认为数据或整个 App 已损坏。 <br>
Current Scope: `IN_CURRENT_RELEASE_SCOPE`。 <br>
Required Behavior: 任何 lazy-load/runtime exception 都由 App shell 捕获。 <br>
Acceptance Criteria: 首次/重复导航 20 次无白屏；慢加载显示 loading；故障显示返回/重试；无手工 reload。 <br>
Focused Retest Steps: cold start 后 Today↔Knowledge 连续切换并注入可控失败。 <br>
Required Retest Evidence: video or sequential screenshots、console/runtime log、recovery receipt。 <br>
Regression Risk: 首次 lazy chunk、stale renderer cache、未捕获 Promise。

### EXP-COP-005 / 冷启动日期与本地笔记路径错位

Severity: `P1` <br>
Journey: `C1 / C2 / C6` <br>
User Promise Violated: 本地知识按可信时间组织。 <br>
Observed Behavior: 系统日期为 2026-07-26；Blind 首屏显示 7月25日并将 note 保存到 `inbox/2026-07-25/...`；reload 后 Today 改为 7月26日，但旧路径保留。 <br>
Expected Behavior: 冷启动立即使用当前本地时区；保存时日期路径与 UI 同一真值。 <br>
Evidence: `blind-01-start.png`, `blind-02-save-wiki-failed.png`, `main-review-steps.md`。 <br>
Likely User Impact: 日记进入错误日期，破坏检索、MOC 和信任。 <br>
Current Scope: `IN_CURRENT_RELEASE_SCOPE`。 <br>
Required Behavior: 统一 local-date clock；跨午夜和休眠唤醒刷新。 <br>
Acceptance Criteria: 冷启动、跨午夜、休眠恢复、手工日期选择均生成正确路径；旧 note 不被静默移动。 <br>
Focused Retest Steps: 23:59→00:01、旧窗口跨日、reload/restart。 <br>
Required Retest Evidence: system date、UI date、saved path 三者同帧。 <br>
Regression Risk: stale initial state、UTC/local conversion。

### EXP-COP-006 / 文件导入旅程缺失或范围未定义

Severity: `P1 / AMBIGUOUS_SCOPE` <br>
Journey: `C2` <br>
User Promise Violated: 用户可把现有资料进入知识系统并检查组织结果。 <br>
Observed Behavior: Knowledge 可见 `新建笔记`，但没有可发现的 Markdown/PDF/文件导入入口或支持范围说明。 <br>
Expected Behavior: 支持的文件有导入入口、进度、结果、错误和可纠正路径；不支持时明确当前范围。 <br>
Evidence: real Electron Knowledge observation in `main-review-steps.md`。 <br>
Likely User Impact: 用户只能手抄资料，无法建立真实个人知识库。 <br>
Current Scope: `AMBIGUOUS_SCOPE`。 <br>
Required Behavior: owner 明确 release scope；UI 与 Profile 一致。 <br>
Acceptance Criteria: 导入一个 Markdown 与一个损坏文件，分别得到可核对成功和可恢复失败；或明确 N/A 并从当前承诺移除。 <br>
Focused Retest Steps: C2 import happy path + corrupt-file path。 <br>
Required Retest Evidence: file identity、import status、result path、organization fields。 <br>
Regression Risk: 上传成功但未进入索引/WIKI。

### EXP-COP-007 / 工程状态与内部术语压过用户语言

Severity: `P2` <br>
Journey: `C1 / C7` <br>
User Promise Violated: 30 秒内理解产品价值与下一步。 <br>
Observed Behavior: `CURRENT SOURCE PREVIEW`, `NOT_PROBED`, `MVP_NOT_COMPLETE`, `minimax-primary-gpt-fallback skill` 等内部术语占据首屏与设置。 <br>
Expected Behavior: 探索性构建保留 truth label，但内部诊断下沉到可展开区，主路径使用用户语言。 <br>
Evidence: `blind-01-start.png`, `main-06-settings-boundary.jpg`。 <br>
Likely User Impact: 产品更像工程控制台而不是可信知识助手。 <br>
Current Scope: `IN_CURRENT_RELEASE_SCOPE` 的体验问题。 <br>
Required Behavior: 用户状态与开发诊断分层。 <br>
Acceptance Criteria: 用户无需理解工程码即可完成记录、知识、提问与恢复；诊断仍可复制。 <br>
Focused Retest Steps: 30 秒首屏理解测试。 <br>
Required Retest Evidence: current screenshot + blind summary。 <br>
Regression Risk: 为美化而隐藏真实失败。

## 12. 四类裁决

```text
Product Experience Verdict:
NOT_READY

Release Evidence Verdict:
BLOCKED_NON_REPRODUCIBLE_CANDIDATE

Domain Blockers:
BLOCKED_SOURCE_TRUST
BLOCKED_LOCAL_FIRST_BOUNDARY

Prototype Concept Verdict:
PROTOTYPE_PROMISING

Prototype-to-Runtime Parity:
PARITY_MAJOR_GAP
```

## 13. Human Owner Gate

当前 `P0 > 0`，不满足生成十分钟 Owner 脚本的前置条件。

```text
HUMAN_OWNER_GATE_NOT_ELIGIBLE
```

所有 P0 关闭并通过 Focused Retest 后，再严格使用 Profile §6 的脚本；AI 最终只能输出 `HUMAN_OWNER_GATE_REQUIRED`。

## 14. 证据索引

- `reports/product-review/2026-07-26-copilot/evidence/blind-user-stage-a.md`
- `reports/product-review/2026-07-26-copilot/evidence/blind-01-start.png`
- `reports/product-review/2026-07-26-copilot/evidence/blind-02-save-wiki-failed.png`
- `reports/product-review/2026-07-26-copilot/evidence/blind-03-knowledge-blank.png`
- `reports/product-review/2026-07-26-copilot/evidence/main-review-steps.md`
- `reports/product-review/2026-07-26-copilot/evidence/main-04-knowledge-recovered.jpg`
- `reports/product-review/2026-07-26-copilot/evidence/main-05-rag-config-required.jpg`
- `reports/product-review/2026-07-26-copilot/evidence/main-06-settings-boundary.jpg`
- `reports/product-review/2026-07-26-copilot/evidence/runtime-restart-receipt.txt`
- `reports/product-review/2026-07-26-copilot/evidence/prototype-parity-check.md`
- `reports/product-review/2026-07-26-copilot/evidence/prototype-07-knowledge-ready.png`

## 15. 完成边界

- 本报告没有修改或修复产品代码、UI、文案、测试、数据模型或构建配置。
- Browser fixture 只影响 Prototype/Parity 裁决，不升级 Runtime Verdict。
- 本轮不授予 release、MVP、owner 或 commit-to-product authority。
- 开发线程应按 P0 顺序返回最小修复合同；下一轮优先 `FOCUSED_RETEST`，不重复整份评审。
