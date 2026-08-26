#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Evidence Strategy Planner v0.1
 *
 * Purpose:
 * Convert unique candidate-validation targets into concrete, source-aware
 * evidence acquisition tasks WITHOUT executing any search.
 *
 * Candidate Validation says:
 *   "What must be validated?"
 *
 * Evidence Strategy says:
 *   "Which kinds of evidence should Cosmos seek, in what order, and what
 *    would count as support, contradiction, or insufficient evidence?"
 *
 * IMPORTANT:
 * - no external search
 * - no OpenAI/API calls
 * - no validation decision
 * - no candidate promotion to fact
 * - no knowledge-graph writes
 */

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a || []).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }

function stableId(prefix, values){
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

const SOURCE_PROFILES = {
  infrastructure: [
    ["official_project_or_operator_document", 100],
    ["regulatory_or_government_document", 96],
    ["company_filing_or_investor_document", 92],
    ["technical_standard_or_engineering_document", 90],
    ["industry_body_or_research_institution", 82],
    ["reputable_trade_publication", 68]
  ],
  technology_hardware: [
    ["manufacturer_or_oem_documentation", 100],
    ["technical_standard_or_architecture_document", 96],
    ["company_filing_or_investor_document", 92],
    ["government_or_regulatory_document", 90],
    ["industry_body_or_research_institution", 84],
    ["reputable_trade_publication", 68]
  ],
  resource_or_demand: [
    ["grid_operator_or_utility_document", 100],
    ["government_or_regulatory_document", 98],
    ["company_filing_or_operator_disclosure", 92],
    ["industry_body_or_research_institution", 86],
    ["market_or_system_operator_data", 84],
    ["reputable_trade_publication", 66]
  ],
  digital_infrastructure: [
    ["company_or_platform_documentation", 100],
    ["technical_architecture_or_research_document", 94],
    ["company_filing_or_investor_document", 90],
    ["industry_body_or_research_institution", 82],
    ["reputable_trade_publication", 66]
  ],
  candidate_instantiation: [
    ["primary_or_official_source", 100],
    ["regulatory_or_government_document", 94],
    ["company_filing_or_disclosure", 90],
    ["technical_or_research_document", 84],
    ["reputable_trade_publication", 66]
  ]
};

function sourceProfile(candidateClass){
  return (SOURCE_PROFILES[candidateClass] || SOURCE_PROFILES.candidate_instantiation)
    .map(([source_type, authority_score])=>({
      source_type,
      authority_score,
      priority: authority_score >= 95 ? "primary" :
                authority_score >= 85 ? "secondary" : "tertiary",
      acquisition_status:"planned",
      execution_adapter:"unassigned"
    }));
}

function evidenceQuestions(target){
  const subject=clean(target.abstract_subject);
  const label=clean(target.candidate_label);

  return [
    `What authoritative evidence directly connects "${label}" to "${subject}"?`,
    `Is "${label}" a necessary enabler, a common implementation pathway, an associated dependency, or merely correlated with "${subject}"?`,
    `What evidence contradicts or limits the proposed "${label}" → "${subject}" relationship?`,
    `Is the relationship current, historical, geography-specific, technology-specific, or conditional?`,
    `Which concrete entities, systems, facilities, organizations, people, or resources provide the strongest evidence for this relationship?`
  ];
}

function queryIntents(target){
  const subject=clean(target.abstract_subject);
  const label=clean(target.candidate_label);

  return uniq([
    `"${label}" "${subject}" official`,
    `"${label}" "${subject}" technical`,
    `"${label}" "${subject}" infrastructure`,
    `"${label}" "${subject}" dependency`,
    `"${label}" "${subject}" requirement`,
    `"${label}" "${subject}" capacity`,
    `"${label}" "${subject}" limitation`,
    `"${label}" "${subject}" alternative`
  ]);
}

function requiredEvidenceCount(target){
  // One direct authoritative source can establish a narrow structural fact,
  // but Cosmos should normally seek corroboration before a candidate can
  // support downstream graph expansion.
  return {
    minimum_total_sources: 2,
    minimum_independent_sources: 2,
    direct_primary_source_preferred: true,
    single_source_exception:
      "Allowed only when the source is direct, authoritative, unambiguous, and the claim is narrow; corroboration should still be sought before broad downstream propagation."
  };
}

function buildEvidenceTask(target,index){
  const source_strategy=sourceProfile(target.candidate_class);

  return {
    evidence_task_id:stableId("evidence_task",[
      target.validation_target_id,
      target.abstract_subject,
      target.candidate_label
    ]),
    evidence_rank:index+1,
    validation_target_id:target.validation_target_id,

    abstract_subject:target.abstract_subject,
    candidate_label:target.candidate_label,
    candidate_class:target.candidate_class,

    validation_objective:target.validation_objective,
    evidence_questions:evidenceQuestions(target),
    query_intents:queryIntents(target),
    source_strategy,

    sufficiency_contract:{
      ...requiredEvidenceCount(target),
      contradiction_search_required:true,
      provenance_required:true,
      source_date_required:true,
      source_identity_required:true,
      extracted_fact_required:true,
      relationship_direction_required_where_applicable:true,
      geography_scope_required_where_applicable:true,
      temporal_scope_required_where_applicable:true
    },

    evidence_record_schema:{
      required_fields:[
        "source_url_or_identifier",
        "source_type",
        "source_title",
        "source_publisher_or_owner",
        "source_date_or_event_date",
        "retrieved_at",
        "extracted_fact",
        "supports_or_contradicts",
        "directness",
        "authority_score",
        "independence_group",
        "geography_scope",
        "temporal_scope",
        "entity_ids",
        "relationship_ids"
      ],
      allowed_dispositions:[
        "supports",
        "partially_supports",
        "contradicts",
        "context_only",
        "insufficient"
      ]
    },

    validation_boundary:{
      evidence_collected:false,
      validation_decision_made:false,
      candidate_promoted:false,
      executable:false,
      knowledge_admitted:false
    },

    downstream_context:{
      original_target_types:uniq(target.original_target_types || []),
      proposed_investigation_types:
        uniq(target.proposed_investigation_types || []),
      if_supported_fanout:
        uniq(target.post_validation_fanout?.if_supported || []),
      if_partially_supported_fanout:
        uniq(target.post_validation_fanout?.if_partially_supported || [])
    },

    lineage:{
      validation_target_id:target.validation_target_id,
      source_candidate_ids:
        uniq(target.source_candidate_ids || []),
      acquisition_plan_ids:
        uniq(target.parent_acquisition_plan_ids || []),
      discovery_target_ids:
        uniq(target.parent_discovery_target_ids || [])
    },

    execution:{
      mode:"planned_only",
      external_search_performed:false,
      executor_status:"not_connected",
      result_count:0
    }
  };
}

function runEvidenceStrategy(raw){
  if(!raw || raw.status!=="candidate_validation_targets_resolved"){
    throw new Error(
      `Cosmos Evidence Strategy requires candidate_validation_targets_resolved input; got ${raw?.status}`
    );
  }

  const targets=Array.isArray(raw.validation_targets)
    ? raw.validation_targets
    : [];

  if(!targets.length){
    throw new Error("validation_targets[] is required.");
  }

  const tasks=targets.map(buildEvidenceTask);

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"evidence_strategy_resolved",

    source_candidate_validation:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    evidence_state:{
      validation_target_count:targets.length,
      evidence_task_count:tasks.length,
      external_execution_connected:false,
      evidence_collected_count:0,
      validation_decision_count:0,
      knowledge_admission_count:0,
      conceptual_distance_limit:
        raw.validation_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.validation_state?.continuation_possible===true,
      principle:
        "Cosmos should seek direct, authoritative, independent and contradictory evidence before validating a provisional candidate."
    },

    evidence_tasks:tasks,

    executor_queue:tasks.map((task,index)=>({
      execution_rank:index+1,
      evidence_task_id:task.evidence_task_id,
      validation_target_id:task.validation_target_id,
      abstract_subject:task.abstract_subject,
      candidate_label:task.candidate_label,
      candidate_class:task.candidate_class,
      query_intents:task.query_intents,
      source_strategy:task.source_strategy,
      sufficiency_contract:task.sufficiency_contract,
      execution_status:"not_connected",
      validation_status:"not_started"
    })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      collects_evidence:false,
      validates_candidates:false,
      invents_evidence:false,
      writes_to_knowledge_graph:false,
      promotes_candidates_to_facts:false,
      source_authority_ranked:true,
      contradiction_search_required:true,
      independent_corroboration_planned:true,
      validation_required_before_execution:true,
      source_lineage_preserved:true,
      unlimited_conceptual_continuation_preserved:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--input"&&args[i+1]) out.input_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.input_file){
    throw new Error(
      "Usage: node scripts/cosmos_evidence_strategy.cjs --input <candidate-validation.json> [--out <evidence-strategy.json>]"
    );
  }

  const output=runEvidenceStrategy(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Evidence Strategy output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runEvidenceStrategy,
  buildEvidenceTask,
  sourceProfile,
  evidenceQuestions,
  queryIntents,
  requiredEvidenceCount
};
