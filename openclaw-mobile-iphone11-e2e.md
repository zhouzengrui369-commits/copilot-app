# OpenClaw Mobile × iPhone 11 镜像 E2E 验收(2026-06-17 22:30)

**Sprint owner**: Mavis (root session `mvs_3f011d25f2f940cd82c0ad5ef5996635`)
**触发**: NJX 2026-06-17 22:21 指令 — 基于 1.0.7 现状继续开发 + 通过 iPhone 镜像操作 iPhone 11 安装 + 测试验证 + 多 agent 验收 + 我只验收掌控进度
**目标**: iPhone 11 上 OpenClaw Mobile v1.0.7 **功能完全可用** 才算交付

## 当前阶段(22:30)

### 关键发现(22:10 plan_416a1e01 worker 报告 + 22:25 Mavis 独立 verify)

| 项 | 状态 | 证据 |
|----|------|------|
| 后端契约 6/6 (pairing/bootstrap/today/chat/approval/devices/voice) | ✅ **PASS** | `mobile-api-smoke.mjs` 独立重跑过(today 10 actions, voice note transcript_ready, approval rejected 200, devices 20 active) |
| 3 个 smoke (mobile-api / mobile-release / mobile-transcription) | ✅ **PASS** | npm run 全过(lates 1.0.7, syncModel=mac_primary) |
| 中文 7/7 文案源码确认 | ✅ **PASS** | grep 7 段全部命中, 0 命中禁止 crash copy |
| **iOS Simulator UI 视觉 E2E** | ❌ **FAIL** | 6 张截图 md5 一致 = 同一张 RN LogBox crash 屏 |
| iPhone 11 真机 | ❌ **物理未连** | `xcrun devicectl list devices` = No devices found; usbmuxd 在跑但没设备握手 |

### Crash 根因(已 verify)

**L1 直接 crash**:`apps/mobile/.expo/dev/logs/start.log` 显示 Metro 实例化时 `serverRoot:"../../../../.."`, `projectRoot:"../../.."`,bundle 入口解析到 workspace root 去找 `index.js` 失败。Bundle 内 `process.env.EXPO_OS` 被错误注入为 `'web'`,触发 expo hmr.ts:160 web 分支 `window.location.protocol === 'https:' ? 'wss' : 'ws'`,RN 端 `window.location` 不存在 → TypeError。

**L2 monorepo 配置**:`apps/mobile/metro.config.js` 只有:
```js
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.useWatchman = false;
module.exports = config;
```
**缺** monorepo 字段 `watchFolders` / `projectRoot` / `resolver.nodeModulesPaths`,导致 Metro 在 monorepo workspace root 处看 `package.json` 时把 `projectRoot` 推断为 workspace root。

**佐证**:`metro:bundling:failed` 反复报 `Unable to resolve "react-native-safe-area-context"`,`metro:client_log` 报 `[Invariant Violation: Tried to register two views with the same name RNCSafeAreaProvider]` (duplicate registration, monorepo 共享 node_modules 多份拷贝)。

### Plan 416a1e01 决策(22:30)

| Task | Verdict | Reason |
|------|---------|--------|
| mobile-audit-and-smoke | **accept** | 后端契约 6/6 + 3 smoke 全过 + 7/7 文案 |
| mobile-e2e | **manual_retry** | UI 6 段全 crash,worker 已识根因 + 给完整 patch,retry 修 metro + 重跑 |

### mobile-e2e retry 任务清单(已下发给 plan engine)

1. 改 `apps/mobile/metro.config.js` 加 monorepo 字段(完整 patch 见 worker 报告 §修复建议 1):
   - `config.watchFolders = [workspaceRoot]`
   - `config.resolver.nodeModulesPaths = [projectRoot + '/node_modules', workspaceRoot + '/node_modules']`
   - `config.projectRoot = projectRoot`
2. 清 Metro 缓存:`rm -rf apps/mobile/.expo/cache node_modules/.cache/metro`
3. kill 现有 expo run:ios pid 12362 + Metro 71784 / 28476,重启 `expo run:ios`
4. 重跑 6 段 E2E 视觉验证(pairing / today / voice / chat / approval / device)+ 6 张截图
5. **6 张截图必须 md5 各异、每张 >10KB、内容是真实业务屏不能是同一张 crash**
6. iPhone 11 真机路径仍阻塞,继续 report 现状

## 等待 NJX 拍板项

### 必拍 1:iPhone 11 真机物理接入

**当前状态**:Mac mini M4 没有 iPhone 11 物理接入。`xcrun devicectl list devices` = `No devices found`;`usbmuxd` 在跑但没设备握手。

**macOS "iPhone 镜像" app 在跑**(pid 56453, 8h42min,显示上一次 iPhone 主屏状态)—— 这是 cu 截屏右侧 iPhone 屏幕的来源,**不是** iOS Simulator。

**解锁后我能做什么**:
1. iPhone 11 Lightning/USB-C 线连 Mac mini
2. iPhone 设置里信任 Mac
3. 出现 devicectl 设备后,我用 cu 截 iPhone Mirroring.app 窗口 = 操作 iPhone 11
4. 在 iPhone 11 上装 Expo Go App Store 装 + 扫 Metro 8082 QR / 或用 EAS TestFlight build
5. 跑 6 段 E2E 视觉验收(真机 + 录音权限都可用,Simulator 缺录音)

### 必拍 2:TestFlight 上外部分发

**当前阻塞**:Apple Developer Program 账号($99/year)+ 团队注册。EAS projectId 已 hardcode(`1cf237b9-cfe9-4d2c-a8f4-3f9cf7728a19`)。
**EAS README 警告**:Apple ID 未注册 Developer 时**不要重试同账号**。

### 选 1:Simulator E2E 替代真机验收?

- 优点:runtime 已装,无需 NJX 物理操作,30 min 内可跑通 6 段
- 缺点:Simulator 无录音权限,voice chat 段需 mock 文本(API 后端 OK,UI 无 mic 按钮验证)
- 推荐:**先 Simulator 跑通 6 段 + 等 NJX 插 iPhone 11 后补真机 e2e**

## 5min cron 维持

- broker 5min cron(`mavis-cb-broker-healthcheck`)继续跑,维持 broker + mac 健康 sibling safety net
- 任何 retry 推进 evidence 写本文档

## 待 NJX 决策

1. **iPhone 11 物理接入**:你插线 → 我用 cu 截 iPhone 镜像装 + 测 / 还是**等**你拍
2. **Simulator e2e 是否够交付**:我建议 Simulator 跑通 5 段(voice mock)+ 真机 e2e 走 P1,你拍
3. **TestFlight 是否本周做**:Apple Developer Program 申请,卡你

## evidence 时间线

| 时间 | 事件 |
|------|------|
| 22:10 | plan_416a1e01 启动(3 task:audit-and-smoke / e2e / e2e-verify) |
| 22:23 | mobile-e2e worker 报告:后端 6/6 ✅ + UI 6 段全 crash ❌ |
| 22:25 | Mavis 独立 verify:metro.config.js 内容、6 张截图 md5、mobile-api-smoke 重跑 |
| 22:30 | plan 416a1e01 cycle 1 决策:accept audit + manual_retry e2e(修 metro 重跑) |
| 22:30+ | 等 plan engine re-queue mobile-e2e retry |

---
