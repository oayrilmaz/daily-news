#!/usr/bin/env node
/**
 * Cosmos Semantic Persistence Bridge v0.1
 *
 * Purpose:
 * Enrich already-persistent Cosmos graph records with the semantic claim
 * required for later answer reconstruction. This module MUST NOT create
 * knowledge, change validation decisions, change confidence, or admit records.
 *
 * Inputs:
 *   --graph <cosmos graph snapshot>
 *   --semantic-map <validated semantic claim map>
 *   --out <enriched graph snapshot>
 *   --report <bridge report>
 *
 * Semantic map row:
 * {
 *   validation_target_id,
 *   subject: { id, label },
 *   predicate: { type, label },
 *   object: { id, label, class? },
 *   answer_role?: "primary"|"secondary"|"more"|null,
 *   source_stage,
 *   semantic_status: "validated_semantic_claim"
 * }
 */

import fs from "fs";
import crypto from "crypto";

function args() {
  const a = process.argv.slice(2), out = {};
  for (let i=0;i<a.length;i+=2) out[a[i]] = a[i+1];
  return out;
}
const A=args();
for (const k of ["--graph","--semantic-map","--out","--report"]) {
  if (!A[k]) throw new Error(`Missing required argument ${k}`);
}
const read=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+"\n");
const clone=v=>JSON.parse(JSON.stringify(v));
const id=s=>"semantic_"+crypto.createHash("sha256").update(String(s)).digest("hex").slice(0,12);

const graph=read(A["--graph"]);
const map=read(A["--semantic-map"]);
if (graph.status!=="cosmos_graph_snapshot" || !Array.isArray(graph.knowledge_records)) {
  throw new Error("Invalid Cosmos graph snapshot");
}
if (map.status!=="validated_semantic_claim_map" || !Array.isArray(map.claims)) {
  throw new Error("Invalid semantic claim map");
}

const byTarget=new Map();
const errors=[];
for (const c of map.claims) {
  if (!c.validation_target_id ||
      c.semantic_status!=="validated_semantic_claim" ||
      !c.subject?.id || !c.subject?.label ||
      !c.predicate?.type || !c.predicate?.label ||
      !c.object?.id || !c.object?.label) {
    errors.push({validation_target_id:c.validation_target_id||null,reason:"invalid_semantic_claim_contract"});
    continue;
  }
  if (byTarget.has(c.validation_target_id)) {
    errors.push({validation_target_id:c.validation_target_id,reason:"duplicate_semantic_claim"});
    continue;
  }
  byTarget.set(c.validation_target_id,c);
}

const enriched=clone(graph);
let enrichedCount=0, skippedCount=0;
for (const rec of enriched.knowledge_records) {
  if (rec.active===false) { skippedCount++; continue; }
  const c=byTarget.get(rec.validation_target_id);
  if (!c) { skippedCount++; continue; }

  rec.semantic_claim = {
    semantic_claim_id:id(`${rec.knowledge_admission_id}|${c.validation_target_id}`),
    subject:clone(c.subject),
    predicate:clone(c.predicate),
    object:clone(c.object),
    answer_role:c.answer_role ?? null,
    semantic_status:"persistent_validated_semantic_claim",
    source_stage:c.source_stage,
    validation_target_id:c.validation_target_id
  };
  enrichedCount++;
}

enriched.semantic_persistence = {
  schema_version:"0.1",
  status:"semantic_persistence_applied",
  enriched_record_count:enrichedCount,
  skipped_record_count:skippedCount,
  semantic_map_claim_count:map.claims.length
};

const report={
  schema_version:"0.1",
  status:errors.length ? "semantic_persistence_resolved_with_errors" : "semantic_persistence_resolved",
  bridge_state:{
    graph_record_count:graph.knowledge_records.length,
    semantic_map_claim_count:map.claims.length,
    enriched_record_count:enrichedCount,
    skipped_record_count:skippedCount,
    error_count:errors.length
  },
  errors,
  safeguards:{
    performs_external_search:false,
    calls_openai_or_external_api:false,
    creates_new_knowledge:false,
    changes_validation_disposition:false,
    changes_confidence:false,
    changes_evidence_lineage:false,
    changes_admission_status:false,
    mutates_input_graph_in_place:false,
    enriches_only_existing_persistent_records:true,
    requires_validated_semantic_claim:true,
    preserves_reversibility:true,
    answer_role_not_invented_when_missing:true
  }
};

write(A["--out"],enriched);
write(A["--report"],report);
console.log(JSON.stringify(report,null,2));
