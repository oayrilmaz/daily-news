#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion External Acquisition Adapter v0.1
 *
 * Adapter boundary between resolved acquisition source strategy and external
 * retrieval providers.
 *
 * This module does not itself perform network calls. It:
 *   1. emits provider-neutral search requests;
 *   2. consumes externally supplied provider results;
 *   3. normalizes them as raw acquisition observations.
 *
 * Raw observations are NOT knowledge and remain unvalidated.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const arr=v=>Array.isArray(v)?v:[];
const txt=v=>typeof v==="string"?v.trim():"";
const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{const p=path.resolve(f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n")};
const sid=(p,...xs)=>p+"_"+crypto.createHash("sha256").update(xs.map(String).join("|")).digest("hex").slice(0,16);

function validateResolvedStrategy(input){
  if(input?.schema_version!=="0.1" ||
     input?.status!=="knowledge_completion_source_strategy_resolved" ||
     input?.next_stage!=="external_acquisition_adapter"){
    throw new Error("Input must be a resolved Source Strategy v0.1 result.");
  }
  if(input?.resolution_state?.external_execution_connected!==false ||
     input?.resolution_state?.network_execution_performed!==false){
    throw new Error("Source Strategy input already crossed external execution boundary.");
  }
  const requests=arr(input.execution_requests);
  if(!requests.length) throw new Error("No execution requests.");
  for(const r of requests){
    if(!arr(r.query_templates).length || !arr(r.source_strategy).length){
      throw new Error(`Execution request ${r.execution_request_id||"unknown"} is not adapter-ready.`);
    }
  }
  return requests;
}

export function buildProviderRequests(input){
  const requests=validateResolvedStrategy(input);
  const providerRequests=[];

  for(const request of requests){
    for(const query of request.query_templates){
      for(const source of request.source_strategy){
        providerRequests.push({
          provider_request_id:sid(
            "kc_provider_req",
            request.execution_request_id,
            query,
            source.source_type
          ),
          execution_request_id:request.execution_request_id,
          acquisition_plan_id:request.acquisition_plan_id,
          discovery_target_id:request.discovery_target_id,
          target_type:request.target_type,
          statement:request.statement,
          query,
          source_constraint:{
            source_strategy_id:source.source_strategy_id,
            source_type:source.source_type,
            authority_score:source.authority_score,
            priority:source.priority,
            source_rank:source.source_rank
          },
          provider:{
            provider_name:null,
            execution_mode:"external_provider_required",
            execution_status:"not_started"
          },
          result_contract:{
            source_url_or_identifier:true,
            source_type:true,
            source_title:true,
            source_date_or_event_date:true,
            retrieved_at:true,
            extracted_fact:true,
            supports_or_contradicts:true,
            independence_group:true,
            query_used:true
          }
        });
      }
    }
  }

  return {
    schema_version:"0.1",
    status:"knowledge_completion_external_acquisition_requests_ready",
    source_strategy:{
      schema_version:input.schema_version,
      status:input.status
    },
    adapter_state:{
      execution_request_count:requests.length,
      provider_request_count:providerRequests.length,
      provider_results_received:0,
      normalized_observation_count:0,
      external_provider_connected:false,
      network_execution_performed_by_this_module:false,
      validation_performed:false,
      knowledge_admission_performed:false,
      graph_write_performed:false
    },
    provider_requests:providerRequests,
    next_stage:"external_provider_execution",
    contracts:{
      resolved_source_strategy_consumed:true,
      queries_and_source_constraints_preserved:true,
      provider_neutral_boundary:true,
      result_contract_explicit:true,
      raw_results_are_not_knowledge:true,
      validation_required_before_admission:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_provider_results:false,
      invents_evidence:false,
      validates_evidence:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

export function normalizeProviderResults({adapterPlan,providerResults}){
  if(adapterPlan?.status!=="knowledge_completion_external_acquisition_requests_ready"){
    throw new Error("Adapter plan not ready.");
  }

  const requestMap=new Map(arr(adapterPlan.provider_requests).map(x=>[x.provider_request_id,x]));
  const raw=arr(providerResults?.results);
  const observations=[];
  const rejected=[];

  for(const [index,result] of raw.entries()){
    const req=requestMap.get(result?.provider_request_id);
    if(!req){
      rejected.push({
        provider_result_index:index,
        provider_request_id:result?.provider_request_id||null,
        reason:"unknown_provider_request_id"
      });
      continue;
    }

    const url=txt(result.source_url_or_identifier);
    const title=txt(result.source_title);
    const fact=txt(result.extracted_fact);
    const disposition=txt(result.supports_or_contradicts);

    if(!url||!title||!fact||
       !["supports","partially_supports","contradicts","context_only","insufficient"].includes(disposition)){
      rejected.push({
        provider_result_index:index,
        provider_request_id:req.provider_request_id,
        reason:"missing_or_invalid_required_result_fields"
      });
      continue;
    }

    observations.push({
      acquisition_observation_id:sid(
        "kc_external_obs",
        req.provider_request_id,
        url,
        fact
      ),
      provider_request_id:req.provider_request_id,
      execution_request_id:req.execution_request_id,
      acquisition_plan_id:req.acquisition_plan_id,
      discovery_target_id:req.discovery_target_id,
      target_type:req.target_type,
      statement:req.statement,
      source_strategy:req.source_constraint,
      source_url_or_identifier:url,
      source_type:txt(result.source_type)||req.source_constraint.source_type,
      source_title:title,
      source_publisher_or_owner:txt(result.source_publisher_or_owner)||null,
      source_date_or_event_date:txt(result.source_date_or_event_date)||null,
      retrieved_at:txt(result.retrieved_at)||null,
      extracted_fact:fact,
      supports_or_contradicts:disposition,
      directness:txt(result.directness)||null,
      authority_score:Number.isFinite(Number(result.authority_score))
        ?Number(result.authority_score)
        :Number(req.source_constraint.authority_score),
      independence_group:txt(result.independence_group)||null,
      geography_scope:txt(result.geography_scope)||null,
      temporal_scope:txt(result.temporal_scope)||null,
      entity_ids:arr(result.entity_ids),
      relationship_ids:arr(result.relationship_ids),
      query_used:txt(result.query_used)||req.query,
      source_rank:Number.isFinite(Number(result.source_rank))
        ?Number(result.source_rank)
        :Number(req.source_constraint.source_rank),
      epistemic_status:"external_acquisition_observation",
      validation_status:"not_started",
      knowledge_status:"not_admitted",
      executable:false
    });
  }

  return {
    schema_version:"0.1",
    status:"knowledge_completion_external_acquisition_results_normalized",
    source_adapter_plan:{
      schema_version:adapterPlan.schema_version,
      status:adapterPlan.status
    },
    provider:{
      provider_name:txt(providerResults?.provider_name)||"unspecified_external_provider",
      provider_mode:txt(providerResults?.provider_mode)||"externally_supplied_results"
    },
    adapter_state:{
      provider_request_count:arr(adapterPlan.provider_requests).length,
      provider_results_received:raw.length,
      normalized_observation_count:observations.length,
      rejected_result_count:rejected.length,
      network_execution_performed_by_this_module:false,
      validation_performed:false,
      knowledge_admission_performed:false,
      graph_write_performed:false
    },
    acquisition_observations:observations,
    rejected_results:rejected,
    next_stage:"acquisition_observation_candidate_adapter",
    contracts:{
      provider_results_preserved_as_unvalidated_observations:true,
      source_provenance_preserved:true,
      contradiction_disposition_preserved:true,
      source_strategy_lineage_preserved:true,
      validation_required_before_admission:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_provider_results:false,
      invents_evidence:false,
      treats_provider_results_as_facts:false,
      validates_evidence:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

const input=arg("--input");
const providerResults=arg("--provider-results");
const out=arg("--out");

if(input&&out){
  const plan=buildProviderRequests(read(input));
  const result=providerResults
    ?normalizeProviderResults({adapterPlan:plan,providerResults:read(providerResults)})
    :plan;
  write(out,result);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
