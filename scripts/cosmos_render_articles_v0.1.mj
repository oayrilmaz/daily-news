#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function cleanString(value, fallback = "") {
  const text = (value ?? "").toString().trim();
  return text || fallback;
}

function normalizeKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function listJsonFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const output = [];
  const stack = [dirPath];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        output.push(fullPath);
      }
    }
  }

  return output.sort();
}

function collectNarratives(value, filePath, output = []) {
  if (!value) return output;

  if (Array.isArray(value)) {
    for (const row of value) collectNarratives(row, filePath, output);
    return output;
  }

  if (typeof value !== "object") return output;

  if (
    value.status === "causal_narrative_resolved" ||
    value.schema_type === "cosmos_causal_narrative"
  ) {
    output.push({
      file_path: filePath,
      narrative: value
    });
  }

  for (const key of ["narratives", "results", "items"]) {
    if (Array.isArray(value[key])) {
      collectNarratives(value[key], filePath, output);
    }
  }

  return output;
}

function isControlledTestNarrative(entry) {
  const pathKey = normalizeKey(entry.file_path);
  const titleKey = normalizeKey(
    entry.narrative?.focal_signal?.title ||
    entry.narrative?.focal_signal?.statement ||
    ""
  );

  return (
    pathKey.includes("test") ||
    pathKey.includes("fixture") ||
    titleKey.includes("fixture")
  );
}

function focalIds(narrative) {
  return [
    narrative?.focal_signal?.development_id,
    narrative?.focal_signal?.signal_id,
    narrative?.focal_signal?.id,
    narrative?.development_id,
    narrative?.signal_id
  ].map(cleanString).filter(Boolean);
}

function focalTitle(narrative) {
  return cleanString(
    narrative?.focal_signal?.title ||
    narrative?.focal_signal?.statement ||
    narrative?.title
  );
}

function matchNarrative(item, entries) {
  const itemIds = new Set(
    [item?.development_id, item?.id, item?.signal_id]
      .map(cleanString)
      .filter(Boolean)
  );

  const itemTitleKey = normalizeKey(item?.title);

  const scored = entries.map((entry) => {
    const narrative = entry.narrative;
    const ids = focalIds(narrative);

    let score = 0;
    let reason = "none";

    if (ids.some((id) => itemIds.has(id))) {
      score = 100;
      reason = "exact_id";
    } else if (
      itemTitleKey &&
      normalizeKey(focalTitle(narrative)) === itemTitleKey
    ) {
      score = 60;
      reason = "exact_title";
    }

    // Prefer a specific production narrative over a generic/current wrapper
    // only after exact matching has already been established.
    if (score > 0 && !isControlledTestNarrative(entry)) score += 10;

    return { ...entry, score, reason };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      String(b.narrative?.generated_at || "").localeCompare(
        String(a.narrative?.generated_at || "")
      )
    );

  return scored[0] || null;
}

const generatorPath = path.resolve(
  argValue("--generator", "scripts/generate_ai_news.js")
);
const briefPath = path.resolve(
  argValue("--brief", "briefs/daily-ai.json")
);
const knowledgeDir = path.resolve(
  argValue("--knowledge-dir", "knowledge")
);
const articlesDir = path.resolve(
  argValue("--articles-dir", "articles")
);
const manifestPath = path.resolve(
  argValue(
    "--manifest",
    path.join(knowledgeDir, "cosmos", "article-production-manifest-v0.1.json")
  )
);
const siteOrigin = cleanString(
  argValue("--site-origin", process.env.SITE_ORIGIN || "https://ptdtoday.com")
).replace(/\/$/, "");
const includeTestNarratives = hasFlag("--include-test-narratives");

if (!fs.existsSync(generatorPath)) {
  throw new Error(`Generator not found: ${generatorPath}`);
}
if (!fs.existsSync(briefPath)) {
  throw new Error(`Daily brief not found: ${briefPath}`);
}

const brief = readJson(briefPath);
const items = Array.isArray(brief?.items) ? brief.items : [];

if (!items.length) {
  throw new Error("Daily brief contains no items");
}

const cosmosDir = path.join(knowledgeDir, "cosmos");
const narrativeEntries = [];

for (const filePath of listJsonFilesRecursive(cosmosDir)) {
  let payload;
  try {
    payload = readJson(filePath);
  } catch {
    continue;
  }

  collectNarratives(payload, filePath, narrativeEntries);
}

const eligibleNarratives = includeTestNarratives
  ? narrativeEntries
  : narrativeEntries.filter((entry) => !isControlledTestNarrative(entry));

const moduleUrl = pathToFileURL(generatorPath).href;
const { renderArticleHtml } = await import(moduleUrl);

if (typeof renderArticleHtml !== "function") {
  throw new Error("renderArticleHtml export missing from generate_ai_news.js");
}

const records = [];

for (const item of items) {
  const id = cleanString(item?.development_id || item?.id);
  if (!id) continue;

  const matched = matchNarrative(item, eligibleNarratives);
  const causalNarrative = matched?.narrative || null;

  const html = renderArticleHtml({
    siteOrigin,
    item,
    payload: brief,
    causalNarrative
  });

  const articlePath = path.join(articlesDir, `${id}.html`);
  writeFile(articlePath, html);

  records.push({
    development_id: id,
    title: cleanString(item?.title),
    article_path: articlePath,
    presentation_mode: causalNarrative ? "cosmos_causal_narrative" : "safe_fallback",
    causal_narrative_file: matched?.file_path || null,
    match_reason: matched?.reason || null,
    narrative_status: causalNarrative?.status || null
  });
}

const matchedCount = records.filter(
  (row) => row.presentation_mode === "cosmos_causal_narrative"
).length;

const manifest = {
  schema_version: "0.1",
  status: "article_production_integration_resolved",
  generated_at: new Date().toISOString(),
  source_brief: briefPath,
  generator_path: generatorPath,
  knowledge_dir: knowledgeDir,
  articles_dir: articlesDir,
  article_count: records.length,
  causal_narrative_count: matchedCount,
  fallback_count: records.length - matchedCount,
  narratives_discovered: narrativeEntries.length,
  narratives_eligible: eligibleNarratives.length,
  records,
  production_contract: {
    exact_id_match_preferred: true,
    exact_title_match_supported: true,
    controlled_test_narratives_excluded_by_default: true,
    causal_narrative_used_when_available: true,
    safe_fallback_used_when_unavailable: true,
    article_regeneration_requires_no_new_ai_generation: true,
    existing_daily_brief_preserved: true
  },
  safeguards: {
    performs_external_search: false,
    calls_openai_or_external_api: false,
    mutates_graph: false,
    rewrites_daily_brief: false,
    promotes_scenario_to_fact: false,
    deletes_causal_history: false
  }
};

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest, null, 2));

