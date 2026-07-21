/**
 * goalNlu.ts — 自然语言目标 →标准化 Goal schema
 *
 * 这是 Sprint1 Task1 的核心实现：
 * 用户输入一句话（如"在 Chrome 里打开 Workbench演示笔记生成，截图存证"）→
 * LLM拆解 → 标准 ParsedGoal JSON → server端 createDevelopmentGoal 入库。
 *
 *关键设计原则（参考 v3笔记生成 + v3.3/3.4修复经验）：
 *1. Prompt 工程最简形态：版本号 +角色 +3 条必要约束 + JSON contract +原文
 *2. 不在 server端做过严校验——fallback 到 minimal goal 让用户后续手填
 *3. Prompt version独立：`goal-nlu-prompt-20260610a`，避免污染 knowledge-note harvest
 *4. 不阻塞——LLM失败 → 返回 `ok:false, fallback:true, parsed:fallbackGoal`
 * → endpoint收到后用 fallback goal继续入库（用户可后续编辑）
 *
 * PM: Mavis
 * Sprint:1
 * Created:2026-06-10
 */
import crypto from "node:crypto";
import { gatewayCall, type GatewayResult } from "./connectors/gateway.js";

export const GOAL_NLU_PROMPT_VERSION = "goal-nlu-prompt-20260610a";

/** LLM拆解出来的标准化目标结构 */
export type ParsedGoal = {
 title: string;
 objective: string;
 successCriteria: string[];
 subtasks: Array<{ key: string; title: string; kind: string }>;
 autonomyLevel: "low_risk_only" | "supervised" | "autonomous";
 riskPolicy: "low_risk_only" | "approval_required" | "review_after";
 estimatedTurns: number;
 verification: {
 kind: "desktop_screenshot" | "code_only" | "doc_only";
 targetApp?: string;
 expectedScreenshots?: number;
 };
};

export type GoalNluParseResult = {
 ok: boolean;
 /** 当 LLM 完全失败时，server仍可用 fallback goal 入库，UI提示用户后续编辑 */
 fallback?: boolean;
 parsed?: ParsedGoal;
 /** LLM原始输出（用于审计 + 用户调试） */
 rawOutput?: string;
 /** 输入自然语言的 sha256短哈希 */
 sourceHash?: string;
 /**失败原因 */
 error?: string;
 /** 本次调用的耗时（ms） */
 durationMs?: number;
};

const ALLOWED_SUBTASK_KINDS = new Set(["plan", "implement", "verify", "test", "docs"]);
const ALLOWED_AUTONOMY_LEVELS = new Set(["low_risk_only", "supervised", "autonomous"]);
const ALLOWED_RISK_POLICIES = new Set(["low_risk_only", "approval_required", "review_after"]);
const ALLOWED_VERIFICATION_KINDS = new Set(["desktop_screenshot", "code_only", "doc_only"]);

/**拼装 prompt（参考 v3 notes line6404模板，但只保留3 条约束） */
function buildGoalNluPrompt(naturalLanguage: string): string {
 return [
 `Workbench mode: development-goal-nlu; Prompt version: ${GOAL_NLU_PROMPT_VERSION}; Preferred model config: minimax-m3`,
 "你是开发目标拆解助手。把用户的自然语言开发目标拆解为可执行的工作计划。",
 "",
 "约束（只这3 条）：",
 "1. 不编造事实。原文模糊就照实写「原文未说明」。",
 "2. 子任务不超过5 个，kind 从 plan / implement / verify / test / docs 中选。",
 "3. 不强加验证方式——verification.kind 从 desktop_screenshot / code_only / doc_only 中按目标性质选最自然的一个。",
 "",
 "JSON contract:",
 JSON.stringify({
 title: "≤30 字短标题",
 objective: "≥10 字目标陈述（包含可验证标准）",
 successCriteria: ["可验证标准1", "可验证标准2"],
 subtasks: [
 { key: "stable_key", title: "子任务标题", kind: "plan|implement|verify|test|docs" }
 ],
 autonomyLevel: "low_risk_only|supervised|autonomous",
 riskPolicy: "low_risk_only|approval_required|review_after",
 estimatedTurns:3,
 verification: {
 kind: "desktop_screenshot|code_only|doc_only",
 targetApp: "可选：Chrome / Safari / 系统设置 / Workbench 等",
 expectedScreenshots:3
 }
 }, null,2),
 "",
 "用户自然语言目标:",
 naturalLanguage,
 ].filter(Boolean).join("\n");
}

/** 把 LLM输出的 markdown fence /前后空白清掉，尝试 JSON.parse */
function parseGoalNluOutput(rawText: string): { ok: boolean; parsed?: ParsedGoal; error?: string } {
 let cleaned = String(rawText || "").trim();
 //去掉 markdown code fence (```json ... ``` 或 ``` ... ```)
 cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
 // 也尝试抽取第一段 {...} JSON
 const firstBrace = cleaned.indexOf("{");
 const lastBrace = cleaned.lastIndexOf("}");
 if (firstBrace >=0 && lastBrace > firstBrace) {
 cleaned = cleaned.slice(firstBrace, lastBrace +1);
 }
 let obj: unknown;
 try {
 obj = JSON.parse(cleaned);
 } catch (err) {
 return { ok: false, error: `JSON parse failed: ${String(err)} | cleaned: ${cleaned.slice(0,200)}` };
 }
 if (!obj || typeof obj !== "object") {
 return { ok: false, error: "LLM output is not a JSON object" };
 }
 const record = obj as Record<string, unknown>;
 //软校验：title / objective必填
 if (typeof record.title !== "string" || !record.title.trim()) {
 return { ok: false, error: "missing required field: title" };
 }
 if (typeof record.objective !== "string" || !record.objective.trim()) {
 return { ok: false, error: "missing required field: objective" };
 }
 //软校验：补全缺失字段，给出 default
 const parsed: ParsedGoal = {
 title: record.title.trim().slice(0,180),
 objective: record.objective.trim().slice(0,2000),
 successCriteria: Array.isArray(record.successCriteria)
 ? record.successCriteria.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).slice(0,12).map((s) => s.trim().slice(0,500))
 : ["原文未说明"],
 subtasks: Array.isArray(record.subtasks)
 ? record.subtasks
 .filter((s): s is Record<string, unknown> => s && typeof s === "object")
 .map((s) => ({
 key: String(s.key || s.title || "subtask").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0,40),
 title: String(s.title || s.key || "子任务").trim().slice(0,200),
 kind: ALLOWED_SUBTASK_KINDS.has(String(s.kind)) ? String(s.kind) : "implement",
 }))
 .slice(0,5)
 : [],
 autonomyLevel: ALLOWED_AUTONOMY_LEVELS.has(String(record.autonomyLevel)) ? (record.autonomyLevel as ParsedGoal["autonomyLevel"]) : "supervised",
 riskPolicy: ALLOWED_RISK_POLICIES.has(String(record.riskPolicy)) ? (record.riskPolicy as ParsedGoal["riskPolicy"]) : "low_risk_only",
 estimatedTurns: Math.max(1, Math.min(12, Number(record.estimatedTurns) ||3)),
 verification: (() => {
 const v = record.verification && typeof record.verification === "object" ? record.verification as Record<string, unknown> : {};
 return {
 kind: ALLOWED_VERIFICATION_KINDS.has(String(v.kind)) ? (v.kind as ParsedGoal["verification"]["kind"]) : "code_only",
 targetApp: typeof v.targetApp === "string" ? v.targetApp.trim().slice(0,80) : undefined,
 expectedScreenshots: typeof v.expectedScreenshots === "number" ? Math.max(1, Math.min(20, Math.floor(v.expectedScreenshots))) : undefined,
 };
 })(),
 };
 return { ok: true, parsed };
}

/** LLM失败 / 输出不全时的 fallback —— 让 server仍能入库，用户后续手填 */
function fallbackGoal(naturalLanguage: string): ParsedGoal {
 const trimmed = naturalLanguage.trim();
 const firstSentence = trimmed.split(/[。\.\n]/)[0]?.trim() || trimmed;
 return {
 title: firstSentence.slice(0,30) || "用户目标",
 objective: trimmed,
 successCriteria: ["原文未说明，请补充"],
 subtasks: [],
 autonomyLevel: "supervised",
 riskPolicy: "low_risk_only",
 estimatedTurns:3,
 verification: { kind: "code_only" },
 };
}

/**
 *解析自然语言目标 → ParsedGoal
 *
 * 调用 v3 gateway agent，prompt version = GOAL_NLU_PROMPT_VERSION
 *失败时返回 fallback:true + minimal parsed，server端仍可入库
 */
export async function parseNaturalLanguageGoal(
 naturalLanguage: string,
 options: {
 agentId?: string;
 sessionKey?: string;
 timeoutMs?: number;
 } = {}
): Promise<GoalNluParseResult> {
 const text = String(naturalLanguage || "").trim();
 if (!text) {
 return { ok: false, error: "empty natural language input" };
 }
 const sourceHash = crypto.createHash("sha256").update(text).digest("hex").slice(0,16);
 const prompt = buildGoalNluPrompt(text);
 const agentId = options.agentId || process.env.OPENCLAW_WORKBENCH_NOTE_GATEWAY_AGENT || "main";
 const sessionKey = options.sessionKey || `agent:${agentId}:goal-nlu`;
 const timeoutMs = Math.max(60_000, options.timeoutMs ||240_000); //4 min default, ≥1 min floor
 const startedAt = Date.now();

 let gateway: GatewayResult<unknown>;
 try {
 gateway = await gatewayCall<unknown>(
 "agent",
 {
 agentId,
 sessionKey,
 message: prompt,
 idempotencyKey: `goal-nlu:${GOAL_NLU_PROMPT_VERSION}:${sourceHash}`,
 },
 timeoutMs,
 { expectFinal: true, skipToken: false }
 );
 } catch (err) {
 return {
 ok: false,
 fallback: true,
 rawOutput: prompt,
 sourceHash,
 error: `gateway exception: ${String(err)}`,
 durationMs: Date.now() - startedAt,
 parsed: fallbackGoal(text),
 };
 }

 if (!gateway.ok) {
 return {
 ok: false,
 fallback: true,
 rawOutput: `gateway_unavailable: ${gateway.error || "unknown"}`,
 sourceHash,
 error: `gateway unavailable: ${gateway.error}`,
 durationMs: Date.now() - startedAt,
 parsed: fallbackGoal(text),
 };
 }

 const rawOutput = extractGatewayText(gateway.data);
 const parsed = parseGoalNluOutput(rawOutput);
 if (!parsed.ok || !parsed.parsed) {
 return {
 ok: false,
 fallback: true,
 rawOutput,
 sourceHash,
 error: parsed.error,
 durationMs: Date.now() - startedAt,
 parsed: fallbackGoal(text),
 };
 }
 return {
 ok: true,
 parsed: parsed.parsed,
 rawOutput,
 sourceHash,
 durationMs: Date.now() - startedAt,
 };
}

/** 从 gateway response提取 final text（参考 index.ts:22413 extractGatewayText简化版） */
function extractGatewayText(data: unknown): string {
 if (typeof data === "string") return data.trim();
 if (!data || typeof data !== "object") return "";
 if (Array.isArray(data)) return data.map(extractGatewayText).filter(Boolean).join("\n\n").trim();
 const record = data as Record<string, unknown>;
 if (record.type === "text" && typeof record.text === "string") return record.text.trim();
 if (record.type === "thinking" && typeof record.thinking === "string") {
 return `__thinking__:${record.thinking.trim()}`;
 }
 for (const key of ["content", "message", "text", "reply", "response", "output", "result"]) {
 const value = record[key];
 if (typeof value === "string" && value.trim()) return value.trim();
 }
 if (Array.isArray(record.content)) {
 const text = record.content.map(extractGatewayText).filter(Boolean).join("\n\n").trim();
 if (text) return text;
 }
 if (Array.isArray(record.payloads)) {
 const text = record.payloads.map(extractGatewayText).filter(Boolean).join("\n\n").trim();
 if (text) return text;
 }
 if (Array.isArray(record.choices)) {
 const text = record.choices.map(extractGatewayText).filter(Boolean).join("\n\n").trim();
 if (text) return text;
 }
 for (const key of ["final", "data", "message", "result", "payload", "response", "output", "assistant", "completion", "lastMessage"]) {
 const nested = record[key];
 const text = extractGatewayText(nested);
 if (text && !text.startsWith("__thinking__:")) return text;
 }
 return "";
}

/** ParsedGoal → development_goals POST 入参（向后兼容 createDevelopmentGoal body） */
export function parsedGoalToGoalCreateBody(parsed: ParsedGoal): {
 title: string;
 objective: string;
 autonomyLevel: string;
 riskPolicy: string;
 successCriteria: string[];
 nextAction: string;
 stopConditions: string[];
 maxAutoTurns: number;
 heartbeatIntervalMinutes: number;
 tokenBudget: number | null;
} {
 return {
 title: parsed.title,
 objective: parsed.objective,
 autonomyLevel: parsed.autonomyLevel,
 riskPolicy: parsed.riskPolicy,
 successCriteria: parsed.successCriteria,
 nextAction: parsed.subtasks[0]?.title || "继续推进当前开发基线。",
 stopConditions: ["遇到阻塞停止", "质量门失败停止", "高风险动作停止"],
 maxAutoTurns: parsed.estimatedTurns,
 heartbeatIntervalMinutes:30,
 tokenBudget: null,
 };
}
