// scripts/generate_ai_news.js
// Generates a DAILY AI INTELLIGENCE BRIEF for PTD Today.
// Output: data/ai_news.json (Home)

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
You are PTD Today’s Daily AI Briefing writer.

CRITICAL RULES:
- Do NOT present real-world events as verified facts.
- Write as: "signals", "scenario watch", "what to monitor", "operators may consider".
- Do NOT cite publishers or include links.
- Audience: power grid, transmission, substations, HV equipment, EPC/OEM, data center power, renewables, critical minerals, AI-in-energy.
- Output MUST be valid JSON only. No markdown. No extra text.

STYLE (WSJ-like briefing tone):
- Strong headlines, clean lede, then a short “story” paragraph.
- Practical and readable, like a human editor wrote it.
- Avoid hype, avoid fluff.
`;

  const user = `
Generate today's briefing for date_utc = "${today}".

Return JSON with this exact structure:

{
  "title": "PTD Today — Daily AI Briefing",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${today}",
  "items": [
    {
      "id": "ai-YYYYMMDD-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Markets" | "Critical Minerals" | "Policy" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "title": "Headline (6–12 words)",
      "lede": "1–2 sentences. Executive summary, intelligence framing (not fact claims).",
      "story": "A longer paragraph (120–220 words) written like a human analyst. Must remain scenario-based, no specific factual claims of breaking events.",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "tags": ["tag1","tag2"],
      "watchlist": ["bullet", "bullet", "bullet"],
      "action_for_readers": "1 sentence action"
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- confidence_score between 0.55 and 0.90 (float).
- ids must be unique and match the date.
- tags: 2–5 tags each.
- watchlist: 3–5 bullets each.
- No links, no sources, no publisher names.
`;

  const resp = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() }
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
  console.log("Wrote: data/ai_news.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});