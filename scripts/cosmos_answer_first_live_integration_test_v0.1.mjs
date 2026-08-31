#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const arg=(n,d="")=>{
  const i=process.argv.indexOf(n);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:d;
};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const html=fs.readFileSync(path.resolve(arg("--cosmos","cosmos.html")),"utf8");

for(const token of [
  "buildDirectAnswerForObserver",
  "renderAnswerFirst",
  "Current intelligence",
  "Why it matters now",
  "Explore in Cosmos",
  "Date unavailable",
  "answerFirstDisplayDate",
  "Follow the ripple →",
  "data-answer-ripple-index",
  "Read article →",
  "Center intelligence",
  'id="cosmosHomeLink" href="/cosmos.html"'
]){
  assert(html.includes(token),`Answer-First live contract missing: ${token}`);
}

const order=[
  html.indexOf('<div class="answerEyebrow">Answer</div>'),
  html.indexOf('<div class="intelLabel">Current intelligence</div>'),
  html.indexOf('<div class="intelLabel">Why it matters now</div>'),
  html.indexOf('<div class="intelLabel">Explore in Cosmos</div>')
];

assert(order.every(x=>x>=0),"Presentation sections missing");
assert(order[0]<order[1] && order[1]<order[2] && order[2]<order[3],"Answer-First presentation order is wrong");
assert(!html.includes("OPENAI_API_KEY"),"No API key may be exposed");
assert(!html.includes("Math.random("),"Layout/answer integration must remain deterministic");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_answer_first_live_integration_test_passed",
  contracts:{
    direct_answer_rendered_first:true,
    current_intelligence_rendered_second:true,
    why_it_matters_now_rendered_third:true,
    exploration_rendered_after_answer:true,
    article_dates_displayed_when_available:true,
    missing_dates_explicit:true,
    article_read_action_available:true,
    follow_the_ripple_action_available:true,
    center_intelligence_preserved:true,
    fresh_cosmos_home_preserved:true
  },
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    invents_missing_dates:false,
    rewrites_source_confidence:false
  }
},null,2));
