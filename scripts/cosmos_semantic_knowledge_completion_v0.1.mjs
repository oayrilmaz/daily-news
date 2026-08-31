#!/usr/bin/env node
/**
 * Cosmos Semantic Knowledge Completion Planner v0.1
 *
 * Purpose:
 *   Detect when Cosmos understood the question/subject but lacks the structured
 *   knowledge required to answer it well. Produce a deterministic completion
 *   plan WITHOUT inventing missing facts.
 *
 * Flow:
 *   Question -> semantic intent -> subject -> answer support check
 *   -> missing knowledge contract -> completion tasks -> projection policy
 *
 * No OpenAI. No external search. No graph mutation.
 */

import fs from "node:fs";
import path from "node:path";

function arg(name,fallback=""){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"))}
function clean(v){return typeof v==="string"?v.trim():""}
function arr(v){return Array.isArray(v)?v:[]}
function normalize(v){return clean(v).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function uniq(xs){return [...new Set(xs.filter(Boolean))]}

function relType(rel){
  return normalize(rel?.relationship_type || rel?.relationship || rel?.type || rel?.predicate || rel?.label);
}
function relFrom(rel){return clean(rel?.from_entity_id || rel?.source_entity_id || rel?.source || rel?.from)}
function relTo(rel){return clean(rel?.to_entity_id || rel?.target_entity_id || rel?.target || rel?.to)}

function expectedKnowledgeContract(classification){
  const subtype=classification?.subtype || "";
  const type=classification?.type || "";

  if(subtype==="equipment_list"){
    return {
      contract_id:"component_membership",
      required_relationship_semantics:[
        "contains","includes","has component","component of","equipment of","part of"
      ],
      answer_shape:"structured_list",
      minimum_supported_members:2
    };
  }

  if(type==="definition"){
    return {
      contract_id:"definition",
      required_relationship_semantics:["definition_or_description"],
      answer_shape:"descriptive_text",
      minimum_supported_members:0
    };
  }

  if(type==="explanation"){
    return {
      contract_id:"causal_support",
      required_relationship_semantics:["causes","drives","contributes to","influences"],
      answer_shape:"causal_explanation",
      minimum_supported_members:1
    };
  }

  return {
    contract_id:"topic_support",
    required_relationship_semantics:["related to"],
    answer_shape:"supported_summary",
    minimum_supported_members:1
  };
}

function relationshipMatchesContract(rel,contract){
  const t=relType(rel);
  if(contract.contract_id==="component_membership"){
    return [
      "contain","include","component","equipment","part of","part_of",
      "comprise","consist"
    ].some(term=>t.includes(term));
  }
  if(contract.contract_id==="causal_support"){
    return ["cause","drive","contribute","influence","lead to","result"].some(term=>t.includes(term));
  }
  return true;
}

function subjectRelationships(subjectId,relationships){
  return arr(relationships).filter(rel=>relFrom(rel)===subjectId || relTo(rel)===subjectId);
}

function supportedMembers(subjectId,relationships,entitiesById,contract){
  const out=[];
  for(const rel of subjectRelationships(subjectId,relationships)){
    if(!relationshipMatchesContract(rel,contract)) continue;
    const other=relFrom(rel)===subjectId ? relTo(rel) : relFrom(rel);
    const entity=entitiesById.get(other);
    if(!entity) continue;
    out.push({
      entity_id:other,
      label:clean(entity?.name||entity?.label||entity?.entity_id),
      relationship_id:clean(rel?.relationship_id||rel?.id),
      relationship_type:clean(rel?.relationship_type||rel?.relationship||rel?.type||rel?.predicate||rel?.label),
      confidence:rel?.confidence ?? null,
      evidence_ids:arr(rel?.evidence_ids)
    });
  }
  const seen=new Set();
  return out.filter(item=>{
    if(!item.entity_id || seen.has(item.entity_id)) return false;
    seen.add(item.entity_id);
    return true;
  });
}

function existingDescription(subject){
  return clean(subject?.description||subject?.summary||subject?.definition);
}

function knowledgeStatus({contract,members,subject}){
  if(contract.contract_id==="component_membership"){
    if(members.length>=contract.minimum_supported_members) return "sufficient";
    if(members.length>0) return "partial";
    return "insufficient";
  }
  if(contract.contract_id==="definition"){
    return existingDescription(subject) ? "sufficient" : "insufficient";
  }
  if(contract.contract_id==="causal_support"){
    return members.length>=1 ? "sufficient" : "insufficient";
  }
  return members.length>=1 || existingDescription(subject) ? "sufficient" : "insufficient";
}

function completionTasks(question,subjectMatch,contract,status){
  if(status==="sufficient") return [];

  const subjectId=clean(subjectMatch?.id);
  const subjectLabel=clean(subjectMatch?.label);

  return [
    {
      task_id:"discover_supported_candidates",
      action:"discover_candidates",
      subject_id:subjectId,
      subject_label:subjectLabel,
      knowledge_contract:contract.contract_id,
      instruction:
        `Find candidate Cosmos objects that could satisfy the ${contract.contract_id} contract for ${subjectLabel}. Candidates must come from existing Cosmos knowledge or a separately admitted evidence workflow; do not invent candidates from the question alone.`
    },
    {
      task_id:"validate_relationship_evidence",
      action:"validate_evidence",
      subject_id:subjectId,
      subject_label:subjectLabel,
      required_relationship_semantics:contract.required_relationship_semantics,
      instruction:
        "Require evidence that supports the specific relationship between the subject and each candidate object. Preserve source lineage, time, geography, confidence and epistemic state."
    },
    {
      task_id:"admit_or_reject",
      action:"knowledge_admission",
      subject_id:subjectId,
      instruction:
        "Send validated candidates through the existing Cosmos Knowledge Admission boundary. Admit only supported object/relationship records; otherwise reject or keep unresolved."
    },
    {
      task_id:"rebuild_answer",
      action:"rebuild_answer",
      question,
      subject_id:subjectId,
      instruction:
        "After admission, rerun the Question/Answer Resolver. Do not replace the question observer before the direct answer is rebuilt."
    }
  ];
}

export function planSemanticKnowledgeCompletion(input){
  const question=clean(input?.question);
  const classification=input?.classification || {};
  const subjectMatch=input?.subject_match || null;
  const subjectId=clean(subjectMatch?.id);
  const entities=arr(input?.entities);
  const relationships=arr(input?.relationships);
  const entitiesById=new Map(entities.map(entity=>[clean(entity?.entity_id),entity]));
  const subject=entitiesById.get(subjectId) || subjectMatch?.entity || null;
  const contract=expectedKnowledgeContract(classification);
  const members=subjectId ? supportedMembers(subjectId,relationships,entitiesById,contract) : [];
  const status=subjectId ? knowledgeStatus({contract,members,subject}) : "unresolved_subject";
  const tasks=subjectId ? completionTasks(question,subjectMatch,contract,status) : [{
    task_id:"resolve_subject_first",
    action:"resolve_subject",
    instruction:"Resolve a supported subject before attempting knowledge completion."
  }];

  const answerReady=status==="sufficient";

  return {
    schema_version:"0.1",
    status:"cosmos_semantic_knowledge_completion_planned",
    question,
    classification,
    subject_match:subjectMatch ? {
      id:subjectId,
      label:clean(subjectMatch?.label),
      score:subjectMatch?.score ?? null
    } : null,
    knowledge_contract:contract,
    knowledge_status:status,
    supported_members:members,
    answer_ready:answerReady,
    completion_required:!answerReady,
    completion_tasks:tasks,
    projection_policy:{
      keep_question_as_observer:true,
      suppress_broad_intelligence_projection_until_answer_supported:!answerReady,
      allow_subject_and_verified_support_objects:true,
      allow_current_intelligence_after_direct_answer:answerReady,
      allow_butterfly_expansion_after_direct_answer:answerReady
    },
    contracts:{
      detects_semantic_knowledge_gap:true,
      does_not_invent_missing_objects:true,
      does_not_invent_missing_relationships:true,
      routes_missing_knowledge_to_completion_workflow:true,
      preserves_question_observer_until_answer:true,
      gates_broad_projection_when_answer_unsupported:true,
      reuses_existing_knowledge_admission_boundary:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      mutates_graph:false,
      invents_candidate_objects:false,
      invents_relationship_evidence:false,
      admits_unvalidated_knowledge:false,
      promotes_scenario_to_fact:false
    }
  };
}

const inputFile=arg("--input");
const outFile=arg("--out");
if(inputFile){
  const result=planSemanticKnowledgeCompletion(readJson(inputFile));
  const text=JSON.stringify(result,null,2)+"\n";
  if(outFile){
    fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});
    fs.writeFileSync(outFile,text);
  }else process.stdout.write(text);
}

