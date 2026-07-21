<!-- project-agents-rules:start -->
# Project Rules: OpenClaw-first Codex Development

## Role

Codex is the product manager and acceptance owner. Codex defines the real problem, writes the task contract, delegates execution to local OpenClaw, and verifies concrete evidence.

## Token Budget Guard

Before coding or broad inspection, Codex must choose one route:

- `delegate-to-openclaw`: default for implementation, broad file reading, logs, tests, builds, screenshots, and verification.
- `repair-openclaw`: use when Gateway, node, allowlist, runtime, or command execution is unavailable.
- `codex-small-fix`: only for tiny unblockers or repairing the OpenClaw execution path.
- `product-only-answer`: for PM judgment, PRD, acceptance criteria, or review without code execution.

Do not spend Codex tokens mimicking worker execution when OpenClaw can run it.

## OpenClaw Preflight

For development tasks, verify the smallest safe OpenClaw path first: health check, read-only canary, or repo-owned allowlisted script. If it fails, fix OpenClaw/Gateway/node/allowlist/runtime before continuing the original task. Keep execution narrow; do not grant broad shell access just to save time.

## OpenClaw Task Contract

Every delegated task must include:

- goal
- allowed files/directories
- forbidden changes
- commands or checks to run
- expected deliverable path
- acceptance criteria

## Standard OpenClaw Output

Use `tasks/openclaw/<timestamp>-<slug>/` for non-trivial tasks. Require:

- `TASK.md`: contract sent to OpenClaw
- `PLAN.md`: intended steps and risk notes
- `RESULT.md`: final status, changed files, tests, known gaps
- `EVIDENCE.md`: screenshots, logs, artifact paths, runtime checks
- `commands.log`: commands attempted and outcomes
- `changed-files.txt`: exact files touched

Codex should inspect these files before reading broad source or long logs.

## Evidence Budget

Codex should read only the smallest evidence set needed for acceptance:

- task contract, plan, result, evidence index
- `git diff --stat` and focused diffs for touched files
- failing test excerpts, not full logs
- screenshots/artifacts named in `EVIDENCE.md`

Avoid full-tree scans, full logs, generated directories, dependency folders, or large build output unless the focused evidence is insufficient.

## Failure Triage

Classify failures before spending more Codex tokens:

- executor failure: repair OpenClaw/Gateway/node/allowlist/runtime
- contract failure: rewrite `TASK.md` with tighter scope
- implementation failure: return a minimal fix contract to OpenClaw
- acceptance failure: request specific evidence or rerun the narrow check

Do not silently convert an executor failure into Codex takeover.

## Product Standard

For AI product work, verify user value, real scenario, LLM boundary, fallback paths, cost, explainability, evaluation, safety, maintainability, and zero-rework acceptance.

## Output Style

Default output should be short: route chosen, dispatch/execution status, evidence read, acceptance decision, next step. Only produce full PRD structure when explicitly requested.
<!-- project-agents-rules:end -->


<!-- minimax-primary-gpt-fallback:start -->
# Codex Desktop MiniMax Entry Rule (Project Layer)

## Trigger

For copilot tasks after NJX switches the top toolbar to MiniMax-M3, load `/Users/njx/.codex/skills/minimax-primary-gpt-fallback/SKILL.md` first.

## Routing

MiniMax Desktop is the primary worker for coding, shell, repo inspection, build/test, docs, and ordinary project work. It must not ask NJX to open Terminal or switch CLI at the start.

If MiniMax is blocked, it returns a blocker packet. The controller then dispatches the smallest fallback action only:

- `BLOCKED_GPT_CLI_FALLBACK_REQUIRED`: use `/Users/njx/Documents/Codex/2026-06-24/openai-codex-openai-ai-codex-sdk/work/run-codex-gpt55-cli-fallback.command` for `.git` writes, git commit, network probes, build/test, process inspection, cross-directory writes, or cache writes.
- `BLOCKED_GPT_DESKTOP_THREAD_REQUIRED`: use GPT Desktop thread for Computer Use, Browser, Chrome, screenshots, image generation, Codex UI/history/model dropdowns, or other GUI/plugin work.

Fallback must not become broad GPT takeover. It executes only the blocker packet's minimal command set, reports commands/exit codes/changed files/evidence, then stops.

## MiniMax Active Evidence

MiniMax Desktop entry is active when the toolbar/model switcher shows:

- `Current: MiniMax-M3`
- `provider = minimax`
- switch confirmation such as `switched to MiniMax-M3`

Do not classify the session as failed only because shell environment says `CODEX_SANDBOX=seatbelt`, `workspace-write`, or no `codex -p minimax` process exists.

## Required MiniMax Config

Expect `model=MiniMax-M3`, `review_model=MiniMax-M3`, `model_provider=minimax`, `approval_policy=on-request`, `approvals_reviewer=user`, `sandbox_mode=danger-full-access`, `[model_providers.minimax].base_url=http://127.0.0.1:45557/v1`, and catalog `MiniMax-M3.auto_review_model_override=MiniMax-M3`.

If `codex-auto-review` appears, verify/start:

```bash
/Users/njx/Documents/Codex/2026-06-24/openai-codex-openai-ai-codex-sdk/work/start-minimax-m3-review-proxy.command
```

## Blocker Packet

Blocker evidence must include blocker code, goal, workspace, exact failed action, exact last output, files touched, smallest fallback action requested, and why MiniMax cannot complete it in-thread.

## Hard Stop Codes

- `BLOCKED_TOOLBAR_NOT_MINIMAX`
- `BLOCKED_STALE_DESKTOP_RUNTIME`
- `BLOCKED_DESKTOP_APPROVAL_REVIEWER_PROVIDER`
- `BLOCKED_DESKTOP_SANDBOX_LIMIT`
- `BLOCKED_GPT_CLI_FALLBACK_REQUIRED`
- `BLOCKED_GPT_DESKTOP_THREAD_REQUIRED`
- `BLOCKED_PROVIDER_FAILURE`
- `BLOCKED_SENSITIVE_UNAPPROVED`

## Scope Safety

Default write target is `/Users/njx/openclaw/copilot`. Treat `/Users/njx/openclaw_data/openclaw_workbench` as reference-only unless NJX explicitly names it as the write target. Do not modify `~/.codex`, auth profiles, system LaunchServices, global shell config, or unrelated repos unless NJX explicitly asks for that exact configuration task.
<!-- minimax-primary-gpt-fallback:end -->

<!-- codex-minimax-mavis-devflow:start -->
# Project Inheritance: Codex PM -> MiniMax/Mavis CLI -> Codex Acceptance

This project inherits the user-level workflow in /Users/njx/.codex/AGENTS.md and the runbook at /Users/njx/.codex/rules/codex-minimax-mavis-devflow.md.

Default route for implementation:

1. Codex writes GOAL.md, TASK.md, PLAN.md, and acceptance criteria in tasks/openclaw/<timestamp>-<slug>/ or the closest existing project task folder.
2. Codex dispatches bounded implementation to MiniMax/Mavis:
   /Users/njx/Documents/Codex/2026-06-24/openai-codex-openai-ai-codex-sdk/work/dispatch-minimax-task.command --workspace <project> --title "<title>" <task-dir>/TASK.md
3. Codex checks status and deliverables:
   /Users/njx/Documents/Codex/2026-06-24/openai-codex-openai-ai-codex-sdk/work/check-minimax-task.command <mvs_session_id> <task-dir>
4. Codex performs final acceptance from RESULT.md, EVIDENCE.md, commands.log, changed-files.txt, focused diff, and required checks.

Do not treat a MiniMax/Mavis chat summary as completion without file and command evidence.
Do not high-frequency poll. Quality first, Codex/GPT token cost second, elapsed waiting time third.
<!-- codex-minimax-mavis-devflow:end -->
