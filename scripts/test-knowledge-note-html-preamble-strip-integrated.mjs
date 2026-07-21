// 2026-07-07 (rework8) — Integration test: load packed workbenchV11.js and exercise
// sanitizeKnowledgeNoteModelHtml against 4 cases.
//
// Run: node scripts/test-knowledge-note-html-preamble-strip-integrated.mjs
// Exit 0 = pass; Exit 1 = fail.
import { sanitizeKnowledgeNoteModelHtml } from "/Users/njx/Applications/njx-copilot.app/Contents/Resources/resources/server/workbenchV11.js";

const cases = [
    {
        name: "中文 preamble 在 <p> 内",
        html: '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><p>让我分析一下这条原始笔记。</p><p>主要内容是浦东保障压力问题。</p></body></html>',
        expectVisibleMatch: "主要内容是浦东保障压力问题。",
        expectIssuesNotContain: ["analysis_preamble_in_visible_body"],
        expectPassed: true,
    },
    {
        name: "英文 preamble in <p>",
        html: '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><p>Let me analyze this raw note carefully.</p><p>Real content here.</p></body></html>',
        expectVisibleMatch: "Real content here.",
        expectIssuesNotContain: ["analysis_preamble_in_visible_body"],
        expectPassed: true,
    },
    {
        name: "干净 HTML 不变",
        html: '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><section class="hero"><h1>浦东保障压力</h1><p>几个机型来回切换的配件补货周期有时卡四五天。</p></section></body></html>',
        expectVisibleContains: "浦东保障压力",
        expectIssuesNotContain: ["analysis_preamble_in_visible_body"],
        expectPassed: true,
    },
    {
        name: "multi-preamble (h1 + p, second p is also matching client RE)",
        // Realistic LLM failure: h1 has "让我分析一下..." + p has "让我先..." (both
        // in client regex). Strip pass 1 removes h1's content, pass 2 removes p's
        // content, leaving real content intact. Client would 100% reject without
        // this fix.
        html: '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><header class="hero"><h1>让我分析一下这条原始笔记</h1><p>让我先看看浦东保障压力的素材，再做整合。</p></header><main><section class="card"><h2>高价值摘要</h2><p>咖啡小哥反馈压力较大。</p></section></main></body></html>',
        expectVisibleContains: "高价值摘要",
        expectIssuesNotContain: ["analysis_preamble_in_visible_body"],
        expectPassed: true,
    },
];

function visibleBodyOf(html) {
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
    return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

let fails = 0;
for (const c of cases) {
    const r = sanitizeKnowledgeNoteModelHtml(c.html, { title: "test", sourceHash: "abc123def4" });
    const v = visibleBodyOf(r.html);
    const issues = r.quality.issues || [];
    let ok = true;
    let detail = [];

    if (c.expectVisibleMatch && v !== c.expectVisibleMatch) {
        ok = false;
        detail.push(`visible mismatch — expected "${c.expectVisibleMatch}", got "${v}"`);
    }
    if (c.expectVisibleContains && !v.includes(c.expectVisibleContains)) {
        ok = false;
        detail.push(`visible missing "${c.expectVisibleContains}", got "${v.slice(0, 120)}"`);
    }
    if (c.expectIssuesContain) {
        for (const tag of c.expectIssuesContain) {
            if (!issues.includes(tag)) {
                ok = false;
                detail.push(`issues missing "${tag}", got ${JSON.stringify(issues)}`);
            }
        }
    }
    if (c.expectIssuesNotContain) {
        for (const tag of c.expectIssuesNotContain) {
            if (issues.includes(tag)) {
                ok = false;
                detail.push(`issues unexpectedly contains "${tag}", got ${JSON.stringify(issues)}`);
            }
        }
    }
    if (c.expectPassed !== undefined && r.quality.passed !== c.expectPassed) {
        ok = false;
        detail.push(`passed mismatch — expected ${c.expectPassed}, got ${r.quality.passed}`);
    }

    console.log("— " + c.name);
    console.log(`  visible:    "${v.slice(0, 140)}"`);
    console.log(`  passed:     ${r.quality.passed} (expected ${c.expectPassed})`);
    console.log(`  score:      ${r.quality.score}`);
    console.log(`  issues:     ${JSON.stringify(issues)}`);
    if (!ok) {
        console.log("  ❌ FAIL: " + detail.join("; "));
        fails++;
    } else {
        console.log("  ✓ PASS");
    }
}

console.log("\n=== " + (fails === 0 ? "ALL PASS" : fails + " FAIL") + " ===");
process.exit(fails === 0 ? 0 : 1);
