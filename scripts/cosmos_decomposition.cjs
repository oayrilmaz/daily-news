#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Decomposition Engine v0.1
 *
 * Purpose:
 * Convert applicability-blocked abstract acquisition targets into concrete,
 * provisional candidate instantiations that can later be investigated.
 *
 * IMPORTANT:
 * - candidates are NOT facts
 * - no external search
 * - no OpenAI/API calls
 * - no knowledge-graph writes
 * - no automatic validation
 * - no automatic execution
 *
 * Applicability says:
 *   "This question is too abstract to execute."
 *
 * Decomposition says:
 *   "Here are concrete candidate branches through which the abstract concept
 *    may become physically, organizationally, economically, geographically,
 *    or operationally instantiated."
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

function candidateClass(label){
  const s=clean(label).toLowerCase();

  if (/semiconductor|accelerator|chip|gpu|processor/.test(s))
    return "technology_hardware";
  if (/data center|compute infrastructure|networking|cooling/.test(s))
    return "infrastructure";
  if (/electricity|power|energy/.test(s))
    return "resource_or_demand";
  if (/software|model/.test(s))
    return "digital_infrastructure";
  if (/organization|company|supplier|operator/.test(s))
    return "organization";
  if (/people|human|expert|role/.test(s))
    return "human";
  if (/location|geograph|country|region/.test(s))
    return "geography";

  return "candidate_instantiation";
}

function investigationTypesFor(candidate, originalType){
  const cls=candidateClass(candidate);
  const types=new Set();

  if (originalType) types.add(originalType);

  if (["technology_hardware","infrastructure"].includes(cls)){
    [
      "identify_components",
      "identify_materials",
      "identify_suppliers",
      "identify_capacity",
      "identify_geography",
      "identify_logistics"
    ].forEach(x=>types.add(x));
  }

  if (cls==="resource_or_demand"){
    [
      "identify_capacity",
      "identify_geography",
      "identify_market_exposure"
    ].forEach(x=>types.add(x));
  }

  if (cls==="digital_infrastructure"){
    [
      "identify_companies",
      "identify_people",
      "identify_market_exposure"
    ].forEach(x=>types.add(x));
  }

  return [...types];
}

function buildCandidate(row, hint, index){
  const label=clean(hint);
  const cls=candidateClass(label);

  return {
    decomposition_candidate_id:stableId("decomp",[
      row.acquisition_plan_id,
      row.discovery_target_id,
      label
    ]),
    candidate_rank:index+1,
    parent_acquisition_plan_id:row.acquisition_plan_id,
    parent_discovery_target_id:row.discovery_target_id,
    abstract_subject:row.subject,
    original_target_type:row.target_type,
    candidate_label:label,
    candidate_class:cls,

    epistemic_status:"provisional_candidate",
    validated:false,
    executable:false,

    rationale:
      `"${label}" is a candidate concrete instantiation of "${row.subject}" and must be validated before it can become an executable Cosmos acquisition target.`,

    proposed_investigation_types:
      investigationTypesFor(label,row.target_type),

    validation_requirements:[
      `evidence that "${label}" materially instantiates or enables "${row.subject}" in the relevant consequence path`,
      "source provenance and date",
      "relationship direction where applicable",
      "contradictory evidence retained"
    ],

    lineage:{
      acquisition_plan_id:row.acquisition_plan_id,
      discovery_target_id:row.discovery_target_id,
      decomposition_rank:row.decomposition_rank
    }
  };
}

function decomposeRow(row){
  const hints=uniq(row.hints || []);

  return {
    decomposition_id:stableId("decomposition",[
      row.acquisition_plan_id,
      row.subject,
      row.target_type
    ]),
    decomposition_rank:row.decomposition_rank,
    acquisition_plan_id:row.acquisition_plan_id,
    discovery_target_id:row.discovery_target_id,
    abstract_subject:row.subject,
    original_target_type:row.target_type,
    original_question:row.question,

    status:hints.length
      ?"provisional_candidates_resolved"
      :"insufficient_decomposition_context",

    candidates:hints.map((hint,index)=>buildCandidate(row,hint,index)),

    resolution_contract:{
      candidates_are_facts:false,
      candidates_are_executable:false,
      validation_required:true,
      external_evidence_required:true,
      parent_plan_remains_blocked:true
    }
  };
}

function runDecomposition(raw){
  if(!raw || raw.status!=="acquisition_applicability_resolved")
    throw new Error(
      `Cosmos Decomposition requires acquisition_applicability_resolved input; got ${raw?.status}`
    );

  const queue=Array.isArray(raw.decomposition_queue)
    ?raw.decomposition_queue
    :[];

  const decompositions=queue.map(decomposeRow);
  const candidates=decompositions.flatMap(x=>x.candidates || []);

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"decomposition_candidates_resolved",

    source_applicability:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    decomposition_state:{
      blocked_plan_count:queue.length,
      decomposition_count:decompositions.length,
      candidate_count:candidates.length,
      validated_candidate_count:
        candidates.filter(x=>x.validated===true).length,
      executable_candidate_count:
        candidates.filter(x=>x.executable===true).length,
      external_execution_connected:false,
      conceptual_distance_limit:
        raw.applicability_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.applicability_state?.continuation_possible===true,
      principle:
        "Abstract concepts may branch into concrete candidate instantiations, but candidate generation is not evidence and cannot create facts."
    },

    decompositions,

    candidate_validation_queue:candidates.map((candidate,index)=>({
      validation_rank:index+1,
      decomposition_candidate_id:candidate.decomposition_candidate_id,
      parent_acquisition_plan_id:candidate.parent_acquisition_plan_id,
      parent_discovery_target_id:candidate.parent_discovery_target_id,
      abstract_subject:candidate.abstract_subject,
      candidate_label:candidate.candidate_label,
      candidate_class:candidate.candidate_class,
      proposed_investigation_types:
        candidate.proposed_investigation_types,
      validation_requirements:
        candidate.validation_requirements,
      validation_status:"not_started",
      execution_status:"blocked_pending_validation"
    })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_evidence:false,
      writes_to_knowledge_graph:false,
      promotes_candidates_to_facts:false,
      executes_candidates:false,
      validates_candidates:false,
      parent_acquisition_plans_remain_blocked:true,
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

  if(!options.input_file)
    throw new Error(
      "Usage: node scripts/cosmos_decomposition.cjs --input <applicability.json> [--out <decomposition.json>]"
    );

  const output=runDecomposition(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(`Cosmos Decomposition output written to ${options.output_file}`);
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runDecomposition,
  decomposeRow,
  buildCandidate,
  candidateClass,
  investigationTypesFor
};
