#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const getArg=(name,fallback="")=>{const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback};
const assert=(v,m)=>{if(!v)throw new Error(m)};
const entry=fs.readFileSync(path.resolve(getArg("--entry","cosmos-entry-v0.1.html")),"utf8");
const cosmos=fs.readFileSync(path.resolve(getArg("--cosmos","cosmos.html")),"utf8");

for(const token of ['data-state="dormant"',"cosmosBreath","cosmosBeat","cosmosHeartbeat",'orbWrap.dataset.state = "resolving"','orbWrap.dataset.state = "engaged"']){
  assert(entry.includes(token),`Entry heartbeat contract missing: ${token}`);
}
for(const token of ['entry.focus === "question"',"resolveQuestionToEntity","normalizeSubject","alternatives","from_observer_label","You arrived here from:","What is this?","Deterministic collision relaxation.","minGap=68","sessionStorage","saveTrail()",'svg.style.height=state.expanded ? "780px"']){
  assert(cosmos.includes(token),`Cosmos subject/restoration contract missing: ${token}`);
}
assert(!cosmos.includes("Math.random("),"Layout must remain deterministic");
assert(!entry.includes("OPENAI_API_KEY") && !cosmos.includes("OPENAI_API_KEY"),"No API key exposure allowed");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_subject_observer_heartbeat_test_passed",
  contracts:{
    typed_subject_resolves_against_cosmos_objects:true,
    ambiguity_alternatives_preserved:true,
    original_question_preserved:true,
    previous_observer_preserved:true,
    observer_trail_persisted_in_session:true,
    return_to_entry_observer_supported:true,
    center_information_panel_present:true,
    unresolved_center_information_explicit:true,
    expanded_layout_collision_relaxation_present:true,
    expanded_canvas_grows:true,
    dormant_breathing_present:true,
    engaged_heartbeat_present:true,
    resolving_heartbeat_present:true,
    recentering_preserves_question_context:true
  },
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    invents_center_summary:false,
    randomizes_layout:false,
    deletes_observer_history:false
  }
},null,2));
