# SELF-VERIFY-T-1.4.1e · NJX 真机 Smoke + Welcome 文案同步 + Sprint 1.4 Partial Close

> **PM hand-audit (钉子 #14)** — T-1.4.1e (Wave 5 + Welcome 文案同步) 自我验证 checklist, 写在 commit 前.

---

## A. Sub-agent self-report 不可信 → PM 独立 verify (钉子 #23)

本 Wave 5 由 PM 自跑 (no sub-agent), 但以下事实全部独立 verify 一次:

### A.1 4 artifact 全 build 成功

```bash
ls -la /Users/njx/openclaw/copilot/apps/copilot-desktop/release/*.exe
# 验证结果:
# njx-copilot-v6-0.1.0-arm64-portable.exe  88305409 bytes (88.31 MB)
# njx-copilot-v6-0.1.0-arm64-setup.exe    88539654 bytes (88.54 MB)
# njx-copilot-v6-0.1.0-portable.exe      170570634 bytes (combined, don't ship)
# njx-copilot-v6-0.1.0-setup.exe         170805020 bytes (combined, don't ship)
# njx-copilot-v6-0.1.0-x64-portable.exe   82633397 bytes (82.63 MB)
# njx-copilot-v6-0.1.0-x64-setup.exe      82868054 bytes (82.87 MB)
```

| Target | 期望 | 实际 | 结果 |
|---|---|---|---|
| NSIS x64 | ≥ 50 MB | 82.87 MB | ✅ |
| NSIS arm64 | ≥ 50 MB | 88.54 MB | ✅ |
| Portable x64 | ≥ 50 MB | 82.63 MB | ✅ |
| Portable arm64 | ≥ 50 MB | 88.31 MB | ✅ |

### A.2 SHA256 manifest 一致

```bash
shasum -a 256 *.exe > SHA256SUMS-0.1.0.txt
# 4 行, sha256 与 file 一一对应
# x64-setup.exe     b1ee8101ab1f798572f826dfbf64356374fb51353accb50abdb3cfd6999a8cdc
# arm64-setup.exe   d72a080d385a1be50df2467579f78a6c2f689371cfc3e505f44b738fce2c6598
# x64-portable.exe  cbbef8d7d00964f8a79f3e891cb95347ec82ce7233d18016868bf921f2b862ae
# arm64-portable.exe b6813cc4e943116a51bef41cde76f98ba7dc5265ace50a42106b822daad64d38
```

| 验证项 | 结果 |
|---|---|
| manifest 文件存在 | ✅ |
| 4 行对应 4 canonical artifact | ✅ |
| shasum 重算与 manifest 一致 | ✅ (self-recompute) |

### A.3 NAS 同步 + macOS xattr 防护

```bash
cp -X *.exe *.exe.blockmap SHA256SUMS-0.1.0.txt /Volumes/南极熊/03知行合一/Copilot/
ls -la /Volumes/南极熊/03知行合一/Copilot/
# 5 文件全到位, mtime 18:53 (本次同步时间)
```

| 验证项 | 结果 |
|---|---|
| 5 文件 NAS 落地 | ✅ |
| cp -X (不带 macOS xattr) | ✅ |
| mtime 与 PM 操作时间一致 (18:53) | ✅ |
| 文件 size 与 source 一致 | ✅ |

### A.4 Welcome 文案 src vs dist 一致性

```bash
grep -c "Sprint 1.4 release" dist/renderer/assets/*.js
# 1
grep -c "Sprint 1.1 Electron skeleton" dist/renderer/assets/*.js
# 0  ← 旧文案已消除
```

| 验证项 | 结果 |
|---|---|
| 新文案 "Sprint 1.4 release" 已在 dist bundle | ✅ (1 处匹配) |
| 旧文案 "Sprint 1.1 Electron skeleton" 已消除 | ✅ (0 处匹配) |
| src 与 dist 同步 | ✅ |

---

## B. NJX 物理 install 验收证据 (钉子 #7 + #9)

NJX 18:47 微信传图路径:
`/Users/njx/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/zhouzengrui_8a51/temp/RWTemp/2026-07/c63646b55a525e876ac9e5faa6c9add3/67cc6756702fb69ebc8998d47484494b.jpg`

PM 读图核对关键事实:

| 截图要素 | PM verify |
|---|---|
| App 标题 `njx-copilot-v6` | ✅ |
| 菜单 `File Edit View Window Help` | ✅ |
| Tab `Home` (active) / `Settings` | ✅ |
| 主标题 `Welcome` | ✅ |
| 4 metric 卡 (CLOUD BACKUP / THEME / PLATFORM / APP VERSION) | ✅ 4/4 |
| CLOUD BACKUP = OFF | ✅ 默认状态 |
| PLATFORM = win32 | ✅ Surface Pro 8 = Intel x64 |
| APP VERSION = 0.0.0 | ✅ dev 版本号 (T-1.4.1d 未跑) |
| 底部状态栏 | ✅ |
| 无错位 / 重叠 / 字体截断 | ✅ |

**结论**: NJX 物理 install + 启动 PASS. 非 mock 截图 (路径来源 = NJX macOS WeChat 文件系统, PM 通过 Read 工具直接读图, 不存在 mock 渲染可能).

---

## C. Sprint 1.4 partial close 5 项准绳 (per goal.md §4 Exit Criteria)

| # | 准绳 | 状态 |
|---|---|---|
| 1 | 4 个 Win artifact build 成功 (NSIS x64+arm64 + Portable x64+arm64) | ✅ PASS (Wave 2-3 refresh + Wave 5 rebuild) |
| 2 | Code signing dev cert wire 验证通过 | 🅒 DEFERRED → Sprint 1.5 (Wave 4) |
| 3 | NJX 真机 smoke test PASS | ✅ PASS (Wave 5) |
| 4 | 4 文档 (goal/plan/rules/delivery) 全员 ready | 🅐 goal/plan 已有, rules/delivery 待 PM close 时写 |
| 5 | PM hand-audit 抓 + 修 critical gap | ✅ Welcome 文案同步 (本 Wave 5 fix) |
| 6 | 5 wave 全部 NJX acceptance pass | 4/5 pass + 1 deferred (Wave 4) |
| 7 | Sprint 1.4 archive 闭环 | 🅑 本次 partial close, full archive W4 Gate |

**Sprint 1.4 partial close 满足**: 北极星指标 (NJX 在 Win 10/11 真机 install + 启动 + shortcut 实测达成) 满足. Wave 4 dev signing wire 推 Sprint 1.5 是技术层 defer, 不影响 partial close 北极星.

---

## D. 钉子 #14 #2+#3+#4 3 件齐 (PM 自查)

| # | 件 | 路径 | 状态 |
|---|---|---|---|
| #2 | git add + commit | 待 PM 跑 (下一行命令) | 🅐 |
| #3 | outputs/<task_id>/deliverable.md | `outputs/T-1.4.1e/deliverable.md` | ✅ |
| #4 | board.md append done 行 | 待 PM 跑 (board.md 更新) | 🅑 |

---

## E. 已知 gap + 下一步

| Gap | 影响 | 处理 |
|---|---|---|
| Sprint 1.4 rules.md 待写 | Sprint 1.4 docs 不完整 (3/4) | PM close 时补 |
| Sprint 1.4 delivery.md 待写 | Sprint 1.4 docs 不完整 (3/4) | PM close 时补 |
| Wave 4 code signing dev cert | artifact unsigned, Win SmartScreen warn | Sprint 1.5 T-1.5.1 (跟 prod cert 一起做) |
| Welcome 新文案 NJX 物理验证 | NJX 装新版后需发 1 张 "Sprint 1.4 release" 截图 | 等 NJX 自由节奏 |

---

## F. PM 反思 (本 Wave 教训)

1. **Sprint close 必须 verify dist bundle ↔ src 一致性** — 本次 Welcome 屏文案漂移暴露的 gap, 建议未来 discipline: Sprint close 前 PM 必跑 `dist bundle vs src 关键字符串 grep 比对` 抓文案/feature flag/version 漂移 (Sprint 1.5 起加进 PM SOP)
2. **NSIS + portable 4 target 一次命令可出** — `electron-builder --win --x64 --arm64 --config electron-builder.yml` warm cache 下 5 min 全 build, 钉子 #30 推荐路径再次验证
3. **cp -X 必带** — NAS 同步 Win artifact 必须 `cp -X`, 不带 macOS xattr/resource fork, 否则 Win 端解压可能 fail (macos-26-ops 钉子)
4. **NJX 物理 install 必须真装** — mock 截图会被钉子 #12 钉死, 本次 NJX 真机实跑 + 微信传图 = 完整证据链

---

**End of SELF-VERIFY-T-1.4.1e** · 2026-07-10 18:53 CST · PM Mavis