#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion Candidate Pipeline v0.1
 *
 * Correct branching:
 *   Acquisition -> Applicability
 *     A) decomposition_required -> Decomposition -> Candidate Validation
 *     B) applicable -> Acquisition Execution required
 *
 * No branch is forced. No external execution, evidence validation,
 * knowledge admission, or graph mutation occurs here.
 */
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
  if(acq?.schema_version!=="0.1"||acq?.status!=="acquisition_plans_resolved")throw new Error("Acquisition must be v0.1 and resolved.");
  if(plans.length<1)throw new Error("Acquisition produced no plans.");
  if(acq?.acquisition_state?.execution_mode!=="planned_only")throw new Error("Acquisition must remain planned_only.");
  if(acq?.acquisition_state?.external_execution_connected!==false)throw new Error("External execution must remain disconnected.");
  if(acq?.acquisition_state?.evidence_validation_required_before_graph_admission!==true)throw new Error("Evidence Validation must remain required before graph admission.");
  return plans;
}

export function validateApplicability(p){
  const evaluations=Array.isArray(p?.evaluations)?p.evaluations:[];
  const executable=Array.isArray(p?.executable_queue)?p.executable_queue:[];
  const decomposition=Array.isArray(p?.decomposition_queue)?p.decomposition_queue:[];
  if(p?.schema_version!=="0.1"||p?.status!=="acquisition_applicability_resolved")throw new Error("Acquisition Applicability did not resolve.");
  if(p?.source_acquisition?.schema_version!=="0.1")throw new Error("Applicability lost Acquisition lineage.");
  if(evaluations.length<1)throw new Error("Applicability produced no evaluations.");
  if(p?.applicability_state?.external_execution_connected!==false)throw new Error("Applicability connected external execution.");
  if(p?.applicability_state?.conceptual_distance_limit!==null)throw new Error("Applicability imposed a conceptual distance limit.");
  if(p?.applicability_state?.continuation_possible!==true)throw new Error("Applicability closed Cosmos continuation.");
  for(const e of evaluations){
    if(!["applicable","decomposition_required"].includes(e.applicability_status))throw new Error(`Unknown applicability status ${e.applicability_status}`);
    if(e.applicability_status==="applicable"&&e.executable!==true)throw new Error("Applicable plan must be executable.");
    if(e.applicability_status==="decomposition_required"&&e.executable!==false)throw new Error("Decomposition-required plan must remain blocked.");
  }
  return {evaluations,executable,decomposition};
}

export function validateDecomposition(p){
  const rows=Array.isArray(p?.decompositions)?p.decompositions:[];
  const candidates=rows.flatMap(x=>Array.isArray(x.candidates)?x.candidates:[]);
  const queue=Array.isArray(p?.candidate_validation_queue)?p.candidate_validation_queue:[];
  if(p?.schema_version!=="0.1"||p?.status!=="decomposition_candidates_resolved")throw new Error("Decomposition did not resolve.");
  if(p?.source_applicability?.schema_version!=="0.1")throw new Error("Decomposition lost Applicability lineage.");
  if(rows.length<1)throw new Error("Decomposition produced no decomposition rows.");
  if(candidates.length<1)throw new Error("Decomposition produced no provisional candidates.");
  if(queue.length!==candidates.length)throw new Error("Decomposition queue does not match candidates.");
  for(const c of candidates){
    if(c.epistemic_status!=="provisional_candidate"||c.validated!==false||c.executable!==false)throw new Error(`Candidate ${c.decomposition_candidate_id||"(unknown)"} crossed epistemic boundary.`);
  }
  return {rows,candidates,queue};
}

export function validateCandidateValidation(p){
  const targets=Array.isArray(p?.validation_targets)?p.validation_targets:[];
  const queue=Array.isArray(p?.future_evidence_queue)?p.future_evidence_queue:[];
  if(p?.schema_version!=="0.1"||p?.status!=="candidate_validation_targets_resolved")throw new Error("Candidate Validation Planner did not resolve.");
  if(p?.source_decomposition?.schema_version!=="0.1")throw new Error("Candidate Validation lost Decomposition lineage.");
  if(targets.length<1||queue.length!==targets.length)throw new Error("Candidate Validation target/queue invalid.");
  for(const t of targets){
    if(t.epistemic_status!=="provisional_candidate"||t.validation_status!=="not_started"||t.executable!==false||t.knowledge_status!=="not_admitted")throw new Error(`Validation target ${t.validation_target_id||"(unknown)"} crossed epistemic boundary.`);
  }
  return {targets,queue};
}

export function runCandidatePipeline({acquisition,out_dir,scripts={}}){
  ensureFile(acquisition,"acquisition input"); if(!clean(out_dir))throw new Error("Missing out_dir.");
  const acq=read(acquisition); const plans=validateAcquisition(acq);
  const outDir=path.resolve(out_dir);fs.mkdirSync(outDir,{recursive:true});
  const appFile=path.join(outDir,"applicability.json");
  run(scripts.applicability||"scripts/cosmos_acquisition_applicability.cjs",["--input",acquisition,"--out",appFile]);
  const app=read(appFile); const a=validateApplicability(app);

  const common={
    schema_version:"0.1",
    stage_order:["acquisition_applicability"],
    counts:{acquisition_plans:plans.length,applicability_evaluations:a.evaluations.length,applicable_plans:a.executable.length,decomposition_required_plans:a.decomposition.length},
    boundaries:{external_evidence_execution_performed:false,evidence_validation_performed:false,knowledge_admission_performed:false,graph_mutation_performed:false},
    safeguards:{performs_external_search:false,calls_openai_or_external_api:false,invents_evidence:false,admits_knowledge:false,writes_graph:false,promotes_provisional_candidate_to_fact:false}
  };

  // Important: an applicable plan is already concrete enough for execution.
  // Do not fabricate decomposition merely to satisfy a fixed pipeline.
  if(a.executable.length>0 && a.decomposition.length===0){
    const result={
      ...common,
      status:"knowledge_completion_acquisition_execution_required",
      route:"applicable_direct_execution",
      next_stage:"acquisition_execution",
      executable_acquisition_queue:a.executable,
      contracts:{
        applicability_controls_branching:true,
        applicable_plans_skip_decomposition:true,
        executable_acquisition_plan_preserved:true,
        external_execution_still_gated:true,
        evidence_required_before_admission:true
      }
    };
    write(path.join(outDir,"pipeline-result.json"),result); return result;
  }

  if(a.decomposition.length>0){
    const decompFile=path.join(outDir,"decomposition.json");
    const validationFile=path.join(outDir,"candidate-validation.json");
    run(scripts.decomposition||"scripts/cosmos_decomposition.cjs",["--input",appFile,"--out",decompFile]);
    const decomp=read(decompFile); const ds=validateDecomposition(decomp);
    run(scripts.candidate_validation||"scripts/cosmos_candidate_validation.cjs",["--input",decompFile,"--out",validationFile]);
    const validation=read(validationFile); const vs=validateCandidateValidation(validation);
    const result={
      ...common,
      status:"knowledge_completion_candidate_validation_ready",
      route:"decomposition_required",
      stage_order:["acquisition_applicability","decomposition","candidate_validation"],
      next_stage:"evidence_strategy",
      counts:{...common.counts,decomposition_rows:ds.rows.length,provisional_candidates:ds.candidates.length,validation_targets:vs.targets.length,future_evidence_queue:vs.queue.length},
      contracts:{
        applicability_controls_branching:true,
        decomposition_only_when_required:true,
        provisional_candidates_are_not_facts:true,
        validation_targets_are_not_validated:true,
        evidence_required_before_admission:true
      }
    };
    write(path.join(outDir,"pipeline-result.json"),result); return result;
  }

  throw new Error("Applicability resolved but produced neither executable nor decomposition route.");
}

const acquisition=arg("--acquisition"),outDir=arg("--out-dir");
if(acquisition)process.stdout.write(JSON.stringify(runCandidatePipeline({acquisition,out_dir:outDir}),null,2)+"\n");
