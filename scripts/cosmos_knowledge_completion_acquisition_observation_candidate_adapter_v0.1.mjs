#!/usr/bin/env node
/**
 * PTD Today / Cosmos — Acquisition Observation Candidate Adapter v0.1
 *
 * Boundary:
 * normalized external acquisition observations -> provisional candidates
 *
 * Core rule:
 * - Cosmos-first reuse: this module is used only after the knowledge resolver
 *   has established that admitted Cosmos knowledge is insufficient.
 * - AI may help a future upstream/downstream stage, but this adapter itself
 *   performs no AI/API/network work.
 * - Observations are NOT facts.
 * - Candidates are NOT knowledge.
 * - Candidate labels must be grounded in explicit source text or explicit
 *   provider-supplied entity labels; no hidden completion or hallucination.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const arr=v=>Array.isArray(v)?v:[];
const txt=v=>String(v??"").trim();
const uniq=a=>[...new Set(arr(a).filter(Boolean))];
const sid=(prefix,...parts)=>`${prefix}_${crypto.createHash("sha256").update(parts.map(txt).join("|")).digest("hex").slice(0,16)}`;

function normalizeSpace(s){ return txt(s).replace(/\s+/g," ").trim(); }

function candidateClass(targetType){
  const t=txt(targetType).toLowerCase();
  if(t==="identify_components") return "component_or_equipment";
  if(t==="identify_materials") return "material";
  if(t==="identify_capacity") return "capacity_or_capability";
  if(t==="identify_organizations") return "organization";
  if(t==="identify_locations") return "place";
  return "knowledge_candidate";
}

function relationSemantic(targetType){
  const t=txt(targetType).toLowerCase();
  if(t==="identify_components") return "component_membership";
  if(t==="identify_materials") return "material_membership";
  if(t==="identify_capacity") return "capacity_relationship";
  return "requested_relationship";
}

/*
 * Deterministic extraction is intentionally conservative.
 * It accepts:
 *   1) explicit entity labels supplied by the provider result, or
 *   2) explicit list/enumeration language in the extracted observation.
 *
 * It does NOT use a domain dictionary to silently "know" missing answers.
 */
function extractExplicitLabels(observation){
  const explicit=arr(observation.entity_labels)
    .map(normalizeSpace)
    .filter(Boolean);
  if(explicit.length) return explicit;

  const fact=normalizeSpace(observation.extracted_fact);
  if(!fact) return [];

  // Prefer text after clear enumeration verbs/markers.
  const m=fact.match(/\b(?:include|includes|including|consist(?:s)? of|comprise|comprises|such as|are|:)\s+(.+)$/i);
  if(!m) return [];

  let body=m[1]
    .replace(/[.。]\s*$/,"")
    .replace(/\([^)]*\)/g," ")
    .replace(/\s+/g," ")
    .trim();

  // Require actual list structure. A single noun phrase is too weak for
  // deterministic extraction at this boundary.
  if(!/[;,]|\band\b|\bor\b/i.test(body)) return [];

  const parts=body
    .replace(/\s+(?:and|or)\s+/gi,",")
    .split(/[;,]/)
    .map(x=>normalizeSpace(x)
      .replace(/^(?:a|an|the)\s+/i,"")
      .replace(/\s+(?:equipment|systems?)$/i, m=>m))
    .filter(x=>x.length>=3 && x.length<=100);

  return uniq(parts).slice(0,24);
}

export function adaptAcquisitionObservations(input){
  if(input?.schema_version!=="0.1" ||
     input?.status!=="knowledge_completion_external_acquisition_results_normalized" ||
     input?.next_stage!=="acquisition_observation_candidate_adapter"){
    throw new Error("Acquisition Observation Candidate Adapter requires normalized external acquisition results.");
  }

  const observations=arr(input.acquisition_observations);
  const groups=new Map();
  const unresolved=[];

  for(const obs of observations){
    if(obs.epistemic_status!=="external_acquisition_observation" ||
       obs.validation_status!=="not_started" ||
       obs.knowledge_status!=="not_admitted" ||
       obs.executable!==false){
      throw new Error(`Observation ${obs.acquisition_observation_id||"(unknown)"} crossed the protected acquisition boundary.`);
    }

    const labels=extractExplicitLabels(obs);
    if(!labels.length){
      unresolved.push({
        acquisition_observation_id:obs.acquisition_observation_id,
        reason:"no_explicit_candidate_enumeration_detected",
        next_action:"source_content_or_ai_assisted_candidate_extraction"
      });
      continue;
    }

    for(const label of labels){
      const subject=normalizeSpace(obs.statement);
      const cls=candidateClass(obs.target_type);
      const key=[subject.toLowerCase(),label.toLowerCase(),cls].join("|");

      if(!groups.has(key)){
        groups.set(key,{
          abstract_subject:subject,
          candidate_label:label,
          candidate_class:cls,
          relationship_semantic:relationSemantic(obs.target_type),
          original_target_types:[],
          source_observation_ids:[],
          provider_request_ids:[],
          acquisition_plan_ids:[],
          discovery_target_ids:[],
          source_evidence:[]
        });
      }
      const g=groups.get(key);
      g.original_target_types.push(obs.target_type);
      g.source_observation_ids.push(obs.acquisition_observation_id);
      g.provider_request_ids.push(obs.provider_request_id);
      g.acquisition_plan_ids.push(obs.acquisition_plan_id);
      g.discovery_target_ids.push(obs.discovery_target_id);
      g.source_evidence.push({
        acquisition_observation_id:obs.acquisition_observation_id,
        source_url_or_identifier:obs.source_url_or_identifier,
        source_title:obs.source_title,
        source_type:obs.source_type,
        source_publisher_or_owner:obs.source_publisher_or_owner??null,
        source_date_or_event_date:obs.source_date_or_event_date??null,
        retrieved_at:obs.retrieved_at??null,
        extracted_fact:obs.extracted_fact,
        supports_or_contradicts:obs.supports_or_contradicts,
        directness:obs.directness??null,
        authority_score:Number.isFinite(Number(obs.authority_score))?Number(obs.authority_score):0,
        independence_group:obs.independence_group??null,
        query_used:obs.query_used??null
      });
    }
  }

  const candidates=[...groups.values()].map((g,index)=>({
    decomposition_candidate_id:sid("kc_obs_candidate",g.abstract_subject,g.candidate_label,g.candidate_class),
    candidate_rank:index+1,
    parent_acquisition_plan_id:uniq(g.acquisition_plan_ids)[0]??null,
    parent_discovery_target_id:uniq(g.discovery_target_ids)[0]??null,
    original_target_type:uniq(g.original_target_types)[0]??null,
    abstract_subject:g.abstract_subject,
    candidate_label:g.candidate_label,
    candidate_class:g.candidate_class,
    relationship_semantic:g.relationship_semantic,
    epistemic_status:"provisional_candidate",
    validated:false,
    executable:false,
    knowledge_status:"not_admitted",
    proposed_investigation_types:uniq(g.original_target_types),
    validation_requirements:[
      "confirm candidate identity and requested relationship",
      "confirm with independent evidence where required",
      "capture contradictory evidence",
      "preserve source provenance and temporal scope"
    ],
    source_observation_count:uniq(g.source_observation_ids).length,
    source_evidence:g.source_evidence,
    lineage:{
      source_observation_ids:uniq(g.source_observation_ids),
      provider_request_ids:uniq(g.provider_request_ids),
      acquisition_plan_ids:uniq(g.acquisition_plan_ids),
      discovery_target_ids:uniq(g.discovery_target_ids)
    }
  }));

  const decomposition={
    decomposition_id:sid("kc_observation_decomposition",...observations.map(x=>x.acquisition_observation_id)),
    status:candidates.length?"provisional_candidates_resolved":"insufficient_decomposition_context",
    parent_acquisition_plan_id:candidates[0]?.parent_acquisition_plan_id??null,
    parent_discovery_target_id:candidates[0]?.parent_discovery_target_id??null,
    candidates
  };

  return {
    schema_version:"0.1",
    status:"decomposition_candidates_resolved",
    source_normalization:{
      schema_version:input.schema_version,
      status:input.status,
      provider:input.provider??null
    },
    decomposition_state:{
      source_observation_count:observations.length,
      provisional_candidate_count:candidates.length,
      unresolved_observation_count:unresolved.length,
      validated_candidate_count:0,
      executable_candidate_count:0,
      external_execution_connected:false,
      conceptual_distance_limit:null,
      continuation_possible:candidates.length>0,
      cosmos_first_reuse_principle:"Use admitted Cosmos knowledge first. Invoke knowledge completion only when required; once validated knowledge is admitted, future equivalent questions should reuse Cosmos rather than reacquire it."
    },
    decompositions:[decomposition],
    unresolved_observations:unresolved,
    next_stage:candidates.length?"candidate_validation":"candidate_extraction_assistance",
    contracts:{
      normalized_observations_consumed:true,
      candidates_grounded_in_observation_text:true,
      candidates_remain_provisional:true,
      candidate_source_lineage_preserved:true,
      requested_relationship_semantic_preserved:true,
      candidate_validation_required:true,
      admitted_cosmos_knowledge_reused_before_reacquisition:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_candidates:false,
      promotes_observation_to_fact:false,
      validates_candidates:false,
      admits_knowledge:false,
      writes_graph:false
    }
  };
}

function parseArgs(argv){
  const o={};
  for(let i=2;i<argv.length;i++){
    if(argv[i]==="--input"&&argv[i+1]) o.input=argv[++i];
    else if(argv[i]==="--out"&&argv[i+1]) o.out=argv[++i];
  }
  return o;
}

async function main(){
  const a=parseArgs(process.argv);
  if(!a.input) throw new Error("Usage: node scripts/cosmos_knowledge_completion_acquisition_observation_candidate_adapter_v0.1.mjs --input <normalized-observations.json> [--out <candidate-input.json>]");
  const input=JSON.parse(fs.readFileSync(a.input,"utf8"));
  const result=adaptAcquisitionObservations(input);
  if(a.out){
    fs.mkdirSync(path.dirname(a.out),{recursive:true});
    fs.writeFileSync(a.out,JSON.stringify(result,null,2)+"\n");
  }
  console.log(JSON.stringify(result,null,2));
}

if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  main().catch(e=>{console.error(e?.stack||e);process.exit(1);});
}
