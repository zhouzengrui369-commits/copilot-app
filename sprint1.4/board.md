# Sprint 1.4 Board · Win CI Runner + Code Signing Dev Cert (T-1.4.1)

> **Sprint**: 1.4 — Sprint 1.3 follow-up 主线 (产品化)
> **启动**: 2026-07-10 13:11 CST (NJX 拍板 win-runner-first)
> **Close 目标**: W4 Gate (2026-07-19 预计) — Phase 1 W4 复盘 + Sprint 1.4 全 task done
> **Owner**: NJX (OPC) · **PM**: Mavis (mvs_144239070a21476dae746d1cff6af16b)
> **Plan workspace**: `/Users/njx/.mavis/plans/plan_4da13300/workspace` (cancelled @ 15:28)
> **Refresh trigger**: NJX 17:11 popup 「Slim 镜像跑 NSIS 重试 (🅰)」→ PM standalone rebuild

---

## Wave 1: T-1.4.1a Win runner setup [DONE 2026-07-10 13:25]
- Worker α-Wave-1 (mvs_b068a920720b4736ab42a2e45d55118f)
- `sp1.4-T-1.4.1a` @ `4e965af6` + plan-mirror `f290b674`
- Added `.github/workflows/build-win.yml` (137 lines, 4-matrix: NSIS+Portable × x64+arm64)
- Coexists with existing `release-win.yml` (linux+wine OSS pipeline)
- Cache pre-warm `actions/cache@v4` × Electron + electron-builder + node_modules
- 钉子 #30 explicit flags applied (`--config`, `--${{matrix.arch}}`, `timeout-minutes: 25`)
- **Verdict**: PASS (config layer; build execution deferred to Wave 2-3)
- **Caveat (caught by Wave 2)**: workflow assumes `origin` remote + `gh` CLI; **none exist on local host** — runner trigger is dead-letter without remediation step

---

## Wave 2-3: T-1.4.1b+c NSIS x64+arm64 + Portable x64+arm64 [DONE 2026-07-10 17:53 (refresh-and-retry)]
- PM (Mavis · mvs_144239070a21476dae746d1cff6af16b) — refresh-and-retry standalone path after plan_4da13300 cancel @ 15:28
- No subagent dispatched (single-machine build, NJX popup 17:11 → 65min budget → actual ~42min)
- NJX popup 拍板 🅰 「Slim 镜像跑 NSIS 重试」→ went simpler: macOS native electron-builder (no Docker image needed)
- **4 artifact 全部 build 成功** (electron-builder 自带 wine-4.0.1-mac auto-provision, 19MB in 3s):

| Artifact | Path | Size | File type |
|----------|------|------|-----------|
| NSIS x64 setup | `apps/copilot-desktop/release/njx-copilot-v6-0.1.0-x64-setup.exe` | 79 MB | NSIS installer (Nullsoft self-extracting) |
| NSIS arm64 setup | `apps/copilot-desktop/release/njx-copilot-v6-0.1.0-arm64-setup.exe` | 84 MB | NSIS installer (Nullsoft self-extracting) |
| Portable x64 | `apps/copilot-desktop/release/njx-copilot-v6-0.1.0-x64-portable.exe` | 79 MB | PE32 GUI exe |
| Portable arm64 | `apps/copilot-desktop/release/njx-copilot-v6-0.1.0-arm64-portable.exe` | 84 MB | PE32 GUI exe |

Plus 2 combined installer (don't ship these): `njx-copilot-v6-0.1.0-setup.exe` (163MB) + `njx-copilot-v6-0.1.0-portable.exe` (163MB).

- SHA256 manifest: `apps/copilot-desktop/release/SHA256SUMS-0.1.0.txt` (6 lines)
- Blockmap: 3 files (NSIS x64 / arm64 / combined — for delivery incremental updates)
- `outputs/T-1.4.1b/{deliverable.md, SELF-VERIFY-T-1.4.1b.md}` written
- **Verdict**: **PASS** (4/4 artifact ≥50MB, NSIS format confirmed, SHA256 + blockmap 全齐)
- **Discovery logged (钉子 #37)**: electron-builder 自带 Wine auto-provision — worker's "Wine not installed" PARTIAL 实际是 bash 10min timeout 截断，非真 infra-blocked
- **Action outstanding**: Wave 5 NJX 真机 install + 启动 smoke test (NJX physical)

---

## Wave 4: T-1.4.1d Code signing dev cert wire [DEFERRED → Sprint 1.5]
- Reason: Wave 5 (NJX 真机 smoke) 优先级更高, signing wire 可在 Sprint 1.5 + dev cert real接入时一起做
- 预估 deferred cost: 30 min (OpenSSL pfx gen + Win signtool validation)

---

## Wave 5: T-1.4.1e NJX 真机 smoke test + Welcome 文案同步 [DONE 2026-07-10 18:53]

- PM (Mavis · mvs_144239070a21476dae746d1cff6af16b) — refresh-and-extend path (Wave 2-3 之后)
- NJX 18:47 微信传图 Surface Pro 8 install 截图 → 18:48 弹窗拍板 `pass-with-fix + pm-do + close-now`
- PM 立即串行: 改 App.tsx:67 文案 → vite build → electron-builder rebuild 4 target → SHA256 → 上 NAS

### NJX Surface Pro 8 install 验收 (PASS)

| 截图要素 | 期望 | 实际 |
|---|---|---|
| App 标题 | `njx-copilot-v6` | ✅ |
| Tab 导航 | Home / Settings | ✅ |
| 4 metric 卡 | CLOUD BACKUP / THEME / PLATFORM / APP VERSION | ✅ 4/4 |
| PLATFORM | win32 (Surface Pro 8 = Intel x64) | ✅ |
| 底部状态栏 | Cloud backup: OFF · Theme: auto | ✅ |
| Welcome 屏文案 | "Sprint 1.1 Electron skeleton ... Real features land in later sprints" | ⚠️ 未同步到 Sprint 1.4 (本次 PM-do 修复) |

### Welcome 文案同步修复 (PASS)

```diff
- "This is the Sprint 1.1 Electron skeleton. Open Settings to verify..."
+ "This is the Sprint 1.4 release — packaged installer (NSIS + Portable, x64 + arm64). Open Settings to verify..."
- "...shortcut editor. Real features land in later sprints."
+ "...shortcut editor. Cloud sync and multi-device pairing ship in Sprint 1.5+."
```

- 改动文件: `apps/copilot-desktop/src/renderer/App.tsx:67`
- rebuild 路径: vite build → electron-builder --win --x64 --arm64 → 4 artifact 全 build (warm cache, 5 min)
- 4 artifact 重 build (size 略增: 含 dist bundle hash 漂移 + 新文案 1 行):
  - `njx-copilot-v6-0.1.0-x64-setup.exe`     82.87 MB
  - `njx-copilot-v6-0.1.0-arm64-setup.exe`   88.54 MB
  - `njx-copilot-v6-0.1.0-x64-portable.exe`  82.63 MB
  - `njx-copilot-v6-0.1.0-arm64-portable.exe` 88.31 MB
- SHA256 manifest: `apps/copilot-desktop/release/SHA256SUMS-0.1.0.txt` (4 行)
- NAS 同步: `cp -X` 5 文件到 `/Volumes/南极熊/03知行合一/Copilot/`, mtime 18:53
- 验证: `grep -c "Sprint 1.4 release" dist/renderer/assets/*.js` = 1, 旧文案 grep = 0 ✓

### 输出

- `outputs/T-1.4.1e/deliverable.md` (198 lines)
- `outputs/T-1.4.1e/SELF-VERIFY-T-1.4.1e.md` (PM hand-audit)

**Verdict**: PASS · Sprint 1.4 partial close ready

---

## Sprint 1.4 状态摘要 (2026-07-10 18:53 CST)

| Wave | Status | Verdict | 时间 |
|------|--------|---------|------|
| 1 — T-1.4.1a config | ✅ DONE | PASS | 13:25 |
| 2 — T-1.4.1b NSIS x64+arm64 | ✅ DONE | PASS (refresh) | 17:53 |
| 3 — T-1.4.1c Portable x64+arm64 | ✅ DONE | PASS (refresh) | 17:53 |
| 4 — T-1.4.1d code signing dev cert | 🅒 DEFERRED | → Sprint 1.5 | — |
| 5 — T-1.4.1e NJX 真机 smoke + Welcome 同步 | ✅ DONE | PASS | 18:53 |

**Sprint 1.4 = 4/5 task DONE, 1 DEFERRED. artifact side 完成 + Win 物理 install 实跑通 + Welcome 文案同步 → partial close ready.**

PM 自主推进 #2 (per project-pm §0.1): Wave 4 deferred 决策由 PM 拍 (defer to S1.5 + signing dev cert 一起做), 因为不属于 NJX 拍板四象限。

### Sprint 1.4 partial close vs full close

- **partial close** (本次): 4/5 wave done + artifact side 全绿 + Win 物理 install + 启动 + shortcut 实测达成 + Welcome 屏同步。北极星指标满足。full archive 等 W4 Gate 复盘会后跑。
- **full close** (W4 Gate): 4 文档 (goal/plan/rules/delivery) 全员 ready + retrospective + Phase 1 W4 Gate summary + Sprint 1.5 hand-off doc。

---

## PM 反思循环

**钉子 #37 (已记 memory 2026-07-10)**: electron-builder Win target 在 macOS host 默认 auto-provision `wine-4.0.1-mac.7z` from electron-userland/electron-builder-binaries — 不要被 "Wine not installed" 误判为 infra-blocked。本 Wave 5 rebuild 0 sec 下载 (warm cache), 再次验证。

**钉子 #36 (已记 memory)**: plan cancel 必须同步 disable cron — 6 个 silent tick 浪费 + 让 NJX 看到 PM 在空转。

**新发现 (待 NJX 拍板是否固化为钉子 #38)**: **Sprint close 必须 verify dist bundle ↔ src 关键字符串一致性**。本次 Welcome 屏文案漂移暴露的 gap, 建议 Sprint close 前 PM 跑 `dist bundle vs src grep 比对` 抓文案/feature flag/version 漂移 (Sprint 1.5 起加进 PM SOP)。W4 Gate 复盘会拍板。

**下一步 (PM 自主 per §0.1)**:
- Sprint 1.5 prep: 回看本 Sprint delivery + 写 plan + 启动 Wave 1 sub-plan (NJX 沉默 ≤ 30min 自动启动)
- Wave 4 (dev signing wire) 落到 Sprint 1.5 T-1.5.1
- 等 NJX 重装新版后发 "Welcome 1.4 release" 截图闭环
- W4 Gate 复盘会 (7/19 预计) 前 1h PM 准备 retrospective + summary
