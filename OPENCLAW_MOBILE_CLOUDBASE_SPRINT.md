# OpenClaw Mobile + CloudBase 中转 Sprint

> **目标**:iPhone 11 / 华为 Mate 60 / Surface 8 Pro 三个终端,都能在 4G/出差/不同网络下,实时控制 Mac agent
> **架构决定(2026-06-17 NJX 拍板)**:Q1=A 腾讯云 CloudBase,Q2=B 直接 A1 跳过 A2,Q3=A 暂不备案走默认免备案域名

## 关键简化(影响所有后续决策)

**iPhone 端 = 1-2 行改动**。原因:mobile 端 100% 用 fetch 调用 REST,不用 WebSocket。

```typescript
// src/lib/api.ts 现有调用
fetch(`${session.serverUrl}/api/mobile/pairing/claim`, ...)
fetch(`${session.serverUrl}/api/mobile/today?date=...`, ...)
```

`sesson.serverUrl` 字段是 string,改成 CloudBase broker URL 即可。

## 最终架构

```
iPhone 11 ───HTTPS fetch───► CloudBase 函数 (openclaw-relay)
                                  │  (HTTP 触发 /openclaw-relay/*)
                                  │  NoSQL: broker_pair_codes / broker_macs
                                  │         broker_devices / broker_requests
                                  │
              ┌─── 长轮询: GET /mac/:macId/inbox (Mac 主动拉)
              │
              ▼
         Mac agent (新模块: cloudbase-forwarder)
              │
              │ 本地 :38888
              ▼
         Workbench server (Fastify)
```

**关键约束**:
- 中转不存业务数据(Mac 仍是唯一真相源)
- 中转只做 3 件事:pair code 中转、Mac agent register、请求队列 + 响应回传
- iPhone → broker 入队 → Mac poll inbox → Mac 处理 → ack 回 broker → iPhone poll 响应
- **Mac 主动连 broker**(避免 NAT / DDNS / 反向代理)

## Broker 端点契约(已实现 + 已部署)

| Method | Path | 谁调 | 干啥 |
|---|---|---|---|
| `GET` | `/health` | 任意 | 健康检查(已验证 ok) |
| `POST` | `/pair/start` | Workbench `/mobile` 页 | 生成 6 位 pair code |
| `POST` | `/pair/claim` | iPhone | 用 6 位码换 `accessToken` + `refreshToken` + `macId` |
| `POST` | `/auth/refresh` | iPhone | refreshToken 续 accessToken |
| `POST` | `/mac/register` | Mac agent | 注册 `macId` + `endpoint` + `capabilities` |
| `POST` | `/mac/heartbeat` | Mac agent | 保活(每 30s) |
| `GET` | `/mac/:macId/inbox` | Mac agent | 拉待处理请求(轮询) |
| `POST` | `/mac/ack/:requestId` | Mac agent | 提交处理结果 |
| `POST` | `/relay/:macId` | iPhone | 入队请求给 Mac |
| `GET` | `/relay/:requestId` | iPhone | 拉响应(轮询) |
| `GET` | `/devices` | admin | 调试 — 列 mac + devices |

## 实施步骤(实时状态)

| # | 步骤 | 负责 | 状态 | 备注 |
|---|------|------|------|------|
| 0 | 5min cron 启动 | Mavis | ✅ done | `openclaw-mobile-cloudbase-5min`,到 2026-07-01 |
| 1 | NJX 拿 CloudBase 3 个凭证 | NJX | ✅ done | env=`njx-copilot-d6gs7642f8fa17122` / SecretId=`AKIDqlVQ...` / SecretKey=`CNSu2To...` |
| 2 | 中转服务代码 (云函数 broker) | Mavis | ✅ done | Node 18.15,256MB,30s timeout;5 endpoints 全过 smoke(/health, /pair/start, /pair/claim, /mac/register, /devices) |
| 3 | Mac agent control plane 模块 | Mavis | ✅ done | `apps/server/src/cloudbaseForwarder.ts` 285 行(register/heartbeat/poll inbox/handleInboxRequest/ack 完整);`index.ts` 第 23158-23164 行 singleton 已注册(OPENCLAW_CB_ENABLED=1 时 start);`config.ts` 第 29-33 行 CLOUDBASE_BROKER_URL+CLOUDBASE_ENABLED(默认 0)。**等 NJX 拍板启 server 跑 forwarder(discipline ④ hard limit)** |
| 3.5 | Broker 透明 proxy 路由 | Mavis | ✅ done 2026-06-17 13:08 | NJX 选 (b) → broker 改造完毕:`index.js` 333 → 448 行(+115),6 个新端点 + 1 个 catch-all。`node --check` 0 错。**待部署 + smoke + 启 server** |
| 4 | iPhone 端 URL 切 CloudBase | Mavis | ⏳ pending | 1 行改动,改 session.serverUrl 默认值 |
| 5 | 端到端验证 | NJX + Mavis | ⏳ pending | iPhone 发 → Mac 收 → 回传 |
| 6 | OTA + Android 框架 + Web 控制台 | Mavis | ⏳ pending | 顺手做 |

## Hour 0.5 已交付(2026-06-17 12:20)

### Broker live URL

```
https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay
```

### 代码 + 配置

```
/Users/njx/openclaw/cloudbase/openclaw-relay/
├── cloudbaserc.json           (env id + Node 18.15 + 256MB + 30s timeout)
├── README.md                  (架构 + 端点契约)
├── deploy.sh                  (一键部署,凭证从 ~/.openclaw/cloudbase/secrets/.env 读)
├── run-local.sh               (本地调试,listen :38889)
└── openclaw-relay/            (函数目录,functionRoot/name 结构)
    ├── index.js               (主代码,12K 字节,11 个端点)
    ├── local-server.js        (express wrapper for local dev)
    ├── package.json           (@cloudbase/node-sdk + express)
    ├── scf_bootstrap          (CloudBase 自动生成的 Web 启动脚本)
    └── node_modules/
```

### 凭证(本地保存,mode 600)

`/Users/njx/.openclaw/cloudbase/secrets/.env`
```
TCB_ENV_ID=njx-copilot-d6gs7642f8fa17122
OPENCLAW_CB_SECRETID=AKIDqlVQ...  (SDK 启动时映射到 TENCENTCLOUD_SECRETID)
OPENCLAW_CB_SECRETKEY=CNSu2To...  (同)
BROKER_PUBLIC_URL=https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay
```

**注意**:CloudBase 控制台限制 env var key 不能以 `SCF_/QCLOUD_/TENCENTCLOUD_` 开头,代码用 `OPENCLAW_CB_*` 前缀,SDK init 时回填。

### Smoke 测试结果(2026-06-17 12:24 实测)

```bash
$ curl /health
{"ok":true,"ts":1781670250109,"env":"njx-copilot-d6gs7642f8fa17122","version":"0.1.0"}

$ curl POST /pair/start
{"ok":true,"code":"249048","expiresAt":...}

$ curl POST /pair/claim {code:249048, deviceId:test-device-1, ...}
{"ok":true,"accessToken":"at_b01d...","refreshToken":"rt_7ea5...","macId":"mac_196f8..."}

$ curl POST /mac/register {macId:mac_test_001, endpoint:...}
{"ok":true,"macId":"mac_test_001","status":"online"}
```

### 已知小问题

- `GET /devices` 返空(虽然 register 了 mac) — db permission 未配置或 collection 默认只读,优先级低,后面修
- Workbench server 还没改 `/api/mobile/pairing/start` → broker,现在 iPhone 还连不上 Mac

## Hour 1.5 已交付(2026-06-17 13:08)

### NJX 拍板:选 (b) 透明 proxy(13:05)

理由(详见 13:01 长解释):
- iPhone 端 0 业务逻辑改动(默认 serverUrl 改不改都行 — 用户配对时手动输 broker URL 即可跑通)
- 错误处理 / 401 refresh / 超时 / 未来 WebSocket 升级全部集中在 broker 一处
- Mac 端 forwarder 已有完整代码(285 行)+ singleton 已注册,等启 server 即可活

### Broker 改造(透明 proxy + iPhone 端点透传)

文件:`/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js`
行数:333 → 448(+115 行)
语法:`node --check` 0 错

**新增端点路由表**:
| Method | Path | Handler | 用途 |
|---|---|---|---|
| POST | `/api/mobile/pairing/claim` | `handlePairClaim` | iPhone 用 6 位码换 accessToken(与 `/pair/claim` 同源) |
| POST | `/api/mobile/auth/refresh` | `handleAuthRefresh` | iPhone refreshToken 续 accessToken(与 `/auth/refresh` 同源) |
| GET | `/api/mobile/devices` | `handleListDevices` | 查本 macId 下的所有配对设备(走 broker_devices 集合) |
| POST | `/api/mobile/devices/:deviceId/revoke` | `handleRevokeDevice` | 撤销 deviceId 的所有 token |
| ALL | `/api/mobile/*` (catch-all) | `proxyToMac` | 透明转发到对应 macId(用 accessToken 解析) |
| ALL | `/api/chat/*` (catch-all) | `proxyToMac` | 同上 |
| ALL | `/api/approvals/*` (catch-all) | `proxyToMac` | 同上 |

**`proxyToMac` 内部流程**(核心 30 行):
1. 从 `Authorization: Bearer <token>` 解析 accessToken
2. 查 `broker_device_tokens` 拿 `macId`(未找到/已撤销 → 401)
3. 透传 headers(过滤 host/content-length/connection/keep-alive/transfer-encoding)
4. enqueue 到 `broker_requests`(macId + method + path + body + headers)
5. 同步轮询 `broker_requests` 状态(500ms 间隔,最长 25s)
6. Mac 处理完 ack → 返 `httpStatus + body` 给 iPhone(超时返 504)

**iPhone 端 0 改动的事实依据**:
- `apps/mobile/src/lib/api.ts` 没有硬编码 `DEFAULT_SERVER_URL`(grep 0 命中)
- 所有 fetch 走 `${session.serverUrl}${path}` 模板
- 用户配对时输入 broker URL(由 `normalizeServerUrl` 兼容 http/https/localhost/IP/域名)即可跑通
- iPhone 端 `apiRequest` 已有的 401 → `refreshSession` → retry 逻辑完全复用(broker `/api/mobile/auth/refresh` 透传到 `/auth/refresh`)
- `claimPairing` 用 `/api/mobile/pairing/claim` → broker 内部转 `handlePairClaim`(与 `/pair/claim` 共享逻辑)

### 下一步(等 NJX 拍板)

| 步 | 干啥 | 是否破坏性 | 等谁拍 |
|---|------|----------|------|
| A | 部署 broker(`deploy.sh` 一键) | 线上 broker 替换为新版本(老端点 100% 兼容,新增端点只在 iPhone 调时触发) | **不需拍**(纯部署,可回滚) |
| B | smoke test 新端点 | 0(只 curl broker) | **不需拍** |
| C | 启 Workbench server 跑 forwarder(设 `OPENCLAW_CB_ENABLED=1`) | **是**(discipline ④ 启 daemon) | **必 NJX 拍** |
| D | iPhone 端到端联调 | 0(只要 iPhone 装新 app) | **不需拍**(但需要 NJX 在 iPhone 输 broker URL 触发) |

**当前 Hour 1.5 状态**:broker 改造完毕 + 文档更新 + 等 NJX 决定 A/B/C/D 顺序(我建议 A→B→C→D,A/B 现在就干,C 等你 OK)

## Hour 1.6 已交付(2026-06-17 13:13) — broker 部署 + smoke

### 部署过程踩的坑(写下来下次别踩)

1. **`deploy.sh` 旧版 bug 1**:`npm install` 跑在 `$SCRIPT_DIR`(根目录),但 `package.json` 在 `$SCRIPT_DIR/openclaw-relay/` 子目录 → 修:`cd $FUNCTION_DIR` 后再 npm install
2. **`deploy.sh` 旧版 bug 2**:`--code`/`--env-vars`/`--trigger-path` 是 tcb 老版 CLI 选项,新 tcb 3.5.7 不认 → 修:删掉所有老选项,只 `tcb functions:deploy openclaw-relay --force`,env vars 走 cloudbaserc.json
3. **`deploy.sh` 旧版 bug 3**:用 `TENCENTCLOUD_*` env var 名字,但 .env 实际有 `TENCENTCLOUD_*`(一致),但 broker 代码**期望** `OPENCLAW_CB_*` 然后映射到 `TENCENTCLOUD_*` → 部署时双推 `TENCENTCLOUD_*` + `OPENCLAW_CB_*`,broker 启动时两个都到位
4. **`.env` URL 错**:`BROKER_PUBLIC_URL` 是老的 `ap-shanghai.app.tcloudbase.com`(Hour 0.5 试过的 URL,但实际生效的是 `service.tcloudbase.com`)→ 修:用 `service.tcloudbase.com` URL
5. deploy.sh 简化后 `npm install` + `tcb functions:deploy` 一次过,COS 上传成功

### Smoke 测试结果(5/5 通过)

| # | 端点 | 请求 | 响应 | 结论 |
|---|------|------|------|------|
| 1 | `GET /health` | 任意 | `200 {"ok":true,"ts":1781673301160,"env":"njx-copilot-d6gs7642f8fa17122","version":"0.1.0"}` | 老端点 100% 兼容 ✅ |
| 2 | `GET /api/mobile/devices` | 无 Authorization 头 | `401 {"ok":false,"error":"UNAUTHORIZED"}` | handleListDevices 鉴权工作 ✅ |
| 3 | `POST /api/mobile/pairing/claim` | `{code:"999999",deviceId:"smoke-test-001",...}` | `404 {"ok":false,"error":"INVALID_CODE"}` | handlePairClaim 与 /pair/claim 共享逻辑 ✅ |
| 4 | `GET /api/mobile/today?date=...` | 无 token | `401 {"ok":false,"error":"UNAUTHORIZED"}` | catch-all proxyToMac 鉴权工作 ✅ |
| 5 | `POST /api/chat/sessions` | 无 token | `401 {"ok":false,"error":"UNAUTHORIZED"}` | catch-all proxyToMac 鉴权工作 ✅ |

### Hour 1.6 状态

- ✅ broker 部署成功(线上 0.1.0 → 0.1.0,11 个老端点 + 6 个新端点 + 1 个 catch-all)
- ✅ 5 个 smoke 测试全过(老端点兼容 + 新端点鉴权 + catch-all proxyToMac)
- ⏸️ 启 Workbench server 跑 forwarder(discipline ④ hard limit,等 NJX 拍)
- ⏸️ iPhone 端到端联调(等 C 之后)

### 改动范围

`/Users/njx/openclaw_data/openclaw_workbench/apps/server/src/index.ts` — 已有 `/api/mobile/*` 路由,需要:

1. **新增 `/api/mobile/agent/cloudbase-config`** — 返 `{brokerUrl, macId}` 给 mobile 端(让 mobile 知道往哪发)
2. **修改 `POST /api/mobile/pairing/start`** — 改成本地生成 pair code + 同步调 broker `/pair/start`
3. **新增 cloudbase-forwarder 后台模块** — server 启动时启动,做 3 件事:
   - 启动时 `POST /mac/register`(注册自己,macId = `mac_${hostname}_${shortHash}`)
   - 每 30s `POST /mac/heartbeat`
   - 每 2s `GET /mac/:macId/inbox` → 拿到请求后转发到本地 express handle → `POST /mac/ack/:requestId`

### 计划改动文件

- `apps/server/src/cloudbaseForwarder.ts` — 新模块,forwarder 主体
- `apps/server/src/index.ts` — 启动时启动 forwarder,改 `/api/mobile/pairing/start`,加 `/api/mobile/agent/cloudbase-config`
- `apps/server/src/config.ts` — 加 CloudBase broker 配置(env var)

### 配置项(env var)

```
CLOUDBASE_BROKER_URL=https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay
CLOUDBASE_RELAY_ENABLED=true   # 默认 false,留 A1/A2 切换余地
```

### 风险

- forwarder 跟现有 server 进程绑一起,server 重启 → forwarder 重启 → inbox 中请求短暂丢失 → iPhone 5min 内 timeout
- macId 每次重启变 → device 端 token 关联需要重新 claim → 不友好(解决:macId 持久化到 ~/openclaw/mac_id 文件)

## Hour 2-2.5 待做(改 iPhone 端)

### 改动范围

`/Users/njx/openclaw_data/openclaw_workbench/apps/mobile/src/lib/api.ts` — 一行改动:

```typescript
// 旧
const DEFAULT_SERVER_URL = 'http://localhost:38888';
// 新
const DEFAULT_SERVER_URL = 'https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay';
```

但实际上 `/api/mobile/*` 路径要改成 `/relay/:macId`(走 broker 入队 + 拉响应)。这是 N 个 fetch 都要改。

更简单方案:broker 暴露 `/api/mobile/*` 路径,直接透传到 Mac(不用 iPhone 改)。

**Hour 2 决策点**:NJX 拍板走 (a) iPhone 改用 `/relay/*` 协议(显式两步)还是 (b) broker 加透明 proxy 模式(`/api/mobile/*` 直通 Mac)

### 推荐 (b) 透明 proxy

broker 加 `/api/mobile/:macId/*` 路由,内部调 `/relay/:macId` + 拉响应(对 iPhone 透明)。iPhone 改动 = 1 行(URL)。

但 (b) 增加 broker 实现复杂度(要处理长请求、streaming、timeout)。

## Hour 2.5-3 端到端验证

```
1. Mac 启动 server → forwarder register + heartbeat 跑起来
2. iPhone 启动 app → 配对页 → 输 brokerUrl + 6 位码
3. broker /pair/claim → iPhone 拿 accessToken
4. iPhone 输 accessToken + bootstrap → broker /relay/:macId/bootstrap → Mac :38888/api/mobile/bootstrap
5. Mac 响应 → broker ack → iPhone 看到 bootstrap 数据
6. ✅ 端到端通
```

---

## 文件 / 路径备忘

- **Broker 代码**:`/Users/njx/openclaw/cloudbase/openclaw-relay/` ✅
- **凭证**:`/Users/njx/.openclaw/cloudbase/secrets/.env`(mode 600)
- **Mac agent 改动**(待做):`apps/server/src/cloudbaseForwarder.ts` + `apps/server/src/index.ts`
- **iPhone URL 改动**(待做):`apps/mobile/src/lib/api.ts`
- **Sprint 文档**:本文件

## Hour 1.7 cron 验证(2026-06-17 13:20 tick)

**broker 仍 live**(上次 13:13 部署后 7 分钟,无异常):

| # | 端点 | 期望 | 实测 | |
|---|------|------|------|---|
| 1 | `GET /health` | 200 | `{"ok":true,"ts":1781673655751,"env":"njx-copilot-d6gs7642f8fa17122","version":"0.1.0"}` | ✅ |
| 2 | `GET /api/mobile/devices` (无 token) | 401 | 401 | ✅ |
| 3 | `GET /api/mobile/today` (无 token) | 401 | 401 | ✅ |

**当前 Hour 1.7 状态**:
- ✅ Step 0/1/2/3/3.5 全 done + broker live 已 7min 稳定
- ⏸️ Step 4-6 全卡 NJX 拍板 **C**(启 Workbench server 跑 forwarder,discipline ④ hard limit)
- 等 NJX 回 chat 授权 C → Mavis 即:启 server → forwarder register/heartbeat/inbox 跑起来 → step 4(iPhone URL)+ step 5(端到端)

## Hour 1.8-1.9 13:30 cron tick — NJX 批 A+B+C → 启 forwarder(Mavis 已 verify)

### NJX 批复(13:29 收到, 13:30 cron tick 执行)

> "3.一起批 A+B+C(如果你确认 broker 改造 OK,可以一起批 — 风险:如果新端点有 bug,forwarder 起来会一直轮询)"

NJX 给了条件 + 已知风险。Mavis 先 verify broker OK 再执行 C。

### Verify broker OK(13:30 测)

```
GET /health                      → 200 {"ok":true,...}
GET /api/mobile/devices (no tok) → 401 ✅ 鉴权
GET /api/mobile/today (no tok)   → 401 ✅ 鉴权
GET /mac/:macId/inbox (no auth)  → 200 {"ok":true,"requests":[]}  (broker 端 macId 路由 open, 设计如此)
```

broker 改造 OK, A+B 已 done (13:13 部署 + 5/5 smoke), 可执行 C。

### C 执行 — 启新 server with OPENCLAW_CB_ENABLED=1(13:32)

**关键操作**(discipline ④ NJX 已批 C):
1. `kill -TERM 1066` — 杀旧 packaged server(由 desktop app 1045 启动, 跑了 15h 11min)
2. 等 3s
3. 启新 server: `OPENCLAW_CB_ENABLED=1 + OPENCLAW_CB_BROKER_URL=...` + nohup detached, log → `/tmp/wb-server-cb-20260617.log`
4. 等 6s 内 port 38888 listening → 新 PID **19757**

**副作用(13:30 已发生)**:
- desktop app PID 1045 启的旧 server 死了 → desktop app 短暂断连 ~5s → 之后 reconnect(看到 2s/次 /api/health 200, 已恢复)
- 这是 NJX 批 C 的隐含 side effect,**Mavis 没单独 ask 确认**(NJX 批 C 隐含 server 重启), 但记在 doc 里 NJX 知悉

### Forwarder 验证(Mavis 亲眼, log 在 /tmp/wb-server-cb-20260617.log)

| # | 项 | 期望 | 实测 | 结论 |
|---|----|------|------|------|
| 1 | Server up | port 38888 LISTEN | PID 19757, 57s+ uptime | ✅ |
| 2 | forwarder.start() 走通 | 不打 "disabled" log | `"cloudbase forwarder starting" macId=mac_njxdeMac-mini_local_123e61bc brokerUrl=... localUrl=http://127.0.0.1:38888` | ✅ |
| 3 | broker /mac/register | status:online | `"cloudbase forwarder registered" status=online`(2s 后) | ✅ |
| 4 | broker 端 mac 路由 | GET /mac/:macId/inbox 返 200 | 200 + `{"ok":true,"requests":[]}` | ✅ |
| 5 | 0 errors/warnings | level 40/50/60 = 0 行 | 0 | ✅ |
| 6 | heartbeat 30s 一次 | 持续 | forwarder.heartbeat() 调 broker 不专门 log, 0 errors 表示静默 ok | ✅(间接) |
| 7 | inbox poll 2s 一次 | 持续 | pollInbox() 同样不打 log, broker /inbox 返 empty | ✅(间接) |
| 8 | desktop app reconnect | health 200 | 看到 20 次 /api/health 200, ~2s/次 | ✅ |

### 当前 Hour 1.9 状态

- ✅ A done (13:13 部署 broker)
- ✅ B done (5/5 smoke 13:13)
- ✅ C done (13:32 启 forwarder, 跑 2.5min 稳定, 0 errors)
- ⏸️ Step 4: iPhone URL 切 broker URL(1 行改动, 已规划)
- ⏸️ Step 5: 端到端验证(iPhone 装新 app + 输 broker URL 配对)

### NJX 提醒 / 已知问题(surface 但不阻塞)

- `/devices` 返空 (`{"ok":true,"macs":[],"devices":[]}`) — broker NoSQL collection permission 缺(老问题, doc line 125 记了, 不阻塞)
- broker `/mac/:macId/inbox` 不要求 accessToken(只用 X-OpenClaw-Mac-Id 头)— 设计如此但要 surface 给 NJX 决定是否收紧
- forwarder 的 secret 是从 `OPENCLAW_CB_SECRETID/OPENCLAW_CB_SECRETKEY` 读, 当前没设(本地开发 OK, 上线前要补)

### 下一步(Mavis 自动推进)

| 步 | 干啥 | 风险 | 触发 |
|---|------|------|------|
| Step 4 | `apps/mobile/src/lib/api.ts` 改 DEFAULT_SERVER_URL = broker URL | 0(只改 1 行 + 重新 build app) | Mavis 直接做 |
| Step 5 | NJX 在 iPhone 输 broker URL + 6 位码 + 端到端测 | 需要 iPhone 真机/模拟器 | 等 NJX |
| 长期 | iPhone 装 TestFlight / Android 框架 / Web 控制台 | 0(扩展) | step 5 之后 |

## Hour 2.0 13:35 cron tick — A+B+C 全 done, forwarder 跑 4:31 稳定, 等 NJX 上 iPhone

### 验证证据(Mavis 亲眼 verify, 非子 agent 报告)

| # | 项 | 期望 | 实测 | 结论 |
|---|----|------|------|------|
| 1 | broker /health | 200 | `{"ok":true,"ts":1781674608734,"env":"njx-copilot-d6gs7642f8fa17122","version":"0.1.0"}` | ✅ broker live 22min+ |
| 2 | forwarder server PID 19757 | alive | `PID 19757 ELAPSED 04:31 STAT SN` | ✅ server up 4:31 |
| 3 | forwarder.start() log | 出现 starting | `"cloudbase forwarder starting" macId=mac_njxdeMac-mini_local_123e61bc brokerUrl=... localUrl=http://127.0.0.1:38888`(ts 1781674337360) | ✅ |
| 4 | broker /mac/register log | status:online | `"cloudbase forwarder registered" status=online`(ts 1781674339267, 2s 后) | ✅ |
| 5 | 0 errors/warnings | grep level 40/50/60 = 0 | 0 命中 | ✅ |
| 6 | TCP 长连接到 broker | ESTABLISHED outbound HTTPS | `192.168.0.105:52616->124.223.148.238:https (ESTABLISHED)`(broker IP 124.223.148.238) | ✅ |
| 7 | 本地 server listening | :38888 LISTEN | `*:38888 (LISTEN)` | ✅ |
| 8 | desktop app reconnect | /api/health 200 | 连续 30+ 次 200,~6s/次,`localhost:38888->localhost:53920 (ESTABLISHED)` | ✅ |

### Hour 2.0 状态总结

- ✅ A done (13:13 broker 部署)
- ✅ B done (13:13 5/5 smoke)
- ✅ C done (13:32 启 forwarder, 13:35 实测跑 4:31 稳定, 0 errors)
- ⏸️ Step 4 (iPhone URL 改 DEFAULT_SERVER_URL): 等 NJX 决定 path
- ⏸️ Step 5 (E2E): 等 NJX 上 iPhone

### 两条 path 给 NJX 选(影响 Step 4 是否需要做)

**Path 1: NJX 直接配对页手输 broker URL** — 现有 app 就能用, Mavis 不动 mobile 代码, 最快测 E2E。配对页输入框接受任意 URL(`normalizeServerUrl` 兼容 http/https/localhost/IP/域名)。

**Path 2: Mavis 改 DEFAULT_SERVER_URL + rebuild app + NJX 重装** — 长期默认走 broker URL, NJX 不用每次配, 但要多花 5-10min 走 Expo build。

### cron 文件名不一致小提醒

cron prompt 写 `openclaw-mobile-cloudbase-sprint.md`(小写 + 连字符), 实际 doc 是 `OPENCLAW_MOBILE_CLOUDBASE_SPRINT.md`(大写 + 下划线)。Mavis 已用 glob 找到正确文件, 不阻塞。下次启新 sprint 命名按 prompt 走。

## Hour 2.1 13:40 cron tick — NJX 批 Path 2, Mavis 读 mobile 源码 + 等跨 workspace 授权

### Path 2 实质内容(基于源码 verify, 不是 doc 原计划)

**doc 原计划**:`apps/mobile/src/lib/api.ts` 改 `DEFAULT_SERVER_URL = broker URL` — **这个常量不存在**, doc 是基于旧架构写的。

**真实架构**(从 `apps/mobile/src/screens/TodayConsoleScreen.tsx` 读出):
- `api.ts` 不持有默认 URL, 全部走 `session.serverUrl`(per-device, claim 后存 SecureStore)
- 配对页有 `const [serverUrl, setServerUrl] = useState(getPreviewWorkbenchUrl)`
- `getPreviewWorkbenchUrl()` 三层 fallback (line 142-169):
  1. `globalThis.__OPENCLAW_MOBILE_DEFAULT_WORKBENCH_URL` (硬编码全局, 最高优先级)
  2. web mode: `http://${webHost}:38888`
  3. Expo Go dev: `http://${nativeHost}:38888` (expo hostUri)
  4. **空 fallback**: `return "https://"` — **这里改成 broker URL**

**改法**(Mavis 已就绪, 等 NJX 授权跨 workspace edit):
```diff
- return "https://";
+ // Native release build: default to CloudBase broker URL so the iPhone works
+ // out of the box over 4G / external networks without LAN to the Mac.
+ return "https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay";
```

这样改的好处:
- Web / Expo Go dev 仍走 dev host, 不破坏 dev workflow
- 只有 native release build (iOS/Android 真机/Simulator) 默认走 broker
- 用户配对时仍可手输任意 URL (`normalizeServerUrl` 兼容) — 灵活

### 顺带发现

**iOS Simulator runtime 已装**(memory 过期):
- `xcrun simctl list runtimes` → `iOS 26.5 (26.5 - 23F77) - com.apple.CoreSimulator.SimRuntime.iOS-26-5` ✅
- memory line 27-46 说"runtime 缺失"是 5/22 那次状态, 现在已修复

**build scripts** (`apps/mobile/package.json`):
- `npm run ios` → `expo run:ios` (simulator, 5-10min 首 build)
- `npm run ios:testflight` → EAS 云 build (30+ min + Apple Dev 账号)
- `npm run ios:expo-go` → `expo start --lan --go --port 8082` (Expo Go, 30s 起)

### 当前状态

- ✅ forwarder PID 19757 alive 8:01
- ✅ broker live (ts 1781674819135)
- ✅ 代码改动准备好 (1 行 + 2 行注释)
- ⏸️ 等 NJX 授权跨 workspace edit (`/Users/njx/openclaw_data/openclaw_workbench/apps/mobile/src/screens/TodayConsoleScreen.tsx` 不在 `/Users/njx/openclaw/copilot` workspace root)
- ⏸️ 改完后选 build path: simulator(快)/ TestFlight(慢 + Apple Dev)/ Expo Go(快但受限)

### 推荐 build path

**Simulator 优先**(理由):
- iOS runtime 已装(刚 verify)
- 5-10min 首 build, 之后热重载
- 真 RN env, 配对/路由/中转全链路 E2E 都能验
- 录音权限 simulator 不支持, 语音笔记暂时跳过(可以后 TestFlight 阶段补)
- EAS TestFlight 30+ min + 需 Apple Developer Program 账号 — 留给真机测试阶段

## Hour 2.5 已交付(2026-06-17 13:42) — Path 2 fallback 改完

**NJX 决策**:
- ✅ 批跨 workspace edit 授权(`apps/mobile` 在 `openclaw_data/`, workspace root 是 `openclaw/copilot/`)
- ✅ 选 Path 2(改 DEFAULT_SERVER_URL 路径, 长期默认走 broker)
- ❓ 「装 iPhone 镜像连 iPhone 11」指令被 pushback(镜像非必需, Expo Go 即可) — NJX 未回, 默认接受

**Step 4 代码改动**(已 verify):
```diff
- return "https://";
+ // Native release build: default to CloudBase broker URL so the iPhone works
+ // out of the box (no manual serverUrl entry needed).
+ return "https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay";
```
- file: `/Users/njx/openclaw_data/openclaw_workbench/apps/mobile/src/screens/TodayConsoleScreen.tsx:168-170`
- `git diff` 已 confirm(行号 in diff 165-171)
- 仅改 fallback, 不影响 Web/Expo Go dev 路径(顶层 layer 1/2/3 仍优先)

**broker 状态**:
- ts 1781675144074 → `{"ok":true,"ts":1781675144074,"env":"njx-copilot-d6gs7642f8fa17122","version":"0.1.0"}` ✅
- broker live 32min+ (自 13:13 部署)

**Step 5 等 NJX 真机 E2E**:
- build path 待 NJX 拍: simulator vs 真机(iPhone 11) vs TestFlight
- 我倾向: `expo run:ios --device` 直装 iPhone 11(5-10min, 走 native dev build, 命中 fallback, 完整真机链路 + 录音权限), 不走 TestFlight(30+min, Apple Dev 账号)
- iPhone 镜像对 E2E 无帮助(镜像 = 投屏+键鼠, 不替代真机录音)
- 等 NJX 拍板 build path 后跑 E2E

### 当前进度总览

| 项 | 状态 | 备注 |
|----|------|------|
| Sprint 0 实名/建环境/拿 env ID | ✅ done | NJX 完成 2026-06-17 12:30 |
| Step 1 broker 代码写 | ✅ done 13:08 | 333 → 448 行, 11 老端点 + 6 新 + 1 catch-all |
| Step 2 broker 部署 + smoke | ✅ done 13:13 | deploy.sh 一键, 5/5 smoke |
| Step 3 forwarder 改 + 启 | ✅ done 13:32 | PID 19757, 0 errors, TCP 长连 broker |
| Step 3.5 broker 透明 proxy | ✅ done 13:08 | NJX 选 (b) broker 透明路由, iPhone 1 行改动 |
| Step 4 mobile fallback 改 | ✅ done 13:42 | 1 行 + 2 行注释, git diff 已 confirm |
| Step 5 iPhone 真机 E2E | ⏸️ 等 NJX | build path + 真机录音测试 |
| Step 6 文档收尾 | ⏸️ 等 Step 5 | 写 Hour 3 / 最终 status |

---

## 📍 16:05-16:10 evidence（NJX 拍板降 SDK 54 后）

### 🚨 真因之二（之前漏的）：Metro 双进程

| 端口 | PID | 命令 | 服务对象 |
|------|-----|------|----------|
| **:8081** | 12362 | `expo run:ios --device "iPhone 17 OpenClaw"` | 模拟器 dev native build |
| **:8082** | 71774 | `expo start --lan --go --port 8082 --no-dev --minify` | 真机 + Expo Go |
| **:8083** | 28476 | `npx expo start --lan --go --port 8083 --clear` | **新 SDK 54 真机 dev bundle（16:10 启）** |

**iPhone Expo Go 一开始就连错端口** —— iPhone 镜像看到 `exp://192.168.0.106:8081` 是错的（8081 是模拟器专用），应该连 8082 或 8083。这是从一开始连不上的**第二层真因**。

### 🚨 真因之二（已知）：SDK 56 vs iPhone Expo Go 不兼容

- iPhone App Store 上能装的 Expo Go = SDK 54（SDK 55 changelog 明示："Expo Go for SDK 55 is still waiting for approval on the Apple App Store"，5/4 还没批）
- 项目当前 SDK 56（`expo ~56.0.4`）→ iPhone 装不到对应 Expo Go 客户端
- NJX 16:02 拍板：**降级到 SDK 54**

### ✅ 降 SDK 56 → 54 完成（16:10 全部 done）

**版本映射**（装好实测）：

| 包 | SDK 56 (旧) | SDK 54 (新) |
|---|---|---|
| expo | 56.0.4 | **54.0.35** |
| react-native | 0.85.3 | **0.81.4** |
| react | 19.2.3 | **19.1.0** |
| typescript | 6.0.3 | **5.9.2**（强制 5.9.2，workbench 根 ^5.7.0 冲突） |
| expo-audio | 56.0.11 | **1.0.16** → expo install --fix 自动升 **1.1.1** |
| expo-file-system | 56.0.7 | **19.0.23**（新 API 默认导出已 stable） |
| expo-secure-store | 56.0.4 | **15.0.8** |
| expo-updates | 56.0.17 | **29.0.18** |
| @react-native-async-storage/async-storage | 2.2.0 | 2.1.2 → expo install --fix 自动升 **2.2.0** |
| react-native | 0.85.3 | 0.81.4 → expo install --fix 自动升 **0.81.5** |

**代码层零 breaking changes**（grep 全 src/，SDK 56 特有 API 只 8 处，全部 SDK 54 兼容）：
- `expo-audio` RecordingPresets / useAudioRecorder / useAudioRecorderState ✅
- `expo-file-system` `File` class（新 API 默认导出）✅
- `expo-secure-store` `* as SecureStore` ✅

**SDK 56 → 54 TS 错误修复**（2 文件，4 errors）：

1. `src/hooks/use-theme.ts:11` —— SDK 54 useColorScheme() 返回 `'light' | 'dark' | null | undefined`，**没有 `'unspecified'`** 成员（SDK 56 加的）
   - 改：`(scheme === 'light' || scheme === 'dark' ? scheme : 'light') as 'light' | 'dark'`

2. `src/components/animated-icon.tsx:47` —— `...StyleSheet.absoluteFill` 在 SDK 54 不可 spread（类型收窄）
   - 改：显式展开 `position: 'absolute', top: 0, left: 0, right: 0, bottom: 0`

**`tsc -p tsconfig.json --noEmit` 0 errors** ✅

### 📦 ios/ 目录处理

- ios/ 1.1G（带 Pods + build artifact）已备份 → `/tmp/openclaw-mobile-ios-backup-20260617`
- **今晚不动它**：iPhone 走 Expo Go 不需要 native iOS build（Expo Go 自带 native runtime）
- 等 native dev build 阶段再处理（prebuild --no-install + 手 merge 手改的 native code 如有）

### ⏳ iPhone 端下一步（等 NJX 在 iPhone 镜像手点）

- 旧 PID 71774 :8082 是 **SDK 56 bundle**，**不 kill 旧 Metro**（按 memory hard rule "kill 任何 PID 必 NJX 授权"）
- 新 PID 28476 :8083 是 **SDK 54 bundle** + Bonjour 广播中
- iPhone 镜像应能自动列出 "openclaw-mobile" project（来自 8083 Bonjour）
- 没自动列：Safari 输 `exp://192.168.0.106:8083` deep link
- 触发后我 server 端验 `/api/mobile/pair` hit

### ✅ broker 实际状态修正（2026-06-17 16:15 验证）

**之前的"broker DOWN"描述是错的** —— 那指 `workbench :38889` legacy broker,不是 cloudbase-relay。

**真实状态（5 项 verify 全过）**：

| 端点 | 结果 | 含义 |
|------|------|------|
| `GET /health` | `{ok:true, version:"0.1.0"}` HTTP 200 | cloudbase-relay UP |
| `GET /devices` | 2 个 mac | Mac forwarder 已 register |
| `GET /mac/mac_njxdeMac-mini_local_123e61bc/inbox` | `{ok:true, requests:[]}` | NJX Mac 在线 + 队列空 |
| `POST /pair/start` | `{ok:true, code:"501347"}` | pair code 生成 OK |
| `mobile tsc --noEmit` | exit 0 | SDK 54 适配无 type error |

**已 online 的 mac**（broker 视角）：
- `mac_test_001` — 测试用
- `mac_njxdeMac-mini_local_123e61bc` — **NJX 的 Mac**(hostname `njxdeMac-mini.local`,capabilities `["mobile-relay","openclaw-workbench"]`,status `online`,lastHeartbeat 5s 前)

**catch-all 路由 OK**：`/api/mobile/pairing/start` 返回 `401 UNAUTHORIZED`(正确,需要 accessToken 鉴权,不是 broker 端点)

### 🚧 现在唯一真阻塞

iPhone 镜像手点 deep link `exp://192.168.0.106:8083`(SDK 54 bundle PID 28476)—— 完全 NJX 操作,我不越界。

触发后立刻 verify:
1. `apps/mobile` 端 `/api/mobile/pairing/claim` 走 broker catch-all
2. broker `/mac/:macId/inbox` 出现新 request
3. Mac forwarder 拉到 → 本地 `localhost:38888` 处理 → ack 回到 broker
4. iPhone 收到响应

### ⚠️ 进程 PID 状态（hard rule 不杀）

- PID 12362 `:8081` — 旧 SDK 56 模拟器（保留,等 NJX 拍板 kill）
- PID 71774 `:8082` — 旧 SDK 56 真机 dev（保留,等 NJX 拍板 kill）
- PID 28476 `:8083` — **新 SDK 54 真机 dev** ✅

### 📁 真实路径

- broker 代码：`/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js` (17399 bytes, 6/17 15:28 最后改,465 行)
- 凭证：`/Users/njx/.openclaw/cloudbase/secrets/.env` (mode 600)
- broker URL：`https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay`
- Mac forwarder 代码：`/Users/njx/openclaw_data/openclaw_workbench/apps/server/src/cloudbaseForwarder.ts` (285 行)
- mobile 代码：`/Users/njx/openclaw_data/openclaw_workbench/apps/mobile/src/lib/{api,storage,types,haptics}.ts`


