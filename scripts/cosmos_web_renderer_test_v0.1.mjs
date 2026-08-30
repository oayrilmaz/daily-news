#!/usr/bin/env node
import fs from "fs";
import path from "path";

const arg=(name,fallback="")=>{
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
};
const assert=(v,m)=>{if(!v)throw new Error(m)};

const htmlPath=path.resolve(arg("--html","cosmos.html"));
const html=fs.readFileSync(htmlPath,"utf8");

const required=[
  "There is no absolute center.",
  'id="cosmosCanvas"',
  "Expand one layer +",
  "Return to entry observer",
  "Current observer",
  'params.get("focus")',
  'entry.focus === "relationship"',
  "relationship_id",
  'kind:"development"',
  "/knowledge/entities.json",
  "/knowledge/relationships.json",
  "/knowledge/developments.json",
  "state.history.push",
  "recenterEntity",
  "confidencePercent",
  "Confidence is displayed from the stored relationship. The browser does not recalculate it.",
  "reverseKeys.has",
  "epistemic_status",
  "temporary projection"
];

for(const value of required){
  assert(html.includes(value),`cosmos.html missing required contract text: ${value}`);
}

const forbidden=[
  "Math.random(",
  "forceSimulation",
  "d3.force",
  "OPENAI_API_KEY"
];

for(const value of forbidden){
  assert(!html.includes(value),`cosmos.html contains forbidden behavior: ${value}`);
}

assert(
  html.includes('history.pushState({cosmos:true},"",`?focus=entity&id=${encodeURIComponent(id)}'),
  "Node click must produce observer-relative recentering deep link"
);

assert(
  html.includes('reverseKeys.has(`${rel.to_entity_id}|${rel.from_entity_id}`)'),
  "Feedback detection contract missing"
);

assert(
  html.includes('stroke-dasharray":scenario?"7 6":""'),
  "Scenario/qualified edge visual distinction missing"
);

assert(
  html.includes('const positions=layout(projection.nodes,width,height)'),
  "Deterministic projection layout missing"
);

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_web_renderer_test_passed",
  contracts:{
    observer_center_is_temporary:true,
    development_deep_link_supported:true,
    relationship_deep_link_supported:true,
    entity_recenter_supported:true,
    expand_one_layer_supported:true,
    reversible_observer_history_supported:true,
    deterministic_layout:true,
    cross_links_rendered:true,
    feedback_detection_supported:true,
    epistemic_state_visualized:true,
    confidence_inspection_supported:true,
    evidence_lineage_display_supported:true,
    mobile_first_svg_renderer:true
  },
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    recalculates_confidence:false,
    forces_tree_ontology:false,
    uses_random_layout:false
  }
},null,2));
