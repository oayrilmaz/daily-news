import assert from "node:assert/strict";
import candidateValidation from "./cosmos_candidate_validation.cjs";
import evidenceStrategy from "./cosmos_evidence_strategy.cjs";
import evidenceExecutor from "./cosmos_evidence_executor.cjs";
import evidenceValidator from "./cosmos_evidence_validator.cjs";
import knowledgeAdmission from "./cosmos_knowledge_admission.cjs";
import graphWriter from "./cosmos_graph_writer.cjs";

const decomposition={
  schema_version:"0.1",status:"decomposition_candidates_resolved",
  decomposition_state:{conceptual_distance_limit:1,continuation_possible:false},
  decompositions:[{candidates:[{
    decomposition_candidate_id:"dc_state_1",
    abstract_subject:"Transformer lead time",
    candidate_label:"US large power transformer lead time",
    candidate_class:"infrastructure",
    parent_acquisition_plan_id:"ap_1",
    parent_discovery_target_id:"dt_1",
    original_target_type:"state_observation",
    proposed_investigation_types:["validate_state"],
    validation_requirements:["time_scope","geography_scope","value_type"],
    lineage:{fixture:true},
    claim:{
      claim_type:"state_claim",subject_id:"transformer_lead_time",
      state_dimension:"lead_time",value:110,unit:"weeks",
      effective_at:"2026-08-20",geography:"United States",
      scope:"large_power_transformers",value_type:"reported"
    }
  }]}]
};

const validationPlan=candidateValidation.consolidate(decomposition);
const target=validationPlan.validation_targets[0];
assert.equal(target.validation_target_type,"state_claim");
assert.equal(target.claim.value,110);

const strategy=evidenceStrategy.runEvidenceStrategy(validationPlan);
const task=strategy.evidence_tasks[0];
assert.equal(task.validation_target_type,"state_claim");
assert.ok(task.evidence_questions.some(q=>q.includes("110 weeks")));

const mk=(suffix,group)=>({
  evidence_task_id:task.evidence_task_id,
  source_url_or_identifier:`https://example.test/${suffix}`,
  source_type:"official_project_or_operator_document",
  source_title:`Authoritative source ${suffix}`,
  source_publisher_or_owner:`Publisher ${suffix}`,
  source_date_or_event_date:"2026-08-20",
  retrieved_at:"2026-09-05T00:00:00.000Z",
  extracted_fact:"Reported lead time is 110 weeks.",
  supports_or_contradicts:"supports",
  directness:"direct",authority_score:100,independence_group:group,
  geography_scope:"United States",temporal_scope:"2026-08-20",
  entity_ids:["transformer_lead_time"],relationship_ids:[]
});
const execution=evidenceExecutor.runEvidenceExecutor(strategy,{status:"adapter_results_ready",results:[mk("a","publisher_a"),mk("b","publisher_b")]});
assert.equal(execution.task_execution[0].validation_target_type,"state_claim");
assert.equal(execution.task_execution[0].claim.state_dimension,"lead_time");

const validation=evidenceValidator.runEvidenceValidator(execution);
assert.equal(validation.validations[0].validation_target_type,"state_claim");
assert.equal(validation.validations[0].disposition,"supported");

const admission=knowledgeAdmission.runKnowledgeAdmission(validation);
assert.equal(admission.admissions[0].decision,"admit");
assert.equal(admission.admissions[0].admitted_claim_class,"validated_supported_state");
assert.equal(admission.admissions[0].claim.value,110);

const written=graphWriter.applyAdmissions(admission,graphWriter.emptyGraph());
assert.equal(written.graph.knowledge_records.length,1);
const record=written.graph.knowledge_records[0];
assert.equal(record.validation_target_type,"state_claim");
assert.equal(record.claim_class,"validated_supported_state");
assert.equal(record.claim.value,110);
console.log("PASS cosmos_state_claim_pipeline_test_v0.1",record.graph_record_id,record.claim_class);
