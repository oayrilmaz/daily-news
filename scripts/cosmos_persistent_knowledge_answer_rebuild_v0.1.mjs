#!/usr/bin/env node
/**
 * Cosmos Persistent Knowledge Answer Rebuild v0.1
 *
 * Reads ONLY persistent, active, validated semantic claims from a Cosmos graph
 * snapshot and rebuilds a direct structured answer. It does not acquire,
 * search, call AI, admit knowledge, or mutate the graph.
 */
import fs from "fs";

function args(){const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i]]=a[i+1];return o}
const A=args();
for(const k of ["--graph","--question","--subject-id","--out"]) if(!A[k]) throw new Error(`Missing ${k}`);
const graph=JSON.parse(fs.readFileSync(A["--graph"],"utf8"));
const question=A["--question"], subjectId=A["--subject-id"];
const allowed=new Set(["persistent_knowledge","persistent_qualified_knowledge"]);

const records=(graph.knowledge_records||[]).filter(r=>
  r.active!==false &&
  allowed.has(r.persistence_level) &&
  ["supported","partially_supported"].includes(r.validation_disposition) &&
  r.semantic_claim?.semantic_status==="persistent_validated_semantic_claim" &&
  r.semantic_claim?.subject?.id===subjectId
);

const components=records.filter(r=>r.semantic_claim?.predicate?.type==="CONTAINS_COMPONENT");
const uniq=new Map();
for(const r of components){
  const oid=r.semantic_claim.object?.id;
  if(!oid) continue;
  const prev=uniq.get(oid);
  if(!prev || Number(r.confidence_score||0)>Number(prev.confidence_score||0)) uniq.set(oid,r);
}
const rows=[...uniq.values()].sort((a,b)=>
  Number(b.confidence_score||0)-Number(a.confidence_score||0) ||
  String(a.semantic_claim.object.label).localeCompare(String(b.semantic_claim.object.label))
);

const subjectLabel=rows[0]?.semantic_claim?.subject?.label || subjectId;
const items=rows.map(r=>({
  id:r.semantic_claim.object.id,
  label:r.semantic_claim.object.label,
  class:r.semantic_claim.object.class||null,
  answer_role:r.semantic_claim.answer_role??null,
  confidence_score:r.confidence_score,
  confidence_band:r.confidence_band,
  validation_disposition:r.validation_disposition,
  evidence_record_ids:r.evidence_record_ids||[],
  graph_record_id:r.graph_record_id||null,
  knowledge_admission_id:r.knowledge_admission_id,
  reversible:r.reversibility?.reversible===true
}));

const sufficient=items.length>0;
const payload={
  schema_version:"0.1",
  status:sufficient?"persistent_knowledge_answer_rebuilt":"persistent_knowledge_insufficient",
  question,
  subject:{id:subjectId,label:subjectLabel},
  answer:{
    answer_type:"structured_enumeration",
    direct_answer:sufficient
      ? `Cosmos currently has ${items.length} admitted equipment relationship${items.length===1?"":"s"} for ${subjectLabel}.`
      : `Cosmos does not currently have admitted equipment relationships for ${subjectLabel}.`,
    items,
    primary_items:items.filter(x=>x.answer_role==="primary"),
    secondary_items:items.filter(x=>x.answer_role==="secondary"),
    more_items:items.filter(x=>x.answer_role==="more"),
    unclassified_items:items.filter(x=>x.answer_role==null)
  },
  routing:{
    answered_from_persistent_cosmos_knowledge:sufficient,
    knowledge_completion_required:!sufficient,
    acquisition_requested:false,
    external_search_requested:false,
    ai_requested:false,
    next_stage:sufficient?"answer_presentation":"knowledge_completion_orchestrator"
  },
  safeguards:{
    reads_persistent_graph_only:true,
    performs_external_search:false,
    calls_openai_or_external_api:false,
    performs_acquisition:false,
    creates_new_knowledge:false,
    changes_persistent_knowledge:false,
    mutates_graph:false,
    infers_labels_from_ids:false,
    invents_answer_role:false,
    preserves_confidence:true,
    preserves_evidence_lineage:true,
    qualified_knowledge_remains_qualified:true
  }
};
fs.writeFileSync(A["--out"],JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify(payload,null,2));
