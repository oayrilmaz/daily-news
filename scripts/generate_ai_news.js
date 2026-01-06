// scripts/generate_ai_news.js
// Generates a DAILY AI INTELLIGENCE BRIEF for PTD Today.
// Output: data/ai_news.json + briefs/daily-ai.json

import fs from "fs";
import path from "path";
import OpenAI from "openai";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function isoNow() {
  return new Date().toISOString();
}

function utcDateOnly() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const client = new OpenAI({ apiKey });

  const today = utcDateOnly();
  const now = isoNow();

  const system = `
You are PTD Today’s Daily Intelligence Brief writer.

CRITICAL RULES:
- Do NOT present unverified real-world events as facts.
- If you are not given sources, write as "signals", "scenario watch", "what to monitor", "expectation", "contingency".
- Do NOT name or quote publishers, websites, or specific articles.
- Keep it useful for: power grid, transmission, substations, HV equipment, EPC/OEM, data centers power, renewables, critical minerals, AI-in-energy.
- Output MUST be valid JSON matching the schema exactly.
- No markdown, no extra text.

WRITING STYLE (important):
- Human, professional, WSJ-like clarity (tight, concrete, credible tone).
- Each item must have:
  (1) a strong headline,
  (2) a short lede (1–2 sentences),
  (3) a long body (multi-paragraph, ~500–900 words) that keeps readers engaged.
- The long body must stay within "intelligence/scenario" framing (no false certainty).
- Avoid fluff. Use specifics like operational implications, constraints, trade-offs, decision paths.
`.trim();

  const user = `
Generate today's brief for date_utc = "${today}".

Return JSON with this exact structure:

{
  "title": "PTD Today — Daily AI Intelligence Brief",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${today}",
  "sections": [
    { "heading": "Top Themes", "bullets": ["...","...","..."] },
    { "heading": "What to Watch (24–72h)", "bullets": ["...","...","..."] }
  ],
  "items": [
    {
      "id": "ai-YYYYMMDD-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Markets" | "Critical Minerals" | "Policy" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "title": "Short headline",
      "lede": "1–2 sentences hook. Intelligence framing, not asserted facts.",
      "body": "Multi-paragraph long-form article (~500–900 words). Use blank lines between paragraphs.",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "tags": ["tag1","tag2","tag3"],
      "watchlist": ["bullet", "bullet", "bullet"],
      "action_for_readers": "1 sentence action"
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- confidence_score must be a float between 0.55 and 0.90.
- ids must be unique and sequential (001..010).
- No links, no sources, no publisher names.
- Use blank lines in "body" to separate paragraphs.
`.trim();

  const resp = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_object" } }
  });

  const text = resp.output_text;
  if (!text) throw new Error("No output_text returned from OpenAI");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(`Model returned non-JSON. First 200 chars: ${text.slice(0, 200)}`);
  }

  writeJson(path.join("data", "ai_news.json"), payload);
  writeJson(path.join("briefs", "daily-ai.json"), payload);

  console.log("Wrote: data/ai_news.json and briefs/daily-ai.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});