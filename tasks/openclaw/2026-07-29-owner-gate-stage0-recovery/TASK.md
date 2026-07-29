# TASK — Owner Gate Stage 0 Recovery

## 目标

1. 以 GitHub `main@96c861706126317c27965fcb64c765973df9ac89` 为 Git
   基线；
2. 将已独立验收的 r3 Desktop 产品层快照精确 materialize 到当前干净
   工作区；
3. 保持评审报告为独立事实引用，不把评审分支误作产品代码；
4. 创建/更新交接治理面，使新 AI 可从 README、PROJECT_STATE、
   PROJECT_STATUS、TODO、docs 在十分钟内接手；
5. 输出可由 Codex 独立验收的 RESULT/EVIDENCE/commands/changed-files。

## 固定输入

- 工作区：
  `/Users/njx/openclaw/copilot.wt-S15C`
- 当前分支：
  `codex/p0-owner-gate`
- 固定 GitHub base：
  `96c861706126317c27965fcb64c765973df9ac89`
- r3 snapshot task：
  `/Users/njx/openclaw/copilot/.worktrees/exp-cop-p0/tasks/openclaw/2026-07-28-current-desktop-source-snapshot-r3`
- r3 manifest SHA256：
  `3425aba76d6d79b326b11b178ec96ad306ac8364feba84420f5ce9a2de812ec4`
- r3 aggregate：
  `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`
- r3 counts：
  `414 files / 7 tracked deletions / 51,347,389 bytes`
- r3 independent verdict：
  `SNAPSHOT_POSTIMAGE=PASS / MATERIALIZATION_INPUT_AUTHORIZED=YES`
- latest product review PR：
  `https://github.com/zhouzengrui369-commits/copilot-app/pull/9`
- latest focused report：
  `https://github.com/zhouzengrui369-commits/copilot-app/blob/31dfd0c7f9feca77da82f4a02bf359d85818742c/reports/product-review/2026-07-28-copilot-focused-retest.md`
- review verdict：
  `NOT_READY / BLOCKED_EXP_COP_008 / P0=1 / P1=6 / P2=3`
- ecosystem SSoT：
  `zhouzengrui369-commits/knowme-ecosystem@965713b81a726279f63527eb17979f5e768423c1`
- ecosystem version：
  `0.2.0`

## 允许修改

仅限：

1. r3 `SOURCE_SNAPSHOT_MANIFEST.json` 的 scope 中声明的 Desktop/product
   文件与目录，内容必须等于 r3 snapshot；
2. 根目录：
   - `README.md`
   - `PROJECT_STATE.yaml`
   - `PROJECT_STATUS.md`
   - `TODO.md`
   - `CHANGELOG.md`
   - `DECISIONS.md`
3. `docs/ARCHITECTURE.md`
4. 本 task 目录。

## materialization 要求

1. 先复核当前 HEAD、branch、clean status（本 task 目录除外）和 r3
   manifest SHA；任一不符即 fail-closed。
2. 读取 manifest scope 与 snapshot/source：
   - exact files 精确覆盖；
   - recursive roots 以 snapshot 为完整镜像，目标中 snapshot 不存在的
     普通文件必须删除；
   - root pattern/package root pattern 必须与 snapshot membership 一致；
   - manifest 声明的 7 个 tracked deletions 必须在目标不存在。
3. 禁止复制 `node_modules`、dist、release、coverage、userData、logs、
   screenshots 或 runtime evidence。
4. materialize 后必须重新计算 414 个 member 的路径、mode、size、SHA256，
   复核总数、总字节和 aggregate；不得只相信复制命令成功。
5. 生成 task-owned `MATERIALIZED_SOURCE_MANIFEST.json`，绑定：
   GitHub base、branch、r3 manifest/aggregate、最终 member aggregate、
   deletions、工作区状态（预期 dirty，尚未 commit）、时间。

## 治理文档要求

### PROJECT_STATE.yaml

至少包含：

- project
- stage
- verdict
- default_branch_head
- active_branch
- active_candidate_commit
- artifact_sha256
- runtime_id
- ecosystem_baseline_commit
- current_p0
- current_p1
- release_gate
- next_single_action
- updated_at

当前必须保持：

- `verdict: BLOCKED`
- `active_candidate_commit: null`
- `artifact_sha256: null`
- `runtime_id: null`
- `release_gate: HUMAN_OWNER_GATE_NOT_ELIGIBLE`
- `MVP_NOT_COMPLETE`

### README.md

只按权威 SSoT 引用增加 `## Ecosystem Baseline`：

- repository：`zhouzengrui369-commits/knowme-ecosystem`
- version：`0.2.0`
- commit：完整 `965713b...`
- review date：`2026-07-29`
- deviations：`None`

不得自行重写 Copilot 生态定位。记录生态仓缺失其自身
`docs/acceptance` 权威路径为治理风险，不得修改 Copilot 的评审 Core/Profile。

### PROJECT_STATUS / TODO / ARCHITECTURE / CHANGELOG / DECISIONS

必须以最新 GitHub/评审事实覆盖旧 H 门状态：

- 当前阶段：Owner Gate P0 Closure / Stage 0 truth recovery；
- P0：EXP-COP-008；
- P1 首要：EXP-COP-009；
- 当前 branch/base；
- r3 只是产品层快照输入，不是候选 PASS；
- 旧 source/runtime ID 不可复现，禁止复用；
- 下一单一动作：冻结 Stage 0 base commit 后关闭 EXP-COP-008 Todo
  false-success/discoverability/readback 与 EXP-COP-009 Ask source-return
  continuity；
- 不开展 Windows、Remote/Backup 扩展、大版本依赖升级、视觉大改。

重大决策写入 DECISIONS：

1. GitHub main 是 Git 基线，r3 是新候选产品层输入；
2. 使用已存在干净工作区，不新增 worktree；
3. 由于当前产品具备/将补齐 All/Unscheduled 可发现入口，本轮保留
   unscheduled Todo 路线，但成功必须 canonical readback、查看/编辑、重启
   可找回；
4. 独立 Focused Retest 才能使 Human Owner Gate eligible。

## 禁止事项

- 不修改 `/Users/njx/openclaw/copilot` 原始 dirty 工作树；
- 不修改 `.worktrees/exp-cop-p0`；
- 不复制旧 EXP-COP-008 overlay 字节；
- 不修 P0/P1 产品逻辑；
- 不运行 tests/typecheck/build/Electron/package；
- 不安装依赖；
- 不 Git add/commit/push/PR；
- 不改凭据、SSH、remote、全局配置；
- 不修改评审 Core/Profile/报告；
- 不读取或输出 Secret；
- 不宣称 candidate/release/MVP ready。

## 必跑只读/本地验证

1. pre HEAD/branch/status；
2. r3 manifest SHA；
3. snapshot independent verdict；
4. materialized membership/path/mode/size/SHA/bytes/aggregate 验证；
5. `git diff --check`；
6. focused `git status --short` 与 changed file list；
7. 非敏感 secret pattern 扫描，仅输出命中路径/规则，不输出候选秘密内容。

## 交付

- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `changed-files.txt`
- `MATERIALIZED_SOURCE_MANIFEST.json`
- 完整治理文档

## 验收

只有同时满足以下条件才可写 `STAGE0_MATERIALIZATION_PASS`：

- GitHub base/branch 正确；
- r3 414 files / 7 deletions / bytes / aggregate 全部匹配；
- 治理文档反映最新 P0/P1 与门禁；
- 无范围外修改；
- diff check 和非敏感扫描通过；
- 明确 `COMMIT_PENDING / MVP_NOT_COMPLETE`。
