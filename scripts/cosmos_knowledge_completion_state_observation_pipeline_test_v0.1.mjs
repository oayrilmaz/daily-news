#!/usr/bin/env node
import assert from "node:assert/strict";
import {buildProviderRequests,normalizeProviderResults} from "./cosmos_knowledge_completion_external_acquisition_adapter_v0.1.mjs";
import {adaptAcquisitionObservations} from "./cosmos_knowledge_completion_acquisition_observation_candidate_adapter_v0.1.mjs";
import candidateValidation from "./cosmos_candidate_validation.cjs";
import evidenceStrategy from "./cosmos_evidence_strategy.cjs";
import evidenceExecutor from "./cosmos_evidence_executor.cjs";
import evidenceValidator from "./cosmos_evidence_validator.cjs";
import knowledgeAdmission from "./cosmos_knowledge_admission.cjs";
import graphWriter from "./cosmos_graph_writer.cjs";
import worldChange from "./cosmos_world_change.cjs";

function request(id,date){
  return {
    execution_request_id:`req_${id}`,
    acquisition_plan_id:`plan_${id}`,
    discovery_target_id:`target_${id}`,
    target_type:"observe_state",
    statement:"Observe the reported U.S. large power transformer lead time.",
    query_templates:[`US large power transformer lead time ${date}`],
    source_strategy:[
      {
        source_strategy_id:`src_${id}_a`,
        source_type:"official_project_or_operator_document",
        authority_score:100,
        priority:"primary",
        source_rank:1,
        acquisition_status:"planned",
        execution_adapter:"unassigned",
        search_status:"not_started"
      },
      {
        source_strategy_id:`src_${id}_b`,
        source_type:"regulatory_or_government_document",
        authority_score:96,
        priority:"primary",
        source_rank:2,
        acquisition_status:"planned",
        execution_adapter:"unassigned",
        search_status:"not_started"
      }
    ]
  };
}

const resolved={
  schema_version:"0.1",
  status:"knowledge_completion_source_strategy_resolved",
  next_stage:"external_acquisition_adapter",
  resolution_state:{external_execution_connected:false,network_execution_performed:false},
  execution_requests:[request("a","2026-01-01"),request("b","2026-08-20")]
};

const plan=buildProviderRequests(resolved);
assert.equal(plan.provider_requests.length,4);

const byExecution=new Map();
for(const r of plan.provider_requests){ if(!byExecution.has(r.execution_request_id)) byExecution.set(r.execution_request_id,[]); byExecution.get(r.execution_request_id).push(r); }
const providerResults={
  status:"provider_results_ready",
  provider_name:"m3_fixture_provider",
  provider_mode:"deterministic_fixture",
  results:[
    ...byExecution.get("req_a").map((req,i)=>({
      provider_request_id:req.provider_request_id,
      source_url_or_identifier:`fixture://source/a${i+1}`,
      source_type:i===0?"official_project_or_operator_document":"regulatory_or_government_document",
      source_title:`Fixture transformer delivery report A${i+1}`,
      source_publisher_or_owner:i===0?"Fixture Operator A":"Fixture Regulator A",
      source_date_or_event_date:"2026-01-01",
      retrieved_at:"2026-09-05T00:00:00Z",
      extracted_fact:"Reported U.S. large power transformer lead time is 80 weeks.",
      supports_or_contradicts:"supports",
      directness:"direct",
      authority_score:i===0?100:96,
      independence_group:i===0?"fixture_operator_a":"fixture_regulator_a",
      geography_scope:"United States",
      temporal_scope:"2026-01-01",
      entity_ids:["transformer_lead_time"],
      relationship_ids:[],
      state_observation:{subject_id:"transformer_lead_time",state_dimension:"lead_time",value:80,unit:"weeks",effective_at:"2026-01-01",geography:"United States",scope:"large_power_transformers",value_type:"reported"}
    })),
    ...byExecution.get("req_b").map((req,i)=>({
      provider_request_id:req.provider_request_id,
      source_url_or_identifier:`fixture://source/b${i+1}`,
      source_type:i===0?"official_project_or_operator_document":"regulatory_or_government_document",
      source_title:`Fixture transformer delivery report B${i+1}`,
      source_publisher_or_owner:i===0?"Fixture Operator B":"Fixture Regulator B",
      source_date_or_event_date:"2026-08-20",
      retrieved_at:"2026-09-05T00:00:00Z",
      extracted_fact:"Reported U.S. large power transformer lead time is 110 weeks.",
      supports_or_contradicts:"supports",
      directness:"direct",
      authority_score:i===0?100:96,
      independence_group:i===0?"fixture_operator_b":"fixture_regulator_b",
      geography_scope:"United States",
      temporal_scope:"2026-08-20",
      entity_ids:["transformer_lead_time"],
      relationship_ids:[],
      state_observation:{subject_id:"transformer_lead_time",state_dimension:"lead_time",value:110,unit:"weeks",effective_at:"2026-08-20",geography:"United States",scope:"large_power_transformers",value_type:"reported"}
    }))
  ]
};

const normalized=normalizeProviderResults({adapterPlan:plan,providerResults});
assert.equal(normalized.acquisition_observations.length,4);
assert.equal(normalized.acquisition_observations[0].state_observation?.state_dimension,"lead_time");

const decomposition=adaptAcquisitionObservations(normalized);
const stateCandidates=decomposition.decompositions[0].candidates.filter(x=>x.claim?.claim_type==="state_claim");
assert.equal(stateCandidates.length,2);
assert.deepEqual(stateCandidates.map(x=>x.claim.value).sort((a,b)=>a-b),[80,110]);

const validationPlan=candidateValidation.consolidate(decomposition);
assert.equal(validationPlan.validation_targets.length,2);
assert.ok(validationPlan.validation_targets.every(x=>x.validation_target_type==="state_claim"));

const strategy=evidenceStrategy.runEvidenceStrategy(validationPlan);
assert.equal(strategy.evidence_tasks.length,2);

const observations=normalized.acquisition_observations;
const evidenceResults=[];
for(const task of strategy.evidence_tasks){
  const matches=observations.filter(x=>x.state_observation?.effective_at===task.claim?.effective_at);
  assert.equal(matches.length,2,`expected two observations for ${task.claim?.effective_at}`);
  for(const obs of matches){
    evidenceResults.push({
      evidence_task_id:task.evidence_task_id,
      source_url_or_identifier:obs.source_url_or_identifier,
      source_type:obs.source_type,
      source_title:obs.source_title,
      source_publisher_or_owner:obs.source_publisher_or_owner,
      source_date_or_event_date:obs.source_date_or_event_date,
      retrieved_at:obs.retrieved_at,
      extracted_fact:obs.extracted_fact,
      supports_or_contradicts:obs.supports_or_contradicts,
      directness:obs.directness,
      authority_score:obs.authority_score,
      independence_group:obs.independence_group,
      geography_scope:obs.geography_scope,
      temporal_scope:obs.temporal_scope,
      entity_ids:obs.entity_ids,
      relationship_ids:obs.relationship_ids,
      query_used:obs.query_used,
      source_rank:obs.source_rank
    });
  }
}

const execution=evidenceExecutor.runEvidenceExecutor(strategy,{status:"adapter_results_ready",results:evidenceResults});
const validation=evidenceValidator.runEvidenceValidator(execution);
assert.ok(validation.validations.every(x=>x.disposition==="supported"));

const admission=knowledgeAdmission.runKnowledgeAdmission(validation);
assert.equal(admission.admissions.filter(x=>x.decision==="admit").length,2);
assert.ok(admission.admissions.every(x=>x.admitted_claim_class==="validated_supported_state"));

const written=graphWriter.applyAdmissions(admission,graphWriter.emptyGraph());
assert.equal(written.graph.knowledge_records.length,2);

const delta=worldChange.deriveWorldChanges(written.graph);
assert.equal(delta.counts.world_changes,1);
assert.equal(delta.world_changes[0].previous_state.value,80);
assert.equal(delta.world_changes[0].current_state.value,110);
assert.equal(delta.world_changes[0].direction,"increase");
assert.equal(delta.world_changes[0].magnitude,30);
assert.equal(delta.world_changes[0].butterfly_eligible,false);

console.log("PASS cosmos_knowledge_completion_state_observation_pipeline_test_v0.1",{
  normalized_observations:normalized.acquisition_observations.length,
  state_candidates:stateCandidates.length,
  admitted_states:written.graph.knowledge_records.length,
  world_changes:delta.world_changes.length,
  transition_id:delta.world_changes[0].transition_id
});
