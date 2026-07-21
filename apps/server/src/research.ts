import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SIDECAR_DIR, nowIso, safeName } from "./config.js";
import type { KnowledgeHit, KnowledgeSource } from "./connectors/knowledge.js";
import { searchKnowledge } from "./connectors/knowledge.js";
import { writeHtmlDocument } from "./docRenderer.js";

export type ResearchInput = {
  title: string;
  question: string;
  sources: KnowledgeSource[];
  formats: string[];
};

export async function runResearch(input: ResearchInput) {
  const id = randomUUID();
  const folder = path.join(SIDECAR_DIR, "research", `${nowIso().slice(0, 10)}_${safeName(input.title)}_${id.slice(0, 8)}`);
  fs.mkdirSync(folder, { recursive: true });
  const hits = await searchKnowledge(input.question, input.sources);
  const reportPath = path.join(folder, "research.md");
  const mindmapPath = path.join(folder, "mindmap.md");
  const reportMarkdown = buildReport(input, hits);
  const mindmapMarkdown = buildMindmap(input, hits);
  fs.writeFileSync(reportPath, reportMarkdown, "utf8");
  fs.writeFileSync(mindmapPath, mindmapMarkdown, "utf8");
  const reportHtmlPath = path.join(folder, "research.html");
  const mindmapHtmlPath = path.join(folder, "mindmap.html");
  writeHtmlDocument(reportMarkdown, reportHtmlPath, { title: input.title, sourcePath: reportPath, documentType: "deep_research_report" });
  writeHtmlDocument(mindmapMarkdown, mindmapHtmlPath, { title: `${input.title} Mindmap`, sourcePath: mindmapPath, documentType: "deep_research_mindmap" });
  const sidecarPath = path.join(folder, "sidecar.md");
  const sidecarMarkdown = buildSidecar(input, { id, reportPath, mindmapPath, hits });
  fs.writeFileSync(sidecarPath, sidecarMarkdown, "utf8");
  const sidecarHtmlPath = path.join(folder, "sidecar.html");
  writeHtmlDocument(sidecarMarkdown, sidecarHtmlPath, { title: `${input.title} Sidecar`, sourcePath: sidecarPath, documentType: "deep_research_sidecar" });
  return {
    id,
    outputDir: folder,
    reportPath,
    reportHtmlPath,
    mindmapPath,
    mindmapHtmlPath,
    sidecarPath,
    sidecarHtmlPath,
    pptPath: null,
    notes: "completed: md,mindmap,html; ppt/audio/video not_integrated",
  };
}

function buildReport(input: ResearchInput, hits: KnowledgeHit[]) {
  const refs = hits.map((h, i) => `${i + 1}. [${h.source}] ${h.title}${h.path ? ` - ${h.path}` : ""}\n   ${h.snippet}`).join("\n");
  return `---
type: deep_research
created: ${nowIso()}
status: completed
sources: [${input.sources.join(", ")}]
formats: [${input.formats.join(", ")}]
---

# ${input.title}

## Research Question
${input.question}

## Executive Summary
This source-grounded draft aggregates available OpenClaw memory, NAS and IMA search results for follow-up agent work.

## Key Findings
${hits.length ? hits.slice(0, 8).map((h) => `- ${h.snippet}`).join("\n") : "- No matching source snippets were found. The task is queued for deeper agent research."}

## Source Notes
${refs || "No source hits."}

## Next Actions
- Ask boss agent to critique the findings.
- Ask worker agent to expand the report with source-specific follow-up.
- PPT、音频、视频生成链路未接入，需在后续批处理能力完成后再启用。
`;
}

function buildMindmap(input: ResearchInput, hits: KnowledgeHit[]) {
  const groups = new Map<string, KnowledgeHit[]>();
  for (const hit of hits) groups.set(hit.source, [...(groups.get(hit.source) || []), hit]);
  const branches = [...groups.entries()].map(([source, rows]) => {
    const children = rows.slice(0, 5).map((h) => `    ${h.title.replace(/[:\n]/g, " ").slice(0, 60)}`).join("\n");
    return `  ${source}\n${children}`;
  }).join("\n");
  return `# ${input.title}

\`\`\`markmap
# ${input.title}
## 问题
${input.question}
## 来源
${branches || "  待补充"}
## 下一步
  Boss critique
  Worker expansion
  PPT/audio/video not integrated
\`\`\`
`;
}

function buildSidecar(input: ResearchInput, result: { id: string; reportPath: string; mindmapPath: string; pptPath?: string; hits: KnowledgeHit[] }) {
  return `---
type: workbench_research_sidecar
id: ${result.id}
created: ${nowIso()}
status: completed
source_count: ${result.hits.length}
agent_scope: [main, boss, worker]
---

# ${input.title} Sidecar

- Question: ${input.question}
- Report: ${result.reportPath}
- Mindmap: ${result.mindmapPath}
- PPT: not_integrated
- Sources: ${input.sources.join(", ")}
`;
}
