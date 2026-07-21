//!/usr/bin/env bash
// scripts/goal-nlu-smoke.mjs — Sprint1 Task1d smoke test
//
//验证 /api/development/goals/from-natural-language endpoint完整链路：
//1. health check
//2. login (auth)
//3.拿现有 development project id
//4. POST naturalLanguage → 检查返回 ok + goal + subtasks写入
//
// 用法：node --experimental-sqlite scripts/goal-nlu-smoke.mjs [BASE_URL] [PASSWORD]
// 默认：http://localhost:38888 /123456
//
// Sprint1 PM: Mavis

const BASE_URL = process.argv[2] || "http://localhost:38888";
const PASSWORD = process.argv[3] || process.env.OPENCLAW_WORKBENCH_PASSWORD || "123456";

function fail(msg) {
 console.error("FAIL:", msg);
 process.exit(1);
}

function ok(msg) {
 console.log("OK:", msg);
}

async function http(method, path, body, cookie) {
 const url = `${BASE_URL}${path}`;
 const opts = { method, headers: { "Content-Type": "application/json" } };
 if (cookie) opts.headers.Cookie = cookie;
 if (body) opts.body = JSON.stringify(body);
 const res = await fetch(url, opts);
 const text = await res.text();
 let data;
 try { data = JSON.parse(text); } catch { data = { raw: text }; }
 return { status: res.status, headers: res.headers, data };
}

async function main() {
 //1. health
 const health = await http("GET", "/api/health");
 if (health.status !==200) fail(`health check: status=${health.status}, body=${JSON.stringify(health.data)}`);
 ok(`health check (status=200)`);

 //2. login
 const login = await http("POST", "/api/auth/login", { password: PASSWORD });
 if (login.status !==200 || !login.data?.ok) fail(`login: status=${login.status}, body=${JSON.stringify(login.data)}`);
 const setCookie = login.headers.get("set-cookie") || "";
 const cookie = setCookie.split(";")[0];
 if (!cookie.includes("owb_session=")) fail(`login: no owb_session cookie, got: ${setCookie}`);
 ok(`login (got owb_session cookie)`);

 //3. list projects
 const projectsRes = await http("GET", "/api/development/projects", null, cookie);
 if (projectsRes.status !==200 || !projectsRes.data?.ok) fail(`projects: status=${projectsRes.status}, body=${JSON.stringify(projectsRes.data)}`);
 const projects = projectsRes.data?.projects || [];
 if (!Array.isArray(projects) || projects.length ===0) fail(`no development projects found`);
 const projectId = projects[0].id;
 ok(`list projects (found ${projects.length}, using ${projectId})`);

 //4. dryRun NLU (不实际创建 goal, 只看 LLM拆解结果)
 console.log("\n--- dryRun test (1-3 min wait for LLM) ---");
 const dryRun = await http("POST", "/api/development/goals/from-natural-language?dryRun=1", {
 naturalLanguage: "在 Chrome 里打开 Workbench演示笔记生成，截图存证",
 }, cookie);
 if (dryRun.status !==200 || !dryRun.data?.ok) {
 console.warn(`dryRun: status=${dryRun.status}, body=${JSON.stringify(dryRun.data)}`);
 console.warn("(LLM可能慢/不可用——继续 real create 测试，预期 fallback路径)");
 } else {
 const parse = dryRun.data?.parse;
 if (!parse) fail(`dryRun: no parse result`);
 ok(`dryRun (parsed ok=${parse.ok}, fallback=${parse.fallback}, durationMs=${parse.durationMs})`);
 if (parse.parsed) {
 console.log(" parsed:", JSON.stringify(parse.parsed, null,2).slice(0,500));
 }
 }

 //5. real create — 用 dryRun 的结果（如果可用）或 直接调
 console.log("\n--- real create test ---");
 const real = await http("POST", "/api/development/goals/from-natural-language", {
 naturalLanguage: "在 Chrome 里打开 Workbench演示笔记生成，截图存证",
 projectId,
 }, cookie);
 if (real.status !==200 || !real.data?.ok) fail(`real create: status=${real.status}, body=${JSON.stringify(real.data)}`);
 const goal = real.data?.goal;
 if (!goal?.id) fail(`real create: no goal.id in response`);
 ok(`real create (goalId=${goal.id}, title="${goal.title?.slice(0,40)}", status=${goal.status})`);

 //6. fetch goal back via operating-snapshot（基础 GET by id 不存在,用 sub-resource）
 const detail = await http("GET", `/api/development/goals/${goal.id}/operating-snapshot`, null, cookie);
 if (detail.status !==200) fail(`get goal operating-snapshot: status=${detail.status}`);
 ok(`get goal operating-snapshot (status=200)`);

 //7. subtasks列表 from evidence（解析 JSON evidence字段）
 const evidence = goal.evidence;
 let subtasksFound = [];
 try {
 const arr = JSON.parse(evidence || "[]");
 for (const line of arr) {
 if (typeof line === "string" && line.startsWith("[goal-nlu] subtasks:")) {
 subtasksFound.push(line);
 }
 }
 } catch {}
 if (subtasksFound.length ===0) {
 console.warn("WARN: no [goal-nlu] subtasks entry in evidence (LLM可能没产出 subtasks)");
 } else {
 ok(`subtasks in evidence: ${subtasksFound[0].slice(0,120)}...`);
 }

 console.log("\n=== Sprint1 Task1 smoke test PASS ===");
 console.log(`goalId: ${goal.id}`);
 console.log(`projectId: ${projectId}`);
 console.log(`fallback: ${real.data?.parse?.fallback === true}`);
 console.log(`durationMs: ${real.data?.durationMs}`);
}

main().catch((err) => {
 console.error("EXCEPTION:", err);
 process.exit(1);
});
