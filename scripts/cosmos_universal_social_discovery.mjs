import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const MODEL = String(process.env.COSMOS_DISCOVERY_MODEL || "gpt-6-luna").trim();

const QUEUE_FILE = process.env.SOCIAL_QUEUE_FILE || "data/social-queue.json";
const STATE_FILE = process.env.SOCIAL_STATE_FILE || "data/social-published.json";
const DISCOVERY_FILE = process.env.COSMOS_DISCOVERY_FILE || "data/cosmos-universal-discovery.json";
const HISTORY_FILE = process.env.COSMOS_DISCOVERY_HISTORY_FILE || "data/cosmos-universal-discovery-history.json";
const EXPLORE_DIR = process.env.SOCIAL_EXPLORE_DIR || "explore";
const SITEMAP_EXPLORE = process.env.SITEMAP_EXPLORE_FILE || "sitemap-explore.xml";
const SITEMAP_INDEX = process.env.SITEMAP_INDEX_FILE || "sitemap.xml";
const COSMOS_DISCOVERIES_FILE = process.env.COSMOS_DISCOVERIES_FILE || "cosmos-discoveries.html";
const SITEMAP_COSMOS_FILE = process.env.SITEMAP_COSMOS_FILE || "sitemap-cosmos.xml";

const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://ptdtoday.com").replace(/\/+$/, "");
const COSMOS_SHARE_API = String(
  process.env.COSMOS_SHARE_API || "https://ptdtoday-cosmos.ptdtoday.workers.dev/api/cosmos/share"
).trim();
const COSMOS_ASK_API = String(
  process.env.COSMOS_ASK_API || "https://ptdtoday-cosmos.ptdtoday.workers.dev/api/cosmos/ask"
).trim();
const TARGET_COUNT = positiveInt(process.env.SOCIAL_QUEUE_TARGET, 5);
const STRICT_COMPOSITE = positiveInt(process.env.COSMOS_STRICT_COMPOSITE, 58);
const FALLBACK_COMPOSITE = positiveInt(process.env.COSMOS_FALLBACK_COMPOSITE, 45);
const FALLBACK_BUTTERFLY = positiveInt(process.env.COSMOS_FALLBACK_BUTTERFLY, 45);
const HISTORY_DAYS = positiveInt(process.env.COSMOS_HISTORY_DAYS, 7);

const BLOCKED_AUTOMATED_RE =
  /\b(election|electoral|ballot|candidate|partisan|political party|presidential race|parliamentary race|polling|voting intention|war|military strike|terror attack|mass shooting|hostage|death toll|murder|suicide|graphic violence)\b/i;

const POLITICAL_CAMPAIGN_RE =
  /\b(?:political|election|electoral|presidential|parliamentary|candidate)\s+campaign\b|\bcampaign\s+(?:trail|rally|finance|ad|advertising|strategy)\b/i;

const DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["generated_at", "candidates"],
  properties: {
    generated_at: { type: "string" },
    candidates: {
      type: "array",
      minItems: 8,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "topic_key",
          "domain",
          "geography",
          "title",
          "summary",
          "why_it_matters",
          "butterfly_question",
          "social_hook",
          "hashtags",
          "significance_score",
          "novelty_score",
          "butterfly_score",
          "confidence",
          "manual_review",
          "manual_review_reason",
          "sources"
        ],
        properties: {
          topic_key: { type: "string" },
          domain: {
            type: "string",
            enum: [
              "science",
              "health",
              "technology",
              "ai",
              "space",
              "environment",
              "economics",
              "business",
              "society",
              "culture",
              "education",
              "infrastructure",
              "energy",
              "public_policy",
              "other"
            ]
          },
          geography: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          butterfly_question: { type: "string" },
          social_hook: { type: "string" },
          hashtags: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string" }
          },
          significance_score: { type: "integer", minimum: 0, maximum: 100 },
          novelty_score: { type: "integer", minimum: 0, maximum: 100 },
          butterfly_score: { type: "integer", minimum: 0, maximum: 100 },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"]
          },
          manual_review: { type: "boolean" },
          manual_review_reason: { type: "string" },
          sources: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "url", "publisher", "published_at"],
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                publisher: { type: "string" },
                published_at: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
};

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || 0));
}

function normalizedScore(value) {
  const n = clamp(value, 0, 100);
  // Some models naturally return 0-10 ratings despite a 0-100 schema.
  // Detect that representation per score and normalize it to 0-100.
  return n > 0 && n <= 10 ? n * 10 : n;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hash12(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function safeTopicKey(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function canonicalExternalUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return "";
  }
}

function urlFingerprint(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function distinctHosts(sources) {
  const hosts = new Set();
  for (const source of sources) {
    try {
      hosts.add(new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {}
  }
  return hosts;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const pieces = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (
        (content?.type === "output_text" || content?.type === "text") &&
        typeof content?.text === "string"
      ) {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("").trim();
}

function extractCitationUrls(response) {
  const urls = new Set();

  const visit = value => {
    if (!value || typeof value !== "object") return;

    if (
      typeof value.url === "string" &&
      /^https?:\/\//i.test(value.url) &&
      (
        value.type === "url_citation" ||
        value.title ||
        value.start_index !== undefined ||
        value.end_index !== undefined
      )
    ) {
      const canonical = canonicalExternalUrl(value.url);
      if (canonical) urls.add(urlFingerprint(canonical));
    }

    if (Array.isArray(value)) {
      for (const child of value) visit(child);
    } else {
      for (const child of Object.values(value)) visit(child);
    }
  };

  visit(response?.output || []);
  return urls;
}

function hashtag(value) {
  let text = clean(value).replace(/\s+/g, "");
  if (!text) return "";
  if (!text.startsWith("#")) text = `#${text}`;
  text = `#${text.slice(1).replace(/[^A-Za-z0-9_]/g, "")}`;
  return text.length > 1 ? text.slice(0, 36) : "";
}

function normalizedHashtags(candidate) {
  const tags = ["#Cosmos"];

  for (const raw of candidate.hashtags || []) {
    const tag = hashtag(raw);
    if (!tag || tag.toLowerCase() === "#cosmos") continue;
    if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag);
    }
    if (tags.length >= 4) break;
  }

  const fallback = {
    science: "#Science",
    health: "#Health",
    technology: "#Technology",
    ai: "#AI",
    space: "#Space",
    environment: "#Environment",
    economics: "#Economy",
    business: "#Business",
    society: "#Society",
    culture: "#Culture",
    education: "#Education",
    infrastructure: "#Infrastructure",
    energy: "#Energy",
    other: "#Innovation"
  }[candidate.domain];

  if (tags.length < 3 && fallback && !tags.includes(fallback)) tags.push(fallback);
  if (tags.length < 3) tags.push("#Innovation");

  return tags.slice(0, 4);
}

function score(candidate) {
  return (
    normalizedScore(candidate.significance_score) * 0.35 +
    normalizedScore(candidate.butterfly_score) * 0.40 +
    normalizedScore(candidate.novelty_score) * 0.25
  );
}

function recentHistoryKeys(history) {
  const cutoff = Date.now() - HISTORY_DAYS * 86400_000;
  const keys = new Set();

  for (const row of history.items || []) {
    const t = new Date(row.queued_at || "").getTime();
    if (Number.isFinite(t) && t >= cutoff && row.topic_key) {
      keys.add(String(row.topic_key));
    }
  }
  return keys;
}

function publishedIds() {
  const state = loadJson(STATE_FILE, { published: [] });
  return new Set(
    (Array.isArray(state.published) ? state.published : [])
      .filter(row => row?.status === "published" && row?.platform === "x")
      .map(row => String(row.item_id || ""))
      .filter(Boolean)
  );
}

function validateCandidate(candidate, citationFingerprints, historyKeys, postedIds) {
  const topicKey = safeTopicKey(candidate.topic_key);
  if (!topicKey) return { ok: false, reason: "missing_topic_key" };

  if (candidate.manual_review) return { ok: false, reason: "manual_review" };
  if (candidate.domain === "public_policy") return { ok: false, reason: "public_policy_manual_only" };
  const candidateText = `${candidate.title} ${candidate.summary} ${candidate.why_it_matters}`;
  if (BLOCKED_AUTOMATED_RE.test(candidateText) || POLITICAL_CAMPAIGN_RE.test(candidateText)) {
    return { ok: false, reason: "blocked_unattended_topic" };
  }

  if (!["high", "medium"].includes(candidate.confidence)) {
    return { ok: false, reason: "low_confidence" };
  }

  const compositeScore = score(candidate);
  const butterflyScore = normalizedScore(candidate.butterfly_score);
  const normalizedSignificance = normalizedScore(candidate.significance_score);
  const normalizedNovelty = normalizedScore(candidate.novelty_score);

  // Hard safety/evidence gates live above. Quality is now calibrated for
  // "worth exploring in Cosmos", not only for world-historical importance.
  // Strict candidates are preferred. A bounded fallback prevents the queue
  // from failing just because a worthwhile niche development was scored
  // conservatively on "significance".
  if (compositeScore < FALLBACK_COMPOSITE || butterflyScore < FALLBACK_BUTTERFLY) {
    return {
      ok: false,
      reason: "below_fallback_quality",
      diagnostic: {
        significance_raw: Number(candidate.significance_score) || 0,
        novelty_raw: Number(candidate.novelty_score) || 0,
        butterfly_raw: Number(candidate.butterfly_score) || 0,
        significance: normalizedSignificance,
        novelty: normalizedNovelty,
        butterfly: butterflyScore,
        composite: Math.round(compositeScore * 10) / 10
      }
    };
  }

  const qualityTier = compositeScore >= STRICT_COMPOSITE ? "strict" : "fallback";

  const normalizedSources = [];
  for (const source of candidate.sources || []) {
    const url = canonicalExternalUrl(source.url);
    if (!url) continue;
    normalizedSources.push({
      title: clean(source.title),
      url,
      publisher: clean(source.publisher),
      published_at: clean(source.published_at)
    });
  }

  const uniqueByUrl = [];
  const seen = new Set();
  for (const source of normalizedSources) {
    const fp = urlFingerprint(source.url);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    uniqueByUrl.push(source);
  }

  if (uniqueByUrl.length < 2) return { ok: false, reason: "fewer_than_two_sources" };
  if (distinctHosts(uniqueByUrl).size < 2) return { ok: false, reason: "sources_not_independent" };

  // Web-search citation annotations are useful provenance signals, but exact URL
  // matching can fail because publishers redirect, canonicalize, or strip tracking.
  // Keep the signal for diagnostics, but do not reject an otherwise well-sourced
  // candidate solely because the final source URL differs from the citation URL.
  const citationMatched = citationFingerprints.size
    ? uniqueByUrl.some(source => citationFingerprints.has(urlFingerprint(source.url)))
    : false;

  const primary = uniqueByUrl[0];
  const itemId = `universal-${hash12(`${topicKey}|${primary.url}`)}`;

  if (historyKeys.has(topicKey)) return { ok: false, reason: "recent_topic_duplicate" };
  if (postedIds.has(itemId)) return { ok: false, reason: "already_published" };

  return {
    ok: true,
    candidate: {
      ...candidate,
      topic_key: topicKey,
      title: truncate(candidate.title, 150),
      summary: truncate(candidate.summary, 520),
      why_it_matters: truncate(candidate.why_it_matters, 440),
      butterfly_question: truncate(candidate.butterfly_question, 180),
      social_hook: truncate(candidate.social_hook, 90),
      sources: uniqueByUrl.slice(0, 3),
      citation_matched: citationMatched,
      quality_tier: qualityTier,
      normalized_scores: {
        significance: normalizedSignificance,
        novelty: normalizedNovelty,
        butterfly: butterflyScore
      },
      item_id: itemId,
      rank_score: Math.round(compositeScore * 10) / 10
    }
  };
}

function selectDiverse(candidates) {
  const strict = candidates
    .filter(candidate => candidate.quality_tier === "strict")
    .sort((a, b) => b.rank_score - a.rank_score);

  const fallback = candidates
    .filter(candidate => candidate.quality_tier !== "strict")
    .sort((a, b) => b.rank_score - a.rank_score);

  const ranked = [...strict, ...fallback];
  const selected = [];
  const domainCount = new Map();
  const geoCount = new Map();

  const canAdd = candidate => {
    const domain = candidate.domain || "other";
    const geo = clean(candidate.geography).toLowerCase() || "global";
    return (domainCount.get(domain) || 0) < 2 && (geoCount.get(geo) || 0) < 2;
  };

  const add = candidate => {
    selected.push(candidate);
    const domain = candidate.domain || "other";
    const geo = clean(candidate.geography).toLowerCase() || "global";
    domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    geoCount.set(geo, (geoCount.get(geo) || 0) + 1);
  };

  // First pass: maximize domain diversity, preferring strict candidates.
  const usedDomains = new Set();
  for (const candidate of ranked) {
    if (selected.length >= TARGET_COUNT) break;
    if (usedDomains.has(candidate.domain)) continue;
    if (!canAdd(candidate)) continue;
    add(candidate);
    usedDomains.add(candidate.domain);
  }

  // Second pass: fill remaining slots without letting one domain/geography dominate.
  for (const candidate of ranked) {
    if (selected.length >= TARGET_COUNT) break;
    if (selected.includes(candidate)) continue;
    if (!canAdd(candidate)) continue;
    add(candidate);
  }

  return selected;
}

function buildXText(candidate, exploreUrl) {
  const tags = normalizedHashtags(candidate).join(" ");
  const title = truncate(candidate.title, 108);
  const hook = truncate(candidate.social_hook || "What could this trigger next?", 72);

  let text = `${title}\n${hook}\n${tags}`;

  // The publisher appends two newlines + URL. Leave enough room below X's 280 chars.
  const reserved = exploreUrl.length + 2;
  const maxBeforeUrl = Math.max(120, 280 - reserved);
  if (text.length > maxBeforeUrl) {
    text = `${truncate(title, 92)}\n${truncate(hook, 50)}\n${tags}`;
  }
  if (text.length > maxBeforeUrl) {
    text = `${truncate(title, 105)}\n${tags}`;
  }

  return text;
}


async function headOk(url, label, expectImage = false) {
  const response = await fetch(url, {
    method: "HEAD",
    headers: { "User-Agent": "PTD-Today-Social-Preflight/1.0" }
  });

  if (!response.ok) {
    throw new Error(`${label} HEAD failed (${response.status}) for ${url}`);
  }

  if (expectImage) {
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) {
      throw new Error(`${label} is not an image (${type || "unknown content-type"}): ${url}`);
    }
  }

  return response;
}


function sharedEntityId(candidate, localId, label) {
  const suffix = safeTopicKey(localId || label || "node") || hash12(label || localId || "node");
  return `shared:${candidate.item_id}:${suffix}`;
}

function numericConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
  }
  const raw = String(value || "").toLowerCase();
  if (raw === "high") return 0.9;
  if (raw === "medium") return 0.65;
  if (raw === "low") return 0.35;
  return 0.5;
}

function mapGatewayProjection(candidate, answer) {
  const nodes = Array.isArray(answer?.projection_nodes) ? answer.projection_nodes.slice(0, 14) : [];
  const relationships = Array.isArray(answer?.projection_relationships)
    ? answer.projection_relationships.slice(0, 22)
    : [];

  const idMap = new Map();
  const entities = [];

  for (const node of nodes) {
    const localId = clean(node?.id);
    const label = clean(node?.label || localId);
    if (!localId || !label) continue;

    const entityId = sharedEntityId(candidate, localId, label);
    idMap.set(localId, entityId);

    entities.push({
      entity_id: entityId,
      name: label,
      label,
      type: clean(node?.type || node?.role || "Projected concept"),
      role: clean(node?.role || "context"),
      epistemic_state: clean(node?.epistemic_state || "uncertain"),
      confidence: numericConfidence(node?.confidence),
      ephemeral_projection: true,
      admitted_to_cosmos: false,
      source_indexes: Array.isArray(node?.source_indexes) ? node.source_indexes.slice(0, 10) : [],
      projection_mode: clean(node?.projection_mode || answer?.projection_mode || "analytical"),
      projection_depth: Number.isFinite(Number(node?.projection_depth)) ? Number(node.projection_depth) : null,
      projection_parent_local_id: clean(node?.parent_id),
      projection_parent_id: "",
      projection_role: clean(node?.projection_role || node?.role || ""),
      projection_version: "social-shared-station-v1"
    });
  }

  for (const entity of entities) {
    const parentLocal = clean(entity.projection_parent_local_id);
    entity.projection_parent_id = parentLocal ? (idMap.get(parentLocal) || "") : "";
  }

  const sourceList = Array.isArray(answer?.sources) ? answer.sources : [];
  const mappedRelationships = [];

  relationships.forEach((rel, index) => {
    const from = idMap.get(clean(rel?.from_id));
    const to = idMap.get(clean(rel?.to_id));
    if (!from || !to || from === to) return;

    const sourceIndexes = Array.isArray(rel?.source_indexes) ? rel.source_indexes : [];
    const evidenceUrls = sourceIndexes
      .map(i => sourceList?.[Number(i) - 1]?.url || "")
      .filter(Boolean);

    mappedRelationships.push({
      relationship_id: `shared-rel:${candidate.item_id}:${index + 1}`,
      from_entity_id: from,
      to_entity_id: to,
      relationship_type: clean(rel?.label || "related to"),
      label: clean(rel?.label || "related to"),
      confidence: numericConfidence(rel?.confidence),
      epistemic_status: clean(rel?.epistemic_state || "uncertain"),
      evidence_mode: clean(rel?.epistemic_state || "uncertain"),
      source_ids: evidenceUrls,
      ephemeral_projection: true,
      admitted_to_cosmos: false,
      projection_version: "social-shared-station-v1"
    });
  });

  let subjectLocal = "";
  for (const node of nodes) {
    const role = clean(node?.projection_role || node?.role).toLowerCase();
    if (role === "subject") {
      subjectLocal = clean(node?.id);
      break;
    }
  }
  if (!subjectLocal && nodes.length) subjectLocal = clean(nodes[0]?.id);

  const subjectEntityId = idMap.get(subjectLocal) || entities[0]?.entity_id || "";
  const dynamicIds = entities.map(entity => entity.entity_id);

  return {
    entities,
    relationships: mappedRelationships,
    subject_entity_id: subjectEntityId,
    dynamic_ids: dynamicIds
  };
}

async function buildCosmosProjection(candidate) {
  const question = [
    `Explore this exact development: ${candidate.title}.`,
    clean(candidate.summary),
    `Question: ${candidate.butterfly_question}`,
    "Build the most useful evidence-grounded Cosmos topology around this exact development.",
    "Show the main connected systems, mechanisms, constraints, consequences, or nearby stations.",
    "Do not invent causal links; use analytical or structural relationships where causality is not established."
  ].filter(Boolean).join("\n");

  const response = await fetch(COSMOS_ASK_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "PTD-Today-Social-Projection/1.0"
    },
    body: JSON.stringify({
      question,
      context_policy: "fresh_open_world_coordinate",
      time_arc: false,
      journey: []
    })
  });

  const raw = await response.text();
  let answer = {};
  try { answer = raw ? JSON.parse(raw) : {}; } catch { answer = { raw }; }

  if (!response.ok) {
    throw new Error(
      `Cosmos projection request failed (${response.status}): ` +
      String(answer?.error || answer?.detail || raw).slice(0, 1400)
    );
  }

  const mapped = mapGatewayProjection(candidate, answer);

  // A shared social station must actually contain a navigable Cosmos.
  // We refuse to create/post a station with only the center and no surrounding map.
  if (mapped.entities.length < 4) {
    throw new Error(
      `Cosmos projection for "${candidate.title}" returned only ${mapped.entities.length} node(s). ` +
      `At least 4 are required for an automatic social station.`
    );
  }

  return { answer, mapped, question };
}

async function createSharedStation(candidate) {
  const projectionResult = await buildCosmosProjection(candidate);
  const answer = projectionResult.answer;
  const mapped = projectionResult.mapped;

  const gatewaySources = Array.isArray(answer?.sources) ? answer.sources : [];
  const sources = gatewaySources.length
    ? gatewaySources.slice(0, 10).map(source => ({
        title: clean(source?.title || source?.url || ""),
        url: canonicalExternalUrl(source?.url) || clean(source?.url),
        note: clean(source?.note || "")
      })).filter(source => source.title || source.url)
    : candidate.sources;

  const bullets = sources.map((source, index) => ({
    id: `shared-source-${index + 1}`,
    title: clean(source?.title || source?.url || `Source ${index + 1}`),
    summary: clean(source?.note || ""),
    url: clean(source?.url),
    article_id: "",
    seed_ids: []
  }));

  const stationLabel = clean(
    answer?.coordinate?.focus_label ||
    answer?.subject ||
    candidate.title
  ) || candidate.title;

  const payload = {
    share_title: candidate.title,
    current_station_label: candidate.title,
    label: candidate.title,
    subject: clean(answer?.subject || candidate.title),
    question: projectionResult.question,
    intent: clean(answer?.intent || "explore"),
    short_answer: clean(answer?.short_answer || candidate.summary),
    answer: clean(answer?.answer || candidate.why_it_matters),
    hashtags: normalizedHashtags(candidate),
    sources,
    observer: {
      kind: "response",
      id: `response:shared-social:${candidate.item_id}`,
      label: stationLabel,
      question: projectionResult.question,
      semantic_subject_id: mapped.subject_entity_id,
      semantic_subject_label: stationLabel
    },
    response: {
      label: stationLabel,
      question: projectionResult.question,
      answer: clean(answer?.answer || candidate.why_it_matters),
      short_answer: clean(answer?.short_answer || candidate.summary),
      intent: clean(answer?.intent || "explore"),
      epistemic_state: clean(answer?.epistemic_state || "uncertain"),
      confidence: clean(answer?.confidence || "medium"),
      source_label: sources.length ? "Cosmos + web evidence" : "Cosmos reasoning",
      bullets,
      projection_seed_ids: mapped.subject_entity_id ? [mapped.subject_entity_id] : mapped.dynamic_ids.slice(0, 3),
      dynamic_projection_ids: mapped.dynamic_ids,
      dynamic_projection_relationship_count: mapped.relationships.length,
      suggested_stations: Array.isArray(answer?.suggested_stations)
        ? answer.suggested_stations.slice(0, 8)
        : [],
      knowledge_gaps: Array.isArray(answer?.knowledge_gaps)
        ? answer.knowledge_gaps.slice(0, 8)
        : []
    },
    projection: {
      entities: mapped.entities,
      relationships: mapped.relationships
    }
  };

  const response = await fetch(COSMOS_SHARE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "PTD-Today-Universal-Discovery/1.0"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    throw new Error(
      `Cosmos share API failed (${response.status}): ` +
      String(data?.error || data?.detail || raw).slice(0, 1200)
    );
  }

  const shareUrl = String(data?.share_url || "").trim();
  const stationId = String(data?.station_id || "").trim();

  if (!stationId || !/^https:\/\/share\.ptdtoday\.com\/s\/[^/?#]+$/i.test(shareUrl)) {
    throw new Error(`Cosmos share API returned an invalid share surface: ${raw.slice(0, 1200)}`);
  }

  const imageUrl = `https://share.ptdtoday.com/social/${encodeURIComponent(stationId)}.png`;
  const stationApiUrl =
    `https://ptdtoday-cosmos.ptdtoday.workers.dev/api/cosmos/station/${encodeURIComponent(stationId)}`;

  // Verify landing page, preview image, AND stored projection before queueing.
  await headOk(shareUrl, "Cosmos share page");
  await headOk(imageUrl, "Cosmos share image", true);

  const stationCheck = await fetch(stationApiUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "PTD-Today-Social-Projection-Preflight/1.0"
    }
  });
  const stationRaw = await stationCheck.text();
  let storedStation = {};
  try { storedStation = stationRaw ? JSON.parse(stationRaw) : {}; } catch {}

  const storedEntities = Array.isArray(storedStation?.projection?.entities)
    ? storedStation.projection.entities.length
    : 0;
  if (!stationCheck.ok || storedEntities < 4) {
    throw new Error(
      `Shared Cosmos station projection preflight failed: status=${stationCheck.status}, ` +
      `stored_entities=${storedEntities}, station=${stationId}`
    );
  }

  return {
    station_id: stationId,
    share_url: shareUrl,
    image_url: imageUrl,
    projection_entity_count: mapped.entities.length,
    projection_relationship_count: mapped.relationships.length
  };
}

function exploreHtml(candidate, exploreUrl, cosmosUrl) {
  const image = `${SITE_ORIGIN}/cosmos-social-card.png`;
  const description = truncate(candidate.summary, 240);

  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: exploreUrl,
    name: candidate.title,
    description,
    dateModified: new Date().toISOString(),
    isPartOf: {
      "@type": "WebSite",
      url: `${SITE_ORIGIN}/`,
      name: "PTD Today"
    },
    about: {
      "@type": "Thing",
      name: candidate.title,
      description: candidate.why_it_matters
    }
  }).replace(/</g, "\\u003c");

  const sourceList = candidate.sources
    .map(source =>
      `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(source.title || source.publisher || source.url)}</a>${source.publisher ? ` · ${escapeHtml(source.publisher)}` : ""}</li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(candidate.title)} · Explore in Cosmos</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${escapeHtml(exploreUrl)}">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="PTD Today · Cosmos">
  <meta property="og:title" content="${escapeHtml(candidate.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(exploreUrl)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="627">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(candidate.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">

  <script type="application/ld+json">${structured}</script>
</head>
<body>
  <main>
    <p>PTD Today · Cosmos Explore</p>
    <h1>${escapeHtml(candidate.title)}</h1>
    <p>${escapeHtml(candidate.summary)}</p>

    <h2>Why it matters</h2>
    <p>${escapeHtml(candidate.why_it_matters)}</p>

    <h2>Butterfly question</h2>
    <p>${escapeHtml(candidate.butterfly_question)}</p>

    <p><a href="${escapeHtml(cosmosUrl)}">Explore this question in Cosmos</a></p>

    <h2>Sources</h2>
    <ul>
      ${sourceList}
    </ul>
  </main>
</body>
</html>
`;
}

function writeExploreSitemap() {
  fs.mkdirSync(EXPLORE_DIR, { recursive: true });
  const files = fs.readdirSync(EXPLORE_DIR)
    .filter(name => name.toLowerCase().endsWith(".html"))
    .sort();

  const rows = files.map(name => {
    const full = path.join(EXPLORE_DIR, name);
    const stat = fs.statSync(full);
    return `  <url><loc>${xmlEscape(`${SITE_ORIGIN}/explore/${encodeURIComponent(name)}`)}</loc><lastmod>${xmlEscape(stat.mtime.toISOString())}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join("\n")}
</urlset>
`;
  fs.writeFileSync(SITEMAP_EXPLORE, xml, "utf8");
}

function writeRootSitemapIndex() {
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${xmlEscape(`${SITE_ORIGIN}/sitemap-main.xml`)}</loc>
    <lastmod>${xmlEscape(now)}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${xmlEscape(`${SITE_ORIGIN}/sitemap-articles.xml`)}</loc>
    <lastmod>${xmlEscape(now)}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${xmlEscape(`${SITE_ORIGIN}/sitemap-explore.xml`)}</loc>
    <lastmod>${xmlEscape(now)}</lastmod>
  </sitemap>
</sitemapindex>
`;
  fs.writeFileSync(SITEMAP_INDEX, xml, "utf8");
}


function writeCosmosDiscoveryArchive(historyRows, updatedAt) {
  const rows = [...historyRows]
    .filter(row => clean(row?.share_url))
    .sort((a, b) => new Date(b?.queued_at || 0).getTime() - new Date(a?.queued_at || 0).getTime())
    .slice(0, 120);

  const listItems = rows.map(row => {
    const title = clean(row.title || "Cosmos discovery");
    const summary = clean(row.summary || "");
    const why = clean(row.why_it_matters || "");
    const domain = clean(row.domain || "other");
    const geography = clean(row.geography || "global");
    const queuedAt = clean(row.queued_at || "");
    const shareUrl = clean(row.share_url);
    const dateLabel = queuedAt ? new Date(queuedAt).toISOString().slice(0, 10) : "";

    return `
      <article class="discovery">
        <p class="meta">${escapeHtml([domain, geography, dateLabel].filter(Boolean).join(" · "))}</p>
        <h2><a href="${escapeHtml(shareUrl)}">${escapeHtml(title)}</a></h2>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
        ${why ? `<p class="why"><strong>Why it matters:</strong> ${escapeHtml(why)}</p>` : ""}
        <p><a href="${escapeHtml(shareUrl)}">Open this Cosmos station</a></p>
      </article>`;
  }).join("\n");

  const itemList = rows.map((row, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: clean(row.share_url),
    name: clean(row.title || "Cosmos discovery")
  }));

  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_ORIGIN}/cosmos-discoveries.html#collection`,
    url: `${SITE_ORIGIN}/cosmos-discoveries.html`,
    name: "Latest Cosmos Discoveries",
    description:
      "Fresh evidence-grounded Cosmos discoveries, connected developments and butterfly-effect questions published automatically by PTD Today.",
    dateModified: updatedAt,
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: "Cosmos by PTD Today"
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: itemList
    }
  }).replace(/</g, "\\u003c");

  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Latest Cosmos Discoveries — PTD Today</title>
  <meta name="description" content="Fresh evidence-grounded Cosmos discoveries, connected developments and butterfly-effect questions published automatically by PTD Today.">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${SITE_ORIGIN}/cosmos-discoveries.html">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Cosmos by PTD Today">
  <meta property="og:title" content="Latest Cosmos Discoveries">
  <meta property="og:description" content="Fresh evidence-grounded Cosmos discoveries and connected developments published automatically by PTD Today.">
  <meta property="og:url" content="${SITE_ORIGIN}/cosmos-discoveries.html">
  <meta property="og:image" content="${SITE_ORIGIN}/cosmos-social-card.png">
  <script type="application/ld+json">${structured}</script>
  <style>
    :root{color-scheme:light}
    body{max-width:920px;margin:42px auto;padding:0 20px;font-family:Arial,Helvetica,sans-serif;line-height:1.62;color:#17243a;background:#fff}
    a{color:#2356a8}.kicker,.meta,.updated{color:#6c788b}.kicker{letter-spacing:.12em;text-transform:uppercase;font-size:12px}
    h1{font-size:clamp(32px,6vw,56px);line-height:1.04;margin:10px 0 16px}h2{font-size:24px;line-height:1.2;margin:6px 0 10px}
    .intro{font-size:18px;max-width:760px}.discovery{padding:24px 0;border-top:1px solid #e2e7ef}.why{color:#33445f}
    .cta{display:inline-block;margin:8px 0 28px;padding:10px 15px;border:1px solid #ccd6e6;border-radius:999px;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <p class="kicker">PTD Today · Cosmos</p>
    <h1>Latest Cosmos Discoveries</h1>
    <p class="intro">Cosmos continuously discovers fresh evidence-backed developments, builds connected stations around them, and publishes persistent public pages that can be explored by people and discovered by search engines.</p>
    <p><a class="cta" href="${SITE_ORIGIN}/">Open Cosmos</a></p>
    ${listItems || `<p>No public discovery stations are available yet. The next automatic discovery run will update this page.</p>`}
    <p class="updated">Last updated: ${escapeHtml(updatedAt)}</p>
  </main>
</body>
</html>
`;
  fs.writeFileSync(COSMOS_DISCOVERIES_FILE, page, "utf8");
}

function writeCosmosSitemap(updatedAt) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${xmlEscape(`${SITE_ORIGIN}/`)}</loc>
    <lastmod>${xmlEscape(updatedAt)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${xmlEscape(`${SITE_ORIGIN}/cosmos-discoveries.html`)}</loc>
    <lastmod>${xmlEscape(updatedAt)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
`;
  fs.writeFileSync(SITEMAP_COSMOS_FILE, xml, "utf8");
}

function discoveryPrompt(requestTime) {
  return [
    "You are the universal discovery layer for PTD Today / Cosmos.",
    "",
    "MISSION",
    "Find the strongest fresh developments in the world that are worth exploring through a butterfly-effect lens.",
    "Cosmos is not an energy feed. Energy, grids, AI, data centers, science, health, space, environment, economics, business, society, culture, education, infrastructure and other domains compete on equal terms.",
    "",
    "DISCOVERY WINDOW",
    `Current UTC time: ${requestTime}`,
    "Prioritize developments from roughly the last 24-36 hours. Use older context only when needed to understand a genuinely fresh change.",
    "",
    "SELECTION PRINCIPLES",
    "- Search broadly across domains and geographies; do not inherit PTD Today's existing energy-heavy knowledge density.",
    "- Return 8-12 evidence-backed candidates so a downstream diversity gate can choose five.",
    "- Prefer developments with real downstream consequences, cross-domain connections, second-order effects, or structural significance.",
    "- Do not force quotas, but avoid returning a list dominated by one domain or geography.",
    "- Avoid celebrity gossip, routine product marketing, generic listicles, rumors, opinion-only stories, and low-consequence incremental updates.",
    "- Do not sensationalize. The social_hook should be intriguing but factual and restrained.",
    "",
    "EVIDENCE",
    "- Use web search.",
    "- Each candidate must have 2-3 direct public source URLs from at least two independent publishers/domains.",
    "- Prefer primary, official, scientific, regulatory, company-filing, institutional, or high-quality news sources.",
    "- Do not invent URLs. Do not use search-result pages or AI-generated summaries as sources.",
    "- title, summary, why_it_matters and social_hook must be supported by those sources.",
    "",
    "UNATTENDED SOCIAL SAFETY",
    "- Do not select elections, candidates, campaigns, partisan persuasion, polling, or political advocacy for unattended social publishing.",
    "- Public-policy/regulatory developments may be returned only with manual_review=true; the downstream system will hold them out of automatic posting.",
    "- Mark manual_review=true for a development involving acute violence/tragedy, individualized medical/financial/legal advice, contested allegations, or another topic that should not be auto-published without human review.",
    "- Health/science developments can be eligible when factual, non-personalized, and grounded in strong scientific/official sources.",
    "",
    "COSMOS FORM",
    "- topic_key must be a stable compact semantic identifier, not a date or random ID.",
    "- summary: 1-2 concise factual sentences.",
    "- why_it_matters: explain the material consequence in 1-2 concise sentences.",
    "- butterfly_question: one compelling neutral question about what this could trigger next.",
    "- social_hook: one short factual curiosity hook, not clickbait, ideally under 80 characters.",
    "- hashtags: 2-4 genuinely relevant topical hashtags. Do not include #Cosmos; the downstream system adds it.",
    "- significance_score measures real-world importance.",
    "- novelty_score measures how meaningfully new the development is now.",
    "- butterfly_score measures downstream/cross-domain consequence potential.",
    "",
    "Return only the required structured JSON."
  ].join("\n");
}

async function requestUniversalDiscovery() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for Cosmos universal discovery.");
  }

  const requestTime = new Date().toISOString();
  const payload = {
    model: MODEL,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "auto",
    store: false,
    max_output_tokens: 6000,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "cosmos_universal_social_discovery",
        description: "Fresh cross-domain Cosmos discovery candidates for evidence-backed social exploration.",
        strict: true,
        schema: DISCOVERY_SCHEMA
      }
    },
    input: [{
      role: "user",
      content: [{ type: "input_text", text: discoveryPrompt(requestTime) }]
    }]
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  let raw = {};
  try { raw = rawText ? JSON.parse(rawText) : {}; }
  catch { raw = { raw_text: rawText.slice(0, 4000) }; }

  if (!response.ok) {
    const detail = raw?.error?.message || raw?.message || raw?.raw_text || rawText;
    throw new Error(`OpenAI Responses API ${response.status}: ${String(detail).slice(0, 1800)}`);
  }

  const outputText = extractOutputText(raw);
  if (!outputText) throw new Error("Universal discovery returned no structured output text.");

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`Could not parse universal discovery JSON: ${error.message}`);
  }

  return {
    raw,
    parsed,
    request_time_utc: requestTime
  };
}

function loadMockDiscovery(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    raw: { id: "mock_response", output: [] },
    parsed,
    request_time_utc: new Date().toISOString()
  };
}

async function main() {
  const mockFile = String(process.env.COSMOS_DISCOVERY_MOCK_FILE || "").trim();
  const result = mockFile ? loadMockDiscovery(mockFile) : await requestUniversalDiscovery();

  const parsedCandidates = Array.isArray(result.parsed?.candidates) ? result.parsed.candidates : [];
  if (parsedCandidates.length < 8) {
    throw new Error(`Universal discovery returned only ${parsedCandidates.length} candidates; minimum is 8.`);
  }

  const citationFingerprints = extractCitationUrls(result.raw);
  const history = loadJson(HISTORY_FILE, { schema_version: "1.0", items: [] });
  if (!Array.isArray(history.items)) history.items = [];
  const historyKeys = recentHistoryKeys(history);
  const posted = publishedIds();

  const accepted = [];
  const rejected = [];

  for (const candidate of parsedCandidates) {
    const checked = validateCandidate(candidate, citationFingerprints, historyKeys, posted);
    if (checked.ok) accepted.push(checked.candidate);
    else rejected.push({ title: clean(candidate?.title), reason: checked.reason, diagnostic: checked.diagnostic || null });
  }

  const selected = selectDiverse(accepted);

  const strictCount = accepted.filter(row => row.quality_tier === "strict").length;
  const fallbackCount = accepted.filter(row => row.quality_tier === "fallback").length;
  console.log(
    `Discovery gate: raw=${parsedCandidates.length} accepted=${accepted.length} ` +
    `(strict=${strictCount}, fallback=${fallbackCount}) selected=${selected.length}.`
  );

  if (rejected.length) {
    const counts = {};
    for (const row of rejected) counts[row.reason] = (counts[row.reason] || 0) + 1;
    console.log("Rejected candidate reasons:", JSON.stringify(counts));
    for (const row of rejected.slice(0, 12)) {
      const d = row.diagnostic
        ? ` raw(sig=${row.diagnostic.significance_raw},nov=${row.diagnostic.novelty_raw},bf=${row.diagnostic.butterfly_raw})` +
          ` normalized(sig=${row.diagnostic.significance},nov=${row.diagnostic.novelty},bf=${row.diagnostic.butterfly})` +
          ` composite=${row.diagnostic.composite}`
        : "";
      console.log(`- rejected [${row.reason}]${d} ${row.title || "(untitled)"}`);
    }
  }

  for (const row of selected) {
    console.log(
      `- selected [${row.quality_tier}] score=${row.rank_score} ` +
      `[${row.domain}] ${row.title}`
    );
  }

  if (selected.length < 3) {
    throw new Error(
      `Quality/diversity gate produced only ${selected.length} publishable candidates. ` +
      `Refusing to overwrite the current queue with weak material. See rejection diagnostics above.`
    );
  }

  const createdAt = new Date().toISOString();
  const queueItems = [];
  const sharedStations = [];

  for (const candidate of selected) {
    const shared = await createSharedStation(candidate);
    const shareUrl = shared.share_url;

    queueItems.push({
      id: candidate.item_id,
      enabled: true,
      created_at: createdAt,
      source_url: shareUrl,
      title: candidate.title,
      x_text: buildXText(candidate, shareUrl),
      linkedin_text:
        `${candidate.title}

${candidate.summary}

${candidate.why_it_matters}

` +
        `${candidate.butterfly_question}

Explore it in Cosmos.`,
      platforms: ["x"],
      not_before: null,
      discovery: {
        domain: candidate.domain,
        geography: candidate.geography,
        topic_key: candidate.topic_key,
        significance_score: candidate.significance_score,
        novelty_score: candidate.novelty_score,
        butterfly_score: candidate.butterfly_score,
        confidence: candidate.confidence,
        sources: candidate.sources,
        share_station_id: shared.station_id,
        share_image_url: shared.image_url,
        share_projection_entity_count: shared.projection_entity_count,
        share_projection_relationship_count: shared.projection_relationship_count
      }
    });

    sharedStations.push({
      item_id: candidate.item_id,
      station_id: shared.station_id,
      share_url: shared.share_url,
      image_url: shared.image_url
    });
  }

  const queue = {
    schema_version: "1.0",
    updated_at: createdAt,
    generated_by: "scripts/cosmos_universal_social_discovery.mjs",
    policy: {
      mode: "universal_cross_domain_discovery",
      target_count: TARGET_COUNT,
      strict_composite_score: STRICT_COMPOSITE,
      fallback_composite_score: FALLBACK_COMPOSITE,
      fallback_butterfly_score: FALLBACK_BUTTERFLY,
      automatic_platforms: ["x"],
      note:
        "Fresh evidence-backed Cosmos discoveries only. Each queued item uses the persistent Cloudflare Cosmos share surface with a verified social image. Public-policy/political and manual-review candidates are excluded from unattended social publishing."
    },
    items: queueItems
  };

  writeJson(QUEUE_FILE, queue);

  const recentCutoff = Date.now() - 30 * 86400_000;
  const retainedHistory = history.items.filter(row => {
    const t = new Date(row?.queued_at || "").getTime();
    return Number.isFinite(t) && t >= recentCutoff;
  });

  const sharedByItem = new Map(sharedStations.map(row => [row.item_id, row]));

  for (const candidate of selected) {
    const shared = sharedByItem.get(candidate.item_id) || {};
    retainedHistory.push({
      topic_key: candidate.topic_key,
      item_id: candidate.item_id,
      queued_at: createdAt,
      title: candidate.title,
      summary: candidate.summary,
      why_it_matters: candidate.why_it_matters,
      butterfly_question: candidate.butterfly_question,
      domain: candidate.domain,
      geography: candidate.geography,
      primary_source_url: candidate.sources?.[0]?.url || "",
      station_id: shared.station_id || "",
      share_url: shared.share_url || ""
    });
  }

  writeJson(HISTORY_FILE, {
    schema_version: "1.0",
    updated_at: createdAt,
    items: retainedHistory
  });

  writeCosmosDiscoveryArchive(retainedHistory, createdAt);
  writeCosmosSitemap(createdAt);

  writeJson(DISCOVERY_FILE, {
    schema_version: "1.0",
    generated_at: createdAt,
    request_time_utc: result.request_time_utc,
    model: MODEL,
    provider_response_id: String(result.raw?.id || ""),
    web_search_citation_count: citationFingerprints.size,
    raw_candidate_count: parsedCandidates.length,
    accepted_candidate_count: accepted.length,
    rejected_candidate_count: rejected.length,
    selected_count: selected.length,
    shared_stations: sharedStations,
    selected: selected.map(candidate => ({
      item_id: candidate.item_id,
      topic_key: candidate.topic_key,
      domain: candidate.domain,
      geography: candidate.geography,
      title: candidate.title,
      summary: candidate.summary,
      why_it_matters: candidate.why_it_matters,
      butterfly_question: candidate.butterfly_question,
      hashtags: normalizedHashtags(candidate),
      significance_score: candidate.significance_score,
      novelty_score: candidate.novelty_score,
      butterfly_score: candidate.butterfly_score,
      confidence: candidate.confidence,
      quality_tier: candidate.quality_tier,
      rank_score: candidate.rank_score,
      normalized_scores: candidate.normalized_scores,
      citation_matched: Boolean(candidate.citation_matched),
      sources: candidate.sources
    })),
    rejected
  });

  console.log(`Cosmos universal discovery selected ${selected.length} item(s) from ${parsedCandidates.length} candidates.`);
  console.log(`Web-search citation fingerprints observed: ${citationFingerprints.size}.`);
  for (const item of queueItems) {
    console.log(`- [${item.discovery.domain}] ${item.title}`);
    console.log(`  ${item.source_url}`);
    console.log(`  X: ${item.x_text.replace(/\n/g, " | ")}`);
  }
  console.log(`Updated ${QUEUE_FILE}, ${DISCOVERY_FILE}, ${HISTORY_FILE}, ${COSMOS_DISCOVERIES_FILE}, and ${SITEMAP_COSMOS_FILE}.`);
}

main().catch(error => {
  console.error("COSMOS_UNIVERSAL_DISCOVERY_ERROR", error?.stack || error);
  process.exit(1);
});
