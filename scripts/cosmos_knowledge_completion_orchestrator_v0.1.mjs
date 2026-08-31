#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const arr=v=>Array.isArray(v)?v:[];
const clean=v=>typeof v==="string"?v.trim():"";

function arg(name,fallback=""){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"))}

function requiredStages(){
  return [
    "acquisition",
    "acquisition_applicability",
    "decomposition",
    "candidate_validation",
    "evidence_strategy",
    "evidence_execution",
    "evidence_validation",
    "knowledge_admission",
    "graph_writer",
    "answer_rebuild"
  ];
}

function descriptor(stage,ctx){
  const purpose={
    acquisition:"Identify candidate knowledge required by the missing contract.",
    acquisition_applicability:"Determine which candidates apply to the resolved subject and question.",
    decomposition:"Break the missing knowledge into verifiable atomic claims.",
    candidate_validation:"Validate candidate structure before evidence collection.",
    evidence_strategy:"Define evidence requirements for each claim.",
    evidence_execution:"Execute only an explicitly enabled evidence plan.",
    evidence_validation:"Validate whether evidence supports each claim.",
    knowledge_admission:"Apply existing Cosmos admission rules.",
    graph_writer:"Write only admitted records through Graph Writer.",
    answer_rebuild:"Rerun Question/Answer Resolver against the updated graph."
  }[stage];

  return {
    stage,
    subject_id:ctx.subject_id,
    subject_label:ctx.subject_label,
    question:ctx.question,
    knowledge_contract:ctx.knowledge_contract,
    purpose,
    requires_explicit_output:true
  };
}

export function createKnowledgeCompletionRun(input){
  const completion=input?.knowledge_completion || input;
  const subject=input?.subject_match || input?.subject || completion?.subject_match || null;
  const question=clean(input?.question || completion?.question);
  const subjectId=clean(subject?.id || subject?.entity_id);
  const subjectLabel=clean(subject?.label || subject?.name);
  const contract=completion?.knowledge_contract || completion?.contract || null;

  if(!question) throw new Error("Knowledge completion run requires a question.");
  if(!subjectId) throw new Error("Knowledge completion run requires a resolved subject.");
  if(!contract) throw new Error("Knowledge completion run requires a knowledge contract.");

  const stages=requiredStages();
  const ctx={question,subject_id:subjectId,subject_label:subjectLabel,knowledge_contract:contract};

  return {
    schema_version:"0.1",
    run_id:`kc:${subjectId}:${contract.contract_id||"knowledge"}`,
    status:"knowledge_completion_planned",
    question,
    subject:{id:subjectId,label:subjectLabel},
    knowledge_contract:contract,
    stage_order:stages,
    stages:stages.map(stage=>({...descriptor(stage,ctx),state:"pending",output:null})),
    current_stage:"acquisition",
    requires_evidence_acquisition:true,
    external_execution_enabled:false,
    graph_mutation_enabled:false,
    answer_ready:false,
    projection_release:false,
    contracts:{
      uses_existing_acquisition_pipeline:true,
      evidence_required_before_admission:true,
      admission_required_before_graph_write:true,
      graph_write_required_before_answer_rebuild:true,
      question_remains_primary_observer:true,
      broad_projection_released_only_after_supported_answer:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_missing_facts:false,
      auto_admits_candidates:false,
      mutates_graph_directly:false,
      skips_evidence_validation:false,
      promotes_scenario_to_fact:false
    }
  };
}

function validateStageOutput(stage,output){
  if(output==null || typeof output!=="object") return {ok:false,reason:"missing_or_invalid_output"};
  if(stage==="evidence_validation" && !arr(output.decisions).length)
    return {ok:false,reason:"evidence_validation_requires_decisions"};
  if(stage==="knowledge_admission" && !arr(output.decisions).length)
    return {ok:false,reason:"knowledge_admission_requires_decisions"};
  if(stage==="graph_writer" && !arr(output.written_relationship_ids).length && !arr(output.written_object_ids).length)
    return {ok:false,reason:"graph_writer_requires_written_ids"};
  if(stage==="answer_rebuild"){
    if(output.answer_ready!==true) return {ok:false,reason:"answer_rebuild_not_ready"};
    if(!arr(output.projection_seed_ids).length) return {ok:false,reason:"answer_rebuild_requires_projection_seeds"};
  }
  return {ok:true};
}

export function applyKnowledgeCompletionStage(run,stage,output){
  const copy=JSON.parse(JSON.stringify(run));
  const index=copy.stages.findIndex(x=>x.stage===stage);
  if(index<0) throw new Error(`Unknown completion stage: ${stage}`);

  const firstPending=copy.stages.findIndex(x=>x.state!=="completed");
  if(firstPending!==index)
    throw new Error(`Stage ${stage} cannot run before ${copy.stages[firstPending]?.stage||"completion"}.`);

  const checked=validateStageOutput(stage,output);
  if(!checked.ok){
    copy.stages[index].state="blocked";
    copy.stages[index].output=output;
    copy.status="knowledge_completion_blocked";
    copy.blocked_reason=checked.reason;
    copy.current_stage=stage;
    return copy;
  }

  copy.stages[index].state="completed";
  copy.stages[index].output=output;
  delete copy.blocked_reason;

  const next=copy.stages.find(x=>x.state!=="completed");
  if(next){
    copy.current_stage=next.stage;
    copy.status="knowledge_completion_in_progress";
  }else{
    copy.current_stage=null;
    copy.status="knowledge_completion_completed";
    copy.answer_ready=true;
    copy.projection_release=true;
  }
  return copy;
}

const inputFile=arg("--input");
const outFile=arg("--out");
const stage=arg("--stage");
const stageOutputFile=arg("--stage-output");

if(inputFile){
  const input=readJson(inputFile);
  const result=stage
    ? applyKnowledgeCompletionStage(input,stage,readJson(stageOutputFile))
    : createKnowledgeCompletionRun(input);
  const text=JSON.stringify(result,null,2)+"\n";
  if(outFile){
    fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});
    fs.writeFileSync(outFile,text);
  }else process.stdout.write(text);
}
