#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const {planSemanticKnowledgeCompletion}=await import(
  pathToFileURL(path.resolve(arg("--engine","scripts/cosmos_semantic_knowledge_completion_v0.1.mjs"))).href
);

const baseQuestion={
  question:"What are the HV substation equipment?",
  classification:{type:"enumeration",subtype:"equipment_list"},
  subject_match:{id:"hv_substations",label:"HV Substations",score:710},
  entities:[
    {entity_id:"hv_substations",name:"HV Substations",description:"High-voltage substations transform, switch, measure and protect electric power."},
    {entity_id:"developers",name:"Developers"},
    {entity_id:"manufacturing",name:"Manufacturing"},
    {entity_id:"power_transformers",name:"Power Transformers"},
    {entity_id:"circuit_breakers",name:"Circuit Breakers"}
  ]
};

const missing=planSemanticKnowledgeCompletion({
  ...baseQuestion,
  relationships:[
    {relationship_id:"r1",from_entity_id:"hv_substations",to_entity_id:"developers",relationship_type:"associated with"},
    {relationship_id:"r2",from_entity_id:"hv_substations",to_entity_id:"manufacturing",relationship_type:"affected by"}
  ]
});

assert(missing.status==="cosmos_semantic_knowledge_completion_planned","status");
assert(missing.knowledge_status==="insufficient","missing case should be insufficient");
assert(missing.answer_ready===false,"missing case must not be answer-ready");
assert(missing.supported_members.length===0,"irrelevant graph neighbors must not become equipment");
assert(missing.completion_required===true,"completion required");
assert(missing.projection_policy.keep_question_as_observer===true,"question observer");
assert(missing.projection_policy.suppress_broad_intelligence_projection_until_answer_supported===true,"broad projection must be gated");
assert(missing.completion_tasks.some(x=>x.action==="knowledge_admission"),"must reuse knowledge admission");
assert(JSON.stringify(missing).includes("Power Transformers")===false,"planner must not invent known fixture equipment as missing candidates");

const complete=planSemanticKnowledgeCompletion({
  ...baseQuestion,
  relationships:[
    {
      relationship_id:"r3",
      from_entity_id:"hv_substations",
      to_entity_id:"power_transformers",
      relationship_type:"includes equipment",
      confidence:0.95,
      evidence_ids:["ev1"]
    },
    {
      relationship_id:"r4",
      from_entity_id:"hv_substations",
      to_entity_id:"circuit_breakers",
      relationship_type:"includes equipment",
      confidence:0.94,
      evidence_ids:["ev2"]
    }
  ]
});

assert(complete.knowledge_status==="sufficient","supported case should be sufficient");
assert(complete.answer_ready===true,"supported case should be answer-ready");
assert(complete.supported_members.length===2,"supported equipment count");
assert(complete.supported_members.some(x=>x.label==="Power Transformers"),"transformer relation");
assert(complete.supported_members.some(x=>x.label==="Circuit Breakers"),"breaker relation");
assert(complete.completion_tasks.length===0,"no completion tasks when sufficient");
assert(complete.projection_policy.allow_current_intelligence_after_direct_answer===true,"intelligence allowed after answer");
assert(Object.values(complete.contracts).every(Boolean),"contracts");
assert(Object.values(complete.safeguards).every(v=>v===false),"safeguards");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_semantic_knowledge_completion_test_passed",
  tested_question:baseQuestion.question,
  missing_case:{
    knowledge_status:missing.knowledge_status,
    supported_members:missing.supported_members.length,
    completion_task_count:missing.completion_tasks.length,
    broad_projection_suppressed:missing.projection_policy.suppress_broad_intelligence_projection_until_answer_supported
  },
  supported_case:{
    knowledge_status:complete.knowledge_status,
    supported_members:complete.supported_members.map(x=>x.label),
    answer_ready:complete.answer_ready,
    current_intelligence_allowed:complete.projection_policy.allow_current_intelligence_after_direct_answer
  },
  contracts:complete.contracts,
  safeguards:complete.safeguards
},null,2));
