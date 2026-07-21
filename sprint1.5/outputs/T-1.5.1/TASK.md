# T-1.5.1 TASK · Win Dev Signing Wire (Sprint 1.5 Wave 1, deferred from S1.4 Wave 4)

> **Task ID**: T-1.5.1
> **Sprint**: 1.5 — Win Dev Signing Wire + Branded Icon + vitest 补齐 + PM SOP 固化
> **Wave**: 1 (NJX 19:44 拍板 "立即开 sub-plan")
> **Worker**: TBD (sub-plan dispatch 由 PM 调度)
> **PM**: Mavis (mvs_144239070a21476dae746d1cff6af16b)
> **依赖**: Sprint 1.4 partial close (commit `32950d8c`)
> **Hard cap**: 30min (PM dispatch + verifier cross-check)

---

## 1. Goal (single target)

**T-1.5.1 PASS 定义**:
> 在 macOS host 上 generate self-signed dev cert (openssl), 改 `electron-builder.yml` 接 `.pfx` + `CSC_KEY_PASSWORD` env, 跑 1 次 `electron-builder --win --x64` 输出 1 个 signed artifact (x64-setup.exe), 用 byte-level grep + osslsigncode verify 跨平台验证 signature block 存在, 不引入 prod cert material。

**量化验收**:
- `build/dev-cert.pfx` + `.key` + `.crt` 存在 (openssl gen, self-signed, 365 days, RSA 2048)
- `electron-builder.yml` 含 `certificateFile: build/dev-cert.pfx` + `certificatePassword: ${CSC_KEY_PASSWORD}`
- `.env.example` 含 `CSC_KEY_PASSWORD=changeme-dev-only` 占位
- `.gitignore` 加固 `build/dev-cert.pfx` + `build/dev-cert.key` + `build/dev-cert.crt` + `*.pfx` + `*.key`
- 1 次 electron-builder 跑出 1 个 signed x64-setup.exe (warm cache, ≤ 10min)
- `hexdump -C build/dev-cert-signed.exe | grep -c "Win32.*signature"` ≥ 1
- `osslsigncode verify build/dev-cert-signed.exe` exit 0 (或 "Calculated hash" 提示)
- Win SmartScreen "Unknown Publisher" 警告是预期, 不算 fail

---

## 2. Out-of-Scope (红线 — 必读不可破)

- ❌ 不引入任何 prod cert material (没有真实 .pfx, 没有真实 CSC_KEY_PASSWORD)
- ❌ 不 commit `build/dev-cert.pfx / .key / .crt` 到 git (gitignore 加固)
- ❌ 不 commit 真实 `CSC_KEY_PASSWORD` 到任何 tracked 文件 (env-only)
- ❌ 不试图消除 Win SmartScreen "Unknown Publisher" 警告 (prod cert 才消除, S1.6+)
- ❌ 不 rebuild 全部 4 artifact (本 task 只跑 1 个 x64-setup.exe 验证 wire, 4 artifact 全 rebuild 留给 T-1.5.2 一起)
- ❌ 不动 T-1.3.2 electron-builder.yml mac/dmg section
- ❌ 不替换 T-1.3.2 placeholder icon (留给 T-1.5.2)
- ❌ 不在 Win runner 上跑 Mac build (macOS host 跑 Win target 即可, 钉子 #37 wine auto-provision)
- ❌ 不动 `gen-icon.mjs` (T-1.3.2 design decision 保持)

---

## 3. 工作位置 (Sprint 1.5 worker)

- worktree: `git worktree add ../copilot.wt-T151/wt-T151 -b sp1.5-T-1.5.1 main`
  - 注意: Sprint 1.5 wt 命名 `wt-T151` (T-1.5.1 简写, 避免跟 Sprint 1.4 `wt-T141*` 撞)
- 分支: `sp1.5-T-1.5.1` from main (HEAD = `32950d8c`)
- 写: `build/dev-cert.*` + `electron-builder.yml` (小幅) + `.env.example` + `.gitignore` + `outputs/T-1.5.1/` + `SELF-VERIFY-T-1.5.1.md` + `sprint1.5/board.md` (append)
- 不写: `src/` 业务代码 · `packages/kb/` · `packages/rag/` · `apps/copilot-desktop/src/` (除 electron-builder.yml)

---

## 4. 核心动作 (≤30min hard cap)

### Phase A: openssl self-signed cert gen (T+0-3min)
```bash
# 1. cd worktree
cd /Users/njx/openclaw/copilot.wt-T151/wt-T151
git checkout -b sp1.5-T-1.5.1  # 如果 worktree add 没自动 checkout
mkdir -p build

# 2. openssl gen key + crt (self-signed, 365 days, RSA 2048)
openssl req -x509 -newkey rsa:2048 -keyout build/dev-cert.key -out build/dev-cert.crt -days 365 -nodes \
  -subj "/C=CN/ST=GD/L=SZ/O=NJX-DEV/OU=Copilot/CN=NJX Dev Signing (Self-Signed)"

# 3. openssl gen pfx (PKCS12, 走 CSC_KEY_PASSWORD env)
export CSC_KEY_PASSWORD="changeme-dev-only"
openssl pkcs12 -export -out build/dev-cert.pfx -inkey build/dev-cert.key -in build/dev-cert.crt \
  -password pass:${CSC_KEY_PASSWORD}

# 4. verify pfx
openssl pkcs12 -info -in build/dev-cert.pfx -password pass:${CSC_KEY_PASSWORD} -nokeys | head -20
# 期望: 看到 "subject=/C=CN/ST=GD/.../CN=NJX Dev Signing (Self-Signed)"
```

### Phase B: electron-builder.yml wire (T+3-7min)
```bash
# 5. 读当前 electron-builder.yml
cat apps/copilot-desktop/electron-builder.yml
# 找到 win: section (或 win: certificateFile)

# 6. 加 certificateFile + certificatePassword (PM 推荐: 用 Edit 工具, 精准定位)
# 改动 1: win: section 加 certificateFile + certificatePassword
# 改动 2: 保持 win.target NSIS + portable 配置不变

# 7. .env.example 加 CSC_KEY_PASSWORD 占位
echo "CSC_KEY_PASSWORD=changeme-dev-only" >> apps/copilot-desktop/.env.example

# 8. .gitignore 加固 (确保 .pfx .key .crt 不被 commit)
cat >> apps/copilot-desktop/.gitignore <<'EOF'

# Dev cert (never commit) - T-1.5.1
build/dev-cert.pfx
build/dev-cert.key
build/dev-cert.crt
*.pfx
*.key
EOF

# 9. 验证 git 不再 track dev-cert.*
cd apps/copilot-desktop
git check-ignore -v build/dev-cert.pfx build/dev-cert.key build/dev-cert.crt
# 期望: 每个 file 都输出 "build/dev-cert.pfx .gitignore:XX:..." 类似 (即被 ignore)
```

### Phase C: electron-builder 跑 1 个 signed x64-setup.exe (T+7-17min)
```bash
# 10. cd apps/copilot-desktop
cd apps/copilot-desktop
export CSC_KEY_PASSWORD="changeme-dev-only"

# 11. 跑 electron-builder (warm cache, S1.4 4 次 rebuild 已 pre-warm)
# 钉子 #30: 必带 --config + --win --x64 + timeout ≥ 25min
timeout 1500 npx electron-builder --win --x64 --config electron-builder.yml --publish=never
# 期望: 输出 release/njx-copilot-v6-0.1.0-x64-setup.exe 含 Win32 signature block
```

### Phase D: byte-level + osslsigncode verify (T+17-22min)
```bash
# 12. byte-level grep (跨平台, 最稳)
cd /Users/njx/openclaw/copilot.wt-T151/wt-T151
SIGNED_EXE="apps/copilot-desktop/release/njx-copilot-v6-0.1.0-x64-setup.exe"
ls -la "$SIGNED_EXE"
hexdump -C "$SIGNED_EXE" | grep -c "Win32.*signature"
# 期望: ≥ 1 (PE 头 + signature block 存在)

# 13. osslsigncode verify (跨平台 verify 工具, macOS 装一次)
which osslsigncode || brew install osslsigncode
osslsigncode verify "$SIGNED_EXE"
# 期望: exit 0 + "Signature verification: ok" 或 "Calculated hash: ..."

# 14. openssl verify crt (确认 self-signed 但 valid)
openssl verify -CAfile build/dev-cert.crt build/dev-cert.crt
# 期望: "build/dev-cert.crt: OK"
```

### Phase E: 5-min cross-doc audit + commit + 3件齐 (T+22-30min)
```bash
# 15. 5-min audit (钉子 #23 必跑)
ls -la outputs/T-1.5.1/  # 期望: deliverable.md + SELF-VERIFY-T-1.5.1.md
grep "VERDICT" outputs/T-1.5.1/deliverable.md  # 期望: 命中 1+
wc -l outputs/T-1.5.1/deliverable.md outputs/T-1.5.1/SELF-VERIFY-T-1.5.1.md
git status --short outputs/T-1.5.1/  # 期望: tracked
git log --oneline -1 -- outputs/T-1.5.1/  # 期望: commit hash

# 16. 5-min audit (钉子 #38 dist bundle grep)
echo "=== src grep ==="
grep -rn "Sprint" apps/copilot-desktop/src/ --include="*.tsx" --include="*.ts" | head -5
echo "=== dist bundle grep ==="
grep -l "Sprint 1.4 release" apps/copilot-desktop/dist/renderer/assets/*.js
# 期望: 至少 1 个 dist bundle 含 "Sprint 1.4 release" (S1.4 close 已验证)

# 17. commit (在 worktree 里)
cd /Users/njx/openclaw/copilot.wt-T151/wt-T151
git add apps/copilot-desktop/electron-builder.yml \
        apps/copilot-desktop/.env.example \
        apps/copilot-desktop/.gitignore \
        outputs/T-1.5.1/ \
        SELF-VERIFY-T-1.5.1.md
git commit -m "feat(sprint1.5): T-1.5.1 dev signing wire - self-signed .pfx + electron-builder wire + byte-level verify PASS

- openssl self-signed cert (RSA 2048, 365 days)
- electron-builder.yml: certificateFile + certificatePassword (CSC_KEY_PASSWORD env)
- .env.example: CSC_KEY_PASSWORD=changeme-dev-only placeholder
- .gitignore: build/dev-cert.* + *.pfx + *.key 加固
- 1x electron-builder --win --x64 (warm cache, signed x64-setup.exe)
- byte-level grep: Win32 signature block 命中
- osslsigncode verify: Signature verification: ok
- S1.4 deferred Wave 4 完成"

# 18. board.md append (worktree 路径)
cat >> sprint1.5/board.md <<'BOARD_ENTRY'

---

## Wave 1: T-1.5.1 dev signing wire [DONE 2026-07-XX HH:MM]
- Worker: TBD (mvs_xxx)
- Branch: sp1.5-T-1.5.1 @ <commit hash>
- outputs/T-1.5.1/{deliverable.md, SELF-VERIFY-T-1.5.1.md} written
- Verdict: <PASS / PARTIAL>
- Notes: <any caveat>
BOARD_ENTRY
git add sprint1.5/board.md
git commit -m "docs(sprint1.5): T-1.5.1 board entry"
```

---

## 5. 验收信号 (5 件, 必全 PASS)

1. **build/dev-cert.pfx 存在 + openssl pkcs12 info 成功** (Phase A step 4)
2. **electron-builder.yml 含 certificateFile + certificatePassword** (Phase B step 6)
3. **.gitignore 加固 + git check-ignore 验证 pfx/key/crt 被 ignore** (Phase B step 9)
4. **1 个 x64-setup.exe build 成功 + byte-level grep 命中 signature** (Phase C+D step 11+12)
5. **osslsigncode verify exit 0 + commit + 3件齐 + board entry** (Phase D+E step 13+17+18)

---

## 6. 决策红线 (PM 拍板, worker 不可破)

- ❌ **不引入任何 prod cert material** (S1.4 rules.md §3.1 + S1.5 rules.md §2.1)
- ❌ **不 commit .pfx / .key / 真实 password** (S1.4 rules.md §3.2)
- ❌ **不在 .env.example 写真实 password** (仅 changeme-dev-only 占位)
- ❌ **不试图消除 SmartScreen "Unknown Publisher" 警告** (prod cert 才消除)
- ❌ **不 rebuild 全部 4 artifact** (T-1.5.1 仅 1 个 x64-setup.exe, 4 artifact 留给 T-1.5.2)
- ❌ **不动 macOS section / icon / gen-icon.mjs** (T-1.3.2 design decision 保持)
- ❌ **不超时** (>30min 立即 PARTIAL commit + 列剩余 + exit, 不强行 PASS)
- ❌ **不假报 VERDICT** (任何 cert wire 失败 → VERDICT=FAIL + 列 root cause, 不硬凑 PASS)
- ❌ **不省略 5-min audit** (钉子 #23 必跑)
- ❌ **不省略 钉子 #38 dist bundle grep** (PM 暴露的 SOP gap)

---

## 7. Done 硬条件 (钉子 #14 — 3件齐)

1. `git add ... && git commit` (在 worktree branch `sp1.5-T-1.5.1`)
2. `outputs/T-1.5.1/deliverable.md` (含 VERDICT 行 + 5 验收信号 + 1 张 terminal capture + caveat)
3. `outputs/T-1.5.1/SELF-VERIFY-T-1.5.1.md` (5-min cross-doc audit 结果)
4. `sprint1.5/board.md` 追加 entry (worktree 路径 + branch + commit hash)

完成: commit + 写 SELF-VERIFY-T-1.5.1.md → exit。NJX 验收弹窗由 PM 触发。

---

## 8. 失败模式 (预判, 提前知道怎么办)

| 失败 | 根因 | 应对 |
|------|------|------|
| openssl pfx gen 失败 | openssl 3.x syntax 差异 | macOS 自带 LibreSSL, 试 `openssl pkcs12 -export -legacy` 或 LibreSSL 自带 pksc12 命令 |
| electron-builder 不识别 .pfx | certificateFile 相对路径错 | 必显式 `cd apps/copilot-desktop`, 检查 .pfx path 是 `build/dev-cert.pfx` (相对 apps/copilot-desktop/) |
| osslsigncode verify 失败 | 没装 | `brew install osslsigncode`, 或 fallback 只用 byte-level grep |
| byte-level grep 0 命中 | .pfx 没 wire 上 | 检查 electron-builder.yml certificateFile + CSC_KEY_PASSWORD env 正确 |
| Win SmartScreen warn | 预期 | 不算 fail, NJX 已知, prod cert 才消除 |
| timeout > 30min | cold cache / network | 立即 PARTIAL commit + 列剩余 + exit, 不 retry, PM 后续再起 |

---

## 9. 与 Sprint 1.4 / 1.5 衔接

- **Sprint 1.4 board.md 引用**: T-1.4.1d dev signing wire DEFERRED → S1.5 T-1.5.1 (本 task 完成 = S1.4 board.md 该行可以从"DEFERRED" 改 "DONE")
- **T-1.5.2 衔接**: T-1.5.1 完成后, T-1.5.2 替换 branded icon + rebuild 4 artifact, dev cert 配置已就位, 4 artifact 自动带 signature
- **Sprint 1.5 close**: T-1.5.1 是 Wave 1, 拍板后 PM 自主起 T-1.5.2 (Wave 2, NJX 拍板纳入) + T-1.5.3 (Wave 3, NJX 拍板 with-tests 路径)
- **W4 Gate 复盘会 (7/19)**: T-1.5.1 + T-1.5.2 + T-1.5.3 全 done → 4 文档 close → retrospective ready

---

## 10. Worker 报告格式 (deliverable.md 模板)

```markdown
# T-1.5.1 Dev Signing Wire — Deliverable

## VERDICT: <PASS / PARTIAL / FAIL>

## Summary
- openssl self-signed cert gen: <OK / FAIL>
- electron-builder.yml wire: <OK / FAIL>
- .gitignore 加固: <OK / FAIL>
- electron-builder 1x x64-setup.exe: <OK / FAIL>
- byte-level grep: <hits> (≥ 1 expected)
- osslsigncode verify: <OK / FAIL>

## 5 验收信号
1. build/dev-cert.pfx 存在 + openssl pkcs12 info: <OK/FAIL>
2. electron-builder.yml 含 certificateFile + certificatePassword: <OK/FAIL>
3. .gitignore 加固 + git check-ignore 命中: <OK/FAIL>
4. 1x x64-setup.exe build 成功 + byte-level grep ≥ 1: <OK/FAIL>
5. osslsigncode verify exit 0 + commit + 3件齐: <OK/FAIL>

## Commit
- Branch: sp1.5-T-1.5.1
- Commit: <hash>
- Worktree: /Users/njx/openclaw/copilot.wt-T151/wt-T151

## Caveat (if any)
- Win SmartScreen "Unknown Publisher" 警告: <预期, prod cert 才消除>
- 其他 caveat: <list>

## 钉子 #38 dist bundle grep
- src Sprint 命中: <hits>
- dist bundle Sprint 1.4 release 命中: <hits>
- 一致性: <OK / FAIL>
```

---

**TASK.md close**: 2026-07-10 19:45 CST (PM Mavis) · 等待 sub-plan dispatch
**Next**: `mavis team plan run sprint1.5/sprint1.5-T-1.5.1.yaml` 立即 dispatch
