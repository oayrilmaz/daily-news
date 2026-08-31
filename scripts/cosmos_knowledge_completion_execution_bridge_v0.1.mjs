#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion Execution Bridge v0.1
 *
 * Connects Knowledge Completion Orchestrator stage names to the existing
 * Cosmos executable stage files and their established CLI contracts.
 *
 * Default mode is PLAN ONLY.
 * It performs no external search, no OpenAI calls, no graph mutation,
 * and no production writes unless explicit execution inputs are supplied.
 */

import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const clean=v=>typeof v==="string"?v.trim():"";
const exists=f=>fs.existsSync(path.resolve(f));
const read=f=>JSON.parse(fs.readFileSync(path.resolve(f),"utf8"));
const write=(f,v)=>{
  const p=path.resolve(f);
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,JSON.stringify(v,null,2)+"\n");
};

const STAGES={
  acquisition:{
    script:"scripts/cosmos_acquisition.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  acquisition_applicability:{
    script:"scripts/cosmos_acquisition_applicability.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  decomposition:{
    script:"scripts/cosmos_decomposition.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  candidate_validation:{
    script:"scripts/cosmos_candidate_validation.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  evidence_strategy:{
    script:"scripts/cosmos_evidence_strategy.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  evidence_execution:{
    script:"scripts/cosmos_evidence_executor.cjs",
    args:({strategy,adapter_results,out})=>[
      "--strategy",strategy,
      "--adapter-results",adapter_results,
      "--out",out
    ],
    external:true,
    mutates_graph:false
  },
  evidence_validation:{
    script:"scripts/cosmos_evidence_validator.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  knowledge_admission:{
    script:"scripts/cosmos_knowledge_admission.cjs",
    args:({input,out})=>["--input",input,"--out",out],
    external:false,
    mutates_graph:false
  },
  graph_writer:{
    script:"scripts/cosmos_graph_writer.cjs",
    args:({admission,graph,out,report})=>[
      "--admission",admission,
      "--graph",graph,
      "--out",out,
      "--report",report
    ],
    external:false,
    mutates_graph:true
  }
};

export function buildExecutionPlan(orchestratorRun, options={}){
  const mode=clean(options.mode)||"plan_only";
  if(!["plan_only","controlled_execute"].includes(mode)){
    throw new Error(`Unsupported execution mode: ${mode}`);
  }

  const externalEnabled=options.external_execution_enabled===true;
  const graphWriteEnabled=options.graph_write_enabled===true;

  const stages=(orchestratorRun?.stage_order||[])
    .filter(stage=>STAGES[stage])
    .map(stage=>{
      const spec=STAGES[stage];
      let state="ready_for_input";
      let reason=null;

      if(spec.external && !externalEnabled){
        state="gated";
        reason="external_execution_disabled";
      }
      if(spec.mutates_graph && !graphWriteEnabled){
        state="gated";
        reason="graph_write_disabled";
      }

      return {
        stage,
        script:spec.script,
        execution_state:state,
        gated_reason:reason,
        performs_external_work:spec.external,
        graph_mutation_boundary:spec.mutates_graph
      };
    });

  return {
    schema_version:"0.1",
    status:"knowledge_completion_execution_plan_ready",
    run_id:orchestratorRun?.run_id||null,
    question:orchestratorRun?.question||null,
    subject:orchestratorRun?.subject||null,
    mode,
    external_execution_enabled:externalEnabled,
    graph_write_enabled:graphWriteEnabled,
    stage_count:stages.length,
    stages,
    contracts:{
      reuses_existing_cosmos_stage_scripts:true,
      preserves_existing_cli_boundaries:true,
      external_evidence_execution_requires_explicit_enable:true,
      graph_writer_requires_explicit_enable:true,
      graph_writer_remains_only_mutation_boundary:true,
      plan_only_is_default:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      mutates_graph:false,
      invents_stage_output:false,
      bypasses_evidence_validation:false,
      bypasses_knowledge_admission:false
    }
  };
}

export function validateEnvironment(plan){
  const checks=plan.stages.map(s=>({
    stage:s.stage,
    script:s.script,
    exists:exists(s.script)
  }));
  return {
    schema_version:"0.1",
    status:checks.every(x=>x.exists)
      ?"knowledge_completion_execution_environment_ready"
      :"knowledge_completion_execution_environment_incomplete",
    checks,
    ready:checks.every(x=>x.exists)
  };
}

function requireFile(name,value){
  if(!clean(value)) throw new Error(`Missing ${name}`);
  if(!exists(value)) throw new Error(`${name} file does not exist: ${value}`);
}

export function executeStage(stage, params={}, options={}){
  if(!STAGES[stage]) throw new Error(`Unsupported stage: ${stage}`);

  const spec=STAGES[stage];
  if(spec.external && options.external_execution_enabled!==true){
    throw new Error("Evidence execution is gated: external_execution_enabled must be true.");
  }
  if(spec.mutates_graph && options.graph_write_enabled!==true){
    throw new Error("Graph Writer is gated: graph_write_enabled must be true.");
  }

  if(stage==="evidence_execution"){
    requireFile("strategy",params.strategy);
    requireFile("adapter_results",params.adapter_results);
  }else if(stage==="graph_writer"){
    requireFile("admission",params.admission);
    requireFile("graph",params.graph);
  }else{
    requireFile("input",params.input);
  }

  if(!clean(params.out)) throw new Error("Missing out");
  if(stage==="graph_writer" && !clean(params.report)) throw new Error("Missing report");

  if(!exists(spec.script)) throw new Error(`Missing stage script: ${spec.script}`);

  const args=spec.args(params);
  fs.mkdirSync(path.dirname(path.resolve(params.out)),{recursive:true});
  if(params.report) fs.mkdirSync(path.dirname(path.resolve(params.report)),{recursive:true});

  const result=spawnSync(process.execPath,[spec.script,...args],{
    cwd:process.cwd(),
    encoding:"utf8"
  });

  if(result.status!==0){
    throw new Error(
      `Stage ${stage} failed (${result.status}).\n${result.stderr||result.stdout||""}`
    );
  }

  if(!exists(params.out)) throw new Error(`Stage ${stage} did not create ${params.out}`);

  return {
    schema_version:"0.1",
    status:"knowledge_completion_stage_executed",
    stage,
    script:spec.script,
    output_file:params.out,
    report_file:params.report||null,
    external_execution_used:spec.external,
    graph_mutation_boundary_used:spec.mutates_graph
  };
}

function arg(name,fallback=""){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}

const orchestratorFile=arg("--orchestrator");
const out=arg("--out");
const mode=arg("--mode","plan_only");

if(orchestratorFile){
  const run=read(orchestratorFile);
  const plan=buildExecutionPlan(run,{
    mode,
    external_execution_enabled:process.argv.includes("--enable-external"),
    graph_write_enabled:process.argv.includes("--enable-graph-write")
  });

  const payload={
    ...plan,
    environment:validateEnvironment(plan)
  };

  if(out) write(out,payload);
  else process.stdout.write(JSON.stringify(payload,null,2)+"\n");
}
