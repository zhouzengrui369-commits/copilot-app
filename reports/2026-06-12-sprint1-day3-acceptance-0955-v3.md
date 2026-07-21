# 6/12 09:55 Sprint1 Day3 Acceptance 终版 v3 (login 修正 + metadata 修复)

**修复**:
- server.ts: createDevelopmentGoal 加 metadata 字段
- endpoint type 加 metadata
- server 重启 (pid 87088 → 85471)
- 重新 setup admin + login (server auth 是 single-user, password-only)

**结果**:
## happy
- gid: goal-openclaw-workbench-1781229165762-f471fb9a
- final_status: blocked

## full-fail
- gid: goal-openclaw-workbench-1781229188817-65a2837b
- final_status: blocked

## partial
- gid: goal-openclaw-workbench-1781229211890-1a25402a
- final_status: blocked


**耗时**: 69.2s
