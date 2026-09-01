#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const mod=await import(pathToFileURL(path.resolve(arg("--engine"))).href);

function fixture(targetType){
  return {
    schema_version:"0.1",
    status:"knowledge_completion_source_strategy_required",
    next_stage:"acquisition_source_strategy_resolver",
    execution_requests:[{
      execution_request_id:"req_1",
      acquisition_plan_id:"plan_1",
      discovery_target_id:"target_1",
      target_type:targetType,
      statement:"Identify evidence-supported components or equipment included in HV Substations.",
      investigation_intent:"Identify critical components, subassemblies, and bottleneck parts.",
      query_templates:[
        "Identify evidence-supported components or equipment included in HV Substations. components BOM",
        "Identify evidence-supported components or equipment included in HV Substations. technical manual critical parts"
      ],
      source_strategy:[],
      source_strategy_status:"unresolved",
      evidence_contract:{
        evidence_is_not_knowledge_until_validated:true,
        knowledge_admission_status:"not_evaluated"
      },
      lineage:{
        entity_ids:[],
        consequence_ids:[],
        relationship_ids:[],
        originating_gap_ids:[]
      },
      execution:{
        mode:"source_strategy_required",
        executor_status:"not_connected",
        network_execution_performed:false,
        result_count:0
      }
    }],
    source_strategy_resolution_queue:[{
      resolution_rank:1,
      execution_request_id:"req_1",
      acquisition_plan_id:"plan_1",
      target_type:targetType,
      resolution_status:"not_started"
    }]
  };
}

const result=mod.resolveSourceStrategy(fixture("identify_components"));

assert(result.status==="knowledge_completion_source_strategy_resolved","status");
assert(result.next_stage==="external_acquisition_adapter","next");
assert(result.resolution_state.resolved_count===1,"resolved");
assert(result.resolution_state.unresolved_count===0,"unresolved");
assert(result.resolution_state.external_execution_connected===false,"external");
assert(result.resolution_state.network_execution_performed===false,"network");
assert(result.future_adapter_queue.length===1,"adapter queue");

const strategy=result.execution_requests[0].source_strategy;
assert(strategy.length>=3,"strategy size");
assert(strategy[0].source_type==="manufacturer_or_oem_technical_document","OEM first");
assert(strategy[0].authority_score===100,"OEM authority");
assert(strategy.some(x=>x.source_type==="utility_or_owner_engineering_standard"),"utility source");
assert(strategy.some(x=>x.source_type==="regulatory_or_government_document"),"government source");
assert(strategy.some(x=>x.source_type==="industry_body_or_research_institution"),"research source");
assert(strategy.every(x=>x.acquisition_status==="planned"&&x.execution_adapter==="unassigned"&&x.search_status==="not_started"),"planning boundary");

for(let i=1;i<strategy.length;i++){
  assert(strategy[i].authority_score<=strategy[i-1].authority_score,"authority ranking");
}

assert(Object.values(result.contracts).every(Boolean),"contracts");
assert(Object.values(result.safeguards).every(v=>v===false),"safeguards");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_acquisition_source_strategy_resolver_test_passed",
  target_type:"identify_components",
  source_strategy:strategy.map(x=>({
    rank:x.source_rank,
    source_type:x.source_type,
    authority_score:x.authority_score,
    priority:x.priority
  })),
  next_stage:result.next_stage,
  contracts:result.contracts,
  safeguards:result.safeguards
},null,2));
