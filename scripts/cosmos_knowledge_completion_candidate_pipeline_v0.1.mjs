#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
const clean=v=>typeof v==="string"?v.trim():"";
function arg(name,d=""){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:d;}
function read(file){return JSON.parse(fs.readFileSync(path.resolve(file),"utf8"));}
function write(file,value){const p=path.resolve(file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value,null,2)+"\n");}
function ensureFile(file,label){if(!clean(file))throw new Error(`Missing ${label}.`);if(!fs.existsSync(path.resolve(file)))throw new Error(`${label} does not exist: ${file}`);}
function run(script,args){ensureFile(script,`stage script ${script}`);const r=spawnSync(process.execPath,[script,...args],{cwd:process.cwd(),encoding:"utf8"});if(r.status!==0)throw new Error(`${script} failed (${r.status}).\n${r.stderr||r.stdout||""}`);}
export function validateAcquisition(acq){
  const plans=Array.isArray(acq?.acquisition_plans)?acq.acquisition_plans:[];
  if(acq?.schema_version!=="0.1")throw new Error("Acquisition schema must be 0.1.");
  if(acq?.status!=="acquisition_plans_resolved")throw new Error("Acquisition must be resolved.");
  if(plans.length<1)throw new Error("Acquisition produced no plans.");
  if(acq?.acquisition_state?.execution_mode!=="planned_only")throw new Error("Acquisition must remain planned_only.");
  if(acq?.acquisition_state?.external_execution_connected!==false)throw new Error("External execution must remain disconnected.");
  if(acq?.acquisition_state?.evidence_validation_required_before_graph_admission!==true)throw new Error("Evidence Validation must remain required before graph admission.");
  return true;
}
export function validateApplicability(p){
  const evaluations=Array.isArray(p?.evaluations)?p.evaluations:[];
  if(p?.schema_version!=="0.1"||p?.status!=="acquisition_applicability_resolved")throw new Error("Acquisition Applicability did not resolve.");
  if(p?.source_acquisition?.schema_version!=="0.1")throw new Error("Applicability lost Acquisition lineage.");
  if(evaluations.length<1)throw new Error("Applicability produced no evaluations.");
  if(p?.applicability_state?.external_execution_connected!==false)throw new Error("Applicability connected external execution.");
  if(p?.applicability_state?.conceptual_distance_limit!==null)throw new Error("Applicability imposed a conceptual distance limit.");
  if(p?.applicability_state?.continuation_possible!==true)throw new Error("Applicability closed Cosmos continuation.");
  return true;
}
export function validateDecomposition(p){
  const rows=Array.isArray(p?.decompositions)?p.decompositions:[];
  const candidates=rows.flatMap(x=>Array.isArray(x.candidates)?x.candidates:[]);
  const queue=Array.isArray(p?.candidate_validation_queue)?p.candidate_validation_queue:[];
  if(p?.schema_version!=="0.1")throw new Error("Decomposition schema must be 0.1.");
  if(p?.source_applicability?.schema_version!=="0.1")throw new Error("Decomposition lost Applicability lineage.");
  if(rows.length<1)throw new Error("Decomposition produced no decomposition rows.");
  if(candidates.length<1)throw new Error("Decomposition produced no provisional candidates.");
  if(queue.length!==candidates.length)throw new Error("Decomposition candidate validation queue does not match candidates.");
  if(Number(p?.decomposition_state?.validated_candidate_count)!==0||Number(p?.decomposition_state?.executable_candidate_count)!==0)throw new Error("Decomposition improperly validated/promoted candidates.");
  if(p?.decomposition_state?.external_execution_connected!==false)throw new Error("Decomposition connected external execution.");
  for(const c of candidates){if(c.epistemic_status!=="provisional_candidate"||c.validated!==false||c.executable!==false)throw new Error(`Candidate ${c.decomposition_candidate_id||"(unknown)"} crossed epistemic boundary.`);}
  return {rows,candidates,queue};
}
export function validateCandidateValidation(p){
  const targets=Array.isArray(p?.validation_targets)?p.validation_targets:[];
  const queue=Array.isArray(p?.future_evidence_queue)?p.future_evidence_queue:[];
  if(p?.schema_version!=="0.1"||p?.status!=="candidate_validation_targets_resolved")throw new Error("Candidate Validation Planner did not resolve.");
  if(p?.source_decomposition?.schema_version!=="0.1")throw new Error("Candidate Validation lost Decomposition lineage.");
  if(targets.length<1)throw new Error("Candidate Validation produced no validation targets.");
  if(queue.length!==targets.length)throw new Error("Future evidence queue does not match validation targets.");
  if(Number(p?.validation_state?.validated_target_count)!==0||Number(p?.validation_state?.executable_target_count)!==0)throw new Error("Candidate Validation Planner improperly validated/promoted targets.");
  if(p?.validation_state?.external_execution_connected!==false)throw new Error("Candidate Validation connected external execution.");
  for(const t of targets){if(t.epistemic_status!=="provisional_candidate"||t.validation_status!=="not_started"||t.executable!==false||t.knowledge_status!=="not_admitted")throw new Error(`Validation target ${t.validation_target_id||"(unknown)"} crossed epistemic boundary.`);}
  return {targets,queue};
}
export function runCandidatePipeline({acquisition,out_dir,scripts={}}){
  ensureFile(acquisition,"acquisition input");if(!clean(out_dir))throw new Error("Missing out_dir.");
  const acq=read(acquisition);validateAcquisition(acq);
  const outDir=path.resolve(out_dir);fs.mkdirSync(outDir,{recursive:true});
  const applicabilityFile=path.join(outDir,"applicability.json");
  const decompositionFile=path.join(outDir,"decomposition.json");
  const candidateFile=path.join(outDir,"candidate-validation.json");
  const applicabilityScript=scripts.applicability||"scripts/cosmos_acquisition_applicability.cjs";
  const decompositionScript=scripts.decomposition||"scripts/cosmos_decomposition.cjs";
  const candidateScript=scripts.candidate_validation||"scripts/cosmos_candidate_validation.cjs";
  run(applicabilityScript,["--input",acquisition,"--out",applicabilityFile]);
  const applicability=read(applicabilityFile);validateApplicability(applicability);
  run(decompositionScript,["--input",applicabilityFile,"--out",decompositionFile]);
  const decomposition=read(decompositionFile);const ds=validateDecomposition(decomposition);
  run(candidateScript,["--input",decompositionFile,"--out",candidateFile]);
  const validation=read(candidateFile);const vs=validateCandidateValidation(validation);
  const result={
    schema_version:"0.1",status:"knowledge_completion_candidate_pipeline_resolved",
    stage_order:["acquisition_applicability","decomposition","candidate_validation"],
    outputs:{applicability:applicabilityFile,decomposition:decompositionFile,candidate_validation:candidateFile},
    counts:{acquisition_plans:acq.acquisition_plans.length,applicability_evaluations:applicability.evaluations.length,decomposition_rows:ds.rows.length,provisional_candidates:ds.candidates.length,validation_targets:vs.targets.length,future_evidence_queue:vs.queue.length},
    next_stage:"evidence_strategy",
    boundaries:{external_evidence_execution_performed:false,evidence_validation_performed:false,knowledge_admission_performed:false,graph_mutation_performed:false},
    contracts:{uses_real_applicability_engine:true,uses_real_decomposition_engine:true,uses_real_candidate_validation_engine:true,provisional_candidates_are_not_facts:true,validation_targets_are_not_validated:true,evidence_required_before_admission:true,question_completion_continues_to_evidence_strategy:true},
    safeguards:{performs_external_search:false,calls_openai_or_external_api:false,invents_evidence:false,admits_knowledge:false,writes_graph:false,promotes_provisional_candidate_to_fact:false}
  };
  write(path.join(outDir,"pipeline-result.json"),result);return result;
}
const acquisition=arg("--acquisition"),outDir=arg("--out-dir");
if(acquisition){process.stdout.write(JSON.stringify(runCandidatePipeline({acquisition,out_dir:outDir}),null,2)+"\n");}
