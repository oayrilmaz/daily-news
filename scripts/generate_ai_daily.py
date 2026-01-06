# scripts/generate_ai_daily.py
#
# PTD Today — Daily AI News Generator
# - Generates ORIGINAL PTD AI "news-style intelligence" items (no competitor references)
# - Writes to: data/ai_daily.json
#
# Notes:
# - Uses OpenAI Responses API
# - Output is intentionally structured & conservative (confidence + tags)
# - If no API key, writes a stub but still creates the file

import os, json, hashlib
from datetime import datetime, timezone
from urllib.request import Request, urlopen

OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
OPENAI_MODEL = os.getenv("PTD_OPENAI_MODEL", "gpt-4.1-mini")

OUT_PATH = "data/ai_daily.json"

ALLOWED_TAGS = [
  "Grid", "Transmission", "Substations", "HVDC",
  "AI", "Data Centers", "Chips",
  "Renewables", "Storage", "Oil & Gas", "EPC", "OEM",
  "Permitting", "Interconnection", "Markets", "Policy"
]

def now_iso():
  return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def save_json(path, obj):
  parent = os.path.dirname(path)
  if parent:
    os.makedirs(parent, exist_ok=True)
  with open(path, "w", encoding="utf-8") as f:
    json.dump(obj, f, ensure_ascii=False, indent=2)

def sha(s: str) -> str:
  import hashlib
  return hashlib.sha256(s.encode("utf-8")).hexdigest()

def write_stub(reason: str):
  payload = {
    "updated_at": now_iso(),
    "items": [],
    "note": reason
  }
  save_json(OUT_PATH, payload)

def call_openai_responses(system_text: str, user_text: str) -> str:
  key = os.getenv(OPENAI_API_KEY_ENV, "").strip()
  if not key:
    raise RuntimeError(f"Missing env var {OPENAI_API_KEY_ENV}")

  url = "https://api.openai.com/v1/responses"
  payload = {
    "model": OPENAI_MODEL,
    "input": [
      {"role": "system", "content": system_text},
      {"role": "user", "content": user_text}
    ]
  }

  req = Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={
      "Authorization": f"Bearer {key}",
      "Content-Type": "application/json"
    },
    method="POST"
  )

  with urlopen(req, timeout=75) as resp:
    out = resp.read().decode("utf-8", errors="replace")

  j = json.loads(out)
  if isinstance(j, dict) and isinstance(j.get("output_text"), str):
    return j["output_text"].strip()

  # fallback parse
  texts = []
  for block in j.get("output", []) if isinstance(j, dict) else []:
    for c in block.get("content", []) if isinstance(block, dict) else []:
      if isinstance(c, dict) and c.get("type") == "output_text":
        texts.append(c.get("text", ""))
  return "\n".join(texts).strip()

def main():
  system_text = (
    "You are the PTD Today Intelligence Desk.\n"
    "Generate ORIGINAL daily intelligence news for Energy, Power Grid, AI Infrastructure,\n"
    "Data Centers, Renewables, Oil & Gas (infrastructure only), EPC/OEM and HV sectors.\n\n"
    "CRITICAL RULES:\n"
    "- Do NOT summarize or rewrite other publications.\n"
    "- Do NOT reference magazines/blogs/news outlets.\n"
    "- Do NOT claim specific events happened unless you are certain.\n"
    "- Use neutral, analyst tone.\n"
    "- Mark uncertainty clearly.\n\n"
    "OUTPUT MUST BE VALID JSON ONLY (no markdown, no extra text).\n"
  )

  # We generate "Day-1 style" items (original, plausible, conservative).
  user_text = (
    "Create 6 ORIGINAL PTD AI intelligence items for 'today'.\n\n"
    "Return JSON with this exact shape:\n"
    "{\n"
    "  \"items\": [\n"
    "    {\n"
    "      \"id\": \"sha256\",\n"
    "      \"published_at\": \"ISO-8601 Z\",\n"
    "      \"title\": \"string\",\n"
    "      \"summary\": \"2-3 sentences\",\n"
    "      \"why_it_matters\": {\n"
    "        \"Grid\": [\"bullet\", \"bullet\"],\n"
    "        \"DataCentersAI\": [\"bullet\"],\n"
    "        \"Renewables\": [],\n"
    "        \"OilGas\": []\n"
    "      },\n"
    "      \"confidence\": \"High|Medium|Low\",\n"
    "      \"tags\": [\"Tag\", \"Tag\"],\n"
    "      \"source_type\": \"PTD_AI\"\n"
    "    }\n"
    "  ]\n"
    "}\n\n"
    "CONSTRAINTS:\n"
    "- Keep it focused on: grid/transmission/substations/HVDC, AI+data centers load growth,\n"
    "  renewables/storage integration, oil&gas infrastructure, EPC/OEM supply chain, permitting/interconnection.\n"
    "- Avoid politics/elections/geopolitics.\n"
    "- Make the items 'intelligence desk' style: signals + implications.\n"
    "- Tags must be chosen from this allowed list ONLY:\n"
    f"{json.dumps(ALLOWED_TAGS)}\n"
    "- Use empty arrays when a sector is not relevant.\n"
    "- published_at must be now.\n"
    "- id must be sha256 of title + summary.\n"
  )

  key = os.getenv(OPENAI_API_KEY_ENV, "").strip()
  if not key:
    write_stub("OPENAI_API_KEY not set. Add it to GitHub Actions Secrets to generate AI daily items.")
    return

  raw = call_openai_responses(system_text, user_text)

  try:
    data = json.loads(raw)
  except Exception:
    # If model returns non-JSON for any reason, fail safely
    write_stub("AI returned invalid JSON. Check generator prompt/model.")
    return

  items = data.get("items", [])
  now = now_iso()

  cleaned = []
  for it in items:
    title = str(it.get("title", "")).strip()
    summary = str(it.get("summary", "")).strip()

    if not title or not summary:
      continue

    _id = sha(title + "||" + summary)
    tags = it.get("tags", [])
    if not isinstance(tags, list):
      tags = []

    # enforce allowed tags only
    tags = [t for t in tags if t in ALLOWED_TAGS]

    why = it.get("why_it_matters", {}) if isinstance(it.get("why_it_matters"), dict) else {}
    why_clean = {
      "Grid": why.get("Grid", []) if isinstance(why.get("Grid", []), list) else [],
      "DataCentersAI": why.get("DataCentersAI", []) if isinstance(why.get("DataCentersAI", []), list) else [],
      "Renewables": why.get("Renewables", []) if isinstance(why.get("Renewables", []), list) else [],
      "OilGas": why.get("OilGas", []) if isinstance(why.get("OilGas", []), list) else []
    }

    conf = it.get("confidence", "Low")
    if conf not in ["High", "Medium", "Low"]:
      conf = "Low"

    cleaned.append({
      "id": _id,
      "published_at": now,
      "title": title,
      "summary": summary,
      "why_it_matters": why_clean,
      "confidence": conf,
      "tags": tags,
      "source_type": "PTD_AI"
    })

  payload = {
    "updated_at": now,
    "items": cleaned
  }

  save_json(OUT_PATH, payload)

if __name__ == "__main__":
  main()