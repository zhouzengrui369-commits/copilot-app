# T-1.5.2 Task Contract · Sprint 1.5 Wave 2 Branded Icon Verify

> **Status**: 🟡 in_progress (worker α-Wave-2 2026-07-10 20:16 CST 启动)
> **Worker**: Coder mvs_69c287fb25c8430b9bd64e4e5d058311
> **PM**: Mavis mvs_144239070a21476dae746d1cff6af16b
> **Branch**: sp1.5-T-1.5.2 (worktree: /Users/njx/openclaw/copilot.wt-T152/wt-T152)
> **Base**: main @ a1281f90 (含 T-1.5.1 commit f0df9380 + board update d7ed6f93)
> **Hard cap**: 15min (T+12min 硬 wrap-up checkpoint)

---

## 1. 背景 (NJX 20:13 拍板 scope 收窄)

T-1.5.1 worker 已 build 4 signed artifact (x64-setup + x64-portable + arm64-setup + arm64-portable),
用的是 T-1.3.2 placeholder icon (`apps/copilot-desktop/build/icon.ico`)。

NJX 20:13 拍板 "用现在 njx-copilot app 的 logo" — **T-1.5.2 不替换 icon, 只验证 + 收口**。

**替代原 "branded icon 替换" task** — 本 task 简化为:
- ✅ 验证 4 signed artifact 都带 T-1.3.2 placeholder icon (byte-level grep icon header)
- ✅ 验证 4 signed artifact 都 verified signature (osslsigncode)
- ✅ 验证 `build/icon.ico` 保持 T-1.3.2 commit, 未被覆盖
- ✅ 跑钉子 #38 dist bundle grep (S1.5 close path SOP)
- ❌ 不替换 icon (T-1.3.2 placeholder 保留)
- ❌ 不重 build (4 artifact 已在 T-1.5.1 留在 release/)
- ❌ 不动 gen-icon.mjs (T-1.3.2 design decision 保持)

---

## 2. 工作位置

- **worktree**: `/Users/njx/openclaw/copilot.wt-T152/wt-T152`
- **branch**: `sp1.5-T-1.5.2` (from main @ a1281f90)
- **写**:
  - `sprint1.5/outputs/T-1.5.2/TASK.md` (本文档)
  - `sprint1.5/outputs/T-1.5.2/deliverable.md` (VERDICT + 5 验收信号)
  - `sprint1.5/outputs/T-1.5.2/SELF-VERIFY-T-1.5.2.md` (5-min audit 结果)
  - `sprint1.5/board.md` (append Wave 2 entry)
  - `sprint1.5/delivery.md` (S1.5 close path 草稿, 7/18 finalize)
- **不写**:
  - `apps/copilot-desktop/build/icon.ico` (保留 T-1.3.2 placeholder)
  - `apps/copilot-desktop/scripts/gen-icon.mjs` (T-1.3.2 design decision 保持)
  - `apps/copilot-desktop/src/` · `packages/kb/` · `packages/rag/`
- **不重 build**: 4 artifact 已在 T-1.5.1 留在 `apps/copilot-desktop/release/`,
  T-1.5.2 只 verify 不 rebuild (节省 5-10min)
- **release/ 软链**: worktree 不含 release/ (gitignore), 软链自 main checkout
  `ln -s /Users/njx/openclaw/copilot/apps/copilot-desktop/release <wt>/apps/copilot-desktop/release`

---

## 3. 4 Phase 核心动作 (≤15min hard cap)

### Phase A (T+0-2min): 4 artifact 存在 + size sanity check

```bash
cd /Users/njx/openclaw/copilot.wt-T152/wt-T152
ls -la apps/copilot-desktop/release/njx-copilot-v6-0.1.0-{x64,arm64}-{setup,portable}.exe
# 期望 4 个 file 全部存在, size 在 70-90MB 范围
```

### Phase B (T+2-7min): icon.ico byte-level grep 4 artifact

```bash
# icon.ico 标识: ICONDIR magic bytes 00 00 01 00 (4 bytes)
# 4 artifact 全部 hexdump 命中 icon header
for f in apps/copilot-desktop/release/njx-copilot-v6-0.1.0-{x64,arm64}-{setup,portable}.exe; do
  hexdump -C "$f" | grep -c "00 00 01 00" || echo "$f: no icon magic"
done
# 期望 4/4 file 各命中 ≥ 1 (icon header 嵌入, 也可能命中 PE section headers)
```

### Phase C (T+7-12min): osslsigncode verify 4/4 artifact

```bash
for f in apps/copilot-desktop/release/njx-copilot-v6-0.1.0-{x64,arm64}-{setup,portable}.exe; do
  echo "=== $f ==="
  osslsigncode verify "$f" 2>&1 | grep -E "Number of verified|Signer"
done
# 期望 4/4 全部 "Number of verified signatures: 1" + signer = CN=NJX Dev Signing (Self-Signed)
```

### Phase D (T+12-15min): 5-min audit + commit + 3件齐 + board + delivery.md

```bash
# 1. 钉子 #23 5-min audit
ls -la sprint1.5/outputs/T-1.5.2/
grep "VERDICT" sprint1.5/outputs/T-1.5.2/deliverable.md
wc -l sprint1.5/outputs/T-1.5.2/deliverable.md sprint1.5/outputs/T-1.5.2/SELF-VERIFY-T-1.5.2.md
git status --short sprint1.5/outputs/T-1.5.2/
git log --oneline -1 -- sprint1.5/outputs/T-1.5.2/

# 2. git add + commit
cd /Users/njx/openclaw/copilot.wt-T152/wt-T152
git add sprint1.5/outputs/T-1.5.2/ sprint1.5/board.md sprint1.5/delivery.md
git commit -m "docs(sprint1.5): T-1.5.2 branded icon verify — 4 artifact re-verify PASS + 钉子 #38 + S1.5 close path 草稿"

# 3. board entry append (NOT in commit, after commit use absolute path)
```

---

## 4. 验收信号 (5 件, 必全 PASS 才 VERDICT=PASS)

| # | 信号 | 期望 | 验证方法 |
|---|------|------|---------|
| 1 | 4 artifact 存在 + size sanity | 4 file 70-90MB 范围 | `ls -la` 输出 |
| 2 | icon.ico 嵌入 4/4 | 4/4 file hexdump 命中 icon header | `hexdump -C \| grep -c "00 00 01 00"` |
| 3 | osslsigncode 4/4 verified | 4/4 "verified sigs: 1" + CN=NJX Dev Signing (Self-Signed) | `osslsigncode verify` |
| 4 | build/icon.ico 保持 T-1.3.2 placeholder | `git log --oneline -1 -- apps/copilot-desktop/build/icon.ico` = `351e99d7` (T-1.3.2 commit) | git log |
| 5 | commit + 3件齐 + board entry + delivery.md 草稿 | 钉子 #14 + 钉子 #38 | ls/grep/wc/git |

---

## 5. 决策红线 (不可破)

- ❌ 不替换 icon.ico (T-1.3.2 placeholder 保留, NJX 20:13 拍板)
- ❌ 不重 build artifact (T-1.5.1 已 build, 节省时间, 不重新消耗 wine/electron-builder)
- ❌ 不动 gen-icon.mjs (T-1.3.2 design decision 保持)
- ❌ 不引入新 logo (NJX 20:13 拍板不等)
- ❌ 不引入 prod cert (S1.4 rules.md §3.1 红线)
- ❌ 不超时 (>15min 立即 PARTIAL commit + exit)
- ❌ 不假报 VERDICT (任何 artifact verify 失败 → VERDICT=FAIL)
- ❌ 不省略 5-min audit (钉子 #23)
- ❌ 不省略 钉子 #38 dist bundle grep

---

## 6. T+12min 硬 wrap-up checkpoint

不管是否完成, 立即:
1. `git add ... && git commit` (PARTIAL 时 commit message 注明 X/5 验收信号)
2. 写 deliverable.md "VERDICT: PARTIAL (X/5 验收信号)" + 列剩余 → exit
3. 不强行 PASS

---

## 7. Done 硬条件 (钉子 #14)

1. `git add ... && git commit` (在 sp1.5-T-1.5.2 branch)
2. `sprint1.5/outputs/T-1.5.2/deliverable.md` (含 VERDICT + 5 验收信号 + caveat + 钉子 #38 grep)
3. `sprint1.5/outputs/T-1.5.2/SELF-VERIFY-T-1.5.2.md` (5-min cross-doc audit 结果)
4. `sprint1.5/board.md` 追加 entry (worktree 路径 + branch + commit hash)
5. `sprint1.5/delivery.md` 草稿 (S1.5 close 路径, 7/18 复盘会前 finalize)

完成: commit + 写 SELF-VERIFY-T-1.5.2.md + delivery.md 草稿 → exit。
NJX 验收弹窗由 PM (Mavis) 触发。
