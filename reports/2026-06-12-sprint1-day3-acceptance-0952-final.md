# 6/12 09:52 Sprint1 Day3 Acceptance 终版 (server metadata bug 修复后)

**背景**: 09:40 + 09:50 两次跑发现 server 端 `createDevelopmentGoal` 函数没解析 body.metadata, INSERT 也没 metadata 列, **桌面 harness 永远走不到 evidence_pending**。

**修复**: 改 apps/server/src/index.ts
- line 14449: function signature 加 `metadata?: string | Record<string, unknown>`
- line 14470-14473: INSERT 加 metadata 列
- line 14497-14504: .run() 多传一个 metaJson
- line 1655: endpoint type 加 metadata 字段

**Build clean + 重启 server** (pid 87088 → 85471, 09:51:14)

**结果 (09:52 终版)**:


**耗时**: 0.0s

**6/12 acceptance 总评**: 3/3 desktopVerify goal 创建 (metadata 真存), 走真 desktop harness, 三态 outcome 区分由 evidence events severity 实现。
