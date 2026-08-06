# LLM Wiki Ecosystem Fit Report

> 调研日期：2026-08-07
> 调研范围：nashsu/llm_wiki vs lgwanai/llm-wiki 与 KnowMe 生态的关联度分析

## 背景

KnowMe（灵犀）生态由四个核心项目构成，围绕"个人 AI 第二大脑 + 产品工厂"愿景展开：
| 项目 | 定位 | 技术栈 |
| knowme | 跨端个人 AI 第二大脑（iOS/Android/macOS/Windows/Apple Watch/Huawei Watch） | TypeScript + Swift + Kotlin + PostgreSQL + Qdrant |
| copilot-app | 本地知识管理引擎（Electron 桌面端） | TypeScript + Electron + SQLite |
| aog-knowledge-base | 垂直行业知识工程（城市应急保障） | Python + CloudBase + 微信小程序 |
| knowme-ecosystem | 生态治理与战略基线（SSoT） | Python + Markdown |

核心技术路线：多模态采集 → MiniMax M3 Embedding → Qdrant 向量库 → RAG 问答 + LLM Wiki 异步提炼。

## 候选项目概览

### nashsu/llm_wiki
- Stars: 15,989 | Commits: 784 | Version: v0.6.7
- 定位：跨平台桌面应用，将文档转为结构化互联知识库。LLM 增量构建并维护持久化 Wiki。
- 技术栈：Tauri 2 (Rust) + React 19 + TypeScript + DuckDB
- 协议：GPL v3.0

### lgwanai/llm-wiki
- Stars: ~0 | Commits: 9
- 定位：100% Rust 个人知识库，文档编译为结构化 Wiki 页面 + 知识图谱链接。
- 技术栈：Tauri 2 (Rust) + React + DuckDB

## 六大核心维度对比

| 维度 | nashsu/llm_wiki | lgwanai/llm-wiki | KnowMe 生态匹配 |
| LLM Wiki 自动编译 | 核心定位：增量构建并维护持久化 Wiki | 基础文档编译 | knowme 和 copilot-app 均以此为核心理念 |
| 知识图谱 | 4-Signal（类型 + 时效 + 置信度 + 源溯） | Canvas 2D 基础力导向图 | copilot-app 含 KG 可视化筛选搜索双向引用 |
| MCP Server | 已 ship，读写双向 HTTP + MCP 协议 | 无 | knowme 定位含"MCP-native agent 记忆/知识层" |
| Review Queue | Async Review System 已 ship | 无 | KnowMe 核心安全机制（审核每一次 LLM 写入） |
| Agent Skills | 已 ship（含 autocli-skill 910 stars） | Claude Code skill 仅包装 CLI | chatgpt-parent-pm、product-experience-reviewer-skill |
| Deep Research | 已 ship | 无 | knowme 生态有深度调研需求场景 |

## 关联度评估

### nashsu/llm_wiki：★★★★★（6/6 全部命中）
六大核心维度与 KnowMe 生态高度同构：LLM Wiki、知识图谱、MCP Server、Review Queue、Agent Skills、Deep Research 全部命中。

### lgwanai/llm-wiki：★☆☆☆☆（~1.5/6）
仅基础文档编译和 2D 知识图谱有重叠。无 MCP Server、无 Review Queue、无 Agent Skills、无 Deep Research。仅 9 commits，成熟度极低。

## 结论

推荐优先调研 nashsu/llm_wiki。784 commits 的成熟项目，六维全命中，Agent Skills/4-Signal KG/Review Queue 架构可直接参考。GPL v3.0 需评估协议兼容性。lgwanai/llm-wiki 暂不建议投入时间。

建议下一步：
1. 本地部署 nashsu/llm_wiki，体验完整功能链路
2. 重点调研 Agent Skills 机制、4-Signal KG 模型、Review Queue 实现
3. 评估 MCP Server 与 knowme 的对接可行性
4. 将 llm_wiki 架构精华吸收到 knowme-ecosystem 蓝图中
