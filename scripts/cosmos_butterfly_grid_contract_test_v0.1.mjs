#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {pathToFileURL} from "url";
const arg=(n,d)=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const ok=(v,m)=>{if(!v)throw new Error(m)};
const engine=path.resolve(arg("--engine","scripts/cosmos_butterfly_grid_contract_v0.1.mjs"));
const {buildButterflyGridContract}=await import(pathToFileURL(engine).href);
const files=[
  ["signal",arg("--signal","projection-signal.json")],
  ["transformers",arg("--transformers","projection-transformers.json")],
  ["materials",arg("--materials","projection-materials.json")]
];
const results=[];
for(const [name,file] of files){
  const projection=JSON.parse(fs.readFileSync(path.resolve(file),"utf8"));
  const c=buildButterflyGridContract({projection,maxInitialNodes:8,maxInitialEdges:14});
  ok(c.status==="butterfly_grid_contract_resolved",`${name}: unresolved`);
  ok(c.center.id===projection.focus.id,`${name}: center mismatch`);
  ok(c.initial_view.nodes.find(n=>n.is_center)?.projection_distance===0,`${name}: center distance`);
  ok(c.initial_view.edges.some(e=>e.relation_class==="cross_link"),`${name}: cross-link missing`);
  ok(c.visual_semantics.renderer_agnostic===true,`${name}: renderer`);
  ok(c.visual_semantics.fixed_xy_coordinates_provided===false,`${name}: fixed XY`);
  ok(c.visual_semantics.fixed_radial_layout_required===false,`${name}: fixed radial`);
  ok(c.safeguards.forces_tree_structure===false,`${name}: tree`);
  ok(c.safeguards.fabricates_confidence_components===false,`${name}: confidence fabrication`);
  ok(c.initial_view.edges.every(e=>e.interaction.can_follow_ripple&&e.interaction.can_explain_confidence),`${name}: actions`);
  ok(c.initial_view.edges.every(e=>e.confidence_explanation.decomposed_components_available===false),`${name}: decomposed confidence`);
  ok(c.article_integration_contract.standalone_follow_the_ripple_section_required===false,`${name}: duplicate ripple`);
  results.push(c);
}
ok(results[0].center.id==="signal","signal center");
ok(results[1].center.id==="transformers","transformers center");
ok(results[2].center.id==="materials","materials center");
console.log(JSON.stringify({
  schema_version:"0.1",status:"butterfly_grid_contract_test_passed",
  centers_tested:results.map(r=>r.center),
  visual_semantics:results[0].visual_semantics,
  navigation_contract:results[0].navigation_contract,
  article_integration_contract:results[0].article_integration_contract,
  safeguards:results[0].safeguards
},null,2));
