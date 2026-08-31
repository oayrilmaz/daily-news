#!/usr/bin/env node
/**
 * Cosmos Answer-First v0.1
 * Deterministic, read-only answer presentation layer.
 *
 * Purpose:
 *   Turn a resolved Cosmos observer/object result into a reader-first response:
 *   1) direct answer
 *   2) dated current intelligence
 *   3) why it matters now
 *   4) exploration actions
 *
 * No OpenAI. No external search. No graph mutation.
 */

import fs from "node:fs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function clean(v) { return typeof v === "string" ? v.trim() : ""; }
function arr(v) { return Array.isArray(v) ? v : []; }
function uniq(xs) { return [...new Set(xs.filter(Boolean))]; }

function parseDate(value) {
  const s = clean(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoDate(value) {
  const d = parseDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}
function displayDate(value) {
  const d = parseDate(value);
  if (!d) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(d);
}
function itemDate(item) {
  return item?.published_at || item?.created_at || item?.newest_signal_at ||
         item?.date || item?.updated_at || item?.timestamp || "";
}
function itemTitle(item) {
  return clean(item?.title || item?.headline || item?.name) || "Untitled intelligence";
}
function itemSummary(item) {
  return clean(item?.lede || item?.summary || item?.description || item?.why_it_matters);
}
function normalize(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(s) {
  return new Set(normalize(s).split(/\s+/).filter(x => x.length > 2));
}
function overlapScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.max(1, Math.min(A.size, B.size));
}
function bestDescription(object) {
  return clean(
    object?.answer ||
    object?.direct_answer ||
    object?.description ||
    object?.summary ||
    object?.definition ||
    object?.what_is_this
  );
}
function memberLabels(object) {
  return uniq([
    ...arr(object?.members).map(x => clean(x?.label || x?.name || x)),
    ...arr(object?.components).map(x => clean(x?.label || x?.name || x)),
    ...arr(object?.equipment).map(x => clean(x?.label || x?.name || x)),
    ...arr(object?.related_objects)
      .filter(x => ["component","equipment","contains","includes","part_of"].includes(clean(x?.relationship).toLowerCase()))
      .map(x => clean(x?.label || x?.name))
  ]);
}
function isListQuestion(q) {
  const n = normalize(q);
  return /\bwhat (are|is) the\b/.test(n) ||
         /\bwhich\b/.test(n) ||
         /\blist\b/.test(n) ||
         /\bwhat equipment\b/.test(n) ||
         /\bwhat components\b/.test(n);
}
function buildDirectAnswer(question, object) {
  const explicit = clean(object?.direct_answer || object?.answer);
  if (explicit) return explicit;

  const description = bestDescription(object);
  const members = memberLabels(object);

  if (isListQuestion(question) && members.length) {
    const prefix = description ? `${description} ` : "";
    return `${prefix}Key items include ${members.slice(0, 14).join(", ")}.`;
  }
  if (description) return description;

  return `Cosmos found ${clean(object?.label || object?.name) || "this subject"} in PTD Today knowledge, but the current knowledge record does not yet contain enough descriptive information to answer the question directly.`;
}
function relevance(item, question, object) {
  const hay = [itemTitle(item), itemSummary(item), arr(item?.tags).join(" "), arr(item?.entities).join(" ")].join(" ");
  return Math.max(
    overlapScore(hay, question),
    overlapScore(hay, clean(object?.label || object?.name)),
    Number(item?.relevance_score || 0) / 100
  );
}
function selectIntelligence(items, question, object, limit = 5) {
  return arr(items)
    .map((item, index) => ({ item, index, score: relevance(item, question, object), d: parseDate(itemDate(item)) }))
    .filter(x => x.score > 0)
    .sort((a,b) => (b.score-a.score) || ((b.d?.getTime()||0)-(a.d?.getTime()||0)) || (a.index-b.index))
    .slice(0, limit)
    .map(({item, score}) => ({
      id: clean(item?.id || item?.development_id || item?.signal_id),
      title: itemTitle(item),
      summary: itemSummary(item),
      date: isoDate(itemDate(item)),
      date_display: displayDate(itemDate(item)),
      relevance: Math.round(score * 100),
      article_id: clean(item?.article_id || item?.development_id || item?.id),
      follow_the_ripple: {
        enabled: true,
        label: "Follow the ripple →",
        focus_id: clean(item?.development_id || item?.signal_id || item?.id)
      }
    }));
}
function whyNow(intelligence, object) {
  const explicit = clean(object?.why_it_matters_now || object?.why_now);
  if (explicit) return explicit;
  if (!intelligence.length) return "";
  const dated = intelligence.filter(x => x.date).length;
  return `${intelligence.length} relevant PTD Today intelligence item${intelligence.length === 1 ? "" : "s"} are connected to this subject${dated ? `; ${dated} include usable publication dates` : ""}.`;
}

export function buildAnswerFirst(input) {
  const question = clean(input?.question || input?.entry_question);
  const object = input?.object || input?.observer || {};
  const intelligence = selectIntelligence(input?.intelligence || input?.daily_briefing || [], question, object, Number(input?.limit || 5));

  return {
    schema_version: "0.1",
    status: "cosmos_answer_first_resolved",
    question,
    observer: {
      id: clean(object?.id || object?.entity_id || object?.development_id),
      label: clean(object?.label || object?.name || object?.title) || question || "Cosmos",
      type: clean(object?.type || object?.kind) || "object"
    },
    answer: {
      heading: "Answer",
      text: buildDirectAnswer(question, object),
      answer_available: Boolean(bestDescription(object) || memberLabels(object).length)
    },
    current_intelligence: {
      heading: "Current intelligence",
      count: intelligence.length,
      items: intelligence
    },
    why_it_matters_now: {
      heading: "Why it matters now",
      text: whyNow(intelligence, object)
    },
    exploration: {
      heading: "Explore in Cosmos",
      actions: [
        { type: "observer", label: "Explore this subject", focus_id: clean(object?.id || object?.entity_id) },
        { type: "expand", label: "Expand one layer +" }
      ]
    },
    presentation_order: [
      "answer",
      "current_intelligence",
      "why_it_matters_now",
      "exploration"
    ],
    contracts: {
      direct_answer_precedes_intelligence: true,
      article_dates_preserved_when_available: true,
      missing_dates_are_explicit: true,
      intelligence_does_not_replace_answer: true,
      follow_the_ripple_available_per_intelligence_item: true,
      observer_remains_explorable: true,
      source_content_not_rewritten_as_fact: true
    },
    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      mutates_graph: false,
      invents_missing_dates: false,
      promotes_scenario_to_fact: false,
      rewrites_source_confidence: false
    }
  };
}

const inputFile = arg("--input");
const outFile = arg("--out");
if (inputFile) {
  const result = buildAnswerFirst(readJson(inputFile));
  const text = JSON.stringify(result, null, 2) + "\n";
  if (outFile) {
    fs.mkdirSync(new URL(".", `file://${outFile}`).pathname, { recursive: true });
    fs.writeFileSync(outFile, text);
  } else process.stdout.write(text);
}
