#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Knowledge Admission v0.1
 *
 * Purpose:
 * Review Evidence Validator outputs and decide what may enter persistent Cosmos
 * knowledge, under explicit admission rules and without directly mutating the
 * knowledge graph.
 *
 * Evidence Validator:
 *   "What does the evidence justify?"
 *
 * Knowledge Admission:
 *   "Is this validation strong and bounded enough to become persistent
 *    knowledge, and in what form?"
 *
 * IMPORTANT:
 * - no external search
 * - no OpenAI/API calls
 * - no direct graph mutation
 * - no silent candidate promotion
 * - admission decisions preserve contradiction, confidence and lineage
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

function normalizeInput(raw){
  if(!raw || raw.status!=="evidence_validation_resolved"){
    throw new Error(
      `Cosmos Knowledge Admission requires evidence_validation_resolved input; got ${raw?.status}`
    );
  }

  return {
    source:raw,
    validations:Array.isArray(raw.validations)?raw.validations:[],
    queue:Array.isArray(raw.knowledge_admission_queue)
      ?raw.knowledge_admission_queue:[]
  };
}

function admissionDecision(validation){
  const disposition=clean(validation.disposition);
  const confidence=Number(validation.confidence_score || 0);
  const evidenceCount=Number(validation.evidence_record_count || 0);
  const independent=Number(
    validation.evidence_balance?.independent_source_groups || 0
  );

  if(disposition==="supported"){
    if(confidence>=70 && evidenceCount>=2 && independent>=2){
      return {
        decision:"admit",
        admitted_claim_class:"validated_supported_relationship",
        persistence_level:"persistent_knowledge",
        reason:
          "Supported by sufficient independent evidence with high enough confidence for persistent admission."
      };
    }

    return {
      decision:"hold",
      admitted_claim_class:null,
      persistence_level:"provisional_memory",
      reason:
        "Supported disposition exists, but confidence or evidence independence is below the persistent-admission threshold."
    };
  }

  if(disposition==="partially_supported"){
    if(confidence>=65 && evidenceCount>=2 && independent>=2){
      return {
        decision:"admit_with_qualification",
        admitted_claim_class:"validated_qualified_relationship",
        persistence_level:"persistent_qualified_knowledge",
        reason:
          "Evidence supports the relationship, but material contradiction requires qualified admission."
      };
    }

    return {
      decision:"hold",
      admitted_claim_class:null,
      persistence_level:"provisional_memory",
      reason:
        "Partially supported evidence is not strong enough for qualified persistent admission."
    };
  }

  if(disposition==="contradicted"){
    if(confidence>=65 && evidenceCount>=2 && independent>=2){
      return {
        decision:"admit_contradiction",
        admitted_claim_class:"validated_negative_relationship",
        persistence_level:"persistent_qualified_knowledge",
        reason:
          "Contradictory evidence is sufficiently strong and independent to admit a negative/limiting relationship."
      };
    }

    return {
      decision:"hold",
      admitted_claim_class:null,
      persistence_level:"provisional_memory",
      reason:
        "Contradiction exists but is not yet strong enough for persistent admission."
    };
  }

  return {
    decision:"reject_for_now",
    admitted_claim_class:null,
    persistence_level:"none",
    reason:
      "Unresolved or insufficient evidence cannot enter persistent Cosmos knowledge."
  };
}

function buildAdmissionRecord(validation,index){
  const decision=admissionDecision(validation);

  const contradictionPresent =
    Number(validation.evidence_balance?.weighted_contradiction || 0) > 0;

  return {
    knowledge_admission_id:stableId("knowledge_admission",[
      validation.evidence_validation_id,
      validation.validation_target_id,
      decision.decision
    ]),
    admission_rank:index+1,

    evidence_validation_id:validation.evidence_validation_id,
    evidence_task_id:validation.evidence_task_id,
    validation_target_id:validation.validation_target_id,

    validation_disposition:validation.disposition,
    confidence_score:validation.confidence_score,
    confidence_band:validation.confidence_band,

    decision:decision.decision,
    admitted_claim_class:decision.admitted_claim_class,
    persistence_level:decision.persistence_level,
    reason:decision.reason,

    qualification:{
      contradiction_present:contradictionPresent,
      must_preserve_contradiction:
        contradictionPresent===true,
      confidence_must_be_preserved:true,
      source_lineage_must_be_preserved:true,
      temporal_scope_must_be_preserved:true,
      geography_scope_must_be_preserved:true
    },

    evidence_record_ids:
      uniq(validation.evidence_record_ids || []),

    knowledge_write_contract:{
      direct_graph_write_performed:false,
      requires_separate_graph_writer:true,
      preserve_validation_disposition:true,
      preserve_confidence:true,
      preserve_evidence_lineage:true,
      preserve_contradiction:true,
      reversible:true
    },

    graph_write_eligibility:
      ["admit","admit_with_qualification","admit_contradiction"]
        .includes(decision.decision),

    graph_write_status:"not_started"
  };
}

function runKnowledgeAdmission(raw){
  const ctx=normalizeInput(raw);

  const queueIds=new Set(
    ctx.queue.map(x=>x.evidence_validation_id).filter(Boolean)
  );

  const reviewed=ctx.validations.map((validation,index)=>
    buildAdmissionRecord(validation,index)
  );

  const graphQueue=reviewed
    .filter(row=>row.graph_write_eligibility===true)
    .map((row,index)=>({
      graph_write_rank:index+1,
      knowledge_admission_id:row.knowledge_admission_id,
      evidence_validation_id:row.evidence_validation_id,
      validation_target_id:row.validation_target_id,
      admitted_claim_class:row.admitted_claim_class,
      validation_disposition:row.validation_disposition,
      confidence_score:row.confidence_score,
      evidence_record_ids:row.evidence_record_ids,
      graph_write_status:"not_started"
    }));

  const counts={};
  for(const row of reviewed){
    counts[row.decision]=(counts[row.decision]||0)+1;
  }

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"knowledge_admission_resolved",

    source_evidence_validator:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    admission_state:{
      validation_count:reviewed.length,
      validator_queue_count:queueIds.size,
      reviewed_count:reviewed.length,
      graph_write_eligible_count:graphQueue.length,
      graph_write_count:0,
      by_decision:counts,
      conceptual_distance_limit:
        raw.validation_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.validation_state?.continuation_possible===true,
      principle:
        "Knowledge Admission may decide what is eligible for persistent knowledge, but only a separate graph writer may mutate Cosmos knowledge."
    },

    admissions:reviewed,
    graph_write_queue:graphQueue,

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      writes_to_knowledge_graph:false,
      admission_is_not_graph_mutation:true,
      insufficient_or_unresolved_not_admitted:true,
      partially_supported_requires_qualification:true,
      contradictory_evidence_preserved:true,
      confidence_preserved:true,
      source_lineage_preserved:true,
      graph_writes_are_reversible:true,
      separate_graph_writer_required:true,
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
      "Usage: node scripts/cosmos_knowledge_admission.cjs --input <evidence-validator.json> [--out <knowledge-admission.json>]"
    );
  }

  const output=runKnowledgeAdmission(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Knowledge Admission output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runKnowledgeAdmission,
  buildAdmissionRecord,
  admissionDecision
};
