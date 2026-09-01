#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

function fail(m){ throw new Error(m); }

async function main(){
  const args=process.argv.slice(2);
  let engine=null;
  for(let i=0;i<args.length;i++) if(args[i]==="--engine"&&args[i+1]) engine=args[++i];
  engine=engine||path.join(path.dirname(fileURLToPath(import.meta.url)),"cosmos_knowledge_completion_acquisition_observation_candidate_adapter_v0.1.mjs");

  const mod=await import(pathToFileURL(path.resolve(engine)).href);

  const input={
    schema_version:"0.1",
    status:"knowledge_completion_external_acquisition_results_normalized",
    provider:{provider_name:"fixture",provider_mode:"deterministic_fixture"},
    acquisition_observations:[
      {
        acquisition_observation_id:"obs_1",
        provider_request_id:"req_1",
        execution_request_id:"exec_1",
        acquisition_plan_id:"plan_1",
        discovery_target_id:"target_1",
        target_type:"identify_components",
        statement:"HV Substations",
        source_url_or_identifier:"https://example.test/hv-substation",
        source_type:"unclassified_external_web_result",
        source_title:"HV Substation Equipment",
        source_publisher_or_owner:"example.test",
        source_date_or_event_date:null,
        retrieved_at:"2026-09-01T00:00:00Z",
        extracted_fact:"HV substation equipment includes power transformers, circuit breakers, disconnect switches, instrument transformers, surge arresters, and busbars.",
        supports_or_contradicts:"context_only",
        directness:"unclassified",
        authority_score:0,
        independence_group:"example.test",
        query_used:"HV substation equipment",
        epistemic_status:"external_acquisition_observation",
        validation_status:"not_started",
        knowledge_status:"not_admitted",
        executable:false
      }
    ],
    rejected_results:[],
    next_stage:"acquisition_observation_candidate_adapter"
  };

  const out=mod.adaptAcquisitionObservations(input);
  if(out.status!=="decomposition_candidates_resolved") fail("Wrong status.");
  if(out.next_stage!=="candidate_validation") fail("Candidate Validation not released.");
  if((out.decompositions?.[0]?.candidates||[]).length!==6) fail("Expected six explicit provisional candidates.");

  for(const c of out.decompositions[0].candidates){
    if(c.epistemic_status!=="provisional_candidate" || c.validated!==false || c.executable!==false || c.knowledge_status!=="not_admitted"){
      fail("Candidate crossed epistemic boundary.");
    }
    if(c.relationship_semantic!=="component_membership") fail("Equipment relationship semantic lost.");
    if(!c.lineage?.source_observation_ids?.includes("obs_1")) fail("Observation lineage lost.");
  }

  if(!Object.values(out.contracts||{}).every(Boolean)) fail("Contract failure.");
  if(!Object.values(out.safeguards||{}).every(v=>v===false)) fail("Safeguard failure.");

  const unknown=mod.adaptAcquisitionObservations({
    ...input,
    acquisition_observations:[{
      ...input.acquisition_observations[0],
      acquisition_observation_id:"obs_2",
      extracted_fact:"This source discusses high-voltage substations and their design."
    }]
  });
  if(unknown.decomposition_state.provisional_candidate_count!==0 ||
     unknown.next_stage!=="candidate_extraction_assistance"){
    fail("Adapter invented a candidate from non-enumerative text.");
  }

  console.log(JSON.stringify({
    schema_version:"0.1",
    status:"cosmos_knowledge_completion_acquisition_observation_candidate_adapter_test_passed",
    explicit_candidate_count:out.decomposition_state.provisional_candidate_count,
    unknown_text_candidate_count:unknown.decomposition_state.provisional_candidate_count,
    next_stage:out.next_stage,
    cosmos_first_reuse_principle:out.decomposition_state.cosmos_first_reuse_principle,
    safeguards:out.safeguards
  },null,2));
}
main().catch(e=>{console.error(e?.stack||e);process.exit(1);});
