#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const mod=await import(pathToFileURL(path.resolve(
  arg("--engine","scripts/cosmos_knowledge_completion_execution_bridge_v0.1.mjs")
)).href);

const run={
  schema_version:"0.1",
  run_id:"kc:hv_substations:component_membership",
  question:"What are the HV substation equipment?",
  subject:{id:"hv_substations",label:"HV Substations"},
  stage_order:[
    "acquisition",
    "acquisition_applicability",
    "decomposition",
    "candidate_validation",
    "evidence_strategy",
    "evidence_execution",
    "evidence_validation",
    "knowledge_admission",
    "graph_writer",
    "answer_rebuild"
  ]
};

const plan=mod.buildExecutionPlan(run);

assert(plan.status==="knowledge_completion_execution_plan_ready","plan ready");
assert(plan.mode==="plan_only","plan-only default");
assert(plan.stage_count===9,"nine executable existing stages");
assert(plan.external_execution_enabled===false,"external disabled");
assert(plan.graph_write_enabled===false,"graph write disabled");

const evidence=plan.stages.find(x=>x.stage==="evidence_execution");
const writer=plan.stages.find(x=>x.stage==="graph_writer");

assert(evidence.execution_state==="gated","evidence execution gated");
assert(evidence.gated_reason==="external_execution_disabled","external gate reason");
assert(writer.execution_state==="gated","writer gated");
assert(writer.gated_reason==="graph_write_disabled","writer gate reason");

assert(plan.contracts.reuses_existing_cosmos_stage_scripts===true,"reuse scripts");
assert(plan.contracts.preserves_existing_cli_boundaries===true,"preserve CLI");
assert(plan.contracts.graph_writer_remains_only_mutation_boundary===true,"writer boundary");
assert(Object.values(plan.safeguards).every(v=>v===false),"safeguards false");

const enabled=mod.buildExecutionPlan(run,{
  mode:"controlled_execute",
  external_execution_enabled:true,
  graph_write_enabled:true
});
assert(enabled.stages.find(x=>x.stage==="evidence_execution").execution_state==="ready_for_input","evidence can be explicitly enabled");
assert(enabled.stages.find(x=>x.stage==="graph_writer").execution_state==="ready_for_input","writer can be explicitly enabled");

let externalBlocked=false;
try{
  mod.executeStage("evidence_execution",{strategy:"missing",adapter_results:"missing",out:"x.json"});
}catch(e){
  externalBlocked=String(e.message).includes("external_execution_enabled");
}
assert(externalBlocked,"runtime external gate");

let writerBlocked=false;
try{
  mod.executeStage("graph_writer",{admission:"missing",graph:"missing",out:"x.json",report:"r.json"});
}catch(e){
  writerBlocked=String(e.message).includes("graph_write_enabled");
}
assert(writerBlocked,"runtime graph-write gate");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_execution_bridge_test_passed",
  question:run.question,
  subject:run.subject,
  plan:{
    mode:plan.mode,
    executable_stage_count:plan.stage_count,
    external_execution_enabled:plan.external_execution_enabled,
    graph_write_enabled:plan.graph_write_enabled,
    evidence_execution_state:evidence.execution_state,
    graph_writer_state:writer.execution_state
  },
  explicitly_enabled_case:{
    evidence_execution_state:enabled.stages.find(x=>x.stage==="evidence_execution").execution_state,
    graph_writer_state:enabled.stages.find(x=>x.stage==="graph_writer").execution_state
  },
  contracts:plan.contracts,
  safeguards:plan.safeguards
},null,2));
