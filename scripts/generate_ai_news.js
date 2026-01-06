// scripts/generate_ai_news.js
// Generates a DAILY AI INTELLIGENCE BRIEF (not “verified news”) for PTD Today.
// Output: data/ai_news.json (for Home) + briefs/daily-ai.json (for Briefs page)

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
  // IMPORTANT: keep API key ONLY in secrets/env (never in HTML/JS front-end).
  // OpenAI recommends using env vars for keys.  [oai_citation:0‡OpenAI Platform](https://platform.openai.com/docs/api-reference/introduction?utm_source=chatgpt.com)
  const apiKey = mustEnv("OPENAI_API_KEY");
  const client = new OpenAI({ apiKey });

  const today = utcDateOnly();
  const now = isoNow();

  // We will generate “AI brief” (signals, expectations, scenarios),
  // NOT factual “news” unless you feed verified sources.
  const system = `
You are PTD Today’s Daily AI Intelligence Brief generator.

CRITICAL RULES:
- Do NOT present unverified real-world events as facts.
- If you are not given sources, write as: "signals", "expectations", "scenario watch", "what to monitor".
- Avoid naming/quoting specific articles, magazines, or publishers.
- Keep it useful for: power grid, transmission, substations, HV equipment, EPC/OEM, data centers power, renewables, critical minerals, AI-in-energy.
- Output MUST be valid JSON that matches the schema exactly.
- No markdown, no extra text.

STYLE:
- Short, punchy, executive tone.
- Actionable watch items for next 24–72h.
`;

  // JSON schema-ish instruction (keeps the output stable)
  const user = `
Generate today's brief for date_utc = "${today}".
Return JSON with this exact structure:

{
  "title": "PTD Today — Daily AI Intelligence Brief",
  "disclaimer": "Informational only — AI-generated; may contain errors. Not investment or engineering advice.",
  "updated_at": "${now}",
  "date_utc": "${today}",
  "sections": [
    { "heading": "Top Themes", "bullets": ["...","..."] },
    { "heading": "What to Watch (24–72h)", "bullets": ["...","..."] }
  ],
  "items": [
    {
      "id": "ai-YYYYMMDD-001",
      "created_at": "${now}",
      "category": "Power Grid" | "Substations" | "Data Centers" | "Renewables" | "Markets" | "Critical Minerals" | "Policy" | "OEM/EPC",
      "region": "Global" | "North America" | "Europe" | "Middle East" | "Asia" | "LATAM" | "Africa",
      "title": "Short headline",
      "summary": "2–3 sentences. MUST be framed as intelligence/scenario, not claimed facts.",
      "confidence_label": "Low" | "Medium" | "High",
      "confidence_score": 0.0,
      "tags": ["tag1","tag2"],
      "watchlist": ["bullet", "bullet"],
      "action_for_readers": "1 sentence action"
    }
  ]
}

REQUIREMENTS:
- Exactly 10 items.
- confidence_score between 0.55 and 0.90 (float).
- ids must be unique.
- No publisher names, no 'Source:' lines, no links.
`;

  // Use Structured Outputs guide approach (JSON-only).  [oai_citation:1‡OpenAI Platform](https://platform.openai.com/docs/guides/structured-outputs?utm_source=chatgpt.com)
  const resp = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      { role: "system", content: system.trim() },
      { role: "user", content: user.trim() }
    ],
    // Strongly encourage JSON-only
    text: { format: { type: "json_object" } }
  });

  // The SDK returns text in output_text for many responses
  const text = resp.output_text;
  if (!text) throw new Error("No output_text returned from OpenAI");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(`Model returned non-JSON. First 200 chars: ${text.slice(0, 200)}`);
  }

  // Write TWO files so Home + Briefs can read different endpoints if you want
  writeJson(path.join("data", "ai_news.json"), payload);
  writeJson(path.join("briefs", "daily-ai.json"), payload);

  console.log("Wrote: data/ai_news.json and briefs/daily-ai.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});