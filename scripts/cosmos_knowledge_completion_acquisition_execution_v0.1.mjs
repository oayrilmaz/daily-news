#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arr=v=>Array.isArray(v)?v:[];
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{const p=path.resolve(f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n")};
const sid=(p,...xs)=>p+"_"+crypto.createHash("sha256").update(xs.join("|")).digest("hex").slice(0,16);

export function buildExecutionRequest({pipeline,acquisition}){
  if(pipeline?.status!=="knowledge_completion_acquisition_execution_required" ||
     pipeline?.route!=="applicable_direct_execution" ||
     pipeline?.next_stage!=="acquisition_execution"){
    throw new Error("Pipeline is not on applicable direct-execution route.");
  }
  if(acquisition?.status!=="acquisition_plans_resolved" ||
     acquisition?.acquisition_state?.execution_mode!=="planned_only" ||
     acquisition?.acquisition_state?.external_execution_connected!==false){
    throw new Error("Acquisition source boundary invalid.");
  }

  const plans=new Map(arr(acquisition.acquisition_plans).map(x=>[x.acquisition_plan_id,x]));
  const queue=arr(pipeline.executable_acquisition_queue);
  if(!queue.length) throw new Error("No executable acquisition plans.");

  const requests=queue.map((q,i)=>{
    const p=plans.get(q.acquisition_plan_id);
    if(!p) throw new Error(`Unknown acquisition plan ${q.acquisition_plan_id}.`);
    if(!arr(p.query_templates).length){
      throw new Error(`Acquisition plan ${p.acquisition_plan_id} has no query templates.`);
    }

    const hasSourceStrategy=arr(p.source_strategy).length>0;

    return {
      execution_request_id:sid("kc_exec_req",p.acquisition_plan_id,String(i+1)),
      acquisition_plan_id:p.acquisition_plan_id,
      discovery_target_id:p.discovery_target_id,
      target_type:p.target_type,
      statement:p.statement,
      investigation_intent:p.investigation_intent||null,
      execution_rank:i+1,
      query_templates:p.query_templates,
      source_strategy:p.source_strategy,
      source_strategy_status:hasSourceStrategy?"resolved":"unresolved",
      evidence_contract:p.evidence_contract,
      lineage:p.lineage,
      execution:{
        mode:hasSourceStrategy?"adapter_required":"source_strategy_required",
        executor_status:"not_connected",
        network_execution_performed:false,
        result_count:0
      },
      epistemic_boundary:{
        results_are_observations_not_facts:true,
        candidate_validation_required:true,
        evidence_validation_required:true,
        knowledge_admission_required:true
      }
    };
  });

  const unresolved=requests.filter(x=>x.source_strategy_status==="unresolved");
  const resolved=requests.filter(x=>x.source_strategy_status==="resolved");

  return {
    schema_version:"0.1",
    status:unresolved.length
      ?"knowledge_completion_source_strategy_required"
      :"knowledge_completion_acquisition_execution_planned",
    source_pipeline:{
      schema_version:pipeline.schema_version,
      status:pipeline.status,
      route:pipeline.route
    },
    source_acquisition:{
      schema_version:acquisition.schema_version,
      status:acquisition.status
    },
    execution_state:{
      request_count:requests.length,
      source_strategy_resolved_count:resolved.length,
      source_strategy_unresolved_count:unresolved.length,
      execution_mode:unresolved.length?"source_strategy_required":"adapter_required",
      external_execution_connected:false,
      network_execution_performed:false,
      normalized_observation_count:0,
      candidate_validation_count:0,
      evidence_validation_count:0,
      knowledge_admission_count:0,
      graph_write_count:0
    },
    execution_requests:requests,
    source_strategy_resolution_queue:unresolved.map((r,i)=>({
      resolution_rank:i+1,
      execution_request_id:r.execution_request_id,
      acquisition_plan_id:r.acquisition_plan_id,
      target_type:r.target_type,
      statement:r.statement,
      investigation_intent:r.investigation_intent,
      query_templates:r.query_templates,
      evidence_contract:r.evidence_contract,
      resolution_status:"not_started"
    })),
    future_adapter_queue:resolved.map((r,i)=>({
      execution_rank:i+1,
      execution_request_id:r.execution_request_id,
      acquisition_plan_id:r.acquisition_plan_id,
      executor_status:"not_connected",
      query_templates:r.query_templates,
      source_strategy:r.source_strategy
    })),
    next_stage:unresolved.length
      ?"acquisition_source_strategy_resolver"
      :"external_acquisition_adapter",
    contracts:{
      applicable_plan_consumed:true,
      original_query_templates_preserved:true,
      empty_source_strategy_not_fabricated:true,
      source_strategy_required_before_external_adapter:true,
      adapter_boundary_explicit:true,
      acquisition_results_are_not_knowledge:true,
      validation_required_before_admission:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_source_strategy:false,
      invents_candidates:false,
      invents_evidence:false,
      validates_candidates:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

const pipelineFile=arg("--pipeline");
const acquisitionFile=arg("--acquisition");
const out=arg("--out");
if(pipelineFile&&acquisitionFile&&out){
  const result=buildExecutionRequest({
    pipeline:read(pipelineFile),
    acquisition:read(acquisitionFile)
  });
  write(out,result);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
