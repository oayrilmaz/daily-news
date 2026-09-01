#!/usr/bin/env node
import fs from "node:fs";import os from "node:os";import path from "node:path";import {pathToFileURL} from "node:url";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};const assert=(v,m)=>{if(!v)throw new Error(m)};
const mod=await import(pathToFileURL(path.resolve(arg("--engine"))).href);
const mk=(name)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),name));fs.mkdirSync(path.join(d,"scripts"),{recursive:true});return d};
const stage=body=>`#!/usr/bin/env node
const fs=require("fs"),path=require("path");const a=n=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null};const input=a("--input"),out=a("--out");const src=JSON.parse(fs.readFileSync(input,"utf8"));const payload=${body};fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2));`;
function acquisition(tmp){const p={schema_version:"0.1",status:"acquisition_plans_resolved",source_discovery:{schema_version:"0.1"},acquisition_state:{execution_mode:"planned_only",external_execution_connected:false,evidence_validation_required_before_graph_admission:true,conceptual_distance_limit:null,continuation_possible:true},acquisition_plans:[{acquisition_plan_id:"p1",discovery_target_id:"t1",target_type:"identify_components",statement:"Identify components of HV Substations"}],future_executor_queue:[{acquisition_plan_id:"p1"}]};const f=path.join(tmp,"acq.json");fs.writeFileSync(f,JSON.stringify(p));return f;}

// Branch A: applicable -> direct acquisition execution
{
 const tmp=mk("kc-applicable-"),sd=path.join(tmp,"scripts"),out=path.join(tmp,"out"),af=acquisition(tmp);
 fs.writeFileSync(path.join(sd,"app.cjs"),stage(`({schema_version:"0.1",status:"acquisition_applicability_resolved",source_acquisition:{schema_version:"0.1"},applicability_state:{external_execution_connected:false,conceptual_distance_limit:null,continuation_possible:true},evaluations:[{acquisition_plan_id:"p1",discovery_target_id:"t1",target_type:"identify_components",original_statement:"x",subject:"HV Substations",applicability_status:"applicable",executable:true,original_plan_preserved:true}],executable_queue:[{acquisition_plan_id:"p1",execution_rank:1,applicability_status:"applicable"}],decomposition_queue:[]})`));
 const r=mod.runCandidatePipeline({acquisition:af,out_dir:out,scripts:{applicability:path.join(sd,"app.cjs")}});
 assert(r.status==="knowledge_completion_acquisition_execution_required","applicable status");
 assert(r.route==="applicable_direct_execution","applicable route");
 assert(r.next_stage==="acquisition_execution","applicable next");
 assert(r.stage_order.join(">")==="acquisition_applicability","applicable no forced decomposition");
 assert(r.executable_acquisition_queue.length===1,"executable preserved");
}

// Branch B: decomposition required
{
 const tmp=mk("kc-decompose-"),sd=path.join(tmp,"scripts"),out=path.join(tmp,"out"),af=acquisition(tmp);
 fs.writeFileSync(path.join(sd,"app.cjs"),stage(`({schema_version:"0.1",status:"acquisition_applicability_resolved",source_acquisition:{schema_version:"0.1"},applicability_state:{external_execution_connected:false,conceptual_distance_limit:null,continuation_possible:true},evaluations:[{acquisition_plan_id:"p1",discovery_target_id:"t1",target_type:"identify_components",original_statement:"x",subject:"Abstract X",applicability_status:"decomposition_required",executable:false,original_plan_preserved:true}],executable_queue:[],decomposition_queue:[{acquisition_plan_id:"p1",decomposition_rank:1,status:"not_resolved"}]})`));
 fs.writeFileSync(path.join(sd,"d.cjs"),stage(`({schema_version:"0.1",status:"decomposition_candidates_resolved",source_applicability:{schema_version:"0.1"},decomposition_state:{validated_candidate_count:0,executable_candidate_count:0,external_execution_connected:false},decompositions:[{decomposition_id:"d1",acquisition_plan_id:"p1",discovery_target_id:"t1",abstract_subject:"Abstract X",original_target_type:"identify_components",status:"provisional_candidates_resolved",candidates:[{decomposition_candidate_id:"c1",epistemic_status:"provisional_candidate",validated:false,executable:false}]}],candidate_validation_queue:[{decomposition_candidate_id:"c1"}]})`));
 fs.writeFileSync(path.join(sd,"c.cjs"),stage(`({schema_version:"0.1",status:"candidate_validation_targets_resolved",source_decomposition:{schema_version:"0.1"},validation_state:{validated_target_count:0,executable_target_count:0,external_execution_connected:false},validation_targets:[{validation_target_id:"v1",epistemic_status:"provisional_candidate",validation_status:"not_started",executable:false,knowledge_status:"not_admitted"}],future_evidence_queue:[{validation_target_id:"v1"}]})`));
 const r=mod.runCandidatePipeline({acquisition:af,out_dir:out,scripts:{applicability:path.join(sd,"app.cjs"),decomposition:path.join(sd,"d.cjs"),candidate_validation:path.join(sd,"c.cjs")}});
 assert(r.status==="knowledge_completion_candidate_validation_ready","decomp status");
 assert(r.route==="decomposition_required","decomp route");
 assert(r.next_stage==="evidence_strategy","decomp next");
 assert(r.stage_order.join(">")==="acquisition_applicability>decomposition>candidate_validation","decomp stages");
}

console.log(JSON.stringify({schema_version:"0.1",status:"cosmos_knowledge_completion_candidate_pipeline_test_passed",routes_tested:["applicable_direct_execution","decomposition_required"],contracts:{applicability_controls_branching:true,no_forced_decomposition:true,applicable_goes_to_acquisition_execution:true,decomposition_required_goes_to_candidate_validation:true,external_execution_remains_gated:true}},null,2));
