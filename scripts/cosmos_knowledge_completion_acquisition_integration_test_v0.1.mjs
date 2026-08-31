#!/usr/bin/env node
/**
 * Repository integration test:
 * request-adapter output -> acquisition handoff -> actual cosmos_acquisition.cjs
 *
 * This intentionally executes only the Acquisition PLANNER.
 * Cosmos Acquisition v0.1 is expected to remain planned_only and disconnected
 * from external execution.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const assert=(v,m)=>{if(!v)throw new Error(m)};
const root=process.cwd();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"cosmos-kc-acquisition-"));
const handoffMod=await import(pathToFileURL(path.join(
  root,"scripts/cosmos_knowledge_completion_acquisition_handoff_v0.1.mjs"
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
    required_relationship_semantics:["contains","includes","component","equipment","part of"]
  }
};

const handoff=handoffMod.buildAcquisitionHandoff(request);
const inFile=path.join(tmp,"discovery-handoff.json");
const outFile=path.join(tmp,"acquisition.json");
fs.writeFileSync(inFile,JSON.stringify(handoff,null,2));

const r=spawnSync(process.execPath,[
  "scripts/cosmos_acquisition.cjs",
  "--input",inFile,
  "--out",outFile
],{cwd:root,encoding:"utf8"});

if(r.status!==0){
  throw new Error(`cosmos_acquisition.cjs rejected Knowledge Completion handoff:\n${r.stderr||r.stdout}`);
}

assert(fs.existsSync(outFile),"acquisition output missing");
const acq=JSON.parse(fs.readFileSync(outFile,"utf8"));
const plans=acq.acquisition_plans||[];
const queue=acq.future_executor_queue||[];

assert(acq.schema_version==="0.1","acquisition schema");
assert(acq.status==="acquisition_plans_resolved","acquisition resolved");
assert(plans.length>=1,"acquisition plan generated");
assert(queue.length===plans.length,"executor queue aligned");
assert(acq.acquisition_state?.execution_mode==="planned_only","planned only");
assert(acq.acquisition_state?.external_execution_connected===false,"external disconnected");
assert(acq.acquisition_state?.evidence_validation_required_before_graph_admission===true,"validation required");

const targetId=handoff.discovery_targets.items[0].discovery_target_id;
assert(plans.some(x=>x.discovery_target_id===targetId),"handoff lineage preserved");
assert(plans.every(x=>x.execution?.network_execution_performed===false),"no network execution");
assert(plans.every(x=>x.execution?.executor_status==="not_connected"),"executor disconnected");
assert(plans.every(x=>x.evidence_contract?.evidence_is_not_knowledge_until_validated===true),"evidence boundary");
assert(plans.every(x=>x.evidence_contract?.knowledge_admission_status==="not_evaluated"),"admission not evaluated");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_knowledge_completion_acquisition_integration_test_passed",
  question:request.question,
  subject:request.subject,
  discovery_target_id:targetId,
  acquisition:{
    status:acq.status,
    plan_count:plans.length,
    executor_queue_count:queue.length,
    execution_mode:acq.acquisition_state.execution_mode,
    external_execution_connected:acq.acquisition_state.external_execution_connected,
    evidence_validation_required_before_graph_admission:
      acq.acquisition_state.evidence_validation_required_before_graph_admission
  },
  safeguards:{
    external_search_performed:false,
    openai_or_external_api_called:false,
    evidence_invented:false,
    graph_mutated:false
  }
},null,2));
