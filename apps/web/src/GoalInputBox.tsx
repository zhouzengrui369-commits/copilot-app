// GoalInputBox — Sprint1 Task3: dev-center 自然语言目标入口
//
//调 POST /api/development/goals/from-natural-language (Task1 endpoint, f4149536)。
//成功 → onSuccess(goal, detail) 让父组件切到目标详情。
//失败 → onFallback(text) 让父组件展开原 development-goal-create 结构化表单。
//
// 设计约束 (来自 sprint1计划 / openclaw-workbench.md memory)：
//1. 不引入新依赖，依赖原生 fetch + React。
//2. 不在 App.tsx主体堆叠，独立文件。
//3. 仅接收 props，不直接访问全局状态 (避免与 App.tsx巨型组件耦合)。
//4. export default (delivery contract)。

import { useEffect, useRef, useState } from "react";

type GoalNluSubtask = {
 key: string;
 title: string;
 kind: string;
};

type GoalNluVerification = {
 kind: "desktop_screenshot" | "code_only" | "doc_only";
 targetApp?: string;
 expectedScreenshots?: number;
};

type GoalNluParsed = {
 title: string;
 objective: string;
 successCriteria: string[];
 subtasks: GoalNluSubtask[];
 autonomyLevel: string;
 riskPolicy: string;
 estimatedTurns: number;
 verification: GoalNluVerification;
};

type GoalNluParse = {
 ok: boolean;
 fallback?: boolean;
 parsed?: GoalNluParsed;
 rawOutput?: string;
 sourceHash?: string;
 error?: string;
 durationMs?: number;
};

type GoalSummary = {
 id: string;
 projectId: string;
 title: string;
 objective?: string;
 status?: string;
 statusLabel?: string;
 progressPercent?: number;
 activeWorkPacketId?: string;
 activeSubtaskId?: string;
};

type DetailSummary = {
 project?: { id?: string; name?: string };
 goals?: GoalSummary[];
 activeWorkPacket?: { id?: string } | null;
 baseline?: { currentSubtask?: { id?: string } | null } | null;
};

type NluResponse =
 | {
 ok: true;
 parse?: GoalNluParse;
 goal?: GoalSummary | null;
 detail?: DetailSummary | null;
 durationMs?: number;
 }
 | {
 ok: false;
 error?: string;
 parse?: GoalNluParse;
 };

export interface GoalInputBoxProps {
  /** 当前项目 ID；为空时禁用提交 */
  projectId: string | null;
  /**父组件繁忙态 (例如父级全局 goalBusy)；为 true 时禁用提交 */
  busy?: boolean;
  /** Sprint2 创 goal 入口: 跳到开发台时自动 focus 到输入框 */
  autoFocus?: boolean;
  /** 自动 focus 完成后通知父组件 (用于清 url ?focus=goal-input flag) */
  onAutoFocusConsumed?: () => void;
 /**成功创建后通知父组件（用于切到目标详情 /刷新） */
 onSuccess?: (input: {
 goal: GoalSummary;
 detail: DetailSummary | null;
 parse: GoalNluParse | null;
 naturalLanguage: string;
 }) => void;
 /**失败/降级时通知父组件，传入原始自然语言，让父组件展开原结构化表单并预填 */
 onFallback?: (input: { naturalLanguage: string; reason: string; parse: GoalNluParse | null }) => void;
 /**父组件希望看到统一 notice */
 onNotice?: (tone: "ok" | "warn" | "error", message: string) => void;
 /** placeholder 文案 */
 placeholder?: string;
 /** 输入框最大字符数 */
 maxLength?: number;
}

type LocalState =
 | { kind: "idle" }
 | { kind: "submitting"; startedAt: number }
 | { kind: "success"; goal: GoalSummary; parse: GoalNluParse | null; naturalLanguage: string }
 | { kind: "fallback"; reason: string; parse: GoalNluParse | null; naturalLanguage: string }
 | { kind: "error"; message: string };

const PLACEHOLDER_DEFAULT = "用一句话描述你想推进的开发目标，例如：在 Chrome 里打开 Workbench演示笔记生成。";
const MAX_LENGTH_DEFAULT =2000;

/**
 * 调用 NLU endpoint拆解 + 入库
 * 返回 parse + goal + detail；失败时 parse 通常含 fallback parsed goal。
 * 完全失败 (parsed 为空) 时 server 会回502 + ok:false，此时抛 Error 让上层走 fallback。
 */
async function callGoalNluEndpoint(payload: {
 naturalLanguage: string;
 projectId: string;
}): Promise<NluResponse> {
 const res = await fetch("/api/development/goals/from-natural-language", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok || data?.ok === false) {
 const message = [
 data?.message || data?.error || res.statusText,
 data?.reasonLabel,
 data?.stage && `stage=${data.stage}`,
 ]
 .filter(Boolean)
 .join("；");
 const err = new Error(message || `HTTP ${res.status}`);
 // 把 server details挂上，方便父组件展示
 (err as Error & { details?: unknown }).details = data;
 throw err;
 }
 return data as NluResponse;
}

function formatElapsed(startedAt: number, now: number): string {
 const ms = Math.max(0, now - startedAt);
 if (ms <1000) return `${ms} ms`;
 const sec = Math.floor(ms /1000);
 if (sec <60) return `${sec} 秒`;
 const min = Math.floor(sec /60);
 return `${min} 分 ${sec %60} 秒`;
}

function summarizeSubtasks(parsed: GoalNluParsed | undefined | null): string {
 if (!parsed || !Array.isArray(parsed.subtasks) || parsed.subtasks.length ===0) return "未拆解出子任务";
 return parsed.subtasks
 .slice(0,5)
 .map((s, idx) => `${idx +1}. ${s.title}`)
 .join(" / ");
}

export default function GoalInputBox({
  projectId,
  busy = false,
  autoFocus = false,
  onAutoFocusConsumed,
  onSuccess,
  onFallback,
  onNotice,
  placeholder = PLACEHOLDER_DEFAULT,
  maxLength = MAX_LENGTH_DEFAULT,
}: GoalInputBoxProps) {
 const [text, setText] = useState("");
 const [state, setState] = useState<LocalState>({ kind: "idle" });
 const [tick, setTick] = useState(0); // 用于更新 loading计时器
 const textRef = useRef<HTMLTextAreaElement | null>(null);

 const isBusy = busy || state.kind === "submitting";
 const trimmed = text.trim();
 const canSubmit = !isBusy && Boolean(projectId) && trimmed.length >0;

  // submitting态下每秒刷新 tick，用于"AI拆解中…已3 秒"实时显示
  useEffect(() => {
  if (state.kind !== "submitting") return;
  const timer = window.setInterval(() => setTick((value) => value +1),1000);
  return () => window.clearInterval(timer);
  }, [state.kind]);

  // Sprint2 创 goal 入口: chat 跳到开发台时 autoFocus 输入框
  useEffect(() => {
  if (!autoFocus) return;
  const handle = window.setTimeout(() => {
  textRef.current?.focus();
  textRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  onAutoFocusConsumed?.();
  }, 200);
  return () => window.clearTimeout(handle);
  }, [autoFocus, onAutoFocusConsumed]);

 // props.projectId改变时不重置输入（避免父组件重渲染清空用户草稿）—— 这是有意的。

 async function submit() {
 if (!canSubmit) return;
 if (!projectId) {
 setState({ kind: "error", message: "请先选择项目。" });
 onNotice?.("warn", "请先选择项目再描述目标。");
 return;
 }
 const naturalLanguage = trimmed;
 setState({ kind: "submitting", startedAt: Date.now() });
 try {
 const data = await callGoalNluEndpoint({ naturalLanguage, projectId });
 //成功路径：server总是会返回 goal (fallback 时也会入库)
 if (data.ok && data.goal) {
 setState({
 kind: "success",
 goal: data.goal,
 parse: data.parse ?? null,
 naturalLanguage,
 });
 onSuccess?.({
 goal: data.goal,
 detail: data.detail ?? null,
 parse: data.parse ?? null,
 naturalLanguage,
 });
 const parse = data.parse;
 const subtaskCount = parse?.parsed?.subtasks?.length ||0;
 const fallbackLabel = parse?.fallback ? "（AI降级 fallback 入库）" : "";
 onNotice?.(
 "ok",
 `AI 已拆解目标：${data.goal.title || naturalLanguage.slice(0,40)} · ${subtaskCount} 子任务${fallbackLabel}`,
 );
 // 清空输入框，保留 goal摘要一小段时间
 setText("");
 window.setTimeout(() => {
 setState((current) => (current.kind === "success" ? { kind: "idle" } : current));
 },4000);
 return;
 }
 // server200 但 goal缺失 (理论不该发生，但稳妥起见走 fallback)
 const reason = data.ok === false ? (data.error || "AI拆解结果缺失，请手动填写。") : "AI拆解结果缺失，请手动填写。";
 setState({
 kind: "fallback",
 reason,
 parse: data.parse ?? null,
 naturalLanguage,
 });
 onFallback?.({ naturalLanguage, reason, parse: data.parse ?? null });
 onNotice?.("warn", reason);
 } catch (err) {
 //走 fallback：让父组件展开原结构化表单 +预填自然语言
 const message = err instanceof Error ? err.message : String(err);
 const details = (err as Error & { details?: { parse?: GoalNluParse } }).details;
 const fallbackReason = `AI拆解失败，请手动填写（${message}）`;
 setState({
 kind: "fallback",
 reason: fallbackReason,
 parse: details?.parse ?? null,
 naturalLanguage,
 });
 onFallback?.({ naturalLanguage, reason: fallbackReason, parse: details?.parse ?? null });
 onNotice?.("error", fallbackReason);
 }
 }

 function reset() {
 setText("");
 setState({ kind: "idle" });
 textRef.current?.focus();
 }

 function handleFallbackClick() {
 if (!trimmed) return;
 const reason = state.kind === "fallback" ? state.reason : "AI拆解失败，请手动填写。";
 const parse = state.kind === "fallback" ? state.parse : null;
 setState({ kind: "fallback", reason, parse, naturalLanguage: trimmed });
 onFallback?.({ naturalLanguage: trimmed, reason, parse });
 }

 const elapsed =
 state.kind === "submitting" ? formatElapsed(state.startedAt, Date.now() + tick *0) : "";
 // tick副作用仅触发重新渲染；上面 Date.now() 用当前时间即可

 return (
 <section className="goal-input-box" aria-label="自然语言目标入口 (AI拆解)">
 <header>
 <div>
 <span className="goal-input-box-tag">AI入口</span>
 <strong>用一句话创建长期目标</strong>
 <small>Workbench 会调用 v3 gateway agent拆解出子任务、验证方式和成功标准。</small>
 </div>
 <div className="goal-input-box-meta">
 {!projectId && <span className="goal-input-box-warn">请先选择项目</span>}
 {projectId && <span className="goal-input-box-project">{projectId}</span>}
 </div>
 </header>
 <textarea
 ref={textRef}
 value={text}
 onChange={(event) => setText(event.target.value)}
 onKeyDown={(event) => {
 if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
 event.preventDefault();
 if (canSubmit) void submit();
 }
 }}
 placeholder={placeholder}
 rows={3}
 maxLength={maxLength}
 disabled={isBusy}
 aria-label="自然语言目标描述"
 />
 <div className="goal-input-box-footer">
 <div className="goal-input-box-counter">
 <span>{trimmed.length}/{maxLength}</span>
 {trimmed.length >0 && <small>按 ⌘+Enter立即提交</small>}
 </div>
 <div className="goal-input-box-actions">
 <button
 type="button"
 onClick={reset}
 disabled={isBusy || trimmed.length ===0}
 aria-label="清空输入"
 >
 清空
 </button>
 <button
 type="button"
 onClick={handleFallbackClick}
 disabled={isBusy || trimmed.length ===0}
 title="展开原结构化表单，手动填写目标"
 >
手动填写
 </button>
 <button
 type="button"
 className="primary"
 onClick={() => void submit()}
 disabled={!canSubmit}
 >
 {state.kind === "submitting" ? "AI拆解中…" : "AI拆解并创建"}
 </button>
 </div>
 </div>
 {state.kind === "submitting" && (
 <div className="goal-input-box-loading" role="status" aria-live="polite">
 <span className="goal-input-box-spinner" aria-hidden="true" />
 <strong>AI拆解中…</strong>
 <small>已等待 {elapsed} · prompt version = goal-nlu-prompt-20260610a</small>
 </div>
 )}
 {state.kind === "success" && (
 <div className="goal-input-box-result ok" role="status" aria-live="polite">
 <header>
 <span>已创建</span>
 <strong>{state.goal.title || state.naturalLanguage.slice(0,40)}</strong>
 <small>
 goal id = {state.goal.id}
 {state.goal.progressPercent !== undefined ? ` ·进度 ${state.goal.progressPercent}%` : ""}
 {state.parse?.durationMs ? ` ·耗时 ${state.parse.durationMs}ms` : ""}
 </small>
 </header>
 <p>{summarizeSubtasks(state.parse?.parsed)}</p>
 {state.parse?.fallback && <small className="muted">注：AI拆解降级，已写入 fallback goal；可手动调整成功标准与子任务。</small>}
 </div>
 )}
 {state.kind === "fallback" && (
 <div className="goal-input-box-result warn" role="status" aria-live="polite">
 <header>
 <span>AI拆解失败，请手动填写</span>
 <small>{state.reason}</small>
 </header>
 {state.parse?.parsed && (
 <details>
 <summary>查看 LLM 部分输出 ({state.parse.parsed.subtasks?.length ||0} 子任务)</summary>
 <pre>{JSON.stringify(state.parse.parsed, null,2)}</pre>
 </details>
 )}
 <button type="button" className="primary" onClick={handleFallbackClick} disabled={!trimmed}>
展开结构化表单
 </button>
 </div>
 )}
 {state.kind === "error" && (
 <div className="goal-input-box-result error" role="status" aria-live="polite">
 <header>
 <span>无法发起 AI拆解</span>
 <small>{state.message}</small>
 </header>
 </div>
 )}
 </section>
 );
}
