// 2026-07-07 (rework9) — Critical test: real LLM output with user transcript
// phrases ("让我做 PPT" / "我他妈") in body middle must NOT block save.
//
// Real failure case: NJX 截图 12:35 4 次 save.post 全部被 server 拒
// 原因: my rework8 fix 的 residual RE 全文匹配, 把 user 真实口述("让我做"
// "我他妈")也当 preamble 拦下, push critical issue, passed=false.
import { sanitizeKnowledgeNoteModelHtml } from "/Users/njx/Applications/njx-copilot.app/Contents/Resources/resources/server/workbenchV11.js";

// Real LLM output from NJX's 12:34 attempt (13 topics 咖啡杂谈 with
// user transcript phrases in body middle).
const realLlmHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta name="source-hash" content="a9c0e756f8b37ed1a4275a53ea8dc79f54ad547f027d42dcea36e3f0bc903317">
<title>午间咖啡杂谈</title>
<style>.hero{background:linear-gradient(135deg,#6B4423 0%,#8B5A2B 50%,#A0703D 100%);color:#FDF8F3;padding:36px 32px;border-radius:20px;}.section{margin-top:36px;}.topic{background:#FFF;padding:18px 22px;border-radius:14px;margin-top:14px;}.insight{background:linear-gradient(135deg,#FBF2E5 0%,#F4E3CB 100%);border-left:4px solid #D4A574;padding:14px 16px;}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <span class="eyebrow">杂谈记录 · 离线阅读版</span>
    <h1>午间咖啡杂谈</h1>
    <p class="lead">一段以 NJX 为主讲、LRG 为主要对话方的午餐时段漫谈。</p>
  </header>
  <section>
    <h2 class="section-title">话题脉络</h2>
    <div class="topic">
      <h3>7. 大脑 reset 与工作记忆断点</h3>
      <p><strong>LRG 描述日常现象：</strong></p>
      <ul>
        <li>在单位久坐三到四个月会莫名烦躁</li>
      </ul>
      <p><strong>航空维修案例（未跟进的"键"）：</strong></p>
      <ul>
        <li>事件：昨日 MC 来电询问某"键"能否装。</li>
        <li>追溯：今日查记录发现早在 2025 年 7 月就已处理过此事。</li>
        <li>原因：当时所有 VSP 已下载好，但最终没干活。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>9. 大模型上下文窗口讨论</h3>
      <ul>
        <li>模型上下文容量正被推升。</li>
        <li>LRG 实践路径：从<strong>让我做 PPT、做计划</strong>等动作型任务入手。</li>
        <li>提示词 ≈ 许愿。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>11. 消费观、试错与探索欲</h3>
      <ul>
        <li>LRG 现实案例：曾坚持用软件记账四个月，回看发现自己每月 10% 开支花在饮料上（"我才知道啊，我他妈一个月喝了这么多饮料"）。</li>
        <li>LRG 感慨：现在对探索新东西"提不起兴趣"。</li>
      </ul>
    </div>
  </section>
</div>
</body>
</html>`;

const r = sanitizeKnowledgeNoteModelHtml(realLlmHtml, {
    title: "2026-07-07 午间咖啡杂谈",
    sourceHash: "a9c0e756f8b37ed1a4275a53ea8dc79f54ad547f027d42dcea36e3f0bc903317",
    qualityProfile: "standard",
});

console.log("=== real LLM transcript (rework9) ===");
const v = r.html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
console.log("visible:    " + v.slice(0, 200));
console.log("passed:     " + r.quality.passed);
console.log("score:      " + r.quality.score);
console.log("issues:     " + JSON.stringify(r.quality.issues));
console.log("dimensions: " + JSON.stringify(r.quality.dimensions));

const expectedPassed = true;
const expectedContainsProfanityPreserved = v.includes("我他妈");
const expectedContainsUserSpeech = v.includes("让我做");

console.log("\n=== 验收 ===");
console.log("expected passed=" + expectedPassed + ", got " + r.quality.passed + (r.quality.passed === expectedPassed ? " ✓" : " ✗"));
console.log("expected 'user transcript' preserved in body: " + expectedContainsUserSpeech + (expectedContainsUserSpeech ? " ✓" : " ✗"));
console.log("expected '我他妈' preserved (user 原话, not stripped): " + expectedContainsProfanityPreserved + (expectedContainsProfanityPreserved ? " ✓" : " ✗"));

const ok = r.quality.passed === expectedPassed && expectedContainsUserSpeech && expectedContainsProfanityPreserved;
process.exit(ok ? 0 : 1);
