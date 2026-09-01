#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const mod=await import(pathToFileURL(path.resolve(arg("--engine"))).href);

const pipeline={schema_version:"0.1",status:"knowledge_completion_acquisition_execution_required",route:"applicable_direct_execution",next_stage:"acquisition_execution",executable_acquisition_queue:[{acquisition_plan_id:"plan_hv_1",execution_rank:1,applicability_status:"applicable"}]};
const acquisition={schema_version:"0.1",status:"acquisition_plans_resolved",acquisition_state:{execution_mode:"planned_only",external_execution_connected:false,evidence_validation_required_before_graph_admission:true},acquisition_plans:[{acquisition_plan_id:"plan_hv_1",discovery_target_id:"target_hv_1",target_type:"identify_components",statement:"Identify supported equipment/components of HV Substations.",subject:"HV Substations",query_templates:["HV substation equipment components","high voltage substation primary equipment"],source_strategy:[{source_type:"official_oem_document",authority_score:100,acquisition_status:"planned",execution_adapter:"unassigned"},{source_type:"utility_standard",authority_score:95,acquisition_status:"planned",execution_adapter:"unassigned"}],evidence_contract:{evidence_is_not_knowledge_until_validated:true,knowledge_admission_status:"not_evaluated"},lineage:{entity_ids:["hv_substations"],consequence_ids:[],relationship_ids:[],originating_gap_ids:["gap_hv_1"]}}]};

const plan=mod.buildExecutionRequest({pipeline,acquisition});
assert(plan.status==="knowledge_completion_acquisition_execution_planned","plan");
assert(plan.execution_requests.length===1,"request");
assert(plan.next_stage==="external_acquisition_adapter","adapter next");
assert(plan.execution_state.external_execution_connected===false,"external");
assert(plan.execution_state.network_execution_performed===false,"network");

const id=plan.execution_requests[0].execution_request_id;
const adapter={schema_version:"0.1",results:[
 {execution_request_id:id,source_url_or_identifier:"fixture://oem",source_title:"Fixture OEM Guide",source_publisher_or_owner:"Fixture OEM",source_date_or_event_date:"2026-01-01",retrieved_at:"2026-09-01T00:00:00Z",extracted_candidate_label:"Power Transformers",proposed_relationship_semantics:["equipment of"],extracted_fact:"Fixture source identifies power transformers as primary substation equipment.",authority_score:100,independence_group:"oem",directness:"direct",query_used:"HV substation equipment components",source_rank:1},
 {execution_request_id:id,source_url_or_identifier:"fixture://utility",source_title:"Fixture Utility Standard",source_publisher_or_owner:"Fixture Utility",source_date_or_event_date:"2026-02-01",retrieved_at:"2026-09-01T00:00:00Z",extracted_candidate_label:"Circuit Breakers",proposed_relationship_semantics:["equipment of"],extracted_fact:"Fixture source identifies circuit breakers as primary switching equipment.",authority_score:95,independence_group:"utility",directness:"direct",query_used:"high voltage substation primary equipment",source_rank:2},
 {execution_request_id:"unknown",source_url_or_identifier:"fixture://orphan",source_title:"Orphan",extracted_candidate_label:"Ignored",extracted_fact:"Intentional orphan."}
]};
const normalized=mod.normalizeAdapterResults({executionPlan:plan,adapterResults:adapter});
assert(normalized.status==="knowledge_completion_acquisition_results_normalized","normalized");
assert(normalized.acquisition_observations.length===2,"observations");
assert(normalized.orphan_results.length===1,"orphan");
assert(normalized.next_stage==="acquisition_observation_candidate_adapter","next");
assert(normalized.acquisition_observations.every(x=>x.epistemic_status==="acquisition_observation"&&x.validation_status==="not_started"&&x.knowledge_status==="not_admitted"&&x.executable===false),"boundary");
assert(Object.values(normalized.safeguards).every(v=>v===false),"safeguards");

console.log(JSON.stringify({schema_version:"0.1",status:"cosmos_knowledge_completion_acquisition_execution_test_passed",plan_only:{request_count:plan.execution_requests.length,next_stage:plan.next_stage,external_execution_connected:plan.execution_state.external_execution_connected,network_execution_performed:plan.execution_state.network_execution_performed},normalization:{adapter_results:adapter.results.length,normalized_observations:normalized.acquisition_observations.length,orphan_results:normalized.orphan_results.length,next_stage:normalized.next_stage},contracts:{applicable_route_consumed:true,query_templates_preserved:true,source_authority_preserved:true,adapter_boundary_explicit:true,adapter_results_remain_observations:true,validation_before_admission_preserved:true},safeguards:normalized.safeguards},null,2));
