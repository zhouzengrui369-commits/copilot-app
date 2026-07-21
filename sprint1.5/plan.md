# Sprint 1.5 Plan · Win Dev Signing Wire + Branded Icon + PM SOP 固化

> **Sprint**: 1.5 — Sprint 1.4 follow-up 主线 (产品化)
> **启动**: 2026-07-10 19:35 CST (NJX 拍板 S1.4 partial close 验收通过 + PM 自动起 S1.5 prep)
> **Close 目标**: W4 Gate (2026-07-19 预计) — Phase 1 W4 复盘会前 S1.5 全 task done
> **Owner**: NJX (OPC) · **PM**: Mavis (mavis)
> **依赖**: Sprint 1.4 partial close PASS (commit `32950d8c`, 4/5 wave done, T-1.4.1d dev signing wire DEFERRED → S1.5 T-1.5.1)

---

## 1. 北极星指标 (per goal.md §1)

**S1.5 验收 = W4 Gate 复盘会前 4 文档 ready + 全员 task done + NJX 真机看 S1.4 新版装 branded icon + dev signed artifact**:
- T-1.5.1 PASS: dev cert self-signed .pfx wire 验证, 4 artifact signed byte-level PASS
- T-1.5.2 PASS (如纳入): branded icon 替换, 4 artifact rebuild, NSIS 显示正确
- 钉子 #38: Sprint close dist bundle ↔ src grep SOP 落地

---

## 2. Task 拆分 (NJX 19:44 拍板 = with-tests 路径, 4-5 wave, W4 Gate 7/19 前 close)

| Wave | Task ID | 描述 | 预计时长 | depends | 状态 |
|------|---------|------|----------|---------|------|
| **Wave 1** | T-1.5.1 | Win dev signing wire — self-signed .pfx + electron-builder wire + signtool verify | ≤30min (PM dispatch) | S1.4 partial close | 🟡 立即 dispatch |
| **Wave 2** | T-1.5.2 | Branded icon 替换 T-1.3.2 placeholder + 4 artifact rebuild | ≤30min (PM dispatch) | Wave 1 | 🟢 拍板纳入 |
| **Wave 3** | T-1.5.3 | vitest 181 → 200+ 补齐 (5 packages: kb/rag/llm-client/kg/copilot-cloud) | ≤60min (PM dispatch, 多 package 并行) | — | 🟢 拍板纳入 |
| **Wave 4** | 钉子 #38 + W4 Gate 准备 | PM SOP 固化 dist bundle grep + 4 文档 close + retrospective 草案 | ≤30min (PM 自主) | Wave 1+2+3 | 🟢 PM 自主 |

**总时长**: ~2.5h (PM dispatch 全部) · 实际可拆 sub-wave 并行 → 实际 ~4-5h spread across 7/10-7/19

**Wave 1-2 串行** (T-1.5.1 必先于 T-1.5.2, dev cert 配好后 rebuild 4 artifact 顺带换 icon)
**Wave 3 与 Wave 1-2 并行** (vitest 5 packages 独立, 不依赖 Win artifact rebuild)

---

## 3. Wave 详细说明

### Wave 1: T-1.5.1 Win dev signing wire (从 S1.4 Wave 4 deferred)

**目的**: 验证 electron-builder 接 .pfx + env var 能 sign 成功, byte-level 验证, 为 S1.6+ 真实 prod cert 铺路

**交付** (S1.4 rules.md §3 红线继承):
- `build/dev-cert.pfx` (gitignored, openssl self-signed 模板)
- `build/dev-cert.key` (gitignored)
- `build/dev-cert.crt` (gitignored)
- `electron-builder.yml` 改 `certificateFile: build/dev-cert.pfx` + `certificatePassword: ${CSC_KEY_PASSWORD}`
- `.env.example` 加 `CSC_KEY_PASSWORD=changeme-dev-only` 占位
- `.gitignore` 加固 `build/dev-cert.pfx / *.key / *.pfx`
- 1 次实测 signed artifact 输出 (Win SmartScreen 会 warn, 但 byte-level 已 signed)
- signtool verify 截图 (byte-level 验证)

**红线** (S1.4 rules.md §3.1):
- ✅ 仅 self-signed: `openssl req -x509 -newkey rsa:2048 -keyout dev-cert.key -out dev-cert.crt -days 365 -nodes`
- ✅ 仅 wire 验证, 不引入任何 prod cert material
- ✅ .pfx 用 `openssl pkcs12 -export` 转换, password 走 CSC_KEY_PASSWORD env

**验收方式** (T-1.5.1):
- 跑 `electron-builder --win --x64 --config electron-builder.yml`
- 4 artifact 全部 build 成功 (warm cache, ~5min)
- `signtool verify /v njx-copilot-v6-0.1.0-x64-setup.exe` → "SignTool is signing the file" 成功记录
- 字节级 grep: `grep -c "Win32 signature" njx-copilot-v6-0.1.0-x64-setup.exe` ≥ 1
- Win SmartScreen 会 warn "Unknown Publisher" — 这是预期, 不算 fail (prod cert 才消除)

**风险与回退** (S1.4 plan.md §6 继承):
| 风险 | 回退 |
|------|------|
| openssl pfx gen 失败 | macOS 自带 openssl 3.x 应该 work, 不行用 LibreSSL |
| electron-builder 不识别 .pfx path | 检查 `certificateFile: build/dev-cert.pfx` 相对路径, 显式 cd 到 `apps/copilot-desktop/` |
| signtool verify 失败 | macOS 没 signtool, 用 `codesign -dv` 看不适用, 改用 `osslsigncode verify` 跨平台验证 |
| NJX 没 Win 真机 | 跳过 signtool verify, 改用 byte-level grep + NJX 看 install warning 截图 |

### Wave 2: T-1.5.2 Branded icon 替换 (NJX 19:44 拍板纳入)

**目的**: 替换 T-1.3.2 placeholder icon, NSIS installer 显示真 branded icon

**交付**:
- `apps/copilot-desktop/build/icon.ico` (新 branded, 多尺寸 .ico)
- `apps/copilot-desktop/build/icon.png` (1024x1024 master)
- `apps/copilot-desktop/gen-icon.mjs` 不动 (T-1.3.2 design decision 保持)
- 4 artifact rebuild, NSIS 显示新 icon

**候选输入**:
- 🅰 用 NJX 现成 logo (用户提供, PM 不擅自 design)
- 🅱 用文字 logo "njx-copilot" + 简笔 icon (PM 临时方案, 需要 NJX 后续替换)
- 🅲 不做 (推 S1.6, 沿用 T-1.3.2 placeholder icon)

**红线**:
- ❌ 不擅自 design logo (需 NJX 提供或批准)
- ❌ 不破坏 T-1.3.2 electron-builder.yml mac section (只动 win section)
- ❌ 不引入新 native dep 到 gen-icon.mjs

**验收方式**:
- `file build/icon.ico` → "MS Windows icon resource" 多尺寸
- 4 artifact rebuild 成功 (warm cache, ~5min)
- NSIS install 截图: shortcut icon 显示 branded (NJX 物理验)
- icon 显示 ≥ 16x16, 32x32, 48x48, 256x256 (Windows standard)

**风险与回退**:
| 风险 | 回退 |
|------|------|
| NJX 没 logo 资源 | 走 PM 临时方案 🅱, 留 TODO 给 NJX 后续替换 |
| ico 格式不支持 | 用 `imagemagick convert` 转换, 或 sips (macOS native) |
| NSIS 显示老 icon | electron-builder cache 清, rebuild 强制 |

### Wave 3: T-1.5.3 vitest 181 → 200+ 补齐 (5 packages, NJX 19:44 拍板)

**目的**: 把 packages/ 5 个 vitest config 下的 test 数量从 181 补到 200+, 收口 S1.3 follow-up #1

**5 个 vitest config 位置** (PM verify 7/10 19:44):
- `packages/kb/vitest.config.ts`
- `packages/rag/vitest.config.ts`
- `packages/llm-client/vitest.config.ts`
- `packages/kg/vitest.config.ts`
- `apps/copilot-cloud/vitest.config.ts`

**交付**:
- 5 个 package 各补 ≥ 4 个 test (181 → 200+ = 19+ 个新增)
- 重点 coverage gap: T-1.4.4 候选原本是 edge case + error path 测试
- `pnpm -w test` 全绿 (5 package 全跑)
- 1 个 PM hand-audit 报告: 列出新增 test name + 覆盖 scenario

**红线** (钉子 #14 + #23 + #27 继承):
- ❌ 不为了凑数写 trivially-true test (e.g. `expect(1).toBe(1)`)
- ❌ 不 mock 整个 module (Sprint 1.3 v3 教训: mock 重于实跑, 反而漏 bug)
- ❌ 不动 vitest config (保持 5 package 各自 baseline)
- ✅ 每个 test 必真跑 + 必 fail-then-pass 验证
- ✅ coverage gap 优先于行数 (focus: error path + edge case + integration)

**验收方式**:
- 跑 `pnpm -w test` 5 package 全跑 → 200+ tests pass, 0 fail
- 跑 `pnpm -w test --coverage` → 5 package coverage 不下降
- 列出新增 test name + 对应 scenario 的 markdown 表格

**风险与回退**:
| 风险 | 回退 |
|------|------|
| 5 package 并行 test 互相干扰 | 拆 5 个 sub-wave 串行, 仍 ≤ 60min 总时长 |
| Edge case 设计不出 | 跑现有 source 找 uncovered branch, 优先 branch coverage |
| Test 跑太慢 (>30s per package) | 加 test timeout + 拆分 unit test vs integration test |

### Wave 4: 钉子 #38 + W4 Gate 准备 (PM 自主, 必跑)

**目的**: Sprint close PM SOP 加 dist bundle ↔ src grep 校验 (暴露 S1.4 Welcome 文案漂移 gap), 4 文档 close, retrospective 草案 ready

**交付**:
- 钉子 #38 SOP 文档化到 memory (mavis memory append mavis, topic: `mavis-runtime-discipline.md`)
- Sprint 1.5 delivery.md close (含 T-1.5.1/T-1.5.2 PASS 摘要 + W4 Gate retrospective link)
- Sprint 1.5 archive 目录准备 (含 4 文档 + board.md + outputs/)
- W4 Gate retrospective 草案 (PM 起草, NJX 复盘会前 1h 准备)
- Phase 2 kickoff 选项 (Sprint 2.0 / 2.1 / 2.2 候选, per OPC 12 周路线图)

**SOP 模板** (钉子 #38 dist bundle grep):
```bash
# Sprint close PM 必跑:
cd apps/copilot-desktop
echo "=== src 关键字符串 ===" 
grep -rn "Sprint" src/ --include="*.tsx" --include="*.ts" | head -20
echo "=== dist bundle grep ===" 
grep -l "Sprint" dist/renderer/assets/*.js
echo "=== 一致性验证 ===" 
# 期望: dist bundle 至少含 1 个 src 出现的 Sprint 字符串
```

**验收方式**:
- 钉子 #38 写入 memory 成功 (`mavis memory show mavis` 验证)
- Sprint 1.5 delivery.md close
- W4 Gate retrospective 草案 6/6 章节 ready
- Phase 2 kickoff 选项 ≥ 2 (per OPC 12 周 W5-W8 路线图)

**风险与回退**:
| 风险 | 回退 |
|------|------|
| 钉子 #38 误伤正常文本 | 加白名单 (e.g. comment 中 Sprint 字串不算漂移) |
| 复盘会 NJX 改方向 | PM 接受, 不在 S1.5 范围内反向重做 |
| 4 文档任一缺 | 立即补, 不留 close gate |

---

## 4. 钉子 #30 + #37 教训应用 (PM dispatch 必 explicit)

T-1.5.1 / T-1.5.2 dispatch prompt 涉及:
- `electron-builder --win --x64 --config electron-builder.yml` (Wave 1+2)
- `electron-builder --win --arm64 --config electron-builder.yml` (Wave 1+2)
- `openssl req -x509 ...` (Wave 1 cert gen)
- `openssl pkcs12 -export ...` (Wave 1 pfx gen)
- `signtool verify /v ...` (Wave 1 verify, 仅 Win)

**dispatch 红线** (S1.4 rules.md §1 钉子 #30 继承):
- ✅ 命令必带 `--config electron-builder.yml`
- ✅ 必须显式 `cd apps/copilot-desktop/` 后跑
- ✅ timeout ≥ 25min (cold cache 95MB Electron, S1.4 钉子 #37 wine-4.0.1-mac 经验)
- ✅ macOS host 自动 wine auto-provision, 不要 docker pull (钉子 #37)
- ✅ signtool 在 macOS 不可用, 改用 byte-level grep + osslsigncode verify

---

## 5. 4 文档 checklist (project-pm SOP)

| 文档 | Sprint 1.5 状态 |
|------|-----------------|
| `sprint1.5/goal.md` | ✅ 本文档 §1-7 (已起草) |
| `sprint1.5/plan.md` | ✅ 本文档 |
| `sprint1.5/rules.md` | ⚠️ 待 PM 写 — S1.4 rules 继承 + 钉子 #38 PM SOP 增补 |
| `sprint1.5/delivery.md` | 待 3 wave 完成时起草 |

---

## 6. 风险与回退 (汇总)

| 风险 | 影响 | 回退方案 |
|------|------|----------|
| T-1.5.1 dev cert wire 失败 | Wave 1 fail | 退回 `certificateFile: null`, 推 S1.6 真实 prod cert 时再试 |
| T-1.5.2 NJX 没 logo 资源 | Wave 2 fail | 走 PM 临时方案 🅱, 留 TODO NJX 后续替换 |
| NJX 没 Win 真机 | Wave 1/2 真机验 失败 | PM 借外部 Win 真机 or 推 S1.6 |
| 钉子 #38 误伤 | Wave 3 SOP 有 false positive | 加白名单 (e.g. comment 中 Sprint 字串) |
| W4 Gate 复盘会 NJX 战略转向 | S1.5 close 推迟 | PM 接受, 不反向重做 |

---

## 7. Sprint 1.5 时间表

| 日期 | Wave | 备注 |
|------|------|------|
| 7/10 19:35 | Sprint kick-off | NJX 拍板 S1.4 partial close + S1.5 prep |
| 7/10 20:00 | Wave 1 启动 | T-1.5.1 dev signing wire (PM dispatch 立即) |
| 7/11 (周末) | Wave 1 验收 | NJX Win 真机看 SmartScreen warn + signtool verify (如 NJX 有空) |
| 7/14 (周一) | Wave 2 启动 | T-1.5.2 branded icon (如 NJX 拍纳入) |
| 7/15 (周二) | Wave 2 验收 | NJX Win 真机看 NSIS icon (如 Wave 2 跑) |
| 7/16-7/17 | Wave 3 | 钉子 #38 SOP + 4 文档 + retrospective 草案 |
| 7/18 周六 | 复盘会前缓冲 | PM 准备 1h retrospective 终稿 |
| **7/19 W4 Gate 复盘会** | **Sprint 1.5 CLOSE** | 1h retrospective + Phase 2 kickoff 拍板 |

---

**Next step**: 写 `sprint1.5/rules.md` (S1.4 继承 + 钉子 #38 增补) → 弹窗 NJX 拍板 S1.5 范围 (T-1.5.1 必跑 + T-1.5.2 候选 + 钉子 #38 PM 自主) → 拍板后立即 dispatch Wave 1 (T-1.5.1 dev signing wire)

**PM 状态**: Sprint 1.4 partial close 闭环 + Sprint 1.5 plan ready (等 NJX 范围拍板)
