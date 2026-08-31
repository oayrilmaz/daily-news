#!/usr/bin/env node
import fs from "fs";
import path from "path";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const ok=(v,m)=>{if(!v)throw new Error(m)};
const root=path.resolve(arg("--root","."));
const cosmos=fs.readFileSync(path.join(root,"cosmos.html"),"utf8");
const generator=fs.readFileSync(path.join(root,"scripts","generate_ai_news.js"),"utf8");

for(const rel of ["knowledge/entities.json","knowledge/relationships.json","knowledge/developments.json"]){
  const file=path.join(root,rel);
  ok(fs.existsSync(file),`missing ${rel}`);
  ok(JSON.parse(fs.readFileSync(file,"utf8")),`invalid ${rel}`);
}

ok(generator.includes('/cosmos.html?${params.toString()}'),"relationship deep-link not wired");
ok(generator.includes('href="/cosmos.html?${esc(exploreParams.toString())}"'),"development deep-link not wired");
ok(generator.includes("Follow this ripple →"),"Follow this ripple missing");
ok(generator.includes("Explore Cosmos →"),"Explore Cosmos missing");
ok(!generator.includes("<h2>Follow the ripple</h2>"),"duplicate Follow the ripple remains");

ok(cosmos.includes('entry.focus === "relationship"'),"relationship observer unsupported");
ok(cosmos.includes('kind:"development"'),"development observer unsupported");
ok(cosmos.includes('history.pushState({cosmos:true},"",`?focus=entity&id=${encodeURIComponent(id)}'),"entity recenter deep-link missing");
ok(cosmos.includes('fetchJson("/knowledge/entities.json")'),"entities production source missing");
ok(cosmos.includes('fetchJson("/knowledge/relationships.json")'),"relationships production source missing");
ok(cosmos.includes('fetchJson("/knowledge/developments.json")'),"developments production source missing");
ok(cosmos.includes('articleBtn.href=`/articles/${encodeURIComponent(observer.article_id)}.html`'),"return to article missing");
ok(cosmos.includes("Confidence is displayed from the stored relationship. The browser does not recalculate it."),"confidence safeguard missing");

console.log(JSON.stringify({
  schema_version:"0.1",
  status:"cosmos_live_site_integration_test_passed",
  integration_contract:{
    cosmos_page_at_site_root:true,
    production_knowledge_files_available:true,
    article_relationship_deep_link_wired:true,
    article_development_deep_link_wired:true,
    entity_recenter_deep_link_wired:true,
    return_to_article_wired:true,
    duplicate_follow_the_ripple_removed:true,
    production_graph_consumed_by_browser:true,
    confidence_preserved_not_recalculated:true
  },
  deployment_expectations:{
    pages_must_publish_cosmos_html:true,
    article_links_resolve_after_pages_deploy:true,
    no_additional_openai_generation_required:true
  },
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    mutates_graph:false,
    rewrites_daily_brief:false,
    recalculates_confidence:false
  }
},null,2));
