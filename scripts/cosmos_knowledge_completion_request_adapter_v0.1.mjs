#!/usr/bin/env node
/**
 * Cosmos Knowledge Completion Request Adapter v0.1
 *
 * Converts Semantic Knowledge Completion output into:
 *   1) a Knowledge Completion Orchestrator run
 *   2) a safe Execution Bridge plan
 *
 * This is the handoff from the live semantic gap detector into the
 * completion pipeline. It does not search externally, call OpenAI,
 * admit knowledge, or mutate the graph.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const clean = v => typeof v === "string" ? v.trim() : "";

function arg(name, fallback="") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeJson(file, value) {
  const p = path.resolve(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

function resolvedSubject(input) {
  return input?.subject_match ||
    input?.semantic_subject ||
    input?.subject ||
    input?.knowledge_completion?.subject_match ||
    null;
}

function completionPayload(input) {
  return input?.knowledge_completion ||
    input?.semantic_knowledge_completion ||
    input?.completion ||
    input;
}

function isSufficient(completion) {
  return completion?.answer_ready === true ||
    completion?.completion_required === false ||
    completion?.knowledge_status === "sufficient";
}

export async function buildKnowledgeCompletionRequest(input, options={}) {
  const completion = completionPayload(input);
  const subject = resolvedSubject(input);
  const question = clean(
    input?.question ||
    input?.observer?.question ||
    completion?.question
  );

  if (!question) throw new Error("Completion request requires the original question.");

  if (isSufficient(completion)) {
    return {
      schema_version: "0.1",
      status: "knowledge_completion_not_required",
      question,
      subject,
      completion_required: false,
      orchestrator_run: null,
      execution_plan: null,
      answer_rebuild_required: true,
      projection_policy: {
        keep_question_observer: true,
        broad_projection_suppressed: false
      },
      safeguards: {
        performs_external_search: false,
        calls_openai_or_external_api: false,
        mutates_graph: false,
        invents_missing_knowledge: false
      }
    };
  }

  if (completion?.completion_required !== true) {
    throw new Error("Semantic completion payload must explicitly require completion.");
  }

  if (!subject?.id && !subject?.entity_id) {
    throw new Error("Completion request requires a resolved semantic subject.");
  }

  if (!completion?.knowledge_contract && !completion?.contract) {
    throw new Error("Completion request requires a knowledge contract.");
  }

  const orchestratorPath = path.resolve(
    options.orchestrator_path ||
    "scripts/cosmos_knowledge_completion_orchestrator_v0.1.mjs"
  );

  const bridgePath = path.resolve(
    options.bridge_path ||
    "scripts/cosmos_knowledge_completion_execution_bridge_v0.1.mjs"
  );

  // Existing stage modules also expose CLI entry points. Import them with a
  // sanitized argv so their CLI blocks cannot accidentally execute during
  // composition inside this adapter.
  const originalArgv = process.argv;
  let orchestrator;
  let bridge;
  try {
    process.argv = process.argv.slice(0, 2);
    orchestrator = await import(pathToFileURL(orchestratorPath).href);
    bridge = await import(pathToFileURL(bridgePath).href);
  } finally {
    process.argv = originalArgv;
  }

  const orchestratorInput = {
    question,
    subject_match: {
      id: subject.id || subject.entity_id,
      label: subject.label || subject.name || subject.id || subject.entity_id
    },
    knowledge_completion: {
      ...completion,
      knowledge_contract: completion.knowledge_contract || completion.contract
    }
  };

  const run = orchestrator.createKnowledgeCompletionRun(orchestratorInput);

  const plan = bridge.buildExecutionPlan(run, {
    mode: "plan_only",
    external_execution_enabled: false,
    graph_write_enabled: false
  });

  return {
    schema_version: "0.1",
    status: "knowledge_completion_request_ready",
    question,
    subject: run.subject,
    completion_required: true,
    knowledge_status: completion.knowledge_status || "insufficient",
    knowledge_contract: run.knowledge_contract,
    orchestrator_run: run,
    execution_plan: plan,
    next_action: "acquisition",
    answer_rebuild_required: false,
    projection_policy: {
      keep_question_observer: true,
      broad_projection_suppressed: true,
      release_only_after_supported_answer: true
    },
    contracts: {
      semantic_gap_routes_to_orchestrator: true,
      orchestrator_routes_to_execution_bridge: true,
      original_question_preserved: true,
      resolved_subject_preserved: true,
      existing_knowledge_contract_preserved: true,
      completion_starts_at_acquisition: true,
      external_execution_remains_disabled: true,
      graph_write_remains_disabled: true
    },
    safeguards: {
      performs_external_search: false,
      calls_openai_or_external_api: false,
      mutates_graph: false,
      invents_missing_knowledge: false,
      invents_candidate_objects: false,
      bypasses_evidence_validation: false,
      bypasses_knowledge_admission: false,
      releases_projection_early: false
    }
  };
}

const inputFile = arg("--input");
const outFile = arg("--out");
const orchestratorPath = arg("--orchestrator");
const bridgePath = arg("--bridge");

if (inputFile) {
  const result = await buildKnowledgeCompletionRequest(readJson(inputFile), {
    orchestrator_path: orchestratorPath || undefined,
    bridge_path: bridgePath || undefined
  });

  if (outFile) writeJson(outFile, result);
  else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
