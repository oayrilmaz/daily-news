/**
 * PTD Today — Daily AI News Generator (JSON + Markdown)
 *
 * Output files:
 *   - briefs/daily-ai.json
 *   - briefs/daily-ai.md
 *
 * Notes:
 * - This generates ORIGINAL AI analysis-style content (not scraped, not copied).
 * - It does NOT claim real-time factual reporting unless you later add sources.
 * - Designed to be legally safer: "analysis + watchlist + scenarios" format.
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(process.cwd(), "briefs");
const OUT_JSON = path.join(OUT_DIR, "daily-ai.json");
const OUT_MD = path.join(OUT_DIR, "daily-ai.md");

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function isoDateUTC(d = new Date()) {
  // YYYY-MM-DD in UTC
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowISO() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeMd(s = "") {
  return String(s).replace(/\r\n/g, "\n").trim();
}

function toMarkdown(payload) {
  const { updated_at, date_utc, title, disclaimer, sections, items } = payload;

  const lines = [];
  lines.push(`# ${escapeMd(title)}`);
  lines.push(`Updated (UTC): **${escapeMd(updated_at)}**`);
  lines.push(`Date (UTC): **${escapeMd(date_utc)}**`);
  lines.push("");
  lines.push(`> ${escapeMd(disclaimer)}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Sections (editorial narrative)
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      lines.push(`## ${escapeMd(sec.heading || "Section")}`);
      if (Array.isArray(sec.bullets) && sec.bullets.length) {
        for (const b of sec.bullets) lines.push(`- ${escapeMd(b)}`);
      } else if (sec.text) {
        lines.push(escapeMd(sec.text));
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Today’s AI Brief Items");
  lines.push("");

  // Items (card-like entries)
  if (Array.isArray(items) && items.length) {
    items.forEach((it, idx) => {
      lines.push(`### ${idx + 1}) ${escapeMd(it.title)}`);
      lines.push(`**Category:** ${escapeMd(it.category)}  \n**Region:** ${escapeMd(it.region)}  \n**Confidence:** ${escapeMd(it.confidence_label)} (${it.confidence_score})`);
      if (it.tags?.length) lines.push(`**Tags:** ${it.tags.map(escapeMd).join(", ")}`);
      lines.push("");
      lines.push(escapeMd(it.summary));
      lines.push("");
      if (it.watchlist?.length) {
        lines.push("**Watchlist (next 24–72h):**");
        for (const w of it.watchlist) lines.push(`- ${escapeMd(w)}`);
        lines.push("");
      }
      if (it.action_for_readers) {
        lines.push(`**Action:** ${escapeMd(it.action_for_readers)}`);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    });
  } else {
    lines.push("_No items generated today._");
    lines.push("");
  }

  return lines.join("\n");
}

async function callOpenAIResponses({ apiKey, model, input }) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      // Keep it deterministic-ish for a daily brief
      temperature: 0.6,
      max_output_tokens: 1800,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${txt}`);
  }
  return res.json();
}

function extractOutputText(responseJson) {
  // Responses API returns output array; safest is to concatenate all output_text blocks
  const out = responseJson.output || [];
  let text = "";
  for (const item of out) {
    const content = item.content || [];
    for (const c of content) {
      if (c.type === "output_text" && c.text) text += c.text;
    }
  }
  return text.trim();
}

function safeJsonParse(s) {
  // Try strict parse, else try to salvage fenced code blocks
  try {
    return JSON.parse(s);
  } catch (_) {
    const m = s.match(/```json\s*([\s\S]*?)\s*```/i) || s.match(/```([\s\S]*?)```/i);
    if (m && m[1]) {
      return JSON.parse(m[1]);
    }
    throw new Error("Model returned non-JSON output (or invalid JSON).");
  }
}

async function main() {
  const apiKey = mustGetEnv("OPENAI_API_KEY");

  // You can switch models any time:
  // "gpt-5-mini" is cost-effective; "gpt-5.2" is stronger.
  const model = process.env.PTD_OPENAI_MODEL || "gpt-5-mini";

  const dateUTC = isoDateUTC();
  const updatedAt = nowISO();

  // ====== IMPORTANT: LEGAL/ETHICAL POSITIONING ======
  // We generate "AI brief" content: analysis, watchlist, scenarios, signals.
  // We avoid claiming “this happened today” unless later you provide sources.
  // ==================================================
  const systemStyle = `
You are PTD Today’s in-house energy & power sector analyst.
Write ORIGINAL content (do not copy, do not quote, do not summarize any specific outlet).
Do NOT claim verified real-world events without sources.
Instead, produce a daily "AI Brief": themes, signals, watchlist, plausible scenario-based insights.

Audience: power transmission / grid / OEM / EPC / renewables / data centers / critical minerals professionals.

Output MUST be valid JSON ONLY (no markdown, no extra text).
`;

  // JSON schema we want
  const schemaHint = {
    updated_at: updatedAt,
    date_utc: dateUTC,
    title: `PTD Today — Daily AI Intelligence Brief (${dateUTC} UTC)`,
    disclaimer:
      "AI-generated sector intelligence brief for informational purposes. It may contain errors and is not a substitute for verified reporting. Items are analysis-style signals and watchlists unless a source is explicitly provided elsewhere.",
    sections: [
      {
        heading: "Top Themes (AI)",
        bullets: [
          "3–6 concise bullets focused on grid, renewables, data centers, oil & gas infrastructure, critical minerals, OEM/EPC market signals.",
        ],
      },
      {
        heading: "What to Watch (24–72h)",
        bullets: [
          "3–6 bullets about what professionals should monitor: tenders, supply chain constraints, permitting, interconnection queues, transformer lead times, PPAs, hyperscaler power contracts, etc.",
        ],
      },
      {
        heading: "Risks & Constraints",
        bullets: ["3–6 bullets: schedule, permitting, financing, equipment, logistics, regulation, cybersecurity, safety."],
      },
      {
        heading: "Opportunities",
        bullets: ["3–6 bullets: where demand is rising, what services are needed, what roles are hiring, where vendors can win."],
      },
    ],
    items: [
      {
        id: "uuid-like",
        created_at: updatedAt,
        category: "grid|renewables|data-centers|oil-gas|critical-minerals|oem|epc|markets|policy",
        region: "US|EU|UK|MENA|APAC|Global",
        title: "Short headline",
        summary: "5–8 lines, original, analysis tone, no claims of verified breaking news.",
        tags: ["3–8 tags"],
        confidence_label: "Low|Medium|High",
        confidence_score: 0.0,
        watchlist: ["2–5 bullets (what to verify/monitor)"],
        action_for_readers: "One practical action (e.g., check tender portals, validate lead times, align staffing, contact vendors).",
      },
    ],
  };

  const userPrompt = `
Generate today's PTD Today Daily AI Intelligence Brief for ${dateUTC} (UTC).
Constraints:
- Allowed topics: Grid, AI + Data Centers power, Renewables, Oil & Gas infrastructure, Critical minerals, OEM/EPC, Transmission, Substations, HV equipment.
- Not allowed: politics/elections, hate, abuse, spam.
- Keep it professional, concise, executive-ready.
- Avoid stating unverified facts as if confirmed. Use analysis language (signals, scenarios, expectations, watchlist).
- Create 10 items in "items".

Return ONLY JSON matching this structure exactly (keys and types):
${JSON.stringify(schemaHint, null, 2)}
`;

  const response = await callOpenAIResponses({
    apiKey,
    model,
    input: [
      { role: "system", content: systemStyle },
      { role: "user", content: userPrompt },
    ],
  });

  const text = extractOutputText(response);
  const payload = safeJsonParse(text);

  // Minimal validation
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload object.");
  if (!Array.isArray(payload.items)) throw new Error("Payload missing items array.");
  if (!Array.isArray(payload.sections)) payload.sections = [];
  payload.updated_at = payload.updated_at || updatedAt;
  payload.date_utc = payload.date_utc || dateUTC;
  payload.title = payload.title || `PTD Today — Daily AI Intelligence Brief (${dateUTC} UTC)`;
  payload.disclaimer =
    payload.disclaimer ||
    "AI-generated sector intelligence brief for informational purposes. It may contain errors and is not a substitute for verified reporting.";

  // Ensure IDs
  payload.items = payload.items.map((it) => {
    if (!it.id || typeof it.id !== "string") it.id = `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!it.created_at) it.created_at = updatedAt;
    if (!it.confidence_label) it.confidence_label = "Medium";
    if (typeof it.confidence_score !== "number") it.confidence_score = 0.6;
    if (!Array.isArray(it.tags)) it.tags = [];
    if (!Array.isArray(it.watchlist)) it.watchlist = [];
    return it;
  });

  ensureDir(OUT_DIR);

  // Write JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  // Write Markdown
  const md = toMarkdown(payload);
  fs.writeFileSync(OUT_MD, md, "utf8");

  console.log(`✅ Wrote ${OUT_JSON}`);
  console.log(`✅ Wrote ${OUT_MD}`);
}

main().catch((err) => {
  console.error("❌ Daily AI news generation failed:");
  console.error(err);
  process.exit(1);
});