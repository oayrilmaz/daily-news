#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Permanent Map Signal Normalizer
 *
 * Runs after entity resolution and lifecycle generation, before the strict
 * Cosmos integrity gate.
 *
 * It:
 * - keeps all current map signals
 * - removes non-country values from countries[]
 * - preserves removed values in tags[]
 * - repairs legacy timestamps when safely inferable
 * - deduplicates entity_ids
 * - removes orphan entity references after entity resolution
 * - rebuilds map metadata and coverage
 *
 * Output:
 *   briefs/map-signals.json
 *   knowledge/map-signals-normalization-report.json
 *
 * No OpenAI/API calls. No external npm package required.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BRIEFS_DIR = process.env.BRIEFS_DIR || "briefs";
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";

const MAP_FILE = path.join(ROOT, BRIEFS_DIR, "map-signals.json");
const ENTITIES_FILE = path.join(ROOT, KNOWLEDGE_DIR, "entities.json");
const REPORT_FILE = path.join(
  ROOT,
  KNOWLEDGE_DIR,
  "map-signals-normalization-report.json"
);

const VALID_COUNTRIES = new Set([
  "Algeria","Argentina","Australia","Belgium","Brazil","Canada","Chile","China",
  "Colombia","Denmark","Egypt","Finland","France","Germany","Greece","India",
  "Indonesia","Israel","Italy","Japan","Kenya","Malaysia","Mexico","Morocco",
  "Netherlands","New Zealand","Nigeria","Norway","Oman","Peru","Philippines",
  "Poland","Portugal","Qatar","Saudi Arabia","Singapore","South Africa",
  "South Korea","Spain","Sweden","Thailand","Turkey","Türkiye",
  "United Arab Emirates","United Kingdom","United States","Vietnam",
  "Democratic Republic of the Congo","Czechia","Austria","Switzerland",
  "Ireland"
]);

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

function arrayFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  for (const v of Object.values(value)) if (Array.isArray(v)) return v;
  return [];
}

function validIso(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(v => typeof v === "string")
    .map(v => v.trim())
    .filter(Boolean))];
}

function inferredDateFromId(value) {
  const text = String(value || "");
  const m = text.match(/(?:^|[-_])((?:19|20)\d{2})(\d{2})(\d{2})(?:[-_]|$)/);
  if (!m) return null;
  const candidate = `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`;
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

function recoverTimestamp(signal) {
  for (const key of ["created_at","published_at","updated_at","detected_at","timestamp"]) {
    if (validIso(signal[key])) return { value: signal[key], method: key };
  }
  for (const key of ["development_id","article_id"]) {
    const value = inferredDateFromId(signal[key]);
    if (value) return { value, method: `${key}:date_inferred_at_noon_utc` };
  }
  return null;
}

function countBy(values) {
  const counts = new Map();
  for (const raw of values) {
    const key = String(raw || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function main() {
  const payload = readJson(MAP_FILE);
  if (!Array.isArray(payload.signals)) {
    throw new Error("briefs/map-signals.json does not contain signals[].");
  }

  const entitiesRaw = readJson(ENTITIES_FILE, false);
  const entityIds = new Set(
    arrayFrom(entitiesRaw, ["entities", "items"])
      .map(e => e?.entity_id)
      .filter(Boolean)
  );

  const report = {
    schema_version: "1.0",
    normalized_at: new Date().toISOString(),
    signals_before: payload.signals.length,
    signals_after: 0,
    country_contaminants_removed: 0,
    topics_preserved_in_tags: 0,
    timestamps_repaired: 0,
    timestamps_unresolved: 0,
    entity_ids_deduplicated: 0,
    orphan_entity_ids_removed: 0,
    unresolved_timestamps: [],
    removed_orphan_entity_ids: []
  };

  payload.signals = payload.signals.map((source, index) => {
    const signal = { ...source };
    const signalId = signal.signal_id || `index:${index}`;

    const originalCountries = uniqueStrings(signal.countries);
    const cleanCountries = originalCountries.filter(c => VALID_COUNTRIES.has(c));
    const removed = originalCountries.filter(c => !VALID_COUNTRIES.has(c));

    report.country_contaminants_removed += removed.length;

    const oldTags = uniqueStrings(signal.tags);
    const newTags = uniqueStrings([...oldTags, ...removed]);
    report.topics_preserved_in_tags += Math.max(0, newTags.length - oldTags.length);

    signal.countries = cleanCountries;
    signal.tags = newTags;

    if (!validIso(signal.created_at)) {
      const recovered = recoverTimestamp(signal);
      if (recovered) {
        signal.created_at = recovered.value;
        report.timestamps_repaired += 1;
      } else {
        report.timestamps_unresolved += 1;
        report.unresolved_timestamps.push({
          signal_id: signalId,
          value: signal.created_at ?? null,
          development_id: signal.development_id ?? null,
          article_id: signal.article_id ?? null
        });
      }
    }

    if (Array.isArray(signal.entity_ids)) {
      const before = signal.entity_ids.filter(Boolean);
      const unique = [...new Set(before)];
      report.entity_ids_deduplicated += before.length - unique.length;

      signal.entity_ids = entityIds.size
        ? unique.filter(id => {
            const keep = entityIds.has(id);
            if (!keep) {
              report.orphan_entity_ids_removed += 1;
              report.removed_orphan_entity_ids.push({ signal_id: signalId, entity_id: id });
            }
            return keep;
          })
        : unique;
    }

    return signal;
  });

  const validTimes = payload.signals
    .map(s => s.created_at)
    .filter(validIso)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  const countries = payload.signals.flatMap(s =>
    Array.isArray(s.countries) ? s.countries : []
  );

  payload.signal_count = payload.signals.length;
  payload.country_count = new Set(countries).size;
  payload.oldest_signal_at = validTimes.length ? validTimes[0] : null;
  payload.newest_signal_at = validTimes.length ? validTimes[validTimes.length - 1] : null;

  payload.coverage = payload.coverage && typeof payload.coverage === "object"
    ? { ...payload.coverage }
    : {};

  payload.coverage.countries = countBy(countries);
  payload.coverage.regions = countBy(payload.signals.map(s => s.region).filter(Boolean));
  payload.coverage.categories = countBy(payload.signals.map(s => s.category).filter(Boolean));

  report.signals_after = payload.signals.length;
  report.status = report.timestamps_unresolved === 0 ? "normalized" : "needs_attention";

  writeJson(MAP_FILE, payload);
  writeJson(REPORT_FILE, report);

  console.log("\n=== PTD Today / Cosmos Map Signal Normalizer ===");
  console.log(`Status: ${report.status}`);
  console.log(`Signals: ${report.signals_after}`);
  console.log(`Country contaminants removed: ${report.country_contaminants_removed}`);
  console.log(`Timestamps repaired: ${report.timestamps_repaired}`);
  console.log(`Timestamps unresolved: ${report.timestamps_unresolved}`);
  console.log(`Entity IDs deduplicated: ${report.entity_ids_deduplicated}`);
  console.log(`Orphan entity IDs removed: ${report.orphan_entity_ids_removed}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);

  if (report.timestamps_unresolved > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
