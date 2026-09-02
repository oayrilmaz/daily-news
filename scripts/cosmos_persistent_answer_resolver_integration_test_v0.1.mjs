#!/usr/bin/env node
import fs from "fs"; import os from "os"; import path from "path"; import {spawnSync} from "child_process";
const d=fs.mkdtempSync(path.join(os.tmpdir(),"cosmos-resolver-test-")),g=path.join(d,"g.json");
const rec=(id,label,ev)=>({graph_record_id:"g_"+id,knowledge_admission_id:"a_"+id,validation_target_id:"validation_"+id,validation_disposition:"supported",confidence_score:75,confidence_band:"high",persistence_level:"persistent_knowledge",evidence_record_ids:ev,active:true,reversibility:{reversible:true},semantic_claim:{subject:{id:"hv_substations",label:"HV Substations"},predicate:{type:"CONTAINS_COMPONENT",label:"contains equipment"},object:{id,label,class:"component_or_equipment"},answer_role:null,semantic_status:"persistent_validated_semantic_claim"}});
fs.writeFileSync(g,JSON.stringify({schema_version:"0.1",status:"cosmos_graph_snapshot",knowledge_records:[rec("power_transformer","Power Transformer",["e1","e2"]),rec("circuit_breaker","Circuit Breaker",["e3","e4"])],audit_log:[]},null,2));
function run(sub,out){const r=spawnSync(process.execPath,["scripts/cosmos_persistent_answer_resolver_integration_v0.1.mjs","--graph",g,"--question","What are the HV substation equipment?","--subject-id",sub,"--out",out],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr||r.stdout);return JSON.parse(fs.readFileSync(out))}
const k=run("hv_substations",path.join(d,"k.json")),u=run("unknown_subject",path.join(d,"u.json"));
if(k.route!=="persistent_cosmos_answer"||k.persistent_answer?.items?.length!==2||k.knowledge_completion_request!==null) throw Error("Known route failed");
if(k.execution.acquisition_executed||k.execution.external_search_executed||k.execution.ai_executed||k.execution.knowledge_completion_executed) throw Error("Known fallback executed");
if(k.projection.first_ring_source!=="persistent_answer_items"||!k.projection.release_supported_answer_projection||k.projection.hold_broad_projection) throw Error("Known projection failed");
if(u.route!=="knowledge_completion"||!u.knowledge_completion_request||u.persistent_answer!==null||!u.projection.hold_broad_projection) throw Error("Unknown route failed");
console.log("Persistent Answer Resolver Integration v0.1 test passed.");
