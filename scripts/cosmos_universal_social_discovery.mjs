import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const MODEL = String(process.env.COSMOS_DISCOVERY_MODEL || "gpt-6-luna").trim();

const QUEUE_FILE = process.env.SOCIAL_QUEUE_FILE || "data/social-queue.json";
const STATE_FILE = process.env.SOCIAL_STATE_FILE || "data/social-published.json";
const DISCOVERY_FILE = process.env.COSMOS_DISCOVERY_FILE || "data/cosmos-universal-discovery.json";
const HISTORY_FILE = process.env.COSMOS_DISCOVERY_HISTORY_FILE || "data/cosmos-universal-discovery-history.json";
const Q_DIR = process.env.COSMOS_QUESTION_DIR || "q";
const QUESTION_TEMPLATE = process.env.COSMOS_QUESTION_TEMPLATE || "q.html";
const SITEMAP_COSMOS = process.env.SITEMAP_COSMOS_FILE || "sitemap-cosmos.xml";
const DISCOVERIES_HTML = process.env.COSMOS_DISCOVERIES_HTML || "cosmos-discoveries.html";

const SITE_ORIGIN = String(process.env.SITE_ORIGIN || "https://ptdtoday.com").replace(/\/+$/, "");
const TARGET_COUNT = positiveInt(process.env.SOCIAL_QUEUE_TARGET, 5);
const STRICT_COMPOSITE = positiveInt(process.env.COSMOS_STRICT_COMPOSITE, 60);
const FALLBACK_COMPOSITE = positiveInt(process.env.COSMOS_FALLBACK_COMPOSITE, 48);
const FALLBACK_BUTTERFLY = positiveInt(process.env.COSMOS_FALLBACK_BUTTERFLY, 45);
const HISTORY_DAYS = positiveInt(process.env.COSMOS_HISTORY_DAYS, 7);

const BLOCKED_AUTOMATED_RE = /\b(election|electoral|ballot|candidate|partisan|political party|presidential race|parliamentary race|polling|voting intention|war|military strike|terror attack|mass shooting|hostage|death toll|murder|suicide|graphic violence)\b/i;
const POLITICAL_CAMPAIGN_RE = /\b(?:political|election|electoral|presidential|parliamentary|candidate)\s+campaign\b|\bcampaign\s+(?:trail|rally|finance|ad|advertising|strategy)\b/i;

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
          "topic_key","domain","geography","title","summary","why_it_matters",
          "butterfly_question","social_hook","hashtags","challenge_question",
          "challenge_options","answer_mode","cosmos_choice","answer_explanation",
          "challenge_confidence","attention_score","significance_score","novelty_score",
          "butterfly_score","confidence","manual_review","manual_review_reason","sources"
        ],
        properties: {
          topic_key: { type: "string" },
          domain: { type: "string", enum: [
            "science","health","technology","ai","space","environment","economics",
            "business","society","culture","education","infrastructure","energy",
            "public_policy","sports","travel","other"
          ] },
          geography: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          why_it_matters: { type: "string" },
          butterfly_question: { type: "string" },
          social_hook: { type: "string" },
          hashtags: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
          challenge_question: { type: "string" },
          challenge_options: {
            type: "array", minItems: 5, maxItems: 5,
            items: {
              type: "object", additionalProperties: false,
              required: ["key","label"],
              properties: {
                key: { type: "string", enum: ["A","B","C","D","E"] },
                label: { type: "string" }
              }
            }
          },
          answer_mode: { type: "string", enum: ["fact","supported","opinion","prediction"] },
          cosmos_choice: { type: "string", enum: ["A","B","C","D","E","NONE"] },
          answer_explanation: { type: "string" },
          challenge_confidence: { type: "string", enum: ["high","medium","low"] },
          attention_score: { type: "integer", minimum: 0, maximum: 100 },
          significance_score: { type: "integer", minimum: 0, maximum: 100 },
          novelty_score: { type: "integer", minimum: 0, maximum: 100 },
          butterfly_score: { type: "integer", minimum: 0, maximum: 100 },
          confidence: { type: "string", enum: ["high","medium","low"] },
          manual_review: { type: "boolean" },
          manual_review_reason: { type: "string" },
          sources: {
            type: "array", minItems: 2, maxItems: 3,
            items: {
              type: "object", additionalProperties: false,
              required: ["title","url","publisher","published_at"],
              properties: {
                title: { type: "string" }, url: { type: "string" },
                publisher: { type: "string" }, published_at: { type: "string" }
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
    sports: "#Sports",
    travel: "#Travel",
    public_policy: "#PublicPolicy",
    other: "#Innovation"
  }[candidate.domain];

  if (tags.length < 3 && fallback && !tags.includes(fallback)) tags.push(fallback);
  if (tags.length < 3) tags.push("#Innovation");

  return tags.slice(0, 4);
}

function score(candidate) {
  return (
    normalizedScore(candidate.significance_score) * 0.25 +
    normalizedScore(candidate.butterfly_score) * 0.30 +
    normalizedScore(candidate.novelty_score) * 0.20 +
    normalizedScore(candidate.attention_score) * 0.25
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

  const challengeQuestion = truncate(candidate.challenge_question || candidate.butterfly_question, 220);
  const answerMode = ["fact", "supported", "opinion", "prediction"].includes(candidate.answer_mode)
    ? candidate.answer_mode
    : "supported";
  const cosmosChoice = /^[A-E]$/.test(String(candidate.cosmos_choice || ""))
    ? String(candidate.cosmos_choice)
    : "NONE";
  const challengeOptions = Array.isArray(candidate.challenge_options)
    ? candidate.challenge_options
        .filter(option => /^[A-E]$/.test(String(option?.key || "")) && clean(option?.label))
        .slice(0, 5)
        .map(option => ({ key: String(option.key), label: truncate(option.label, 120) }))
    : [];

  if (!challengeQuestion) return { ok: false, reason: "missing_challenge_question" };
  if (challengeOptions.length !== 5 || challengeOptions.map(o => o.key).join("") !== "ABCDE") {
    return { ok: false, reason: "invalid_challenge_options" };
  }
  if (["fact", "supported"].includes(answerMode) && cosmosChoice === "NONE") {
    return { ok: false, reason: "missing_cosmos_choice" };
  }

  const primary = uniqueByUrl[0];
  const itemId = `universal-${hash12(`${topicKey}|${primary.url}|${challengeQuestion}`)}`;

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
      challenge_question: challengeQuestion,
      challenge_options: challengeOptions,
      answer_mode: answerMode,
      cosmos_choice: cosmosChoice,
      answer_explanation: truncate(candidate.answer_explanation, 700),
      challenge_confidence: ["high", "medium", "low"].includes(candidate.challenge_confidence)
        ? candidate.challenge_confidence
        : candidate.confidence,
      attention_score: normalizedScore(candidate.attention_score),
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
    const globalScope = ["global", "worldwide", "international", "multiple", "cross-border"].includes(geo);
    return (domainCount.get(domain) || 0) < 2 && (globalScope || (geoCount.get(geo) || 0) < 2);
  };

  const add = candidate => {
    selected.push(candidate);
    const domain = candidate.domain || "other";
    const geo = clean(candidate.geography).toLowerCase() || "global";
    const globalScope = ["global", "worldwide", "international", "multiple", "cross-border"].includes(geo);
    domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    if (!globalScope) geoCount.set(geo, (geoCount.get(geo) || 0) + 1);
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



function compactOptions(candidate) {
  return candidate.challenge_options.map(option => `${option.key}. ${truncate(option.label, 34)}`).join(" · ");
}

function buildXText(candidate, questionUrl) {
  const tags = normalizedHashtags(candidate).slice(0, 3).join(" ");
  const q = truncate(candidate.challenge_question, 118);
  const options = compactOptions(candidate);
  const cta = "Choose first. Then see the Crowd + Cosmos.";
  const reserved = questionUrl.length + 4;
  const max = Math.max(150, 280 - reserved);

  const versions = [
    `${q}\n${options}\n${cta}\n${tags}`,
    `${q}\n${options}\nVote before seeing the result.\n${tags}`,
    `${q}\nA–E: choose inside Cosmos. See the Crowd + Cosmos.\n${tags}`,
    `${q}\nChoose before seeing what everyone else thinks.\n${tags}`
  ];
  return versions.find(text => text.length <= max) || truncate(versions.at(-1), max);
}

function buildLinkedInText(candidate) {
  const options = candidate.challenge_options.map(option => `${option.key}. ${option.label}`).join("\n");
  const tags = normalizedHashtags(candidate).join(" ");
  return [
    candidate.social_hook || candidate.title,
    "",
    candidate.challenge_question,
    "",
    options,
    "",
    "Choose before seeing how the crowd answered — then follow your choice through the Cosmos Butterfly.",
    "",
    tags
  ].join("\n");
}

function challengeSlug(candidate) {
  const base = safeTopicKey(candidate.topic_key || candidate.title).slice(0, 56) || "cosmos-question";
  return `${base}-${hash12(`${candidate.item_id}|${candidate.challenge_question}`).slice(0, 8)}`;
}

function officialChallenge(candidate, pageUrl) {
  return {
    schema_version: "1.0",
    challenge_id: `official-${hash12(`${candidate.item_id}|${candidate.challenge_question}`)}`,
    official: true,
    created_at: new Date().toISOString(),
    title: candidate.title,
    short_title: truncate(candidate.title, 70),
    question_id: "root",
    question: candidate.challenge_question,
    options: candidate.challenge_options,
    answer_mode: candidate.answer_mode,
    cosmos_choice: candidate.cosmos_choice,
    answer_explanation: candidate.answer_explanation,
    confidence: candidate.challenge_confidence,
    butterfly_question: candidate.butterfly_question,
    domain: candidate.domain,
    geography: candidate.geography,
    canonical_url: pageUrl,
    sources: candidate.sources
  };
}

function renderOfficialQuestionPage(template, challenge, candidate, pageUrl) {
  const description = truncate(
    `Choose first, compare with the crowd and Cosmos, then follow the Butterfly. ${candidate.summary}`,
    260
  );
  const bootstrap = JSON.stringify(challenge).replace(/</g, "\\u003c");
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(candidate.challenge_question)} · Cosmos Question</title>`);
  html = html.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(description)}">`);
  html = html.replace(/<meta name="robots"[^>]*>/i, `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">`);
  html = html.replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(candidate.challenge_question)}">`);
  html = html.replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(description)}">`);
  html = html.replace("</head>", `  <link rel="canonical" href="${escapeHtml(pageUrl)}">\n  <meta property="og:url" content="${escapeHtml(pageUrl)}">\n</head>`);
  html = html.replace(
    '<script src="/assets/cosmos-question.js" defer></script>',
    `<script>window.COSMOS_CHALLENGE_BOOTSTRAP=${bootstrap};</script>\n  <script src="/assets/cosmos-question.js" defer></script>`
  );
  return html;
}

function collectHtmlUrls(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith(".html"))
    .map(name => {
      const full = path.join(dir, name);
      return { url: `${SITE_ORIGIN}/${prefix}/${encodeURIComponent(name)}`, lastmod: fs.statSync(full).mtime.toISOString() };
    });
}

function writeCosmosSitemap() {
  const urls = [
    ...collectHtmlUrls("explore", "explore"),
    ...collectHtmlUrls(Q_DIR, "q")
  ];
  const seen = new Set();
  const rows = [];
  for (const row of urls.sort((a,b) => b.lastmod.localeCompare(a.lastmod))) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    rows.push(`  <url><loc>${xmlEscape(row.url)}</loc><lastmod>${xmlEscape(row.lastmod)}</lastmod><changefreq>weekly</changefreq><priority>0.75</priority></url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP_COSMOS, xml, "utf8");
}

function writeDiscoveriesArchive(queueItems) {
  const cards = queueItems.map(item => {
    const c = item.discovery?.challenge || {};
    const options = (c.options || []).map(o => `<li><strong>${escapeHtml(o.key)}.</strong> ${escapeHtml(o.label)}</li>`).join("");
    return `<article><h2><a href="${escapeHtml(item.source_url)}">${escapeHtml(c.question || item.title)}</a></h2><p>${escapeHtml(item.discovery?.summary || "")}</p><ol>${options}</ol><p><a href="${escapeHtml(item.source_url)}">Answer before seeing the result →</a></p></article>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cosmos Questions · PTD Today</title><meta name="description" content="Fresh evidence-backed questions from Cosmos. Choose first, compare with the crowd and Cosmos, then follow the Butterfly."><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE_ORIGIN}/cosmos-discoveries.html"></head><body><main><h1>Cosmos Questions</h1><p>Choose first. See what the world and Cosmos think. Follow where it leads.</p>${cards}</main></body></html>\n`;
  fs.writeFileSync(DISCOVERIES_HTML, html, "utf8");
}

function discoveryPrompt(requestTime) {
  return [
    "You are the universal discovery and attention layer for PTD Today / Cosmos.",
    "",
    "MISSION",
    "Find fresh, evidence-backed developments that can become irresistible but responsible Cosmos Questions — short participatory entrances that lead into a butterfly-effect exploration.",
    "Cosmos is universal. Science, health, technology, AI, space, environment, economics, business, society, culture, education, infrastructure, energy, sports, travel and other domains compete on equal terms.",
    "",
    "DISCOVERY WINDOW",
    `Current UTC time: ${requestTime}`,
    "Prioritize developments from roughly the last 24-36 hours. Use older context only when necessary to explain a genuinely fresh change.",
    "",
    "SELECTION",
    "- Return 8-12 candidates so downstream quality/diversity gates can select the strongest 3-5.",
    "- Prefer developments with meaningful second-order consequences and cross-domain paths.",
    "- attention_score measures whether a normal person would stop, choose and want to see the result — without clickbait.",
    "- Avoid generic headline summaries. Turn each development into a question that creates curiosity, comparison or surprise.",
    "- Do not force energy or AI. Topic diversity is a core requirement.",
    "",
    "COSMOS QUESTION CONTRACT",
    "- challenge_question must be self-contained, concise and understandable without reading the source article.",
    "- Provide exactly five options with keys A, B, C, D, E in that order.",
    "- Options must all be plausible and distinct. Avoid joke answers or obvious padding.",
    "- answer_mode=fact only when there is an objectively verifiable correct answer.",
    "- answer_mode=supported when evidence currently favors one answer but uncertainty remains.",
    "- answer_mode=opinion when no answer is objectively correct; use cosmos_choice=NONE.",
    "- answer_mode=prediction for unresolved future outcomes; cosmos_choice may be the evidence-backed Cosmos view today or NONE when evidence is too weak.",
    "- For fact or supported, cosmos_choice must be A-E and answer_explanation must explain why using the evidence.",
    "- Never call a forecast 'correct'. Use best-supported/current view logic instead.",
    "- butterfly_question is the deeper consequence question that becomes the bridge into Cosmos.",
    "",
    "SOCIAL",
    "- social_hook must be factual, short and curiosity-producing, not sensational.",
    "- The social post will hide the crowd result and answer until the person enters Cosmos.",
    "- hashtags: 2-4 genuinely relevant topical tags. Do not include #Cosmos; downstream adds it.",
    "",
    "EVIDENCE",
    "- Use web search.",
    "- Each candidate requires 2-3 direct public source URLs from at least two independent domains.",
    "- Prefer primary/official/scientific/regulatory/company-filing/institutional/high-quality reporting.",
    "- Do not invent URLs.",
    "- The title, summary, why_it_matters, challenge answer and explanation must be supported by the sources.",
    "",
    "UNATTENDED SOCIAL SAFETY",
    "- Do not select elections, candidates, campaigns, partisan persuasion, polling, war/acute violence, tragedy or contested allegations for unattended posting.",
    "- Public-policy/regulatory developments may be returned only with manual_review=true.",
    "- Mark manual_review=true for individualized medical/financial/legal advice or anything inappropriate for unattended publication.",
    "",
    "SCORING",
    "- significance_score: real-world importance.",
    "- novelty_score: how meaningfully new it is now.",
    "- butterfly_score: consequence/cross-domain depth.",
    "- attention_score: likelihood a broad audience will stop, choose, and want the reveal while remaining factual.",
    "",
    "Return only the required structured JSON."
  ].join("\n");
}

async function requestUniversalDiscovery() {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for Cosmos universal discovery.");
  const requestTime = new Date().toISOString();
  const payload = {
    model: MODEL,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "auto",
    store: false,
    max_output_tokens: 9000,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "cosmos_universal_question_discovery",
        description: "Fresh cross-domain, evidence-backed Cosmos Question candidates.",
        strict: true,
        schema: DISCOVERY_SCHEMA
      }
    },
    input: [{ role: "user", content: [{ type: "input_text", text: discoveryPrompt(requestTime) }] }]
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const rawText = await response.text();
  let raw = {};
  try { raw = rawText ? JSON.parse(rawText) : {}; } catch { raw = { raw_text: rawText.slice(0,4000) }; }
  if (!response.ok) {
    const detail = raw?.error?.message || raw?.message || raw?.raw_text || rawText;
    throw new Error(`OpenAI Responses API ${response.status}: ${String(detail).slice(0,1800)}`);
  }
  const outputText = extractOutputText(raw);
  if (!outputText) throw new Error("Universal discovery returned no structured output text.");
  let parsed;
  try { parsed = JSON.parse(outputText); } catch (error) { throw new Error(`Could not parse universal discovery JSON: ${error.message}`); }
  return { raw, parsed, request_time_utc: requestTime };
}

function loadMockDiscovery(file) {
  const parsed = JSON.parse(fs.readFileSync(file,"utf8"));
  return { raw: { id: "mock_response", output: [] }, parsed, request_time_utc: new Date().toISOString() };
}

async function main() {
  const mockFile = String(process.env.COSMOS_DISCOVERY_MOCK_FILE || "").trim();
  const result = mockFile ? loadMockDiscovery(mockFile) : await requestUniversalDiscovery();
  const parsedCandidates = Array.isArray(result.parsed?.candidates) ? result.parsed.candidates : [];
  if (parsedCandidates.length < 8) throw new Error(`Universal discovery returned only ${parsedCandidates.length} candidates; minimum is 8.`);

  const citationFingerprints = extractCitationUrls(result.raw);
  const history = loadJson(HISTORY_FILE,{schema_version:"1.0",items:[]});
  if(!Array.isArray(history.items)) history.items=[];
  const historyKeys = recentHistoryKeys(history);
  const posted = publishedIds();
  const accepted=[]; const rejected=[];
  for(const candidate of parsedCandidates){
    const checked=validateCandidate(candidate,citationFingerprints,historyKeys,posted);
    if(checked.ok) accepted.push(checked.candidate);
    else rejected.push({title:clean(candidate?.title),reason:checked.reason,diagnostic:checked.diagnostic||null});
  }
  const selected=selectDiverse(accepted);
  if(selected.length<3){
    const counts={}; for(const row of rejected) counts[row.reason]=(counts[row.reason]||0)+1;
    console.log("Rejected candidate reasons:",JSON.stringify(counts));
    throw new Error(`Quality/diversity gate produced only ${selected.length} publishable candidates. Refusing to overwrite the current queue.`);
  }
  if(!fs.existsSync(QUESTION_TEMPLATE)) throw new Error(`Missing ${QUESTION_TEMPLATE}. Add the supplied q.html before running discovery.`);
  const template=fs.readFileSync(QUESTION_TEMPLATE,"utf8");
  fs.mkdirSync(Q_DIR,{recursive:true});

  const createdAt=new Date().toISOString();
  const queueItems=[];
  for(const candidate of selected){
    const slug=challengeSlug(candidate);
    const pageUrl=`${SITE_ORIGIN}/q/${slug}.html`;
    const challenge=officialChallenge(candidate,pageUrl);
    fs.writeFileSync(path.join(Q_DIR,`${slug}.html`),renderOfficialQuestionPage(template,challenge,candidate,pageUrl),"utf8");
    queueItems.push({
      id:candidate.item_id,
      enabled:true,
      created_at:createdAt,
      source_url:pageUrl,
      title:candidate.challenge_question,
      x_text:buildXText(candidate,pageUrl),
      linkedin_text:buildLinkedInText(candidate),
      platforms:["x"],
      not_before:null,
      discovery:{
        domain:candidate.domain,
        geography:candidate.geography,
        topic_key:candidate.topic_key,
        title:candidate.title,
        summary:candidate.summary,
        why_it_matters:candidate.why_it_matters,
        significance_score:candidate.significance_score,
        novelty_score:candidate.novelty_score,
        butterfly_score:candidate.butterfly_score,
        attention_score:candidate.attention_score,
        confidence:candidate.confidence,
        sources:candidate.sources,
        challenge:{
          challenge_id:challenge.challenge_id,
          question:candidate.challenge_question,
          options:candidate.challenge_options,
          answer_mode:candidate.answer_mode,
          cosmos_choice:candidate.cosmos_choice,
          confidence:candidate.challenge_confidence,
          canonical_url:pageUrl,
          butterfly_question:candidate.butterfly_question
        }
      }
    });
  }

  writeJson(QUEUE_FILE,{
    schema_version:"2.0",
    updated_at:createdAt,
    generated_by:"scripts/cosmos_universal_social_discovery.mjs",
    policy:{
      mode:"universal_cross_domain_participatory_discovery",
      target_count:TARGET_COUNT,
      strict_composite_score:STRICT_COMPOSITE,
      fallback_composite_score:FALLBACK_COMPOSITE,
      fallback_butterfly_score:FALLBACK_BUTTERFLY,
      automatic_platforms:["x"],
      note:"Question-first social entrances. Vote inside Cosmos; reveal Crowd + Cosmos; continue through a Butterfly."
    },
    items:queueItems
  });

  const recentCutoff=Date.now()-30*86400_000;
  const retainedHistory=history.items.filter(row=>{const t=new Date(row?.queued_at||"").getTime();return Number.isFinite(t)&&t>=recentCutoff;});
  for(const candidate of selected){
    retainedHistory.push({topic_key:candidate.topic_key,item_id:candidate.item_id,queued_at:createdAt,title:candidate.title,domain:candidate.domain,geography:candidate.geography,primary_source_url:candidate.sources?.[0]?.url||""});
  }
  writeJson(HISTORY_FILE,{schema_version:"1.0",updated_at:createdAt,items:retainedHistory});
  writeJson(DISCOVERY_FILE,{
    schema_version:"2.0",generated_at:createdAt,request_time_utc:result.request_time_utc,model:MODEL,
    provider_response_id:String(result.raw?.id||""),web_search_citation_count:citationFingerprints.size,
    raw_candidate_count:parsedCandidates.length,accepted_candidate_count:accepted.length,rejected_candidate_count:rejected.length,
    selected_count:selected.length,
    selected:selected.map(candidate=>({
      item_id:candidate.item_id,topic_key:candidate.topic_key,domain:candidate.domain,geography:candidate.geography,
      title:candidate.title,summary:candidate.summary,why_it_matters:candidate.why_it_matters,
      challenge_question:candidate.challenge_question,challenge_options:candidate.challenge_options,
      answer_mode:candidate.answer_mode,cosmos_choice:candidate.cosmos_choice,answer_explanation:candidate.answer_explanation,
      butterfly_question:candidate.butterfly_question,hashtags:normalizedHashtags(candidate),
      significance_score:candidate.significance_score,novelty_score:candidate.novelty_score,
      butterfly_score:candidate.butterfly_score,attention_score:candidate.attention_score,
      confidence:candidate.confidence,quality_tier:candidate.quality_tier,rank_score:candidate.rank_score,sources:candidate.sources
    })),rejected
  });

  writeDiscoveriesArchive(queueItems);
  writeCosmosSitemap();
  console.log(`Cosmos participatory discovery selected ${selected.length} question(s) from ${parsedCandidates.length} candidates.`);
  for(const item of queueItems){ console.log(`- ${item.title}`); console.log(`  ${item.source_url}`); console.log(`  X: ${item.x_text.replace(/\n/g," | ")}`); }
  console.log(`Updated ${QUEUE_FILE}, ${DISCOVERY_FILE}, ${HISTORY_FILE}, ${DISCOVERIES_HTML}, ${SITEMAP_COSMOS}, and ${Q_DIR}/.`);
}

main().catch(error=>{console.error("COSMOS_UNIVERSAL_DISCOVERY_ERROR",error?.stack||error);process.exit(1);});
