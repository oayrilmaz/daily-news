#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Graph Reversal v0.1
 *
 * Purpose:
 * Safely reverse/deactivate a previously materialized Cosmos graph record.
 *
 * Principles:
 * - never delete historical knowledge
 * - never mutate the input graph in place
 * - reversal requires an explicit target
 * - preserve original record + creation audit
 * - append a reversal audit
 * - idempotent: reversing an already inactive record performs no new reversal
 * - output is a new graph snapshot
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
      `Cosmos Graph Reversal requires cosmos_graph_snapshot input; got ${raw?.status}`
    );
  }

  return {
    ...clone(raw),
    knowledge_records:Array.isArray(raw.knowledge_records)
      ?clone(raw.knowledge_records):[],
    audit_log:Array.isArray(raw.audit_log)
      ?clone(raw.audit_log):[]
  };
}

function resolveTarget(graph, request){
  const admissionId=clean(request.knowledge_admission_id);
  const graphRecordId=clean(request.graph_record_id);

  if(!admissionId && !graphRecordId){
    return {
      error:"reversal_request_requires_knowledge_admission_id_or_graph_record_id"
    };
  }

  const matches=graph.knowledge_records.filter(record=>{
    if(graphRecordId && record.graph_record_id===graphRecordId) return true;
    if(admissionId && record.knowledge_admission_id===admissionId) return true;
    return false;
  });

  if(matches.length===0){
    return {error:"reversal_target_not_found"};
  }

  if(matches.length>1){
    return {error:"reversal_target_ambiguous"};
  }

  return {record:matches[0]};
}

function applyReversal(graphRaw, requestRaw){
  const graph=normalizeGraph(graphRaw);
  const request=requestRaw && typeof requestRaw==="object"
    ?requestRaw:{};

  const resolved=resolveTarget(graph,request);

  if(resolved.error){
    return {
      graph,
      result:{
        schema_version:"0.1",
        generated_at:nowIso(),
        status:"graph_reversal_rejected",
        reversal_state:{
          requested_count:1,
          reversed_count:0,
          idempotent_skip_count:0,
          error_count:1
        },
        reversals:[],
        skipped:[],
        errors:[{
          code:resolved.error,
          knowledge_admission_id:
            clean(request.knowledge_admission_id)||null,
          graph_record_id:
            clean(request.graph_record_id)||null
        }],
        safeguards:safeguards()
      }
    };
  }

  const record=resolved.record;

  if(record.reversibility?.reversible!==true ||
     record.reversibility?.reversal_operation!=="deactivate_graph_record"){
    return {
      graph,
      result:{
        schema_version:"0.1",
        generated_at:nowIso(),
        status:"graph_reversal_rejected",
        reversal_state:{
          requested_count:1,
          reversed_count:0,
          idempotent_skip_count:0,
          error_count:1
        },
        reversals:[],
        skipped:[],
        errors:[{
          code:"graph_record_not_reversible",
          knowledge_admission_id:record.knowledge_admission_id,
          graph_record_id:record.graph_record_id
        }],
        safeguards:safeguards()
      }
    };
  }

  if(record.active===false){
    return {
      graph,
      result:{
        schema_version:"0.1",
        generated_at:nowIso(),
        status:"graph_reversal_resolved",
        reversal_state:{
          requested_count:1,
          reversed_count:0,
          idempotent_skip_count:1,
          error_count:0
        },
        reversals:[],
        skipped:[{
          knowledge_admission_id:record.knowledge_admission_id,
          graph_record_id:record.graph_record_id,
          reason:"already_inactive_idempotent_skip"
        }],
        errors:[],
        safeguards:safeguards()
      }
    };
  }

  if(record.active!==true){
    return {
      graph,
      result:{
        schema_version:"0.1",
        generated_at:nowIso(),
        status:"graph_reversal_rejected",
        reversal_state:{
          requested_count:1,
          reversed_count:0,
          idempotent_skip_count:0,
          error_count:1
        },
        reversals:[],
        skipped:[],
        errors:[{
          code:"invalid_graph_record_active_state",
          knowledge_admission_id:record.knowledge_admission_id,
          graph_record_id:record.graph_record_id
        }],
        safeguards:safeguards()
      }
    };
  }

  const reversedAt=nowIso();
  const reason=clean(request.reason)||"explicit_reversal_request";
  const requestedBy=clean(request.requested_by)||"cosmos_controlled_process";

  record.active=false;
  record.deactivated_at=reversedAt;
  record.deactivation={
    reason,
    requested_by:requestedBy,
    operation:"deactivate_graph_record",
    reversible_history_preserved:true
  };

  const audit={
    audit_id:stableId("graph_audit_reversal",[
      record.graph_record_id,
      record.knowledge_admission_id,
      reversedAt
    ]),
    operation:"deactivate_graph_record",
    graph_record_id:record.graph_record_id,
    knowledge_admission_id:record.knowledge_admission_id,
    performed_at:reversedAt,
    reason,
    requested_by:requestedBy,
    prior_active_state:true,
    resulting_active_state:false,
    reversible:true,
    reversal_operation:"deactivate_graph_record",
    preserves_original_record:true,
    preserves_creation_audit:true,
    evidence_record_ids:Array.isArray(record.evidence_record_ids)
      ?[...record.evidence_record_ids]:[],
    validation_disposition:record.validation_disposition,
    confidence_score:record.confidence_score
  };

  graph.audit_log.push(audit);
  graph.generated_at=nowIso();

  return {
    graph,
    result:{
      schema_version:"0.1",
      generated_at:nowIso(),
      status:"graph_reversal_resolved",
      reversal_state:{
        requested_count:1,
        reversed_count:1,
        idempotent_skip_count:0,
        error_count:0,
        active_graph_record_count:
          graph.knowledge_records.filter(x=>x.active===true).length,
        inactive_graph_record_count:
          graph.knowledge_records.filter(x=>x.active===false).length
      },
      reversals:[{
        knowledge_admission_id:record.knowledge_admission_id,
        graph_record_id:record.graph_record_id,
        reversal_audit_id:audit.audit_id,
        status:"deactivated",
        reason
      }],
      skipped:[],
      errors:[],
      safeguards:safeguards()
    }
  };
}

function safeguards(){
  return {
    mutates_input_graph_in_place:false,
    deletes_graph_records:false,
    preserves_historical_record:true,
    preserves_creation_audit:true,
    appends_reversal_audit:true,
    requires_explicit_target:true,
    respects_reversibility_contract:true,
    idempotent_for_inactive_record:true,
    writes_only_explicit_output_snapshot:true
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--graph"&&args[i+1]) out.graph_file=args[++i];
    else if(args[i]==="--request"&&args[i+1]) out.request_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
    else if(args[i]==="--report"&&args[i+1]) out.report_file=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.graph_file ||
     !options.request_file ||
     !options.output_file){
    throw new Error(
      "Usage: node scripts/cosmos_graph_reversal.cjs --graph <graph.json> --request <reversal-request.json> --out <new-graph.json> [--report <reversal-report.json>]"
    );
  }

  const graphRaw=readJson(options.graph_file);
  const requestRaw=readJson(options.request_file);

  const {graph,result}=applyReversal(graphRaw,requestRaw);

  writeJson(options.output_file,graph);

  if(options.report_file){
    writeJson(options.report_file,result);
  }else{
    process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }

  if(result.status==="graph_reversal_rejected"){
    process.exitCode=2;
  }
}

if(require.main===module) main();

module.exports={
  applyReversal,
  normalizeGraph,
  resolveTarget
};
