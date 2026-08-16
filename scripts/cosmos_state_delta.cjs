#!/usr/bin/env node
/**
 * PTD Today / Cosmos — State + Delta Engine v0.1
 *
 * Builds a deterministic daily world-state snapshot from the current knowledge
 * graph, then compares it with the previously committed Cosmos state.
 *
 * Outputs:
 *   knowledge/cosmos/state-current.json
 *   knowledge/cosmos/delta-current.json
 *   knowledge/cosmos/state-history/YYYY-MM-DD.json
 *   knowledge/cosmos/delta-history/YYYY-MM-DD.json
 *
 * First run is a cold start: it establishes the baseline and emits zero deltas.
 * No external npm packages required.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, "cosmos");
const STATE_HISTORY_DIR = path.join(COSMOS_DIR, "state-history");
const DELTA_HISTORY_DIR = path.join(COSMOS_DIR, "delta-history");

const FILES = {
  entities: path.join(ROOT, KNOWLEDGE_DIR, "entities.json"),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, "relationships.json"),
  developments: path.join(ROOT, KNOWLEDGE_DIR, "developments.json"),
  lifecycle: path.join(ROOT, KNOWLEDGE_DIR, "entity-lifecycle.json"),
  currentState: path.join(COSMOS_DIR, "state-current.json"),
  currentDelta: path.join(COSMOS_DIR, "delta-current.json")
};

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required file: ${path.relative(ROOT, file)}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function arrayFrom(value, preferredKeys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const v of Object.values(value)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normalizeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function entityId(entity) {
  return entity?.entity_id || entity?.id || null;
}

function relationshipEndpoints(rel) {
  return {
    from: rel?.from_entity_id || rel?.source_entity_id || rel?.subject_id || null,
    to: rel?.to_entity_id || rel?.target_entity_id || rel?.object_id || null
  };
}

function developmentId(dev) {
  return dev?.development_id || dev?.id || null;
}

function lifecycleLookup(lifecycle) {
  const lookup = new Map();
  const rankings = lifecycle?.rankings;
  if (!rankings || typeof rankings !== "object") return lookup;

  for (const list of Object.values(rankings)) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row?.entity_id) continue;
      const existing = lookup.get(row.entity_id) || {};
      lookup.set(row.entity_id, {
        ...existing,
        lifecycle_status: row.lifecycle_status ?? existing.lifecycle_status ?? null,
        importance_score: normalizeNumber(row.importance_score, existing.importance_score ?? null),
        momentum_score: normalizeNumber(row.momentum_score, existing.momentum_score ?? null),
        momentum_status: row.momentum_status ?? existing.momentum_status ?? null,
        last_seen_at: row.last_seen_at ?? existing.last_seen_at ?? null
      });
    }
  }
  return lookup;
}

function buildState() {
  const entitiesRaw = readJson(FILES.entities);
  const relationshipsRaw = readJson(FILES.relationships);
  const developmentsRaw = readJson(FILES.developments);
  const lifecycle = readJson(FILES.lifecycle);

  const entities = arrayFrom(entitiesRaw, ["entities", "items"]);
  const relationships = arrayFrom(relationshipsRaw, ["relationships", "items"]);
  const developments = arrayFrom(developmentsRaw, ["developments", "items"]);
  const life = lifecycleLookup(lifecycle);

  const degree = new Map();
  for (const rel of relationships) {
    const { from, to } = relationshipEndpoints(rel);
    if (from) degree.set(from, (degree.get(from) || 0) + 1);
    if (to) degree.set(to, (degree.get(to) || 0) + 1);
  }

  const devLinks = new Map();
  for (const dev of developments) {
    const ids = new Set();
    for (const e of Array.isArray(dev?.entities) ? dev.entities : []) {
      const id = e?.entity_id || e?.id;
      if (id) ids.add(id);
    }
    for (const id of Array.isArray(dev?.entity_ids) ? dev.entity_ids : []) {
      if (id) ids.add(id);
    }
    for (const id of ids) devLinks.set(id, (devLinks.get(id) || 0) + 1);
  }

  const stateEntities = {};
  for (const e of entities) {
    const id = entityId(e);
    if (!id) continue;
    const l = life.get(id) || {};
    stateEntities[id] = {
      entity_id: id,
      name: e?.name ?? e?.canonical_name ?? null,
      slug: e?.slug ?? null,
      type: e?.type ?? e?.entity_type ?? null,
      lifecycle_status: e?.lifecycle_status ?? l.lifecycle_status ?? null,
      importance_score: normalizeNumber(e?.importance_score, l.importance_score ?? null),
      momentum_score: normalizeNumber(e?.momentum_score, l.momentum_score ?? null),
      momentum_status: e?.momentum_status ?? l.momentum_status ?? null,
      first_seen_at: e?.first_seen_at ?? e?.first_seen ?? null,
      last_seen_at: e?.last_seen_at ?? e?.last_seen ?? l.last_seen_at ?? null,
      relationship_degree: degree.get(id) || 0,
      linked_development_count: devLinks.get(id) || 0
    };
  }

  return {
    schema_version: "0.1",
    generated_at: new Date().toISOString(),
    date_utc: new Date().toISOString().slice(0, 10),
    source: "PTD Today knowledge graph",
    totals: {
      entities: Object.keys(stateEntities).length,
      relationships: relationships.length,
      developments: developments.length,
      lifecycle_history_coverage_days: normalizeNumber(lifecycle?.methodology?.history_coverage_days, 0),
      lifecycle_measured_momentum_count: normalizeNumber(lifecycle?.totals?.measured_momentum_count, 0),
      lifecycle_insufficient_history_count: normalizeNumber(lifecycle?.totals?.insufficient_history_count, 0)
    },
    lifecycle_by_status: lifecycle?.by_status || {},
    entities: stateEntities
  };
}

function changedFields(before, after) {
  const fields = [
    "name", "type", "lifecycle_status", "importance_score", "momentum_score",
    "momentum_status", "last_seen_at", "relationship_degree", "linked_development_count"
  ];
  const changes = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { from: a, to: b };
  }
  return changes;
}

function buildDelta(previous, current) {
  const coldStart = !previous || !previous.entities;
  const delta = {
    schema_version: "0.1",
    generated_at: new Date().toISOString(),
    date_utc: current.date_utc,
    previous_state_generated_at: previous?.generated_at || null,
    current_state_generated_at: current.generated_at,
    cold_start: coldStart,
    summary: {
      added_entities: 0,
      removed_entities: 0,
      changed_entities: 0,
      unchanged_entities: 0,
      lifecycle_transitions: 0,
      relationship_degree_changes: 0,
      linked_development_count_changes: 0
    },
    graph_delta: {
      entities: coldStart ? 0 : current.totals.entities - (previous?.totals?.entities || 0),
      relationships: coldStart ? 0 : current.totals.relationships - (previous?.totals?.relationships || 0),
      developments: coldStart ? 0 : current.totals.developments - (previous?.totals?.developments || 0)
    },
    added_entities: [],
    removed_entities: [],
    changed_entities: []
  };

  if (coldStart) {
    delta.summary.unchanged_entities = current.totals.entities;
    return delta;
  }

  const prev = previous.entities || {};
  const curr = current.entities || {};

  for (const [id, entity] of Object.entries(curr)) {
    if (!prev[id]) {
      delta.added_entities.push(entity);
      continue;
    }
    const changes = changedFields(prev[id], entity);
    if (Object.keys(changes).length) {
      delta.changed_entities.push({
        entity_id: id,
        name: entity.name,
        type: entity.type,
        changes
      });
    } else {
      delta.summary.unchanged_entities += 1;
    }
  }

  for (const [id, entity] of Object.entries(prev)) {
    if (!curr[id]) delta.removed_entities.push(entity);
  }

  delta.summary.added_entities = delta.added_entities.length;
  delta.summary.removed_entities = delta.removed_entities.length;
  delta.summary.changed_entities = delta.changed_entities.length;

  for (const row of delta.changed_entities) {
    if (row.changes.lifecycle_status) delta.summary.lifecycle_transitions += 1;
    if (row.changes.relationship_degree) delta.summary.relationship_degree_changes += 1;
    if (row.changes.linked_development_count) delta.summary.linked_development_count_changes += 1;
  }

  return delta;
}

function main() {
  fs.mkdirSync(STATE_HISTORY_DIR, { recursive: true });
  fs.mkdirSync(DELTA_HISTORY_DIR, { recursive: true });

  const previous = readJson(FILES.currentState, false);
  const current = buildState();
  const delta = buildDelta(previous, current);

  writeJson(FILES.currentState, current);
  writeJson(FILES.currentDelta, delta);
  writeJson(path.join(STATE_HISTORY_DIR, `${current.date_utc}.json`), current);
  writeJson(path.join(DELTA_HISTORY_DIR, `${current.date_utc}.json`), delta);

  console.log("\n=== PTD Today / Cosmos State + Delta ===");
  console.log(`Date:                 ${current.date_utc}`);
  console.log(`Cold start:           ${delta.cold_start}`);
  console.log(`Entities:             ${current.totals.entities}`);
  console.log(`Relationships:        ${current.totals.relationships}`);
  console.log(`Developments:         ${current.totals.developments}`);
  console.log(`Added entities:       ${delta.summary.added_entities}`);
  console.log(`Removed entities:     ${delta.summary.removed_entities}`);
  console.log(`Changed entities:     ${delta.summary.changed_entities}`);
  console.log(`Lifecycle transitions:${delta.summary.lifecycle_transitions}`);
  console.log(`Graph Δ entities:     ${delta.graph_delta.entities}`);
  console.log(`Graph Δ relationships:${delta.graph_delta.relationships}`);
  console.log(`Graph Δ developments: ${delta.graph_delta.developments}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}




name: Home AI + Video (PTD Today)

on:
  workflow_dispatch:

  # Run once per day to control OpenAI usage and operating cost.
  # 05:15 UTC = 08:15 Türkiye time during UTC+3.
  schedule:
    - cron: "15 5 * * *"

permissions:
  contents: write

concurrency:
  group: home-ai-ptdtoday
  cancel-in-progress: true

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      # ----------------------------------------------------------------------
      # 1. Repository and runtime
      # ----------------------------------------------------------------------

      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Sync with latest main
        run: |
          git fetch origin main
          git checkout main
          git reset --hard origin/main

      - name: Cosmos Preflight Syntax Check
        run: |
          node --check scripts/generate_ai_news.js
          node --check scripts/validate_intelligence.cjs
          node --check scripts/normalize_map_signals.cjs
          node --check scripts/cosmos_state_delta.cjs

      # ----------------------------------------------------------------------
      # 2. Existing PTD Today source feeds
      # ----------------------------------------------------------------------

      - name: Build Home feed + YouTube + short share pages
        env:
          RECENT_HOURS: "60"
          YT_HOURS: "168"
          CONCURRENCY: "6"
          YT_MAX_PER_CHANNEL: "8"
          MAX_ENRICH: "50"
        run: node scripts/build.mjs

      # ----------------------------------------------------------------------
      # 3. Generate structured daily intelligence
      # ----------------------------------------------------------------------

      - name: Generate Daily AI JSON + Article Pages
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          SITE_ORIGIN: https://ptdtoday.com
          KNOWLEDGE_DIR: knowledge
          HISTORY_DIR: history
          BRIEFS_DIR: briefs
          ARTICLES_DIR: articles
          MAP_SIGNAL_LIMIT: "50"
        run: npm run generate:ai

      # ----------------------------------------------------------------------
      # 4. Resolve duplicate entities and repair graph references
      # ----------------------------------------------------------------------

      - name: Resolve Entities + Repair Knowledge Graph
        env:
          KNOWLEDGE_DIR: knowledge
        run: node scripts/resolve_entities.js

      # ----------------------------------------------------------------------
      # 5. Calculate lifecycle after graph resolution
      # ----------------------------------------------------------------------

      - name: Update Entity Lifecycle + Time Machine Snapshot
        env:
          KNOWLEDGE_DIR: knowledge
        run: node scripts/update_entity_lifecycle.js

      # ----------------------------------------------------------------------
      # 5A. Normalize map signals after entity resolution
      # ----------------------------------------------------------------------

      - name: Normalize Map Signals for Cosmos
        env:
          BRIEFS_DIR: briefs
          KNOWLEDGE_DIR: knowledge
        run: node scripts/normalize_map_signals.cjs

      # ----------------------------------------------------------------------
      # 5B. Generate country-specific map-share HTML pages
      #
      # This step reads briefs/map-signals.json and creates static pages such as:
      #   map-share/united-states.html
      #   map-share/germany.html
      #   map-share/france.html
      #
      # LinkedIn/social crawlers can read the Open Graph tags from these static
      # pages. Human visitors are redirected to the live PTD Today map with the
      # selected country already applied.
      #
      # No separate Python file is required; the generator is embedded here.
      # ----------------------------------------------------------------------

      - name: Generate Country Map Share Pages
        shell: bash
        run: |
          python3 <<'PY'
          from pathlib import Path
          from urllib.parse import quote
          import json
          import re
          import html

          BASE_URL = "https://ptdtoday.com"
          SRC = Path("briefs/map-signals.json")
          OUT = Path("map-share")
          OUT.mkdir(parents=True, exist_ok=True)

          COUNTRY_REGION = {
              "Algeria":"Africa",
              "Argentina":"LATAM",
              "Australia":"Asia",
              "Belgium":"Europe",
              "Brazil":"LATAM",
              "Canada":"North America",
              "Chile":"LATAM",
              "China":"Asia",
              "Colombia":"LATAM",
              "Denmark":"Europe",
              "Egypt":"Middle East",
              "Finland":"Europe",
              "France":"Europe",
              "Germany":"Europe",
              "Greece":"Europe",
              "India":"Asia",
              "Indonesia":"Asia",
              "Israel":"Middle East",
              "Italy":"Europe",
              "Japan":"Asia",
              "Kenya":"Africa",
              "Malaysia":"Asia",
              "Mexico":"North America",
              "Morocco":"Africa",
              "Netherlands":"Europe",
              "New Zealand":"Asia",
              "Nigeria":"Africa",
              "Norway":"Europe",
              "Oman":"Middle East",
              "Peru":"LATAM",
              "Philippines":"Asia",
              "Poland":"Europe",
              "Portugal":"Europe",
              "Qatar":"Middle East",
              "Saudi Arabia":"Middle East",
              "Singapore":"Asia",
              "South Africa":"Africa",
              "South Korea":"Asia",
              "Spain":"Europe",
              "Sweden":"Europe",
              "Thailand":"Asia",
              "Turkey":"Middle East",
              "Türkiye":"Middle East",
              "United Arab Emirates":"Middle East",
              "United Kingdom":"Europe",
              "United States":"North America",
              "Vietnam":"Asia",
              "Democratic Republic of the Congo":"Africa"
          }

          VALID_COUNTRIES = set(COUNTRY_REGION.keys())

          def slugify(value):
              value = str(value or "").strip()
              value = value.replace("Türkiye", "Turkey").lower()
              value = re.sub(r"[^a-z0-9]+", "-", value)
              return value.strip("-")

          def esc(value):
              return html.escape(str(value or ""), quote=True)

          def clean_text(value):
              return re.sub(r"\s+", " ", str(value or "")).strip()

          def truncate(value, limit=290):
              value = clean_text(value)
              if len(value) <= limit:
                  return value
              return value[:limit - 1].rstrip() + "…"

          if not SRC.exists():
              raise SystemExit(f"Missing required file: {SRC}")

          payload = json.loads(SRC.read_text(encoding="utf-8"))
          signals = payload.get("signals", [])

          if not isinstance(signals, list):
              raise SystemExit("briefs/map-signals.json does not contain a valid signals[] array.")

          grouped = {}

          for signal in signals:
              raw_countries = signal.get("countries", [])

              if not isinstance(raw_countries, list):
                  raw_countries = []

              # IMPORTANT:
              # Some transitional map-signals data has contained non-country tags
              # inside countries[]. Only valid country names are allowed here.
              countries = [
                  country for country in raw_countries
                  if country in VALID_COUNTRIES
              ]

              for country in countries:
                  grouped.setdefault(country, []).append(signal)

          # Remove old generated country pages so deleted countries/signals do not
          # leave stale share pages behind.
          for old_page in OUT.glob("*.html"):
              old_page.unlink()

          generated = 0

          for country, items in sorted(grouped.items()):
              # Deduplicate signals for each country.
              seen = set()
              unique_items = []

              for item in items:
                  key = (
                      item.get("signal_id")
                      or item.get("dedup_key")
                      or item.get("id")
                      or item.get("title")
                  )

                  if key in seen:
                      continue

                  seen.add(key)
                  unique_items.append(item)

              items = unique_items

              slug = slugify(country)
              if not slug:
                  continue

              share_url = f"{BASE_URL}/map-share/{slug}.html"
              destination = f"{BASE_URL}/?country={quote(country)}"

              headlines = [
                  clean_text(item.get("title"))
                  for item in items
                  if clean_text(item.get("title"))
              ][:3]

              count = len(items)
              title = f"{country} Power Intelligence | PTD Today"

              if headlines:
                  description = truncate(
                      f"{count} current intelligence signal"
                      f"{'' if count == 1 else 's'} for {country}: "
                      + " • ".join(headlines)
                  )
              else:
                  description = truncate(
                      f"Explore today's power-grid, substation, data-center, "
                      f"renewable and infrastructure intelligence associated with {country}."
                  )

              # Use the default PTD Today OG image for now.
              # Later this can be replaced with a country-specific generated image.
              og_image = f"{BASE_URL}/assets/og-default.png"

              bullets = "\n".join(
                  f"        <li>{esc(headline)}</li>"
                  for headline in headlines
              )

              generated_at = payload.get("generated_at", "")

              page = f"""<!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">

            <title>{esc(title)}</title>
            <meta name="description" content="{esc(description)}">
            <link rel="canonical" href="{esc(share_url)}">

            <meta property="og:type" content="website">
            <meta property="og:site_name" content="PTD Today">
            <meta property="og:title" content="{esc(title)}">
            <meta property="og:description" content="{esc(description)}">
            <meta property="og:url" content="{esc(share_url)}">
            <meta property="og:image" content="{esc(og_image)}">
            <meta property="og:image:width" content="1200">
            <meta property="og:image:height" content="630">

            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:title" content="{esc(title)}">
            <meta name="twitter:description" content="{esc(description)}">
            <meta name="twitter:image" content="{esc(og_image)}">

            <script>
              /*
                Human visitors go to the live PTD Today interactive map with the
                selected country already applied.

                Social crawlers normally do not execute this JavaScript, so they
                continue to read the Open Graph metadata above.
              */
              window.location.replace({json.dumps(destination)});
            </script>
          </head>

          <body>
            <main>
              <h1>{esc(title)}</h1>
              <p>{esc(description)}</p>

              <ul>
          {bullets}
              </ul>

              <p>
                <a href="{esc(destination)}">
                  Open {esc(country)} Power Intelligence on PTD Today
                </a>
              </p>

              <small>
                Generated from PTD Today map intelligence:
                {esc(generated_at)}
              </small>
            </main>
          </body>
          </html>
          """

              (OUT / f"{slug}.html").write_text(page, encoding="utf-8")
              generated += 1

          print(f"Generated {generated} country map-share page(s) in {OUT}/")

          if generated == 0:
              print("WARNING: No valid country share pages were generated.")
          PY

      # ----------------------------------------------------------------------
      # 6. Cosmos Foundation Gate
      #
      # Strict production mode: corrupted structural intelligence must not
      # continue into historical ingestion.
      # ----------------------------------------------------------------------

      - name: Cosmos Intelligence Integrity Gate
        env:
          BRIEFS_DIR: briefs
          KNOWLEDGE_DIR: knowledge
          INTEGRITY_STRICT: "true"
        run: node scripts/validate_intelligence.cjs

      # ----------------------------------------------------------------------
      # 6A. Cosmos State + Delta Engine
      # Runs only after the strict integrity gate passes.
      # First production run establishes a cold-start baseline.
      # ----------------------------------------------------------------------

      - name: Build Cosmos State + Delta
        env:
          KNOWLEDGE_DIR: knowledge
        run: node scripts/cosmos_state_delta.cjs

      # ----------------------------------------------------------------------
      # 7. Rebuild historical analytics from accumulated intelligence
      # ----------------------------------------------------------------------

      - name: Rebuild Historical Intelligence
        run: node scripts/backfill_history_from_articles.js

      # ----------------------------------------------------------------------
      # 8. Generate Media intelligence
      # ----------------------------------------------------------------------

      - name: Generate Media (YouTube → AI summaries)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          SITE_ORIGIN: https://ptdtoday.com

          # Output sizing
          MEDIA_MAX_VIDEOS: "18"
          MEDIA_MAX_PER_CHANNEL: "2"

          # Lookback + auto-expand when too few
          MEDIA_LOOKBACK_HOURS: "168"
          MEDIA_MIN_ITEMS: "10"
          MEDIA_EXPAND_HOURS_IF_LOW: "720"

          # Filtering
          MEDIA_FILTER_MODE: "hybrid"
          MEDIA_MIN_MATCH_SCORE: "1"
          MEDIA_MAX_FILTER_AI: "40"
          MEDIA_CAPTIONS_LANG: "en"

          # Channels
          MEDIA_CHANNELS: >-
            https://www.youtube.com/@HitachiEnergy,
            https://www.youtube.com/@SiemensEnergy,
            https://www.youtube.com/@SchneiderElectric,
            https://www.youtube.com/@ABB,
            https://www.youtube.com/@GEVernova,
            https://www.youtube.com/@eaton,
            https://www.youtube.com/@microsoftdatacenters,
            https://www.youtube.com/@GoogleCloudTech,
            https://www.youtube.com/@IEA,
            https://www.youtube.com/@NREL,
            https://www.youtube.com/@USDepartmentofEnergy,
            https://www.youtube.com/@ENERGYSTAR,
            https://www.youtube.com/@PJMInterconnection,
            https://www.youtube.com/@ERCOTISO,
            https://www.youtube.com/@NationalGridUK,
            https://www.youtube.com/@DukeEnergy,
            https://www.youtube.com/@EPRI,
            https://www.youtube.com/@IEEEorg,
            https://www.youtube.com/@CIGRE,
            https://www.youtube.com/@ElectricPowerResearch,
            https://www.youtube.com/@BloombergTV,
            https://www.youtube.com/@CNBC,
            https://www.youtube.com/@FoxBusiness,
            https://www.youtube.com/@Reuters,
            https://www.youtube.com/@WSJ,
            https://www.youtube.com/@FinancialTimes,
            https://www.youtube.com/@TheEconomist,
            https://www.youtube.com/@MarketWatch,
            https://www.youtube.com/@TheVerge,
            https://www.youtube.com/@TechCrunch,
            https://www.youtube.com/@MITTechnologyReview,
            https://www.youtube.com/@McKinsey,
            https://www.youtube.com/@DeloitteUS,
            https://www.youtube.com/@PwC,
            https://www.youtube.com/@KPMG,
            https://www.youtube.com/@NVIDIA,
            https://www.youtube.com/@Intel,
            https://www.youtube.com/@Google,
            https://www.youtube.com/@Microsoft,
            https://www.youtube.com/@AmazonWebServices
        run: node scripts/generate_media.js

      # ----------------------------------------------------------------------
      # 9. Validate every critical output before committing
      # ----------------------------------------------------------------------

      - name: Verify Briefing and Historical Files
        run: |
          test -f briefs/daily-ai.json
          test -f briefs/map-signals.json
          test -f briefs/trends.json
          test -f briefs/outlook.json
          test -d history
          test -d map-share

          MAP_SHARE_COUNT="$(find map-share -maxdepth 1 -type f -name '*.html' | wc -l)"
          echo "Country map-share pages: ${MAP_SHARE_COUNT}"

          if [ "${MAP_SHARE_COUNT}" -lt 1 ]; then
            echo "ERROR: No country map-share HTML pages were generated."
            exit 1
          fi

          echo "Briefing, historical intelligence, and country map-share files are ready."

      - name: Verify Knowledge Graph Files
        run: |
          test -f knowledge/developments.json
          test -f knowledge/entities.json
          test -f knowledge/relationships.json
          test -f knowledge/timeline-events.json
          test -f knowledge/knowledge-diff.json
          test -f knowledge/entity-resolution-report.json
          test -f knowledge/integrity-report.json
          test -f knowledge/map-signals-normalization-report.json
          test -f knowledge/cosmos/state-current.json
          test -f knowledge/cosmos/delta-current.json
          test -f "knowledge/cosmos/state-history/$(date -u +%F).json"
          test -f "knowledge/cosmos/delta-history/$(date -u +%F).json"
          echo "Core knowledge graph, Cosmos integrity, state, and delta outputs are ready."

      - name: Verify Entity Lifecycle and Snapshot
        run: |
          TODAY_UTC="$(date -u +%F)"

          test -f knowledge/entity-lifecycle.json
          test -f "knowledge/snapshots/${TODAY_UTC}.json"

          echo "Entity lifecycle and Time Machine snapshot are ready."
          echo "Snapshot: knowledge/snapshots/${TODAY_UTC}.json"

      # ----------------------------------------------------------------------
      # 10. Commit all automatically generated knowledge
      # ----------------------------------------------------------------------

      - name: Commit & push if changed
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@users.noreply.github.com"

          git add -A

          if git diff --cached --quiet; then
            echo "No changes to commit."
            exit 0
          fi

          git commit -m "Update PTD Today living intelligence"
          git push origin main
