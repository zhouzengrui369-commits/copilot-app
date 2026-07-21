# openclaw-mobile × CloudBase 中转 sprint

**Sprint owner**: Mavis (root session `mvs_3f011d25f2f940cd82c0ad5ef5996635`)
**触发**: NJX 2026-06-17 决定把 iPhone 端 ↔ Mac agent 走 CloudBase 中转(脱 LAN 限制)
**目标**: iPhone 4G 也能直连 Mac agent 控制台,Sprint 0 = broker + 端点 + 端到端最小闭环

## 当前阶段:sprint 0 — 5min cron 推进中

### 关键进展(15:25 tick)

| 项 | 状态 | 证据 |
|----|------|------|
| CloudBase env ID | ⚠️ 未就位 | NJX 12:16 已发 `/Users/njx/.openclaw/cloudbase/secrets/.env`(3 件套全),但**没看到 NJX 创建 cloudbase 环境** |
| broker HTTP trigger | ✅ alive | `https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay/health` HTTP 200, version 0.1.0, ts=1781680323958 |
| Mac agent forwarder 进程 | ✅ alive | server PID 19757, 监听 38888, 1h47min 跑 |
| forwarder ENV 配置 | ✅ 已加载 | 日志确认 `OPENCLAW_CB_ENABLED=1` + `BROKER_URL` |
| forwarder /mac/register | ✅ 13:32:19 注册成功 | 日志: `{"status":"online","macId":"mac_njxdeMac-mini_local_123e61bc"}` |
| broker /devices 返回 | ❌ macs=[] | 实测: `{"ok":true,"macs":[],"devices":[]}` |
| workbench 端点契约 5 个 | ✅ verified | mobile/agent/cloudbase-config、pairing/start+claim、bootstrap、devices、voice-notes 全部就位 |
| iPhone Expo Go Metro 8082 | ✅ 仍跑 | pid 71784, expo start --lan --go |
| iPhone 真机端到端 | ❌ 未跑 | 等 NJX cue |

### 根因分析(15:25 tick 调查)+ 修复(15:28 tick 完成)

**关键矛盾**: forwarder 13:32:19 register 返 200 + status:online,但 15:25 查 broker /devices macs=[]。

**调查路径**:
1. `lsof -p 19757` 找 server 日志 → `/private/tmp/wb-server-cb-20260617.log`
2. `grep cloudbase` 找到 3 条日志:
   - 13:32:17 forwarder starting
   - 13:32:19 forwarder registered (status:online)
   - 14:54:34 `/api/mobile/agent/cloudbase-config` GET(本地 agent 调,**不是** forwarder)
3. 查 broker 源码 `/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js:137-148`:
   - `/mac/register` 用 `db.collection('broker_macs').where({ macId }).update(..., { upsert: true })`
   - `/devices` 用 `db.collection('broker_macs').limit(50).get()`
4. 直 curl broker `/devices`:`{"ok":true,"macs":[],"devices":[]}` 仍空
5. 心跳日志: `grep heartbeat` = 0 行(心跳成功**不写** INFO log,只 warn on err)
6. 心跳失败 warn: 0 行(从 13:32 至今 1h53min 一次都没有)

**根因(15:28 确定)**:
broker `index.js:141` 用了 `db.collection('broker_macs').where({ macId }).update({...}, { upsert: true })`。
**cloudbase SDK 的 `where().update()` 不支持 upsert option** —— `{upsert: true}` 被 silently 忽略,新 mac register 永远只 update 0 行。/mac/register 返 200 但数据没存。后续 heartbeat 也是 `where().update()` —— 同样 silently no-op,所以没看到 warn。

**修复**(15:28 完成):
- `/mac/register` → `db.collection('broker_macs').doc(macId).set({...})`(用 macId 当 _id 走 doc().set() 真 upsert)
- `/mac/heartbeat` → `db.collection('broker_macs').doc(macId).update({...})`,doc 不存在返 404 让 forwarder re-register
- 部署命令:`bash /Users/njx/openclaw/cloudbase/openclaw-relay/deploy.sh` ✅ 15:28 完成

**端到端验证**:
```
register mac_test_001 → /devices 立刻查到 (带 _id=macId) ✓
heartbeat mac_test_001 → lastHeartbeat 从 1781681363219 涨到 1781681364087 ✓
register mac_njxdeMac-mini_local_123e61bc (NJX 真实 mac) → /devices 出现 ✓
```

### 已验证(grep 走查)

workbench 端点契约(`/Users/njx/openclaw_data/openclaw_workbench/apps/server/dist/index.js`):
- ✅ `POST /api/mobile/agent/cloudbase-config` (agent 端写 broker URL + env ID)
- ✅ `POST /api/mobile/pairing/start` (start owner cookie 鉴权)
- ✅ `POST /api/mobile/pairing/claim` (claim 免 auth)
- ✅ `POST /api/mobile/bootstrap` (mobile 端 device_id 换 token)
- ✅ `GET  /api/mobile/devices` (owner 看设备)
- ✅ `POST /api/mobile/voice-notes` (录音上传)

DB schema 已就位:
- ✅ `mobile_devices` 表
- ✅ `mobile_pairing_challenges` 流程

### iPhone 操作指南(等 NJX cue)

- **Method 1**: NJX iPhone Safari 扫 Expo Go QR,自动连 Metro
- **Method 2**(NJX 嫌麻烦):我代用 cu 技能截图验收

## 等待中

- ⚠️ NJX 推进腾讯云实名 + 创建 cloudbase 环境(预期 10-15 min)
- ⚠️ NJX 拍板:用 Method 1 / Method 2 跑 iPhone E2E
- ⚠️ NJX 拍板:cloudbase 环境 ID 后,我立刻写云函数 broker(目前 broker 已存在,但 mac 数据持久化有问题待修)

## 5min tick 时间线

| 时间 | 事件 |
|------|------|
| 12:16 | NJX 发 cloudbase .env(3 件套) |
| 13:32:17 | workbench server 启动,forwarder starting |
| 13:32:19 | forwarder /mac/register 返 200 + status:online(写了个寂寞,where().update() 不支持 upsert) |
| 14:54:34 | 第一次有 mobile 端契约调用 |
| 15:05 | cron 第 1 tick,等待 NJX 推云 |
| 15:15 | cron 找到 .env 已就位,broker alive,forwarder alive |
| 15:20 | cron 找根因:register 返 200 但 broker /devices macs=[] |
| 15:25 | cron 调查:云函数 NoSQL `broker_macs` 集合疑似未持久化 |
| 15:26 | NJX push "在等什么" + "等我拍什么" — 确认我之前太怂 |
| 15:28 | 找到真根因:where().update() 不支持 upsert,改 doc().set() + 部署 |
| 15:28 | e2e verified: register 立刻可查,heartbeat 涨 lastHeartbeat,2 macs 都在 |

## 当前状态:sprint 0 broker 端 ✅ 全通

- ✅ broker 部署 + 修复 + 端到端测试
- ✅ NJX 真实 mac 已注册到 broker(`mac_njxdeMac-mini_local_123e61bc`)
- ✅ forwarder 后续心跳会 hit 到 doc(不再 silently no-op)
- ⏳ iPhone E2E 待跑(NJX cue "iPhone 操作方法 1/2" 选哪个)

---

## 2026-06-17 22:01 — 5min cron 误报 404 根因排查 + 修复 + iPhone E2E 推进

### 误报根因
17:05 → 17:30 5min cron 持续报 `broker=404`,实际是 **cron 测试路径错了**:
- cron tick 测的是 `https://.../openclaw-relay`(根路径),broker 没绑 `/` 路由 → 返 404
- 真路径是 `https://.../openclaw-relay/health`(在 22:01 实测 **200 OK** + `{"ok":true,"ts":...,"env":"njx-copilot-...","version":"0.1.0"}`)
- broker 函数实际从 15:28 部署后一直在跑,7h 没掉(memory 那条 "已部署 HTTP 200" 没错)

### 22:01 实测 broker 全栈 evidence
- `GET /openclaw-relay/health` → **200 OK** + version 0.1.0
- `GET /openclaw-relay/devices` → **200 OK** + 2 个 mac:
  - `mac_test_001` (debug-test, 15:28 自己 register)
  - `mac_njxdeMac-mini_local_123e61bc` (NJX 真机, **lastHeartbeat=1781704898846 (22:01:38 本地,正在心跳!)**)
- `GET http://127.0.0.1:38888/api/mobile/pair` → **401** (无 auth 符合预期)
- 同步跑 `npm run test:mobile-api` → 100% 过(latest 1.0.7, syncModel=mac_primary)
- 同步跑 `npm run test:mobile-release` → 100% 过(iosTestFlight=true, distribution=store)

### cron 修复
- 改 prompt:从"5min cron 刚开 NJX 正在做腾讯云实名"改为"sprint 0 broker ✅,iPhone E2E 待跑"
- 改 health check 路径:从 `/openclaw-relay`(根)→ `/openclaw-relay/health` + `/openclaw-relay/devices`(看 macs 计数)
- 加 3-evidence 硬要求:broker_health / broker_macs / workbench_pair
- 0 evidence 视为 fail,连续 2 次 fail → 自动 delete
- 22:01 已 enable + trigger 一次验证

### iPhone E2E 等待 NJX cue
- **Method 1**: NJX iPhone Safari 扫 Expo Go QR(自动连 Metro pid 71784)
- **Method 2**: 我代 cu 工具截图验收
- TestFlight 上外部分发卡 Apple Developer Program($99 + 团队注册,NJX 拍)
- iOS Simulator runtime 没装(Mac mini M4,要 Xcode GUI Get)
