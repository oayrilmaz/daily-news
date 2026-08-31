#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const clean=(v,f="")=>typeof v==="string"&&v.trim()?v.trim():f;
const arr=v=>Array.isArray(v)?v:[];
const norm=v=>clean(v).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const toks=v=>norm(v).split(/\s+/).filter(Boolean);
const read=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const args=Object.fromEntries(process.argv.slice(2).reduce((a,t,i,x)=>{if(t.startsWith("--"))a.push([t.slice(2),x[i+1]]);return a},[]));

function intent(q){
  if(/\b(today'?s?|daily|latest|new|current)\b.*\b(news|brief|briefing|intelligence|signals?|developments?)\b/i.test(q)||
     /\b(provide|show|give)\b.*\b(today'?s?|daily|latest)\b.*\b(news|brief|intelligence|signals?)\b/i.test(q)||
     /\bwhat changed\b/i.test(q)||/\bwhat happened today\b/i.test(q))
    return {id:"daily_intelligence",view:"daily_intelligence",label:"Today's Intelligence"};
  if(/\b(video|videos|media|youtube|watch)\b/i.test(q)) return {id:"media",view:"media",label:"Media"};
  if(/\b(map|country|countries|geograph\w*|region|united states|usa|u\.?s\.?)\b/i.test(q)) return {id:"geography",view:"global_intelligence_map",label:"Global Intelligence"};
  if(/\b(market|markets|stock|stocks|outlook|price|prices|investment)\b/i.test(q)) return {id:"market",view:"market_pulse",label:"Market Pulse & Outlook"};
  return {id:"topic",view:"cosmos_projection",label:q||"Cosmos"};
}

function items(payload){
  if(Array.isArray(payload)) return payload;
  for(const k of ["items","daily_items","briefing","developments","signals"]) if(Array.isArray(payload?.[k])) return payload[k];
  return [];
}
const title=x=>clean(x?.title||x?.headline||x?.name||x?.signal||x?.summary);
const summary=x=>clean(x?.summary||x?.why_it_matters||x?.description||x?.body||x?.analysis);
const idOf=(x,i)=>clean(x?.development_id||x?.signal_id||x?.id,`daily-item-${i+1}`);

function rankTopic(q,list){
  const qt=toks(q);
  return list.map((item,index)=>{
    const hay=norm([title(item),summary(item),...arr(item?.tags),...arr(item?.topics),...arr(item?.countries)].join(" "));
    return {item,index,score:qt.reduce((s,t)=>s+(hay.includes(t)?1:0),0)};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
}

export function resolveCosmosResponse(input={},datasets={}){
  const question=clean(input.question);
  const resolved=intent(question);
  const brief=items(datasets.dailyBrief||{});
  const entityList=Array.isArray(datasets.entities)?datasets.entities:arr(datasets.entities?.entities);
  let response;

  if(resolved.id==="daily_intelligence"){
    const selected=brief.slice(0,6);
    response={
      kind:"response",response_type:"daily_intelligence",title:"Today's Intelligence",
      answer:selected.length?`Here are ${selected.length} current PTD Today intelligence items available from today's briefing.`:"Today's briefing is available, but no intelligence items were found in the current data.",
      bullets:selected.map((x,i)=>({id:idOf(x,i),title:title(x)||`Intelligence item ${i+1}`,summary:summary(x),source_type:"PTD Today daily briefing"})),
      projection_seed_ids:selected.flatMap(x=>[x?.development_id,x?.signal_id,...arr(x?.entity_ids)]).filter(Boolean),
      source:{type:"existing_ptd_today_data",dataset:"briefs/daily-ai.json"}
    };
  } else if(resolved.id==="topic"){
    const q=norm(question);
    const matches=entityList.map(entity=>{
      const label=clean(entity?.name||entity?.label||entity?.entity_id);
      const n=norm(label); let score=0;
      if(n===q)score+=100;
      if(n.includes(q)||q.includes(n))score+=25;
      for(const t of toks(question)) if(n.includes(t)) score+=5;
      return {entity,label,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,3);
    const best=matches[0]?.entity;
    const ranked=rankTopic(question,brief).slice(0,5);
    const desc=clean(best?.summary||best?.description||best?.definition);
    response={
      kind:"response",response_type:"topic",title:clean(best?.name||best?.label,question),
      answer:[desc,ranked.length?`${ranked.length} current intelligence item${ranked.length===1?"":"s"} in today's briefing relate to this subject.`:""].filter(Boolean).join(" ")||"Cosmos found the subject, but the current deterministic data does not yet contain enough information for a descriptive answer.",
      bullets:ranked.map(({item,index})=>({id:idOf(item,index),title:title(item),summary:summary(item),source_type:"PTD Today daily briefing"})),
      projection_seed_ids:[best?.entity_id,...ranked.flatMap(({item})=>[item?.development_id,item?.signal_id,...arr(item?.entity_ids)])].filter(Boolean),
      entity_matches:matches.map(({entity,label,score})=>({id:entity?.entity_id,label,score})),
      source:{type:"existing_ptd_today_data",datasets:["knowledge/entities.json","briefs/daily-ai.json"]}
    };
  } else {
    response={kind:"response",response_type:resolved.id,title:resolved.label,answer:`${resolved.label} is available as an on-demand PTD Today view. Cosmos should materialize that view for this request.`,bullets:[],projection_seed_ids:[],source:{type:"existing_ptd_today_surface",view:resolved.view}};
  }

  return {
    schema_version:"0.1",status:"cosmos_response_resolved",question,intent:resolved,
    response_observer:{id:`response:${resolved.id}:${Buffer.from(question||"cosmos").toString("base64url").slice(0,24)}`,label:response.title,type:"response",original_question:question},
    response,
    next_projection:{center_type:"response",preserve_original_question:true,projection_seed_ids:response.projection_seed_ids,materialize_view:resolved.view},
    contracts:{
      question_produces_response_object:true,response_becomes_temporary_observer:true,original_question_preserved:true,
      existing_ptd_today_data_used_before_ai:true,daily_intelligence_can_answer_without_ai:true,
      topic_can_use_entity_and_daily_brief_context:true,unresolved_information_is_explicit:true,
      response_can_seed_cosmos_projection:true,non_graph_views_can_materialize_on_demand:true
    },
    safeguards:{
      performs_external_search:false,calls_openai_or_external_api:false,mutates_graph:false,
      creates_permanent_response_fact:false,invents_source_evidence:false,promotes_scenario_to_fact:false,deletes_legacy_surfaces:false
    }
  };
}

if(args.input){
  const input=read(args.input);
  const dailyBrief=args.brief&&fs.existsSync(args.brief)?read(args.brief):{};
  const entities=args.entities&&fs.existsSync(args.entities)?read(args.entities):{};
  const result=resolveCosmosResponse(input,{dailyBrief,entities});
  if(args.out){fs.mkdirSync(path.dirname(path.resolve(args.out)),{recursive:true});fs.writeFileSync(path.resolve(args.out),JSON.stringify(result,null,2)+"\n")}
  else process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
