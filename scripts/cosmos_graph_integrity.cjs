#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Graph Integrity v0.1
 *
 * Purpose:
 * Inspect a Cosmos graph snapshot before production persistence is enabled.
 *
 * Detects:
 * - duplicate admission materialization
 * - duplicate graph IDs / audit IDs
 * - broken evidence lineage
 * - missing audit lineage
 * - qualification / contradiction loss
 * - confidence loss or invalid confidence
 * - invalid reversibility contracts
 * - conflicting active records for the same validation target
 * - temporal ordering anomalies
 * - orphan audit records
 *
 * This layer is READ-ONLY. It never repairs or mutates the graph.
 */

const fs = require("fs");

function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a || []).filter(Boolean))]; }

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function pushIssue(issues,severity,code,message,refs={}){
  issues.push({severity,code,message,...refs});
}

function inspectGraph(raw){
  const records=Array.isArray(raw?.knowledge_records)?raw.knowledge_records:[];
  const audits=Array.isArray(raw?.audit_log)?raw.audit_log:[];
  const issues=[];

  if(raw?.status!=="cosmos_graph_snapshot"){
    pushIssue(
      issues,"error","BAD_GRAPH_STATUS",
      `Expected cosmos_graph_snapshot; got ${raw?.status ?? "missing"}`
    );
  }

  const graphIds=new Map();
  const admissionIds=new Map();
  const auditIds=new Map();

  for(const record of records){
    if(!clean(record.graph_record_id)){
      pushIssue(issues,"error","MISSING_GRAPH_RECORD_ID",
        "Knowledge record is missing graph_record_id.");
    }else{
      const id=record.graph_record_id;
      if(graphIds.has(id)){
        pushIssue(issues,"error","DUPLICATE_GRAPH_RECORD_ID",
          `Duplicate graph_record_id ${id}.`,
          {graph_record_id:id});
      }
      graphIds.set(id,record);
    }

    if(!clean(record.knowledge_admission_id)){
      pushIssue(issues,"error","MISSING_KNOWLEDGE_ADMISSION_ID",
        "Knowledge record is missing knowledge_admission_id.",
        {graph_record_id:record.graph_record_id||null});
    }else{
      const id=record.knowledge_admission_id;
      if(admissionIds.has(id)){
        pushIssue(issues,"error","DUPLICATE_ADMISSION_MATERIALIZATION",
          `Knowledge admission ${id} was materialized more than once.`,
          {knowledge_admission_id:id});
      }
      admissionIds.set(id,record);
    }

    const confidence=Number(record.confidence_score);
    if(!Number.isFinite(confidence) || confidence<0 || confidence>100){
      pushIssue(issues,"error","INVALID_CONFIDENCE",
        `Graph record ${record.graph_record_id} has invalid confidence_score.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(!clean(record.confidence_band)){
      pushIssue(issues,"error","MISSING_CONFIDENCE_BAND",
        `Graph record ${record.graph_record_id} lost confidence_band.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(!Array.isArray(record.evidence_record_ids) ||
       record.evidence_record_ids.length===0){
      pushIssue(issues,"error","BROKEN_EVIDENCE_LINEAGE",
        `Graph record ${record.graph_record_id} has no evidence_record_ids.`,
        {graph_record_id:record.graph_record_id||null});
    }else if(uniq(record.evidence_record_ids).length !==
             record.evidence_record_ids.length){
      pushIssue(issues,"warning","DUPLICATE_EVIDENCE_LINEAGE",
        `Graph record ${record.graph_record_id} repeats evidence_record_ids.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(record.validation_disposition==="partially_supported"){
      if(record.qualification?.contradiction_present!==true ||
         record.qualification?.must_preserve_contradiction!==true){
        pushIssue(issues,"error","QUALIFICATION_LOSS",
          `Partially supported graph record ${record.graph_record_id} lost its contradiction qualification.`,
          {graph_record_id:record.graph_record_id||null});
      }

      if(record.epistemic_status!=="persistent_qualified_knowledge"){
        pushIssue(issues,"error","BAD_EPISTEMIC_STATUS",
          `Partially supported graph record ${record.graph_record_id} is not persistent_qualified_knowledge.`,
          {graph_record_id:record.graph_record_id||null});
      }
    }

    if(record.qualification?.confidence_preserved!==true ||
       record.qualification?.source_lineage_preserved!==true ||
       record.qualification?.temporal_scope_preserved!==true ||
       record.qualification?.geography_scope_preserved!==true){
      pushIssue(issues,"error","PRESERVATION_CONTRACT_BROKEN",
        `Graph record ${record.graph_record_id} lost required preservation metadata.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(record.reversibility?.reversible!==true ||
       record.reversibility?.reversal_operation!=="deactivate_graph_record" ||
       !clean(record.reversibility?.reversal_key)){
      pushIssue(issues,"error","INVALID_REVERSIBILITY_CONTRACT",
        `Graph record ${record.graph_record_id} is not safely reversible.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(record.active!==true && record.active!==false){
      pushIssue(issues,"error","INVALID_ACTIVE_STATE",
        `Graph record ${record.graph_record_id} has invalid active state.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(!clean(record.validation_target_id)){
      pushIssue(issues,"error","MISSING_VALIDATION_TARGET",
        `Graph record ${record.graph_record_id} has no validation_target_id.`,
        {graph_record_id:record.graph_record_id||null});
    }

    if(!clean(record.admitted_at) ||
       Number.isNaN(Date.parse(record.admitted_at))){
      pushIssue(issues,"error","INVALID_ADMITTED_AT",
        `Graph record ${record.graph_record_id} has invalid admitted_at.`,
        {graph_record_id:record.graph_record_id||null});
    }
  }

  for(const audit of audits){
    if(!clean(audit.audit_id)){
      pushIssue(issues,"error","MISSING_AUDIT_ID",
        "Audit record is missing audit_id.");
    }else{
      const id=audit.audit_id;
      if(auditIds.has(id)){
        pushIssue(issues,"error","DUPLICATE_AUDIT_ID",
          `Duplicate audit_id ${id}.`,
          {audit_id:id});
      }
      auditIds.set(id,audit);
    }

    if(!clean(audit.graph_record_id) || !graphIds.has(audit.graph_record_id)){
      pushIssue(issues,"error","ORPHAN_AUDIT_RECORD",
        `Audit ${audit.audit_id} references a missing graph record.`,
        {audit_id:audit.audit_id||null,
         graph_record_id:audit.graph_record_id||null});
      continue;
    }

    const record=graphIds.get(audit.graph_record_id);

    if(audit.knowledge_admission_id !== record.knowledge_admission_id){
      pushIssue(issues,"error","AUDIT_ADMISSION_MISMATCH",
        `Audit ${audit.audit_id} knowledge admission does not match its graph record.`,
        {audit_id:audit.audit_id,
         graph_record_id:audit.graph_record_id});
    }

    const auditEvidence=uniq(audit.evidence_record_ids||[]).sort();
    const recordEvidence=uniq(record.evidence_record_ids||[]).sort();

    if(JSON.stringify(auditEvidence)!==JSON.stringify(recordEvidence)){
      pushIssue(issues,"error","AUDIT_EVIDENCE_MISMATCH",
        `Audit ${audit.audit_id} does not preserve the graph record evidence lineage.`,
        {audit_id:audit.audit_id,
         graph_record_id:audit.graph_record_id});
    }

    if(Number(audit.confidence_score)!==Number(record.confidence_score)){
      pushIssue(issues,"error","AUDIT_CONFIDENCE_MISMATCH",
        `Audit ${audit.audit_id} confidence does not match graph record.`,
        {audit_id:audit.audit_id,
         graph_record_id:audit.graph_record_id});
    }

    if(audit.validation_disposition!==record.validation_disposition){
      pushIssue(issues,"error","AUDIT_DISPOSITION_MISMATCH",
        `Audit ${audit.audit_id} disposition does not match graph record.`,
        {audit_id:audit.audit_id,
         graph_record_id:audit.graph_record_id});
    }

    if(audit.reversible!==true ||
       audit.reversal_operation!=="deactivate_graph_record"){
      pushIssue(issues,"error","AUDIT_NOT_REVERSIBLE",
        `Audit ${audit.audit_id} does not preserve reversibility.`,
        {audit_id:audit.audit_id});
    }

    if(!clean(audit.performed_at) ||
       Number.isNaN(Date.parse(audit.performed_at))){
      pushIssue(issues,"error","INVALID_AUDIT_TIME",
        `Audit ${audit.audit_id} has invalid performed_at.`,
        {audit_id:audit.audit_id});
    }else if(clean(record.admitted_at) &&
             !Number.isNaN(Date.parse(record.admitted_at)) &&
             Date.parse(audit.performed_at) < Date.parse(record.admitted_at)){
      pushIssue(issues,"error","AUDIT_PRECEDES_ADMISSION",
        `Audit ${audit.audit_id} predates graph admission.`,
        {audit_id:audit.audit_id,
         graph_record_id:audit.graph_record_id});
    }
  }

  // Every active materialized record must have a creation audit.
  for(const record of records){
    const matching=audits.filter(a=>
      a.graph_record_id===record.graph_record_id &&
      a.operation==="create_graph_record"
    );

    if(matching.length===0){
      pushIssue(issues,"error","MISSING_CREATION_AUDIT",
        `Graph record ${record.graph_record_id} has no create_graph_record audit.`,
        {graph_record_id:record.graph_record_id||null});
    }else if(matching.length>1){
      pushIssue(issues,"error","MULTIPLE_CREATION_AUDITS",
        `Graph record ${record.graph_record_id} has multiple creation audits.`,
        {graph_record_id:record.graph_record_id||null});
    }
  }

  // Detect simultaneous active conclusions for the same validation target.
  const activeByTarget=new Map();
  for(const record of records.filter(r=>r.active===true)){
    const target=clean(record.validation_target_id);
    if(!target) continue;
    if(!activeByTarget.has(target)) activeByTarget.set(target,[]);
    activeByTarget.get(target).push(record);
  }

  for(const [target,rows] of activeByTarget){
    if(rows.length<=1) continue;

    const dispositions=uniq(rows.map(r=>r.validation_disposition));
    const admissionIds=uniq(rows.map(r=>r.knowledge_admission_id));

    if(admissionIds.length>1){
      pushIssue(
        issues,
        dispositions.length>1 ? "error" : "warning",
        dispositions.length>1
          ? "CONFLICTING_ACTIVE_KNOWLEDGE"
          : "MULTIPLE_ACTIVE_RECORDS_SAME_TARGET",
        `Validation target ${target} has ${rows.length} active graph records.`,
        {
          validation_target_id:target,
          graph_record_ids:rows.map(r=>r.graph_record_id),
          validation_dispositions:dispositions
        }
      );
    }
  }

  const errorCount=issues.filter(x=>x.severity==="error").length;
  const warningCount=issues.filter(x=>x.severity==="warning").length;

  return {
    schema_version:"0.1",
    generated_at:new Date().toISOString(),
    status:errorCount===0 ? "graph_integrity_passed" : "graph_integrity_failed",

    graph_state:{
      knowledge_record_count:records.length,
      active_record_count:records.filter(x=>x.active===true).length,
      inactive_record_count:records.filter(x=>x.active===false).length,
      audit_record_count:audits.length,
      unique_admission_count:admissionIds.size,
      unique_validation_target_count:
        new Set(records.map(x=>clean(x.validation_target_id)).filter(Boolean)).size
    },

    integrity_state:{
      error_count:errorCount,
      warning_count:warningCount,
      issue_count:issues.length,
      production_write_safe:errorCount===0
    },

    issues,

    safeguards:{
      read_only:true,
      mutates_graph:false,
      auto_repairs_graph:false,
      checks_duplicate_materialization:true,
      checks_broken_lineage:true,
      checks_qualification_loss:true,
      checks_confidence_integrity:true,
      checks_audit_integrity:true,
      checks_reversibility:true,
      checks_active_conflicts:true,
      checks_temporal_ordering:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--graph"&&args[i+1]) out.graph_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.graph_file){
    throw new Error(
      "Usage: node scripts/cosmos_graph_integrity.cjs --graph <graph-snapshot.json> [--out <integrity-report.json>]"
    );
  }

  const result=inspectGraph(readJson(options.graph_file));

  if(options.output_file){
    fs.mkdirSync(require("path").dirname(options.output_file),{recursive:true});
    fs.writeFileSync(
      options.output_file,
      JSON.stringify(result,null,2),
      "utf8"
    );
    console.log(
      `Cosmos Graph Integrity output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }

  if(result.status!=="graph_integrity_passed"){
    process.exitCode=2;
  }
}

if(require.main===module) main();

module.exports={inspectGraph};
