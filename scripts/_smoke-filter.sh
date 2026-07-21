#!/bin/bash
node /Users/njx/openclaw_data/openclaw_workbench/scripts/heartbeat-budget-smoke.mjs > /tmp/smoke-out.txt2>&1
grep -E "events_written|lastTickAt|last_auto_tick|status|uptimeMs|PASS|FAIL|generatedAt|scheduler.lastTickAt|tokenBudget.used" /tmp/smoke-out.txt | head -30
