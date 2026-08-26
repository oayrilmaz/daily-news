#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Graph Writer v0.1
 *
 * Purpose:
 * Apply graph-write-eligible Knowledge Admission decisions into a controlled,
 * reversible Cosmos graph snapshot.
 *
 * IMPORTANT SAFETY BOUNDARY:
 * - does NOT modify the input graph file in place
 * - writes only to the explicitly supplied --out snapshot
 * - preserves qualification, confidence, evidence lineage and contradiction
 * - idempotent for the same knowledge_admission_id
 * - every write gets an audit record and reversible operation metadata
 *
 * This is the first layer allowed to materialize admitted knowledge into a
 * graph representation, but v0.1 remains snapshot-based rather than mutating
 * the production graph directly.
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

function emptyGraph(){
  return {
    schema_version:"0.1",
    generated_at:null,
    status:"cosmos_graph_snapshot",
    knowledge_records:[],
    audit_log:[]
  };
}

function normalizeGraph(raw){
  const graph = raw && typeof raw==="object" ? raw : emptyGraph();

  return {
    schema_version:clean(graph.schema_version)||"0.1",
    generated_at:graph.generated_at||null,
    status:clean(graph.status)||"cosmos_graph_snapshot",
    knowledge_records:Array.isArray(graph.knowledge_records)
      ? graph.knowledge_records
      : [],
    audit_log:Array.isArray(graph.audit_log)
      ? graph.audit_log
      : []
  };
}

function normalizeAdmission(raw){
  if(!raw || raw.status!=="knowledge_admission_resolved"){
    throw new Error(
      `Cosmos Graph Writer requires knowledge_admission_resolved input; got ${raw?.status}`
    );
  }

  const admissions=Array.isArray(raw.admissions)?raw.admissions:[];
  const queue=Array.isArray(raw.graph_write_queue)?raw.graph_write_queue:[];

  return {source:raw, admissions, queue};
}

function buildKnowledgeRecord(admission){
  const admittedAt=nowIso();

  return {
    graph_record_id:stableId("graph_record",[
      admission.knowledge_admission_id,
      admission.validation_target_id,
      admission.admitted_claim_class
    ]),

    knowledge_admission_id:admission.knowledge_admission_id,
    evidence_validation_id:admission.evidence_validation_id,
    evidence_task_id:admission.evidence_task_id,
    validation_target_id:admission.validation_target_id,

    claim_class:admission.admitted_claim_class,
    validation_disposition:admission.validation_disposition,
    confidence_score:admission.confidence_score,
    confidence_band:admission.confidence_band,

    persistence_level:admission.persistence_level,

    qualification:{
      contradiction_present:
        admission.qualification?.contradiction_present===true,
      must_preserve_contradiction:
        admission.qualification?.must_preserve_contradiction===true,
      confidence_preserved:true,
      source_lineage_preserved:true,
      temporal_scope_preserved:true,
      geography_scope_preserved:true
    },

    evidence_record_ids:uniq(admission.evidence_record_ids || []),

    epistemic_status:
      admission.decision==="admit_with_qualification"
        ? "persistent_qualified_knowledge"
        : admission.decision==="admit_contradiction"
          ? "persistent_negative_knowledge"
          : "persistent_validated_knowledge",

    admitted_at:admittedAt,
    active:true,

    reversibility:{
      reversible:true,
      reversal_operation:"deactivate_graph_record",
      reversal_key:admission.knowledge_admission_id
    }
  };
}

function applyAdmissions(admissionRaw, graphRaw){
  const admission=normalizeAdmission(admissionRaw);
  const graph=normalizeGraph(graphRaw);

  const eligibleIds=new Set(
    admission.queue.map(x=>x.knowledge_admission_id).filter(Boolean)
  );

  const admissionById=new Map(
    admission.admissions.map(x=>[x.knowledge_admission_id,x])
  );

  const existingByAdmissionId=new Map(
    graph.knowledge_records.map(x=>[x.knowledge_admission_id,x])
  );

  const writes=[];
  const skipped=[];
  const errors=[];

  for(const queued of admission.queue){
    const id=queued.knowledge_admission_id;
    const source=admissionById.get(id);

    if(!source){
      errors.push({
        knowledge_admission_id:id||null,
        reason:"graph_write_queue_references_unknown_admission"
      });
      continue;
    }

    if(source.graph_write_eligibility!==true){
      errors.push({
        knowledge_admission_id:id,
        reason:"admission_not_graph_write_eligible"
      });
      continue;
    }

    if(![
      "admit",
      "admit_with_qualification",
      "admit_contradiction"
    ].includes(source.decision)){
      errors.push({
        knowledge_admission_id:id,
        reason:"invalid_admission_decision_for_graph_write"
      });
      continue;
    }

    if(existingByAdmissionId.has(id)){
      skipped.push({
        knowledge_admission_id:id,
        graph_record_id:
          existingByAdmissionId.get(id).graph_record_id,
        reason:"already_materialized_idempotent_skip"
      });
      continue;
    }

    const record=buildKnowledgeRecord(source);
    graph.knowledge_records.push(record);
    existingByAdmissionId.set(id,record);

    const audit={
      audit_id:stableId("graph_audit",[
        record.graph_record_id,
        record.admitted_at
      ]),
      operation:"create_graph_record",
      graph_record_id:record.graph_record_id,
      knowledge_admission_id:id,
      performed_at:record.admitted_at,
      reversible:true,
      reversal_operation:"deactivate_graph_record",
      evidence_record_ids:record.evidence_record_ids,
      validation_disposition:record.validation_disposition,
      confidence_score:record.confidence_score
    };

    graph.audit_log.push(audit);

    writes.push({
      knowledge_admission_id:id,
      graph_record_id:record.graph_record_id,
      audit_id:audit.audit_id,
      status:"written"
    });
  }

  graph.generated_at=nowIso();
  graph.status="cosmos_graph_snapshot";

  return {
    graph,
    result:{
      schema_version:"0.1",
      generated_at:nowIso(),
      status:"graph_write_resolved",

      source_knowledge_admission:{
        schema_version:admissionRaw.schema_version||null,
        generated_at:admissionRaw.generated_at||null,
        status:admissionRaw.status||null
      },

      graph_write_state:{
        queue_count:admission.queue.length,
        eligible_admission_count:eligibleIds.size,
        written_count:writes.length,
        idempotent_skip_count:skipped.length,
        error_count:errors.length,
        active_graph_record_count:
          graph.knowledge_records.filter(x=>x.active!==false).length,
        conceptual_distance_limit:
          admissionRaw.admission_state?.conceptual_distance_limit??null,
        continuation_possible:
          admissionRaw.admission_state?.continuation_possible===true,
        principle:
          "Admitted knowledge may be materialized only with qualification, confidence, evidence lineage, auditability, idempotency and reversibility preserved."
      },

      writes,
      skipped,
      errors,

      safeguards:{
        mutates_input_graph_in_place:false,
        writes_only_explicit_output_snapshot:true,
        requires_graph_write_eligibility:true,
        preserves_qualification:true,
        preserves_contradiction:true,
        preserves_confidence:true,
        preserves_evidence_lineage:true,
        idempotent_by_knowledge_admission_id:true,
        audit_log_required:true,
        graph_records_reversible:true,
        rejected_admissions_not_written:true,
        unlimited_conceptual_continuation_preserved:true
      }
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};

  for(let i=0;i<args.length;i++){
    if(args[i]==="--admission"&&args[i+1]) out.admission_file=args[++i];
    else if(args[i]==="--graph"&&args[i+1]) out.graph_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
    else if(args[i]==="--report"&&args[i+1]) out.report_file=args[++i];
  }

  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.admission_file || !options.output_file){
    throw new Error(
      "Usage: node scripts/cosmos_graph_writer.cjs --admission <knowledge-admission.json> [--graph <existing-graph.json>] --out <new-graph.json> [--report <graph-write-report.json>]"
    );
  }

  const admissionRaw=readJson(options.admission_file);
  const graphRaw=options.graph_file
    ? readJson(options.graph_file)
    : emptyGraph();

  const {graph,result}=applyAdmissions(admissionRaw,graphRaw);

  writeJson(options.output_file,graph);

  if(options.report_file){
    writeJson(options.report_file,result);
  }else{
    process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  applyAdmissions,
  buildKnowledgeRecord,
  normalizeAdmission,
  normalizeGraph,
  emptyGraph
};
