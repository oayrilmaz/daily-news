#!/usr/bin/env node
import fs from "fs"; import os from "os"; import path from "path"; import {spawnSync} from "child_process";
const d=fs.mkdtempSync(path.join(os.tmpdir(),"cosmos-answer-rebuild-"));
const g=path.join(d,"graph.json"),o=path.join(d,"answer.json");
fs.writeFileSync(g,JSON.stringify({schema_version:"0.1",status:"cosmos_graph_snapshot",knowledge_records:[
{graph_record_id:"g1",knowledge_admission_id:"a1",validation_target_id:"validation_power_transformer",validation_disposition:"supported",confidence_score:75,confidence_band:"high",persistence_level:"persistent_knowledge",evidence_record_ids:["e1","e2"],active:true,reversibility:{reversible:true},semantic_claim:{subject:{id:"hv_substations",label:"HV Substations"},predicate:{type:"CONTAINS_COMPONENT",label:"contains equipment"},object:{id:"power_transformer",label:"Power Transformer",class:"component_or_equipment"},answer_role:null,semantic_status:"persistent_validated_semantic_claim"}},
{graph_record_id:"g2",knowledge_admission_id:"a2",validation_target_id:"validation_circuit_breaker",validation_disposition:"supported",confidence_score:75,confidence_band:"high",persistence_level:"persistent_knowledge",evidence_record_ids:["e3","e4"],active:true,reversibility:{reversible:true},semantic_claim:{subject:{id:"hv_substations",label:"HV Substations"},predicate:{type:"CONTAINS_COMPONENT",label:"contains equipment"},object:{id:"circuit_breaker",label:"Circuit Breaker",class:"component_or_equipment"},answer_role:null,semantic_status:"persistent_validated_semantic_claim"}}
],audit_log:[]},null,2));
const r=spawnSync(process.execPath,["scripts/cosmos_persistent_knowledge_answer_rebuild_v0.1.mjs","--graph",g,"--question","What are the HV substation equipment?","--subject-id","hv_substations","--out",o],{encoding:"utf8"});
if(r.status!==0) throw Error(r.stderr||r.stdout);
const x=JSON.parse(fs.readFileSync(o));
if(x.status!=="persistent_knowledge_answer_rebuilt"||x.answer.items.length!==2) throw Error("Answer rebuild failed");
if(x.routing.answered_from_persistent_cosmos_knowledge!==true||x.routing.knowledge_completion_required!==false||x.routing.acquisition_requested!==false||x.routing.external_search_requested!==false||x.routing.ai_requested!==false) throw Error("Routing failed");
if(x.answer.primary_items.length||x.answer.secondary_items.length||x.answer.more_items.length||x.answer.unclassified_items.length!==2) throw Error("Answer role was invented");
const labels=x.answer.items.map(i=>i.label).sort();
if(JSON.stringify(labels)!==JSON.stringify(["Circuit Breaker","Power Transformer"])) throw Error("Persistent semantic labels not used");
for(const i of x.answer.items) if(i.confidence_score!==75||i.evidence_record_ids.length!==2||i.reversible!==true) throw Error("Lineage/confidence/reversibility lost");
console.log("Persistent Knowledge Answer Rebuild v0.1 test passed.");
