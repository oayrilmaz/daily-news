#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Evidence Validator v0.1
 *
 * Purpose:
 * Evaluate collected evidence for each validation target and determine what
 * Cosmos is justified in believing, WITHOUT admitting anything to permanent
 * knowledge.
 *
 * Evidence Executor:
 *   "Here are normalized evidence records."
 *
 * Evidence Validator:
 *   "Given authority, directness, independence, corroboration, contradiction,
 *    scope, and sufficiency, what conclusion is justified?"
 *
 * IMPORTANT:
 * - no external search
 * - no OpenAI/API calls
 * - no knowledge-graph writes
 * - no automatic knowledge admission
 * - no candidate promotion beyond validation output
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
  if(!raw || raw.status!=="evidence_execution_normalized"){
    throw new Error(
      `Cosmos Evidence Validator requires evidence_execution_normalized input; got ${raw?.status}`
    );
  }

  return {
    source:raw,
    records:Array.isArray(raw.evidence_records)?raw.evidence_records:[],
    taskExecution:Array.isArray(raw.task_execution)?raw.task_execution:[],
    validationQueue:Array.isArray(raw.validation_queue)?raw.validation_queue:[]
  };
}

function weightRecord(record){
  const authority = Number.isFinite(Number(record.authority_score))
    ? Number(record.authority_score)
    : 50;

  const directnessFactor = {
    direct: 1.0,
    indirect: 0.75,
    contextual: 0.45,
    unknown: 0.35
  }[record.directness] || 0.35;

  const dispositionFactor = {
    supports: 1.0,
    partially_supports: 0.55,
    contradicts: -1.0,
    context_only: 0.1,
    insufficient: 0
  }[record.supports_or_contradicts] ?? 0;

  const quality = record.record_quality || {};
  const completeness =
    [
      quality.has_source_identity,
      quality.has_extracted_fact,
      quality.has_source_date,
      quality.has_publisher,
      quality.has_independence_group
    ].filter(Boolean).length / 5;

  return {
    authority_score: authority,
    directness_factor: directnessFactor,
    disposition_factor: dispositionFactor,
    completeness_factor: completeness,
    signed_weight:
      authority * directnessFactor * dispositionFactor * completeness
  };
}

function confidenceBand(score){
  if(score >= 85) return "very_high";
  if(score >= 70) return "high";
  if(score >= 50) return "moderate";
  if(score >= 30) return "low";
  return "very_low";
}

function determineDisposition({
  records,
  positiveWeight,
  negativeWeight,
  independentGroups,
  directHighAuthority,
  totalThresholdMet,
  independentThresholdMet
}){
  if(records.length === 0){
    return {
      disposition:"insufficient_evidence",
      confidence_score:0,
      confidence_band:"very_low",
      rationale:"No evidence records were collected for this target."
    };
  }

  const hasSupport = positiveWeight > 0;
  const hasContradiction = negativeWeight > 0;

  if(!totalThresholdMet || !independentThresholdMet){
    const score = Math.min(
      45,
      Math.max(10, positiveWeight - negativeWeight)
    );

    return {
      disposition:"insufficient_evidence",
      confidence_score:Math.round(score),
      confidence_band:confidenceBand(score),
      rationale:
        "Some evidence exists, but the configured source-count or independence thresholds were not met."
    };
  }

  if(hasSupport && hasContradiction){
    const net = positiveWeight - negativeWeight;
    const total = positiveWeight + negativeWeight;
    const dominance = total > 0 ? Math.abs(net) / total : 0;

    if(dominance < 0.35){
      const score = Math.round(
        Math.min(75, 45 + independentGroups * 5 + directHighAuthority * 4)
      );

      return {
        disposition:"partially_supported",
        confidence_score:score,
        confidence_band:confidenceBand(score),
        rationale:
          "Independent evidence supports the candidate, but meaningful contradictory evidence limits a fully supported conclusion."
      };
    }

    if(net > 0){
      const score = Math.round(
        Math.min(90, 60 + dominance * 20 + directHighAuthority * 4)
      );

      return {
        disposition:"partially_supported",
        confidence_score:score,
        confidence_band:confidenceBand(score),
        rationale:
          "Supporting evidence outweighs contradiction, but contradiction remains material and prevents an unqualified supported conclusion."
      };
    }

    const score = Math.round(
      Math.min(90, 60 + dominance * 20 + directHighAuthority * 2)
    );

    return {
      disposition:"contradicted",
      confidence_score:score,
      confidence_band:confidenceBand(score),
      rationale:
        "Contradictory evidence outweighs supporting evidence after weighting for authority, directness, and completeness."
    };
  }

  if(hasSupport){
    const score = Math.round(
      Math.min(
        95,
        55 +
        Math.min(20, independentGroups * 5) +
        Math.min(15, directHighAuthority * 5)
      )
    );

    return {
      disposition:"supported",
      confidence_score:score,
      confidence_band:confidenceBand(score),
      rationale:
        "The candidate is supported by sufficient independent evidence with no material contradiction in the collected record."
    };
  }

  if(hasContradiction){
    const score = Math.round(
      Math.min(
        95,
        55 +
        Math.min(20, independentGroups * 5) +
        Math.min(15, directHighAuthority * 5)
      )
    );

    return {
      disposition:"contradicted",
      confidence_score:score,
      confidence_band:confidenceBand(score),
      rationale:
        "The collected evidence materially contradicts the candidate and no meaningful supporting evidence was retained."
    };
  }

  return {
    disposition:"unresolved",
    confidence_score:20,
    confidence_band:"very_low",
    rationale:
      "Collected records are contextual or insufficient and do not justify support or contradiction."
  };
}

function validateTask(taskRow, records){
  const weighted = records.map(record => ({
    evidence_record_id:record.evidence_record_id,
    supports_or_contradicts:record.supports_or_contradicts,
    directness:record.directness,
    authority_score:record.authority_score,
    independence_group:record.independence_group,
    ...weightRecord(record)
  }));

  const positiveWeight = weighted
    .filter(x => x.signed_weight > 0)
    .reduce((sum,x)=>sum+x.signed_weight,0);

  const negativeWeight = weighted
    .filter(x => x.signed_weight < 0)
    .reduce((sum,x)=>sum+Math.abs(x.signed_weight),0);

  const independentGroups = new Set(
    records.map(r=>clean(r.independence_group)).filter(Boolean)
  ).size;

  const directHighAuthority = records.filter(r=>
    r.directness==="direct" &&
    Number(r.authority_score)>=90
  ).length;

  const sufficiency = taskRow.sufficiency_observation || {};
  const result = determineDisposition({
    records,
    positiveWeight,
    negativeWeight,
    independentGroups,
    directHighAuthority,
    totalThresholdMet:
      sufficiency.total_source_threshold_met === true,
    independentThresholdMet:
      sufficiency.independent_source_threshold_met === true
  });

  return {
    evidence_validation_id:stableId("evidence_validation",[
      taskRow.evidence_task_id,
      taskRow.validation_target_id
    ]),
    evidence_task_id:taskRow.evidence_task_id,
    validation_target_id:taskRow.validation_target_id,

    evidence_record_ids:records.map(r=>r.evidence_record_id),
    evidence_record_count:records.length,

    disposition:result.disposition,
    confidence_score:result.confidence_score,
    confidence_band:result.confidence_band,
    rationale:result.rationale,

    evidence_balance:{
      weighted_support:Math.round(positiveWeight * 100) / 100,
      weighted_contradiction:Math.round(negativeWeight * 100) / 100,
      independent_source_groups:independentGroups,
      direct_high_authority_records:directHighAuthority
    },

    sufficiency_observation:{
      total_source_threshold_met:
        sufficiency.total_source_threshold_met === true,
      independent_source_threshold_met:
        sufficiency.independent_source_threshold_met === true,
      direct_primary_preference_met:
        sufficiency.direct_primary_preference_met === true,
      contradiction_search_observed:
        sufficiency.contradiction_search_observed === true
    },

    record_assessments:weighted,

    validation_status:"completed",
    knowledge_admission_status:"not_started",
    executable_for_knowledge_admission:
      ["supported","partially_supported","contradicted"]
        .includes(result.disposition),

    epistemic_rule:
      "Validation may classify evidence, but only Knowledge Admission may create or update persistent Cosmos knowledge."
  };
}

function runEvidenceValidator(raw){
  const ctx=normalizeInput(raw);

  const recordsByTask=new Map();

  for(const record of ctx.records){
    if(!recordsByTask.has(record.evidence_task_id)){
      recordsByTask.set(record.evidence_task_id,[]);
    }
    recordsByTask.get(record.evidence_task_id).push(record);
  }

  const validations=ctx.taskExecution.map(taskRow=>
    validateTask(
      taskRow,
      recordsByTask.get(taskRow.evidence_task_id) || []
    )
  );

  const byDisposition={};
  for(const v of validations){
    byDisposition[v.disposition]=(byDisposition[v.disposition]||0)+1;
  }

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"evidence_validation_resolved",

    source_evidence_executor:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    validation_state:{
      validation_target_count:validations.length,
      completed_validation_count:validations.length,
      knowledge_admission_count:0,
      by_disposition:byDisposition,
      conceptual_distance_limit:
        raw.execution_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.execution_state?.continuation_possible===true,
      principle:
        "Cosmos may classify what the collected evidence justifies, but validation is not permanent knowledge admission."
    },

    validations,

    knowledge_admission_queue:validations
      .filter(v=>v.executable_for_knowledge_admission===true)
      .map((v,index)=>({
        admission_rank:index+1,
        evidence_validation_id:v.evidence_validation_id,
        evidence_task_id:v.evidence_task_id,
        validation_target_id:v.validation_target_id,
        disposition:v.disposition,
        confidence_score:v.confidence_score,
        confidence_band:v.confidence_band,
        evidence_record_ids:v.evidence_record_ids,
        admission_status:"not_started"
      })),

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_evidence:false,
      preserves_contradictory_evidence:true,
      validation_uses_authority_directness_independence_and_completeness:true,
      validation_does_not_equal_knowledge_admission:true,
      writes_to_knowledge_graph:false,
      promotes_candidates_to_facts:false,
      unresolved_or_insufficient_targets_not_admission_eligible:true,
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
      "Usage: node scripts/cosmos_evidence_validator.cjs --input <evidence-executor.json> [--out <evidence-validation.json>]"
    );
  }

  const output=runEvidenceValidator(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Evidence Validator output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runEvidenceValidator,
  validateTask,
  weightRecord,
  determineDisposition
};
