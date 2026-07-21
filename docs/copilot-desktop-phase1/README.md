# Copilot Desktop Phase 1 文档 v0.1

状态：**DOCS V0.1 ACCURACY REPAIRED / STATIC ONLY / MVP NOT COMPLETE**

基线：仓库根目录 `goal.md`、`plan.md`、`rules.md`、`delivery.md` v6.2

更新时间：2026-07-15（Asia/Shanghai）

本目录是 `plan.md` T-1.4.6 的内部文档草案。内容可以用于开发、评审和最终候选验收准备，但**不能证明 Phase 1 已完成或可发布**。

项目与状态总入口：[根 README](../../README.md)；安全与报告边界：[SECURITY](../../SECURITY.md)。这两个根文档是项目/安全事实入口，但不替代本目录的开发文档、用户手册和视频教程脚本三类交付物。

## 文档入口

- [开发文档](DEVELOPMENT.md)：local-first 架构、模块边界、开发命令、质量门和故障定位。
- [用户手册](USER-MANUAL.md)：安装前检查、首次使用、Knowledge / Ask / Voice / Schedule / Settings 与隐私兜底。
- [视频教程脚本](VIDEO-TUTORIAL-SCRIPTS.md)：4 个可按步骤录制的教程脚本。

## 当前发布状态

当前 Phase 1 MVP 只以 macOS final candidate 收口。以下门禁未闭环，因此所有安装、模型、语音和云服务步骤都必须在新的、同一份 macOS 最终签名候选上复验：

- macOS Developer ID 签名、公证、staple 与 Gatekeeper 验证；
- 同一 macOS final candidate 上规定覆盖率、集成测试、至少 50 条真实 Electron E2E、candidate-bound 性能和 3 轮正式 verify-fix；
- 同一 macOS final candidate 的真机流程截图、可安装包、SHA256 与身份链；
- live 模型、腾讯云无状态边界和 NS1-NS3 真实使用数据；
- owner 批准的 clean commit、最终 SHA256 清单与 `delivery.md` 签字。

Windows 原生运行、签名、安装和截图是 `OWNER-DEFERRED`，移至 MVP 后的 Phase 1.1；它们不阻塞当前 MVP，也尚未交付。现有 Windows 源码/配置只能作为 Phase 1.1 输入。

当前诊断候选（包括 r30）均为 dirty、unsigned、consumed 的内部证据，不是下载或安装推荐。

## Phase 1 边界

Phase 1 是严格 local-first、当前 macOS-first 验收的 Electron App：笔记、KB、KG、RAG 索引和日程以本机为真值；腾讯云只允许承担无状态 LLM 代理、远程管理指令转发和用户显式开启的可选备份。当前 Backup/Remote 的生产腾讯配置、issuer mount、TLS/WSS 与 readiness 仍未关闭，不能描述为已部署或可用；App footer 仍必须如实显示 `Cloud backup: UNAVAILABLE (metadata-only)`。

截图、视频、candidate ID、包名、SHA256、签名和公证结果当前统一标记为 `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。任何占位文字都不是文件路径、图像、PASS 或交付证据。

本目录不覆盖 3D 图谱、mobile/web 客户端、多用户/多租户、商业化、插件、i18n、端侧 LLM 或已退役的 njx-knowledge Sprint 2。
