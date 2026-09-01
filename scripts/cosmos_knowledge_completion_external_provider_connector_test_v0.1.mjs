#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const mod=await import(pathToFileURL(path.resolve(arg("--engine"))).href);

const plan={
  schema_version:"0.1",
  status:"knowledge_completion_external_acquisition_requests_ready",
  next_stage:"external_provider_execution",
  provider_requests:[
    {
      provider_request_id:"pr1",
      execution_request_id:"er1",
      acquisition_plan_id:"ap1",
      discovery_target_id:"dt1",
      target_type:"identify_components",
      statement:"Identify evidence-supported components or equipment included in HV Substations.",
      query:"HV substation equipment components",
      source_constraint:{
        source_strategy_id:"ss1",
        source_type:"manufacturer_or_oem_technical_document",
        authority_score:100,
        priority:"primary",
        source_rank:1
      }
    },
    {
      provider_request_id:"pr2",
      execution_request_id:"er1",
      acquisition_plan_id:"ap1",
      discovery_target_id:"dt1",
      target_type:"identify_components",
      statement:"Identify evidence-supported components or equipment included in HV Substations.",
      query:"HV substation utility engineering standard equipment",
      source_constraint:{
        source_strategy_id:"ss2",
        source_type:"utility_or_owner_engineering_standard",
        authority_score:96,
        priority:"primary",
        source_rank:2
      }
    }
  ]
};

const result=await mod.executeProvider({
  adapterPlan:plan,
  provider:"fixture",
  executeLive:false,
  resultLimit:3
});

assert(result.status==="external_provider_results_ready","status");
assert(result.provider_mode==="deterministic_fixture","mode");
assert(result.execution_state.external_provider_connected===false,"external");
assert(result.execution_state.network_execution_performed===false,"network");
assert(result.results.length===2,"results");
assert(result.next_stage==="external_acquisition_adapter_normalization","next");

for(const row of result.results){
  assert(row.source_type==="unclassified_external_web_result","no source type assumption");
  assert(row.authority_score===0,"no authority inheritance");
  assert(row.supports_or_contradicts==="context_only","context only");
  assert(row.requested_source_type,"requested type preserved");
  assert(Number(row.requested_authority_score)>0,"requested authority preserved");
}

assert(Object.values(result.contracts).every(Boolean),"contracts");
assert(Object.values(result.safeguards).every(v=>v===false),"safeguards");

let liveBlocked=false;
try{
  await mod.executeProvider({
    adapterPlan:plan,
    provider:"brave",
    executeLive:false
  });
}catch(error){
  liveBlocked=/without --execute-live/.test(String(error.message));
}
assert(liveBlocked,"live mode must require explicit switch");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_external_provider_connector_test_passed",
  fixture_execution:{
    provider_request_count:result.execution_state.provider_request_count,
    result_count:result.execution_state.result_count,
    external_provider_connected:result.execution_state.external_provider_connected,
    network_execution_performed:result.execution_state.network_execution_performed,
    next_stage:result.next_stage
  },
  live_gate:{
    explicit_execute_live_required:true,
    environment_gate_required:true,
    supported_providers:["brave","serper","tavily"]
  },
  contracts:result.contracts,
  safeguards:result.safeguards
},null,2));
