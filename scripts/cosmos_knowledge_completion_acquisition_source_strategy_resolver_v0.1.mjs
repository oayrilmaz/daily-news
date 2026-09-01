#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion Acquisition Source Strategy Resolver v0.1
 *
 * Deterministically resolves source classes for acquisition requests whose
 * source_strategy is empty. This module plans source classes only.
 *
 * It does NOT search, call OpenAI/APIs, validate evidence, admit knowledge,
 * or mutate the graph.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arr=v=>Array.isArray(v)?v:[];
const txt=v=>typeof v==="string"?v.trim():"";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{const p=path.resolve(f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n")};
const sid=(p,...xs)=>p+"_"+crypto.createHash("sha256").update(xs.join("|")).digest("hex").slice(0,16);

const CATALOG={
  identify_components:[
    {
      source_type:"manufacturer_or_oem_technical_document",
      authority_score:100,
      priority:"primary",
      rationale:"OEM technical manuals, product documentation, and engineering literature can directly identify equipment and component membership."
    },
    {
      source_type:"utility_or_owner_engineering_standard",
      authority_score:96,
      priority:"primary",
      rationale:"Utility and asset-owner engineering standards can directly define equipment required within the relevant system."
    },
    {
      source_type:"regulatory_or_government_document",
      authority_score:90,
      priority:"secondary",
      rationale:"Government and regulator technical material can independently confirm system and equipment classifications."
    },
    {
      source_type:"industry_body_or_research_institution",
      authority_score:84,
      priority:"secondary",
      rationale:"Technical bodies and research institutions can provide independent technical context and contradiction checks."
    }
  ],
  identify_materials:[
    {
      source_type:"manufacturer_or_oem_technical_document",
      authority_score:100,
      priority:"primary",
      rationale:"Manufacturer technical documents can directly identify materials and construction."
    },
    {
      source_type:"industry_standard_or_code",
      authority_score:96,
      priority:"primary",
      rationale:"Standards and codes can define accepted material requirements and classifications."
    },
    {
      source_type:"regulatory_or_government_document",
      authority_score:90,
      priority:"secondary",
      rationale:"Government technical material can independently confirm regulated material requirements."
    },
    {
      source_type:"industry_body_or_research_institution",
      authority_score:84,
      priority:"secondary",
      rationale:"Research and industry bodies provide independent technical corroboration."
    }
  ],
  identify_capacity:[
    {
      source_type:"official_project_or_operator_document",
      authority_score:100,
      priority:"primary",
      rationale:"Project and operator documents are the strongest direct source for installed or planned capacity."
    },
    {
      source_type:"regulatory_or_government_document",
      authority_score:96,
      priority:"primary",
      rationale:"Regulatory and government records can independently confirm reported capacity."
    },
    {
      source_type:"industry_body_or_research_institution",
      authority_score:84,
      priority:"secondary",
      rationale:"Industry and research material can provide independent context and contradiction checks."
    }
  ],
  default:[
    {
      source_type:"official_project_or_operator_document",
      authority_score:100,
      priority:"primary",
      rationale:"First-party project or operator documentation is preferred when available."
    },
    {
      source_type:"regulatory_or_government_document",
      authority_score:94,
      priority:"primary",
      rationale:"Official public records provide independent authoritative corroboration."
    },
    {
      source_type:"industry_body_or_research_institution",
      authority_score:82,
      priority:"secondary",
      rationale:"Independent technical bodies provide contextual verification and contradiction search."
    }
  ]
};

export function resolveSourceStrategy(executionPlan){
  if(executionPlan?.schema_version!=="0.1" ||
     executionPlan?.status!=="knowledge_completion_source_strategy_required" ||
     executionPlan?.next_stage!=="acquisition_source_strategy_resolver"){
    throw new Error("Input must be an unresolved Acquisition Execution v0.1 plan.");
  }

  const requests=arr(executionPlan.execution_requests);
  const unresolved=arr(executionPlan.source_strategy_resolution_queue);
  if(!requests.length||!unresolved.length) throw new Error("No unresolved source-strategy requests.");

  const unresolvedIds=new Set(unresolved.map(x=>x.execution_request_id));
  const resolvedRequests=requests.map(request=>{
    if(!unresolvedIds.has(request.execution_request_id)){
      return request;
    }
    if(arr(request.source_strategy).length>0){
      throw new Error(`Resolution queue contains already-resolved request ${request.execution_request_id}.`);
    }

    const strategy=(CATALOG[request.target_type]||CATALOG.default).map((s,index)=>({
      source_strategy_id:sid("kc_source_strategy",request.execution_request_id,s.source_type),
      source_type:s.source_type,
      authority_score:s.authority_score,
      priority:s.priority,
      rationale:s.rationale,
      acquisition_status:"planned",
      execution_adapter:"unassigned",
      search_status:"not_started",
      source_rank:index+1
    }));

    return {
      ...request,
      source_strategy:strategy,
      source_strategy_status:"resolved",
      execution:{
        ...request.execution,
        mode:"adapter_required",
        executor_status:"not_connected",
        network_execution_performed:false,
        result_count:0
      }
    };
  });

  const stillUnresolved=resolvedRequests.filter(x=>!arr(x.source_strategy).length);
  const adapterReady=resolvedRequests.filter(x=>arr(x.source_strategy).length>0);

  return {
    schema_version:"0.1",
    status:stillUnresolved.length
      ?"knowledge_completion_source_strategy_partial"
      :"knowledge_completion_source_strategy_resolved",
    source_execution_plan:{
      schema_version:executionPlan.schema_version,
      status:executionPlan.status
    },
    resolution_state:{
      request_count:requests.length,
      resolved_count:adapterReady.length,
      unresolved_count:stillUnresolved.length,
      external_execution_connected:false,
      network_execution_performed:false,
      evidence_validation_count:0,
      knowledge_admission_count:0,
      graph_write_count:0
    },
    execution_requests:resolvedRequests,
    future_adapter_queue:adapterReady.map((r,i)=>({
      execution_rank:i+1,
      execution_request_id:r.execution_request_id,
      acquisition_plan_id:r.acquisition_plan_id,
      executor_status:"not_connected",
      query_templates:r.query_templates,
      source_strategy:r.source_strategy
    })),
    next_stage:stillUnresolved.length
      ?"acquisition_source_strategy_resolver"
      :"external_acquisition_adapter",
    contracts:{
      source_strategy_determined_from_target_type:true,
      authority_rank_preserved:true,
      original_query_templates_preserved:true,
      evidence_contract_preserved:true,
      source_lineage_preserved:true,
      adapter_released_only_after_strategy_resolution:true,
      strategy_is_plan_not_evidence:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_evidence:false,
      invents_entities:false,
      treats_source_strategy_as_evidence:false,
      validates_evidence:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

const input=arg("--input"),out=arg("--out");
if(input&&out){
  const result=resolveSourceStrategy(read(input));
  write(out,result);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
