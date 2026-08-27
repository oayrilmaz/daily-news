#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Graph Evolution v0.1
 *
 * Purpose:
 * Compare newly admitted knowledge against the current Cosmos graph and decide
 * how knowledge should evolve without directly mutating the graph.
 *
 * Possible evolution actions:
 * - create_new
 * - reinforce_existing
 * - qualify_existing
 * - supersede_existing
 * - conflict_review_required
 * - no_action
 *
 * IMPORTANT:
 * - read-only planning layer
 * - no graph mutation
 * - preserves history
 * - never deletes older knowledge
 * - never silently resolves contradiction
 * - stronger/newer knowledge may supersede, but only through an explicit plan
 */

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
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

function clone(v){
  return JSON.parse(JSON.stringify(v));
}

function normalizeGraph(raw){
  if(!raw || raw.status!=="cosmos_graph_snapshot"){
    throw new Error(
      `Cosmos Graph Evolution requires cosmos_graph_snapshot input; got ${raw?.status}`
    );
  }

  return {
    schema_version:raw.schema_version||null,
    generated_at:raw.generated_at||null,
    status:raw.status,
    knowledge_records:Array.isArray(raw.knowledge_records)
      ?clone(raw.knowledge_records):[],
    audit_log:Array.isArray(raw.audit_log)
      ?clone(raw.audit_log):[]
  };
}

function normalizeAdmission(raw){
  if(!raw || raw.status!=="knowledge_admission_resolved"){
    throw new Error(
      `Cosmos Graph Evolution requires knowledge_admission_resolved input; got ${raw?.status}`
    );
  }

  return {
    source:raw,
    admissions:Array.isArray(raw.admissions)?clone(raw.admissions):[],
    graph_write_queue:Array.isArray(raw.graph_write_queue)
      ?clone(raw.graph_write_queue):[]
  };
}

function confidence(v){
  const n=Number(v);
  return Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;
}

function sameEvidenceSet(a,b){
  const aa=[...(a||[])].filter(Boolean).sort();
  const bb=[...(b||[])].filter(Boolean).sort();
  return JSON.stringify(aa)===JSON.stringify(bb);
}

function sameKnowledgeMeaning(existing,incoming){
  return (
    clean(existing.validation_target_id) === clean(incoming.validation_target_id) &&
    clean(existing.validation_disposition) === clean(incoming.validation_disposition) &&
    clean(existing.claim_class) === clean(incoming.admitted_claim_class)
  );
}

function dispositionPolarity(disposition){
  const d=clean(disposition);
  if(["supported","partially_supported"].includes(d)) return "positive";
  if(d==="contradicted") return "negative";
  return "unresolved";
}

function decideEvolution(existingRows,incoming){
  const active=existingRows.filter(row=>row.active===true);

  if(active.length===0){
    return {
      action:"create_new",
      reason:"No active knowledge exists for this validation target."
    };
  }

  if(active.length>1){
    const polarities=new Set(
      active.map(row=>dispositionPolarity(row.validation_disposition))
    );

    return {
      action:"conflict_review_required",
      reason:
        polarities.size>1
          ?"Multiple active records with competing polarity already exist for this target."
          :"Multiple active records already exist for this target and require consolidation before evolution."
    };
  }

  const current=active[0];
  const currentPolarity=dispositionPolarity(current.validation_disposition);
  const incomingPolarity=dispositionPolarity(incoming.validation_disposition);

  if(currentPolarity!==incomingPolarity &&
     currentPolarity!=="unresolved" &&
     incomingPolarity!=="unresolved"){
    return {
      action:"conflict_review_required",
      reason:
        "Incoming admitted knowledge conflicts with the polarity of the current active record."
    };
  }

  if(sameKnowledgeMeaning(current,incoming)){
    const currentConfidence=confidence(current.confidence_score);
    const incomingConfidence=confidence(incoming.confidence_score);

    const contradictionStrengthened =
      incoming.qualification?.contradiction_present===true &&
      current.qualification?.contradiction_present!==true;

    if(contradictionStrengthened){
      return {
        action:"qualify_existing",
        reason:
          "Incoming knowledge preserves the same core relationship but introduces a material contradiction qualification."
      };
    }

    if(incomingConfidence >= currentConfidence + 8){
      return {
        action:"reinforce_existing",
        reason:
          "Incoming admitted knowledge supports the same relationship with materially stronger confidence."
      };
    }

    if(!sameEvidenceSet(
      current.evidence_record_ids,
      incoming.evidence_record_ids
    )){
      return {
        action:"reinforce_existing",
        reason:
          "Incoming admitted knowledge supports the same relationship with additional evidence lineage."
      };
    }

    return {
      action:"no_action",
      reason:
        "Incoming knowledge is materially equivalent to the current active graph record."
    };
  }

  if(incomingPolarity===currentPolarity &&
     confidence(incoming.confidence_score) >=
       confidence(current.confidence_score)){
    return {
      action:"supersede_existing",
      reason:
        "Incoming admitted knowledge represents a materially different but stronger current formulation of the same target."
    };
  }

  return {
    action:"conflict_review_required",
    reason:
      "Incoming knowledge differs materially from the active record without sufficient basis for automatic supersession."
  };
}

function buildEvolutionPlan(graph,admission){
  const eligibleAdmissionIds=new Set(
    admission.graph_write_queue
      .map(row=>row.knowledge_admission_id)
      .filter(Boolean)
  );

  const plans=[];

  for(const incoming of admission.admissions){
    if(!eligibleAdmissionIds.has(incoming.knowledge_admission_id)) continue;
    if(incoming.graph_write_eligibility!==true) continue;

    const existingRows=graph.knowledge_records.filter(
      row=>clean(row.validation_target_id)===
        clean(incoming.validation_target_id)
    );

    const decision=decideEvolution(existingRows,incoming);

    const activeExisting=existingRows.filter(row=>row.active===true);

    plans.push({
      graph_evolution_id:stableId("graph_evolution",[
        incoming.knowledge_admission_id,
        incoming.validation_target_id,
        decision.action
      ]),

      knowledge_admission_id:incoming.knowledge_admission_id,
      evidence_validation_id:incoming.evidence_validation_id,
      validation_target_id:incoming.validation_target_id,

      incoming:{
        decision:incoming.decision,
        admitted_claim_class:incoming.admitted_claim_class,
        validation_disposition:incoming.validation_disposition,
        confidence_score:incoming.confidence_score,
        confidence_band:incoming.confidence_band,
        persistence_level:incoming.persistence_level,
        evidence_record_ids:incoming.evidence_record_ids||[],
        contradiction_present:
          incoming.qualification?.contradiction_present===true
      },

      current_active_records:activeExisting.map(row=>({
        graph_record_id:row.graph_record_id,
        knowledge_admission_id:row.knowledge_admission_id,
        validation_disposition:row.validation_disposition,
        confidence_score:row.confidence_score,
        confidence_band:row.confidence_band,
        claim_class:row.claim_class,
        epistemic_status:row.epistemic_status,
        evidence_record_ids:row.evidence_record_ids||[],
        contradiction_present:
          row.qualification?.contradiction_present===true,
        admitted_at:row.admitted_at||null
      })),

      evolution_action:decision.action,
      reason:decision.reason,

      execution_contract:{
        graph_mutation_performed:false,
        requires_separate_evolution_executor:
          decision.action!=="no_action",
        deactivate_prior_record_before_supersession:
          decision.action==="supersede_existing",
        preserve_prior_record_history:true,
        preserve_prior_audit_history:true,
        append_new_audit_required:
          decision.action!=="no_action",
        conflict_must_not_be_auto_resolved:
          decision.action==="conflict_review_required",
        reversible:true
      },

      execution_status:"not_started"
    });
  }

  return plans;
}

function runGraphEvolution(graphRaw,admissionRaw){
  const graph=normalizeGraph(graphRaw);
  const admission=normalizeAdmission(admissionRaw);
  const plans=buildEvolutionPlan(graph,admission);

  const byAction={};
  for(const row of plans){
    byAction[row.evolution_action]=(byAction[row.evolution_action]||0)+1;
  }

  const executableQueue=plans
    .filter(row=>[
      "create_new",
      "reinforce_existing",
      "qualify_existing",
      "supersede_existing"
    ].includes(row.evolution_action))
    .map((row,index)=>({
      evolution_rank:index+1,
      graph_evolution_id:row.graph_evolution_id,
      knowledge_admission_id:row.knowledge_admission_id,
      validation_target_id:row.validation_target_id,
      evolution_action:row.evolution_action,
      execution_status:"not_started"
    }));

  const conflictQueue=plans
    .filter(row=>row.evolution_action==="conflict_review_required")
    .map((row,index)=>({
      conflict_rank:index+1,
      graph_evolution_id:row.graph_evolution_id,
      knowledge_admission_id:row.knowledge_admission_id,
      validation_target_id:row.validation_target_id,
      reason:row.reason,
      review_status:"not_started"
    }));

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"graph_evolution_planned",

    source_graph:{
      schema_version:graph.schema_version,
      generated_at:graph.generated_at,
      status:graph.status,
      knowledge_record_count:graph.knowledge_records.length
    },

    source_knowledge_admission:{
      schema_version:admissionRaw.schema_version||null,
      generated_at:admissionRaw.generated_at||null,
      status:admissionRaw.status||null
    },

    evolution_state:{
      planned_count:plans.length,
      executable_count:executableQueue.length,
      conflict_review_count:conflictQueue.length,
      graph_mutation_count:0,
      by_action:byAction,
      principle:
        "New knowledge may reinforce, qualify, supersede or conflict with existing knowledge, but graph evolution must preserve history and never silently resolve contradiction."
    },

    evolution_plans:plans,
    evolution_execution_queue:executableQueue,
    conflict_review_queue:conflictQueue,

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      mutates_graph:false,
      deletes_historical_knowledge:false,
      preserves_existing_records:true,
      preserves_audit_history:true,
      conflicting_polarity_requires_review:true,
      materially_equivalent_knowledge_not_duplicated:true,
      supersession_requires_explicit_execution:true,
      reversibility_required:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--graph"&&args[i+1]) out.graph_file=args[++i];
    else if(args[i]==="--admission"&&args[i+1]) out.admission_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.graph_file ||
     !options.admission_file){
    throw new Error(
      "Usage: node scripts/cosmos_graph_evolution.cjs --graph <graph-snapshot.json> --admission <knowledge-admission.json> [--out <graph-evolution-plan.json>]"
    );
  }

  const output=runGraphEvolution(
    readJson(options.graph_file),
    readJson(options.admission_file)
  );

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Graph Evolution output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runGraphEvolution,
  buildEvolutionPlan,
  decideEvolution,
  dispositionPolarity,
  sameKnowledgeMeaning
};
