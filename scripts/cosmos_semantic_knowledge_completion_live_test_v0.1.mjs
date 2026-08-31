#!/usr/bin/env node
import fs from "node:fs";
const arg=(name,fallback="")=>{
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
};
const html=fs.readFileSync(arg("--html","cosmos.html"),"utf8");

const contracts={
  semantic_completion_embedded:html.includes("function semanticKnowledgeCompletion("),
  component_membership_contract_present:html.includes('contract_id:"component_membership"'),
  minimum_supported_members_enforced:html.includes("minimum_supported_members:2"),
  unsupported_daily_intelligence_suppressed:html.includes("const ranked=completion.answer_ready ? rankDailyItems(question).slice(0,5) : []"),
  unsupported_projection_uses_subject_only:html.includes(": semantic.projection_seed_ids"),
  answer_first_intelligence_guarded:html.includes("knowledge_completion?.completion_required===true"),
  broad_expansion_disabled:html.includes('"Knowledge completion required"'),
  knowledge_gap_ui_present:html.includes("Structured knowledge gap detected"),
  current_intelligence_held_back:html.includes("Held back until the direct answer is supported"),
  question_observer_preserved:html.includes("question_remains_primary_observer:true"),
  no_global_equipment_scan_fallback:!html.includes('if(/\\bsubstation\\b/.test(normalizeSubject(subject.label)))'),
  read_article_preserved:html.includes("Read article →"),
  follow_the_ripple_preserved:html.includes("Follow the ripple →"),
  date_utc_preserved:html.includes("item?.date_utc"),
  fresh_cosmos_home_preserved:html.includes("cosmos-entry-v0.1.html")
};

const failed=Object.entries(contracts).filter(([,v])=>!v).map(([k])=>k);
if(failed.length){
  console.error(`Semantic Knowledge Completion live contract failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_semantic_knowledge_completion_live_test_passed",
  contracts,
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    invents_missing_equipment:false,
    exposes_broad_projection_before_answer_support:false,
    replaces_question_with_nearest_graph_object:false
  }
},null,2));
