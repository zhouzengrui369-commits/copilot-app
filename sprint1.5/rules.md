# Sprint 1.5 Rules · Win Dev Signing Wire + Branded Icon + PM SOP 固化

> **Sprint**: 1.5 — T-1.5.1 dev cert wire (deferred from S1.4 Wave 4) + T-1.5.2 branded icon (候选) + 钉子 #38 PM SOP (PM 自主)
> **继承**: Sprint 1.4 rules + project-pm 全局 discipline

---

## 1. 钉子 (pitfalls) 红线 — 必读不可破

### 钉子 #14 · 3件齐 (worktree path literal verify)

每个 task 必交:
- ✅ commit code (在 worktree branch)
- ✅ `outputs/T-1.5.{1,2}/deliverable.md` (worktree 路径, 不是 plan mirror)
- ✅ `outputs/T-1.5.{1,2}/SELF-VERIFY-T-1.5.{1,2}.md`
- ✅ `sprint1.5/board.md` 追加 entry (worktree path)

### 钉子 #23 · PM/worker self-audit 5-min pre-declare PASS

worker self-declare PASS 前必跑:
1. `ls -la outputs/T-1.5.{1,2}/` 确认 4 文件齐
2. `grep "VERDICT" outputs/T-1.5.{1,2}/deliverable.md` 确认 VERDICT 行存在
3. `wc -l outputs/T-1.5.{1,2}/deliverable.md outputs/T-1.5.{1,2}/SELF-VERIFY-T-1.5.{1,2}.md` 确认 size > 1KB
4. `git status --short outputs/T-1.5.{1,2}/` 确认 tracked
5. `git log --oneline -1 -- outputs/T-1.5.{1,2}/` 确认 commit hash 存在

PM hand-audit 必跑 literal verify before NJX acceptance.

### 钉子 #29 · Sprint close cron hygiene

Sprint close commit 必:
- Disable sprint-specific cycle-close cron (避免 stale prompt + post-close fires)
- Silent tick log 写到 scratchpad
- 不 bake 静态 main SHA 在 cron prompt

### 钉子 #30 · Dispatch jest / build 命令必带 explicit flags

PM dispatch 所有命令必带显式 flag, 不省略:
- `electron-builder --win --x64 --config electron-builder.yml` (Wave 1+2)
- `electron-builder --win --arm64 --config electron-builder.yml` (Wave 1+2)
- 必显式 `cd apps/copilot-desktop` 后跑
- timeout ≥ 25min (cold cache 95MB Electron)
- Wave 1 runner setup 必带 `actions/cache@v4` step pre-warm Electron

### 钉子 #37 · electron-builder Wine auto-provision (S1.4 验证)

electron-builder Win target 在 macOS host **默认 auto-provision Wine** (electron-userland/electron-builder-binaries):
- 不要先 `brew install wine` / `docker pull electronuserland/builder:wine`
- bash timeout ≥ 25min 用于 cold-cache electron-builder build
- Wave 1 跑 `electron-builder --win --x64 --dir` 30s 看 auto-provision 列表 (electron + winCodeSign + wine-4.0.1-mac)
- 如果 3 行 downloading 全 PASS, infra OK, 直接上 `--win --config` 全模式

### 钉子 #38 · Sprint close dist bundle ↔ src grep 校验 **(S1.5 新增, PM SOP)**

**触发场景**: Sprint close / 部分 close / artifact rebuild 后 / 任何 src 文案改后
**问题**: S1.4 Wave 5 暴露 Welcome 屏文案漂移 (Sprint 1.1 skeleton 文案没同步到 Sprint 1.4 release), NJX 截图发现才修复, 应由 PM 主动抓

**SOP 模板** (PM Sprint close 必跑):
```bash
cd /Users/njx/openclaw/copilot
echo "=== src 关键字符串 ===" 
grep -rn "Sprint\|version\|njx-copilot" apps/copilot-desktop/src/ --include="*.tsx" --include="*.ts" | head -20
echo "=== dist bundle grep ===" 
cd apps/copilot-desktop
grep -l "Sprint\|version\|njx-copilot" dist/renderer/assets/*.js
echo "=== 漂移检测 (期望: 至少 1 个 src 字符串出现在 dist) ===" 
# 反向校验: 任何 src 关键字符串必须在 dist bundle 出现至少 1 次
# 否则 = 漂移, 必修复 + rebuild
```

**红线**:
- ❌ 任何 src "Sprint X.Y" 关键字符串必须在 dist bundle 找到 (artifact rebuild 必须带最新文案)
- ❌ 任何 src "njx-copilot-v{N}" 版本号必须在 dist bundle 找到
- ❌ 任何 src "version: X.Y.Z" 必须在 dist bundle 找到
- ✅ PM Sprint close 必跑这个 grep, 不跑 = 视为 critical gap, 打回重做

**固化时机**: W4 Gate 复盘会 7/19 NJX 拍板是否正式固化为钉子 #38 (PM 推荐固化)

### 钉子 #39 · electron-builder `certificatePassword: null` (env var not literal) **(S1.5 新增)**

**触发场景**: 任何 `electron-builder.yml` 配 Win signing (`certificateFile` + `certificatePassword`)
**问题**: yml 里写 `certificatePassword: ${CSC_KEY_PASSWORD}` 字面 = 必 fail, electron-builder 25.x 不在 yml 展开 env var, 字面会作为 password 字符串传入
**正确写法**:
```yaml
win:
  certificateFile: build/dev-cert.pfx
  certificatePassword: null  # null → builder 走 process.env.CSC_KEY_PASSWORD
  signingHashAlgorithms: [sha256]
```
+ 运行时 `export CSC_KEY_PASSWORD=xxx` 传真实 password

**红线**:
- ❌ yml 里 `certificatePassword: ${ENV_VAR}` 字面 = 必 fail
- ❌ yml 里写明文 password (S1.4 §3.3 红线)
- ❌ 改 main worktree 的 .env / .pfx (gitignored 但污染)
- ✅ `null` + env var
- ✅ `signingHashAlgorithms: [sha256]` (钉子 #30 + S1.4 继承)

**固化时机**: W4 Gate 复盘会 7/19 NJX 拍板是否正式固化 (PM 推荐固化, T-1.5.1 20:05 实测)

---

## 2. Win Dev Signing Wire 红线 (Wave 1 - T-1.5.1)

### 2.1 cert 类型 — 必 self-signed (S1.4 rules.md §3.1 继承)

```bash
# 1. gen key + crt (self-signed, 365 days)
openssl req -x509 -newkey rsa:2048 -keyout build/dev-cert.key -out build/dev-cert.crt -days 365 -nodes \
  -subj "/C=CN/ST=GD/L=SZ/O=NJX-DEV/OU=Copilot/CN=NJX Dev Signing (Self-Signed)"

# 2. gen pfx (PKCS12, 走 CSC_KEY_PASSWORD env)
openssl pkcs12 -export -out build/dev-cert.pfx -inkey build/dev-cert.key -in build/dev-cert.crt \
  -password pass:${CSC_KEY_PASSWORD:-changeme-dev-only}
```

### 2.2 gitignore 加固 (S1.4 rules.md §3.2 继承)

```gitignore
# dev cert (never commit)
build/dev-cert.pfx
build/dev-cert.key
build/dev-cert.crt
*.pfx
*.key
```

### 2.3 electron-builder.yml 改 (S1.4 rules.md §3 红线)

```yaml
win:
  certificateFile: build/dev-cert.pfx  # gitignored
  certificatePassword: null  # ⚠️ 钉子 #39: 不要用 ${CSC_KEY_PASSWORD} 字面, electron-builder 不展开 env var, 字面会作为 password 传入 (必失败). 改用 null 让 builder 走 process.env.CSC_KEY_PASSWORD 路径
  signingHashAlgorithms:
    - sha256
  # ... 其他 win config 不动
```

**钉子 #39 (S1.5 新增)** — `electron-builder certificatePassword` 必 `null`, 不要 `${CSC_KEY_PASSWORD}` 字面
- 根因: electron-builder 25.x 不在 yml 里展开 env var, 字面 `${CSC_KEY_PASSWORD}` 会被当成 password 字符串传入
- 红线: yml 里 certificatePassword 写 `${...}` 字面 = 必 fail
- 正确: `null` + 在 process.env.CSC_KEY_PASSWORD 设置真实 password
- 来源: T-1.5.1 worker 20:05 触发 → 钉子 #39 候选, PM 20:14 固化

### 2.4 env 占位 (S1.4 rules.md §3.3 继承)

```bash
# .env.example (tracked)
CSC_KEY_PASSWORD=changeme-dev-only

# .env (gitignored, real value)
CSC_KEY_PASSWORD=actual-dev-password
```

### 2.5 验证方式 (S1.4 rules.md §3.4 + S1.5 signtool 适配)

**macOS host 无 signtool**, 跨平台验证用:

```bash
# 1. byte-level grep (最稳, 跨平台)
hexdump -C build/dev-cert-signed.exe | grep -c "Win32.*signature"
# 期望: ≥ 1 (PE 头 + signature block)

# 2. 跨平台 sign verify (osslsigncode)
brew install osslsigncode  # 一次性 setup
osslsigncode verify build/dev-cert-signed.exe
# 期望: "Signature verification: ok" 或 "Calculated hash: ..."

# 3. NJX Win 真机 (如可用) signtool verify
signtool verify /v njx-copilot-v6-0.1.0-x64-setup.exe
# 期望: "File has signing certificate: Yes"
```

### 2.6 红线 (S1.4 rules.md §3.1 + S1.5 增量)

- ❌ 不引入任何 prod cert material (没有真实 .pfx, 没有真实 CSC_KEY_PASSWORD)
- ❌ 不在 .env.example 写真实 password (仅占位)
- ❌ 不在 commit message / doc 写真实 password
- ❌ 不试图消除 Win SmartScreen "Unknown Publisher" 警告 (prod cert 才消除, S1.6+)
- ✅ 仅 wire 验证: 验证 electron-builder 接 .pfx + env var 能 sign 成功
- ✅ SmartScreen 警告是预期, 不算 fail

---

## 3. Branded Icon 红线 (Wave 2 - T-1.5.2, 候选)

### 3.1 icon 输入 (NJX 拍板)

- 🅰 用 NJX 现成 logo (用户提供)
- 🅱 用文字 logo "njx-copilot" + 简笔 icon (PM 临时方案)
- 🅲 不做 (推 S1.6)

### 3.2 icon 文件格式

- `build/icon.ico` (Windows multi-size: 16, 32, 48, 64, 128, 256)
- `build/icon.png` (1024x1024 master)
- ico 转换命令: `sips -s format icns ...` 不适用, 用 `imagemagick convert` 或 `png2ico`

### 3.3 红线

- ❌ 不擅自 design logo (需 NJX 提供或批准 🅰/🅱)
- ❌ 不破坏 T-1.3.2 electron-builder.yml mac section
- ❌ 不引入新 native dep 到 gen-icon.mjs
- ❌ 不替换 gen-icon.mjs (T-1.3.2 design decision 保持)
- ✅ NSIS 显示新 icon (NJX 物理验)
- ✅ macOS dmg section icon 不受影响

---

## 4. Wave 3 PM SOP 固化红线 (钉子 #38)

### 4.1 触发场景 (S1.5 起执行)

- Sprint close / partial close 前
- 任何 artifact rebuild 后 (electron-builder / vite build)
- 任何 src 文案 / feature flag / version 字符串改后
- 任何 package.json version bump 后

### 4.2 SOP 命令模板 (S1.5 rules.md §1 钉子 #38 完整版)

```bash
# A. src 关键字符串 snapshot
cd /Users/njx/openclaw/copilot
grep -rn "Sprint\|njx-copilot-v\|version" apps/copilot-desktop/src/ \
  --include="*.tsx" --include="*.ts" | head -30 > /tmp/sprint15_src_strings.txt

# B. dist bundle grep (必 rebuild 后)
cd apps/copilot-desktop
grep -l "Sprint\|njx-copilot-v\|version" dist/renderer/assets/*.js \
  > /tmp/sprint15_dist_hits.txt

# C. 一致性验证 (期望: dist_hits 至少 1 个)
if [ ! -s /tmp/sprint15_dist_hits.txt ]; then
  echo "FAIL: dist bundle 缺关键字符串, 必 rebuild"
  exit 1
fi

# D. 反向校验: src 中所有版本号必须在 dist 出现
for v in $(grep -oE "njx-copilot-v[0-9]+" /tmp/sprint15_src_strings.txt | sort -u); do
  if ! grep -q "$v" dist/renderer/assets/*.js; then
    echo "FAIL: dist bundle 缺版本号 $v, 必 rebuild"
    exit 1
  fi
done
```

### 4.3 红线

- ❌ Sprint close 不跑这个 grep = critical gap, 打回重做
- ❌ grep 失败不修 = artifact 必带 stale 文案 / 旧 version
- ✅ 跑完 grep 把结果截图存档 `screenshots/SOP-钉子-38-{date}.txt`

---

## 5. Sprint 1.5 Specific Rules

### 5.1 不动 S1.4 已 merge 的内容

- electron-builder.yml win/nsis/portable section 仅在 wire cert 时小幅调整 (T-1.5.1)
- icon.ico 仅在 T-1.5.2 替换 (如纳入)
- gen-icon.mjs 不动 (T-1.3.2 design decision 保持)
- macOS section 完全不动

### 5.2 Mac 不变

- electron-builder.yml mac/dmg section 不动 (S1.2 PASS 状态保持)
- 不在 Win runner 上跑 Mac build (Mac-only feature flag)

### 5.3 vitest 补齐红线 (T-1.5.3, NJX 19:44 拍板 with-tests)

- ❌ 不为凑数写 trivially-true test (e.g. `expect(1).toBe(1)`)
- ❌ 不 mock 整个 module (Sprint 1.3 v3 教训: mock 重于实跑反而漏 bug)
- ❌ 不动 5 package 各自 vitest config (保持 baseline)
- ❌ 不为求行数覆盖写 dead-code path test
- ✅ 每个 test 必真跑 + 必 fail-then-pass 验证 (改源码 → test fail → 改回 → test pass)
- ✅ 优先 coverage gap: error path + edge case + integration (Sprint 1.3 v3 close 留底)
- ✅ 5 package 并行跑 `pnpm -w test`, 0 fail 才算 done
- ✅ coverage 不下降 (Sprint 1.3 baseline 锁定)

### 5.4 4 文档 + board + deviation

- `sprint1.5/board.md` 每个 wave 完成后追加 entry
- 任何 deviation 文档化到 `sprint1.5/deviation-pattern-T-15{X}.md`
- Sprint 1.5 close 时 `archive/sprint1.5-2026-XX-XX-XX-XX/` 归档

### 5.5 Cron hygiene (S1.5 close 时)

- Disable `sprint15-monitor-30min` cron (S1.5 close 后 TTL)
- 保留 `knowme-heartbeat` (项目全程)
- 不 bake 静态 main SHA 在 cron prompt (钉子 #29)

---

## 6. Communication 红线 (S1.4 rules.md §6 继承)

- ❌ 不要向 NJX 发 1h 长 status update (NJX 注意力稀缺, 钉子 #24 PM 反思循环)
- ❌ 不要在 Sprint 1.5 内复述 worker 自报数字 (钉子 #27 必自跑 grep -c)
- ✅ 异常才报 NJX (钉子 #22 cron gate-discipline 同样原则)
- ✅ 每个 wave NJX 验收 ≤ 4 个弹窗 (project-pm SOP)
- ✅ Sprint 1.5 close → W4 Gate 复盘会 1h popup
- ✅ 钉子 #38 PM SOP 自动跑, 不打扰 NJX

---

## 7. W4 Gate 复盘会准备 (7/19)

**PM 7/18 准备**:
- Sprint 1.5 retrospective 草案 (6 章节: what went well / what didn't / lessons / sprint metrics / next sprint plan / 钉子固化提案)
- Phase 2 kickoff 选项 (per OPC 12 周 W5-W8 路线图):
  - 🅰 1-2 个航材场景 + 接入真实数据流 (Sprint 2.0/2.1)
  - 🅱 数字孪生雏形 + 知识库集成 (Sprint 2.0/2.1/2.2)
  - 🅲 暂缓 Phase 2, 继续产品化打磨 (Sprint 1.6/1.7)
- Sprint 1.5 archive 目录 close

**NJX 7/19 1h 复盘会拍板**:
- Sprint 1.5 验收签字
- 钉子 #38 是否正式固化
- Phase 2 kickoff 选项 🅰/🅱/🅲

---

**Rules.md close**: 2026-07-10 19:35 CST (PM Mavis)
**Next**: 弹窗 NJX 拍板 S1.5 范围 (T-1.5.1 必跑 + T-1.5.2 候选 + 钉子 #38 PM 自主) → 拍板后立即 dispatch Wave 1 (T-1.5.1 dev signing wire)
