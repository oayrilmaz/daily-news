#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Evidence Executor v0.1
 *
 * Purpose:
 * Execute a controlled evidence-acquisition task against a provided
 * evidence-adapter response set and normalize the returned material into
 * evidence records.
 *
 * IMPORTANT:
 * v0.1 DOES NOT directly call the public web or any external API itself.
 * Instead it consumes:
 *   1) an Evidence Strategy output
 *   2) an adapter-results JSON file produced by a future/search integration
 *
 * This keeps the executor boundary testable before we connect live search.
 *
 * Evidence Strategy:
 *   "What should be searched?"
 *
 * Evidence Executor:
 *   "What evidence records came back from the execution adapter?"
 *
 * This layer DOES NOT:
 * - validate candidates
 * - promote anything to fact
 * - write to the knowledge graph
 * - invent missing sources
 * - infer unsupported claims
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

function normalizeStrategy(raw){
  if(!raw || raw.status!=="evidence_strategy_resolved"){
    throw new Error(
      `Cosmos Evidence Executor requires evidence_strategy_resolved input; got ${raw?.status}`
    );
  }

  const tasks=Array.isArray(raw.evidence_tasks)?raw.evidence_tasks:[];
  if(!tasks.length) throw new Error("Evidence Strategy contains no evidence_tasks[].");

  return {
    source:raw,
    tasks,
    byTaskId:new Map(tasks.map(t=>[t.evidence_task_id,t]))
  };
}

function normalizeAdapter(raw){
  if(!raw || typeof raw!=="object"){
    throw new Error("Evidence adapter-results JSON is required.");
  }

  if(raw.status && ![
    "adapter_results_ready",
    "completed",
    "ready"
  ].includes(raw.status)){
    throw new Error(
      `Unsupported evidence adapter status: ${raw.status}`
    );
  }

  const results=Array.isArray(raw.results)?raw.results:[];
  return {
    source:raw,
    results
  };
}

function normalizeDisposition(v){
  const allowed=new Set([
    "supports",
    "partially_supports",
    "contradicts",
    "context_only",
    "insufficient"
  ]);
  const value=clean(v);
  return allowed.has(value)?value:"insufficient";
}

function normalizeDirectness(v){
  const allowed=new Set([
    "direct",
    "indirect",
    "contextual",
    "unknown"
  ]);
  const value=clean(v);
  return allowed.has(value)?value:"unknown";
}

function normalizeEvidenceRecord(result,task,index){
  const sourceId=clean(
    result.source_url_or_identifier ||
    result.url ||
    result.identifier
  );

  const sourceTitle=clean(result.source_title || result.title);
  const extractedFact=clean(
    result.extracted_fact ||
    result.snippet ||
    result.fact
  );

  const recordId=stableId("evidence",[
    task.evidence_task_id,
    sourceId,
    sourceTitle,
    extractedFact,
    index
  ]);

  return {
    evidence_record_id:recordId,
    evidence_task_id:task.evidence_task_id,
    validation_target_id:task.validation_target_id,

    source_url_or_identifier:sourceId || null,
    source_type:clean(result.source_type) || "unclassified",
    source_title:sourceTitle || null,
    source_publisher_or_owner:
      clean(result.source_publisher_or_owner || result.publisher) || null,
    source_date_or_event_date:
      clean(result.source_date_or_event_date || result.date) || null,
    retrieved_at:
      clean(result.retrieved_at) || nowIso(),

    extracted_fact:extractedFact || null,
    supports_or_contradicts:
      normalizeDisposition(result.supports_or_contradicts),
    directness:normalizeDirectness(result.directness),
    authority_score:
      Number.isFinite(Number(result.authority_score))
        ? Number(result.authority_score)
        : null,
    independence_group:
      clean(result.independence_group) || null,
    geography_scope:
      clean(result.geography_scope) || null,
    temporal_scope:
      clean(result.temporal_scope) || null,

    entity_ids:uniq(result.entity_ids || []),
    relationship_ids:uniq(result.relationship_ids || []),

    query_used:clean(result.query_used) || null,
    source_rank:
      Number.isFinite(Number(result.source_rank))
        ? Number(result.source_rank)
        : null,

    record_quality:{
      has_source_identity:Boolean(sourceId || sourceTitle),
      has_extracted_fact:Boolean(extractedFact),
      has_source_date:Boolean(
        clean(result.source_date_or_event_date || result.date)
      ),
      has_publisher:Boolean(
        clean(result.source_publisher_or_owner || result.publisher)
      ),
      has_independence_group:Boolean(
        clean(result.independence_group)
      )
    },

    epistemic_status:"collected_evidence",
    validation_status:"not_evaluated",
    knowledge_status:"not_admitted"
  };
}

function evaluateTaskExecution(task,records){
  const uniqueIndependentGroups=new Set(
    records
      .map(r=>clean(r.independence_group))
      .filter(Boolean)
  );

  const supporting=records.filter(r=>
    ["supports","partially_supports"].includes(r.supports_or_contradicts)
  );

  const contradictions=records.filter(
    r=>r.supports_or_contradicts==="contradicts"
  );

  const directPrimary=records.filter(r=>
    r.directness==="direct" &&
    Number(r.authority_score)>=90
  );

  const minimumTotal=
    Number(task.sufficiency_contract?.minimum_total_sources || 0);

  const minimumIndependent=
    Number(task.sufficiency_contract?.minimum_independent_sources || 0);

  return {
    evidence_task_id:task.evidence_task_id,
    validation_target_id:task.validation_target_id,

    collected_record_count:records.length,
    supporting_record_count:supporting.length,
    contradiction_record_count:contradictions.length,
    direct_high_authority_record_count:directPrimary.length,
    independent_source_group_count:uniqueIndependentGroups.size,

    sufficiency_observation:{
      minimum_total_sources:minimumTotal,
      minimum_independent_sources:minimumIndependent,
      total_source_threshold_met:
        records.length>=minimumTotal,
      independent_source_threshold_met:
        uniqueIndependentGroups.size>=minimumIndependent,
      direct_primary_preference_met:
        directPrimary.length>=1,
      contradiction_search_observed:
        contradictions.length>0
    },

    execution_status:
      records.length>0 ? "evidence_collected" : "no_evidence_returned",

    validation_status:"not_started",
    knowledge_admission_status:"not_started"
  };
}

function runEvidenceExecutor(strategyRaw,adapterRaw){
  const strategy=normalizeStrategy(strategyRaw);
  const adapter=normalizeAdapter(adapterRaw);

  const recordsByTask=new Map(
    strategy.tasks.map(t=>[t.evidence_task_id,[]])
  );

  const orphanResults=[];

  for(let i=0;i<adapter.results.length;i++){
    const result=adapter.results[i];
    const taskId=clean(result.evidence_task_id);
    const task=strategy.byTaskId.get(taskId);

    if(!task){
      orphanResults.push({
        adapter_result_index:i,
        evidence_task_id:taskId || null,
        reason:"unknown_evidence_task_id"
      });
      continue;
    }

    recordsByTask.get(taskId).push(
      normalizeEvidenceRecord(
        result,
        task,
        recordsByTask.get(taskId).length
      )
    );
  }

  const evidence_records=[];
  const task_execution=[];

  for(const task of strategy.tasks){
    const records=recordsByTask.get(task.evidence_task_id) || [];
    evidence_records.push(...records);
    task_execution.push(
      evaluateTaskExecution(task,records)
    );
  }

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"evidence_execution_normalized",

    source_evidence_strategy:{
      schema_version:strategyRaw.schema_version||null,
      generated_at:strategyRaw.generated_at||null,
      status:strategyRaw.status||null
    },

    source_adapter:{
      schema_version:adapterRaw.schema_version||null,
      generated_at:adapterRaw.generated_at||null,
      status:adapterRaw.status||null,
      adapter_name:clean(adapterRaw.adapter_name)||"unassigned_adapter",
      adapter_mode:clean(adapterRaw.adapter_mode)||"provided_results"
    },

    execution_state:{
      evidence_task_count:strategy.tasks.length,
      adapter_result_count:adapter.results.length,
      normalized_evidence_record_count:evidence_records.length,
      orphan_result_count:orphanResults.length,
      validation_decision_count:0,
      knowledge_admission_count:0,
      conceptual_distance_limit:
        strategyRaw.evidence_state?.conceptual_distance_limit??null,
      continuation_possible:
        strategyRaw.evidence_state?.continuation_possible===true,
      principle:
        "Evidence execution may collect and normalize source material, but only a separate validation layer may decide what that evidence means."
    },

    evidence_records,
    task_execution,
    orphan_results:orphanResults,

    validation_queue:task_execution.map((row,index)=>({
      validation_rank:index+1,
      evidence_task_id:row.evidence_task_id,
      validation_target_id:row.validation_target_id,
      evidence_record_ids:evidence_records
        .filter(r=>r.evidence_task_id===row.evidence_task_id)
        .map(r=>r.evidence_record_id),
      validation_status:"not_started",
      knowledge_admission_status:"not_started"
    })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      adapter_results_are_treated_as_unvalidated_input:true,
      invents_evidence:false,
      validates_candidates:false,
      promotes_candidates_to_facts:false,
      writes_to_knowledge_graph:false,
      preserves_contradictory_evidence:true,
      preserves_orphan_adapter_results:true,
      source_lineage_preserved:true,
      validation_required_before_knowledge_admission:true,
      unlimited_conceptual_continuation_preserved:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};

  for(let i=0;i<args.length;i++){
    if(args[i]==="--strategy"&&args[i+1]) out.strategy_file=args[++i];
    else if(args[i]==="--adapter-results"&&args[i+1]) out.adapter_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
  }

  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.strategy_file || !options.adapter_file){
    throw new Error(
      "Usage: node scripts/cosmos_evidence_executor.cjs --strategy <evidence-strategy.json> --adapter-results <adapter-results.json> [--out <evidence-execution.json>]"
    );
  }

  const output=runEvidenceExecutor(
    readJson(options.strategy_file),
    readJson(options.adapter_file)
  );

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Evidence Executor output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runEvidenceExecutor,
  normalizeStrategy,
  normalizeAdapter,
  normalizeEvidenceRecord,
  evaluateTaskExecution
};
