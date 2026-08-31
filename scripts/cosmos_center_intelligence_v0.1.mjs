#!/usr/bin/env node
const arr=v=>Array.isArray(v)?v:[];
const clean=(v,f="")=>typeof v==="string"&&v.trim()?v.trim():f;
const norm=v=>clean(v).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const toks=v=>norm(v).split(/\s+/).filter(Boolean);
const ids=d=>[...new Set([...arr(d?.entity_ids),...arr(d?.entities).map(e=>typeof e==="string"?e:e?.entity_id)].filter(Boolean))];
const title=d=>clean(d?.title||d?.headline||d?.name||d?.signal);
const summary=d=>clean(d?.summary||d?.description||d?.analysis||d?.why_it_matters);
const why=d=>clean(d?.why_it_matters||d?.impact||d?.importance);
const article=d=>clean(d?.article_id||d?.development_id||d?.signal_id||d?.id);
function score(entityId,label,d){const hay=norm([title(d),summary(d),why(d),...arr(d?.tags),...arr(d?.topics)].join(" "));let s=ids(d).includes(entityId)?1000:0;if(norm(label)&&hay.includes(norm(label)))s+=220;for(const t of toks(label))if(hay.includes(t))s+=35;return s}
export function buildCenterIntelligence({entity,developments=[],dailyBrief=[],entities=[]}){
  const entityId=entity.entity_id,label=clean(entity.name||entity.label,entityId),description=clean(entity.summary||entity.description||entity.definition);
  const rows=[...dailyBrief.map((record,index)=>({record,current:true,score:score(entityId,label,record)+500,index})).filter(x=>x.score>500),...developments.map((record,index)=>({record,current:false,score:score(entityId,label,record),index})).filter(x=>x.score>0)].sort((a,b)=>b.score-a.score||a.index-b.index);
  const seen=new Set(),unique=[];for(const row of rows){const key=article(row.record)||title(row.record);if(!key||seen.has(key))continue;seen.add(key);unique.push(row)}
  const map=new Map(entities.map(e=>[e.entity_id,e])),related=new Map();for(const row of unique.slice(0,12))for(const id of ids(row.record)){if(!id||id===entityId||!map.has(id))continue;related.set(id,(related.get(id)||0)+1)}
  return {schema_version:"0.1",status:"cosmos_center_intelligence_resolved",center:{id:entityId,label},what_is_this:description,current_state:unique.slice(0,3).map(x=>summary(x.record)||title(x.record)).filter(Boolean),latest_movement:unique.slice(0,4).map(x=>({title:title(x.record),summary:summary(x.record),current:x.current})),why_it_matters:unique.map(x=>why(x.record)).find(Boolean)||"",article_cards:unique.filter(x=>article(x.record)).slice(0,6).map(x=>({article_id:article(x.record),title:title(x.record),summary:summary(x.record),current:x.current,follow_ripple_expected:true})),curiosity_paths:[...related.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,7).map(([id,count])=>({id,label:map.get(id)?.name||map.get(id)?.label||id,count})),record_counts:{related:unique.length,current:unique.filter(x=>x.current).length},contracts:{every_center_returns_reader_value:Boolean(description||unique.length),current_and_historical_records_combined:true,current_briefing_weighted:true,linked_articles_preserved:true,article_to_butterfly_path_preserved:true,curiosity_paths_derived_from_related_entities:true,missing_supported_text_not_invented:true},safeguards:{calls_openai_or_external_api:false,performs_external_search:false,mutates_graph:false,invents_article_summary:false,invents_why_it_matters:false,deletes_history:false}};
}
