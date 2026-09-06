#!/usr/bin/env node
import fs from "fs";
import path from "path";

const arg=(n,d="")=>{const i=process.argv.indexOf(n);return i>=0&&process.argv[i+1]?process.argv[i+1]:d};
const txt=(v,d="")=>{const s=(v??"").toString().trim();return s||d};
const uniq=a=>[...new Set((Array.isArray(a)?a:[]).filter(Boolean))];
const band=v=>{v=Number(v)||0;return v>=85?"very_high":v>=70?"high":v>=50?"moderate":"low"};

function confidenceExplanation(edge){
  const evidence=uniq(edge.evidence_ids);
  return {
    effective_confidence:Number(edge.confidence)||0,
    confidence_band:band(edge.confidence),
    explanation_mode:"inherited_from_projection_edge",
    source_relationship_id:edge.id,
    evidence_ids:evidence,
    evidence_count:evidence.length,
    temporal_state:edge.temporal_state??null,
    geography_scope:edge.geography_scope??null,
    epistemic_status:edge.epistemic_status??null,
    qualification:edge.qualification??null,
    decomposed_components_available:false,
    note:"No component-level confidence arithmetic is invented. Future components may be exposed only when supplied by Cosmos."
  };
}


function changeLabel(change){
  const dim=txt(change?.state_dimension_id||change?.dimension||change?.subject_id,"Change").replace(/[_-]+/g," ");
  const prev=change?.previous_state?.value ?? change?.previous_state;
  const curr=change?.current_state?.value ?? change?.current_state;
  const unit=txt(change?.unit||change?.current_state?.unit||change?.previous_state?.unit);
  if(prev!==undefined && curr!==undefined && `${prev}`!=="" && `${curr}`!=="") return `${dim}: ${prev}${unit?` ${unit}`:""} → ${curr}${unit?` ${unit}`:""}`;
  return `${dim}${change?.direction?` · ${change.direction}`:""}`;
}

export function buildButterflyChangeGridContract({changes,causalEdges,originChangeId,currentChangeId,maxInitialNodes=8,maxInitialEdges=14,maxDepth=3}){
  const changeList=Array.isArray(changes)?changes:[];
  const edgeList=Array.isArray(causalEdges)?causalEdges:[];
  const byId=new Map(changeList.filter(c=>c?.transition_id||c?.change_id).map(c=>[c.transition_id||c.change_id,c]));
  const originId=txt(originChangeId);
  const centerId=txt(currentChangeId||originId);
  if(!originId || !byId.has(originId)) throw new Error("Butterfly change projection requires a valid origin Change");
  if(!centerId || !byId.has(centerId)) throw new Error("Butterfly change projection center Change is missing");

  const accepted=edgeList.filter(e=>{
    const status=txt(e?.validation_status||e?.status||e?.epistemic_state,"supported").toLowerCase();
    return e?.from_change_id && e?.to_change_id && txt(e?.mechanism) && !["rejected","invalid","unsupported"].includes(status) && byId.has(e.from_change_id) && byId.has(e.to_change_id);
  });

  const depth=new Map([[centerId,0]]);
  const queue=[centerId];
  while(queue.length){
    const id=queue.shift();
    const d=depth.get(id);
    if(d>=maxDepth) continue;
    for(const e of accepted){
      let other=null;
      if(e.from_change_id===id) other=e.to_change_id;
      else if(e.to_change_id===id) other=e.from_change_id;
      if(other && !depth.has(other)){ depth.set(other,d+1); queue.push(other); }
    }
  }

  const ranked=[...depth.entries()].sort((a,b)=>a[1]-b[1]||changeLabel(byId.get(a[0])).localeCompare(changeLabel(byId.get(b[0]))));
  const selectedIds=new Set(ranked.slice(0,maxInitialNodes).map(([id])=>id));
  selectedIds.add(centerId);
  const visibleEdges=accepted.filter(e=>selectedIds.has(e.from_change_id)&&selectedIds.has(e.to_change_id)).slice(0,maxInitialEdges);
  const visibleNodes=[...selectedIds].map(id=>{
    const c=byId.get(id);
    const d=depth.get(id)??0;
    return {
      id,label:changeLabel(c),type:"world_change",is_center:id===centerId,is_origin:id===originId,
      projection_distance:d,distance_band:id===centerId?"center":`distance_${d}`,
      temporal_state:c?.current_state_time||null,geography_scope:c?.geography||null,
      epistemic_status:c?.epistemic_state||null,
      interaction:{can_follow_cause:visibleEdges.some(e=>e.to_change_id===id),can_follow_effect:visibleEdges.some(e=>e.from_change_id===id),can_recenter:true}
    };
  });
  const gridEdges=visibleEdges.map(e=>({
    id:e.causal_edge_id||e.id,from:e.from_change_id,to:e.to_change_id,relationship:"causal_change",direction:"directed",
    relation_class:e.from_change_id===centerId?"effect":e.to_change_id===centerId?"cause":"causal_path",
    mechanism:e.mechanism,carrier:e.carrier||null,conditions:uniq(e.conditions),counterforces:uniq(e.counterforces),
    epistemic_status:e.epistemic_state||null,evidence_ids:uniq(e.evidence_refs),structural_support_refs:uniq(e.structural_support_refs),
    interaction:{can_follow_ripple:true,follow_effect_focus:{type:"change",id:e.to_change_id},follow_cause_focus:{type:"change",id:e.from_change_id}}
  }));
  const hiddenNodeIds=changeList.map(c=>c.transition_id||c.change_id).filter(id=>id&&!selectedIds.has(id));
  const visibleEdgeIds=new Set(gridEdges.map(e=>e.id));
  const hiddenEdgeIds=accepted.map(e=>e.causal_edge_id||e.id).filter(id=>id&&!visibleEdgeIds.has(id));
  return {
    schema_version:"0.2",status:"butterfly_grid_contract_resolved",mode:"change_causal",
    center:{id:centerId,label:changeLabel(byId.get(centerId)),type:"world_change"},
    butterfly:{origin_change_id:originId,current_change_id:centerId,accepted_edge_count:accepted.length},
    initial_view:{max_initial_nodes:maxInitialNodes,max_initial_edges:maxInitialEdges,visible_node_count:visibleNodes.length,visible_edge_count:gridEdges.length,nodes:visibleNodes,edges:gridEdges},
    expansion_frontier:{hidden_node_ids:hiddenNodeIds,hidden_edge_ids:hiddenEdgeIds,hidden_node_count:hiddenNodeIds.length,hidden_edge_count:hiddenEdgeIds.length,can_expand:hiddenNodeIds.length>0||hiddenEdgeIds.length>0},
    navigation_contract:{node_click_action:"recenter_change_projection",edge_follow_action:"follow_causal_change",why_action:"follow_cause",next_action:"follow_effect",around_action:"return_to_object_projection",history_should_be_reversible:true},
    safeguards:{performs_external_search:false,calls_openai_or_external_api:false,mutates_graph:false,creates_new_facts:false,requires_first_class_changes:true,requires_accepted_causal_edges:true,object_relationships_are_not_causal_edges:true}
  };
}

export function buildButterflyGridContract({projection,maxInitialNodes=8,maxInitialEdges=14}){
  if(projection?.status!=="dimensionless_projection_resolved") throw new Error("Expected dimensionless_projection_resolved input");

  const focus=projection.focus||{};
  const nodes=Array.isArray(projection?.projection?.nodes)?projection.projection.nodes:[];
  const edges=Array.isArray(projection?.projection?.edges)?projection.projection.edges:[];
  const feedback=Array.isArray(projection?.projection?.feedback_loops)?projection.projection.feedback_loops:[];
  const centerId=txt(focus.id);
  const center=nodes.find(n=>n.id===centerId);
  if(!center) throw new Error("Projection center node is missing");

  const ranked=nodes.filter(n=>n.id!==centerId).sort((a,b)=>{
    const da=Number(a.projection_distance??999),db=Number(b.projection_distance??999);
    if(da!==db)return da-db;
    const best=n=>Math.max(0,...edges.filter(e=>e.from===n.id||e.to===n.id).map(e=>Number(e.confidence)||0));
    const ca=best(a),cb=best(b);
    if(ca!==cb)return cb-ca;
    return txt(a.label).localeCompare(txt(b.label));
  });

  const selected=new Set([centerId]);
  ranked.slice(0,Math.max(0,maxInitialNodes-1)).forEach(n=>selected.add(n.id));

  const candidates=edges.filter(e=>selected.has(e.from)&&selected.has(e.to)).sort((a,b)=>{
    const ac=a.from===centerId||a.to===centerId?1:0;
    const bc=b.from===centerId||b.to===centerId?1:0;
    if(ac!==bc)return bc-ac;
    const ca=Number(a.confidence)||0,cb=Number(b.confidence)||0;
    return cb-ca||txt(a.id).localeCompare(txt(b.id));
  });
  const visibleEdges=candidates.slice(0,maxInitialEdges);
  const visibleEdgeIds=new Set(visibleEdges.map(e=>e.id));
  const feedbackIds=new Set(feedback.flatMap(x=>Array.isArray(x.edge_ids)?x.edge_ids:[]));

  const visibleNodes=nodes.filter(n=>selected.has(n.id)).map(n=>({
    id:n.id,label:n.label,type:n.type,is_center:n.id===centerId,
    projection_distance:Number(n.projection_distance)||0,
    distance_band:n.id===centerId?"center":`distance_${Number(n.projection_distance)||0}`,
    temporal_state:n.temporal_state??null,geography_scope:n.geography_scope??null,
    visible_connection_count:visibleEdges.filter(e=>e.from===n.id||e.to===n.id).length,
    interaction:{can_recenter:true,recenter_focus:{type:n.type||"node",id:n.id},can_expand_one_layer:true}
  }));

  const gridEdges=visibleEdges.map(e=>({
    id:e.id,from:e.from,to:e.to,relationship:e.relationship,direction:e.direction||"directed",
    relation_class:e.from===centerId?"consequence":e.to===centerId?"driver":"cross_link",
    is_feedback_edge:feedbackIds.has(e.id),
    relative_direction:e.relative_direction??null,from_distance:e.from_distance??null,to_distance:e.to_distance??null,
    confidence:Number(e.confidence)||0,confidence_band:band(e.confidence),
    epistemic_status:e.epistemic_status??null,temporal_state:e.temporal_state??null,
    geography_scope:e.geography_scope??null,qualification:e.qualification??null,evidence_ids:uniq(e.evidence_ids),
    interaction:{can_follow_ripple:true,follow_ripple_focus:{type:"relationship",id:e.id},can_explain_confidence:true},
    confidence_explanation:confidenceExplanation(e)
  }));

  const bands={};
  visibleNodes.forEach(n=>(bands[n.distance_band]??=[]).push(n.id));
  const hiddenNodes=nodes.filter(n=>!selected.has(n.id)).map(n=>n.id);
  const hiddenEdges=edges.filter(e=>!visibleEdgeIds.has(e.id)).map(e=>e.id);

  return {
    schema_version:"0.1",status:"butterfly_grid_contract_resolved",
    center:{id:centerId,label:center.label,type:center.type,reference_time:focus.reference_time??null,geography:focus.geography??null},
    visual_semantics:{
      renderer_agnostic:true,fixed_xy_coordinates_provided:false,fixed_radial_layout_required:false,
      center_is_observer_relative:true,distance_is_semantic_not_pixel_distance:true,
      cross_links_must_remain_visible_when_selected:true,feedback_loops_must_remain_distinguishable:true,
      epistemic_status_must_be_visible_or_inspectable:true,confidence_must_be_inspectable:true
    },
    initial_view:{max_initial_nodes:maxInitialNodes,max_initial_edges:maxInitialEdges,visible_node_count:visibleNodes.length,visible_edge_count:gridEdges.length,nodes:visibleNodes,edges:gridEdges,distance_bands:bands},
    expansion_frontier:{hidden_node_ids:hiddenNodes,hidden_edge_ids:hiddenEdges,hidden_node_count:hiddenNodes.length,hidden_edge_count:hiddenEdges.length,can_expand:hiddenNodes.length>0||hiddenEdges.length>0},
    navigation_contract:{
      node_click_action:"recenter_projection",edge_follow_action:"recenter_or_expand_from_relationship",
      confidence_click_action:"show_confidence_lineage",expand_action:"request_next_bounded_projection",
      history_should_be_reversible:true,back_navigation_should_restore_previous_observer:true
    },
    article_integration_contract:{
      standalone_follow_the_ripple_section_required:false,butterfly_card_follow_link_required:true,
      explore_cosmos_link_required:true,relationship_deep_link_supported:true,confidence_inspection_supported:true
    },
    safeguards:{
      performs_external_search:false,calls_openai_or_external_api:false,mutates_graph:false,creates_new_facts:false,
      fabricates_confidence_components:false,forces_tree_structure:false,forces_fixed_layout:false,deletes_hidden_cosmos:false
    }
  };
}

async function main(){
  const p=arg("--projection"),out=arg("--out");
  if(!p)throw new Error("--projection is required");
  const projection=JSON.parse(fs.readFileSync(p,"utf8"));
  const result=buildButterflyGridContract({
    projection,
    maxInitialNodes:Number(arg("--max-initial-nodes","8")),
    maxInitialEdges:Number(arg("--max-initial-edges","14"))
  });
  if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2))}
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  main().catch(e=>{console.error(e);process.exit(1)});
}
