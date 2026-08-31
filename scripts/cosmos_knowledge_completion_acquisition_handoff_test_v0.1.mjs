#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const mod=await import(pathToFileURL(path.resolve(
  arg("--engine","scripts/cosmos_knowledge_completion_acquisition_handoff_v0.1.mjs")
)).href);

const request={
  schema_version:"0.1",
  status:"knowledge_completion_request_ready",
  question:"What are the HV substation equipment?",
  subject:{id:"hv_substations",label:"HV Substations"},
  completion_required:true,
  next_action:"acquisition",
  knowledge_contract:{
    contract_id:"component_membership",
    answer_shape:"structured_list",
    minimum_supported_members:2,
    required_relationship_semantics:[
      "contains","includes","component","equipment","part of"
    ]
  },
  orchestrator_run:{
    status:"knowledge_completion_planned",
    current_stage:"acquisition",
    answer_ready:false,
    projection_release:false
  }
};

const h=mod.buildAcquisitionHandoff(request);
const targets=h.discovery_targets.items;
const queue=h.next_acquisition_queue;

assert(h.schema_version==="0.1","schema");
assert(h.status==="discovery_targets_resolved","discovery status");
assert(h.source_consequence.schema_version==="0.1","source consequence");
assert(targets.length===1,"one focused target");
assert(queue.length===1,"one acquisition queue row");
assert(targets[0].discovery_action==="identify_components","component action");
assert(targets[0].epistemic_status==="knowledge_request","request not claim");
assert(targets[0].reopens_frontier_if_resolved===true,"frontier reopen");
assert(queue[0].queue_rank===1,"rank");
assert(queue[0].execution_status==="not_connected","not executed");
assert(h.curiosity_state.continuation_possible===true,"continuation");
assert(h.curiosity_state.conceptual_distance_limit===null,"dimensionless");
assert(h.observer_state.question_remains_primary_observer===true,"question observer");
assert(h.observer_state.question===request.question,"question preserved");
assert(h.observer_state.semantic_subject.id==="hv_substations","subject preserved");
assert(Object.values(h.safeguards).every(v=>v===false || v===true),"safeguards typed");
assert(h.safeguards.performs_external_search===false,"no search");
assert(h.safeguards.calls_openai_or_external_api===false,"no API");
assert(h.safeguards.invents_missing_entities===false,"no entities invented");
assert(h.safeguards.invents_missing_relationships===false,"no relationships invented");
assert(h.safeguards.acquisition_targets_are_requests_for_knowledge_not_claims===true,"request only");
assert(h.safeguards.source_lineage_preserved===true,"lineage");
assert(h.safeguards.graph_mutation_performed===false,"no mutation");

let blocked=false;
try{
  mod.buildAcquisitionHandoff({...request,status:"knowledge_completion_not_required"});
}catch(e){
  blocked=String(e.message).includes("knowledge_completion_request_ready");
}
assert(blocked,"non-gap blocked");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_acquisition_handoff_test_passed",
  question:request.question,
  subject:request.subject,
  handoff:{
    status:h.status,
    target_count:targets.length,
    queue_count:queue.length,
    discovery_action:targets[0].discovery_action,
    target_epistemic_status:targets[0].epistemic_status,
    execution_status:queue[0].execution_status,
    reopens_frontier_if_resolved:targets[0].reopens_frontier_if_resolved,
    question_remains_primary_observer:h.observer_state.question_remains_primary_observer
  },
  acquisition_boundary:{
    external_execution_performed:false,
    acquisition_script_executed:false,
    handoff_ready_for_cosmos_acquisition_cjs:true
  },
  safeguards:h.safeguards
},null,2));
