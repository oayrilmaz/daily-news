#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Candidate Validation Planner v0.1
 *
 * Purpose:
 * Consolidate repeated decomposition candidates and turn them into unique,
 * evidence-ready validation targets without validating them yet.
 *
 * Example:
 *   "data centers" may appear under:
 *     - identify_components
 *     - identify_materials
 *     - identify_capacity
 *
 * Cosmos should not validate "data centers instantiate AI" three separate times.
 * It should validate the candidate once, preserve all parent lineage, then fan
 * the result back out to the relevant investigation intents.
 *
 * IMPORTANT:
 * - no external search
 * - no OpenAI/API calls
 * - no candidate validation
 * - no knowledge-graph writes
 * - no candidate promotion to fact
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

function normalizeKey(subject,label,cls){
  return [
    clean(subject).toLowerCase(),
    clean(label).toLowerCase(),
    clean(cls).toLowerCase()
  ].join("|");
}

function consolidate(raw){
  if(!raw || raw.status!=="decomposition_candidates_resolved"){
    throw new Error(
      `Cosmos Candidate Validation Planner requires decomposition_candidates_resolved input; got ${raw?.status}`
    );
  }

  const decompositions=Array.isArray(raw.decompositions)?raw.decompositions:[];
  const candidates=decompositions.flatMap(d=>
    Array.isArray(d.candidates)?d.candidates:[]
  );

  const groups=new Map();

  for(const c of candidates){
    const key=normalizeKey(
      c.abstract_subject,
      c.candidate_label,
      c.candidate_class
    );

    if(!groups.has(key)){
      groups.set(key,{
        abstract_subject:c.abstract_subject,
        candidate_label:c.candidate_label,
        candidate_class:c.candidate_class,
        source_candidate_ids:[],
        parent_acquisition_plan_ids:[],
        parent_discovery_target_ids:[],
        original_target_types:[],
        proposed_investigation_types:[],
        validation_requirements:[],
        source_lineage:[]
      });
    }

    const g=groups.get(key);

    g.source_candidate_ids.push(c.decomposition_candidate_id);
    g.parent_acquisition_plan_ids.push(c.parent_acquisition_plan_id);
    g.parent_discovery_target_ids.push(c.parent_discovery_target_id);
    g.original_target_types.push(c.original_target_type);
    g.proposed_investigation_types.push(
      ...(c.proposed_investigation_types||[])
    );
    g.validation_requirements.push(
      ...(c.validation_requirements||[])
    );
    g.source_lineage.push(c.lineage||{});
  }

  const validation_targets=[...groups.values()]
    .map((g,index)=>({
      validation_target_id:stableId("validation",[
        g.abstract_subject,
        g.candidate_label,
        g.candidate_class
      ]),
      validation_rank:index+1,

      abstract_subject:g.abstract_subject,
      candidate_label:g.candidate_label,
      candidate_class:g.candidate_class,

      epistemic_status:"provisional_candidate",
      validation_status:"not_started",
      executable:false,
      knowledge_status:"not_admitted",

      merged_from_candidate_count:
        uniq(g.source_candidate_ids).length,

      source_candidate_ids:
        uniq(g.source_candidate_ids),

      parent_acquisition_plan_ids:
        uniq(g.parent_acquisition_plan_ids),

      parent_discovery_target_ids:
        uniq(g.parent_discovery_target_ids),

      original_target_types:
        uniq(g.original_target_types),

      proposed_investigation_types:
        uniq(g.proposed_investigation_types),

      validation_objective:
        `Determine whether "${g.candidate_label}" materially instantiates or enables "${g.abstract_subject}" in the relevant consequence path.`,

      validation_requirements:
        uniq(g.validation_requirements),

      evidence_contract:{
        minimum_independent_sources:1,
        preferred_source_characteristic:"primary_or_authoritative_where_available",
        contradiction_capture_required:true,
        provenance_required:true,
        source_date_required:true,
        relationship_direction_required_where_applicable:true,
        disposition_options:[
          "supported",
          "partially_supported",
          "contradicted",
          "insufficient_evidence"
        ]
      },

      post_validation_fanout:{
        if_supported:
          uniq(g.original_target_types),
        if_partially_supported:
          uniq(g.original_target_types),
        if_contradicted:[],
        if_insufficient_evidence:[]
      },

      lineage:{
        source_candidate_ids:
          uniq(g.source_candidate_ids),
        acquisition_plan_ids:
          uniq(g.parent_acquisition_plan_ids),
        discovery_target_ids:
          uniq(g.parent_discovery_target_ids),
        source_lineage:g.source_lineage
      }
    }));

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"candidate_validation_targets_resolved",

    source_decomposition:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    validation_state:{
      raw_candidate_count:candidates.length,
      unique_validation_target_count:validation_targets.length,
      duplicate_candidate_count:
        Math.max(0,candidates.length-validation_targets.length),
      validated_target_count:0,
      executable_target_count:0,
      external_execution_connected:false,
      conceptual_distance_limit:
        raw.decomposition_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.decomposition_state?.continuation_possible===true,
      principle:
        "A repeated semantic candidate should be validated once, with all parent investigation intents and lineage preserved."
    },

    validation_targets,

    future_evidence_queue:validation_targets.map((t,index)=>({
      evidence_rank:index+1,
      validation_target_id:t.validation_target_id,
      abstract_subject:t.abstract_subject,
      candidate_label:t.candidate_label,
      candidate_class:t.candidate_class,
      validation_objective:t.validation_objective,
      validation_requirements:t.validation_requirements,
      evidence_contract:t.evidence_contract,
      proposed_investigation_types:t.proposed_investigation_types,
      execution_status:"not_connected",
      validation_status:"not_started"
    })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      validates_candidates:false,
      invents_evidence:false,
      writes_to_knowledge_graph:false,
      promotes_candidates_to_facts:false,
      duplicate_semantic_candidates_consolidated:true,
      parent_lineage_preserved:true,
      investigation_intents_preserved:true,
      evidence_required_before_validation:true,
      validation_required_before_execution:true,
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
      "Usage: node scripts/cosmos_candidate_validation.cjs --input <decomposition.json> [--out <validation-plans.json>]"
    );
  }

  const output=consolidate(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Candidate Validation Planner output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  consolidate,
  normalizeKey
};
