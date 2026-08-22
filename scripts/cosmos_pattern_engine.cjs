#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Pattern Engine v0.2
 * Deterministic, explainable pattern detection. No OpenAI calls.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || 'knowledge';
const COSMOS_DIR = path.join(ROOT, KNOWLEDGE_DIR, 'cosmos');
const HISTORY_DIR = path.join(COSMOS_DIR, 'pattern-history');
const FILES = {
  state: path.join(COSMOS_DIR, 'state-current.json'),
  delta: path.join(COSMOS_DIR, 'delta-current.json'),
  impact: path.join(COSMOS_DIR, 'impact-current.json'),
  developments: path.join(ROOT, KNOWLEDGE_DIR, 'developments.json'),
  relationships: path.join(ROOT, KNOWLEDGE_DIR, 'relationships.json'),
  output: path.join(COSMOS_DIR, 'patterns-current.json')
};

function num(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
const MIN_PATTERN_SCORE = num(process.env.COSMOS_PATTERN_MIN_SCORE, 35, 0, 100);
const MAX_PATTERNS = Math.round(num(process.env.COSMOS_PATTERN_MAX_RESULTS, 100, 10, 1000));
const MIN_CONVERGING_SEEDS = Math.round(num(process.env.COSMOS_PATTERN_MIN_CONVERGING_SEEDS, 2, 2, 20));
const MIN_REINFORCEMENT_EVIDENCE = Math.round(num(process.env.COSMOS_PATTERN_MIN_REINFORCEMENT_EVIDENCE, 2, 2, 50));
const MIN_REL_STRENGTH = num(process.env.COSMOS_PATTERN_MIN_REL_STRENGTH, 65, 0, 100);
const MIN_REL_CONFIDENCE = num(process.env.COSMOS_PATTERN_MIN_REL_CONFIDENCE, 0.65, 0, 1);
const PERSISTENCE_MIN_HISTORY_DAYS = Math.round(num(process.env.COSMOS_PATTERN_PERSISTENCE_MIN_DAYS, 3, 2, 30));
const CROSS_DOMAIN_MAX_RESULTS = Math.round(num(process.env.COSMOS_PATTERN_CROSS_DOMAIN_MAX_RESULTS, 30, 5, 100));
const CROSS_DOMAIN_MIN_DEVELOPMENTS = Math.round(num(process.env.COSMOS_PATTERN_CROSS_DOMAIN_MIN_DEVELOPMENTS, 3, 2, 50));
const CROSS_DOMAIN_MIN_TYPES = Math.round(num(process.env.COSMOS_PATTERN_CROSS_DOMAIN_MIN_TYPES, 4, 3, 20));
const CROSS_DOMAIN_MIN_STRONG_RELATIONSHIPS = Math.round(num(process.env.COSMOS_PATTERN_CROSS_DOMAIN_MIN_STRONG_RELATIONSHIPS, 1, 0, 20));
const CROSS_DOMAIN_MAX_SCORE = num(process.env.COSMOS_PATTERN_CROSS_DOMAIN_MAX_SCORE, 96, 70, 99);
const GENERIC_FOCUS_NAMES = new Set([
  'market','policy','renewables','supply chains','utilities','investors',
  'governments','regulators','manufacturing','logistics'
]);

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing required file: ${path.relative(ROOT, file)}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function clean(v) { return String(v ?? '').trim(); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}
function stableId(prefix, parts) {
  const hash = crypto.createHash('sha256').update(parts.map(x => String(x ?? '')).join('::')).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}
function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }
function entityId(x) { return x?.entity_id || x?.id || null; }
function developmentId(x) { return x?.development_id || x?.id || null; }

function stateLookup(state) {
  const map = new Map();
  for (const [id, e] of Object.entries(state?.entities || {})) {
    map.set(id, {
      entity_id: id,
      name: e?.name || id,
      slug: e?.slug || null,
      type: e?.type || null,
      lifecycle_status: e?.lifecycle_status || e?.status || null,
      importance_score: Number.isFinite(Number(e?.importance_score)) ? Number(e.importance_score) : null,
      relationship_degree: num(e?.relationship_degree, 0),
      linked_development_count: num(e?.linked_development_count, 0),
      last_seen_at: e?.last_seen_at || null
    });
  }
  return map;
}
function compactEntity(id, lookup) {
  const e = lookup.get(id);
  return e ? {
    entity_id: e.entity_id, name: e.name, type: e.type,
    lifecycle_status: e.lifecycle_status, importance_score: e.importance_score
  } : { entity_id: id, name: id, type: null, lifecycle_status: null, importance_score: null };
}
function developmentEntityIds(dev) {
  return unique([...(dev?.entities || []).map(entityId), ...(dev?.entity_ids || [])]);
}
function buildDevelopmentIndex(developments) {
  const byId = new Map();
  for (const dev of developments) {
    const id = developmentId(dev);
    if (id) byId.set(id, dev);
  }
  return { byId };
}
function evidenceQualityForDevelopment(dev) {
  const mode = clean(dev?.evidence?.mode || dev?.evidence_mode).toLowerCase();
  const status = clean(dev?.evidence?.status).toLowerCase();
  const sourceCount = num(dev?.evidence?.source_count, (dev?.evidence?.source_ids || []).length, 0, 10000);
  let score = 0.35;
  if (sourceCount > 0) score += Math.min(0.25, sourceCount * 0.05);
  if (status === 'verified' || status === 'validated') score += 0.25;
  if (mode && mode !== 'ai_scenario') score += 0.10;
  if (mode === 'ai_scenario' && sourceCount === 0) score = Math.min(score, 0.35);
  return clamp01(score);
}
function evidenceSummary(developmentIds, devIndex) {
  const ids = unique(developmentIds);
  const rows = ids.map(id => devIndex.byId.get(id)).filter(Boolean);
  const qualities = rows.map(evidenceQualityForDevelopment);
  const modes = unique(rows.map(d => d?.evidence?.mode || d?.evidence_mode || 'unknown'));
  const statuses = unique(rows.map(d => d?.evidence?.status || 'unknown'));
  const sourceCount = rows.reduce((s, d) => s + num(d?.evidence?.source_count, (d?.evidence?.source_ids || []).length, 0, 10000), 0);
  const score = qualities.length ? qualities.reduce((a,b) => a+b, 0) / qualities.length : 0;
  return {
    development_ids: ids,
    development_count: ids.length,
    evidence_modes: modes,
    evidence_statuses: statuses,
    source_count: sourceCount,
    evidence_quality_score: round(score * 100, 1),
    evidence_quality_label: score >= 0.75 ? 'strong' : score >= 0.50 ? 'moderate' : score > 0 ? 'weak' : 'unknown'
  };
}

function identityKey(entity) {
  const name = clean(entity?.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b(farms|farm|systems|system|projects|project|facilities|facility)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  return `${clean(entity?.type).toLowerCase()}::${name}`;
}
function identityChurnPairs(delta) {
  const added = delta?.added_entities || [];
  const removed = delta?.removed_entities || [];
  const removedByKey = new Map(removed.map(e => [identityKey(e), e]));
  const pairs = [];
  for (const a of added) {
    const r = removedByKey.get(identityKey(a));
    if (r) pairs.push({ added_entity_id: entityId(a), removed_entity_id: entityId(r), identity_key: identityKey(a) });
  }
  return pairs;
}

function meaningfulDeltaSignals(row) {
  const c = row?.changes || {};
  const out = [];
  if (c.lifecycle_status) out.push({ signal: 'lifecycle_transition', magnitude: 1, detail: c.lifecycle_status });
  if (c.relationship_degree) {
    const from = num(c.relationship_degree.from, 0), to = num(c.relationship_degree.to, 0), delta = to - from;
    if (delta !== 0) out.push({ signal: 'relationship_degree_change', magnitude: Math.min(1, Math.abs(delta) / Math.max(3, Math.abs(from) * 0.20 || 3)), delta, detail: c.relationship_degree });
  }
  if (c.linked_development_count) {
    const from = num(c.linked_development_count.from, 0), to = num(c.linked_development_count.to, 0), delta = to - from;
    if (delta !== 0) out.push({ signal: 'linked_development_count_change', magnitude: Math.min(1, Math.abs(delta) / Math.max(2, Math.abs(from) * 0.20 || 2)), delta, detail: c.linked_development_count });
  }
  if (c.importance_score) {
    const from = num(c.importance_score.from, 0), to = num(c.importance_score.to, 0), delta = to - from;
    if (Math.abs(delta) >= 1.5) out.push({ signal: 'material_importance_change', magnitude: Math.min(1, Math.abs(delta) / 10), delta, detail: c.importance_score });
  }
  return out;
}

function makePattern(args) {
  const {family, focusEntityId, title, description, score, structuralScore, evidenceIds,
    supportingEntityIds, impactIds, relationshipIds, signalDetails, lookup, devIndex, metadata = {}} = args;
  const evidence = evidenceSummary(evidenceIds, devIndex);
  const supportIds = unique(supportingEntityIds);
  return {
    pattern_id: stableId('pat', [family, focusEntityId || 'none', ...supportIds.slice().sort(), ...evidence.development_ids.slice().sort()]),
    pattern_family: family,
    focus_entity: focusEntityId ? compactEntity(focusEntityId, lookup) : null,
    title, description,
    pattern_score: round(score, 2),
    structural_strength_score: round(structuralScore, 2),
    evidence_quality_score: evidence.evidence_quality_score,
    evidence_quality_label: evidence.evidence_quality_label,
    confidence_class: score >= 82 && evidence.evidence_quality_score >= 50 ? 'high' : score >= 65 && evidence.evidence_quality_score >= 35 ? 'medium' : 'low',
    supporting_entities: supportIds.map(id => compactEntity(id, lookup)),
    supporting_impact_ids: unique(impactIds),
    supporting_relationship_ids: unique(relationshipIds),
    signal_details: signalDetails || [],
    evidence,
    persistence: { status: 'insufficient_history', days_observed: 1, history_days_available: 0 },
    metadata
  };
}

function detectImpactConvergence(impact, lookup, devIndex) {
  const groups = new Map();
  for (const row of impact?.impacts || []) {
    const affectedId = row?.affected?.entity_id, originId = row?.origin?.entity_id;
    if (!affectedId || !originId || affectedId === originId) continue;
    const g = groups.get(affectedId) || { affectedId, origins: new Map(), evidenceIds: [], relationshipIds: [] };
    const old = g.origins.get(originId);
    if (!old || num(row?.impact_score, 0) > num(old?.impact_score, 0)) g.origins.set(originId, row);
    g.evidenceIds.push(...(row?.evidence_development_ids || []));
    for (const step of row?.path?.steps || []) {
      if (step?.relationship_id) g.relationshipIds.push(step.relationship_id);
      g.evidenceIds.push(...(step?.evidence_development_ids || []));
    }
    groups.set(affectedId, g);
  }
  const patterns = [];
  for (const g of groups.values()) {
    const rows = [...g.origins.values()];
    if (rows.length < MIN_CONVERGING_SEEDS) continue;
    const avgImpact = rows.reduce((s,x) => s + num(x?.impact_score,0),0) / rows.length;
    const directShare = rows.filter(x => x?.direct).length / rows.length;
    const independentEvidence = unique(g.evidenceIds).length;
    const structural = Math.min(100, 30 + Math.min(30,(rows.length-1)*12) + Math.min(25,avgImpact*0.25) + directShare*10 + Math.min(5,independentEvidence));
    if (structural < MIN_PATTERN_SCORE) continue;
    const focusName = lookup.get(g.affectedId)?.name || g.affectedId;
    patterns.push(makePattern({
      family:'impact_convergence', focusEntityId:g.affectedId,
      title:`Multiple independent impact paths converge on ${focusName}`,
      description:`${rows.length} distinct change seeds propagate toward the same affected entity. This is a structural convergence signal, not proof that the outcome will occur.`,
      score:structural, structuralScore:structural, evidenceIds:g.evidenceIds,
      supportingEntityIds:rows.map(x=>x.origin.entity_id), impactIds:rows.map(x=>x.impact_id), relationshipIds:g.relationshipIds,
      signalDetails:rows.map(x=>({ origin_entity_id:x.origin.entity_id, impact_id:x.impact_id, impact_score:x.impact_score, propagation_depth:x.propagation_depth, inference_class:x.inference_class, effect_polarity:x.effect_polarity })),
      lookup, devIndex,
      metadata:{ converging_seed_count:rows.length, average_impact_score:round(avgImpact,2), direct_path_share:round(directShare,3) }
    }));
  }
  return patterns;
}

function detectEvidenceReinforcement(relationships, lookup, devIndex) {
  const patterns = [];
  for (const rel of relationships) {
    if (clean(rel?.status || 'active').toLowerCase() !== 'active') continue;
    const strength=num(rel?.strength,0), confidence=num(rel?.confidence,0), evidenceIds=unique(rel?.evidence_development_ids||[]);
    const from=rel?.from_entity_id, to=rel?.to_entity_id;
    if (!from || !to || from===to || strength<MIN_REL_STRENGTH || confidence<MIN_REL_CONFIDENCE || evidenceIds.length<MIN_REINFORCEMENT_EVIDENCE) continue;
    const repeatedEvidence=Math.min(1,evidenceIds.length/8);
    const structural=strength*0.40 + confidence*100*0.30 + repeatedEvidence*100*0.30;
    if (structural < MIN_PATTERN_SCORE) continue;
    const fromName=lookup.get(from)?.name||from, toName=lookup.get(to)?.name||to;
    patterns.push(makePattern({
      family:'evidence_reinforcement', focusEntityId:to,
      title:`${fromName} → ${toName} relationship is repeatedly reinforced`,
      description:`${evidenceIds.length} distinct developments support the same resolved relationship. Repetition strengthens structural persistence, while evidence quality remains scored separately.`,
      score:structural, structuralScore:structural, evidenceIds, supportingEntityIds:[from,to], impactIds:[], relationshipIds:[rel.relationship_id],
      signalDetails:[{ relationship_type:rel.relationship_type, relationship_strength:strength, relationship_confidence:confidence, evidence_count:evidenceIds.length, first_seen_at:rel.first_seen_at||rel.valid_from||null, last_seen_at:rel.last_seen_at||null, version:rel.version||null }],
      lookup, devIndex,
      metadata:{ relationship_id:rel.relationship_id, relationship_type:rel.relationship_type, relationship_evidence_count:evidenceIds.length }
    }));
  }
  return patterns;
}

function detectStructuralAcceleration(delta, impact, lookup, devIndex, churnPairs) {
  const patterns=[];
  const churnIds=new Set(churnPairs.flatMap(x=>[x.added_entity_id,x.removed_entity_id]).filter(Boolean));
  const impactsByOrigin=new Map();
  for (const row of impact?.impacts||[]) {
    const id=row?.origin?.entity_id; if(!id) continue;
    const arr=impactsByOrigin.get(id)||[]; arr.push(row); impactsByOrigin.set(id,arr);
  }
  for (const row of delta?.changed_entities||[]) {
    const id=entityId(row); if(!id||churnIds.has(id)) continue;
    const signals=meaningfulDeltaSignals(row);
    const positive=signals.filter(s=>s.signal==='lifecycle_transition'||(typeof s.delta==='number'&&s.delta>0));
    if(!positive.length) continue;
    const signalStrength=positive.reduce((s,x)=>s+num(x.magnitude,0),0)/positive.length;
    const originImpacts=impactsByOrigin.get(id)||[];
    const impactSupport=Math.min(1,originImpacts.length/5);
    const structural=35+signalStrength*40+impactSupport*20+Math.min(5,positive.length);
    if(structural<MIN_PATTERN_SCORE) continue;
    const evidenceIds=unique(originImpacts.flatMap(x=>x?.evidence_development_ids||[]));
    const name=lookup.get(id)?.name||row?.name||id;
    patterns.push(makePattern({
      family:'structural_acceleration', focusEntityId:id,
      title:`${name} shows structural acceleration`,
      description:'Multiple non-trivial structural changes are occurring around the same entity. Timestamp-only changes and tiny importance drift are excluded from this detector.',
      score:structural, structuralScore:structural, evidenceIds, supportingEntityIds:[id], impactIds:originImpacts.map(x=>x.impact_id),
      relationshipIds:unique(originImpacts.flatMap(x=>(x?.path?.steps||[]).map(s=>s.relationship_id))), signalDetails:positive,
      lookup, devIndex,
      metadata:{ meaningful_signal_count:positive.length, propagated_impact_count:originImpacts.length }
    }));
  }
  return patterns;
}

function detectCrossDomainCoupling(developments, relationships, delta, impact, lookup, devIndex) {
  const groups=new Map();

  const meaningfulChangedIds=new Set();
  for(const row of delta?.changed_entities||[]){
    const id=entityId(row);
    if(id && meaningfulDeltaSignals(row).length) meaningfulChangedIds.add(id);
  }

  const impactsByOrigin=new Map();
  const impactsByAffected=new Map();
  for(const row of impact?.impacts||[]){
    const origin=row?.origin?.entity_id;
    const affected=row?.affected?.entity_id;
    if(origin){
      const arr=impactsByOrigin.get(origin)||[];
      arr.push(row);
      impactsByOrigin.set(origin,arr);
    }
    if(affected){
      const arr=impactsByAffected.get(affected)||[];
      arr.push(row);
      impactsByAffected.set(affected,arr);
    }
  }

  const strongRelationshipsByEntity=new Map();
  for(const rel of relationships||[]){
    if(clean(rel?.status||'active').toLowerCase()!=='active') continue;
    const strength=num(rel?.strength,0);
    const confidence=num(rel?.confidence,0);
    if(strength<MIN_REL_STRENGTH || confidence<MIN_REL_CONFIDENCE) continue;

    for(const id of [rel?.from_entity_id,rel?.to_entity_id]){
      if(!id) continue;
      const arr=strongRelationshipsByEntity.get(id)||[];
      arr.push(rel);
      strongRelationshipsByEntity.set(id,arr);
    }
  }

  for(const dev of developments){
    const ids=developmentEntityIds(dev);
    if(ids.length<2) continue;
    const types=unique(ids.map(id=>lookup.get(id)?.type).filter(Boolean));
    if(types.length<2) continue;

    for(const id of ids){
      const g=groups.get(id)||{
        focusId:id,
        developments:[],
        entityIds:new Set(),
        types:new Set(),
        countries:new Set(),
        categories:new Set()
      };

      g.developments.push(dev);
      for(const eid of ids){
        g.entityIds.add(eid);
        const t=lookup.get(eid)?.type;
        if(t) g.types.add(t);
      }
      for(const c of dev?.countries||[]) g.countries.add(c);
      if(dev?.category) g.categories.add(dev.category);
      groups.set(id,g);
    }
  }

  const patterns=[];

  for(const g of groups.values()){
    const devIds=unique(g.developments.map(developmentId));
    const devSet=new Set(devIds);
    const typeCount=g.types.size;
    const entityCount=g.entityIds.size;
    const categoryCount=g.categories.size;
    const countryCount=g.countries.size;
    const focus=lookup.get(g.focusId);
    const focusName=clean(focus?.name||g.focusId);
    const focusType=clean(focus?.type);

    if(devIds.length<CROSS_DOMAIN_MIN_DEVELOPMENTS || typeCount<CROSS_DOMAIN_MIN_TYPES) continue;

    const originImpacts=impactsByOrigin.get(g.focusId)||[];
    const affectedImpacts=impactsByAffected.get(g.focusId)||[];
    const distinctIncomingOrigins=new Set(
      affectedImpacts.map(x=>x?.origin?.entity_id).filter(Boolean)
    );

    const strongRelationships=(strongRelationshipsByEntity.get(g.focusId)||[])
      .filter(rel=>{
        const evidenceIds=unique(rel?.evidence_development_ids||[]);
        return !evidenceIds.length || evidenceIds.some(id=>devSet.has(id));
      });

    const hasMeaningfulDelta=meaningfulChangedIds.has(g.focusId);
    const hasImpactActivity=
      originImpacts.some(x=>num(x?.impact_score,0)>=40) ||
      affectedImpacts.some(x=>num(x?.impact_score,0)>=40);

    if(!hasMeaningfulDelta && !hasImpactActivity) continue;
    if(strongRelationships.length<CROSS_DOMAIN_MIN_STRONG_RELATIONSHIPS) continue;

    const broadFocus=
      focusType==='Country' ||
      focusType==='Market' ||
      GENERIC_FOCUS_NAMES.has(focusName.toLowerCase());

    if(broadFocus){
      if(devIds.length<5) continue;
      if(categoryCount<2) continue;
      if(strongRelationships.length<2) continue;
    }

    const dynamicScore=Math.min(
      18,
      (hasMeaningfulDelta?8:0) +
      Math.min(6,originImpacts.filter(x=>num(x?.impact_score,0)>=40).length*1.5) +
      Math.min(6,distinctIncomingOrigins.size*1.5)
    );

    const domainScore=Math.min(18,Math.max(0,(typeCount-CROSS_DOMAIN_MIN_TYPES+1))*3);
    const developmentScore=Math.min(18,Math.log2(devIds.length+1)*4.5);
    const relationshipScore=Math.min(18,Math.log2(strongRelationships.length+1)*5);
    const breadthScore=Math.min(8,categoryCount*2+Math.min(4,countryCount*0.5));
    const concentrationPenalty=Math.min(
      10,
      Math.max(0,entityCount-(devIds.length*8))*0.08
    );
    const broadPenalty=broadFocus?6:0;

    let structural=
      24 +
      domainScore +
      developmentScore +
      relationshipScore +
      dynamicScore +
      breadthScore -
      concentrationPenalty -
      broadPenalty;

    structural=Math.min(CROSS_DOMAIN_MAX_SCORE,Math.max(0,structural));
    if(structural<MIN_PATTERN_SCORE) continue;

    const relatedImpactIds=unique([
      ...originImpacts.map(x=>x?.impact_id),
      ...affectedImpacts.map(x=>x?.impact_id)
    ]);
    const relationshipIds=unique(strongRelationships.map(x=>x?.relationship_id));

    patterns.push(makePattern({
      family:'cross_domain_coupling',
      focusEntityId:g.focusId,
      title:`${focusName} shows qualified cross-domain coupling`,
      description:
        `${typeCount} entity types across ${devIds.length} developments are connected around the same focus entity, `+
        `with recent change/impact activity and ${strongRelationships.length} strong resolved relationship${strongRelationships.length===1?'':'s'}. `+
        `This is a qualified structural coupling signal, not causal certainty.`,
      score:structural,
      structuralScore:structural,
      evidenceIds:devIds,
      supportingEntityIds:[...g.entityIds],
      impactIds:relatedImpactIds,
      relationshipIds,
      signalDetails:[{
        entity_type_count:typeCount,
        entity_types:[...g.types].sort(),
        development_count:devIds.length,
        category_count:categoryCount,
        categories:[...g.categories].sort(),
        country_count:countryCount,
        countries:[...g.countries].sort(),
        strong_relationship_count:strongRelationships.length,
        meaningful_delta_support:hasMeaningfulDelta,
        origin_impact_count:originImpacts.length,
        affected_impact_count:affectedImpacts.length,
        distinct_incoming_origin_count:distinctIncomingOrigins.size,
        broad_focus_penalty_applied:broadFocus
      }],
      lookup,
      devIndex,
      metadata:{
        entity_type_count:typeCount,
        supporting_entity_count:entityCount,
        development_count:devIds.length,
        category_count:categoryCount,
        country_count:countryCount,
        strong_relationship_count:strongRelationships.length,
        dynamic_support_score:round(dynamicScore,2),
        broad_focus_penalty_applied:broadFocus
      }
    }));
  }

  return patterns
    .sort((a,b)=>b.pattern_score-a.pattern_score||a.pattern_id.localeCompare(b.pattern_id))
    .slice(0,CROSS_DOMAIN_MAX_RESULTS);
}

function loadPatternHistory(currentDateUtc){
  if(!fs.existsSync(HISTORY_DIR)) return [];
  const names=fs.readdirSync(HISTORY_DIR).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const rows=[];
  for(const name of names){
    if(name.slice(0,10)===currentDateUtc) continue;
    try{ rows.push(JSON.parse(fs.readFileSync(path.join(HISTORY_DIR,name),'utf8'))); }catch(_){ }
  }
  return rows;
}
function applyPersistence(patterns,history){
  if(history.length<PERSISTENCE_MIN_HISTORY_DAYS-1){
    for(const p of patterns) p.persistence={status:'insufficient_history',days_observed:1,history_days_available:history.length};
    return;
  }
  const priorById=new Map();
  for(const payload of history){
    for(const p of payload?.patterns||[]){ const arr=priorById.get(p.pattern_id)||[]; arr.push(payload.date_utc||null); priorById.set(p.pattern_id,arr); }
  }
  for(const p of patterns){
    const priorDates=unique(priorById.get(p.pattern_id)||[]), daysObserved=priorDates.length+1;
    p.persistence={status:daysObserved>=7?'persistent':daysObserved>=3?'recurring':'new',days_observed:daysObserved,history_days_available:history.length,prior_dates:priorDates};
    if(daysObserved>=3) p.pattern_score=round(Math.min(98,p.pattern_score+Math.min(8,(daysObserved-2)*1.5)),2);
  }
}
function dedupePatterns(patterns){
  const best=new Map();
  for(const p of patterns){
    const key=`${p.pattern_family}::${p.focus_entity?.entity_id||'none'}::${(p.supporting_relationship_ids||[]).slice().sort().join(',')}`;
    const old=best.get(key);
    if(!old||p.pattern_score>old.pattern_score) best.set(key,p);
  }

  const rows=[...best.values()]
    .filter(p=>p.pattern_score>=MIN_PATTERN_SCORE)
    .sort((a,b)=>
      b.pattern_score-a.pattern_score ||
      b.structural_strength_score-a.structural_strength_score ||
      a.pattern_id.localeCompare(b.pattern_id)
    );

  const familyCaps={
    impact_convergence:25,
    evidence_reinforcement:25,
    structural_acceleration:25,
    cross_domain_coupling:CROSS_DOMAIN_MAX_RESULTS
  };

  const selected=[];
  const usedByFamily=new Map();

  for(const p of rows){
    const cap=familyCaps[p.pattern_family]??MAX_PATTERNS;
    const used=usedByFamily.get(p.pattern_family)||0;
    if(used>=cap) continue;
    selected.push(p);
    usedByFamily.set(p.pattern_family,used+1);
    if(selected.length>=MAX_PATTERNS) break;
  }

  return selected;
}

function countBy(items,getter){
  const map=new Map(); for(const item of items){const key=String(getter(item)??'unknown');map.set(key,(map.get(key)||0)+1);} return Object.fromEntries([...map.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
}

function main(){
  const state=readJson(FILES.state), delta=readJson(FILES.delta), impact=readJson(FILES.impact);
  const developmentsPayload=readJson(FILES.developments), relationshipsPayload=readJson(FILES.relationships);
  const developments=Array.isArray(developmentsPayload?.developments)?developmentsPayload.developments:[];
  const relationships=Array.isArray(relationshipsPayload?.relationships)?relationshipsPayload.relationships:[];
  const lookup=stateLookup(state), devIndex=buildDevelopmentIndex(developments), churnPairs=identityChurnPairs(delta);
  const detected=[
    ...detectImpactConvergence(impact,lookup,devIndex),
    ...detectEvidenceReinforcement(relationships,lookup,devIndex),
    ...detectStructuralAcceleration(delta,impact,lookup,devIndex,churnPairs),
    ...detectCrossDomainCoupling(developments,relationships,delta,impact,lookup,devIndex)
  ];
  let patterns=dedupePatterns(detected);
  const generatedAt=new Date().toISOString();
  const dateUtc=clean(impact?.date_utc)||clean(delta?.date_utc)||clean(state?.date_utc)||generatedAt.slice(0,10);
  const history=loadPatternHistory(dateUtc); applyPersistence(patterns,history);
  patterns=patterns.sort((a,b)=>b.pattern_score-a.pattern_score).slice(0,MAX_PATTERNS);
  const output={
    schema_version:'0.2', generated_at:generatedAt, date_utc:dateUtc,
    status:patterns.length?'ready':'no_patterns_above_threshold',
    source:{state_schema_version:state?.schema_version||null,delta_schema_version:delta?.schema_version||null,impact_schema_version:impact?.schema_version||null,developments_schema_version:developmentsPayload?.schema_version||null,relationships_schema_version:relationshipsPayload?.schema_version||null,state_generated_at:state?.generated_at||null,delta_generated_at:delta?.generated_at||null,impact_generated_at:impact?.generated_at||null,developments_generated_at:developmentsPayload?.generated_at||null,relationships_generated_at:relationshipsPayload?.generated_at||null},
    methodology:{
      summary:'Deterministic pattern detection above Cosmos State, Delta and Impact. v0.2 calibrates cross-domain coupling so broad/static hubs cannot qualify on co-occurrence alone. Patterns are structural signals, not forecasts or verified real-world conclusions.',
      reasoning_mode:'deterministic_pattern_detection', minimum_pattern_score:MIN_PATTERN_SCORE, maximum_results:MAX_PATTERNS,
      minimum_converging_seeds:MIN_CONVERGING_SEEDS, minimum_reinforcement_evidence:MIN_REINFORCEMENT_EVIDENCE,
      minimum_relationship_strength:MIN_REL_STRENGTH, minimum_relationship_confidence:MIN_REL_CONFIDENCE,cross_domain_calibration:{minimum_developments:CROSS_DOMAIN_MIN_DEVELOPMENTS,minimum_entity_types:CROSS_DOMAIN_MIN_TYPES,minimum_strong_relationships:CROSS_DOMAIN_MIN_STRONG_RELATIONSHIPS,max_results:CROSS_DOMAIN_MAX_RESULTS,max_score:CROSS_DOMAIN_MAX_SCORE,dynamic_gate:'meaningful delta OR material impact activity',broad_focus_rule:'Countries, Markets, and generic hubs require >=5 developments, >=2 categories, and >=2 strong relationships'}, 
      pattern_families:['impact_convergence','evidence_reinforcement','structural_acceleration','cross_domain_coupling'],
      evidence_rule:'Structural strength and evidence quality are scored separately. AI-scenario evidence is preserved as scenario evidence and is never promoted to verified fact.',
      temporal_rule:'Timestamp-only changes and tiny importance drift do not create structural acceleration. Persistence is reported only after sufficient pattern-history coverage.',
      identity_rule:'Probable remove/add identity churn is suppressed from structural-acceleration detection.'
    },
    diagnostics:{state_entity_count:Object.keys(state?.entities||{}).length,delta_changed_entity_count:(delta?.changed_entities||[]).length,impact_count:(impact?.impacts||[]).length,development_count:developments.length,relationship_count:relationships.length,identity_churn_pair_count:churnPairs.length,identity_churn_pairs:churnPairs,history_days_available:history.length,raw_patterns_detected:detected.length,patterns_retained:patterns.length},
    summary:{pattern_count:patterns.length,by_family:countBy(patterns,x=>x.pattern_family),by_confidence_class:countBy(patterns,x=>x.confidence_class),by_evidence_quality:countBy(patterns,x=>x.evidence_quality_label),by_persistence:countBy(patterns,x=>x.persistence?.status)},
    patterns
  };
  writeJson(FILES.output,output); writeJson(path.join(HISTORY_DIR,`${dateUtc}.json`),output);
  console.log('\n=== PTD Today / Cosmos Pattern Engine ===');
  console.log(`Date:                    ${dateUtc}`);
  console.log(`Patterns retained:       ${patterns.length}`);
  console.log(`Impact convergence:      ${output.summary.by_family.impact_convergence||0}`);
  console.log(`Evidence reinforcement:  ${output.summary.by_family.evidence_reinforcement||0}`);
  console.log(`Structural acceleration: ${output.summary.by_family.structural_acceleration||0}`);
  console.log(`Cross-domain coupling:   ${output.summary.by_family.cross_domain_coupling||0}`);
  console.log(`Identity churn pairs:    ${churnPairs.length}`);
  console.log(`Status:                  ${output.status}`);
  console.log(`Output:                  ${path.relative(ROOT,FILES.output)}`);
}

try{ main(); }catch(error){ console.error('\nCosmos Pattern Engine failed:'); console.error(error?.stack||error?.message||error); process.exit(1); }
