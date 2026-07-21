# njx-copilot (macOS desktop app)

> Electron shell for **OpenClaw Workbench**.
> App / bundle id: `njx-copilot` · Product name: `OpenClaw Workbench`

v0 scope — four pages in priority order:
1. **Dashboard** — `/agent` (智能体页面, Agent Operator Console v3)
2. **智能助理** — `/assistant`
3. **知识库** — `/knowledge`
4. **开发台** — `/tasks` + `/projects` (任务 + 项目中心)

Other web pages remain accessible in v0 (the Electron shell loads the full
existing web build) but the four above are the focus of QA and visual polish.

---

## 架构

```
+----------------------- njx-copilot.app -----------------------+
|                                                               |
|  Electron main (Node)                                         |
|    ├── app.setName("njx-copilot")  ← Dock / Cmd+Tab 名字      |
|    ├── ServerRunner  ── spawns ──▶  Node child process         |
|    │                                    │                     |
|    │                                    ▼                     |
|    │                          Fastify server (port 38888)     |
|    │                                    │                     |
|    └── BrowserWindow  ◀─ loads ─────────┘ (renderer)          |
|            (sandbox, contextIsolation, no nodeIntegration)     |
|                                                               |
+---------------------------------------------------------------+
```

- Renderer 不直接访问 `~/.openclaw/`，所有 API 经 server
- Server 用 `--experimental-sqlite` 子进程跑现有 `apps/server/dist/index.js`
- 零行 server 代码被修改；Web dist 原样复用
- 单端口 38888（与现有 web 模式完全一致）

## 开发

```bash
# 在仓库根目录一次性装依赖
npm install

# 进入 desktop 工作区
cd apps/desktop
npm install

# 启动 dev：自动 build server（如缺）、拉起 server 子进程、再起 Electron
npm run dev:desktop

# 想用 Vite HMR 调试前端（可选）：
#   终端 A:  npm run dev:web          # vite dev on :38889
#   终端 B:  NJX_COPILOT_LOAD_VITE=1 npm run dev:desktop
```

> ⚠️ 当前 Electron 主进程用 sandbox + contextIsolation。preload 暴露的
> `window.njxCopilot` 表面刻意做得很小，仅供未来原生桥接（badge /
> notifications / tray）使用，**不**用来替代 `fetch('/api/...')`。

## 打包

```bash
cd apps/desktop
npm run dist:mac           # arm64 + x64 universal DMG（未签名）
npm run dist:mac:arm64     # 仅 Apple Silicon
npm run dist:mac:x64       # 仅 Intel
```

产物：`apps/desktop/release/njx-copilot-0.1.0-arm64.dmg` 等。

⚠️ `electron-builder.yml` 显式 `identity: null`，**不打 Developer ID 签名、不
做 Apple Notarization**——这是 v0 决定，理由是 Mac mini 内部分发 + 用户手动
右键打开就够，正式分发前必须补签名 + 公证（见下方 TODO）。

## v0 未做（明确范围之外）

| 主题 | 状态 | 备注 |
|------|------|------|
| Developer ID 签名 | ❌ | `identity: null` |
| Apple Notarization | ❌ | 未配 notarize 脚本 |
| 自动更新 | ❌ | 未集成 electron-updater / Squirrel |
| Tray icon | ❌ | 仅 Dock icon |
| 托盘菜单 | ❌ | — |
| Spotlight 集成 | ❌ | — |
| Deep Link (`njx-copilot://`) | ❌ | — |
| 窗口状态记忆 | ❌ | 简单 BrowserWindow 默认；v1 接入 `electron-store` |
| 自定义 Dock 角标（任务数） | ❌ | IPC 已留位，未订阅 |
| 菜单栏 Touch Bar | ❌ | — |
| ARM + x64 universal binary | ❌ | 当前是 fat DMG（两架构各一个 .app） |
| 公网访问（Tailscale/反代） | — | 跟随 OpenClaw Workbench 既有运维文档 |

## 已知风险 & 后续

- **Server 路径硬编码**：server 的 `config.ts` 用 `import.meta.url` 解析
  `apps/web/dist`，packaged 模式下需要给它注入 `ROOT_DIR` / `WEB_DIST_DIR`
  覆盖。建议 v1 给 server 加一个 `OPENCLAW_WEB_DIST_DIR` 环境变量入口。
- **SQLite 路径**：dev 沿用 `apps/desktop/data/`（和工作台根 data/ 同源），
  packaged 模式切到 `~/Library/Application Support/njx-copilot/workbench-data/`。
  这条线需要在 server 端加 env 覆盖。
- **单实例锁**：已启用 `app.requestSingleInstanceLock()`，第二次点 Dock
  聚焦已有窗口。launchd 守护化时需要去掉单实例锁或换成 IPC 拉起。
- **Electron 版本**：33.x（Node 20 内核）。server 跑的是系统 Node 24，
  两者解耦。

## 验证清单（接 PRD gate 用）

- [ ] `npm run check`（apps/desktop）
- [ ] `npm run build`（apps/desktop）
- [ ] `npm run dev:desktop` 启动，窗口在 Dock 显示 **njx-copilot**
- [ ] 标题栏显示 **OpenClaw Workbench**
- [ ] 4 个 v0 页面均可加载、无 console error
- [ ] 退出 app 时 server 子进程被回收（`lsof -iTCP:38888 -sTCP:LISTEN` 应无残留）
- [ ] `npm run health` 在 server 启动后返回 ok
- [ ] `npm run dist:mac` 产物可双击挂载、拖入 /Applications、启动

## 命名约束

- 启动台 / Dock / Cmd+Tab: `njx-copilot`
- `app.setName('njx-copilot')` / `app.setAppUserModelId('ai.njx.copilot')`
- `Info.plist` 的 `CFBundleDisplayName` = `njx-copilot`
- 窗口标题 (`BrowserWindow({ title })`) = `OpenClaw Workbench`
- About 面板 (`role: 'about'`) = `njx-copilot`（macOS 模板）
- 在 web 端的页脚 / `index.html` `<title>` 保持 `OpenClaw Workbench`
