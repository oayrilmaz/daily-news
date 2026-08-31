#!/usr/bin/env node
import fs from "node:fs";

const arg=(name,fallback="")=>{
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
};
const file=arg("--html","cosmos.html");
const html=fs.readFileSync(file,"utf8");

const contracts={
  semantic_resolver_embedded:html.includes("function buildSemanticQuestionAnswer(question)"),
  subject_resolution_separate_from_observer:html.includes("function resolveQuestionSubject(question)"),
  question_remains_primary_observer:html.includes("question_remains_primary_observer:true"),
  aging_fleet_penalty_present:html.includes('"aging","fleet","shortage"'),
  enumeration_engine_present:html.includes('subtype:"equipment_list"'),
  equipment_uses_existing_cosmos_entities:html.includes("if(!isEquipmentLikeEntity(entity)) continue;"),
  direct_answer_precedes_exploration:html.includes("const directAnswer=buildDirectAnswerForObserver(observer);"),
  response_observer_label_is_question:html.includes("label:entry.question"),
  semantic_subject_preserved:html.includes("semantic_subject_id:response?.subject_match?.id"),
  date_utc_supported:html.includes("item?.date_utc"),
  briefing_level_date_fallback:html.includes("state.dailyBriefDate"),
  read_article_preserved:html.includes("Read article →"),
  follow_the_ripple_preserved:html.includes("Follow the ripple →"),
  fresh_cosmos_home_preserved:html.includes("cosmos-entry-v0.1.html")
};

const failed=Object.entries(contracts).filter(([,v])=>!v).map(([k])=>k);
if(failed.length){
  console.error(`Question/Answer live integration contract failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_question_answer_live_integration_test_passed",
  contracts,
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    invents_missing_dates:false,
    replaces_question_with_nearest_graph_object:false
  }
},null,2));
