import fs from "node:fs";

const jobsPath = "/Users/njx/.openclaw/cron/jobs.json";
const now = Date.now();
const backupPath = `/Users/njx/openclaw/copilot/tasks/openclaw/20260630-knowledge-mirror-continuation/jobs.backup.${now}.json`;

const message = `硬性执行约束：
1. 你必须且只能调用一次 exec 工具。
2. exec 参数必须显式使用 host="node"，node="9c1b676e90d7860c8fc20c8a37672ba2d95ac1b0ec5c68230a5334da1b251425"。
3. 禁止使用 host="sandbox"、host="gateway"、默认 host、~/ 路径、管道、重定向、分号、后台执行或额外 shell 包装。
4. command 必须精确等于：/Users/njx/openclaw/copilot/scripts/openclaw-knowledge-worker-ro.sh cron-mirror
5. 如果工具 schema 无法指定 host/node，或返回 requested sandbox、requested gateway、host not allowed、no paired node、node invoke timed out、approval required，最终必须输出 CRON_STATUS=ERROR 和原始原因，不得包装为成功。

执行 copilot-daily-mirror 增量双备份兜底。
范围：只扫 notes/ 白名单子目录 daily/calendar/voice_raw/mobile_audio/openclaw/worker_runs 到 NAS /Volumes/南极熊/07知识库/copilot_knowledge_mirror/。
禁止：不删源、不 prune、不改 Knowledge UI、不调用外部发送。
成功必须输出 CRON_STATUS=OK 和 mirror_knowledge.py JSON summary。`;

function main() {
  const raw = fs.readFileSync(jobsPath, "utf-8");
  fs.mkdirSync("/Users/njx/openclaw/copilot/tasks/openclaw/20260630-knowledge-mirror-continuation", { recursive: true });
  fs.writeFileSync(backupPath, raw, "utf-8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.jobs)) data.jobs = [];

  const old = data.jobs.find((job) => job.id === "auto-voice-note-yuanbao-batch");
  if (old) {
    old.enabled = false;
    const suffix = "[DISABLED 2026-06-30: replaced by yuanbaoSync.ts + copilot-daily-mirror direct wrapper]";
    old.description = String(old.description || "短期元宝 UI 自动化。");
    if (!old.description.includes("replaced by yuanbaoSync.ts")) old.description = `${old.description} ${suffix}`;
    old.updatedAtMs = now;
  }

  let job = data.jobs.find((item) => item.id === "copilot-daily-mirror");
  if (!job) {
    job = { id: "copilot-daily-mirror", createdAtMs: now, state: {} };
    data.jobs.push(job);
  }
  Object.assign(job, {
    agentId: "worker",
    name: "copilot-daily-mirror 增量双备份兜底",
    enabled: true,
    description: "2026-06-30: 每小时第 5 分钟通过受控 wrapper 增量镜像 Workbench notes 白名单子目录到 NAS；替代旧元宝 UI 自动化兜底。",
    schedule: { kind: "cron", expr: "5 * * * *", tz: "Asia/Shanghai" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    delivery: { mode: "none" },
    payload: {
      kind: "agentTurn",
      message,
      model: "minimax/MiniMax-M3",
      timeoutSeconds: 600,
      toolsAllow: ["exec"],
    },
    updatedAtMs: now,
  });

  fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(JSON.stringify({
    ok: true,
    jobsPath,
    backupPath,
    oldCronDisabled: Boolean(old && old.enabled === false),
    copilotDailyMirrorEnabled: job.enabled === true,
    schedule: job.schedule,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
}
