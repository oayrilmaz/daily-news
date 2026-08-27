#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
function nowIso(){ return new Date().toISOString(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function writeJson(file,payload){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(payload,null,2),"utf8");
}

function normalizeGraph(raw){
  if(!raw || raw.status!=="cosmos_graph_snapshot"){
    throw new Error(
      `Cosmos Temporal Knowledge requires cosmos_graph_snapshot input; got ${raw?.status}`
    );
  }
  return {
    schema_version: raw.schema_version || null,
    generated_at: raw.generated_at || null,
    knowledge_records: Array.isArray(raw.knowledge_records)
      ? clone(raw.knowledge_records)
      : []
  };
}

function normalizeHorizon(v){
  const s = clean(v).toLowerCase();
  if(["past","historical","history"].includes(s)) return "past";
  if(["current","now","present"].includes(s)) return "current";
  if(["transition","changing","emerging"].includes(s)) return "transition";
  if(["future","scenario","forecast","forward"].includes(s)) return "future";
  return "unknown";
}

function deriveTemporalState(record, referenceTime){
  const admittedAt = clean(record.admitted_at);
  const deactivatedAt = clean(record.deactivated_at);
  const temporalScope = normalizeHorizon(record.temporal_scope);
  const epistemicStatus = clean(record.epistemic_status);
  const active = record.active === true;

  let state = "current";

  if(!active && deactivatedAt){
    state = "past";
  } else if(temporalScope === "future"){
    state = "future";
  } else if(temporalScope === "transition"){
    state = "transition";
  } else if(temporalScope === "past"){
    state = "past";
  } else if(temporalScope === "current"){
    state = "current";
  } else if(epistemicStatus.includes("scenario")){
    state = "future";
  }

  return {
    graph_record_id: record.graph_record_id || null,
    knowledge_admission_id: record.knowledge_admission_id || null,
    validation_target_id: record.validation_target_id || null,
    temporal_state: state,
    active,
    admitted_at: admittedAt || null,
    deactivated_at: deactivatedAt || null,
    reference_time: referenceTime,
    validation_disposition: record.validation_disposition || null,
    claim_class: record.claim_class || null,
    epistemic_status: record.epistemic_status || null,
    confidence_score: Number.isFinite(Number(record.confidence_score))
      ? Number(record.confidence_score)
      : null,
    confidence_band: record.confidence_band || null,
    evidence_record_ids: Array.isArray(record.evidence_record_ids)
      ? [...record.evidence_record_ids]
      : [],
    temporal_scope_original: record.temporal_scope || null,
    geography_scope: record.geography_scope || null,
    qualification: record.qualification && typeof record.qualification === "object"
      ? clone(record.qualification)
      : {},
    temporal_contract: {
      historical_state_preserved: state === "past",
      current_state_claimed: state === "current",
      transition_state_claimed: state === "transition",
      future_state_claimed: state === "future",
      future_is_not_current_fact: state === "future",
      lineage_preserved: true
    }
  };
}

function detectTargetTransitions(rows){
  const byTarget = new Map();

  for(const row of rows){
    const key = clean(row.validation_target_id);
    if(!key) continue;
    if(!byTarget.has(key)) byTarget.set(key,[]);
    byTarget.get(key).push(row);
  }

  const transitions=[];

  for(const [target, items] of byTarget){
    const sorted = [...items].sort((a,b)=>{
      const aa = Date.parse(a.admitted_at || "") || 0;
      const bb = Date.parse(b.admitted_at || "") || 0;
      return aa - bb;
    });

    if(sorted.length < 2) continue;

    for(let i=1;i<sorted.length;i++){
      const prev = sorted[i-1];
      const next = sorted[i];

      transitions.push({
        validation_target_id: target,
        from_graph_record_id: prev.graph_record_id,
        to_graph_record_id: next.graph_record_id,
        from_temporal_state: prev.temporal_state,
        to_temporal_state: next.temporal_state,
        disposition_changed:
          prev.validation_disposition !== next.validation_disposition,
        confidence_changed:
          Number(prev.confidence_score) !== Number(next.confidence_score),
        confidence_delta:
          Number.isFinite(Number(prev.confidence_score)) &&
          Number.isFinite(Number(next.confidence_score))
            ? Number(next.confidence_score) - Number(prev.confidence_score)
            : null,
        transition_status: "observed_from_graph_history"
      });
    }
  }

  return transitions;
}

function runTemporalKnowledge(graphRaw, options={}){
  const graph = normalizeGraph(graphRaw);
  const referenceTime = clean(options.reference_time) || nowIso();

  const records = graph.knowledge_records.map(
    row => deriveTemporalState(row, referenceTime)
  );

  const buckets = {
    past: records.filter(x=>x.temporal_state==="past"),
    current: records.filter(x=>x.temporal_state==="current"),
    transition: records.filter(x=>x.temporal_state==="transition"),
    future: records.filter(x=>x.temporal_state==="future"),
    unknown: records.filter(x=>x.temporal_state==="unknown")
  };

  const transitions = detectTargetTransitions(records);

  return {
    schema_version: "0.1",
    generated_at: nowIso(),
    status: "temporal_knowledge_resolved",
    reference_time: referenceTime,
    temporal_state: {
      record_count: records.length,
      past_count: buckets.past.length,
      current_count: buckets.current.length,
      transition_count: buckets.transition.length,
      future_count: buckets.future.length,
      unknown_count: buckets.unknown.length,
      transition_event_count: transitions.length
    },
    timeline: buckets,
    transitions,
    temporal_contract: {
      past_present_future_separated: true,
      inactive_records_preserved_as_history: true,
      future_scenarios_not_promoted_to_current_fact: true,
      transition_state_supported: true,
      evidence_lineage_preserved: true,
      confidence_preserved: true,
      geography_scope_preserved: true,
      temporal_scope_preserved: true
    },
    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      mutates_graph: false,
      deletes_historical_knowledge: false,
      rewrites_original_records: false,
      promotes_future_to_fact: false,
      collapses_temporal_states: false,
      preserves_source_lineage: true,
      preserves_confidence: true,
      preserves_epistemic_status: true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2), out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--graph" && args[i+1]) out.graph_file=args[++i];
    else if(args[i]==="--out" && args[i+1]) out.output_file=args[++i];
    else if(args[i]==="--reference-time" && args[i+1]) out.reference_time=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.graph_file){
    throw new Error(
      "Usage: node scripts/cosmos_temporal_knowledge.cjs --graph <graph-snapshot.json> [--reference-time <iso>] [--out <temporal-knowledge.json>]"
    );
  }

  const output=runTemporalKnowledge(
    readJson(options.graph_file),
    { reference_time: options.reference_time }
  );

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Temporal Knowledge output written to ${options.output_file}`
    );
  } else {
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runTemporalKnowledge,
  deriveTemporalState,
  detectTargetTransitions,
  normalizeHorizon
};
