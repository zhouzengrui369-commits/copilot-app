# OpenClaw Workbench 开发测试系统方案 v1.0

> **作者**：Mavis（顶 PM）
> **日期**：2026-06-16
> **来源对话**：本 session（mvs_6835a50b2a234877ad33cc4b16167a1a，2026-06-16 13:14）
> **状态**：草案 v1.0；2026-06-16 已启动最小可用落地（env-start/env-config/ownership contract）
> **关联文档**：`development-gates.json`（v2 → v3 升级）、`PROJECT_OVERVIEW_FOR_VIBE_CODING_v1.2.html`（产品全景）

---

## 一、为什么必须做这个

你现在的工作流是"开发完直接跑"，这导致：

| 风险 | 真实场景 | 后果 |
|------|---------|------|
| **真数据污染** | 改 v3 笔记生成 → 直接打到 22MB 生产 DB | 6/12 那次 Sprint1 修复需要回滚 |
| **验收无据** | "我测过了" 但没截图/没 baseline | 你没法判断好坏 |
| **配置窜扰** | dev 改了 `OPENCLAW_WORKBENCH_PASSWORD` 影响 prod | 一次重启 38888 全坏 |
| **回滚困难** | prod 挂 → 没有"上次好的版本"快照 | 只能凭记忆手动改 |
| **无 SLA** | dev 跑 5 分钟没事 ≠ prod 跑 12h 没事 | autonomy loop 暴露问题 |

---

## 二、3 环境分层（核心架构）

```
┌─────────────────────────────────────────────────────────────┐
│ Environment Tier 架构                                        │
│                                                              │
│  ┌──────────┐    promote     ┌──────────┐    promote    ┌──────────┐ │
│  │   DEV    │ ─────────────► │ STAGING  │ ───────────► │   PROD   │ │
│  │ 38889    │   1.gate ✓     │  38890   │  2.gate ✓   │  38888   │ │
│  │ 假数据    │                │ 真数据副本│              │ 真实数据 │ │
│  └──────────┘                └──────────┘              └──────────┘ │
│       ▲                            ▲                          ▲   │
│       │                            │                          │   │
│    自动跑                        你的截图验收              真实用户用  │
└─────────────────────────────────────────────────────────────┘
```

| 环境 | 端口 | DB | 数据 | 谁能改 | 用途 |
|------|------|----|----|--------|------|
| **DEV** | 38889 | `data/dev.sqlite` | 假数据 / fixture | agent | 改代码、热调试 |
| **STAGING** | 38890 | `data/staging.sqlite` | prod 副本（脱敏） | agent + 你 | 验收、跑 E2E |
| **PROD** | 38888 | `data/workbench.sqlite` | 真实业务 | 只有你审批 | 给真实用户 |

**关键约束**：agent 默认在 DEV 跑，**不会**直接动 STAGING/PROD。要升级必须走 promote 流程。

---

## 三、7 条 Gate 升级（替换原 6 条）

### 3.1 `development-gates.json v3` 提案

```json
{
  "schemaVersion": "openclaw-development-gates/v3",
  "updatedAt": "2026-06-16T00:00:00.000Z",
  "environments": ["dev", "staging", "prod"],
  "gates": [
    {
      "key": "prd_required",
      "label": "PRD 必须存在",
      "required": true,
      "command": "read development_documents.PRD",
      "description": "无 PRD 不进入 build。"
    },
    {
      "key": "prototype_required",
      "label": "原型验收必须存在",
      "required": true,
      "command": "verify prototype screenshot or browser evidence",
      "description": "核心 UI 改动必须先有人工确认原型或截图证据。"
    },
    {
      "key": "test_evidence_required",
      "label": "测试证据必须存在",
      "required": true,
      "command": "npm run check && npm run build && npm run test:prd && npm run test:e2e",
      "description": "无测试证据不进入 release。"
    },
    {
      "key": "security_scan",
      "label": "安全扫描必须通过",
      "required": true,
      "command": "npm run security:scan",
      "description": "外部通知、文件访问和发布动作必须经过安全边界检查。"
    },
    {
      "key": "no_fake_ok",
      "label": "禁止 fake OK",
      "required": true,
      "command": "assert degraded dependencies stay visible",
      "description": "web_search、NAS、MiniMax、gateway 任一不可用时必须显示 DEGRADED 或 BLOCKED。"
    },

    // ===== 新增 1 条：环境隔离强制 =====
    {
      "key": "env_isolation",
      "label": "环境隔离必须强制",
      "category": "engineering",
      "required": true,
      "command": "assert $OPENCLAW_WORKBENCH_ENV in ['dev','staging','prod'] && assert port matches env",
      "description": "禁止跨环境直接改动：dev 改不到 staging/prod，必须走 promote 流程。"
    },

    // ===== 新增 1 条：staging 验收门禁（原 release_approval 升级）=====
    {
      "key": "staging_acceptance_required",
      "label": "Staging 验收必须通过",
      "category": "release",
      "required": true,
      "command": "assert staging_acceptance.evidence_pack exists && assert user_review=ACCEPTED",
      "description": "Promote 到 prod 前，staging 必须跑通：自动化 smoke + 你亲眼看截图拍板 ACCEPTED。"
    }
  ]
}
```

### 3.2 关键差异

| 原 gate | 升级后 |
|---------|--------|
| `release_approval`：笼统"必须审批" | 拆成 **`env_isolation`**（强制环境检查）+ **`staging_acceptance_required`**（必须有你看的截图） |
| 没有"环境"概念 | 强制声明 `$OPENCLAW_WORKBENCH_ENV` ∈ {dev, staging, prod} |

---

## 四、Promote 流程（dev → staging → prod）

```
dev 完成 → 跑 promote:staging
   ↓
[自动] 复制 dev.sqlite → staging.sqlite
[自动] 跑 staging 自动化 smoke（test:prd + test:e2e）
[自动] 生成 evidence pack（截图 + 命令输出 + 测试结果）
   ↓
[人工] 你打开 staging，亲自跑核心路径，看截图
   ↓
   ├─ ACCEPT → 跑 promote:prod
   │            ↓
   │         [自动] 备份 prod.sqlite → data/backups/prod_YYYYMMDD_HHMM.sqlite
   │         [自动] staging.sqlite 复制 → prod.sqlite
   │         [自动] restart server
   │         [自动] 跑 health check + smoke
   │         [自动] 通知你"已上线"
   │
   └─ REJECT → 回 dev 重新改（生成 recovery_packet）
```

**核心原则**：**只有你能点 ACCEPT**，agent 不能自己 promote。

---

## 五、需要新增的代码和脚本

### 5.1 环境启动器（`scripts/env-start.mjs`）

```javascript
// 用法：node scripts/env-start.mjs dev|staging|prod
// 自动设置：端口、DB 路径、password、PIN

const ENV_CONFIG = {
  dev:     { port: 38889, dataDir: '<project>/data/env/dev/data',     password: 'dev-openclaw',     auto_seed: true },
  staging: { port: 38890, dataDir: '<project>/data/env/staging/data', password: 'staging-openclaw', auto_seed: false },
  prod:    { port: 38888, dataDir: '<project>/data',                  password: process.env.OPENCLAW_WORKBENCH_PASSWORD, auto_seed: false }
};

const env = process.argv[2];
if (!ENV_CONFIG[env]) {
  console.error(`❌ Unknown env: ${env}. Must be dev|staging|prod`);
  process.exit(1);
}

const cfg = ENV_CONFIG[env];
process.env.OPENCLAW_WORKBENCH_ENV = env;
process.env.OPENCLAW_WORKBENCH_PORT = cfg.port;
process.env.OPENCLAW_DATA_DIR = cfg.dataDir;
process.env.OPENCLAW_WORKBENCH_PASSWORD = cfg.password;

// 防呆：禁止 prod 跑 dev 脚本
if (env === 'prod' && process.env.OPENCLAW_ALLOW_PROD_OPS !== 'YES-I-KNOW') {
  console.error('❌ Prod 启动需要 OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW');
  process.exit(1);
}

// 启动 server
import('../apps/server/dist/index.js');
```

### 5.2 Promote 脚本（`scripts/promote.mjs`）

```javascript
// 用法：
//   node scripts/promote.mjs dev→staging        // 自动化，无需审批
//   node scripts/promote.mjs staging→prod --user-accept=<证据ID>  // 需要你点过 ACCEPT

const from = process.argv[2];  // "dev→staging" 或 "staging→prod"
const userAccept = process.argv[3];

if (from === 'staging→prod' && !userAccept) {
  console.error('❌ Promote 到 prod 必须提供 --user-accept=<evidence_id>');
  console.error('   先在 staging 验收 → Workbench 后台会生成 ACCEPTED 凭证 → 用凭证 ID 跑 promote');
  process.exit(1);
}

// 1. 备份目标
// 2. 复制源 DB → 目标 DB
// 3. 写 audit log
// 4. 通知（如果有 IM）
```

### 5.3 Staging 验收记录（新增表）

```sql
CREATE TABLE staging_acceptance (
  id TEXT PRIMARY KEY,                    -- 证据包 ID
  env TEXT NOT NULL,                       -- staging
  goal_id TEXT,                            -- 关联的开发目标
  evidence_pack_path TEXT NOT NULL,        -- 截图 + 命令输出 路径
  screenshots_json TEXT NOT NULL,          -- JSON 数组
  automated_smoke_json TEXT NOT NULL,      -- 自动 smoke 结果
  user_review_status TEXT NOT NULL,        -- pending|ACCEPTED|REJECTED
  user_reviewed_at TEXT,
  user_review_notes TEXT,
  promoted_to_prod_at TEXT,                -- promote 时间
  created_at TEXT NOT NULL
);
```

### 5.4 package.json 新增脚本

```json
{
  "scripts": {
    "env:dev":     "node scripts/env-start.mjs dev",
    "env:staging": "node scripts/env-start.mjs staging",
    "env:prod":    "OPENCLAW_ALLOW_PROD_OPS=YES-I-KNOW node scripts/env-start.mjs prod",

    "promote:staging": "node scripts/promote.mjs dev→staging",
    "promote:prod":    "node scripts/promote.mjs staging→prod",

    "seed:dev":        "node scripts/seed-dev-data.mjs",
    "snapshot:prod":   "node scripts/snapshot-prod-to-staging.mjs",
    "rollback:prod":   "node scripts/rollback-prod.mjs"
  }
}
```

---

## 六、改动优先级（2 周落地）

| Week | 任务 | 谁做 |
|------|------|------|
| **W1 Day 1-2** | 写 env-start.mjs + 3 套 DB fixture | agent |
| **W1 Day 3** | 改 development-gates.json v3（加 2 条新 gate） | agent |
| **W1 Day 4-5** | server 端加 env 校验（拒绝跨环境写） | agent |
| **W2 Day 1-2** | promote.mjs + staging_acceptance 表 | agent |
| **W2 Day 3-4** | Web 端加 "Promote" 按钮（你点 ACCEPT 的地方） | agent |
| **W2 Day 5** | 跑一遍真实 promote：dev → staging → 你看 → ACCEPT → prod | 你 + agent |

---

## 七、对 Vibe Coding 的变化

### 7.1 之前

> "帮我修笔记生成慢" → agent 改 → 直接生效

### 7.2 之后

> "帮我修笔记生成慢" → agent 在 DEV 改 → 跑 staging → 给你截图 → 你看 → ACCEPT → agent 自动 promote 到 prod

### 7.3 你需要新增的习惯

1. **多一句"在 dev 跑"或"在 staging 验收"** — 让 agent 知道环境
2. **看截图拍板 ACCEPT/REJECT** — 这是新习惯，但比直接信任"已完成"安全 100 倍
3. **每次 promote 到 prod 前，自动收到通知** — 你不用盯着

---

## 八、立即可做的最小改动（1 天搞定）

如果你想**今天就动**，不用等 2 周：

```bash
# 1. 备份当前项目内 DB
PROJECT_ROOT=/Users/njx/openclaw/copilot
mkdir -p "$PROJECT_ROOT/data/backups"
cp "$PROJECT_ROOT/data/workbench.sqlite" \
   "$PROJECT_ROOT/data/backups/prod_backup_20260616.sqlite"

# 2. 复制一份当 dev DB
mkdir -p "$PROJECT_ROOT/data/env/dev/data"
cp "$PROJECT_ROOT/data/workbench.sqlite" \
   "$PROJECT_ROOT/data/env/dev/data/workbench.sqlite"

# 3. 改 server 端口启动（dev 用 38889）
OPENCLAW_WORKBENCH_PORT=38889 \
OPENCLAW_DATA_DIR="$PROJECT_ROOT/data/env/dev/data" \
OPENCLAW_WORKSPACE="$PROJECT_ROOT/data/env/dev/workspace" \
npm start &

# 4. 浏览器开 http://127.0.0.1:38889 → 验收 dev 改动
# 5. OK 之后手动：
cp "$PROJECT_ROOT/data/env/dev/data/workbench.sqlite" \
   "$PROJECT_ROOT/data/workbench.sqlite"
```

这是**手动版**的 dev/staging/prod 分层。要自动化就需要上面 5.1-5.4 的脚本。

---

## 九、PM 建议（待 NJX 拍板）

**我建议直接做完整版**（2 周），理由：

1. 你 Sprint2+ 会有更多 dev 任务（NLU 升级、Recovery Packet 等），**手动切换 DB 容易出错**
2. **staging_acceptance 表**会让所有改动有可追证据，跟你"重视审计"的风格一致
3. **Promote 自动化**会把你从"每次手动 cp 文件"里解放出来
4. 一次性投入 2 周，长期省时间（每次改代码省 5-10 分钟手动操作 + 风险）

### 待 NJX 决策

- [ ] 启动完整 2 周 sprint（env-start.mjs + promote.mjs + staging UI）
- [ ] 先做最小版（1 天，手动分层）
- [ ] 再想想（不急）

### 决策影响

| 选项 | 投入 | 风险 | 长期收益 |
|------|------|------|----------|
| 完整 2 周 | 10-14 天 agent 时间 | 中（改 server + 5 个脚本） | 高（每次改代码省事 + 审计可追） |
| 最小 1 天 | 1 天 agent 时间 | 低（只动 DB 副本） | 低（手动 cp 烦但能跑） |
| 不做 | 0 | 高（继续裸跑 prod） | 负（继续出事故） |

---

## 十、附录：本对话沉淀的两份资产

本 session 共产出 2 份可归档资产（都在 `/Users/njx/openclaw/copilot/`）：

1. **`PROJECT_OVERVIEW_FOR_VIBE_CODING_v1.1.html`** — 项目全景介绍（12 章节，给非程序员的 vibe coding 入门）
2. **`DEV_TEST_SYSTEM_v1.0.md`**（本文件）— 开发测试系统方案（3 环境分层 + 7 条 gate 升级 + promote 流程）

---

*本文档由 Mavis 于 2026-06-16 13:27 起草，作为开发测试系统的 v1.0 方案。待 NJX 拍板启动 sprint。*
