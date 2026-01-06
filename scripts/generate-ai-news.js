# scripts/generate_ai_news.py
import os, json, datetime
from openai import OpenAI

# Output path inside your repo (make sure this folder exists)
OUT_PATH = "public/data/ai_news.json"

PTD_SECTORS = [
    "Power transmission & substations (AIS/GIS, transformers, switchgear)",
    "HVDC / FACTS / synchronous condensers",
    "Grid modernization, interconnection queues, TSO/ISO updates",
    "Renewables (wind/solar) and grid integration",
    "Data centers, AI load growth, utility power contracts",
    "Critical minerals / rare earth supply chains (for grid & energy tech)",
]

def iso_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def main():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("Missing OPENAI_API_KEY env var")

    client = OpenAI()

    # IMPORTANT:
    # If you do NOT provide sources, the result is not “news”, it’s speculative.
    # So we keep a “Sources” section and you can feed your own approved source list later.
    prompt = f"""
You are PTD Today’s daily energy & power newsroom editor.

Write a DAILY INTELLIGENCE BRIEF for the current UTC date.
Focus only on these sectors:
{chr(10).join([f"- {s}" for s in PTD_SECTORS])}

Rules:
- Output MUST be valid JSON only (no markdown).
- Include 8–12 items max.
- Each item must have:
  - title (short)
  - summary (2–4 sentences, professional, neutral tone)
  - category (one of: Grid, Substations, HVDC_FACTS, Renewables, DataCenters_AI, CriticalMinerals, Markets, Policy)
  - region (Global / US / Europe / MiddleEast / Asia / Africa / LatAm)
  - confidence (0.0–1.0)
  - sources: array of objects with {{"name","url"}} (publicly available sources)
- If you are not confident about a claim, lower confidence and state uncertainty in the summary.

Return JSON with:
{{
  "updated_at": "...ISO8601Z...",
  "items": [ ... ]
}}
"""

    # Responses API example is in OpenAI docs.  [oai_citation:0‡OpenAI Platform](https://platform.openai.com/docs/guides/reasoning)
    response = client.responses.create(
        model="gpt-5-mini",
        input=prompt,
        reasoning={"effort": "low"},
    )

    # The python SDK provides output_text for convenience in many setups,
    # but to be safe, we reconstruct from response.output if needed.
    text = getattr(response, "output_text", None)
    if not text:
        # Fallback: find first output_text chunk
        text = ""
        for item in response.output:
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        text += c.get("text", "")

    data = json.loads(text)
    data["updated_at"] = iso_now()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT_PATH} with {len(data.get('items', []))} items")

if __name__ == "__main__":
    main()