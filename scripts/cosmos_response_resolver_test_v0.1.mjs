#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {pathToFileURL} from "node:url";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const {resolveCosmosResponse}=await import(pathToFileURL(path.resolve(arg("--engine","scripts/cosmos_response_resolver_v0.1.mjs"))).href);

const datasets={
  dailyBrief:{items:[
    {development_id:"dev_data_center",title:"Data-center load growth increases substation pressure",summary:"Utilities are evaluating transformer and substation capacity as high-density computing load expands.",tags:["data-centers","transformers"],entity_ids:["ent_data_centers","ent_transformers"]},
    {development_id:"dev_transformer",title:"Transformer procurement pressure remains elevated",summary:"Long lead times continue to affect project schedules.",tags:["transformers","procurement"],entity_ids:["ent_transformers"]}
  ]},
  entities:{entities:[
    {entity_id:"ent_data_centers",name:"Data Centers",description:"Facilities that host high-density computing infrastructure."},
    {entity_id:"ent_transformers",name:"Transformers",description:"Electrical equipment used to change voltage levels."}
  ]}
};

const news=resolveCosmosResponse({question:"Provide today news"},datasets);
const topic=resolveCosmosResponse({question:"Data Centers"},datasets);
const media=resolveCosmosResponse({question:"Show me videos about transformers"},datasets);

assert(news.intent.id==="daily_intelligence","News intent failed");
assert(news.response.bullets.length===2,"News bullets missing");
assert(news.response_observer.type==="response","Response observer missing");
assert(news.next_projection.projection_seed_ids.includes("dev_data_center"),"News projection seed missing");
assert(topic.intent.id==="topic","Topic intent failed");
assert(topic.response.title==="Data Centers","Topic entity resolution failed");
assert(topic.response.answer.includes("Facilities that host"),"Entity description missing");
assert(topic.response.bullets.length>=1,"Topic current intelligence missing");
assert(media.intent.id==="media"&&media.next_projection.materialize_view==="media","Media materialization failed");

for(const r of [news,topic,media]){
  assert(Object.values(r.contracts).every(Boolean),"Contract failed");
  assert(Object.values(r.safeguards).every(v=>v===false),"Safeguard failed");
}

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_response_resolver_test_passed",
  cases:{
    today_news:{title:news.response.title,bullet_count:news.response.bullets.length,projection_seed_count:news.next_projection.projection_seed_ids.length},
    topic:{title:topic.response.title,bullet_count:topic.response.bullets.length,projection_seed_count:topic.next_projection.projection_seed_ids.length},
    media:{view:media.next_projection.materialize_view}
  },
  contracts:news.contracts,
  safeguards:news.safeguards
},null,2));
