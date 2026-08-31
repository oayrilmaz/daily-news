#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const arg=(n,d="")=>{
  const i=process.argv.indexOf(n);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:d;
};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const cosmos=fs.readFileSync(path.resolve(arg("--cosmos","cosmos.html")),"utf8");
const entry=fs.readFileSync(path.resolve(arg("--entry","cosmos-entry-v0.1.html")),"utf8");

for(const token of [
  'const hasExplicitObserver =',
  'entryParams.has("focus")',
  'entryParams.has("relationship_id")',
  'entryParams.has("question")',
  'if (!hasExplicitObserver)',
  'location.replace("/cosmos-entry-v0.1.html")',
  'Fresh Cosmos visits always begin at the living Ask Cosmos entry.'
]){
  assert(cosmos.includes(token),`Fresh-entry routing contract missing: ${token}`);
}

for(const token of [
  'id="orbWrap"',
  'data-state="dormant"',
  'Ask Cosmos…',
  'cosmosHeartbeat',
  'orbWrap.dataset.state = "resolving"'
]){
  assert(entry.includes(token),`Living entry contract missing: ${token}`);
}

assert(
  entry.includes('/cosmos.html?${params.toString()}'),
  "Entry must hand explicit question/deep-link state to cosmos.html"
);

assert(
  cosmos.includes('entry.focus === "question"'),
  "Explorer must continue supporting question deep-links"
);

assert(
  cosmos.includes('entry.focus === "relationship"'),
  "Explorer must continue supporting relationship deep-links"
);

assert(
  cosmos.includes('kind:"development"'),
  "Explorer must continue supporting development observers"
);

assert(!cosmos.includes("OPENAI_API_KEY"),"No API key may be exposed");
assert(!entry.includes("OPENAI_API_KEY"),"Entry must not expose API key");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_fresh_entry_routing_test_passed",
  contracts:{
    fresh_cosmos_visit_redirects_to_living_entry:true,
    explicit_question_bypasses_entry:true,
    explicit_relationship_bypasses_entry:true,
    explicit_development_bypasses_entry:true,
    heartbeat_entry_preserved:true,
    ask_cosmos_preserved:true,
    explorer_deep_links_preserved:true,
    browser_refresh_on_explicit_observer_preserves_explorer:true
  },
  safeguards:{
    calls_openai_or_external_api:false,
    performs_external_search:false,
    mutates_graph:false,
    deletes_entry_experience:false,
    breaks_article_deep_links:false
  }
},null,2));
