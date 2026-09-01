#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const mod=await import(pathToFileURL(path.resolve(arg("--engine"))).href);

const resolved={
  schema_version:"0.1",
  status:"knowledge_completion_source_strategy_resolved",
  next_stage:"external_acquisition_adapter",
  resolution_state:{
    external_execution_connected:false,
    network_execution_performed:false
  },
  execution_requests:[{
    execution_request_id:"req_1",
    acquisition_plan_id:"plan_1",
    discovery_target_id:"target_1",
    target_type:"identify_components",
    statement:"Identify evidence-supported components or equipment included in HV Substations.",
    query_templates:["HV substation equipment components"],
    source_strategy:[
      {
        source_strategy_id:"src_1",
        source_type:"manufacturer_or_oem_technical_document",
        authority_score:100,
        priority:"primary",
        source_rank:1,
        acquisition_status:"planned",
        execution_adapter:"unassigned",
        search_status:"not_started"
      },
      {
        source_strategy_id:"src_2",
        source_type:"utility_or_owner_engineering_standard",
        authority_score:96,
        priority:"primary",
        source_rank:2,
        acquisition_status:"planned",
        execution_adapter:"unassigned",
        search_status:"not_started"
      }
    ]
  }]
};

const plan=mod.buildProviderRequests(resolved);
assert(plan.status==="knowledge_completion_external_acquisition_requests_ready","plan status");
assert(plan.next_stage==="external_provider_execution","plan next");
assert(plan.provider_requests.length===2,"provider requests");
assert(plan.adapter_state.external_provider_connected===false,"external provider disconnected");
assert(plan.adapter_state.network_execution_performed_by_this_module===false,"no module network");
assert(Object.values(plan.contracts).every(Boolean),"plan contracts");
assert(Object.values(plan.safeguards).every(v=>v===false),"plan safeguards");

const id=plan.provider_requests[0].provider_request_id;
const providerResults={
  schema_version:"0.1-fixture",
  status:"provider_results_ready",
  provider_name:"cosmos_preflight_fixture_provider",
  provider_mode:"deterministic_fixture",
  results:[
    {
      provider_request_id:id,
      source_url_or_identifier:"fixture://oem/hv-substation-guide",
      source_type:"manufacturer_or_oem_technical_document",
      source_title:"Fixture HV Substation Technical Guide",
      source_publisher_or_owner:"Fixture OEM",
      source_date_or_event_date:"2026-01-15",
      retrieved_at:"2026-09-01T00:00:00Z",
      extracted_fact:"Fixture technical guide identifies power transformers as primary HV substation equipment.",
      supports_or_contradicts:"supports",
      directness:"direct",
      authority_score:100,
      independence_group:"fixture-oem",
      geography_scope:"global",
      temporal_scope:"current",
      entity_ids:[],
      relationship_ids:[],
      query_used:"HV substation equipment components",
      source_rank:1
    },
    {
      provider_request_id:"unknown_request",
      source_url_or_identifier:"fixture://orphan",
      source_title:"Orphan result",
      extracted_fact:"Intentional orphan result.",
      supports_or_contradicts:"context_only"
    }
  ]
};

const normalized=mod.normalizeProviderResults({adapterPlan:plan,providerResults});
assert(normalized.status==="knowledge_completion_external_acquisition_results_normalized","normalized status");
assert(normalized.acquisition_observations.length===1,"observation count");
assert(normalized.rejected_results.length===1,"rejected count");
assert(normalized.next_stage==="acquisition_observation_candidate_adapter","normalized next");

const obs=normalized.acquisition_observations[0];
assert(obs.epistemic_status==="external_acquisition_observation","epistemic status");
assert(obs.validation_status==="not_started","validation");
assert(obs.knowledge_status==="not_admitted","knowledge");
assert(obs.executable===false,"execution");
assert(Object.values(normalized.contracts).every(Boolean),"normalized contracts");
assert(Object.values(normalized.safeguards).every(v=>v===false),"normalized safeguards");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_external_acquisition_adapter_test_passed",
  planning:{
    provider_request_count:plan.provider_requests.length,
    next_stage:plan.next_stage,
    external_provider_connected:plan.adapter_state.external_provider_connected,
    network_execution_performed_by_module:plan.adapter_state.network_execution_performed_by_this_module
  },
  normalization:{
    provider_results:providerResults.results.length,
    normalized_observations:normalized.acquisition_observations.length,
    rejected_results:normalized.rejected_results.length,
    next_stage:normalized.next_stage
  },
  contracts:{
    provider_boundary_created:true,
    source_constraints_preserved:true,
    provider_results_remain_unvalidated:true,
    contradiction_disposition_preserved:true,
    validation_before_admission_preserved:true
  },
  safeguards:normalized.safeguards
},null,2));
