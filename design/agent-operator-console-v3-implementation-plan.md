# OpenClaw Agent Operator Console v3 Implementation Plan

## Problem Reconstruction

OpenClaw Workbench is not primarily competing on whether it has an office animation. It must become an Owner Operator control surface: the user should know within 10 seconds whether automation is producing value, which agent is working, which agent is stopped, what evidence exists, and which action restores momentum.

The current `/agent` page exposes many useful signals, but the hierarchy is weak. Tasks, stoppages, value metrics, office visuals, artifacts and recovery actions compete for attention instead of forming one operating loop.

## Chosen Direction

Use `agent-operator-console-v3.html` as the target shape:

- Left column: task queue and stoppage queue.
- Center column: value board and unified office.
- Right column: evidence, artifacts, preview and next actions.

This intentionally differs from Marvis by making evidence and recovery first-class. Marvis is cleaner visually; OpenClaw should exceed it by exposing PLAN/RESULT, local files, approval audit, recovery actions and multi-agent accountability.

## Non-Goals

- Do not copy Marvis assets, brand, character art or proprietary interaction details.
- Do not add decorative animation that is not backed by real state.
- Do not continue adding nested cards or background panels to the current page.
- Do not claim token metrics are exact until a real token usage API is wired.
- Do not hide Gateway, approval or stale-task failures behind generic "working" labels.

## Frontend Work

### 1. Replace Current Agent Workbench IA

Target file: `/Users/njx/openclaw_data/openclaw_workbench/apps/web/src/App.tsx`

Replace the current mixed workbench body with:

- `AgentOperatorSidebar`
- `AgentOperatorCenter`
- `AgentEvidencePanel`

Keep existing data loading from `/api/agent-workbench`, `/api/tasks/workbench/detail` and `/api/agent-workbench/value-metrics`.

### 2. Value Board

Implement from the prototype:

- Shows configured `rateWindowMinutes`; `1440` must render as `近 1 天 / 24h`.
- Shows separate real-time window, default `近 5 分钟`.
- Displays source labels: `events + artifacts`, `local estimate`, or real provider name.
- Keeps `设置指标` one click away and persists through `/api/agent-workbench/value-metrics`.

### 3. Unified Office

Replace separated status-card map with one shared office:

- Three primary desks: Main, Boss, Worker.
- Three support desks: Browser Agent, Knowledge Agent, Review Agent.
- Three service zones: tea/standby, GM approval, system ops.

State routing:

- `running/executing/thinking/tool` with fresh event: desk, screen output animation.
- `idle`: tea zone, static.
- `awaiting_confirmation/pending_approval/planned`: GM approval, static.
- `gateway_unavailable/blocked/failed/stale`: system ops, static recovery state.

No state other than fresh running/tool/thinking may render work animation.

### 4. Evidence Panel

Right panel must update when clicking any task, agent, desk computer, artifact, support desk or service zone.

It must show:

- Current status and next action.
- Recent logs, with thinking/tool/error collapsible.
- Artifacts: PLAN, RESULT, reports, code files, screenshots, HTML.
- Preview for Markdown, text, HTML and images.
- Actions appropriate to state:
  - Working: view task, guide, pause.
  - Approval: handle approval, view risk, add context.
  - Recovery: recover, diagnose, generate recovery prompt, open system settings.
  - Idle: assign task, open dev console, view skills.

### 5. Responsive Rules

- Desktop `1440x900`: three columns visible.
- Tablet `1024x768`: left + center first, evidence moves below or drawer.
- Mobile `390x844`: order is value board, office, stoppage queue, evidence.

## Backend Work

No database migration is required for v3.

Use existing aggregation, but ensure `/api/agent-workbench` returns enough for:

- `agents[].currentWork`
- `agents[].lastEventAt`
- `agents[].liveStatus`
- `workItems[].artifacts`
- `events[]`
- `valueMetrics`

If exact token data is unavailable, mark the metric source as `local estimate`.

## Acceptance Evidence

Prototype artifacts:

- `/Users/njx/openclaw_data/openclaw_workbench/design/agent-operator-console-v3.html`
- `/Users/njx/openclaw_data/openclaw_workbench/design/agent-operator-console-v3-desktop.png`
- `/Users/njx/openclaw_data/openclaw_workbench/design/agent-operator-console-v3-tablet.png`
- `/Users/njx/openclaw_data/openclaw_workbench/design/agent-operator-console-v3-mobile.png`

Required checks after formal implementation:

```bash
npm run check --workspace @openclaw-workbench/web
npm run build --workspace @openclaw-workbench/web
npm run check --workspace @openclaw-workbench/server
npm run build --workspace @openclaw-workbench/server
npm run health
```

Browser acceptance:

- `1440x900`: left queue, value/office, evidence panel visible at once.
- `390x844`: value board appears before queue.
- Gateway failure never appears as working animation.
- `rateWindowMinutes: 1440` has no stale hourly label.
- Clicking Worker or system ops shows recovery actions in the right panel.
- Clicking PLAN/RESULT opens preview and original file link.
- `设置指标` opens and saves value metric config.

