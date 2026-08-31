#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const mod=await import(pathToFileURL(path.resolve(
  arg("--engine","scripts/cosmos_knowledge_completion_orchestrator_v0.1.mjs")
)).href);

const input={
  question:"What are the HV substation equipment?",
  subject_match:{id:"hv_substations",label:"HV Substations"},
  knowledge_completion:{
    completion_required:true,
    knowledge_contract:{
      contract_id:"component_membership",
      answer_shape:"structured_list",
      minimum_supported_members:2,
      required_relationship_semantics:["contains","includes","component","equipment","part of"]
    }
  }
};

let run=mod.createKnowledgeCompletionRun(input);

const expected=[
  "acquisition","acquisition_applicability","decomposition","candidate_validation",
  "evidence_strategy","evidence_execution","evidence_validation","knowledge_admission",
  "graph_writer","answer_rebuild"
];

assert(run.status==="knowledge_completion_planned","planned");
assert(JSON.stringify(run.stage_order)===JSON.stringify(expected),"pipeline order");
assert(run.answer_ready===false,"not answer ready");
assert(run.projection_release===false,"projection held");
assert(run.external_execution_enabled===false,"external execution off");
assert(run.graph_mutation_enabled===false,"graph mutation off");

let orderingBlocked=false;
try{mod.applyKnowledgeCompletionStage(run,"knowledge_admission",{decisions:[]});}
catch{orderingBlocked=true;}
assert(orderingBlocked,"cannot skip stages");

const outputs={
  acquisition:{candidates:[{candidate_id:"c1",label:"Power Transformers"},{candidate_id:"c2",label:"Circuit Breakers"}]},
  acquisition_applicability:{applicable_candidate_ids:["c1","c2"]},
  decomposition:{claims:[{claim_id:"cl1",candidate_id:"c1",predicate:"includes equipment"},{claim_id:"cl2",candidate_id:"c2",predicate:"includes equipment"}]},
  candidate_validation:{valid_claim_ids:["cl1","cl2"],rejected_claim_ids:[]},
  evidence_strategy:{plans:[{claim_id:"cl1"},{claim_id:"cl2"}]},
  evidence_execution:{observations:[{claim_id:"cl1",evidence_id:"ev1"},{claim_id:"cl2",evidence_id:"ev2"}]},
  evidence_validation:{decisions:[{claim_id:"cl1",decision:"supported"},{claim_id:"cl2",decision:"supported"}]},
  knowledge_admission:{decisions:[{claim_id:"cl1",decision:"admit"},{claim_id:"cl2",decision:"admit"}]},
  graph_writer:{written_relationship_ids:["rel1","rel2"],written_object_ids:[],snapshot_id:"snap1"},
  answer_rebuild:{answer_ready:true,direct_answer:"Key equipment includes Power Transformers and Circuit Breakers.",projection_seed_ids:["hv_substations","power_transformers","circuit_breakers"]}
};

for(const stage of expected) run=mod.applyKnowledgeCompletionStage(run,stage,outputs[stage]);

assert(run.status==="knowledge_completion_completed","completed");
assert(run.answer_ready===true,"answer ready");
assert(run.projection_release===true,"projection released");
assert(run.stages.every(x=>x.state==="completed"),"all stages complete");

let blocked=mod.createKnowledgeCompletionRun(input);
for(const stage of expected.slice(0,6)) blocked=mod.applyKnowledgeCompletionStage(blocked,stage,outputs[stage]);
blocked=mod.applyKnowledgeCompletionStage(blocked,"evidence_validation",{decisions:[]});
assert(blocked.status==="knowledge_completion_blocked","bad evidence blocked");
assert(blocked.projection_release===false,"blocked cannot release projection");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_orchestrator_test_passed",
  question:input.question,
  subject:input.subject_match,
  pipeline:{
    stage_count:run.stage_order.length,
    stage_order:run.stage_order,
    final_status:run.status,
    answer_ready:run.answer_ready,
    projection_release:run.projection_release
  },
  blocked_case:{
    status:blocked.status,
    stage:blocked.current_stage,
    reason:blocked.blocked_reason,
    projection_release:blocked.projection_release
  },
  contracts:run.contracts,
  safeguards:run.safeguards
},null,2));
