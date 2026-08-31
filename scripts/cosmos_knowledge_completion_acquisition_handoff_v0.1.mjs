#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion Acquisition Handoff v0.1
 *
 * Converts a Knowledge Completion Request Adapter result into the
 * Discovery-shaped contract consumed by cosmos_acquisition.cjs.
 *
 * It creates a REQUEST FOR KNOWLEDGE, never a factual claim.
 * No external search, OpenAI call, evidence invention, or graph mutation.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const clean=v=>typeof v==="string"?v.trim():"";
const arr=v=>Array.isArray(v)?v:[];
const slug=v=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const stableId=(prefix,value)=>`${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0,12)}`;

function knowledgeAction(contract={}){
  const id=clean(contract.contract_id||contract.id).toLowerCase();
  if(id.includes("component")) return "identify_components";
  return "extend_frontier";
}

export function buildAcquisitionHandoff(request){
  if(request?.status!=="knowledge_completion_request_ready"){
    throw new Error("Acquisition handoff requires knowledge_completion_request_ready.");
  }
  if(request?.completion_required!==true){
    throw new Error("Acquisition handoff requires completion_required=true.");
  }
  if(request?.next_action!=="acquisition"){
    throw new Error("Acquisition handoff requires next_action=acquisition.");
  }

  const question=clean(request.question);
  const subject=request.subject||{};
  const subjectId=clean(subject.id||subject.entity_id);
  const subjectLabel=clean(subject.label||subject.name||subjectId);
  const contract=request.knowledge_contract||
    request.orchestrator_run?.knowledge_contract||
    {};

  if(!question) throw new Error("Original question missing.");
  if(!subjectId) throw new Error("Resolved subject missing.");
  if(!clean(contract.contract_id||contract.id)) throw new Error("Knowledge contract missing.");

  const action=knowledgeAction(contract);
  const targetId=stableId("kc_discovery_target",[
    question,subjectId,clean(contract.contract_id||contract.id),action
  ].join("|"));

  const gapId=stableId("knowledge_gap",[
    question,subjectId,clean(contract.contract_id||contract.id)
  ].join("|"));

  const statement=
    action==="identify_components"
      ? `Identify evidence-supported components or equipment included in ${subjectLabel}.`
      : `Acquire evidence needed to resolve the missing knowledge contract for ${subjectLabel}.`;

  const lineage={
    entity_ids:[subjectId],
    consequence_ids:[],
    relationship_ids:[],
    originating_gap_ids:[gapId],
    question_observer:question,
    semantic_subject_id:subjectId,
    semantic_subject_label:subjectLabel,
    knowledge_contract_id:clean(contract.contract_id||contract.id)
  };

  const target={
    discovery_target_id:targetId,
    target_id:targetId,
    discovery_action:action,
    target_type:action,
    statement,
    subject:{
      id:subjectId,
      label:subjectLabel
    },
    epistemic_status:"knowledge_request",
    knowledge_status:"missing",
    reopens_frontier_if_resolved:true,
    required_answer_shape:contract.answer_shape||null,
    minimum_supported_members:Number(contract.minimum_supported_members||0)||null,
    required_relationship_semantics:arr(contract.required_relationship_semantics),
    lineage
  };

  const queueRow={
    queue_rank:1,
    discovery_target_id:targetId,
    discovery_action:action,
    target_type:action,
    statement,
    subject:target.subject,
    epistemic_status:"knowledge_request",
    execution_status:"not_connected",
    reopens_frontier_if_resolved:true,
    lineage
  };

  return {
    schema_version:"0.1",
    status:"discovery_targets_resolved",
    generated_at:new Date().toISOString(),
    handoff_type:"semantic_knowledge_completion_to_acquisition",
    source_consequence:{
      schema_version:"0.1",
      status:"knowledge_completion_gap_requires_acquisition",
      source:"cosmos_semantic_knowledge_completion_v0.1",
      question,
      subject:target.subject,
      knowledge_gap_id:gapId,
      knowledge_contract:contract
    },
    discovery_targets:{
      items:[target]
    },
    next_acquisition_queue:[queueRow],
    curiosity_state:{
      continuation_possible:true,
      current_frontier_is_terminal:false,
      conceptual_distance_limit:null
    },
    observer_state:{
      observer_type:"question",
      question,
      semantic_subject:target.subject,
      question_remains_primary_observer:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_missing_entities:false,
      invents_missing_relationships:false,
      upgrades_evidence_quality:false,
      converts_unknown_to_fact:false,
      acquisition_targets_are_requests_for_knowledge_not_claims:true,
      source_lineage_preserved:true,
      consequence_frontier_may_be_reopened:true,
      graph_mutation_performed:false
    }
  };
}

function arg(name,d=""){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:d;
}
const input=arg("--input");
const out=arg("--out");
if(input){
  const payload=JSON.parse(fs.readFileSync(path.resolve(input),"utf8"));
  const result=buildAcquisitionHandoff(payload);
  if(out){
    const p=path.resolve(out);
    fs.mkdirSync(path.dirname(p),{recursive:true});
    fs.writeFileSync(p,JSON.stringify(result,null,2)+"\n");
  }else{
    process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }
}
