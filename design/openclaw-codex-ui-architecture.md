# OpenClaw Workbench Codex UI Architecture

Status: design contract  
Owner: OpenClaw Dev Console  
Target app: `/Users/njx/Applications/njx-copilot.app`  
Repo: `/Users/njx/openclaw/copilot`  
Created: 2026-06-14

## 0. Product Decision

OpenClaw Dev Console must align to Codex's execution-console design language:

- Codex is not a dashboard. It is a task execution surface.
- Three columns are semantic regions, not a layout trick.
- Every visible module must help the user decide what to do next.
- OpenClaw-specific powers, such as goals, token budget, skills, cron, mobile, and multi-agents, stay in the product but must be embedded into the Codex task workflow.

This document is the UI contract. React code, CSS, and Electron acceptance should follow this structure before adding more features.

## 1. Codex Design Language

### 1.1 Information Architecture

Codex organizes the first viewport around one active task.

| Region | Codex meaning | OpenClaw equivalent | Default priority |
|---|---|---|---|
| Left rail | Task/session navigation | Task Stack, recent goals, subtasks, agent switcher | High |
| Center | Active task execution thread | Current task header, changes, timeline, composer | Highest |
| Right rail | Inspector for current task | Status, goal progress, token, evidence, agents, sources | High |

### 1.2 Visual Language

- Background: white and cool gray, not saturated theme blocks.
- Boundaries: 1px dividers and subtle row borders.
- Radius: 6px for controls, 8px for contained panels.
- Typography: compact desktop scale; no hero typography inside the console.
- Color: one primary accent, one warning, one success. No green/blue button pile.
- Motion: none required. Stability beats animation.
- Density: list rows and inspectors, not marketing cards.

### 1.3 Interaction Language

- One primary action per active task.
- Secondary actions are visible but visually quiet.
- Deep objects use disclosure: details, drawers, tabs, or split inspector.
- The composer is always available in the center bottom.
- AI appears as task-aware execution, not a detached chatbot.

## 2. Target First Viewport

At 1440 x 900, the first viewport must show all of this without scrolling:

1. Active task title and status.
2. Current goal or project session.
3. Progress percent or baseline count.
4. Token used or estimated token budget.
5. File/output changes summary.
6. Evidence/source entry.
7. Next primary action.
8. Bottom composer.
9. Multi-agent visibility or route.

If one of these is below the fold, the UI fails.

## 3. App Shell Architecture

```text
DevConsoleShell
├── GlobalWorkbenchNav
├── DevConsoleGrid
│   ├── DevLeftRail
│   │   ├── QuickCreateToolbar
│   │   ├── TaskStackNav
│   │   ├── AgentSwitcherPopover
│   │   └── ProjectBrowserDisclosure
│   ├── DevTaskWorkspace
│   │   ├── ActiveAgentBar
│   │   ├── SessionStrip
│   │   ├── TaskExecutionHeader
│   │   ├── CommandBar
│   │   ├── ChangeSummary
│   │   ├── ExecutionThread
│   │   └── TaskComposer
│   └── DevInspectorRail
│       ├── StatusStrip
│       ├── GoalTokenKpi
│       ├── CurrentTaskEvidence
│       ├── InspectorDisclosureGroup
│       │   ├── GoalLedgerPanel
│       │   ├── PlanPanel
│       │   ├── ResultPanel
│       │   ├── VerifyPanel
│       │   ├── TimelinePanel
│       │   ├── LogsAndArtifactsPanel
│       │   └── QualityGatesPanel
│       └── InspectorResizeHandle
└── PreviewDrawer
```

## 4. Layout Contract

### 4.1 Desktop

```css
grid-template-columns:
  minmax(220px, 252px)
  minmax(560px, 1fr)
  minmax(304px, 344px);
gap: 0;
```

Rules:

- Columns are separated by borders, not card gaps.
- Left and right rails are fixed-density rails.
- Center owns most horizontal space.
- The console should look like one integrated app, not three floating cards.

### 4.2 Tablet

At 1024 x 768:

- Left rail may narrow to icon+label rows.
- Right inspector may stay visible if center remains >= 480px.
- Project Browser stays collapsed.
- Composer remains visible.

### 4.3 Mobile

At 390 x 844:

- Stack order: Task header, composer, current evidence, task stack.
- Full three-column parity is not required on mobile.
- No horizontal scrolling.

## 5. Component Contracts

### 5.1 QuickCreateToolbar

Purpose: expose OpenClaw extensions without making them the product.

Items:

- New Task
- New Skill
- Cron
- Mobile
- Multi Agents

Rules:

- Height per row: 30-34px.
- New Task can use primary accent.
- Other items are neutral rows.
- No large green buttons.
- Multi Agents opens a popover, not a full left-tab takeover.

### 5.2 TaskStackNav

Purpose: Codex-like navigation for active work.

Rows:

- Active subtask.
- Recent goals.
- Current baseline subtasks.
- Running/background tasks.

Required fields:

- Sequence or icon.
- Title.
- Status.
- Optional progress.

Rules:

- Task Stack appears before Project Browser.
- Active row has quiet blue tint.
- Rows must not exceed one line.

### 5.3 ProjectBrowserDisclosure

Purpose: keep project tree available but lower priority.

Rules:

- Collapsed by default.
- Summary row shows current project and count.
- Expanded state is scroll-contained.
- Project tree never pushes Task Stack out of first viewport.

### 5.4 ActiveAgentBar

Purpose: show who is doing the work.

Required fields:

- Active agent avatar.
- Agent name.
- Model.
- Online/running state.
- Background agent count.

Rules:

- Compact 40px max height.
- Do not use decorative avatar cards.

### 5.5 SessionStrip

Purpose: orient the active task session.

Required fields:

- Session type: Dev Session or Goal Session.
- Goal/project title.
- Task id or baseline version.
- Turns.
- Idle/running state.

Rules:

- One-line strip.
- Small caps labels.
- No paragraph text.

### 5.6 TaskExecutionHeader

Purpose: the core of the page.

Required fields:

- Task status.
- Task title.
- One-line task description or blocker.
- Progress.
- Changes count.
- Token used.
- Primary and secondary actions.

Action hierarchy:

1. Primary: Run current / Continue goal.
2. Secondary: Shadow.
3. Secondary: Audit.

Rules:

- Only one primary filled button.
- All other action buttons neutral.
- Header must not exceed 76px on desktop.

### 5.7 CommandBar

Purpose: create or redirect work without becoming the main content.

Rules:

- Compact one-line/short textarea.
- No large card.
- NLU helper actions are secondary.
- Long goal creation form belongs in a drawer or modal, not first viewport.

### 5.8 ChangeSummary

Purpose: Codex-style output visibility.

Required fields:

- Type: tsx/css/html/md/artifact/gate/log.
- Path or artifact id.
- Added/removed estimate or output size.
- Status: new/modified/missing/reviewed.
- Action: Open / Review.

Rules:

- This is not a full git diff engine in this phase.
- It must be real enough to answer "产出在哪里".
- Use documents, artifacts, gates, and events as source inputs.

### 5.9 ExecutionThread

Purpose: task history, evidence, and decisions.

Allowed items:

- User instruction.
- Agent decision.
- Execution event.
- Evidence entry.
- Blocker.
- Review/audit result.

Rules:

- Timeline rows should be flat and readable.
- Large colored cards only for active execution or blocking errors.
- Empty state must say what action creates evidence.

### 5.10 TaskComposer

Purpose: always-available task input.

Required controls:

- Add/menu button.
- Text input.
- Review mode selector.
- Send button.

Rules:

- Docked at center bottom.
- Must be visible at 1440 x 900.
- No overlap with thread content.

### 5.11 StatusStrip

Purpose: truth surface for app/runtime.

Required fields:

- Runtime online/offline/checking.
- Gateway status.
- Updated timestamp.
- Source tooltip or label.

Rules:

- Do not say Gateway connected from weak inference.
- If inferred, label it as inferred.
- If unavailable, say unavailable and why.

### 5.12 GoalTokenKpi

Purpose: bring Marvis token visibility into Codex inspector.

Required fields:

- Goal title.
- Progress bar.
- Token used.
- Token budget if available.
- Turns/heartbeats/subtasks.

Rules:

- Compact vertical card.
- No gradient hero.
- Token estimate must be labeled as estimate until real provider usage exists.

### 5.13 CurrentTaskEvidence

Purpose: the only default-expanded evidence section.

Required fields:

- Current task title.
- Status.
- Next action or blocker.
- Changes count.
- Evidence count.
- Log/event count.
- Top 3 acceptance criteria.

Rules:

- Must be visible in first viewport.
- This section answers "为什么当前状态可信".

### 5.14 InspectorDisclosureGroup

Purpose: keep full OpenClaw depth without overwhelming the first screen.

Default collapsed sections:

- Goal Ledger.
- Plan.
- Result.
- Verify.
- Timeline.
- Logs and artifacts.
- Quality gates.
- Docs.
- Capability health.
- Project actions.

Rules:

- Each collapsed summary is one row.
- Summary row shows label, title, and count/state.
- Expanded section has max height and internal scroll.

## 6. Data Model Contract

### 6.1 View Models

The UI should not consume raw backend payloads directly in components.

Create or stabilize these view models:

```ts
type DevTaskSession = {
  id: string;
  title: string;
  status: "idle" | "running" | "blocked" | "review" | "done";
  goalTitle?: string;
  progressPercent: number;
  tokenUsed: number;
  tokenBudget?: number;
  turns: number;
  updatedAt: string;
};

type DevChangeItem = {
  id: string;
  kind: "file" | "document" | "artifact" | "gate" | "event";
  label: string;
  path: string;
  added?: number;
  removed?: number;
  status: "new" | "modified" | "missing" | "reviewed";
  openAction: "document" | "artifact" | "gate" | "notice";
};

type DevInspectorSection = {
  id: string;
  label: string;
  title: string;
  count?: number;
  tone: "neutral" | "ok" | "warn" | "error";
  defaultOpen: boolean;
};
```

### 6.2 Truth Rules

- UI text must distinguish real, inferred, estimated, unavailable, and simulated.
- Token count is estimated unless provider usage exists.
- Gateway status cannot be green unless backend/gateway signal confirms it.
- Background agents must come from `/api/agents` or a concrete runtime state.

## 7. Visual Tokens

```css
--console-bg: #f4f5f7;
--console-surface: #ffffff;
--console-soft: #f8fafc;
--console-border: #d8dde7;
--console-border-soft: #e8ecf2;
--console-ink: #101828;
--console-muted: #667085;
--console-accent: #2563eb;
--console-accent-soft: #eef4ff;
--console-ok: #0f766e;
--console-warn: #b45309;
--console-error: #b42318;
--console-radius-control: 6px;
--console-radius-panel: 8px;
```

Typography:

| Element | Size | Weight |
|---|---:|---:|
| Rail row title | 12px | 700-800 |
| Small caps label | 10px | 800-850 |
| Center task title | 14px | 800-850 |
| Body/thread text | 12-13px | 400-650 |
| KPI value | 12-18px | 800-900 |

Spacing:

- Column gap: 0.
- Column padding: 7-10px.
- Row gap: 4-6px.
- Panel padding: 8-10px.
- Header height: 31-76px depending on component.

## 8. Current Code Mapping

| Contract component | Current file | Required change |
|---|---|---|
| DevConsoleShell | `apps/web/src/App.tsx` | Keep shell, ensure data view models are computed before panes |
| DevLeftRail | `DeliveryLeftRail.tsx` | Task Stack first, Project Browser collapsed |
| DevTaskWorkspace | `DeliveryCenterPane.tsx` | Thread owns first viewport; old goal/project cockpit collapsed |
| DevInspectorRail | `DeliveryRightRail.tsx` | Only Status/KPI/Current Evidence default open |
| Visual tokens | `styles.css` | Replace scattered delivery rules with scoped tokenized rules |
| ChangeSummary model | `App.tsx` | Derive from artifacts/documents/events without backend schema expansion |
| Electron acceptance | `apps/desktop` | Use correct app, not browser, after UI passes HTML preview |

## 9. Implementation Order

1. Freeze HTML preview as design target.
2. Refactor CSS tokens and layout first.
3. Refactor pane JSX to match component contracts.
4. Add stable view models in `App.tsx`.
5. Run web check/build.
6. Only then rebuild Electron app.
7. Validate with app screenshots at 1440 x 900, 1024 x 768, and 390 x 844 where applicable.

## 10. Acceptance Script

### 10.1 Human 5-second script

Open `/Users/njx/Applications/njx-copilot.app` and enter Dev Console. In 5 seconds, the user must answer:

- Current task: visible in center header and left active row.
- Current progress: visible in center metrics and right KPI.
- Token consumption: visible in center metrics and right KPI.
- Next action: visible as one primary button.
- Output location: visible in Changes.
- Evidence source: visible in Current Task Evidence.
- Multi-agent route: visible in left quick toolbar or active agent bar.

### 10.2 Visual gates

- 1440 x 900: left rail, center thread, composer, right inspector all visible.
- 1024 x 768: no horizontal overflow; composer visible.
- 390 x 844: stacked layout; no clipped text.
- No card-in-card visual clutter in default viewport.
- No more than one filled primary button in center task header.

### 10.3 Technical gates

```bash
npm run check --workspace @openclaw-workbench/web
npm run build --workspace @openclaw-workbench/web
npm run build --workspace @openclaw-workbench/server
npm run build --workspace @openclaw-workbench/desktop
```

Final validation must be done in the Electron app, not browser.

## 11. Non-goals

- Do not clone Codex branding.
- Do not build a full git diff engine in this pass.
- Do not add a new backend schema unless the current artifacts/documents/events model cannot answer "产出在哪里".
- Do not make Goal Ledger, Timeline, logs, or project baseline default-open.
- Do not treat green build checks as UI acceptance.

## 12. Taste Score Target

| Dimension | Target |
|---|---:|
| Information architecture | 90 |
| First-screen priority | 92 |
| State truthfulness | 88 |
| Workflow closure | 90 |
| Contextual AI | 88 |
| Trust and evidence | 88 |
| Interaction friction | 86 |
| Visual hierarchy | 90 |
| Safety boundary | 86 |
| Learning loop | 82 |

Overall target: 88+ before Electron acceptance.
