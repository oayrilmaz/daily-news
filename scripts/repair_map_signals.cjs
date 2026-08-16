#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BRIEFS_DIR = process.env.BRIEFS_DIR || "briefs";
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || "knowledge";

const MAP_FILE = path.join(ROOT, BRIEFS_DIR, "map-signals.json");
const BACKUP_FILE = path.join(ROOT, BRIEFS_DIR, "map-signals.pre-cosmos-repair.json");
const ENTITIES_FILE = path.join(ROOT, KNOWLEDGE_DIR, "entities.json");
const REPORT_FILE = path.join(ROOT, KNOWLEDGE_DIR, "map-signals-repair-report.json");

const COUNTRY_REGION = {
  "Algeria":"Africa","Argentina":"LATAM","Australia":"Asia","Belgium":"Europe",
  "Brazil":"LATAM","Canada":"North America","Chile":"LATAM","China":"Asia",
  "Colombia":"LATAM","Denmark":"Europe","Egypt":"Middle East","Finland":"Europe",
  "France":"Europe","Germany":"Europe","Greece":"Europe","India":"Asia",
  "Indonesia":"Asia","Israel":"Middle East","Italy":"Europe","Japan":"Asia",
  "Kenya":"Africa","Malaysia":"Asia","Mexico":"North America","Morocco":"Africa",
  "Netherlands":"Europe","New Zealand":"Asia","Nigeria":"Africa","Norway":"Europe",
  "Oman":"Middle East","Peru":"LATAM","Philippines":"Asia","Poland":"Europe",
  "Portugal":"Europe","Qatar":"Middle East","Saudi Arabia":"Middle East",
  "Singapore":"Asia","South Africa":"Africa","South Korea":"Asia","Spain":"Europe",
  "Sweden":"Europe","Thailand":"Asia","Turkey":"Middle East","Türkiye":"Middle East",
  "United Arab Emirates":"Middle East","United Kingdom":"Europe",
  "United States":"North America","Vietnam":"Asia",
  "Democratic Republic of the Congo":"Africa"
};

const VALID_COUNTRIES = new Set(Object.keys(COUNTRY_REGION));

function readJson(file, required=true) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required file: ${path.relative(ROOT,file)}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function arrayFrom(value, keys=[]) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  for (const candidate of Object.values(value)) if (Array.isArray(candidate)) return candidate;
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
    if (validIso(signal[key])) return {value: signal[key], method:key};
  }
  for (const key of ["development_id","article_id"]) {
    const value = inferredDateFromId(signal[key]);
    if (value) return {value, method:`${key}:date_inferred_at_noon_utc`};
  }
  return null;
}

function countBy(values) {
  const m = new Map();
  for (const raw of values) {
    const key = String(raw || "").trim();
    if (!key) continue;
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()]
    .map(([name,count]) => ({name,count}))
    .sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
}

function main() {
  const payload = readJson(MAP_FILE);
  if (!Array.isArray(payload.signals)) throw new Error("map-signals.json has no signals[] array.");

  const entitiesRaw = readJson(ENTITIES_FILE, false);
  const entityIds = new Set(
    arrayFrom(entitiesRaw, ["entities","items"]).map(e => e?.entity_id).filter(Boolean)
  );

  const report = {
    schema_version:"1.0",
    repaired_at:new Date().toISOString(),
    source_file:path.relative(ROOT, MAP_FILE),
    backup_file:path.relative(ROOT, BACKUP_FILE),
    signals_before:payload.signals.length,
    signals_after:0,
    country_contaminants_removed:0,
    topics_preserved_in_tags:0,
    timestamps_repaired:0,
    timestamps_unresolved:0,
    entity_ids_deduplicated:0,
    orphan_entity_ids_removed:0,
    timestamp_repairs:[],
    unresolved_timestamps:[],
    orphan_entity_ids:[]
  };

  if (!fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(MAP_FILE, BACKUP_FILE);
  }

  payload.signals = payload.signals.map((original, index) => {
    const signal = {...original};
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
        report.timestamp_repairs.push({
          signal_id:signalId,
          previous_value:signal.created_at ?? null,
          repaired_value:recovered.value,
          method:recovered.method
        });
        signal.created_at = recovered.value;
        report.timestamps_repaired++;
      } else {
        report.timestamps_unresolved++;
        report.unresolved_timestamps.push({
          signal_id:signalId,
          value:signal.created_at ?? null,
          article_id:signal.article_id ?? null,
          development_id:signal.development_id ?? null
        });
      }
    }

    if (Array.isArray(signal.entity_ids)) {
      const before = signal.entity_ids.filter(Boolean);
      const unique = [...new Set(before)];
      report.entity_ids_deduplicated += before.length - unique.length;

      if (entityIds.size) {
        signal.entity_ids = unique.filter(id => {
          const ok = entityIds.has(id);
          if (!ok) {
            report.orphan_entity_ids_removed++;
            report.orphan_entity_ids.push({signal_id:signalId, entity_id:id});
          }
          return ok;
        });
      } else {
        signal.entity_ids = unique;
      }
    }

    return signal;
  });

  report.signals_after = payload.signals.length;

  const times = payload.signals.map(s => s.created_at).filter(validIso)
    .sort((a,b) => Date.parse(a) - Date.parse(b));

  payload.signal_count = payload.signals.length;
  payload.oldest_signal_at = times.length ? times[0] : null;
  payload.newest_signal_at = times.length ? times[times.length - 1] : null;

  const allCountries = payload.signals.flatMap(s => Array.isArray(s.countries) ? s.countries : []);
  payload.country_count = new Set(allCountries).size;

  payload.coverage = payload.coverage && typeof payload.coverage === "object"
    ? {...payload.coverage}
    : {};
  payload.coverage.countries = countBy(allCountries);
  payload.coverage.regions = countBy(payload.signals.map(s => s.region).filter(Boolean));
  payload.coverage.categories = countBy(payload.signals.map(s => s.category).filter(Boolean));

  report.rebuilt_country_count = payload.country_count;
  report.status = report.timestamps_unresolved ? "repaired_with_unresolved_timestamps" : "repaired";

  writeJson(MAP_FILE, payload);
  writeJson(REPORT_FILE, report);

  console.log("\n=== PTD Today / Cosmos Map Signals Repair ===");
  console.log(`Status: ${report.status}`);
  console.log(`Signals preserved: ${report.signals_after}/${report.signals_before}`);
  console.log(`Country contaminants removed: ${report.country_contaminants_removed}`);
  console.log(`Topics preserved in tags: ${report.topics_preserved_in_tags}`);
  console.log(`Timestamps repaired: ${report.timestamps_repaired}`);
  console.log(`Timestamps unresolved: ${report.timestamps_unresolved}`);
  console.log(`Entity IDs deduplicated: ${report.entity_ids_deduplicated}`);
  console.log(`Orphan entity IDs removed: ${report.orphan_entity_ids_removed}`);
  console.log(`Valid countries after rebuild: ${report.rebuilt_country_count}`);
  console.log(`Backup: ${path.relative(ROOT, BACKUP_FILE)}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);
}

try { main(); }
catch (err) {
  console.error(err?.stack || err);
  process.exit(1);
}
