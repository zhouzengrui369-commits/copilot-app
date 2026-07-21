import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type HtmlRenderResult = {
  title: string;
  html: string;
  sourceHash: string;
  renderedAt: string;
  toc: Array<{ id: string; level: number; text: string }>;
};

export type HtmlSidecarResult = Omit<HtmlRenderResult, "html"> & {
  sourcePath?: string;
  htmlPath: string;
  sourceMtime?: string;
};

type RenderOptions = {
  title?: string;
  sourcePath?: string;
  documentType?: string;
  badge?: string;
};

export function renderMarkdownDocument(markdown: string, options: RenderOptions = {}): HtmlRenderResult {
  const sourceHash = sha256(markdown);
  const renderedAt = new Date().toISOString();
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (options.documentType === "knowledge-note") return renderKnowledgeNoteDocument(markdown, options, frontmatter, body, sourceHash, renderedAt);
  const title = options.title || firstHeading(body) || path.basename(options.sourcePath || "document.md");
  const toc: Array<{ id: string; level: number; text: string }> = [];
  const content = renderMarkdownBody(body, toc);
  const tocHtml = toc.length
    ? `<nav class="doc-toc" aria-label="目录"><strong>目录</strong>${toc.map((item) => `<a class="toc-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`).join("")}</nav>`
    : `<nav class="doc-toc empty"><strong>目录</strong><span>无标题结构</span></nav>`;
  const frontmatterHtml = frontmatter
    ? `<details class="doc-meta"><summary>YAML metadata</summary><pre>${escapeHtml(frontmatter)}</pre></details>`
    : "";
  const sourcePath = options.sourcePath ? `<span>Source: <code>${escapeHtml(options.sourcePath)}</code></span>` : "";
  const badge = options.badge || options.documentType || "HTML interaction layer";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${sourceHash}">
  <meta name="rendered-at" content="${renderedAt}">
  <title>${escapeHtml(title)}</title>
  <style>${documentCss()}</style>
</head>
<body>
  <header class="doc-header">
    <div>
      <span class="doc-badge">${escapeHtml(badge)}</span>
      <h1>${escapeHtml(title)}</h1>
      <p class="doc-subtitle">可信源保持 Markdown/YAML/JSON/SQLite；本页是安全 HTML 交互层。</p>
    </div>
    <div class="doc-facts">
      ${sourcePath}
      <span>Hash: <code>${sourceHash.slice(0, 16)}</code></span>
      <span>Rendered: <time>${renderedAt}</time></span>
    </div>
  </header>
  <main class="doc-shell">
    <aside>${tocHtml}${frontmatterHtml}</aside>
    <article class="doc-content">${content}</article>
  </main>
</body>
</html>`;
  return { title, html, sourceHash, renderedAt, toc };
}

function renderKnowledgeNoteDocument(markdown: string, options: RenderOptions, frontmatter: string, body: string, sourceHash: string, renderedAt: string): HtmlRenderResult {
  const title = options.title || firstHeading(body) || path.basename(options.sourcePath || "knowledge-note.md");
  const toc: Array<{ id: string; level: number; text: string }> = [];
  const displayBody = stripKnowledgeRawSection(body);
  const content = renderMarkdownBody(displayBody, toc);
  const meta = parseSimpleFrontmatter(frontmatter);
  const layoutStrategy = parseKnowledgeHtmlStrategy(meta.html_strategy);
  const tags = parseYamlList(meta.tags);
  const related = parseYamlList(meta.related);
  const infoMap = extractKnowledgeInfoMap(body);
  const rawPreview = sanitizeKnowledgeRawPreview(extractSectionText(body, "原始记录")).slice(0, 2800);
  const summaryItems = extractKnowledgeSummaryItems(body, String(meta.type || options.documentType || ""), 5);
  const referenceItems = extractKnowledgeSectionItems(body, ["参会信息", "学习档案", "内容理解"], 4);
  const actionItems = extractKnowledgeSectionItems(body, ["后续行动", "行动项", "下一步"], 4);
  const verificationItems = extractKnowledgeSectionItems(body, ["待核验事项", "问题与风险", "风险"], 4);
  const evidenceItems = extractKnowledgeSectionItems(body, ["关键结论", "课程主线", "核心议题", "议题与要点", "发言脉络", "学习地图"], 5);
  const typeLabel = meta.type || options.documentType || "knowledge-note";
  const statusLabel = meta.status || "unknown";
  const dateLabel = meta.date || renderedAt.slice(0, 10);
  const brief = buildKnowledgeBriefing({
    title,
    meta,
    infoMap,
    tags,
    related,
    summaryItems,
    actionItems,
    verificationItems,
    evidenceItems,
    body,
  });
  const evidenceBriefItems = buildBriefEvidence(evidenceItems, body);
  const summaryLead = brief.lead;
  const summaryText = brief.summary;
  const heroCopy = layoutStrategy?.hero || brief.hero;
  const sourceLabel = options.sourcePath ? path.basename(options.sourcePath) : "Markdown 可信源";
  const statCards = layoutStrategy?.summaryCards?.length
    ? layoutStrategy.summaryCards.map((card) => noteStatCard(card.label, card.value, card.note))
    : [
      noteStatCard("主题", brief.keywords[0] || stripMarkdownSyntax(String(infoMap["主题"] || title)).slice(0, 12), brief.keywords.slice(1, 4).join(" / ") || "核心线索"),
      noteStatCard("行动", String(brief.actions.length), brief.actions.slice(0, 2).join(" / ") || "无明确行动"),
      noteStatCard("章节", String(toc.length), toc.slice(0, 3).map((item) => item.text).join(" / ") || "无标题"),
      noteStatCard("来源", sourceHash.slice(0, 8), "source-hash"),
    ];
  const strategySidebar = layoutStrategy?.sidebarBlocks?.map((block) => `<section class="side-card strategy-card"><strong>${escapeHtml(block.title)}</strong><ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`).join("") || "";
  const primarySections = layoutStrategy?.primarySections?.length
    ? `<section class="side-card strategy-card"><strong>重点阅读</strong><div class="chip-row">${layoutStrategy.primarySections.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></section>`
    : "";
  const heroClass = layoutStrategy?.visualEmphasis ? ` note-hero-${safeCssToken(layoutStrategy.visualEmphasis)}` : "";
  const tocHtml = toc.length
    ? toc.map((item) => `<a class="toc-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`).join("")
    : "<span>无目录</span>";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${sourceHash}">
  <meta name="rendered-at" content="${renderedAt}">
  <title>${escapeHtml(title)}</title>
  <style>${knowledgeNoteCss()}</style>
</head>
<body class="knowledge-note-body">
  <header class="note-hero${heroClass}">
    <div class="hero-copy">
      <span class="doc-badge">${escapeHtml(options.badge || "Knowledge Note Interaction Document")}</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(heroCopy)}</p>
      <div class="hero-pills">
        <span>${escapeHtml(typeLabel)}</span>
        <span>${escapeHtml(statusLabel)}</span>
        <span>${escapeHtml(dateLabel)}</span>
      </div>
    </div>
    <div class="note-status">
      <span>来源校验</span>
      <strong>${escapeHtml(sourceLabel)}</strong>
      <small>${escapeHtml(options.sourcePath || "inline markdown")}</small>
      <div class="source-checks">
        <span>source-hash · ${escapeHtml(sourceHash.slice(0, 12))}</span>
        <span>rendered · ${escapeHtml(renderedAt.slice(0, 19).replace("T", " "))}</span>
      </div>
    </div>
  </header>
  <main class="note-shell">
    <section class="briefing-grid knowledge-note-dashboard" aria-label="知识首屏摘要">
      <section class="briefing-card briefing-lead decision-panel">
        <span>知识简报</span>
        <h2>${escapeHtml(summaryLead)}</h2>
        <p>${escapeHtml(summaryText)}</p>
        <dl class="brief-facts">
          <div><dt>类型</dt><dd>${escapeHtml(typeLabel)}</dd></div>
          <div><dt>状态</dt><dd>${escapeHtml(statusLabel)}</dd></div>
          <div><dt>日期</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        </dl>
      </section>
      <section class="briefing-card queue-card">
        <span>行动队列</span>
        ${renderBriefList(brief.actions)}
      </section>
      <section class="briefing-card queue-card risk-card">
        <span>待核验</span>
        ${renderBriefList(brief.risks)}
      </section>
    </section>
    <section class="insight-strip" aria-label="知识指标">
      ${statCards.join("")}
    </section>
    <section class="actionbar" aria-label="文档入口">
      <a href="#note-content" class="action primary">阅读正文</a>
      ${evidenceItems.length ? `<a href="#note-evidence" class="action">查看证据</a>` : ""}
      <a href="#note-meta" class="action">查看元数据</a>
      ${rawPreview ? `<a href="#raw-source" class="action">原始记录</a>` : ""}
      <span class="action muted-action">浏览器菜单可打印</span>
    </section>
    <section class="note-grid">
      <aside class="note-side">
        <section class="side-card">
          <strong>目录</strong>
          <nav class="doc-toc" aria-label="目录">${tocHtml}</nav>
        </section>
        <section class="side-card" id="note-meta">
          <strong>元数据</strong>
          ${frontmatter ? `<pre>${escapeHtml(frontmatter)}</pre>` : "<p>无 frontmatter。</p>"}
        </section>
        ${tags.length ? `<section class="side-card"><strong>标签</strong><div class="chip-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>` : ""}
        ${related.length ? `<section class="side-card"><strong>关联</strong><div class="chip-row related">${related.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></section>` : ""}
        ${primarySections}
        ${strategySidebar}
      </aside>
      <section class="note-main">
      ${referenceItems.length ? `<section class="summary-card"><h2>资料卡</h2>${renderBriefList(referenceItems)}</section>` : ""}
        ${evidenceBriefItems.length ? `<section class="summary-card evidence-card" id="note-evidence"><h2>关键依据</h2>${renderBriefList(evidenceBriefItems)}</section>` : ""}
        <article id="note-content" class="doc-content">${content}</article>
        ${rawPreview ? `<details class="raw-preview" id="raw-source"><summary>原始记录预览</summary><pre>${escapeHtml(rawPreview)}</pre></details>` : ""}
      </section>
    </section>
  </main>
</body>
</html>`;
  return { title, html, sourceHash, renderedAt, toc };
}

export function writeHtmlDocument(markdown: string, htmlPath: string, options: RenderOptions = {}): HtmlSidecarResult {
  const rendered = renderMarkdownDocument(markdown, options);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, rendered.html, "utf8");
  const sourceMtime = options.sourcePath && fs.existsSync(options.sourcePath)
    ? fs.statSync(options.sourcePath).mtime.toISOString()
    : undefined;
  return { title: rendered.title, htmlPath, sourcePath: options.sourcePath, sourceHash: rendered.sourceHash, renderedAt: rendered.renderedAt, toc: rendered.toc, sourceMtime };
}

export function writeHtmlSidecar(sourcePath: string, htmlPath = defaultHtmlPath(sourcePath), options: RenderOptions = {}): HtmlSidecarResult {
  const markdown = fs.readFileSync(sourcePath, "utf8");
  return writeHtmlDocument(markdown, htmlPath, { ...options, sourcePath });
}

export function renderDocumentIndex(input: { title: string; sections: Array<{ title: string; body: string; sourcePath?: string }> }) {
  const markdown = [
    `# ${input.title}`,
    "",
    ...input.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      section.sourcePath ? `Source: \`${section.sourcePath}\`` : "",
      "",
      section.body || "无内容。",
      "",
    ]),
  ].join("\n");
  return renderMarkdownDocument(markdown, { title: input.title, documentType: "index" });
}

export function defaultHtmlPath(sourcePath: string) {
  const ext = path.extname(sourcePath);
  return sourcePath.slice(0, sourcePath.length - ext.length) + ".html";
}

function splitFrontmatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: "", body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

function firstHeading(markdown: string) {
  return markdown.split(/\r?\n/).map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim()).find(Boolean);
}

function renderMarkdownBody(markdown: string, toc: Array<{ id: string; level: number; text: string }>) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let listOpen: "ul" | "ol" | null = null;
  let code: { language: string; lines: string[] } | null = null;

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push(`</${listOpen}>`);
    listOpen = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      if (code) {
        html.push(renderCodeBlock(code.language, code.lines.join("\n")));
        code = null;
      } else {
        closeParagraph();
        closeList();
        code = { language: line.trim().replace(/^```/, "").trim(), lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    if (isMarkdownTable(lines, index)) {
      closeParagraph();
      closeList();
      const headers = splitMarkdownTableRow(line);
      let rowIndex = index + 2;
      const rows: string[][] = [];
      while (rowIndex < lines.length && lines[rowIndex].trim().includes("|") && !isMarkdownTableDivider(lines[rowIndex])) {
        rows.push(splitMarkdownTableRow(lines[rowIndex]));
        rowIndex += 1;
      }
      html.push(renderTable(headers, rows));
      index = rowIndex - 1;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = uniqueSlug(text, toc);
      toc.push({ id, level, text });
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      closeParagraph();
      const type = unordered ? "ul" : "ol";
      if (listOpen !== type) {
        closeList();
        html.push(`<${type}>`);
        listOpen = type;
      }
      html.push(`<li>${renderInline((unordered || ordered)?.[1] || "")}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  if (code) html.push(renderCodeBlock(code.language, code.lines.join("\n")));
  return html.join("\n");
}

function renderCodeBlock(language: string, code: string) {
  const normalized = language.toLowerCase().trim();
  if (normalized === "markmap") return renderStaticMarkmap(code);
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

type StaticMindmapNode = { title: string; level: number; children: StaticMindmapNode[] };

function renderStaticMarkmap(code: string) {
  const roots: StaticMindmapNode[] = [];
  const stack: StaticMindmapNode[] = [];
  const addNode = (level: number, title: string) => {
    const clean = stripMarkdownSyntax(title).replace(/\s+/g, " ").trim();
    if (!clean || clean === "---") return;
    const node: StaticMindmapNode = { title: clean.slice(0, 180), level, children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  };

  for (const rawLine of String(code || "").split(/\r?\n/).slice(0, 180)) {
    const line = rawLine.replace(/\t/g, "  ");
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      addNode(heading[1].length, heading[2]);
      continue;
    }
    const list = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (list) {
      addNode(2 + Math.floor(list[1].length / 2), list[2]);
      continue;
    }
    const keyValue = line.match(/^\s*([A-Za-z0-9_\u4e00-\u9fa5 -]{2,36})[:：]\s*(.+)$/);
    if (keyValue && stack.length) addNode(stack[stack.length - 1].level + 1, `${keyValue[1]}：${keyValue[2]}`);
  }

  if (!roots.length) return `<pre><code>${escapeHtml(code)}</code></pre>`;
  const renderNodes = (nodes: StaticMindmapNode[]): string => `<ul>${nodes.map((node) => `<li><span>${escapeHtml(node.title)}</span>${node.children.length ? renderNodes(node.children) : ""}</li>`).join("")}</ul>`;
  return `<section class="static-mindmap" aria-label="思维导图预览">${renderNodes(roots)}</section>`;
}

function isMarkdownTable(lines: string[], index: number) {
  const current = lines[index] || "";
  const next = lines[index + 1] || "";
  return current.trim().startsWith("|") && current.includes("|") && isMarkdownTableDivider(next);
}

function isMarkdownTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
}

function splitMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(headers: string[], rows: string[][]) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${renderInline(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${renderInline(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function parseSimpleFrontmatter(frontmatter: string) {
  const result: Record<string, string> = {};
  for (const line of String(frontmatter || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function parseYamlList(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fallback to a compact YAML-ish parser below.
  }
  return raw.replace(/^\[|\]$/g, "").split(/[,，]/).map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function parseKnowledgeHtmlStrategy(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      hero?: unknown;
      summaryCards?: unknown;
      sidebarBlocks?: unknown;
      primarySections?: unknown;
      visualEmphasis?: unknown;
    };
    const summaryCards = Array.isArray(parsed.summaryCards)
      ? parsed.summaryCards.map((item) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          label: safeStrategyText(record.label, 24),
          value: safeStrategyText(record.value, 36),
          note: safeStrategyText(record.note, 80),
        };
      }).filter((card) => card.label && card.value).slice(0, 4)
      : [];
    const sidebarBlocks = Array.isArray(parsed.sidebarBlocks)
      ? parsed.sidebarBlocks.map((item) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const items = Array.isArray(record.items) ? record.items.map((row) => safeStrategyText(row, 72)).filter(Boolean).slice(0, 8) : [];
        return { title: safeStrategyText(record.title, 32), items };
      }).filter((block) => block.title && block.items.length).slice(0, 3)
      : [];
    const primarySections = Array.isArray(parsed.primarySections) ? parsed.primarySections.map((item) => safeStrategyText(item, 48)).filter(Boolean).slice(0, 8) : [];
    return {
      hero: safeStrategyText(parsed.hero, 180),
      summaryCards,
      sidebarBlocks,
      primarySections,
      visualEmphasis: safeStrategyText(parsed.visualEmphasis, 80),
    };
  } catch {
    return null;
  }
}

function safeStrategyText(input: unknown, maxLength: number) {
  return String(input || "")
    .replace(/[<>{}`$]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeCssToken(input: string) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "default";
}

function extractSectionText(markdown: string, headingText: string) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{2,4}\\s+${escapeRegExp(headingText)}\\s*$`).test(line.trim()));
  if (start < 0) return "";
  const output: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    const clean = lines[index].trim();
    if (clean && !clean.startsWith("|---")) output.push(clean);
  }
  return output.join(" ");
}

function stripKnowledgeRawSection(markdown: string) {
  return String(markdown || "").replace(/\n##\s*原始记录[\s\S]*$/i, "").trim();
}

function sanitizeKnowledgeRawPreview(value: string) {
  const text = String(value || "");
  if (!text.trim()) return "";
  const cleaned = text
    .replace(/```text|```/g, " ")
    .replace(/(?:我操|卧槽|他妈的|他妈|妈的|尼玛|傻逼|牛逼)/g, "[口语情绪词已省略]")
    .replace(/\b(?:呃|嗯|啊)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `原始记录保留在 Markdown 可信源中。以下为净化预览：${cleaned}`;
}

function compactText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").replace(/\|/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

function firstMeaningfulLine(value: string) {
  return stripMarkdownSyntax(value)
    .split(/[。！？!?]\s*|\n+/)
    .map((line) => line.trim())
    .filter((line) => !/^项\s+结果/.test(line) && !/^主题\s+类型\s+状态/.test(line))
    .find((line) => line.length >= 8)
    ?.slice(0, 80) || "";
}

function stripMarkdownSyntax(value: string) {
  return String(value || "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]]+)]]/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKnowledgeBriefing(input: {
  title: string;
  meta: Record<string, string>;
  infoMap: Record<string, string>;
  tags: string[];
  related: string[];
  summaryItems: string[];
  actionItems: string[];
  verificationItems: string[];
  evidenceItems: string[];
  body: string;
}) {
  const type = input.meta.type || input.infoMap["类型"] || "知识笔记";
  const status = input.meta.status || input.infoMap["状态"] || "待核验";
  const topic = cleanKnowledgeTitle(input.infoMap["主题"] || input.title);
  const keywords = extractKnowledgeKeywords(input);
  const signalText = keywords.slice(0, 5).join("、") || topic;
  const isMeeting = /会议|纪要|谈话|记录/.test(type);
  const isLearning = /学习|课程|笔记/.test(type);
  const isDecision = /决策|评审|战略|方案/.test(type);
  const summary = isMeeting
    ? `这是一份围绕 ${topic} 的会议纪要，首屏聚焦 ${signalText} 等可执行线索。原始转写保留在正文下方，便于回听校对；当前应优先确认责任人、时间点和跨部门依赖。`
    : isLearning
      ? `这是一份围绕 ${topic} 的学习笔记，首屏先呈现主题框架、核心模型和可迁移方法。详细概念、案例和原始材料保留在正文中，便于复盘与二次加工。`
      : isDecision
        ? `这是一份围绕 ${topic} 的决策型知识记录，首屏优先展示结论、依据、风险和后续动作。需要核验的材料保留在正文与来源区，避免未经确认的信息覆盖旧事实。`
        : `这是一份围绕 ${topic} 的知识记录，首屏提炼主题、状态和后续动作，正文保留完整来源与结构化内容。`;
  const hero = `${topic} · ${type} · ${status}。重点关注：${signalText}。`;
  return {
    lead: topic,
    summary: compactText(summary, 330),
    hero: compactText(hero, 220),
    keywords,
    actions: buildBriefActions(input.actionItems, input.summaryItems, input.body),
    risks: buildBriefRisks(input.verificationItems, input.body),
  };
}

function cleanKnowledgeTitle(value: string) {
  return stripMarkdownSyntax(String(value || "知识笔记"))
    .replace(/\.(md|markdown|html|txt)$/i, "")
    .replace(/^\d{8}[_-]?/, "")
    .replace(/[_-]?[a-f0-9]{6,12}$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "知识笔记";
}

function extractKnowledgeKeywords(input: {
  title: string;
  meta: Record<string, string>;
  infoMap: Record<string, string>;
  tags: string[];
  related: string[];
  summaryItems: string[];
  body: string;
}) {
  const candidates = [
    ...input.tags,
    ...input.related.map((item) => item.replace(/^\[\[|\]\]$/g, "")),
    ...String(input.infoMap["核心实体"] || "").split(/\s+/),
    ...extractDomainSignals(`${input.title}\n${input.summaryItems.join("\n")}\n${input.body}`),
  ]
    .map(cleanKnowledgeKeyword)
    .filter(Boolean)
    .filter((item) => !/^(task|project|knowledge|AI工具|会议纪要|工作记录|学习笔记|仅供参考|待跟进|已完成)$/i.test(item));
  return uniqueList(candidates).slice(0, 8);
}

function cleanKnowledgeKeyword(value: string) {
  return stripMarkdownSyntax(String(value || ""))
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/^(这是|这个|那个|现在|我们|你们|他们|一个|有一个)/, "")
    .trim()
    .slice(0, 24);
}

function extractDomainSignals(text: string) {
  const clean = stripMarkdownSyntax(text);
  const signals = new Set<string>();
  const fixedPatterns = [
    /AOG项目/gi,
    /ITP/gi,
    /GPS/gi,
    /库房监控/g,
    /航材采购/g,
    /外站/g,
    /账号/g,
    /协议/g,
    /付款说明/g,
    /生产运作管理/g,
    /供应链管理/g,
    /质量控制/g,
    /竞争战略/g,
    /账期/g,
  ];
  for (const pattern of fixedPatterns) {
    for (const match of clean.matchAll(pattern)) signals.add(match[0].toUpperCase() === match[0] ? match[0] : match[0]);
  }
  for (const match of clean.matchAll(/\b[A-Z][A-Z0-9_-]{1,12}\b/g)) signals.add(match[0]);
  return Array.from(signals);
}

function buildBriefActions(actionItems: string[], summaryItems: string[], body: string) {
  const pool = uniqueList([...actionItems, ...summaryItems]).map((item) => cleanKnowledgeSentence(item)).filter(Boolean);
  const rewritten = pool
    .filter((item) => !/行动项.*责任方.*截止/.test(item))
    .map((item) => rewriteActionCue(item))
    .filter(Boolean);
  const actions = uniqueList(rewritten);
  if (actions.length >= 2) return actions.slice(0, 4);
  const source = `${pool.join(" ")} ${body}`;
  const inferred = [
    /协议|付款|账户|负责人|回复/.test(source) ? "跟进协议、付款说明和账户信息，确认对方负责人回复。" : "",
    /ITP|航站|外站|发布|空白|ID/.test(source) ? "复核 ITP/外站发布字段，确认空白信息是否影响航材发布。" : "",
    /库房|监控|房间号|账号/.test(source) ? "向 IT 提供库房房间号和账号，推进监控权限开通。" : "",
    /GPS|充电|设备|教程|编号|数据表/.test(source) ? "排查 GPS 设备充电与使用状态，建立编号和使用数据记录。" : "",
    /项目|目标|计划|路径|阶段|预算|成本/.test(source) ? "明确项目目标、阶段路径、预算评估和推广计划。" : "",
  ].filter(Boolean);
  const merged = uniqueList([...actions, ...inferred]);
  return merged.length ? merged.slice(0, 4) : ["复核原始记录中的专名、数字和责任人。", "将确认后的结论沉淀为可复用知识卡片。"];
}

function rewriteActionCue(item: string) {
  if (/BSC|BSU|EBPSU|芯片/i.test(item)) return "确认 BSC/BSU/EBPSU 等缩写含义和芯片采购可行性。";
  if (/协议|付款|账户|负责人|回复/.test(item)) return "跟进协议、付款说明和账户信息，确认对方负责人回复。";
  if (/ITP|航站|外站|发布|空白|ID/.test(item)) return "复核 ITP/外站发布字段，确认空白信息是否影响航材发布。";
  if (/库房|监控|房间号|账号/.test(item)) return "向 IT 提供库房房间号和账号，推进监控权限开通。";
  if (/GPS|充电|设备|教程|编号|数据表/.test(item)) return "排查 GPS 设备充电与使用状态，建立编号和使用数据记录。";
  if (/项目|目标|计划|路径|阶段|预算|成本/.test(item)) return "明确项目目标、阶段路径、预算评估和推广计划。";
  if (item.length >= 12 && item.length <= 90 && !isNoisyTranscriptLine(item)) return item;
  return "";
}

function buildBriefEvidence(evidenceItems: string[], body: string) {
  const source = `${evidenceItems.join(" ")} ${body}`;
  const inferred = [
    /协议|付款|账户|负责人|回复/.test(source) ? "协议事项已进入付款说明、账户信息和负责人回复跟进阶段。" : "",
    /ITP|航站|外站|发布|空白|ID/.test(source) ? "ITP 外站发布已推进，空白字段需复核其影响范围。" : "",
    /库房|监控|房间号|账号/.test(source) ? "库房监控试点依赖房间号、账号和 IT 权限开通。" : "",
    /GPS|充电|设备|教程|编号|数据表/.test(source) ? "GPS 设备使用存在充电、教程、编号和数据采集问题。" : "",
    /项目|目标|计划|路径|阶段|预算|成本/.test(source) ? "项目下一阶段需要明确目标、路径、预算与规模评估。" : "",
  ].filter(Boolean);
  const cleanItems = evidenceItems
    .map((item) => cleanKnowledgeSentence(item))
    .filter((item) => item && !isNoisyTranscriptLine(item))
    .filter((item) => !/^(主题|类型|状态|逻辑结构|核心实体|行动项)/.test(item))
    .slice(0, 2);
  return uniqueList([...inferred, ...cleanItems]).slice(0, 5);
}

function buildBriefRisks(verificationItems: string[], body: string) {
  const risks = uniqueList(verificationItems.map((item) => cleanKnowledgeSentence(item)).filter((item) => item && !isNoisyTranscriptLine(item)));
  const inferred = [
    /待确认|没确认|还没确认|未确认/.test(body) ? "存在未确认信息，需补齐责任人、范围和截止时间。" : "",
    /转写|原始记录|00:\d{2}/.test(body) ? "自动转写内容需要抽样回听，避免专名、数字和缩写误识别。" : "",
    /南京|浦东|虹桥|外站/.test(body) ? "跨站点信息需要分别核对，避免把单站结论泛化到全部场景。" : "",
  ].filter(Boolean);
  const merged = uniqueList([...risks, ...inferred]);
  return merged.length ? merged.slice(0, 4) : ["自动转写内容仍需人工核对。"];
}

function cleanKnowledgeSentence(value: string) {
  return stripMarkdownSyntax(String(value || ""))
    .replace(/\b\d+\s*·\s*/g, "")
    .replace(/\b(待确认|他|我|你)\s*·\s*(周[一二三四五六日天]?|待确认)?$/g, "")
    .replace(/[呃嗯啊]{1,}/g, "")
    .replace(/(这个|那个|就是|然后|的话|可能|现在|目前|一下吧|好吧|对吧|你你|我们我们|他们他们)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[，。；、\s]+|[，；、\s]+$/g, "")
    .trim();
}

function isNoisyTranscriptLine(value: string) {
  const text = String(value || "");
  if (text.length > 110) return true;
  if (/^(嗯|啊|哦|好的|好吧|对|是的)[，。!！\s]*$/.test(text)) return true;
  const fillerMatches = text.match(/(这个|那个|然后|就是|呃|嗯|啊|你你|我我)/g)?.length || 0;
  return fillerMatches >= 4;
}

function extractKnowledgeSectionItems(markdown: string, headings: string[], limit: number) {
  const items: string[] = [];
  for (const heading of headings) {
    const raw = extractSectionRaw(markdown, heading);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const item = normalizeKnowledgeSectionLine(line);
      if (item) items.push(item);
      if (items.length >= limit) return uniqueList(items).slice(0, limit);
    }
  }
  return uniqueList(items).slice(0, limit);
}

function extractKnowledgeSummaryItems(markdown: string, type: string, limit: number) {
  const isLearning = /学习|课程|course/i.test(type);
  const headings = isLearning
    ? ["课程概述", "课程主线", "学习地图", "关键知识模块", "关键结论", "议题与要点", "事件/进展"]
    : ["关键结论", "议题与要点", "事件/进展", "发言脉络", "核心议题", "课程主线", "学习地图"];
  const items: string[] = [];
  for (const heading of headings) {
    const raw = extractSectionRaw(markdown, heading);
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const item = normalizeKnowledgeSectionLine(line);
      if (!item) continue;
      if (/^(主题|类型|状态|逻辑结构|核心实体)(\s|·)/.test(item)) continue;
      items.push(item);
      if (items.length >= limit) return uniqueList(items).slice(0, limit);
    }
  }
  return uniqueList(items).slice(0, limit);
}

function extractKnowledgeInfoMap(markdown: string) {
  const raw = extractSectionRaw(markdown, "内容理解");
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes("|") || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
    const cells = splitMarkdownTableRow(line).map(stripMarkdownSyntax).filter(Boolean);
    if (cells.length < 2) continue;
    const [key, ...rest] = cells;
    if (["项", "结果"].includes(key)) continue;
    result[key] = compactText(rest.join(" · "), 220);
  }
  return result;
}

function extractSectionRaw(markdown: string, headingText: string) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{2,4}\\s+${escapeRegExp(headingText)}\\s*$`).test(line.trim()));
  if (start < 0) return "";
  const output: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    output.push(lines[index]);
  }
  return output.join("\n");
}

function normalizeKnowledgeSectionLine(line: string) {
  const trimmed = String(line || "").trim();
  if (!trimmed || /^```/.test(trimmed) || /^\|?\s*:?-{3,}/.test(trimmed)) return "";
  if (trimmed.includes("|")) {
    const cells = splitMarkdownTableRow(trimmed)
      .map(stripMarkdownSyntax)
      .filter(Boolean)
      .filter((cell) => !["#", "项", "结果", "事项", "核验方式", "状态", "模块", "核心问题", "关键洞察"].includes(cell));
    return compactText(cells.join(" · "), 150);
  }
  return compactText(stripMarkdownSyntax(trimmed.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")), 150);
}

function renderBriefList(items: string[]) {
  return `<ul class="brief-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function uniqueList(rows: string[]) {
  return Array.from(new Set(rows.map((row) => row.trim()).filter(Boolean)));
}

function noteStatCard(label: string, value: string, caption: string) {
  return `<div class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><p>${escapeHtml(caption)}</p></div>`;
}

function renderInline(text: string) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[\[([^\]]+)\]\]/g, "<span class=\"wikilink\">$1</span>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<a href=\"$2\" rel=\"noreferrer\">$1</a>");
}

function uniqueSlug(text: string, toc: Array<{ id: string }>) {
  const base = text.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
  let candidate = base;
  let index = 2;
  while (toc.some((item) => item.id === candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char] || char);
}

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knowledgeNoteCss() {
  return `
    :root { color-scheme: light; --ink:#101828; --muted:#667085; --line:#d7dee8; --bg:#f3f6f8; --panel:#ffffff; --hero:#fbfcfd; --hero-soft:#eef2f6; --accent:#0f766e; --accent-dark:#115e59; --blue:#2563eb; --warm:#b45309; --risk:#b42318; --soft:#e6f4f1; --blue-soft:#eef4ff; --warm-soft:#fff7ed; --risk-soft:#fff1f0; --shadow:0 18px 44px rgba(16,24,40,.09); --radius:10px; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); line-height:1.66; overflow-x:hidden; }
    a { color:var(--accent-dark); }
    .note-hero { position:relative; display:flex; justify-content:space-between; gap:32px; padding:34px 46px 86px; color:var(--ink); border-bottom:1px solid var(--line); background:linear-gradient(180deg,#ffffff 0%,var(--hero) 100%); overflow:hidden; }
    .note-hero::before { content:""; position:absolute; left:0; top:0; bottom:0; width:8px; background:linear-gradient(180deg,var(--accent),var(--blue) 58%,var(--warm)); pointer-events:none; }
    .note-hero > * { position:relative; }
    .note-hero h1 { max-width:920px; margin:10px 0 10px; font-size:36px; line-height:1.16; letter-spacing:0; overflow-wrap:anywhere; }
    .hero-copy { min-width:0; }
    .note-hero p { max-width:840px; margin:0 0 16px; color:#475467; font-size:16px; }
    .note-hero code { display:inline-block; max-width:860px; padding:5px 8px; border:1px solid var(--line); border-radius:6px; background:#f8fafc; color:#334155; font-size:12px; overflow-wrap:anywhere; word-break:break-all; }
    .hero-pills { display:flex; flex-wrap:wrap; gap:8px; }
    .hero-pills span { display:inline-flex; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:#fff; color:#344054; font-size:12px; font-weight:800; }
    .hero-pills span:nth-child(2) { color:var(--warm); background:var(--warm-soft); border-color:#fed7aa; }
    .doc-badge { display:inline-flex; padding:6px 10px; border-radius:999px; background:var(--soft); color:var(--accent-dark); font-size:12px; font-weight:900; letter-spacing:0; }
    .note-status { width:min(390px,34vw); min-width:250px; align-self:flex-start; border:1px solid var(--line); border-radius:var(--radius); background:#fff; padding:16px; box-shadow:var(--shadow); }
    .note-status span, .note-status small { display:block; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
    .note-status strong { display:block; margin:5px 0; color:var(--ink); font-size:19px; overflow-wrap:anywhere; }
    .source-checks { display:grid; gap:6px; margin-top:12px; padding-top:12px; border-top:1px solid #edf1f6; }
    .source-checks span { display:inline-flex; width:max-content; max-width:100%; padding:5px 8px; border-radius:999px; background:#f8fafc; color:#475467; font-weight:800; }
    .note-shell { max-width:1360px; margin:0 auto; padding:24px 30px 56px; }
    .briefing-grid { display:grid; grid-template-columns:minmax(0,1.42fr) minmax(240px,.74fr) minmax(240px,.74fr); gap:14px; margin:-58px 0 16px; position:relative; z-index:2; }
    .briefing-card { min-width:0; border:1px solid rgba(215,222,232,.95); border-radius:var(--radius); background:rgba(255,255,255,.98); padding:18px; box-shadow:0 24px 54px rgba(16,24,40,.12); overflow-wrap:anywhere; }
    .briefing-card > span { display:inline-flex; margin-bottom:8px; color:var(--accent-dark); font-size:12px; font-weight:900; }
    .briefing-card h2 { margin:0 0 8px; font-size:23px; line-height:1.25; letter-spacing:0; }
    .briefing-card p { margin:0; color:#334155; font-size:14px; }
    .briefing-lead { background:#fff; border-left:5px solid var(--accent); }
    .queue-card { border-top:4px solid var(--blue); }
    .risk-card { border-top-color:var(--warm); background:linear-gradient(180deg,#fff 0%,var(--warm-soft) 100%); }
    .brief-facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:16px 0 0; }
    .brief-facts div { min-width:0; padding:10px; border-radius:8px; background:#f8fafc; border:1px solid #edf1f6; }
    .brief-facts dt { color:var(--muted); font-size:11px; font-weight:900; }
    .brief-facts dd { margin:2px 0 0; color:#1d2939; font-weight:900; overflow-wrap:anywhere; }
    .brief-list { display:grid; gap:8px; margin:0; padding:0; list-style:none; color:#334155; font-size:13px; }
    .brief-list li { position:relative; padding-left:16px; }
    .brief-list li::before { content:""; position:absolute; left:0; top:.72em; width:6px; height:6px; border-radius:999px; background:var(--accent); }
    .insight-strip { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:14px; }
    .stat-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:14px; }
    .stat-card { min-width:0; border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:15px 16px; box-shadow:var(--shadow); overflow-wrap:anywhere; }
    .stat-card strong { display:block; color:var(--accent-dark); font-size:24px; line-height:1.1; }
    .stat-card span { display:block; margin-top:7px; font-size:12px; color:#334155; font-weight:800; }
    .stat-card p { margin:4px 0 0; font-size:12px; color:var(--muted); }
    .stat-card:nth-child(2) strong { color:var(--blue); }
    .stat-card:nth-child(3) strong { color:var(--warm); }
    .actionbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:0 0 18px; padding:10px; border:1px solid var(--line); border-radius:var(--radius); background:rgba(255,255,255,.92); box-shadow:var(--shadow); }
    .action { display:inline-flex; align-items:center; min-height:34px; padding:7px 12px; border-radius:6px; border:1px solid var(--line); background:#fff; color:var(--accent-dark); text-decoration:none; font-weight:800; font-size:13px; overflow-wrap:anywhere; }
    .action.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
    .muted-action { color:var(--muted); font-weight:700; }
    .note-grid { display:grid; grid-template-columns:minmax(230px,310px) minmax(0,1fr); gap:20px; align-items:start; }
    .note-side { position:sticky; top:18px; display:grid; gap:14px; max-height:calc(100vh - 36px); overflow:auto; }
    .side-card { min-width:0; border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:14px; box-shadow:var(--shadow); overflow-wrap:anywhere; }
    .side-card strong { display:block; margin-bottom:8px; color:#0f172a; }
    .side-card p { color:var(--muted); margin:0; }
    .strategy-card ul { margin:0; padding-left:18px; color:#334155; font-size:13px; }
    .strategy-card li { margin:4px 0; }
    .side-card pre { max-height:280px; overflow:auto; margin:0; padding:10px; border-radius:8px; border:1px solid var(--line); background:#f8fafc; color:#334155; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
    .doc-toc { display:grid; gap:4px; }
    .doc-toc a { display:block; padding:6px 8px; border-radius:6px; color:var(--ink); text-decoration:none; font-size:13px; overflow-wrap:anywhere; }
    .doc-toc a:hover { background:#f1f5f9; }
    .doc-toc .toc-2 { padding-left:10px; }
    .doc-toc .toc-3, .doc-toc .toc-4 { padding-left:20px; color:var(--muted); }
    .chip-row { display:flex; flex-wrap:wrap; gap:7px; }
    .chip-row span { display:inline-flex; max-width:100%; padding:5px 8px; border-radius:999px; background:var(--soft); color:var(--accent-dark); font-size:12px; font-weight:700; overflow-wrap:anywhere; }
    .chip-row.related span { background:#eef2ff; color:#334155; }
    .note-main { min-width:0; display:grid; gap:18px; }
    .summary-card, .doc-content, .raw-preview { min-width:0; border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:24px 28px; box-shadow:var(--shadow); overflow-wrap:anywhere; word-break:break-word; }
    .summary-card { border-left:5px solid var(--accent); background:#fff; }
    .evidence-card { border-left-color:var(--blue); background:#f8fbff; }
    .summary-card h2 { margin:0 0 8px; font-size:21px; line-height:1.3; }
    .summary-card p { margin:0; color:#334155; }
    .doc-content h1:first-child { margin-top:0; }
    .doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4 { line-height:1.34; margin-top:1.45em; letter-spacing:0; overflow-wrap:anywhere; }
    .doc-content h1 { font-size:30px; }
    .doc-content h2 { padding-top:10px; border-top:1px solid #eef2f7; font-size:23px; }
    .doc-content h3 { font-size:18px; color:#0f766e; }
    .doc-content p, .doc-content li { font-size:15px; }
    .doc-content blockquote { margin:16px 0; padding:10px 14px; border-left:4px solid var(--accent); background:#f8fafc; color:#334155; }
    .table-wrap { width:100%; overflow-x:auto; border:1px solid var(--line); border-radius:8px; margin:14px 0; }
    table { width:100%; min-width:560px; border-collapse:collapse; background:#fff; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th { background:#f1f5f9; color:#334155; font-size:13px; }
    tr:last-child td { border-bottom:0; }
    pre { overflow:auto; border:1px solid var(--line); border-radius:8px; padding:12px; background:#0f172a; color:#e2e8f0; word-break:normal; }
    code { border-radius:5px; padding:1px 5px; background:#eef2f7; color:#0f172a; }
    pre code { padding:0; background:transparent; color:inherit; }
    .wikilink { display:inline; color:var(--accent-dark); font-weight:800; }
    .static-mindmap { margin:18px 0; padding:20px; border:1px solid var(--line); border-radius:18px; background:radial-gradient(circle at 0 0,rgba(20,184,166,.12),transparent 32%),#fff; overflow:auto; }
    .static-mindmap ul { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; margin:0; padding:0; list-style:none; }
    .static-mindmap li { min-width:160px; max-width:280px; margin:0; padding:10px; border:1px solid #dbeafe; border-radius:14px; background:#f8fafc; }
    .static-mindmap li span { display:block; color:#0f172a; font-weight:800; overflow-wrap:anywhere; }
    .static-mindmap li ul { display:grid; gap:8px; margin-top:10px; }
    .static-mindmap li li { min-width:0; width:100%; padding:8px 10px; border-color:#ccfbf1; background:#f0fdfa; }
    .raw-preview { background:#fffaf0; }
    .raw-preview summary { cursor:pointer; font-weight:800; }
    .raw-preview pre { white-space:pre-wrap; background:#ffffff; color:#334155; max-height:360px; overflow:auto; overflow-wrap:anywhere; word-break:break-word; }
    @media (max-width: 980px) { .note-hero { display:block; padding:28px 24px 66px; } .note-hero h1 { font-size:30px; } .note-status { width:auto; margin-top:14px; } .briefing-grid { grid-template-columns:1fr; margin-top:-44px; } .stat-grid, .insight-strip { grid-template-columns:repeat(2,minmax(0,1fr)); } .note-grid { display:block; } .note-side { position:static; max-height:none; margin-bottom:18px; } .note-shell { padding:18px; } }
    @media (max-width: 620px) { .note-hero { padding:20px 18px 56px; } .note-hero h1 { font-size:24px; } .note-shell { padding:12px; } .stat-grid, .insight-strip { grid-template-columns:1fr; } .brief-facts { grid-template-columns:1fr; } .summary-card, .doc-content, .raw-preview, .briefing-card { padding:18px; } table { min-width:480px; } }
    @media print { body { background:#fff; } .note-hero { background:#fff; } .actionbar, .note-side { display:none; } .note-shell { max-width:none; padding:0; } .note-grid { display:block; } .summary-card, .doc-content, .raw-preview, .stat-card, .note-status { box-shadow:none; } }
  `;
}

function documentCss() {
  return `
    :root { color-scheme: light; --ink:#172033; --muted:#64748b; --line:#d9e2ef; --bg:#f4f7fb; --panel:#fff; --accent:#0f766e; --accent-2:#14b8a6; --soft:#e6f4f1; --shadow:0 18px 50px rgba(15,23,42,.08); }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:radial-gradient(circle at 8% 0%,rgba(20,184,166,.11),transparent 30%),var(--bg); line-height:1.65; overflow-x:hidden; }
    .doc-header { display:flex; justify-content:space-between; gap:24px; padding:30px 38px; border-bottom:1px solid var(--line); background:linear-gradient(135deg,#fff 0%,#eef8f6 100%); position:sticky; top:0; z-index:2; }
    .doc-header h1 { margin:8px 0 4px; font-size:32px; line-height:1.2; letter-spacing:0; }
    .doc-subtitle, .doc-facts { color:var(--muted); font-size:13px; }
    .doc-facts { display:grid; gap:4px; align-content:start; text-align:right; overflow-wrap:anywhere; }
    .doc-badge { display:inline-flex; padding:5px 10px; border-radius:999px; background:var(--soft); color:var(--accent); font-size:12px; font-weight:800; letter-spacing:0; }
    .doc-shell { display:grid; grid-template-columns:minmax(220px,280px) minmax(0,1fr); gap:24px; padding:24px 36px 56px; }
    aside { position:sticky; top:122px; align-self:start; max-height:calc(100vh - 144px); overflow:auto; overflow-wrap:anywhere; }
    .doc-toc, .doc-meta { border:1px solid var(--line); border-radius:14px; background:var(--panel); padding:14px; margin-bottom:14px; box-shadow:var(--shadow); }
    .doc-toc a { display:block; color:var(--ink); text-decoration:none; padding:6px 0; font-size:13px; overflow-wrap:anywhere; }
    .doc-toc .toc-2 { padding-left:10px; }
    .doc-toc .toc-3, .doc-toc .toc-4 { padding-left:20px; color:var(--muted); }
    .doc-content { min-width:0; max-width:980px; border:1px solid var(--line); border-radius:18px; background:var(--panel); padding:30px 36px; box-shadow:var(--shadow); overflow-wrap:anywhere; word-break:break-word; }
    .doc-content h1:first-child { margin-top:0; }
    .doc-content h1, .doc-content h2, .doc-content h3 { line-height:1.3; margin-top:1.6em; }
    pre { overflow:auto; border:1px solid var(--line); border-radius:12px; padding:12px; background:#0f172a; color:#e2e8f0; word-break:normal; }
    code { border-radius:5px; padding:1px 5px; background:#eef2f7; }
    pre code { padding:0; background:transparent; }
    .wikilink { color:#0f766e; font-weight:700; }
    .static-mindmap { margin:18px 0; padding:20px; border:1px solid var(--line); border-radius:18px; background:radial-gradient(circle at 0 0,rgba(20,184,166,.12),transparent 32%),#fff; overflow:auto; }
    .static-mindmap ul { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; margin:0; padding:0; list-style:none; }
    .static-mindmap li { min-width:160px; max-width:280px; margin:0; padding:10px; border:1px solid #dbeafe; border-radius:14px; background:#f8fafc; }
    .static-mindmap li span { display:block; color:#0f172a; font-weight:800; overflow-wrap:anywhere; }
    .static-mindmap li ul { display:grid; gap:8px; margin-top:10px; }
    .static-mindmap li li { min-width:0; width:100%; padding:8px 10px; border-color:#ccfbf1; background:#f0fdfa; }
    @media (max-width: 860px) { .doc-header { position:static; display:block; padding:20px; } .doc-header h1 { font-size:28px; } .doc-facts { text-align:left; margin-top:12px; } .doc-shell { display:block; padding:16px; } aside { position:static; max-height:none; } .doc-content { padding:20px; } }
    @media print { .doc-header { position:static; } aside { display:none; } .doc-shell { display:block; padding:0; } .doc-content { border:0; } body { background:white; } }
  `;
}
