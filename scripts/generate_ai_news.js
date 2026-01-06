// scripts/generate_ai_news.js
// Generates DAILY AI WRITTEN BRIEFING for PTD Today (no external links required).
// Outputs:
//   - data/ai_news.json                (Home reads this)
//   - data/briefs/daily-ai.json        (optional copy if you ever use briefs page again)

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

// Keep model configurable from repo secrets/env
function getModel() {
  return process.env.PTD_OPENAI_MODEL || "gpt-4o-mini";
}

async function main() {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const client = new OpenAI({ apiKey });

  const today = utcDateOnly();
  const now = isoNow();
  const model = getModel();

  // IMPORTANT:
  // This is an "intelligence-style briefing", not verified reporting.
  // We avoid claiming specific real-world events as facts when not provided sources.

  const system = `
You are PTD Today’s daily editorial writer.

CRITICAL:
- Do NOT claim specific real-world events happened unless they are framed as "signals" or "watch items".
- No publisher names. No citations. No links.
- Avoid politics/elections/geopolitics. Keep it strictly professional infrastructure/energy/AI sectors.
- Audience: executives in Grid, EPC/OEM, Renewables, Data Centers & AI, critical minerals.
- Tone: crisp, human, WSJ-like clarity (but not copying WSJ), neutral, professional.

OUTPUT:
- Return valid JSON only (no markdown).
- Match the schema exactly.
  `.trim();

  const user = `
Create today's PTD Today Daily AI Briefing for date_utc="${today}".

Return JSON with EXACT structure:

{
  "title": "PTD Today — Daily AI Briefing",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${today}",
  "sections": [
    { "heading": "Top Themes", "bullets": ["...","...","...","...","..."] },
    { "heading": "What to Watch (24–72h)", "bullets": ["...","...","...","...","..."] }
  ],
  "items": [
    {
      "id": "ai-${today.replaceAll("-","")}-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Oil & Gas" | "Markets" | "Critical Minerals" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "title": "Short headline (8–14 words)",
      "summary_short": "2–3 sentences. Executive preview. No claimed facts.",
      "body_long": "A longer human-style brief (120–220 words). Use careful language: signals, pressure points, timelines, constraints, procurement, capacity, interconnection, supply chain. No claimed facts.",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "tags": ["tag1","tag2","tag3"],
      "watchlist": ["bullet","bullet","bullet"],
      "action_for_readers": "1 sentence action"
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- confidence_score must be a float between 0.55 and 0.90.
- No links anywhere.
- No politics. No elections. No partisan or government drama.
- Make it feel like a sharp human editor wrote it.
  `.trim();

  const resp = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Force JSON object output
    text: { format: { type: "json_object" } },
  });

  const text = resp.output_text;
  if (!text) throw new Error("No output_text returned from model.");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(`Model returned non-JSON. First 200 chars: ${text.slice(0, 200)}`);
  }

  // Write outputs
  writeJson(path.join("data", "ai_news.json"), payload);
  writeJson(path.join("data", "briefs", "daily-ai.json"), payload);

  console.log("Wrote: data/ai_news.json");
  console.log("Wrote: data/briefs/daily-ai.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});