#!/usr/bin/env node
import path from "node:path";
import {pathToFileURL} from "node:url";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const {resolveQuestionAnswer}=await import(pathToFileURL(path.resolve(arg("--engine","scripts/cosmos_question_answer_resolver_v0.1.mjs"))).href);

const input={
  question:"What are the HV substation equipment?",
  entities:[
    {
      entity_id:"hv_substation_equipment",
      name:"HV Substation Equipment",
      description:"High-voltage substations combine primary equipment, protection, control and auxiliary systems.",
      equipment:[
        "Power Transformers","Circuit Breakers","Disconnect Switches","Gas-Insulated Switchgear",
        "Instrument Transformers","Surge Arresters","Busbars","Protection & Control Systems","Station Service Systems"
      ]
    },
    {
      entity_id:"aging_substation_fleet",
      name:"Aging Substation Fleet",
      description:"Existing substations with legacy equipment reaching end-of-life."
    }
  ],
  intelligence:[
    {development_id:"dev1",title:"Transformer manufacturing capacity stressed by critical-minerals and component bottlenecks",summary:"Lead-times remain elevated.",created_at:"2026-08-31T05:00:00Z",entity_ids:["hv_substation_equipment"],tags:["transformers","substations"]},
    {development_id:"dev2",title:"Prefabricated modular substations shorten commissioning",summary:"Standardized interfaces remain important.",published_at:"2026-08-29T12:00:00Z",entity_ids:["hv_substation_equipment"],tags:["substations"]},
    {development_id:"dev3",title:"Substation monitoring expands",summary:"Predictive maintenance grows.",entity_ids:["hv_substation_equipment"],tags:["substations"]}
  ]
};

const r=resolveQuestionAnswer(input);
assert(r.status==="cosmos_question_answer_resolved","status");
assert(r.question_remains_primary_observer===true,"question observer contract");
assert(r.subject_match?.id==="hv_substation_equipment","wrong subject match");
assert(r.answer.answer_type==="equipment_list","wrong answer type");
assert(r.answer.items.includes("Power Transformers"),"equipment list missing");
assert(!r.answer.title.includes("Aging"),"nearest unrelated node replaced answer");
assert(r.intelligence.length===3,"intelligence context missing");
assert(r.intelligence.some(x=>x.date_display==="Date unavailable"),"missing date must be explicit");
assert(r.intelligence.some(x=>x.date_display!=="Date unavailable"),"available dates must be preserved");
assert(r.intelligence.every(x=>x.follow_the_ripple===true),"ripple missing");
assert(Object.values(r.contracts).every(Boolean),"contracts");
assert(Object.values(r.safeguards).every(v=>v===false),"safeguards");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_question_answer_resolver_test_passed",
  subject_match:r.subject_match,
  answer_preview:r.answer.text,
  answer_item_count:r.answer.items.length,
  intelligence_count:r.intelligence.length,
  dated_items:r.intelligence.filter(x=>x.date_display!=="Date unavailable").length,
  undated_items:r.intelligence.filter(x=>x.date_display==="Date unavailable").length,
  contracts:r.contracts,
  safeguards:r.safeguards
},null,2));
