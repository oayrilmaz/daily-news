#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
function args(){const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i]]=a[i+1];return o}
const A=args();
for(const k of ["--graph","--question","--subject-id","--out"]) if(!A[k]) throw new Error(`Missing ${k}`);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"cosmos-persistent-resolver-"));
try{
  const af=path.join(tmp,"answer.json");
  const r=spawnSync(process.execPath,["scripts/cosmos_persistent_knowledge_answer_rebuild_v0.1.mjs","--graph",A["--graph"],"--question",A["--question"],"--subject-id",A["--subject-id"],"--out",af],{encoding:"utf8"});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||"Persistent answer rebuild failed");
  const p=JSON.parse(fs.readFileSync(af,"utf8"));
  const known=p.status==="persistent_knowledge_answer_rebuilt"&&p.routing?.answered_from_persistent_cosmos_knowledge===true&&Array.isArray(p.answer?.items)&&p.answer.items.length>0;
  const out={schema_version:"0.1",status:"persistent_answer_resolver_resolved",question:A["--question"],subject:p.subject,route:known?"persistent_cosmos_answer":"knowledge_completion",answer_status:known?"supported_from_persistent_cosmos_knowledge":"knowledge_completion_required",persistent_answer:known?p.answer:null,knowledge_completion_request:known?null:{question:A["--question"],subject:p.subject,reason:"persistent_cosmos_knowledge_insufficient",requested_stage:"knowledge_completion_orchestrator"},projection:{release_supported_answer_projection:known,hold_broad_projection:!known,first_ring_source:known?"persistent_answer_items":"resolved_subject_only"},execution:{persistent_graph_checked:true,acquisition_executed:false,external_search_executed:false,ai_executed:false,knowledge_completion_executed:false},safeguards:{persistent_cosmos_checked_before_knowledge_completion:true,known_answer_does_not_trigger_knowledge_completion:true,unknown_answer_does_not_invent_answer:true,performs_external_search:false,calls_openai_or_external_api:false,performs_acquisition:false,mutates_graph:false,preserves_persistent_answer_confidence:true,preserves_persistent_answer_evidence_lineage:true,preserves_question_as_observer:true}};
  fs.writeFileSync(A["--out"],JSON.stringify(out,null,2)+"\n"); console.log(JSON.stringify(out,null,2));
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
