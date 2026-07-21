# T-1.4.1b+c SELF-VERIFY · PM hand-audit trail

**Date**: 2026-07-10 17:54 CST (PM Mavis)
**Deliverable**: `outputs/T-1.4.1b/deliverable.md` (~280 lines)
**Plan**: plan_4da13300 (cancelled) → refresh-and-retry standalone path

## Quick accept checklist (per钉子 #14 #5)

### Evidence 1 — 4 artifact files exist
```bash
ls -lh /Users/njx/openclaw/copilot/apps/copilot-desktop/release/*.exe
# Expect:
# -rw-r--r--  1 njx  staff    84M  njx-copilot-v6-0.1.0-arm64-portable.exe
# -rw-r--r--  1 njx  staff    84M  njx-copilot-v6-0.1.0-arm64-setup.exe
# -rw-r--r--  1 njx  staff   163M  njx-copilot-v6-0.1.0-portable.exe
# -rw-r--r--  1 njx  staff   163M  njx-copilot-v6-0.1.0-setup.exe
# -rw-r--r--  1 njx  staff    79M  njx-copilot-v6-0.1.0-x64-portable.exe
# -rw-r--r--  1 njx  staff    79M  njx-copilot-v6-0.1.0-x64-setup.exe
```
✓ 4 canonical (x64-setup, arm64-setup, x64-portable, arm64-portable) + 2 combined.

### Evidence 2 — file type (NSIS installer)
```bash
file /Users/njx/openclaw/copilot/apps/copilot-desktop/release/njx-copilot-v6-0.1.0-x64-setup.exe
# Expect: PE32 executable (GUI) Intel 80386, for MS Windows, Nullsoft Installer self-extracting archive
```
✓ PASS (Nullsoft NSIS confirmed)

### Evidence 3 — SHA256 manifest
```bash
cat /Users/njx/openclaw/copilot/apps/copilot-desktop/release/SHA256SUMS-0.1.0.txt
# Expect: 6 lines, 64-hex hash per line
```
✓ 6 lines (x64-setup, arm64-setup, x64-portable, arm64-portable, setup combined, portable combined)

### Evidence 4 — blockmap
```bash
ls /Users/njx/openclaw/copilot/apps/copilot-desktop/release/*.blockmap
# Expect: arm64-setup.blockmap, setup.blockmap, x64-setup.blockmap
```
✓ 3 blockmaps (NSIS for delivery incremental updates)

### Evidence 5 — config (`.github/workflows/build-win.yml` from Wave 1 @ `4e965af6`)
```bash
git -C /Users/njx/openclaw/copilot show 4e965af6 --stat
# Expect: 1 file changed, 137 insertions (.github/workflows/build-win.yml)
```
✓ Already on main from Sprint 1.4 Wave 1 PASS

### Evidence 6 — win-unpacked intermediate
```bash
ls /Users/njx/openclaw/copilot/apps/copilot-desktop/release/win-unpacked/njx-copilot-v6.exe
# Expect: 180 MB PE32+ executable (GUI) x86-64, for MS Windows
```
✓ PASS (PE32+ x64)

## PM verdict

VERDICT: **PASS** (6/6 evidence, all sub-deliverables present, no fabricated data)

NJX popup 17:11 「refresh-and-retry」 走通 path: 4 artifact 落地 + SHA256 + blockmap 全齐. Wave 5 (NJX 真机 install + 启动) 仍需 NJX 物理操作.
