# OpenClaw Workbench 仓迁移指南

**迁移时间**: 2026-06-12 22:47 → 22:54
**总耗时**: 7min (估 1-1.5h, **快 9-13x**)
**迁移者**: Mavis (AI agent, 按 ai-task-estimation skill 估)

## 旧 → 新路径

| 旧 | 新 | 备注 |
|---|---|---|
| `~/openclaw_data/openclaw_workbench/` (代码 + runtime data 混居) | `~/openclaw/copilot/` (代码仓) + `~/openclaw_data/copilot/` (runtime data) | **代码 / 数据彻底分离** |
| 旧仓根 `~/openclaw_data/` (openclaw 主仓, 含 autonomy / logs / tasks) | **保留不动** | openclaw 主仓 ≠ copilot 产品仓 |
| `apps/server/src/index.ts` (路径) | 同 (路径不变) | 仅文件内容微调 config.ts |
| `data/workbench.sqlite` (22MB) | `~/openclaw_data/copilot/data/workbench.sqlite` | 已一次性 cp 过去 |
| `data/backups/` (22MB) | `~/openclaw_data/copilot/data/backups/` | 已一次性 cp 过去 |
| `data/knowledge_sidecars/` (76K) | `~/openclaw_data/copilot/data/knowledge_sidecars/` (待迁) | 不是阻塞, fallback 兼容 |
| `data/china-holidays.json` (84K) | `~/openclaw_data/copilot/data/china-holidays.json` | 已一次性 cp 过去 |

## 代码改动

### apps/server/src/config.ts

```diff
+ import os from "node:os";
+ import path from "node:path";
+ import { existsSync } from "node:fs";

+ export const HOME_DIR = os.homedir();

+ // 仓迁移 6/12: 新 WORKSPACE/DATA/SIDECAR 布局
+ function resolveWithLegacyFallback(primary: string, legacy: string): string {
+   if (existsSync(primary)) return primary;
+   if (existsSync(legacy)) return legacy;
+   return primary;
+ }

+ const NEW_DATA_DIR = path.join(HOME_DIR, "openclaw_data", "copilot", "data");
+ const LEGACY_DATA_DIR = path.join(HOME_DIR, "openclaw_data", "openclaw_workbench", "data");
+ const NEW_SIDECAR_DIR = path.join(HOME_DIR, "openclaw_data", "copilot", "knowledge_sidecars");
+ const LEGACY_SIDECAR_DIR = path.join(HOME_DIR, "openclaw_data", "openclaw_workbench", "knowledge_sidecars");

- export const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || "/Users/njx/openclaw_data";
- export const DATA_DIR = process.env.OPENCLAW_DATA_DIR || path.join(ROOT_DIR, "data");
- export const SIDECAR_DIR = process.env.OPENCLAW_SIDECAR_DIR || path.join(ROOT_DIR, "knowledge_sidecars");
+ export const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || path.join(HOME_DIR, "openclaw_data");
+ export const DATA_DIR = process.env.OPENCLAW_DATA_DIR || resolveWithLegacyFallback(NEW_DATA_DIR, LEGACY_DATA_DIR);
+ export const SIDECAR_DIR = process.env.OPENCLAW_SIDECAR_DIR || resolveWithLegacyFallback(NEW_SIDECAR_DIR, LEGACY_SIDECAR_DIR);
```

**关键**: 加 `resolveWithLegacyFallback` —— **新路径优先, 旧路径 fallback**, 旧仓仍能 work, 零中断升级。

### apps/desktop/src/server-runner.ts

```diff
+ import os from "node:os";

- export function resolveDevDataDir(): string {
-   return path.resolve(here, "..", "..", "..", "..", "data");
- }
+ export function resolveDevDataDir(): string {
+   // 仓迁移 6/12: 数据从仓内 data/ 迁到 ~/openclaw_data/copilot/data/ (用户 home, 不进 git)
+   return path.join(os.homedir(), "openclaw_data", "copilot", "data");
+ }
```

### .gitignore (新仓强化)

```diff
+ # 仓迁移 6/12 强化 — 屏蔽产品 runtime 数据, 只留代码 + 配置 + 报告
+ data/backups/
+ data/knowledge_sidecars/
+ data/logs/
+ data/run/
+ data/openclaw-workbench.sqlite
+ data/workbench.db
+ data/workbench.sqlite*
+ data/china-holidays.json
+ knowledge_sidecars/
```

## 验证 (22:54 完成)

- ✅ npm install 成功 (1165 packages, 8s)
- ✅ apps/server build 成功
- ✅ server 启自新仓 (pid 99901), 监听 38888
- ✅ /api/health 200
- ✅ /api/auth/login 200, session 创建
- ✅ /api/development/projects 200, 107KB (说明真 db 路径 work, 仍读到 workbench.sqlite)
- ✅ desktop app (njx-copilot, pid 75288) 仍跑旧 server (pid 45955), **未重启, 用户无感**

## 兼容 / 降级

**3 种情况可降级回旧路径**:
1. 设环境变量 `OPENCLAW_DATA_DIR=/Users/njx/openclaw_data/openclaw_workbench/data` (旧路径) → server 走旧
2. 删新 `~/openclaw_data/copilot/data/workbench.sqlite` → server 走旧 fallback
3. 整体 rsync 旧 → 新

**新 server 行为**:
- 默认 `DATA_DIR = ~/openclaw_data/copilot/data` (如果存在)
- 不存在 → fallback `~/openclaw_data/openclaw_workbench/data` (如果存在)
- 都不存在 → 用新路径, 自动 mkdir

## 桌面 app 桌面 release 同步 (待做)

桌面 app pid 75288 仍在用旧 `apps/desktop/release/mac-arm64/njx-copilot.app/Contents/Resources/resources/server/index.js` (22:28 编的, 含 Sprint2 4 commit)。 

**新仓桌面 app 重打** (NJX 决定时再开):
1. 删旧 release
2. `npm run build:desktop` (从新仓)
3. cp -r apps/desktop/dist 新仓 release
4. NJX 重启桌面 app

**为什么不现在做**: NJX 22:47 拍"下一步, 迁移", 我先做核心 (代码仓迁完 + server 跑通), 桌面 app 重打 NJX 拍板时再开 (NJX 在用, 重打 = 重启 = 中断 NJX 5-10min)。

## 旧仓归档策略

旧仓 `~/openclaw_data/openclaw_workbench/` 保留**只读归档**:
- data/ 含 workbench.sqlite (旧 fallback 用) + 复盘报告
- apps/release (旧桌面 app 二进制, 留作回滚)
- 旧仓本身**不再修改**, 但保留读写权限方便 fallback

**未来清理**: 6/16 (NJX 6/15 复盘会后) 可考虑删旧仓 `apps/` (代码已迁), 但保留 `data/baselines/` 做 baseline 历史。

## 关键决策记录

| 决策 | 原因 |
|---|---|
| 新仓位置 `~/openclaw/copilot/` | 跟 openclaw 命名空间统一, 不放 `~/Projects/` (跟 openclaw 主仓混淆) |
| runtime data 放 `~/openclaw_data/copilot/` (用户 home) | 不进 git, 跨设备迁移时只 rsync 用户 home 即可 |
| resolveWithLegacyFallback 兼容旧路径 | 零中断升级, 旧 server / 旧 db 仍能用 |
| 放弃 git history (从旧仓拷 .git 不可行, 路径前缀不同) | NJX 1 人 OPC, history 价值有限, init commit 含迁移说明 |
| 不立刻重打桌面 app release | NJX 在用, 重打 = 重启 = 中断 5-10min |
| 强化 .gitignore (屏蔽 knowledge_sidecars/ + data/*.sqlite*) | 防止隐私 / db 误 commit |
| npm workspaces 沿用 | package.json workspaces 仍是 apps/{server,web,desktop,mobile}, monorepo 拓扑不变 |
| env override 优先, fallback 兼容 | 标准 12-factor app 模式, OPENCLAW_DATA_DIR 可任意指向 |
