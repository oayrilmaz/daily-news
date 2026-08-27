#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function clean(v){ return String(v ?? "").trim(); }
function uniq(a){ return [...new Set((a || []).filter(Boolean))]; }
function nowIso(){ return new Date().toISOString(); }

function stableId(prefix, values){
  const src=(Array.isArray(values)?values:[values]).join("|");
  let h=2166136261;
  for(let i=0;i<src.length;i++){
    h^=src.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return `${prefix}_${(h>>>0).toString(16).padStart(8,"0")}`;
}

function readJson(file){
  if(!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file,"utf8"));
}

function writeJson(file,payload){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(payload,null,2),"utf8");
}

function normalizeEvidenceStatus(status){
  const s=clean(status).toLowerCase();
  return ["observed","supported","inferred","scenario","speculative"].includes(s)
    ? s : "unknown";
}

function normalizeConfidence(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return 0;
  return Math.max(0,Math.min(100,n));
}

function confidenceBand(score){
  if(score>=85) return "very_high";
  if(score>=70) return "high";
  if(score>=50) return "moderate";
  if(score>=30) return "low";
  return "very_low";
}

function degradeConfidence(base, causalDepth, evidenceStatus){
  const depthPenalty=Math.max(0,Number(causalDepth)||0)*6;
  const statusPenalty={
    observed:0,
    supported:4,
    inferred:10,
    scenario:18,
    speculative:30,
    unknown:35
  }[normalizeEvidenceStatus(evidenceStatus)] ?? 35;

  return Math.max(
    0,
    Math.round(normalizeConfidence(base)-depthPenalty-statusPenalty)
  );
}

function normalizeNode(node){
  return {
    node_id:clean(node.node_id)||stableId("node",[node.label,node.type,node.role]),
    label:clean(node.label),
    type:clean(node.type)||"concept",
    role:clean(node.role)||"related",
    metadata:node.metadata && typeof node.metadata==="object" ? node.metadata : {}
  };
}

function normalizeEdge(edge){
  const evidenceStatus=normalizeEvidenceStatus(edge.evidence_status);
  const baseConfidence=normalizeConfidence(edge.confidence_score);

  return {
    edge_id:clean(edge.edge_id)||stableId("edge",[
      edge.from_node_id,edge.to_node_id,edge.relationship
    ]),
    from_node_id:clean(edge.from_node_id),
    to_node_id:clean(edge.to_node_id),
    relationship:clean(edge.relationship)||"related_to",
    evidence_status:evidenceStatus,
    confidence_score:baseConfidence,
    confidence_band:confidenceBand(baseConfidence),
    source_record_ids:uniq(edge.source_record_ids||[]),
    activation_relevance:Number.isFinite(Number(edge.activation_relevance))
      ?Number(edge.activation_relevance):0,
    time_horizon:clean(edge.time_horizon)||"unspecified",
    geography_scope:clean(edge.geography_scope)||null,
    temporal_scope:clean(edge.temporal_scope)||null
  };
}

function normalizeInput(raw){
  if(!raw || typeof raw!=="object"){
    throw new Error("Cosmos Causal Narrative requires JSON object input.");
  }

  const focal=normalizeNode(raw.focal_signal||{});
  if(!focal.label){
    throw new Error("Cosmos Causal Narrative requires focal_signal.label.");
  }

  const nodes=(Array.isArray(raw.nodes)?raw.nodes:[]).map(normalizeNode);
  if(!nodes.some(n=>n.node_id===focal.node_id)) nodes.push(focal);

  const edges=(Array.isArray(raw.edges)?raw.edges:[])
    .map(normalizeEdge)
    .filter(e=>e.from_node_id&&e.to_node_id);

  const activationEvents=(Array.isArray(raw.activation_events)
    ?raw.activation_events:[]).map((x,index)=>({
      activation_id:clean(x.activation_id)||
        stableId("activation",[focal.node_id,index,x.label]),
      label:clean(x.label),
      kind:clean(x.kind)||"related_signal",
      evidence_status:normalizeEvidenceStatus(x.evidence_status),
      confidence_score:normalizeConfidence(x.confidence_score),
      source_record_ids:uniq(x.source_record_ids||[]),
      occurred_at:clean(x.occurred_at)||null,
      relevance_score:Number.isFinite(Number(x.relevance_score))
        ?Number(x.relevance_score):0
    }));

  return {
    focal,nodes,edges,activationEvents,
    maxDepth:Number.isFinite(Number(raw.max_causal_depth))
      ?Math.max(1,Number(raw.max_causal_depth)):4
  };
}

function buildIndexes(ctx){
  const nodeById=new Map(ctx.nodes.map(n=>[n.node_id,n]));
  const outgoing=new Map();
  const incoming=new Map();

  for(const edge of ctx.edges){
    if(!outgoing.has(edge.from_node_id)) outgoing.set(edge.from_node_id,[]);
    if(!incoming.has(edge.to_node_id)) incoming.set(edge.to_node_id,[]);
    outgoing.get(edge.from_node_id).push(edge);
    incoming.get(edge.to_node_id).push(edge);
  }
  return {nodeById,outgoing,incoming};
}

function traverse(ctx,indexes,startNodeId,direction,maxDepth){
  const rows=[];
  const seenEdgeIds=new Set();
  const queue=[{nodeId:startNodeId,depth:0,pathConfidence:100}];

  while(queue.length){
    const current=queue.shift();
    if(current.depth>=maxDepth) continue;

    const candidateEdges=direction==="upstream"
      ?(indexes.incoming.get(current.nodeId)||[])
      :(indexes.outgoing.get(current.nodeId)||[]);

    for(const edge of candidateEdges){
      if(seenEdgeIds.has(edge.edge_id)) continue;
      seenEdgeIds.add(edge.edge_id);

      const nextNodeId=direction==="upstream"
        ?edge.from_node_id:edge.to_node_id;
      const nextNode=indexes.nodeById.get(nextNodeId);
      if(!nextNode) continue;

      const depth=current.depth+1;
      const effectiveConfidence=Math.min(
        current.pathConfidence,
        degradeConfidence(
          edge.confidence_score,
          depth-1,
          edge.evidence_status
        )
      );

      rows.push({
        narrative_edge_id:stableId("narrative_edge",[
          edge.edge_id,direction,depth
        ]),
        causal_depth:depth,
        from_node_id:direction==="upstream"?nextNodeId:current.nodeId,
        from_label:direction==="upstream"
          ?nextNode.label
          :(indexes.nodeById.get(current.nodeId)?.label||current.nodeId),
        to_node_id:direction==="upstream"?current.nodeId:nextNodeId,
        to_label:direction==="upstream"
          ?(indexes.nodeById.get(current.nodeId)?.label||current.nodeId)
          :nextNode.label,
        relationship:edge.relationship,
        evidence_status:edge.evidence_status,
        original_confidence_score:edge.confidence_score,
        effective_confidence_score:effectiveConfidence,
        effective_confidence_band:confidenceBand(effectiveConfidence),
        source_record_ids:edge.source_record_ids,
        time_horizon:edge.time_horizon,
        geography_scope:edge.geography_scope,
        temporal_scope:edge.temporal_scope
      });

      queue.push({
        nodeId:nextNodeId,
        depth,
        pathConfidence:effectiveConfidence
      });
    }
  }
  return rows;
}

function classifyDownstream(rows){
  return {
    direct_effects:rows.filter(x=>x.causal_depth===1),
    second_order_effects:rows.filter(x=>x.causal_depth===2),
    third_order_effects:rows.filter(x=>x.causal_depth===3),
    emerging_effects:rows.filter(x=>x.causal_depth>=4)
  };
}

function buildWhyNow(ctx){
  const ranked=[...ctx.activationEvents].sort((a,b)=>
    (b.relevance_score-a.relevance_score) ||
    (b.confidence_score-a.confidence_score)
  );

  return {
    activation_event_count:ranked.length,
    strongest_activation_events:ranked.slice(0,5),
    explanation_status:ranked.length>0
      ?"activation_evidence_available":"activation_evidence_missing",
    rule:
      "Why-now explains recent activation, not the long-run causal origin of the signal."
  };
}

function potentialNewSignals(downstream){
  return downstream
    .filter(row=>
      row.causal_depth>=2 &&
      ["supported","inferred","scenario"].includes(row.evidence_status)
    )
    .map(row=>({
      candidate_signal_id:stableId("candidate_signal",[
        row.to_node_id,row.relationship,row.causal_depth
      ]),
      label:row.to_label,
      derived_from_narrative_edge_id:row.narrative_edge_id,
      causal_depth:row.causal_depth,
      evidence_status:row.evidence_status,
      confidence_score:row.effective_confidence_score,
      confidence_band:row.effective_confidence_band,
      status:"candidate_only",
      promotion_to_signal:false
    }));
}

function runCausalNarrative(raw){
  const ctx=normalizeInput(raw);
  const indexes=buildIndexes(ctx);

  const upstream=traverse(
    ctx,indexes,ctx.focal.node_id,"upstream",ctx.maxDepth
  );
  const downstream=traverse(
    ctx,indexes,ctx.focal.node_id,"downstream",ctx.maxDepth
  );

  return {
    schema_version:"0.1",
    generated_at:nowIso(),
    status:"causal_narrative_resolved",

    focal_signal:{
      node_id:ctx.focal.node_id,
      label:ctx.focal.label,
      type:ctx.focal.type
    },

    why_now:buildWhyNow(ctx),

    upstream_drivers:upstream,

    downstream_story:classifyDownstream(downstream),

    butterfly_effect:{
      all_downstream_edges:downstream,
      potential_new_signals:potentialNewSignals(downstream),
      max_causal_depth:ctx.maxDepth,
      path_count:downstream.length,
      rule:
        "A consequence may become a candidate new signal, but never becomes an observed fact merely because it appears in a causal path."
    },

    narrative_contract:{
      machine_readable_only:true,
      article_prose_generated:false,
      causal_direction_preserved:true,
      causal_depth_preserved:true,
      time_horizon_preserved:true,
      evidence_status_preserved:true,
      evidence_lineage_preserved:true,
      confidence_degrades_with_distance:true,
      why_now_separated_from_root_cause:true,
      possibility_never_silently_promoted_to_fact:true
    },

    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      writes_to_knowledge_graph:false,
      mutates_input_graph:false,
      creates_unverified_facts:false,
      preserves_source_lineage:true,
      preserves_epistemic_status:true,
      causal_distance_penalizes_confidence:true,
      activation_logic_separate_from_causality:true,
      candidate_signals_not_auto_promoted:true
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
  if(!options.input_file){
    throw new Error(
      "Usage: node scripts/cosmos_causal_narrative.cjs --input <causal-input.json> [--out <causal-narrative.json>]"
    );
  }

  const output=runCausalNarrative(readJson(options.input_file));

  if(options.output_file){
    writeJson(options.output_file,output);
    console.log(
      `Cosmos Causal Narrative output written to ${options.output_file}`
    );
  }else{
    process.stdout.write(JSON.stringify(output,null,2)+"\n");
  }
}

if(require.main===module) main();

module.exports={
  runCausalNarrative,
  normalizeInput,
  degradeConfidence,
  traverse,
  buildWhyNow,
  potentialNewSignals
};
