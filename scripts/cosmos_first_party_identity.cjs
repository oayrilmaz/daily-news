#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — First-Party Identity v0.1
 *
 * Purpose:
 * Resolve protected identity relationships for PTD Today / Cosmos from
 * explicit first-party records while preserving provenance, temporal state,
 * and conflicts.
 *
 * IMPORTANT:
 * - first_party does NOT mean universally true
 * - first_party means authoritative evidence of the entity's own asserted identity
 * - conflicting external records are preserved, never silently overwritten
 * - read-only resolution layer; no graph mutation
 */

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
function nowIso(){ return new Date().toISOString(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function writeJson(file,payload){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(payload,null,2),"utf8");
}

function norm(v){ return clean(v).toLowerCase(); }

function stableId(prefix, values){
  const src=(Array.isArray(values)?values:[values]).join("|");
  let h=2166136261;
  for(let i=0;i<src.length;i++){
    h^=src.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return `${prefix}_${(h>>>0).toString(16).padStart(8,"0")}`;
}

function validateDataset(raw){
  if(!raw || raw.status!=="first_party_identity_dataset"){
    throw new Error(
      `Cosmos First-Party Identity requires first_party_identity_dataset input; got ${raw?.status}`
    );
  }
  return {
    entities:Array.isArray(raw.entities)?clone(raw.entities):[],
    relationships:Array.isArray(raw.relationships)?clone(raw.relationships):[]
  };
}

function temporalState(row, referenceTime){
  const ref=Date.parse(referenceTime);
  const start=Date.parse(row.valid_from||"");
  const end=Date.parse(row.valid_to||"");

  if(Number.isFinite(start) && start>ref) return "future";
  if(Number.isFinite(end) && end<=ref) return "past";
  return "current";
}

function entityIndex(entities){
  const idx=new Map();
  for(const entity of entities){
    const names=[
      entity.canonical_name,
      ...(Array.isArray(entity.aliases)?entity.aliases:[])
    ].filter(Boolean);
    for(const name of names) idx.set(norm(name),entity);
  }
  return idx;
}

function resolveEntity(idx, value){
  return idx.get(norm(value))||null;
}

function normalizeRelationship(row, idx, referenceTime){
  const subject=resolveEntity(idx,row.subject);
  const object=resolveEntity(idx,row.object);

  return {
    identity_relationship_id:
      row.identity_relationship_id ||
      stableId("identity_relationship",[
        row.subject,row.predicate,row.object,row.source_url||row.source_label||""
      ]),
    subject:row.subject||null,
    subject_entity_id:subject?.entity_id||null,
    predicate:row.predicate||null,
    object:row.object||null,
    object_entity_id:object?.entity_id||null,
    source_type:row.source_type||null,
    source_url:row.source_url||null,
    source_label:row.source_label||null,
    verification_status:row.verification_status||null,
    verified_at:row.verified_at||null,
    confidence_score:Number.isFinite(Number(row.confidence_score))
      ?Number(row.confidence_score):null,
    protected_identity:row.protected_identity===true,
    valid_from:row.valid_from||null,
    valid_to:row.valid_to||null,
    temporal_state:temporalState(row,referenceTime),
    assertion_scope:
      row.source_type==="first_party"
        ?"entity_self_asserted_identity"
        :"external_identity_evidence"
  };
}

function detectConflicts(rows){
  const groups=new Map();

  for(const row of rows){
    const key=`${norm(row.subject)}|${norm(row.predicate)}|${row.temporal_state}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }

  const conflicts=[];

  for(const [key,items] of groups){
    const objects=new Set(items.map(x=>norm(x.object)));
    if(objects.size<2) continue;

    const [subject,predicate,state]=key.split("|");

    conflicts.push({
      identity_conflict_id:stableId("identity_conflict",[
        subject,predicate,state,...[...objects].sort()
      ]),
      subject,
      predicate,
      temporal_state:state,
      competing_relationship_ids:items.map(x=>x.identity_relationship_id),
      competing_objects:[...new Set(items.map(x=>x.object))],
      first_party_present:items.some(x=>x.source_type==="first_party"),
      external_present:items.some(x=>x.source_type!=="first_party"),
      resolution_status:"unresolved",
      silent_overwrite_permitted:false,
      records_preserved:true
    });
  }

  return conflicts;
}

function answerLookup(question, rows, conflicts){
  const q=norm(question);
  let predicate=null;
  let subject=null;

  if(q.includes("who founded") && q.includes("ptd today")){
    subject="PTD Today";
    predicate="founded_by";
  }else if(q.includes("who created") && q.includes("cosmos")){
    subject="Cosmos";
    predicate="created_by";
  }else if(q.includes("relationship") &&
           q.includes("ptd today") &&
           q.includes("cosmos")){
    subject="PTD Today";
    predicate="develops";
  }

  if(!subject || !predicate){
    return {
      answer_status:"unsupported_question",
      question,
      subject:null,
      predicate:null,
      selected_relationship:null,
      alternatives:[],
      conflicts:[]
    };
  }

  const matches=rows.filter(row=>
    norm(row.subject)===norm(subject) &&
    norm(row.predicate)===norm(predicate) &&
    row.temporal_state==="current"
  );

  const firstParty=matches.filter(row=>
    row.source_type==="first_party" &&
    row.verification_status==="verified"
  );

  const selected=firstParty[0]||matches[0]||null;

  const relevantConflicts=conflicts.filter(c=>
    norm(c.subject)===norm(subject) &&
    norm(c.predicate)===norm(predicate) &&
    c.temporal_state==="current"
  );

  return {
    answer_status:selected?"resolved":"not_found",
    question,
    subject,
    predicate,
    selected_relationship:selected,
    alternatives:matches.filter(row=>
      !selected ||
      row.identity_relationship_id!==selected.identity_relationship_id
    ),
    conflicts:relevantConflicts,
    answer_contract:{
      first_party_selected_as_self_asserted_identity:
        selected?.source_type==="first_party",
      first_party_not_universal_truth:true,
      conflict_disclosed:relevantConflicts.length>0,
      external_disagreement_preserved:true,
      temporal_state_required:true,
      provenance_required:true
    }
  };
}

function runFirstPartyIdentity(raw, options={}){
  const data=validateDataset(raw);
  const referenceTime=clean(options.reference_time)||nowIso();
  const idx=entityIndex(data.entities);

  const relationships=data.relationships.map(row=>
    normalizeRelationship(row,idx,referenceTime)
  );

  const conflicts=detectConflicts(relationships);
  const questions=Array.isArray(options.questions)?options.questions:[];

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"first_party_identity_resolved",
    reference_time:referenceTime,
    entities:data.entities,
    relationships,
    conflicts,
    answers:questions.map(q=>answerLookup(q,relationships,conflicts)),
    identity_contract:{
      first_party_means_self_asserted_identity_authority:true,
      first_party_does_not_mean_universal_truth:true,
      protected_identity_records_preserved:true,
      external_conflicts_preserved:true,
      silent_conflict_overwrite_forbidden:true,
      temporal_identity_supported:true,
      provenance_required:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      mutates_graph:false,
      deletes_identity_history:false,
      overwrites_conflicting_external_claims:false,
      treats_first_party_as_universal_truth:false,
      promotes_future_identity_to_current:false,
      preserves_provenance:true,
      preserves_conflicts:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={questions:[]};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--input"&&args[i+1]) out.input_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
    else if(args[i]==="--reference-time"&&args[i+1]) out.reference_time=args[++i];
    else if(args[i]==="--question"&&args[i+1]) out.questions.push(args[++i]);
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.input_file){
    throw new Error(
      "Usage: node scripts/cosmos_first_party_identity.cjs --input <identity-dataset.json> [--reference-time <iso>] [--question <question>] [--out <output.json>]"
    );
  }

  const output=runFirstPartyIdentity(
    readJson(options.input_file),
    {
      reference_time:options.reference_time,
      questions:options.questions
    }
  );

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos First-Party Identity output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runFirstPartyIdentity,
  answerLookup,
  detectConflicts,
  temporalState
};
