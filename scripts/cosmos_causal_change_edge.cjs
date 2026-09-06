#!/usr/bin/env node
"use strict";

/** Cosmos — Change→Change Causal Edge Validator v0.1 */
function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a||[]).filter(Boolean))]; }
function stableId(prefix,values){ const src=(Array.isArray(values)?values:[values]).join("|"); let h=2166136261; for(let i=0;i<src.length;i++){h^=src.charCodeAt(i);h=Math.imul(h,16777619);} return `${prefix}_${(h>>>0).toString(16).padStart(8,"0")}`; }

function validateCausalCandidate(candidate,changes){
  const byId=new Map((changes||[]).map(c=>[c.transition_id,c]));
  const from=byId.get(candidate?.from_change_id), to=byId.get(candidate?.to_change_id);
  const reasons=[];
  if(!from || from.change_type!=="world_change") reasons.push("invalid_from_world_change");
  if(!to || to.change_type!=="world_change") reasons.push("invalid_to_world_change");
  if(!clean(candidate?.mechanism)) reasons.push("missing_mechanism");
  if(!clean(candidate?.carrier)) reasons.push("missing_carrier");
  if(!Array.isArray(candidate?.conditions) || !candidate.conditions.filter(x=>clean(x)).length) reasons.push("missing_conditions");
  if(!Array.isArray(candidate?.evidence_refs) || !candidate.evidence_refs.length) reasons.push("missing_causal_evidence");
  if(!Array.isArray(candidate?.structural_support_refs) || !candidate.structural_support_refs.length) reasons.push("missing_structural_support");
  if(from && to){
    if(clean(from.epistemic_state)!=="supported" || clean(to.epistemic_state)!=="supported") reasons.push("unsupported_change_endpoint");
    const ft=Date.parse(from.current_state_time), tt=Date.parse(to.current_state_time);
    if(Number.isFinite(ft)&&Number.isFinite(tt)&&tt<ft) reasons.push("temporal_order_incompatible");
    if(clean(from.geography) && clean(to.geography) && clean(from.geography)!==clean(to.geography) && !clean(candidate?.geography_bridge)) reasons.push("geography_scope_unbridged");
    if(clean(from.scope) && clean(to.scope) && clean(from.scope)!==clean(to.scope) && !clean(candidate?.scope_bridge)) reasons.push("scope_unbridged");
  }
  if(reasons.length) return {accepted:false,reasons};
  return {
    accepted:true,
    reasons:[],
    edge:{
      causal_edge_id:stableId("cedge",[candidate.from_change_id,candidate.to_change_id,candidate.mechanism,candidate.carrier]),
      edge_type:"change_to_change",
      from_change_id:candidate.from_change_id,
      to_change_id:candidate.to_change_id,
      mechanism:clean(candidate.mechanism),
      carrier:clean(candidate.carrier),
      conditions:candidate.conditions.map(clean).filter(Boolean),
      counterforces:(candidate.counterforces||[]).map(clean).filter(Boolean),
      evidence_refs:uniq(candidate.evidence_refs),
      structural_support_refs:uniq(candidate.structural_support_refs),
      geography_bridge:clean(candidate.geography_bridge)||null,
      scope_bridge:clean(candidate.scope_bridge)||null,
      epistemic_state:"supported",
      butterfly_eligible:true
    }
  };
}

module.exports={validateCausalCandidate};
