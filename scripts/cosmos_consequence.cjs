#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Consequence Engine v0.1
 *
 * Core question: "What could this lead to?"
 *
 * Deterministic only:
 * - no OpenAI/API calls
 * - no invented causality
 * - no evidence upgrades
 * - no numeric forecasts
 * - no assumption of unidentified materials/minerals
 *
 * Butterfly distance is metadata, not a conceptual stopping rule.
 */

const fs = require("fs");
const path = require("path");

const CONSEQUENCE_TYPES = new Set([
  "AFFECTS","IMPACTS","DRIVES","REQUIRES","DEPENDS_ON","CONSTRAINS",
  "ENABLES","CAUSES","INCREASES","DECREASES","SUPPLIES","SUPPORTS",
  "AMPLIFIES","REDUCES","COMPETES_WITH","SUBSTITUTES_FOR"
]);

const DESCRIPTIVE_TYPES = new Set([
  "LOCATED_IN","PART_OF","MEMBER_OF","ASSOCIATED_WITH","RELATED_TO"
]);

const DEFAULTS = {
  max_runtime_distance: 5,
  frontier_width: 8,
  pathway_limit: 20,
  alternative_limit: 10,
  gap_limit: 20
};

function clean(v){ return String(v ?? "").trim(); }
function n(v,f=0){ const x=Number(v); return Number.isFinite(x)?x:f; }
function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function uniq(a){ return [...new Set((a||[]).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }

function stableId(prefix, values){
  const src=(Array.isArray(values)?values:[values]).join("|");
  let h=2166136261;
  for(let i=0;i<src.length;i++){ h^=src.charCodeAt(i); h=Math.imul(h,16777619); }
  return `${prefix}_${(h>>>0).toString(16).padStart(8,"0")}`;
}

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function writeJson(file,payload){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(payload,null,2),"utf8");
}

function humanName(id,name){
  const v=clean(name);
  if(!v || v===id || /^ent_[a-z0-9]+$/i.test(v)) return null;
  return v;
}

function evidenceScore(x){ return clamp(n(x?.evidence_quality_score),0,100); }

function confidence100(x){
  const raw=x?.confidence;
  if(raw!=null && Number(raw)<=1) return clamp(Number(raw)*100,0,100);
  return clamp(n(raw ?? x?.confidence_score ?? x?.structural_strength_score ??
    x?.traversal_score ?? x?.impact_score ?? x?._attention?.score),0,100);
}

function relationshipType(rel){
  return clean(rel?.relationship_type ?? rel?.relationship?.type).toUpperCase();
}

function relationshipScore(rel){
  const type=relationshipType(rel);
  let semantic=0;
  if(CONSEQUENCE_TYPES.has(type)) semantic+=18;
  if(DESCRIPTIVE_TYPES.has(type)) semantic-=18;

  return clamp(
    n(rel?.strength ?? rel?.relationship?.strength)*0.32 +
    confidence100(rel)*0.24 +
    n(rel?._attention?.score)*0.22 +
    evidenceScore(rel)*0.12 +
    5 + semantic,
    0,100
  );
}

function horizon(distance){
  if(distance<=1) return "immediate_or_short";
  if(distance===2) return "short_to_mid";
  if(distance===3) return "mid";
  if(distance===4) return "mid_to_long";
  return "long_to_far";
}

function normalizeInput(raw){
  if(!raw || typeof raw!=="object")
    throw new Error("Cosmos Consequence requires a Cosmos Attention JSON payload.");

  const active=raw.active_context||{};
  if(!Array.isArray(active.attention_center) || !active.attention_center.length)
    throw new Error("active_context.attention_center[] is required.");

  return {
    source:raw,
    input:raw.input||{},
    attention_center:active.attention_center,
    active_context:active,
    expandable_context:raw.expandable_context||{}
  };
}

function buildWorldIndex(ctx){
  const entities=new Map();
  const relationships=[];

  function put(e){
    if(!e?.entity_id) return;
    const prev=entities.get(e.entity_id)||{};
    entities.set(e.entity_id,{
      entity_id:e.entity_id,
      name:humanName(e.entity_id,e.name)||prev.name||null,
      type:e.type||prev.type||null
    });
  }

  for(const e of ctx.attention_center) put(e);
  for(const e of ctx.active_context.entities||[]) put(e);

  for(const p of ctx.active_context.primary_pathways||[]){
    put(p.from); put(p.to);
    relationships.push({
      relationship_id:p.relationship?.relationship_id,
      from_entity_id:p.from?.entity_id,
      to_entity_id:p.to?.entity_id,
      relationship_type:p.relationship?.type,
      label:p.relationship?.label,
      strength:p.relationship?.strength,
      confidence:p.relationship?.confidence,
      evidence_development_ids:p.evidence_development_ids||[],
      source_surface:"primary_pathway",
      _attention:{score:p.score}
    });
  }

  for(const rel of ctx.active_context.relationships||[])
    relationships.push({...rel,source_surface:rel.source_surface||"active_relationship"});

  for(const rel of ctx.expandable_context.next_relationships||[])
    relationships.push({...rel,source_surface:rel.source_surface||"expandable_relationship"});

  for(const p of ctx.active_context.patterns||[]){
    if(p.focus_entity) put(p.focus_entity);
    for(const e of p.supporting_entities||[]) put(e);
  }
  for(const e of ctx.active_context.emergences||[]){
    for(const x of e.focus_entities||[]) put(x);
    for(const x of e.shared_entities||[]) put(x);
  }

  const byEntity=new Map();
  for(const rel of relationships){
    for(const id of [rel.from_entity_id,rel.to_entity_id]){
      if(!id) continue;
      const rows=byEntity.get(id)||[];
      rows.push(rel); byEntity.set(id,rows);
    }
  }

  return {entities,relationships,byEntity};
}

function deriveOrigin(ctx){
  return {
    event_id:stableId("event",[ctx.input?.text||"",...ctx.attention_center.map(x=>x.entity_id)]),
    statement:clean(ctx.input?.text) ||
      `Attention centered on ${ctx.attention_center.map(x=>x.name).filter(Boolean).join(" + ")}`,
    entity_ids:ctx.attention_center.map(x=>x.entity_id).filter(Boolean),
    entity_names:ctx.attention_center.map(x=>x.name).filter(Boolean),
    butterfly_distance:0,
    claim_status:"origin_context",
    note:"The origin is the interaction starting point, not automatically a verified real-world event."
  };
}

function otherEnd(rel,id){
  if(rel.from_entity_id===id) return rel.to_entity_id;
  if(rel.to_entity_id===id) return rel.from_entity_id;
  return null;
}

function direction(rel,id){
  if(rel.from_entity_id===id) return "forward";
  if(rel.to_entity_id===id) return "reverse_context";
  return "unknown";
}

function propagate(ctx,world,options={}){
  const maxDistance=clamp(n(options.max_runtime_distance,DEFAULTS.max_runtime_distance),1,12);
  const width=clamp(n(options.frontier_width,DEFAULTS.frontier_width),1,50);
  const limit=clamp(n(options.pathway_limit,DEFAULTS.pathway_limit),1,200);

  let frontier=ctx.attention_center.map(x=>({
    entity_id:x.entity_id,
    butterfly_distance:0,
    cumulative_score:100,
    lineage_relationship_ids:[],
    lineage_entity_ids:[x.entity_id]
  }));

  const best=new Map(frontier.map(x=>[x.entity_id,100]));
  const consequences=[];
  const snapshots=[];

  for(let d=1;d<=maxDistance;d++){
    const next=[];

    for(const current of frontier){
      const rels=[...(world.byEntity.get(current.entity_id)||[])]
        .map(rel=>({rel,score:relationshipScore(rel)}))
        .sort((a,b)=>b.score-a.score)
        .slice(0,width);

      for(const {rel,score} of rels){
        const target=otherEnd(rel,current.entity_id);
        if(!target) continue;

        const dir=direction(rel,current.entity_id);
        const directional=dir==="forward"?1:0.62;
        const distanceFactor=Math.pow(0.82,d-1);
        const cumulative=clamp(
          current.cumulative_score*0.5 + score*0.5*directional*distanceFactor,
          0,100
        );

        const e=world.entities.get(target)||{entity_id:target,name:null,type:null};

        const row={
          consequence_id:stableId("consequence",[current.entity_id,rel.relationship_id,target,d]),
          from_entity_id:current.entity_id,
          to_entity_id:target,
          to_entity_name:e.name,
          to_entity_type:e.type,
          relationship_id:rel.relationship_id,
          relationship_type:rel.relationship_type,
          relationship_label:rel.label,
          propagation_direction:dir,
          butterfly_distance:d,
          horizon:horizon(d),
          consequence_score:Math.round(cumulative*100)/100,
          relationship_score:Math.round(score*100)/100,
          claim_class:CONSEQUENCE_TYPES.has(relationshipType(rel))
            ?"graph_supported_consequence":"contextual_relationship",
          evidence_quality_score:evidenceScore(rel),
          confidence:rel.confidence??null,
          evidence_development_ids:rel.evidence_development_ids||[],
          lineage_relationship_ids:[...current.lineage_relationship_ids,rel.relationship_id].filter(Boolean),
          lineage_entity_ids:[...current.lineage_entity_ids,target],
          source_surface:rel.source_surface||null,
          continuation_possible:true
        };
        consequences.push(row);

        if(!CONSEQUENCE_TYPES.has(relationshipType(rel))) continue;

        const prev=best.get(target);
        if(prev!=null && prev>=cumulative) continue;
        best.set(target,cumulative);

        next.push({
          entity_id:target,
          butterfly_distance:d,
          cumulative_score:cumulative,
          lineage_relationship_ids:row.lineage_relationship_ids,
          lineage_entity_ids:row.lineage_entity_ids
        });
      }
    }

    next.sort((a,b)=>b.cumulative_score-a.cumulative_score);
    frontier=next.slice(0,width);
    snapshots.push({
      butterfly_distance:d,
      frontier_entity_ids:frontier.map(x=>x.entity_id),
      frontier_count:frontier.length
    });
    if(!frontier.length) break;
  }

  const dedup=new Map();
  for(const row of consequences){
    const key=`${row.from_entity_id}|${row.relationship_id}|${row.to_entity_id}|${row.butterfly_distance}`;
    const prev=dedup.get(key);
    if(!prev || row.consequence_score>prev.consequence_score) dedup.set(key,row);
  }

  return {
    runtime_distance_used:maxDistance,
    consequences:[...dedup.values()]
      .sort((a,b)=>a.butterfly_distance-b.butterfly_distance || b.consequence_score-a.consequence_score)
      .slice(0,limit),
    frontier_snapshots:snapshots,
    remaining_frontier_entity_ids:frontier.map(x=>x.entity_id)
  };
}

function identifyActors(propagation,world){
  const actorTypes=new Set([
    "Organization","Company","Person","Government","Regulator","Institution",
    "Project","Infrastructure","Country","Region","Community"
  ]);

  const best=new Map();
  for(const c of propagation.consequences){
    const e=world.entities.get(c.to_entity_id);
    if(!e || !actorTypes.has(clean(e.type))) continue;

    const row={
      entity_id:e.entity_id,name:e.name,type:e.type,
      first_butterfly_distance:c.butterfly_distance,
      relevance_score:c.consequence_score,
      reached_via_relationship_id:c.relationship_id
    };

    const prev=best.get(row.entity_id);
    if(!prev || row.first_butterfly_distance<prev.first_butterfly_distance ||
       row.relevance_score>prev.relevance_score) best.set(row.entity_id,row);
  }
  return [...best.values()].sort((a,b)=>
    a.first_butterfly_distance-b.first_butterfly_distance ||
    b.relevance_score-a.relevance_score
  );
}

function identifyAlternatives(propagation,world){
  const reached=new Set(propagation.consequences.map(x=>x.to_entity_id));
  return world.relationships
    .filter(rel=>{
      const t=relationshipType(rel);
      return ["SUBSTITUTES_FOR","COMPETES_WITH","SUPPLIES","SUPPORTS"].includes(t) &&
        (reached.has(rel.from_entity_id)||reached.has(rel.to_entity_id));
    })
    .map(rel=>{
      const from=world.entities.get(rel.from_entity_id);
      const to=world.entities.get(rel.to_entity_id);
      return {
        alternative_id:stableId("alternative",[rel.relationship_id,rel.from_entity_id,rel.to_entity_id]),
        relationship_id:rel.relationship_id,
        relationship_type:rel.relationship_type,
        from:{entity_id:rel.from_entity_id,name:from?.name||null,type:from?.type||null},
        to:{entity_id:rel.to_entity_id,name:to?.name||null,type:to?.type||null},
        evidence_quality_score:evidenceScore(rel),
        confidence:rel.confidence??null,
        evidence_development_ids:rel.evidence_development_ids||[],
        qualification_status:"requires_validation",
        note:"This does not prove available capacity, qualification, cost, timing, or practical substitutability."
      };
    })
    .slice(0,DEFAULTS.alternative_limit);
}

function identifyGaps(ctx,propagation,alternatives,world){
  const gaps=[];
  function add(type,statement,priority,entity_ids=[]){
    gaps.push({
      gap_id:stableId("gap",[type,statement,...entity_ids]),
      gap_type:type,statement,priority,entity_ids:uniq(entity_ids),resolution_status:"open"
    });
  }

  for(const c of propagation.consequences){
    if(!humanName(c.to_entity_id,c.to_entity_name))
      add("unresolved_entity",
        `Entity ${c.to_entity_id} is reached but is not human-resolved.`,
        "high",[c.to_entity_id]);

    if(c.evidence_quality_score<50)
      add("weak_evidence",
        `Consequence pathway ${c.consequence_id} has weak evidence and needs stronger source support.`,
        "medium",[c.from_entity_id,c.to_entity_id]);

    if(c.propagation_direction!=="forward")
      add("directionality",
        `Relationship ${c.relationship_id} was traversed in reverse context and must not be treated as forward causality without validation.`,
        "high",[c.from_entity_id,c.to_entity_id]);
  }

  if(!alternatives.length)
    add("alternatives_unknown",
      "No validated substitute/alternative pathway is available in the current attended context.",
      "high",ctx.attention_center.map(x=>x.entity_id));

  const q=clean(ctx.input?.text).toLowerCase();
  if(/\bmineral|material|processing|refining\b/.test(q) &&
     ![...world.entities.values()].some(e=>
       /copper|aluminum|lithium|nickel|cobalt|graphite|steel|silicon|rare earth/i.test(clean(e.name))))
    add("material_identity",
      "The exact constrained material/mineral is not identified in the current attended evidence.",
      "critical",ctx.attention_center.map(x=>x.entity_id));

  const rank={critical:4,high:3,medium:2,low:1};
  return gaps.sort((a,b)=>rank[b.priority]-rank[a.priority]).slice(0,DEFAULTS.gap_limit);
}

function horizonMap(propagation){
  const out={
    immediate_or_short:[],short_to_mid:[],mid:[],mid_to_long:[],long_to_far:[]
  };
  for(const c of propagation.consequences) out[c.horizon].push(c.consequence_id);
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[
    k,{consequence_count:v.length,consequence_ids:v}
  ]));
}

function runCosmosConsequence(raw,options={}){
  const ctx=normalizeInput(raw);
  const world=buildWorldIndex(ctx);
  const origin=deriveOrigin(ctx);
  const propagation=propagate(ctx,world,options);
  const alternatives=identifyAlternatives(propagation,world);
  const gaps=identifyGaps(ctx,propagation,alternatives,world);

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"consequence_frontier_resolved",

    source_attention:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    input:ctx.input,
    origin_event:origin,

    consequence_field:{
      discovered_consequence_count:propagation.consequences.length,
      consequences:propagation.consequences,
      frontier_snapshots:propagation.frontier_snapshots,
      remaining_frontier_entity_ids:propagation.remaining_frontier_entity_ids
    },

    affected_actors:identifyActors(propagation,world),

    alternatives:{
      discovered_count:alternatives.length,
      items:alternatives
    },

    knowledge_gaps:{
      count:gaps.length,
      items:gaps
    },

    horizon_map:horizonMap(propagation),

    evidence_lineage:{
      development_ids:uniq(propagation.consequences.flatMap(x=>x.evidence_development_ids||[])),
      relationship_ids:uniq(propagation.consequences.map(x=>x.relationship_id)),
      source_lineage_preserved:true
    },

    butterfly_state:{
      origin_distance:0,
      maximum_runtime_distance_evaluated:propagation.runtime_distance_used,
      runtime_distance_is_computational_budget_only:true,
      conceptual_distance_limit:null,
      continuation_possible:true,
      frontier_is_terminal:false,
      consequence_can_become_new_origin:true,
      convergence_allowed:true,
      divergence_allowed:true,
      feedback_loops_allowed:true,
      note:"Butterfly distance is metadata, not a philosophical stopping rule."
    },

    safeguards:{
      creates_new_causal_claims:false,
      upgrades_evidence_quality:false,
      numeric_forecast_generated:false,
      unidentified_material_is_not_assumed:true,
      reverse_relationships_are_not_treated_as_forward_causality:true,
      alternatives_require_validation:true,
      runtime_budget_is_not_conceptual_limit:true,
      source_lineage_preserved:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),o={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--input"&&args[i+1]) o.input_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) o.output_file=args[++i];
    else if(args[i]==="--max-runtime-distance"&&args[i+1]) o.max_runtime_distance=Number(args[++i]);
    else if(args[i]==="--frontier-width"&&args[i+1]) o.frontier_width=Number(args[++i]);
    else if(args[i]==="--pathway-limit"&&args[i+1]) o.pathway_limit=Number(args[++i]);
  }
  return o;
}

function main(){
  const o=parseArgs(process.argv);
  if(!o.input_file) throw new Error(
    "Usage: node scripts/cosmos_consequence.cjs --input <attention.json> [--out <consequence.json>]"
  );
  const output=runCosmosConsequence(readJson(o.input_file),o);
  if(o.output_file){
    writeJson(o.output_file,output);
    console.log(`Cosmos Consequence output written to ${o.output_file}`);
  } else {
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runCosmosConsequence,
  buildWorldIndex,
  propagate,
  identifyGaps
};
