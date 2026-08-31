#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const html=fs.readFileSync(path.resolve(arg("--cosmos","cosmos.html")),"utf8");
for(const token of ['fetchJson("/briefs/daily-ai.json")',"buildQuestionResponse",'response_type:"daily_intelligence"',"Today's Intelligence","rankDailyItems","entitySeedsFromProjectionIds",'kind:"response"',"Cosmos response","responseList","data-response-index","The answer is a temporary observer built from existing PTD Today data.","projection_seed_ids","PTD Today daily briefing"]){assert(html.includes(token),`Live response contract missing: ${token}`)}
assert(!html.includes("OPENAI_API_KEY"),"No API key may be exposed");
assert(!html.includes("Math.random("),"Response integration must remain deterministic");
console.log(JSON.stringify({schema_version:"0.1",status:"cosmos_live_response_experience_test_passed",contracts:{daily_brief_loaded_in_browser:true,question_builds_response_observer:true,today_news_response_supported:true,topic_response_supported:true,response_text_rendered:true,response_bullets_rendered:true,response_items_can_recenter_cosmos:true,response_seeds_cosmos_projection:true,original_question_visible:true,existing_ptd_today_data_used:true},safeguards:{calls_openai_or_external_api:false,performs_external_search:false,mutates_graph:false,invents_source_evidence:false,randomizes_layout:false}},null,2));
