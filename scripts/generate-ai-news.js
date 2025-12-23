import fs from "fs-extra";
import path from "path";
import slugify from "slugify";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---- CONFIG ----
const OUTPUT_JSON = "data/ai_news.json";
const AI_DIR = "ai";
const MAX_ITEMS = 3;
const CONFIDENCE_LEVELS = ["High", "Medium", "Low"];

const SYSTEM_PROMPT = `
You are PTD AI Desk, an energy & power intelligence editor.
Write concise, professional, non-hyped briefs.
No references to external websites.
No speculation stated as fact.
Tone: Bloomberg / FT / utility-grade.
`;

const USER_PROMPT = `
Generate ${MAX_ITEMS} AI intelligence briefs for Energy & Power.

Each brief MUST include:
- title
- tldr (1–2 sentences)
- confidence (High / Medium / Low)
- confidence_reason (1 sentence)
- why_it_matters (3 bullets)
- key_points (5–7 bullets)
- watchlist (3 bullets)
- known_unknowns (3 bullets)
- tags (3–4 short tags)

Topics may include:
Data centers, grid stability, HV equipment, interconnection, HVDC, synchronous condensers, GIS, transformers, rare earths.

Return STRICT JSON ONLY:
{
  "items": [ ... ]
}
`;

// ---- HELPERS ----
function nowET() {
  return new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";
}

function articleHTML(item, id, slug) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>PTD Today — AI Desk — ${item.title}</title>
<meta name="description" content="${item.tldr}" />
<link rel="canonical" href="https://ptdtoday.com/ai/${slug}.html" />
<link rel="stylesheet" href="/assets/main.css" />
</head>

<body>
<div class="wrap">
<header class="site-header">
<h1><a href="/">PTD Today</a></h1>
<p class="motto">First to Know. First to Lead.</p>
<nav class="ptd-nav">
<a href="/">Home</a>
<a href="/ai.html" class="active">AI</a>
</nav>
</header>

<main class="article-wrap">
<p class="kicker">AI Brief</p>
<h1>${item.title}</h1>

<p><strong>${item.confidence} confidence</strong> — ${item.confidence_reason}</p>

<section>
<h2>TL;DR</h2>
<p>${item.tldr}</p>
</section>

<section>
<h2>Why it matters</h2>
<ul>${item.why_it_matters.map(b => `<li>${b}</li>`).join("")}</ul>
</section>

<section>
<h2>Key points</h2>
<ul>${item.key_points.map(b => `<li>${b}</li>`).join("")}</ul>
</section>

<section>
<h2>Watchlist (next 24–48 hours)</h2>
<ul>${item.watchlist.map(b => `<li>${b}</li>`).join("")}</ul>
</section>

<section>
<h2>Known unknowns</h2>
<ul>${item.known_unknowns.map(b => `<li>${b}</li>`).join("")}</ul>
</section>

<p><em>AI-generated. Informational only.</em></p>

<p><a href="/ai.html">← Back to AI Desk</a></p>
</main>
</div>
</body>
</html>
`;
}

// ---- MAIN ----
async function run() {
  console.log("Generating AI briefs...");

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT }
    ]
  });

  const data = JSON.parse(completion.choices[0].message.content);
  const items = [];

  await fs.ensureDir("data");
  await fs.ensureDir(AI_DIR);

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    const id = `ai-${new Date().toISOString().slice(0,10)}-${String(i+1).padStart(3,"0")}`;
    const slug = slugify(item.title, { lower: true, strict: true });

    const html = articleHTML(item, id, slug);
    await fs.writeFile(path.join(AI_DIR, `${slug}.html`), html);

    items.push({
      id,
      title: item.title,
      tldr: item.tldr,
      confidence: item.confidence,
      tags: item.tags,
      published_at: nowET(),
      url: `/ai/${slug}.html`
    });
  }

  await fs.writeJSON(OUTPUT_JSON, {
    updated_at: nowET(),
    items
  }, { spaces: 2 });

  console.log("✅ AI briefs generated successfully.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});