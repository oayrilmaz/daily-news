#!/usr/bin/env node
"use strict";

/**
 * PTD Today / Cosmos — Acquisition Applicability v0.1
 *
 * Purpose:
 * Prevent semantically invalid acquisition plans from reaching a future
 * evidence executor.
 *
 * Examples:
 *   Transformers + identify_components -> applicable
 *   Artificial Intelligence + identify_components -> decompose first
 *   Artificial Intelligence + identify_capacity -> decompose first
 *
 * This layer does NOT search, call an LLM, invent evidence, or write knowledge.
 * It only evaluates whether the requested investigation is meaningful for the
 * target entity at its current abstraction level.
 */

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a||[]).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function writeJson(file,payload){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(payload,null,2),"utf8");
}

const ABSTRACT_TARGET_PATTERNS = [
  /\bartificial intelligence\b/i,
  /\bmachine learning\b/i,
  /\bdigitalization\b/i,
  /\bdecarboni[sz]ation\b/i,
  /\belectrification\b/i,
  /\benergy transition\b/i,
  /\bclimate change\b/i,
  /\beconomic growth\b/i,
  /\binflation\b/i,
  /\bgeopolitics\b/i
];

const PHYSICAL_ACQUISITION_TYPES = new Set([
  "identify_components",
  "identify_materials",
  "identify_capacity",
  "identify_suppliers",
  "identify_buyers",
  "identify_substitutes",
  "identify_logistics"
]);

const DECOMPOSITION_HINTS = {
  "Artificial Intelligence": [
    "AI compute infrastructure",
    "semiconductors and accelerators",
    "data centers",
    "electricity demand",
    "cooling systems",
    "networking infrastructure",
    "software/model infrastructure"
  ],
  "Machine Learning": [
    "compute infrastructure",
    "semiconductors",
    "data centers",
    "software/model infrastructure"
  ],
  "Electrification": [
    "electric vehicles",
    "industrial electric loads",
    "grid infrastructure",
    "transformers",
    "switchgear",
    "generation and storage"
  ],
  "Energy Transition": [
    "renewable generation",
    "energy storage",
    "transmission",
    "distribution",
    "critical materials",
    "manufacturing capacity"
  ]
};

function extractSubject(statement){
  const s=clean(statement);

  const patterns=[
    /dependencies behind (.+?)\.$/i,
    /supporting (.+?)\.$/i,
    /constraints for (.+?)\.$/i,
    /exposure for (.+?)\.$/i,
    /locations? (?:for|behind) (.+?)\.$/i
  ];

  for(const p of patterns){
    const m=s.match(p);
    if(m?.[1]) return clean(m[1]);
  }

  return s;
}

function isAbstractTarget(subject){
  return ABSTRACT_TARGET_PATTERNS.some(p=>p.test(subject));
}

function decompositionHints(subject){
  for(const [key,hints] of Object.entries(DECOMPOSITION_HINTS)){
    if(subject.toLowerCase().includes(key.toLowerCase())) return hints;
  }
  return [
    "physical infrastructure",
    "organizations and market participants",
    "materials and components",
    "geographic nodes",
    "human actors",
    "operational dependencies"
  ];
}

function evaluatePlan(plan){
  const subject=extractSubject(plan.statement);
  const physical=PHYSICAL_ACQUISITION_TYPES.has(plan.target_type);
  const abstract=isAbstractTarget(subject);

  if(physical && abstract){
    return {
      acquisition_plan_id:plan.acquisition_plan_id,
      discovery_target_id:plan.discovery_target_id,
      target_type:plan.target_type,
      original_statement:plan.statement,
      subject,
      applicability_status:"decomposition_required",
      executable:false,
      reason:
        `The acquisition type "${plan.target_type}" expects a physical, organizational, or operational target, but "${subject}" is represented at an abstract/conceptual level.`,
      decomposition_question:
        `Which concrete systems, organizations, resources, people, locations, or infrastructures instantiate "${subject}" for this consequence path?`,
      decomposition_hints:decompositionHints(subject),
      original_plan_preserved:true
    };
  }

  return {
    acquisition_plan_id:plan.acquisition_plan_id,
    discovery_target_id:plan.discovery_target_id,
    target_type:plan.target_type,
    original_statement:plan.statement,
    subject,
    applicability_status:"applicable",
    executable:true,
    reason:"The acquisition target is meaningful at its current abstraction level.",
    decomposition_question:null,
    decomposition_hints:[],
    original_plan_preserved:true
  };
}

function runApplicability(raw){
  if(!raw || raw.status!=="acquisition_plans_resolved")
    throw new Error(
      `Cosmos Applicability requires acquisition_plans_resolved input; got ${raw?.status}`
    );

  const plans=Array.isArray(raw.acquisition_plans)?raw.acquisition_plans:[];
  if(!plans.length) throw new Error("acquisition_plans[] is required.");

  const evaluations=plans.map(evaluatePlan);
  const byId=new Map(evaluations.map(x=>[x.acquisition_plan_id,x]));

  const executable_queue=(raw.future_executor_queue||[])
    .filter(q=>byId.get(q.acquisition_plan_id)?.executable===true)
    .map((q,index)=>({
      ...q,
      execution_rank:index+1,
      applicability_status:"applicable"
    }));

  const decomposition_queue=evaluations
    .filter(x=>x.applicability_status==="decomposition_required")
    .map((x,index)=>({
      decomposition_rank:index+1,
      acquisition_plan_id:x.acquisition_plan_id,
      discovery_target_id:x.discovery_target_id,
      target_type:x.target_type,
      subject:x.subject,
      question:x.decomposition_question,
      hints:x.decomposition_hints,
      status:"not_resolved"
    }));

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"acquisition_applicability_resolved",

    source_acquisition:{
      schema_version:raw.schema_version||null,
      generated_at:raw.generated_at||null,
      status:raw.status||null
    },

    applicability_state:{
      plan_count:plans.length,
      applicable_count:evaluations.filter(x=>x.executable).length,
      decomposition_required_count:decomposition_queue.length,
      executable_queue_count:executable_queue.length,
      external_execution_connected:false,
      conceptual_distance_limit:
        raw.acquisition_state?.conceptual_distance_limit??null,
      continuation_possible:
        raw.acquisition_state?.continuation_possible===true,
      principle:
        "Cosmos must not execute a physically specific investigation against an abstract target before decomposing that target into concrete instantiations."
    },

    evaluations,
    executable_queue,
    decomposition_queue,

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      invents_evidence:false,
      invents_entities:false,
      writes_to_knowledge_graph:false,
      mutates_source_acquisition_plans:false,
      executes_decomposition_hints_as_facts:false,
      abstract_targets_blocked_from_physical_execution:true,
      source_lineage_preserved:true
    }
  };
}

function parseArgs(argv){
  const args=argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    if(args[i]==="--input"&&args[i+1]) out.input_file=args[++i];
    else if(args[i]==="--out"&&args[i+1]) out.output_file=args[++i];
  }
  return out;
}

function main(){
  const options=parseArgs(process.argv);

  if(!options.input_file)
    throw new Error(
      "Usage: node scripts/cosmos_acquisition_applicability.cjs --input <acquisition.json> [--out <applicability.json>]"
    );

  const output=runApplicability(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Acquisition Applicability output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runApplicability,
  evaluatePlan,
  extractSubject,
  isAbstractTarget,
  decompositionHints
};
