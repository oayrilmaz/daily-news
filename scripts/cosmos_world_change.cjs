#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — World Change Materializer v0.1
 *
 * Purpose:
 * Derive deterministic World Changes from admitted, comparable state claims.
 *
 * Boundaries:
 * - no external search
 * - no AI inference
 * - no causality
 * - no graph/knowledge delta reuse
 * - no scenario/forecast values promoted into World Change
 */

const fs=require("fs");
const path=require("path");

function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a||[]).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }
function stableId(prefix,values){
  const src=(Array.isArray(values)?values:[values]).join("|");
  let h=2166136261;
  for(let i=0;i<src.length;i++){ h^=src.charCodeAt(i); h=Math.imul(h,16777619); }
  return `${prefix}_${(h>>>0).toString(16).padStart(8,"0")}`;
}
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8")); }
function writeJson(file,payload){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(payload,null,2)); }

const WORLD_VALUE_TYPES=new Set(["observed","reported","measured","actual"]);
const SUPPORTED_STATE_CLASSES=new Set(["validated_supported_state"]);

function normalizeStateRecord(record){
  if(!record || !SUPPORTED_STATE_CLASSES.has(clean(record.claim_class))) return {eligible:false,reason:"not_supported_state"};
  const claim=record.claim && typeof record.claim==="object" ? record.claim : null;
  if(!claim || clean(claim.claim_type)!=="state_claim") return {eligible:false,reason:"missing_state_claim"};
  const valueType=clean(claim.value_type).toLowerCase()||"reported";
  if(!WORLD_VALUE_TYPES.has(valueType)) return {eligible:false,reason:`non_world_value_type:${valueType}`};
  const n=Number(claim.value);
  if(!Number.isFinite(n)) return {eligible:false,reason:"non_numeric_state_value"};
  const effective=clean(claim.effective_at);
  const time=Date.parse(effective);
  if(!effective || !Number.isFinite(time)) return {eligible:false,reason:"invalid_effective_at"};
  if(!clean(claim.subject_id) || !clean(claim.state_dimension)) return {eligible:false,reason:"missing_subject_or_dimension"};
  return {
    eligible:true,
    graph_record_id:record.graph_record_id||null,
    knowledge_admission_id:record.knowledge_admission_id||null,
    evidence_record_ids:uniq(record.evidence_record_ids||[]),
    confidence_score:Number(record.confidence_score||0),
    subject_id:clean(claim.subject_id),
    state_dimension:clean(claim.state_dimension),
    value:n,
    unit:clean(claim.unit)||null,
    effective_at:new Date(time).toISOString(),
    effective_ms:time,
    geography:clean(claim.geography)||null,
    scope:clean(claim.scope)||null,
    value_type:valueType
  };
}

function trajectoryKey(s){
  return [s.subject_id,s.state_dimension,s.unit||"",s.geography||"",s.scope||"",s.value_type].join("|");
}

function deriveWorldChanges(graphRaw){
  const records=Array.isArray(graphRaw?.knowledge_records)?graphRaw.knowledge_records:[];
  const accepted=[];
  const rejected=[];
  for(const r of records){
    const n=normalizeStateRecord(r);
    if(n.eligible) accepted.push(n);
    else if(clean(r?.claim?.claim_type)==="state_claim" || clean(r?.claim_class).includes("state")) rejected.push({graph_record_id:r?.graph_record_id||null,reason:n.reason});
  }

  const groups=new Map();
  for(const s of accepted){
    const k=trajectoryKey(s);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(s);
  }

  const world_changes=[];
  const corroboration_events=[];
  const conflicts=[];

  for(const [key,items] of groups){
    const byTime=new Map();
    for(const s of items){
      if(!byTime.has(s.effective_at)) byTime.set(s.effective_at,[]);
      byTime.get(s.effective_at).push(s);
    }

    const resolvedStates=[];
    for(const [effective_at,sameTime] of [...byTime.entries()].sort((a,b)=>Date.parse(a[0])-Date.parse(b[0]))){
      const values=uniq(sameTime.map(x=>String(x.value)));
      if(values.length>1){
        conflicts.push({trajectory_key:key,effective_at,values:sameTime.map(x=>x.value),graph_record_ids:sameTime.map(x=>x.graph_record_id)});
        continue;
      }
      if(sameTime.length>1){
        corroboration_events.push({trajectory_key:key,effective_at,value:sameTime[0].value,record_count:sameTime.length,graph_record_ids:sameTime.map(x=>x.graph_record_id)});
      }
      resolvedStates.push({
        ...sameTime[0],
        evidence_record_ids:uniq(sameTime.flatMap(x=>x.evidence_record_ids)),
        graph_record_ids:sameTime.map(x=>x.graph_record_id),
        confidence_score:Math.max(...sameTime.map(x=>x.confidence_score))
      });
    }

    for(let i=1;i<resolvedStates.length;i++){
      const prev=resolvedStates[i-1], cur=resolvedStates[i];
      if(prev.value===cur.value) continue;
      const magnitude=cur.value-prev.value;
      const direction=magnitude>0?"increase":"decrease";
      const transition_id=stableId("chg",[key,prev.effective_at,prev.value,cur.effective_at,cur.value]);
      world_changes.push({
        transition_id,
        change_type:"world_change",
        subject_id:cur.subject_id,
        state_dimension_id:cur.state_dimension,
        geography:cur.geography,
        scope:cur.scope,
        previous_state:{value:prev.value,unit:cur.unit},
        previous_state_time:prev.effective_at,
        current_state:{value:cur.value,unit:cur.unit},
        current_state_time:cur.effective_at,
        direction,
        magnitude:Math.abs(magnitude),
        signed_magnitude:magnitude,
        unit:cur.unit,
        transition_type:direction,
        value_type:cur.value_type,
        epistemic_state:"supported",
        confidence_score:Math.min(prev.confidence_score,cur.confidence_score),
        evidence_refs:uniq([...prev.evidence_record_ids,...cur.evidence_record_ids]),
        state_record_refs:uniq([...prev.graph_record_ids,...cur.graph_record_ids]),
        causal_status:"not_evaluated",
        butterfly_eligible:false
      });
    }
  }

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"world_change_materialized",
    counts:{
      admitted_state_records:accepted.length,
      world_changes:world_changes.length,
      rejected_state_claims:rejected.length,
      corroboration_events:corroboration_events.length,
      conflicts:conflicts.length
    },
    world_changes,
    rejected_state_claims:rejected,
    corroboration_events,
    conflicts,
    safeguards:{
      deterministic:true,
      calls_ai:false,
      derives_causality:false,
      forecast_or_scenario_not_world_change:true,
      same_time_disagreement_not_world_movement:true,
      knowledge_delta_not_world_change:true
    }
  };
}

function parseArgs(argv){ const out={}; const a=argv.slice(2); for(let i=0;i<a.length;i++){ if(a[i]==="--graph"&&a[i+1]) out.graph=a[++i]; else if(a[i]==="--out"&&a[i+1]) out.out=a[++i]; } return out; }
function main(){ const o=parseArgs(process.argv); if(!o.graph) throw new Error("Usage: node scripts/cosmos_world_change.cjs --graph <graph.json> [--out <world-changes.json>]"); const result=deriveWorldChanges(readJson(o.graph)); if(o.out){writeJson(o.out,result); console.log(`Cosmos World Change output written to ${o.out}`);} else process.stdout.write(JSON.stringify(result,null,2)+"\n"); }
if(require.main===module) main();
module.exports={deriveWorldChanges,normalizeStateRecord,trajectoryKey};
