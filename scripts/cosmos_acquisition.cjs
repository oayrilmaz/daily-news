#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Acquisition Engine v0.1
 *
 * Core question:
 *   "How should Cosmos investigate what Discovery says it needs to learn?"
 *
 * v0.1 is deterministic acquisition planning.
 * It DOES NOT search the web yet.
 *
 * Discovery says WHAT Cosmos needs.
 * Acquisition decides HOW to investigate it:
 *
 * Discovery target
 *   -> acquisition plan
 *   -> source strategy
 *   -> query intent
 *   -> evidence contract
 *   -> validation gate
 *   -> future executor
 *
 * Safeguards:
 * - no OpenAI/API calls
 * - no external search/network execution
 * - no evidence invention
 * - no automatic knowledge insertion
 * - no evidence-quality upgrading
 * - no entity auto-resolution
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_PLAN_LIMIT = 12;

const SOURCE_AUTHORITY = {
  "primary-source documents": 100,
  "regulatory filings": 100,
  "official announcements": 96,
  "company filings": 95,
  "technical standards": 95,
  "engineering standards": 95,
  "OEM documentation": 92,
  "technical manuals": 90,
  "plant capacity disclosures": 90,
  "production statistics": 88,
  "factory announcements": 86,
  "procurement records": 86,
  "qualified-vendor lists": 86,
  "project awards": 84,
  "company disclosures": 82,
  "trade/shipping data": 82,
  "supplier lists": 80,
  "customer disclosures": 80,
  "commodity/process data": 80,
  "industry directories": 72,
  "company registries": 72,
  "market participants": 70,
  "public professional profiles": 64,
  "historical developments": 60,
  "historical analogues": 58,
  "cross-domain developments": 56,
  "related entities": 50,
  "adjacent relationships": 50,
  "relevant primary sources": 85
};

function clean(v){ return String(v ?? "").trim(); }
function n(v,f=0){ const x=Number(v); return Number.isFinite(x)?x:f; }
function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function uniq(a){ return [...new Set((a||[]).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }

function stableId(prefix,values){
  const src=(Array.isArray(values)?values:[values]).join("|");
  let h=2166136261;
  for(let i=0;i<src.length;i++){
    h^=src.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
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

function authorityScore(sourceType){
  return n(SOURCE_AUTHORITY[sourceType],55);
}

function normalizeInput(raw){
  if(!raw || typeof raw!=="object")
    throw new Error("Cosmos Acquisition requires a Cosmos Discovery JSON payload.");

  if(raw.status!=="discovery_targets_resolved")
    throw new Error(
      `Cosmos Acquisition requires discovery_targets_resolved input; got ${raw.status}`
    );

  const targets=Array.isArray(raw.discovery_targets)
    ?raw.discovery_targets
    :(raw.discovery_targets?.items||[]);

  const queue=Array.isArray(raw.next_acquisition_queue)
    ?raw.next_acquisition_queue
    :[];

  if(!targets.length) throw new Error("Discovery targets are required.");
  if(!queue.length) throw new Error("next_acquisition_queue[] is required.");

  return {
    source:raw,
    origin_event:raw.origin_event||{},
    curiosity_state:raw.curiosity_state||{},
    targets,
    queue
  };
}

function investigationIntent(type){
  const map={
    resolve_entity:
      "Resolve canonical identity and type without merging on similarity alone.",
    validate_direction:
      "Determine whether evidence supports the relationship in the proposed direction.",
    strengthen_evidence:
      "Find stronger independent evidence for the existing pathway.",
    identify_suppliers:
      "Identify suppliers, subcontractors, qualified vendors, and upstream dependencies.",
    identify_buyers:
      "Identify buyers, customers, procurement relationships, and demand exposure.",
    identify_substitutes:
      "Identify technically and commercially plausible substitute pathways.",
    identify_capacity:
      "Determine operating, spare, expandable, and constrained capacity plus lead time.",
    identify_geography:
      "Map physical locations and geographic concentration/exposure.",
    identify_logistics:
      "Identify port, route, transport, storage, and freight dependencies.",
    identify_people:
      "Identify relevant human actors, roles, decision-makers, operators, and experts.",
    identify_companies:
      "Identify organizations participating in this consequence branch.",
    identify_components:
      "Identify critical components, subassemblies, and bottleneck parts.",
    identify_materials:
      "Identify critical materials and processed inputs required by the target.",
    identify_market_exposure:
      "Identify commodity, financing, investment, pricing, and valuation exposure.",
    extend_frontier:
      "Discover evidence-backed adjacent entities and relationships beyond the known frontier."
  };
  return map[type]||"Acquire evidence relevant to the unresolved discovery target.";
}

function validationRules(type){
  const common=[
    "preserve source date and provenance",
    "record contradictory evidence",
    "do not convert unvalidated evidence into Cosmos knowledge"
  ];

  const special={
    resolve_entity:[
      "do not merge entities on name similarity alone"
    ],
    validate_direction:[
      "association is not causality",
      "reverse traversal does not prove forward direction"
    ],
    identify_substitutes:[
      "graph adjacency is not practical substitutability",
      "validate qualification and capacity separately"
    ],
    identify_capacity:[
      "nameplate capacity is not available capacity",
      "announced capacity is not operating capacity"
    ],
    identify_people:[
      "do not infer private decision authority without evidence"
    ],
    identify_components:[
      "component applicability must match the exact equipment/system"
    ],
    identify_materials:[
      "do not assume a mineral from a generic supply-chain signal",
      "raw mineral and processed material must remain distinct"
    ],
    identify_market_exposure:[
      "correlation is not causality",
      "company exposure must be evidenced"
    ],
    extend_frontier:[
      "semantic similarity alone cannot create a graph edge",
      "new candidates remain provisional until validated"
    ]
  };

  return uniq([...(special[type]||[]),...common]);
}

function queryTemplates(target,originEvent){
  const s=clean(target.statement);
  const origin=clean(originEvent.statement);

  const map={
    resolve_entity:[
      `${s} official`,
      `${s} company organization registry`
    ],
    validate_direction:[
      `${s} evidence`,
      `${s} technical primary source`
    ],
    strengthen_evidence:[
      `${s} official filing`,
      `${s} primary source`
    ],
    identify_suppliers:[
      `${s} suppliers qualified vendors`,
      `${s} subcontractors procurement`
    ],
    identify_buyers:[
      `${s} customers buyers`,
      `${s} procurement project awards`
    ],
    identify_substitutes:[
      `${s} substitute alternative`,
      `${s} qualification compatibility lead time`
    ],
    identify_capacity:[
      `${s} capacity production utilization`,
      `${s} expansion factory lead time`
    ],
    identify_geography:[
      `${s} locations facilities`,
      `${s} country geographic exposure`
    ],
    identify_logistics:[
      `${s} ports shipping logistics`,
      `${s} freight route transport`
    ],
    identify_people:[
      `${s} leadership operations procurement`,
      `${s} relevant experts`
    ],
    identify_companies:[
      `${s} companies manufacturers`,
      `${s} market participants`
    ],
    identify_components:[
      `${s} components BOM`,
      `${s} technical manual critical parts`
    ],
    identify_materials:[
      `${s} materials BOM`,
      `${s} processed materials technical specification`
    ],
    identify_market_exposure:[
      `${s} market commodity investment exposure`,
      `${s} earnings pricing valuation`
    ],
    extend_frontier:[
      `${s} dependencies upstream downstream`,
      `${s} historical analogue ripple effects`,
      `${origin} ${s} consequences`
    ]
  };

  return uniq((map[target.target_type]||[
    s,
    `${s} official source`,
    `${s} primary source`
  ]).map(clean).filter(Boolean));
}

function sourceStrategy(target){
  return uniq(target.suggested_source_types||[])
    .map(source_type=>({
      source_type,
      authority_score:authorityScore(source_type),
      acquisition_status:"planned",
      execution_adapter:"unassigned"
    }))
    .sort((a,b)=>b.authority_score-a.authority_score);
}

function evidenceContract(target){
  return {
    objective:investigationIntent(target.target_type),
    required_fields:[
      "source_url_or_identifier",
      "source_type",
      "source_title",
      "source_date_or_event_date",
      "retrieved_at",
      "extracted_fact",
      "supports_or_contradicts",
      "entity_ids",
      "relationship_ids"
    ],
    validation_rules:validationRules(target.target_type),
    accepted_dispositions:[
      "supports",
      "contradicts",
      "partially_supports",
      "context_only",
      "insufficient"
    ],
    evidence_is_not_knowledge_until_validated:true,
    knowledge_admission_status:"not_evaluated"
  };
}

function buildPlan(target,queueItem,originEvent){
  return {
    acquisition_plan_id:stableId("acquisition",[
      target.discovery_target_id,
      target.target_type,
      target.statement
    ]),
    discovery_target_id:target.discovery_target_id,
    queue_rank:n(queueItem?.queue_rank,null),
    target_type:target.target_type,
    statement:target.statement,
    curiosity_reason:target.curiosity_reason||queueItem?.reason||null,
    priority_score:n(target.priority_score,queueItem?.priority_score||0),
    butterfly_distance:n(target.butterfly_distance,0),

    lineage:{
      origin_event_id:originEvent.event_id||null,
      entity_ids:uniq(target.entity_ids||queueItem?.entity_ids||[]),
      consequence_ids:uniq(target.consequence_ids||[]),
      relationship_ids:uniq(target.relationship_ids||queueItem?.relationship_ids||[]),
      originating_gap_ids:uniq(target.originating_gap_ids||[])
    },

    investigation_intent:investigationIntent(target.target_type),
    query_templates:queryTemplates(target,originEvent),
    source_strategy:sourceStrategy(target),
    evidence_contract:evidenceContract(target),

    frontier_effect:{
      reopens_frontier_if_resolved:
        target.reopens_frontier_if_resolved===true,
      consequence_frontier_action:
        target.reopens_frontier_if_resolved===true
          ?"eligible_for_repropagation_after_validation"
          :"enrich_context_after_validation"
    },

    execution:{
      mode:"planned_only",
      network_execution_performed:false,
      executor_status:"not_connected",
      result_count:0
    }
  };
}

function buildPlans(ctx,options={}){
  const map=new Map(
    ctx.targets.map(t=>[t.discovery_target_id,t])
  );

  const limit=clamp(n(options.plan_limit,DEFAULT_PLAN_LIMIT),1,100);
  const plans=[];

  for(const q of ctx.queue.slice(0,limit)){
    const target=map.get(q.discovery_target_id);
    if(target) plans.push(buildPlan(target,q,ctx.origin_event));
  }

  return plans;
}

function runCosmosAcquisition(raw,options={}){
  const ctx=normalizeInput(raw);
  const plans=buildPlans(ctx,options);

  if(!plans.length)
    throw new Error("No acquisition plans could be mapped from Discovery.");

  const reopen=plans.filter(
    p=>p.frontier_effect.reopens_frontier_if_resolved===true
  );

  const target_type_counts={};
  const source_type_counts={};

  for(const p of plans){
    target_type_counts[p.target_type]=n(target_type_counts[p.target_type])+1;
    for(const s of p.source_strategy)
      source_type_counts[s.source_type]=n(source_type_counts[s.source_type])+1;
  }

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"acquisition_plans_resolved",

    source_discovery:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    origin_event:ctx.origin_event,

    acquisition_state:{
      plan_count:plans.length,
      frontier_reopening_plan_count:reopen.length,
      target_type_counts,
      source_type_counts,
      execution_mode:"planned_only",
      external_execution_connected:false,
      evidence_validation_required_before_graph_admission:true,
      conceptual_distance_limit:
        ctx.curiosity_state?.conceptual_distance_limit??null,
      continuation_possible:
        ctx.curiosity_state?.continuation_possible===true,
      principle:
        "Discovery identifies what Cosmos needs. Acquisition defines how to investigate it. Evidence must be validated before becoming knowledge."
    },

    acquisition_plans:plans,

    future_executor_queue:plans.map((p,index)=>({
      execution_rank:index+1,
      acquisition_plan_id:p.acquisition_plan_id,
      discovery_target_id:p.discovery_target_id,
      target_type:p.target_type,
      priority_score:p.priority_score,
      query_templates:p.query_templates,
      source_strategy:p.source_strategy,
      execution_status:"not_connected"
    })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_evidence:false,
      invents_entities:false,
      upgrades_evidence_quality:false,
      writes_to_knowledge_graph:false,
      converts_acquisition_plan_to_fact:false,
      evidence_requires_validation:true,
      source_lineage_preserved:true,
      discovery_lineage_preserved:true,
      frontier_reopens_only_after_validation:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};

  for(let i=0;i<args.length;i++){
    if(args[i]==="--input"&&args[i+1]) out.input_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
    else if(args[i]==="--plan-limit"&&args[i+1]) out.plan_limit=Number(args[++i]);
  }

  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.input_file)
    throw new Error(
      "Usage: node scripts/cosmos_acquisition.cjs --input <discovery.json> [--out <acquisition.json>] [--plan-limit N]"
    );

  const output=runCosmosAcquisition(readJson(options.input_file),options);

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(`Cosmos Acquisition output written to ${options.output_file}`);
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runCosmosAcquisition,
  normalizeInput,
  investigationIntent,
  validationRules,
  queryTemplates,
  sourceStrategy,
  evidenceContract,
  buildPlan,
  buildPlans
};
