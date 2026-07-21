// 2026-07-07 (rework9 save-fix) — Final verification: real LLM output
// passes save gate (passed=true) while issue is still surfaced for UI.
import { sanitizeKnowledgeNoteModelHtml } from "/Users/njx/Applications/njx-copilot.app/Contents/Resources/resources/server/workbenchV11.js";

const realLlmHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta name="source-hash" content="a9c0e756f8b37ed1a4275a53ea8dc79f54ad547f027d42dcea36e3f0bc903317">
<title>午间咖啡杂谈 · 离线阅读</title>
<style>body{font-family:sans-serif;background:#FDF8F3;color:#2C1810;line-height:1.7;padding:32px 16px;}.wrap{max-width:980px;margin:0 auto;}.hero{background:linear-gradient(135deg,#6B4423 0%,#8B5A2B 50%,#A0703D 100%);color:#FDF8F3;border-radius:20px;padding:36px 32px;margin-bottom:28px;}.hero h1{margin:0 0 12px 0;font-size:32px;}.hero .lead{font-size:15px;opacity:0.9;}.topic{background:#FFF;padding:18px 22px;border-radius:14px;margin-top:14px;}.insight{background:linear-gradient(135deg,#FBF2E5 0%,#F4E3CB 100%);border-left:4px solid #D4A574;padding:14px 16px;margin:8px 0;}.actions{background:#FFFFFF;border-radius:14px;padding:18px 22px;border:1px solid #F0E6D8;margin-top:14px;}.evidence{background:#FFFFFF;border-radius:14px;padding:20px 22px;border:1px solid #F0E6D8;margin-top:14px;}.evidence blockquote{margin:0;padding:10px 0 10px 16px;border-left:3px solid #D4A574;font-style:italic;}.actions-row{background:#FFFFFF;border-radius:14px;padding:18px 22px;border:1px solid #F0E6D8;margin-top:14px;}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <span>杂谈记录</span>
    <h1>午间咖啡杂谈</h1>
    <p class="lead">一段以 NJX 为主讲、LRG 为主要对话方的午餐时段漫谈，时长超一小时。话题跨度极大。</p>
  </header>
  <section>
    <div class="topic">
      <h3>1. 开场寒暄</h3>
      <ul>
        <li>七月天气炎热，暑假已放。</li>
        <li>提及美国建国 250 周年与 1776 年。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>2. 时间感知差异</h3>
      <ul>
        <li>十岁一年 = 生命的 1/10，三十岁一年 = 1/30。</li>
        <li>童年经历多为初次接触。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>3. 衰老与接受新事物</h3>
      <ul>
        <li>年纪大的人一个共同点：难以接纳新事物。</li>
        <li>沟通费劲的老师问题在认知停留在某时间点后不再更新。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>4. 学术与项目合作</h3>
      <ul>
        <li>大学教授通常身兼多个研究项目。</li>
        <li>评职称需参与研究项目并撰写论文。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>5. 论文发表与职称评价</h3>
      <ul>
        <li>毕业论文选择期刊发表。</li>
        <li>仅发行业内部期刊与流量同源——本质都是认可机制。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>6. 历史插叙：工作制与社保</h3>
      <ul>
        <li>1995 年 5 月 1 日起，中国现行社保制度正式开始。</li>
        <li>1949—1994 年期间实行"做六休一"。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>7. 大脑 reset 与工作记忆断点</h3>
      <p><strong>LRG 描述日常现象：</strong></p>
      <ul>
        <li>在单位久坐三到四个月会莫名烦躁。</li>
        <li>类比"给大脑重启一下"。</li>
      </ul>
      <p><strong>航空维修案例：</strong></p>
      <ul>
        <li>昨日 MC 来电询问某"键"能否装。</li>
        <li>追溯：今日查记录发现早在 2025 年 7 月就已处理过此事。</li>
        <li>原因：当时所有 VSP 已下载好，但最终没干活。</li>
        <li>反思：万事俱备，只欠临门一脚，功亏一篑。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>8. 知识管理与个人记忆外挂</h3>
      <ul>
        <li>引出：如果我们能把生命中的每一件事完整记录下来，记忆感知会改变吗？</li>
        <li>6 年 ≈ 2000 天，几乎不可能逐日回忆具体事件。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>9. 大模型上下文窗口讨论</h3>
      <ul>
        <li>模型上下文容量正被推升：从 128K，到 2M、10M。</li>
        <li><strong>AI 没有记忆</strong>：纯模型每次重新理解用户。</li>
        <li>超窗口后会做摘要压缩。</li>
        <li><strong>提示词 ≈ 许愿</strong>。</li>
        <li>LRG 实践路径：从<strong>让我做 PPT、做计划</strong>等动作型任务入手；纯知识点提问只是基础。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>10. 个人记录 APP 的构想</h3>
      <ul>
        <li>第一步：实时录音 → 实时总结 → 切片板入库。</li>
        <li>第二步：基于行动记录做复盘、推荐与引导。</li>
        <li>第三步：记录帮助人意识到"真正想要的东西"。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>11. 消费观、试错与探索欲</h3>
      <ul>
        <li>LRG 自我画像：消费偏保守——一两百、五百块的试错愿意。</li>
        <li>现实案例：曾坚持用软件记账四个月，回看发现自己每月 10% 开支花在饮料上（"我才知道啊，我他妈一个月喝了这么多饮料"）。</li>
        <li>LRG 感慨：现在对探索新东西"提不起兴趣"。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>12. 知行合一与工具学习演变</h3>
      <ul>
        <li>NJX 提出阳明心学视角：若认为不行，便无法合一。</li>
        <li>工具学习路径：领导布置难完成的任务 → 压力之下被迫探索。</li>
      </ul>
    </div>
    <div class="topic">
      <h3>13. 摄影与曾国藩日记</h3>
      <ul>
        <li>同一棵树，从艺术家视角是艺术，从平常心看只是石头。</li>
        <li>NJX 引《曾国藩传》：曾国藩虽每日写日记，但偶尔空白或敷衍。</li>
      </ul>
    </div>
  </section>
  <section>
    <h2>关键洞察</h2>
    <div class="insight"><b>时间感知的双因素模型</b>：生命比例 + 新鲜度。</div>
    <div class="insight"><b>AI 没有记忆</b>：靠"上下文重喂"维持连续性。</div>
    <div class="insight"><b>个人记录系统的本质</b>：让行为留下痕迹，让真正想要的东西浮现。</div>
    <div class="insight"><b>指令 ≠ 许愿</b>：对掌控不了的事发指令是无效的。</div>
  </section>
  <section>
    <div class="actions-row"><strong>NJX:</strong> 个人记录 APP 开发（第二阶段）。</div>
    <div class="actions-row"><strong>LRG:</strong> 飞机某部件的库存状态彻底清查。</div>
    <div class="actions-row"><strong>探索方向:</strong> 个人记忆外挂的产品形态。</div>
  </section>
  <section>
    <div class="evidence">
      <blockquote>十岁的一年是生命的 1/10，三十岁的一年是 1/30——比例不同是时间感差异的第一层。</blockquote>
      <blockquote>AI 没有记忆，每次都重新认识你，靠喂完整上下文维持假象；超窗后压缩为摘要。</blockquote>
      <blockquote>困在旧思维里的人不是"不想"，是旧关联已塞满大脑，腾不出空间。</blockquote>
      <blockquote>未来的笔记不是人记的，是它记的；记完给我形成时间线，睡眠期间也在录。</blockquote>
      <blockquote>万事俱备，只欠临门一脚，结果没多——功亏一篑。</blockquote>
    </div>
  </section>
  <footer><div>本页面为离线阅读版 · 内容据 Markdown 笔记整理</div></footer>
</div>
</body>
</html>`;

const sanitized = sanitizeKnowledgeNoteModelHtml(realLlmHtml, {
    title: "2026-07-07 午间咖啡杂谈",
    sourceHash: "a9c0e756f8b37ed1a4275a53ea8dc79f54ad547f027d42dcea36e3f0bc903317",
    qualityProfile: "standard",
});

console.log("=== save path: full 13-topic 咖啡杂谈 (post rework9 save-fix) ===");
console.log("sanitized.passed:", sanitized.quality.passed);
console.log("sanitized.score: ", sanitized.quality.score);
console.log("sanitized.issues:", JSON.stringify(sanitized.quality.issues));
console.log("");

const v = sanitized.html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
console.log("preserves '让我做 PPT':", v.includes("让我做 PPT") ? "✓" : "✗");
console.log("preserves '我他妈':", v.includes("我他妈") ? "✓" : "✗");

const ok = sanitized.quality.passed === true
    && sanitized.quality.issues.includes("analysis_preamble_in_visible_body")
    && v.includes("让我做 PPT")
    && v.includes("我他妈");

console.log("\n=== 验收 ===");
console.log(`expected passed=true, got ${sanitized.quality.passed} ${sanitized.quality.passed === true ? "✓" : "✗"}`);
console.log(`expected 'analysis_preamble_in_visible_body' 仍在 issues[] (UI 提示): ${sanitized.quality.issues.includes("analysis_preamble_in_visible_body") ? "✓" : "✗"}`);
console.log(`user transcript '让我做 PPT' preserved: ${v.includes("让我做 PPT") ? "✓" : "✗"}`);
console.log(`user transcript '我他妈' preserved: ${v.includes("我他妈") ? "✓" : "✗"}`);

process.exit(ok ? 0 : 1);
