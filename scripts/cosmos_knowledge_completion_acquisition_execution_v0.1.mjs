#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arr=v=>Array.isArray(v)?v:[];
const txt=v=>typeof v==="string"?v.trim():"";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{const p=path.resolve(f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n")};
const sid=(p,...xs)=>p+"_"+crypto.createHash("sha256").update(xs.join("|")).digest("hex").slice(0,16);

export function buildExecutionRequest({pipeline,acquisition}){
  if(pipeline?.status!=="knowledge_completion_acquisition_execution_required" ||
     pipeline?.route!=="applicable_direct_execution" ||
     pipeline?.next_stage!=="acquisition_execution") throw new Error("Pipeline is not on applicable direct-execution route.");
  if(acquisition?.status!=="acquisition_plans_resolved" ||
     acquisition?.acquisition_state?.execution_mode!=="planned_only" ||
     acquisition?.acquisition_state?.external_execution_connected!==false) throw new Error("Acquisition source boundary invalid.");

  const plans=new Map(arr(acquisition.acquisition_plans).map(x=>[x.acquisition_plan_id,x]));
  const queue=arr(pipeline.executable_acquisition_queue);
  if(!queue.length) throw new Error("No executable acquisition plans.");

  const requests=queue.map((q,i)=>{
    const p=plans.get(q.acquisition_plan_id);
    if(!p) throw new Error("Unknown acquisition plan.");
    if(!arr(p.query_templates).length || !arr(p.source_strategy).length) throw new Error("Plan lacks query/source strategy.");
    return {
      execution_request_id:sid("kc_exec_req",p.acquisition_plan_id,String(i+1)),
      acquisition_plan_id:p.acquisition_plan_id,
      discovery_target_id:p.discovery_target_id,
      target_type:p.target_type,
      statement:p.statement,
      subject:p.subject||q.subject||null,
      execution_rank:i+1,
      query_templates:p.query_templates,
      source_strategy:p.source_strategy,
      evidence_contract:p.evidence_contract,
      lineage:p.lineage,
      execution:{mode:"adapter_required",executor_status:"not_connected",network_execution_performed:false,result_count:0},
      epistemic_boundary:{results_are_observations_not_facts:true,candidate_validation_required:true,evidence_validation_required:true,knowledge_admission_required:true}
    };
  });

  return {
    schema_version:"0.1",
    status:"knowledge_completion_acquisition_execution_planned",
    source_pipeline:{schema_version:pipeline.schema_version,status:pipeline.status,route:pipeline.route},
    source_acquisition:{schema_version:acquisition.schema_version,status:acquisition.status},
    execution_state:{request_count:requests.length,execution_mode:"adapter_required",external_execution_connected:false,network_execution_performed:false,normalized_observation_count:0,candidate_validation_count:0,evidence_validation_count:0,knowledge_admission_count:0,graph_write_count:0},
    execution_requests:requests,
    future_adapter_queue:requests.map((r,i)=>({execution_rank:i+1,execution_request_id:r.execution_request_id,acquisition_plan_id:r.acquisition_plan_id,executor_status:"not_connected",query_templates:r.query_templates,source_strategy:r.source_strategy})),
    next_stage:"external_acquisition_adapter",
    contracts:{applicable_plan_consumed:true,original_query_templates_preserved:true,source_authority_strategy_preserved:true,adapter_boundary_explicit:true,acquisition_results_are_not_knowledge:true,validation_required_before_admission:true},
    safeguards:{performs_external_search:false,calls_openai_or_external_api:false,invents_candidates:false,invents_evidence:false,validates_candidates:false,admits_knowledge:false,writes_graph:false}
  };
}

export function normalizeAdapterResults({executionPlan,adapterResults}){
  if(executionPlan?.status!=="knowledge_completion_acquisition_execution_planned") throw new Error("Invalid execution plan.");
  const reqs=new Map(arr(executionPlan.execution_requests).map(x=>[x.execution_request_id,x]));
  const observations=[],orphans=[];
  for(const [i,r] of arr(adapterResults?.results).entries()){
    const q=reqs.get(r?.execution_request_id);
    if(!q){orphans.push({adapter_result_index:i,execution_request_id:r?.execution_request_id||null,reason:"unknown_execution_request_id"});continue;}
    const sourceId=txt(r.source_url_or_identifier), title=txt(r.source_title), candidate=txt(r.extracted_candidate_label), fact=txt(r.extracted_fact);
    if(!sourceId||!title||!candidate||!fact){orphans.push({adapter_result_index:i,execution_request_id:r.execution_request_id,reason:"missing_required_source_or_extraction_fields"});continue;}
    observations.push({
      acquisition_observation_id:sid("kc_acq_obs",q.execution_request_id,sourceId,candidate,fact),
      execution_request_id:q.execution_request_id,acquisition_plan_id:q.acquisition_plan_id,discovery_target_id:q.discovery_target_id,target_type:q.target_type,subject:q.subject,
      extracted_candidate_label:candidate,proposed_relationship_semantics:arr(r.proposed_relationship_semantics),extracted_fact:fact,
      source:{source_url_or_identifier:sourceId,source_title:title,source_publisher_or_owner:txt(r.source_publisher_or_owner)||null,source_date_or_event_date:txt(r.source_date_or_event_date)||null,retrieved_at:txt(r.retrieved_at)||null,authority_score:Number.isFinite(Number(r.authority_score))?Number(r.authority_score):null,independence_group:txt(r.independence_group)||null,directness:txt(r.directness)||null},
      query_used:txt(r.query_used)||null,source_rank:Number.isFinite(Number(r.source_rank))?Number(r.source_rank):null,
      epistemic_status:"acquisition_observation",validation_status:"not_started",knowledge_status:"not_admitted",executable:false,
      lineage:{source_acquisition_plan_id:q.acquisition_plan_id,source_discovery_target_id:q.discovery_target_id,source_execution_request_id:q.execution_request_id,source_lineage:q.lineage}
    });
  }
  return {
    schema_version:"0.1",status:"knowledge_completion_acquisition_results_normalized",
    source_execution_plan:{schema_version:executionPlan.schema_version,status:executionPlan.status},
    execution_state:{request_count:arr(executionPlan.execution_requests).length,adapter_result_count:arr(adapterResults?.results).length,normalized_observation_count:observations.length,orphan_result_count:orphans.length,external_execution_connected:true,network_execution_performed_by_this_module:false,candidate_validation_count:0,evidence_validation_count:0,knowledge_admission_count:0,graph_write_count:0},
    acquisition_observations:observations,orphan_results:orphans,
    candidate_validation_handoff:observations.map((o,i)=>({handoff_rank:i+1,acquisition_observation_id:o.acquisition_observation_id,validation_status:"not_started",knowledge_status:"not_admitted",executable:false})),
    next_stage:"acquisition_observation_candidate_adapter",
    contracts:{adapter_results_preserved_as_observations:true,source_lineage_preserved:true,extracted_candidates_not_promoted_to_facts:true,candidate_validation_required:true,evidence_validation_required:true,knowledge_admission_required:true},
    safeguards:{performs_external_search:false,calls_openai_or_external_api:false,invents_candidates:false,invents_evidence:false,validates_candidates:false,admits_knowledge:false,writes_graph:false,treats_adapter_results_as_facts:false}
  };
}

const pipelineFile=arg("--pipeline"),acquisitionFile=arg("--acquisition"),adapterFile=arg("--adapter-results"),out=arg("--out");
if(pipelineFile&&acquisitionFile&&out){
  const plan=buildExecutionRequest({pipeline:read(pipelineFile),acquisition:read(acquisitionFile)});
  const result=adapterFile?normalizeAdapterResults({executionPlan:plan,adapterResults:read(adapterFile)}):plan;
  write(out,result);process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
