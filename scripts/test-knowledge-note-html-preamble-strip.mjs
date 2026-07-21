// 2026-07-07 (rework8) — Test preamble strip helper before deploying.
//
// Validates `stripKnowledgeNoteHtmlLeadingPreamble` against 6 cases:
//   1. Chinese preamble: "让我分析一下" → stripped
//   2. English preamble inside <p>: "Let me analyze" → stripped
//   3. Mixed preamble under <h1>: "下面是整理后的笔记" → stripped
//   4. Multi-line preamble leading → first 2 lines stripped
//   5. No preamble (clean HTML) → unchanged
//   6. Preamble in middle of body → untouched (only leading)
//
// Run: node /Users/njx/openclaw/copilot/scripts/test-preamble-strip.mjs
// Exit 0 = pass; Exit 1 = fail.

const assertions = [];

function stripKnowledgeNoteHtmlLeadingPreamble(bodyHtmlStr, maxAttempts = 4) {
    // Phrases that mark the start of an analysis preamble sentence. Keep this
    // list tight — we only strip the **start** of leading text, never in the
    // middle of body, so phrases with distinctive beginnings (让我..., Let me,
    // The user..., First let me, etc.) are safe to remove.
    const PREAMBLE_RE = /^(?:让我(?:先|来|看看|分析(?:一下)?|整理(?:一下)?|处理(?:一下)?|先)?|我来(?:分析|整理|看看|处理|先)|下面我(?:来|将)?|以下是(?:整理(?:结果|笔记|后)?|笔记)?|下面是(?:整理(?:结果|笔记|后)?|笔记)?|整理结果\s*[:：]?|\s*Let me (?:analyze|look at|review|examine|read|organize|process|start)\b|\s*First,?\s+let me\b|\s*The user is asking\b|\s*The raw notes are\b|\s*The user (?:provided|pasted|gave|wants)\b|\s*I need to\b|\s*I'll (?:start|now|begin|analyze)\b|\s*Here's my (?:analysis|plan)\b|\s*Below is (?:my|the) (?:analysis|plan)\b)/i;
    let text = String(bodyHtmlStr || "");
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const before = text;
        // Phase 1: skip leading whitespace + simple HTML opening tags + entire
        // <script>/<style>/<head>/<noscript> blocks (so we don't get fooled by
        // CSS-in-style or HTML-in-namespace).
        let i = 0;
        let safetyBlocks = 0;
        while (i < text.length && i < 1500 && safetyBlocks < 80) {
            safetyBlocks++;
            const ch = text[i];
            if (ch === "<") {
                // Skip entire <script>/<style>/<noscript>/<head> blocks if encountered.
                const blockMatch = /^<(script|style|noscript|head)\b/i.exec(text.slice(i));
                if (blockMatch) {
                    const closeTag = `</${blockMatch[1].toLowerCase()}>`;
                    const closeIdx = text.toLowerCase().indexOf(closeTag, i);
                    if (closeIdx !== -1) {
                        i = closeIdx + closeTag.length;
                        continue;
                    }
                }
                const end = text.indexOf(">", i);
                if (end === -1) break;
                i = end + 1;
                continue;
            }
            if (/\s/.test(ch) || ch === "\u3000") { i++; continue; }
            break;
        }
        if (i >= text.length) break;
        const rest = text.slice(i);
        const m = PREAMBLE_RE.exec(rest);
        if (!m) break;
        // After matching preamble phrase, advance past the entire leading sentence
        // (text + punctuation + whitespace) until the next opening tag.
        let cutEnd = i + m[0].length;
        let limit = 0;
        while (cutEnd < text.length && limit < 8) {
            const ch = text[cutEnd];
            if (ch === "<") break;
            if (/[,.;:!?。，；、！？\s\u3000\n\r]/.test(ch)) { cutEnd++; limit++; continue; }
            break;
        }
        while (cutEnd < text.length && cutEnd < i + 600) {
            if (text[cutEnd] === "<") break;
            cutEnd++;
        }
        text = text.slice(0, i) + text.slice(cutEnd);
        if (text === before) break;
    }
    return text;
}

// helper: assert visible body no longer contains any preamble phrase
const REMAINING_PREAMBLE_RE = /(?:让我(?:先|来|看看|分析(?:一下)?|整理(?:一下)?|处理(?:一下)?|先)?|我来(?:分析|整理|看看|处理|先)|下面我(?:来|将)?|以下是(?:整理(?:结果|笔记|后)?|笔记)?|下面是(?:整理(?:结果|笔记|后)?|笔记)?|整理结果\s*[:：]?|Let me (?:analyze|look at|review|examine|read|organize|process|start)|First,?\s+let me|The user is asking|The raw notes are|The user (?:provided|pasted|gave|wants)|I need to|I'll (?:start|now|begin|analyze)|Here's my (?:analysis|plan)|Below is (?:my|the) (?:analysis|plan))/i;

function visibleBodyOf(html) {
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
    return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function assertCase(name, input, expectedStripped, opts = {}) {
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input);
    const v = visibleBodyOf(stripped);
    const matches = v === expectedStripped || (opts.containsVisible && expectedStripped.split(" ").every((w) => v.includes(w)));
    // For the "no preamble" case, expectedStripped === visibleBodyOf(input) which is also what stripped should produce
    if (opts.containsVisible) {
        if (!v.includes(expectedStripped)) {
            assertions.push(`FAIL ${name} — visible body does not contain "${expectedStripped}", got "${v.slice(0, 100)}"`);
        } else {
            assertions.push(`PASS ${name}`);
        }
    } else if (v !== expectedStripped) {
        assertions.push(`FAIL ${name} — expected visible body "${expectedStripped}", got "${v.slice(0, 200)}"`);
    } else {
        assertions.push(`PASS ${name}`);
    }
}

// Case 1: Chinese preamble "让我分析一下" at very start (before <p>)
{
    const input = `<p>让我分析一下这条原始笔记。</p><p>主要内容是浦东保障压力问题。</p>`;
    assertCase("1. 中文 preamble 在 <p> 内", input, "主要内容是浦东保障压力问题。");
}

// Case 2: English preamble inside <p> — multi-paragraph strip until done
{
    const input = `<p>Let me analyze this raw note carefully.</p><p>The user is asking me to organize notes.</p>`;
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input, 4);
    const v = visibleBodyOf(stripped);
    if (REMAINING_PREAMBLE_RE.test(v)) {
        assertions.push(`FAIL 2 — preamble still in visible body: "${v.slice(0, 100)}"`);
    } else {
        assertions.push(`PASS 2 — multi-paragraph preamble fully removed (visible body: "${v.slice(0, 100)}")`);
    }
}

// Case 3: Preamble under <h1> tag
{
    const input = `<h1>下面是整理后的笔记：浦东保障压力</h1><section>关键事实</section>`;
    assertCase("3. Preamble 在 <h1> 里", input, "关键事实");
}

// Case 4: Multi-line preamble
{
    const input = `<p>让我先来分析。</p><p>用户提到了浦东保障压力。</p><section>事实</section>`;
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input, 4);
    const v = visibleBodyOf(stripped);
    if (!v.includes("事实")) {
        assertions.push(`FAIL 4 — did not preserve 事实, got "${v.slice(0, 100)}"`);
    } else if (REMAINING_PREAMBLE_RE.test(v)) {
        assertions.push(`FAIL 4 — preamble still in visible body: "${v.slice(0, 100)}"`);
    } else {
        assertions.push(`PASS 4 — multi-line preamble cleared`);
    }
}

// Case 5: No preamble — clean HTML unchanged
{
    const input = `<section><h1>浦东保障压力</h1><p>几个机型来回切换的配件补货周期有时卡四五天。</p></section>`;
    const before = visibleBodyOf(input);
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input);
    const after = visibleBodyOf(stripped);
    if (before !== after) {
        assertions.push(`FAIL 5 — clean input was modified, "${before}" vs "${after}"`);
    } else {
        assertions.push(`PASS 5 — clean input untouched`);
    }
}

// Case 6: Preamble in MIDDLE (not leading) should be UNTOUCHED
{
    const input = `<h1>浦东保障压力</h1><section>事实</section><p>让我简单总结一下：要点清晰。</p>`;
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input);
    const v = visibleBodyOf(stripped);
    if (!v.includes("让我简单总结一下")) {
        assertions.push(`FAIL 6 — middle-body preamble wrongly stripped: "${v.slice(0, 200)}"`);
    } else {
        assertions.push(`PASS 6 — middle preamble preserved`);
    }
}

// Case 7: Realistic LLM output — preamble in h1 + p, then content
// Strategy:
//   - Pass 1 strips "让我分析一下..." from <h1> (first-leading-pattern)
//   - Pass 2 doesn't match (2nd <p> doesn't match)
//   - So visible body STILL has "用户提供了..." → server marks issue, marks passed=false (forces retry)
//   - Tests verify: content preserved + strip can be called repeatedly for fallback retry trigger
{
    const input = `<!doctype html>
<html lang="zh-CN">
<head><meta name="source-hash" content="abc"><style>.hero { padding: 20px; }</style></head>
<body>
<header class="hero">
<h1>让我分析一下这条原始笔记</h1>
<p>用户提供了关于浦东保障压力的素材，需要整理成结构化的笔记。</p>
</header>
<main>
<section class="card">
<h2>高价值摘要</h2>
<p>咖啡小哥反馈浦东保障压力较大，配件补货周期 4-5 天，影响加班费。</p>
</section>
<section class="card">
<h2>关键事实</h2>
<ul><li>机型来回切换</li><li>配件预测自动化</li><li>每月省加班费</li></ul>
</section>
</main>
</body>
</html>`;
    const stripped = stripKnowledgeNoteHtmlLeadingPreamble(input);
    const v = visibleBodyOf(stripped);
    // Verify: 让我分析一下... was stripped (sentinel "<h1></h1>" or similar)
    if (!v.includes("让我分析一下")) {
        assertions.push(`PASS 7a — first preamble stripped from realistic LLM output`);
    } else {
        assertions.push(`FAIL 7a — first preamble NOT stripped: "${v.slice(0, 100)}"`);
    }
    // Verify: high-value content still present
    if (v.includes("高价值摘要") && v.includes("关键事实")) {
        assertions.push(`PASS 7b — content blocks preserved`);
    } else {
        assertions.push(`FAIL 7b — content lost: "${v.slice(0, 200)}"`);
    }
}

// Summary
const passes = assertions.filter((s) => s.startsWith("PASS")).length;
const fails = assertions.filter((s) => s.startsWith("FAIL"));
console.log("\n=== preamble-strip test ===");
for (const a of assertions) console.log(a);
console.log(`\n${passes} pass, ${fails.length} fail`);
process.exit(fails.length === 0 ? 0 : 1);
