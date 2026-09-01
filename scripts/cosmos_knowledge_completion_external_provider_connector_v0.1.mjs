#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion External Provider Connector v0.1
 *
 * Executes provider requests produced by External Acquisition Adapter v0.1.
 *
 * Supported modes:
 *   - fixture  : deterministic, no network; intended for tests/preflight
 *   - brave    : Brave Web Search API (requires BRAVE_SEARCH_API_KEY)
 *   - serper   : Google Search via Serper.dev (requires SERPER_API_KEY)
 *   - tavily   : Tavily Search API (requires TAVILY_API_KEY)
 *
 * Live execution requires BOTH:
 *   --execute-live
 *   COSMOS_EXTERNAL_SEARCH_ENABLED=true
 *
 * This module returns raw search observations only. It does not classify
 * source authority, validate facts, admit knowledge, or write the graph.
 */

import fs from "node:fs";
import path from "node:path";
import {URL} from "node:url";

const arr=v=>Array.isArray(v)?v:[];
const txt=v=>typeof v==="string"?v.trim():"";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const has=n=>process.argv.includes(n);
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{const p=path.resolve(f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n")};

function domainOf(url){
  try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase()}catch{return null}
}

function validatePlan(plan){
  if(plan?.schema_version!=="0.1" ||
     plan?.status!=="knowledge_completion_external_acquisition_requests_ready" ||
     plan?.next_stage!=="external_provider_execution"){
    throw new Error("Input must be External Acquisition Adapter v0.1 provider requests.");
  }
  const requests=arr(plan.provider_requests);
  if(!requests.length) throw new Error("No provider requests.");
  for(const r of requests){
    if(!r.provider_request_id||!txt(r.query)||!r.source_constraint?.source_type){
      throw new Error(`Invalid provider request ${r.provider_request_id||"unknown"}.`);
    }
  }
  return requests;
}

function fixtureResults(requests){
  return requests.slice(0,2).map((r,i)=>({
    provider_request_id:r.provider_request_id,
    source_url_or_identifier:`fixture://external-provider/${i+1}`,
    source_type:"unclassified_external_web_result",
    source_title:i===0
      ?"Fixture Technical Search Result"
      :"Fixture Independent Search Result",
    source_publisher_or_owner:i===0?"Fixture Publisher A":"Fixture Publisher B",
    source_date_or_event_date:null,
    retrieved_at:"2026-09-01T00:00:00Z",
    extracted_fact:i===0
      ?"Fixture search snippet mentions power transformers and circuit breakers in a high-voltage substation context."
      :"Fixture independent snippet mentions disconnectors, instrument transformers, and surge arresters in a substation context.",
    supports_or_contradicts:"context_only",
    directness:"unclassified",
    authority_score:0,
    independence_group:i===0?"fixture-a":"fixture-b",
    geography_scope:null,
    temporal_scope:"current",
    entity_ids:[],
    relationship_ids:[],
    query_used:r.query,
    source_rank:i+1,
    requested_source_type:r.source_constraint.source_type,
    requested_authority_score:r.source_constraint.authority_score
  }));
}

async function braveSearch(request,limit){
  const key=txt(process.env.BRAVE_SEARCH_API_KEY);
  if(!key) throw new Error("BRAVE_SEARCH_API_KEY is required for Brave live execution.");
  const u=new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q",request.query);
  u.searchParams.set("count",String(Math.max(1,Math.min(limit,10))));
  const res=await fetch(u,{headers:{"Accept":"application/json","X-Subscription-Token":key}});
  if(!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
  const data=await res.json();
  return arr(data?.web?.results).map((x,i)=>normalizeSearchHit(request,{
    url:x.url,title:x.title,snippet:x.description,published:x.page_age||null,rank:i+1
  }));
}

async function serperSearch(request,limit){
  const key=txt(process.env.SERPER_API_KEY);
  if(!key) throw new Error("SERPER_API_KEY is required for Serper live execution.");
  const res=await fetch("https://google.serper.dev/search",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-API-KEY":key},
    body:JSON.stringify({q:request.query,num:Math.max(1,Math.min(limit,10))})
  });
  if(!res.ok) throw new Error(`Serper search failed: HTTP ${res.status}`);
  const data=await res.json();
  return arr(data?.organic).slice(0,limit).map((x,i)=>normalizeSearchHit(request,{
    url:x.link,title:x.title,snippet:x.snippet,published:x.date||null,rank:i+1
  }));
}

async function tavilySearch(request,limit){
  const key=txt(process.env.TAVILY_API_KEY);
  if(!key) throw new Error("TAVILY_API_KEY is required for Tavily live execution.");
  const res=await fetch("https://api.tavily.com/search",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      api_key:key,
      query:request.query,
      search_depth:"basic",
      max_results:Math.max(1,Math.min(limit,10)),
      include_answer:false,
      include_raw_content:false
    })
  });
  if(!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);
  const data=await res.json();
  return arr(data?.results).slice(0,limit).map((x,i)=>normalizeSearchHit(request,{
    url:x.url,title:x.title,snippet:x.content,published:x.published_date||null,rank:i+1
  }));
}

function normalizeSearchHit(request,hit){
  const url=txt(hit.url);
  const domain=domainOf(url);
  return {
    provider_request_id:request.provider_request_id,
    source_url_or_identifier:url,
    // Never inherit the requested source class merely because the search was
    // targeted at it. Classification/authority must be established later.
    source_type:"unclassified_external_web_result",
    source_title:txt(hit.title)||url||"Untitled external result",
    source_publisher_or_owner:domain,
    source_date_or_event_date:txt(hit.published)||null,
    retrieved_at:new Date().toISOString(),
    extracted_fact:txt(hit.snippet)||"No provider snippet returned.",
    supports_or_contradicts:"context_only",
    directness:"unclassified",
    authority_score:0,
    independence_group:domain,
    geography_scope:null,
    temporal_scope:"current",
    entity_ids:[],
    relationship_ids:[],
    query_used:request.query,
    source_rank:Number(hit.rank)||null,
    requested_source_type:request.source_constraint.source_type,
    requested_authority_score:request.source_constraint.authority_score
  };
}

export async function executeProvider({
  adapterPlan,
  provider="fixture",
  executeLive=false,
  resultLimit=3
}){
  const requests=validatePlan(adapterPlan);
  const normalizedProvider=txt(provider).toLowerCase()||"fixture";
  const live=normalizedProvider!=="fixture";

  if(live){
    if(!executeLive){
      throw new Error("Live provider selected without --execute-live.");
    }
    if(String(process.env.COSMOS_EXTERNAL_SEARCH_ENABLED||"").toLowerCase()!=="true"){
      throw new Error("Live external search requires COSMOS_EXTERNAL_SEARCH_ENABLED=true.");
    }
  }

  const results=[];
  const errors=[];

  if(normalizedProvider==="fixture"){
    results.push(...fixtureResults(requests));
  }else{
    for(const request of requests){
      try{
        const rows=normalizedProvider==="brave"
          ?await braveSearch(request,resultLimit)
          :normalizedProvider==="serper"
            ?await serperSearch(request,resultLimit)
            :normalizedProvider==="tavily"
              ?await tavilySearch(request,resultLimit)
              :(()=>{throw new Error(`Unsupported provider: ${normalizedProvider}`)})();
        results.push(...rows);
      }catch(error){
        errors.push({
          provider_request_id:request.provider_request_id,
          query:request.query,
          error:String(error?.message||error)
        });
      }
    }
  }

  return {
    schema_version:"0.1",
    status:errors.length && !results.length
      ?"external_provider_execution_failed"
      :errors.length
        ?"external_provider_execution_partial"
        :"external_provider_results_ready",
    provider_name:normalizedProvider,
    provider_mode:live?"live_external_search":"deterministic_fixture",
    execution_state:{
      provider_request_count:requests.length,
      result_count:results.length,
      error_count:errors.length,
      external_provider_connected:live,
      network_execution_performed:live,
      validation_performed:false,
      knowledge_admission_performed:false,
      graph_write_performed:false
    },
    results,
    errors,
    next_stage:results.length
      ?"external_acquisition_adapter_normalization"
      :"external_provider_execution",
    contracts:{
      provider_request_lineage_preserved:true,
      requested_source_constraint_preserved_separately:true,
      returned_source_type_not_assumed_from_request:true,
      returned_authority_not_assumed_from_request:true,
      provider_snippets_are_context_only:true,
      validation_required_before_admission:true
    },
    safeguards:{
      calls_openai:false,
      invents_provider_results:false,
      promotes_search_result_to_fact:false,
      assigns_requested_source_authority_to_result:false,
      validates_evidence:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

const input=arg("--input");
const out=arg("--out");
if(input&&out){
  const result=await executeProvider({
    adapterPlan:read(input),
    provider:arg("--provider","fixture"),
    executeLive:has("--execute-live"),
    resultLimit:Number(arg("--result-limit","3"))||3
  });
  write(out,result);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
