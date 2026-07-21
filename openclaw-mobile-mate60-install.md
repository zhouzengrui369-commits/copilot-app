# OpenClaw Mobile 安装与验收清单

更新时间: 2026-07-03

目标顺序: 先在电脑端完成可重复可用性验证，再做 iOS Simulator / iPhone 11 镜像真机验证，最后安装到华为 Mate60 4.2.0.210 做最终验收。

当前结论: mobile API、UI 合同、recorder API、CloudBase payload、release contract、iOS Simulator 录音工作区可视化操作已经通过；2026-07-03 已发布 Expo preview OTA `bc78a55e-f936-467a-820e-895299aa6abf`，runtime `1.0.8`。`openclaw-mate60.apk` 已更新为 1.0.8 versionCode 9 的可安装 APK；旧 1.0.7 APK 因 runtimeVersion=appVersion，不能直接通过 OTA 升级到 1.0.8，必须重装新版 APK。

2026-06-24 100-point 修复进展 (NJX Mate60): 已实现 P0-1 vault root 改为 `/Volumes/南极熊`；P0-2 单 `添加笔记` 流程，保存后显示 Markdown + HTML 路径并用 `继续添加` 防重复保存；P0-3 语音转写未配置时明确提示并允许手动转写入库；P0-4 HTML 在知识库阅读页和编辑页都有纯 RN 可读预览；P0-5 Calendar / Today 首屏优先显示待办、知识录入、知识查询；P0-6 待同步队列在 Mac 恢复后自动回放，首屏连接状态区分 `Mac 已连接` 与 Agent 网关状态。修复后已实际通过 `npm run build --workspace @openclaw-workbench/server`、`npm run check --workspace @openclaw-workbench/mobile`、`npm run test:mobile-ui-contract`、`npm run test:mobile-local-usability`、`npm run test:mobile-ios-preflight`。

新增部署前置检查: `npm run test:mobile-deployment-preflight` 会在安装前判断 APK 是否对应当前源码、iPhone 真机是否可安装、Android 是否能本地重包，并检查 JDK / Android SDK。公网 relay 健康检查需要显式运行 `OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK=1 npm run test:mobile-deployment-preflight`。这两个检查都不发布、不上传、不重启任何进程；职责是阻止旧包/旧链路再次进入手机验收。

## 1. 当前已验证

仓库: `/Users/njx/openclaw/copilot`

已通过命令:

```bash
npm run build --workspace @openclaw-workbench/server
npm run check --workspace @openclaw-workbench/mobile
npm run test:mobile-ui-contract
npm run test:mobile-release
npm run test:mobile-ios-preflight
npm run test:mobile-transcription
OPENCLAW_WORKBENCH_URL=http://127.0.0.1:38993 OPENCLAW_ALLOW_PROD_SMOKE_WRITE=YES-I-KNOW OPENCLAW_WORKBENCH_PASSWORD=openclaw2026 npm run test:mobile-api
OPENCLAW_WORKBENCH_URL=http://127.0.0.1:38993 OPENCLAW_MOBILE_USABILITY_MODE=local OPENCLAW_WORKBENCH_PASSWORD=openclaw2026 npm run test:mobile-local-usability
MOBILE_VISUAL_WORKBENCH_URL=http://127.0.0.1:38993 OPENCLAW_WORKBENCH_PASSWORD=openclaw2026 node scripts/mobile-visual-smoke.mjs
npm run test:mobile-apk-release
```

发布命令:

```bash
cd /Users/njx/openclaw/copilot/apps/mobile
npx --yes eas-cli@latest update --channel preview --message "OpenClaw Mobile preview update" --environment preview --platform android --emit-metadata --clear-cache --json
EAS_NO_VCS=1 npx --yes eas-cli@latest build --platform android --profile preview --wait --json --non-interactive
```

`scripts/openclaw-mobile-verify.sh` 覆盖:

- server/mobile TypeScript check。
- mobile release contract。
- APK 文件级 release gate。
- mobile UI contract。
- local isolated server 启动、配对、bootstrap、today、devices。
- 知识库 root list、知识地图 atlas、Markdown create/read/write/delete。
- HTML create/read/write/delete。
- 日程 create/list/update/delete。
- 快速笔记 transcript organize 到 Markdown + HTML。
- refresh token、revoke device。
- 结束后自动清理临时 server，39002 端口无残留。

iOS Release 模拟器可视化验收:

- Release build/run: XcodeBuildMCP `openclaw-mobile-ios-release` profile passed。
- 配对: `http://127.0.0.1:38997` + 6 位码，server 记录 `mobile_pairing_challenges.status = claimed`，设备为 `iPhone 17 OpenClaw`。
- 主导航: `执行台 / 知识库 / 日程 / 设备` 均可点击，且有稳定 testID。
- 执行台: 首屏显示今日判断、日程与待办、下一步行动；内部 `执行 / 语音 / 对话 / 审批` 均可点击。
- 知识库: 默认进入知识地图，显示 Atlas Summary、来源、分类、节点，不是空 Vault 页。
- 日程: 日/周视图、新建日程入口、空态可用，无 `Bad Request`。
- 设备: 显示已信任设备、server URL、令牌有效期、接口版本。

本轮 API/可用性 smoke 关键证据:

```text
knowledge atlas: 80 sources / 80 nodes / 78,809 bytes
quick note markdown: /private/tmp/openclaw-mobile-verify-39002-workspace/memory/knowledge/notes/calendar/2026-06/*.md
quick note html: /private/tmp/openclaw-mobile-verify-39002-workspace/memory/knowledge/notes/calendar/2026-06/*.html
calendar CRUD: create/list/update/delete ok
auth refresh + device revoke: ok
verify port cleanup: 39002 has no listener after completion
```

## 2. 当前不可算通过的点

1. Mate60 实机完整验收还未由 NJX 确认，所以产品不能算最终通过。
2. 本轮建议 Mate60 直接安装 2026-06-24 build8 APK；如果手机上已经安装 1.0.7 runtime，理论上彻底退出并重新打开 App 可拉取 preview OTA，但为避免旧包/旧缓存误判，本轮以重装 build8 为准。
3. iOS Simulator 已完成 Release 包可视化操作验收；iPhone 11 已被 CoreDevice 识别，但镜像真机完整功能验收还未完成。
4. OpenClaw node 已连接，但 `nodes run` 在长验证脚本上出现过超时，不能把 OpenClaw 代理执行当作稳定验收证据。
5. 本机 Android 重包未就绪: 当前没有 `apps/mobile/android` 原生工程，且 `java -version` 返回无 Java Runtime；本轮使用 EAS 远端 APK，不影响 Mate60 安装测试。

部署前置检查当前输出:

- `OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK=1 npm run test:mobile-deployment-preflight` 返回 `ok: true`、`readyForMate60: true`。
- CloudBase relay 健康检查返回 200 / `{"ok":true}`，可做 Mate60 非同网公网测试。
- iPhone 11 当前可被 CoreDevice 识别: `南极熊iPhone ... available (paired)`。
- 仅有本机 Android Gradle 重包能力缺失的 warning；本轮使用 EAS 远端 APK，不作为 Mate60 安装阻塞。

## 3. 当前 APK 信息

```text
APK path: /Users/njx/openclaw/copilot/openclaw-mate60.apk
Versioned APK: /Users/njx/openclaw/copilot/release/openclaw-mate60-1.0.8-build9-5f227495.apk
Manifest: /Users/njx/openclaw/copilot/release/openclaw-mate60-1.0.8-build9-5f227495.manifest.json
EAS build: 5f227495-ff7d-46ae-bd11-762a49b060f8
EAS build page: https://expo.dev/accounts/nanjixiong/projects/openclaw-mobile/builds/5f227495-ff7d-46ae-bd11-762a49b060f8
EAS artifact: https://expo.dev/artifacts/eas/h7UR0bGRKLQeAYTkGR1Ql9Mn1fuifi5wUgzE1fV0bIE.apk
SHA256: 0cefc40584601390349ad664209663d6c8d80be43a2c647e17f123e8792f0775
Size: 76369619 bytes
Package: com.openclaw.mobile
Version: 1.0.8
VersionCode: 9
Preview OTA update: 019f2689-88e4-70d0-9b5a-850c701c561a
Preview OTA group: bc78a55e-f936-467a-820e-895299aa6abf
Preview OTA dashboard: https://expo.dev/accounts/nanjixiong/projects/openclaw-mobile/updates/bc78a55e-f936-467a-820e-895299aa6abf
```

注意: 这是已签名可安装包的文件级事实；公网同步当前可用，但最终功能通过仍以 Mate60 实机验收为准。

## 4. 下一步验证顺序

### A. 电脑端重复验证

```bash
cd /Users/njx/openclaw/copilot
npm run test:mobile-deployment-preflight
OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK=1 npm run test:mobile-deployment-preflight
scripts/openclaw-mobile-verify.sh
```

通过标准: `scripts/openclaw-mobile-verify.sh` 退出码为 0，且结束后没有残留监听端口。`OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK=1 npm run test:mobile-deployment-preflight` 需返回 `ok: true` 和 `readyForMate60: true`。

### B. iOS Simulator 验证

```bash
cd /Users/njx/openclaw/copilot
npm run test:mobile-ios-preflight
cd apps/mobile
EXPO_NO_TELEMETRY=1 CI=1 npx expo export --platform ios --output-dir /private/tmp/openclaw-mobile-ios-export-final
```

通过标准:

- App 能启动到中文界面。
- 能输入 Workbench URL 和 6 位配对码。
- 执行台看到日程/待办/笔记入口。
- 知识库能看到知识地图和 vault。
- 日程页能新增、编辑、删除。
- Markdown/HTML 能打开、编辑、保存。

### C. iPhone 11 镜像真机验证

前置:

- iPhone 11 已连接 Mac，iPhone Mirroring 可操作。
- iPhone 信任这台 Mac。
- Xcode CoreDevice 能看到真机: `xcrun devicectl list devices` 必须列出 iPhone；当前 2026-06-24 检查结果为 `南极熊iPhone ... available (paired)`。
- 优先走 Simulator 同款本地连接；若不在同一网络，再走公网 relay。

通过标准同 iOS Simulator，但必须补录音权限和真机麦克风路径。

### D. Mate60 最终验收

前置二选一:

- 同 Wi-Fi/LAN: Mac 工作台监听 `0.0.0.0:38888`，Mate60 访问 `http://<Mac-LAN-IP>:38888`。
- 公网: CloudBase relay 当前健康，手机端可访问 `https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay`。

本轮 mobile JS 已发布到 `preview` OTA:

```bash
cd /Users/njx/openclaw/copilot
npm run mobile:update:preview
```

如果需要下一轮原生能力或 versionCode 变化，则重建 APK:

```bash
cd /Users/njx/openclaw/copilot
npm run mobile:android:preview
```

## 5. Mate60 安装步骤

0. 本轮必须先卸载旧 OpenClaw，再安装 build9，避免旧 1.0.7 runtime/旧 OTA 缓存干扰验收。
1. 获取 APK: `/Users/njx/openclaw/copilot/openclaw-mate60.apk`。
2. 传到 Mate60: USB、微信文件传输或 EAS install page。
3. Mate60 打开 `设置 -> 安全与隐私 -> 更多安全设置`。
4. 临时允许安装未知来源应用。
5. 在文件管理器点击 APK 并安装。
6. 安装完成后关闭未知来源安装权限。
7. 打开 OpenClaw。
8. 输入 Workbench URL 和 6 位配对码。非同网优先使用 CloudBase 公网 relay。

## 6. 手机端验收清单

任一失败都不算通过:

1. App 可安装并打开。
2. 可连接 njx-copilot。
3. 可看到 `执行台 / 知识库 / 日程 / 设备`。
4. 执行台可看到今日日程、待办、下一步行动。
5. 智能助理/执行台能看到日程和待办摘要。
6. 知识库能看到知识地图。
7. 知识库能浏览 vault 文件。
8. 可打开 Markdown。
9. 可打开 HTML。
10. 可编辑 Markdown 并保存。
11. 可编辑 HTML 或 HTML 源内容并保存。
12. 日程可新增。
13. 日程可编辑。
14. 日程可删除。
15. 可看到历史笔记。
16. 可快速新增文本笔记。
17. 可录音并生成语音笔记。
18. 语音/文本笔记可通过“添加笔记”入库。
19. 入库后服务端生成 Markdown。
20. 入库后服务端生成 HTML。
21. Markdown/HTML 产物路径可追溯。
22. 断网、同步失败、语音失败、入库失败都有明确提示和重试路径。
23. 重新打开 App 后数据仍存在或可重新同步。

## 7. 失败排查

### 公网 relay 失败

```bash
curl -i https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay/health
```

如果不是 200 / `{"ok":true}`，先修 CloudBase，再测 Mate60 外网。

### LAN 失败

```bash
curl http://127.0.0.1:38888/api/health
lsof -nP -iTCP:38888 -sTCP:LISTEN
```

Mate60 不能输入 `127.0.0.1`，必须输入 Mac 局域网 IP。

### 手机仍显示旧 UI

原因通常是旧 APK/旧 OTA。处理顺序:

1. 确认安装的是 `/Users/njx/openclaw/copilot/openclaw-mate60.apk`，文件时间应为 2026-06-24 21:07，VersionCode 8。
2. Mate60 彻底退出并重新打开 App，触发 preview OTA 拉取。
3. 若仍旧，先卸载旧 OpenClaw，再安装 build8 APK。

### 添加笔记未生成 HTML

Mac 上检查:

```bash
sqlite3 /Users/njx/openclaw_data/copilot/data/workbench.sqlite \
  "select title, knowledge_path, knowledge_html_path from calendar_notes order by updated_at desc limit 5;"
```

Markdown/HTML 应出现在:

```text
memory/knowledge/notes/calendar/<YYYY-MM>/
```

## 8. 回滚/重装

1. 手机卸载 OpenClaw。
2. 重新安装上一个确认可用 APK 或本轮 APK。
3. 桌面端撤销旧设备 token。
4. 重新生成配对码并配对。

## 9. 不做的事

- 不把 CloudBase relay 未恢复时的 Mate60 外网测试算作失败的 App 功能验收。
- 不把旧 APK 上的旧 UI 当成本轮源码失败；必须先 OTA 或重建。
- 不把 API smoke 通过等同于真机 UI 通过。
- 不绕过 Mac 工作台数据源直接写本地假数据。
