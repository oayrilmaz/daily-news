#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg=(n,d="")=>{
  const i=process.argv.indexOf(n);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:d;
};
const assert=(v,m)=>{ if(!v) throw new Error(m); };

const adapter = await import(pathToFileURL(path.resolve(
  arg("--adapter","scripts/cosmos_knowledge_completion_request_adapter_v0.1.mjs")
)).href);

const orchestratorPath = path.resolve(
  arg("--orchestrator","scripts/cosmos_knowledge_completion_orchestrator_v0.1.mjs")
);
const bridgePath = path.resolve(
  arg("--bridge","scripts/cosmos_knowledge_completion_execution_bridge_v0.1.mjs")
);

const missing = {
  question:"What are the HV substation equipment?",
  subject_match:{
    id:"hv_substations",
    label:"HV Substations"
  },
  knowledge_completion:{
    knowledge_status:"insufficient",
    completion_required:true,
    answer_ready:false,
    broad_projection_suppressed:true,
    knowledge_contract:{
      contract_id:"component_membership",
      answer_shape:"structured_list",
      minimum_supported_members:2,
      required_relationship_semantics:[
        "contains","includes","component","equipment","part of"
      ]
    },
    completion_tasks:[
      {type:"discover_supported_candidates"},
      {type:"validate_relationship_evidence"},
      {type:"admit_or_reject"},
      {type:"rebuild_answer"}
    ]
  }
};

const request = await adapter.buildKnowledgeCompletionRequest(missing,{
  orchestrator_path:orchestratorPath,
  bridge_path:bridgePath
});

assert(request.status==="knowledge_completion_request_ready","request ready");
assert(request.completion_required===true,"completion required");
assert(request.question===missing.question,"question preserved");
assert(request.subject.id==="hv_substations","subject preserved");
assert(request.next_action==="acquisition","starts at acquisition");
assert(request.answer_rebuild_required===false,"answer rebuild waits");

assert(request.orchestrator_run.status==="knowledge_completion_planned","orchestrator planned");
assert(request.orchestrator_run.current_stage==="acquisition","orchestrator acquisition first");
assert(request.orchestrator_run.answer_ready===false,"orchestrator answer not ready");
assert(request.orchestrator_run.projection_release===false,"orchestrator projection held");

assert(request.execution_plan.mode==="plan_only","bridge plan only");
assert(request.execution_plan.external_execution_enabled===false,"external disabled");
assert(request.execution_plan.graph_write_enabled===false,"graph write disabled");
assert(
  request.execution_plan.stages.find(x=>x.stage==="evidence_execution").execution_state==="gated",
  "evidence execution gated"
);
assert(
  request.execution_plan.stages.find(x=>x.stage==="graph_writer").execution_state==="gated",
  "graph writer gated"
);

assert(Object.values(request.contracts).every(Boolean),"all contracts");
assert(Object.values(request.safeguards).every(v=>v===false),"all safeguards false");

const sufficient = {
  question:"What are the HV substation equipment?",
  subject_match:{id:"hv_substations",label:"HV Substations"},
  knowledge_completion:{
    knowledge_status:"sufficient",
    completion_required:false,
    answer_ready:true
  }
};

const noAction = await adapter.buildKnowledgeCompletionRequest(sufficient,{
  orchestrator_path:orchestratorPath,
  bridge_path:bridgePath
});

assert(noAction.status==="knowledge_completion_not_required","sufficient no completion");
assert(noAction.orchestrator_run===null,"no orchestrator when sufficient");
assert(noAction.execution_plan===null,"no bridge when sufficient");
assert(noAction.answer_rebuild_required===true,"supported knowledge can rebuild answer");
assert(noAction.projection_policy.broad_projection_suppressed===false,"projection not suppressed");

let unresolvedBlocked=false;
try{
  await adapter.buildKnowledgeCompletionRequest({
    question:"What equipment is included?",
    knowledge_completion:{
      knowledge_status:"insufficient",
      completion_required:true,
      knowledge_contract:{contract_id:"component_membership"}
    }
  },{
    orchestrator_path:orchestratorPath,
    bridge_path:bridgePath
  });
}catch(e){
  unresolvedBlocked=String(e.message).includes("resolved semantic subject");
}
assert(unresolvedBlocked,"unresolved subject blocked");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_request_adapter_test_passed",
  missing_case:{
    question:request.question,
    subject:request.subject,
    status:request.status,
    next_action:request.next_action,
    orchestrator_status:request.orchestrator_run.status,
    bridge_mode:request.execution_plan.mode,
    evidence_execution_state:request.execution_plan.stages.find(x=>x.stage==="evidence_execution").execution_state,
    graph_writer_state:request.execution_plan.stages.find(x=>x.stage==="graph_writer").execution_state,
    broad_projection_suppressed:request.projection_policy.broad_projection_suppressed
  },
  sufficient_case:{
    status:noAction.status,
    answer_rebuild_required:noAction.answer_rebuild_required,
    broad_projection_suppressed:noAction.projection_policy.broad_projection_suppressed
  },
  unresolved_subject_case:{
    blocked:unresolvedBlocked
  },
  contracts:request.contracts,
  safeguards:request.safeguards
},null,2));
