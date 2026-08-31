#!/usr/bin/env node
/**
 * Cosmos Question Understanding / Answer Resolver v0.1
 *
 * Deterministic semantic boundary:
 * Question -> question type -> answer target -> answer payload -> evidence context.
 * Prevents premature replacement of the question by a nearest graph object.
 *
 * No OpenAI. No external search. No graph mutation.
 */
import fs from "node:fs";
import path from "node:path";

function arg(name,fallback=""){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"))}
function clean(v){return typeof v==="string"?v.trim():""}
function arr(v){return Array.isArray(v)?v:[]}
function normalize(v){return clean(v).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function tokens(v){return normalize(v).split(/\s+/).filter(Boolean)}
function uniq(xs){return [...new Set(xs.filter(Boolean))]}

function classifyQuestion(question){
  const q=normalize(question);
  if(/\bwhat are\b/.test(q)||/\bwhat is\b/.test(q)||/\bwhich\b/.test(q)||/\blist\b/.test(q)){
    if(/\bequipment\b/.test(q)||/\bcomponents?\b/.test(q)||/\bparts?\b/.test(q)){
      return {type:"enumeration",subtype:"equipment_list"};
    }
    return {type:"definition",subtype:"what_is"};
  }
  if(/\bwhy\b/.test(q)) return {type:"explanation",subtype:"why"};
  if(/\bwhat changed\b/.test(q)||/\bwhat happened\b/.test(q)||/\btoday\b/.test(q)) return {type:"current_intelligence",subtype:"latest"};
  return {type:"topic",subtype:"general"};
}

function entityLabel(entity){
  return clean(entity?.name||entity?.label||entity?.entity_id);
}
function scoreEntity(question,entity){
  const q=normalize(question),label=normalize(entityLabel(entity));
  if(!label) return 0;
  let score=0;
  if(q.includes(label)) score+=500;
  for(const t of tokens(entityLabel(entity))){
    if(q.includes(t)) score+=70;
  }
  return score;
}
function resolveSubject(question,entities){
  const ranked=arr(entities).map(entity=>({entity,score:scoreEntity(question,entity)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score||entityLabel(a.entity).localeCompare(entityLabel(b.entity)));
  return ranked[0]||null;
}

function collectEquipment(entity){
  const labels=[];
  for(const key of ["equipment","components","members"]){
    for(const item of arr(entity?.[key])){
      if(typeof item==="string") labels.push(item);
      else labels.push(clean(item?.label||item?.name));
    }
  }
  for(const rel of arr(entity?.related_objects)){
    const relType=normalize(rel?.relationship);
    if(["contains","includes","component","equipment","part of","part_of"].includes(relType)){
      labels.push(clean(rel?.label||rel?.name));
    }
  }
  return uniq(labels);
}

function buildAnswer(question,classification,subject){
  const entity=subject?.entity||null;
  const label=entityLabel(entity)||question;
  const description=clean(entity?.description||entity?.summary||entity?.definition);
  const equipment=collectEquipment(entity);

  if(classification.subtype==="equipment_list"){
    if(equipment.length){
      const intro=description?`${description} `:"";
      return {
        answer_type:"equipment_list",
        title:label,
        text:`${intro}Key equipment includes ${equipment.slice(0,18).join(", ")}.`,
        items:equipment.slice(0,18)
      };
    }
    return {
      answer_type:"equipment_list",
      title:label,
      text:`Cosmos identified ${label} as the subject, but the current knowledge model does not yet contain a structured equipment list for it.`,
      items:[]
    };
  }

  if(description){
    return {answer_type:"definition",title:label,text:description,items:[]};
  }

  return {
    answer_type:"unresolved",
    title:label,
    text:`Cosmos identified ${label}, but the current deterministic knowledge does not yet support a direct answer.`,
    items:[]
  };
}

function itemDate(item){
  return item?.published_at||item?.created_at||item?.date||item?.updated_at||item?.timestamp||item?.newest_signal_at||"";
}
function dateDisplay(value){
  const s=clean(value);
  if(!s) return "Date unavailable";
  const d=new Date(s);
  if(Number.isNaN(d.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(d);
}
function title(item){return clean(item?.title||item?.headline||item?.name||item?.signal)}
function summary(item){return clean(item?.summary||item?.description||item?.why_it_matters||item?.analysis)}
function relatedIntelligence(subject,question,items){
  const entity=subject?.entity||{};
  const entityId=clean(entity?.entity_id);
  const label=entityLabel(entity);
  return arr(items).map((item,index)=>{
    let score=0;
    const hay=normalize([title(item),summary(item),...arr(item?.tags),...arr(item?.topics)].join(" "));
    if(entityId && arr(item?.entity_ids).includes(entityId)) score+=1000;
    for(const t of tokens(label)) if(hay.includes(t)) score+=40;
    for(const t of tokens(question)) if(hay.includes(t)) score+=15;
    return {item,index,score};
  }).filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score||a.index-b.index)
    .slice(0,5)
    .map(({item,index})=>({
      id:clean(item?.development_id||item?.signal_id||item?.id||`item-${index+1}`),
      title:title(item)||`Intelligence item ${index+1}`,
      summary:summary(item),
      date_display:dateDisplay(itemDate(item)),
      article_id:clean(item?.article_id||item?.development_id||item?.id),
      follow_the_ripple:true
    }));
}

export function resolveQuestionAnswer(input){
  const question=clean(input?.question);
  const classification=classifyQuestion(question);
  const subject=resolveSubject(question,input?.entities||[]);
  const answer=buildAnswer(question,classification,subject);
  const intelligence=relatedIntelligence(subject,question,input?.intelligence||[]);

  return {
    schema_version:"0.1",
    status:"cosmos_question_answer_resolved",
    question,
    classification,
    question_remains_primary_observer:true,
    subject_match:subject?{
      id:clean(subject.entity?.entity_id),
      label:entityLabel(subject.entity),
      score:subject.score
    }:null,
    answer,
    intelligence,
    exploration_seed_ids:uniq([
      subject?.entity?.entity_id,
      ...intelligence.map(x=>x.id)
    ]),
    contracts:{
      question_not_replaced_by_nearest_graph_object:true,
      direct_answer_built_before_exploration:true,
      enumeration_questions_return_structured_items:true,
      evidence_context_attached_after_answer:true,
      dates_preserved_when_available:true,
      missing_dates_explicit:true,
      follow_the_ripple_preserved:true,
      unsupported_answer_not_invented:true
    },
    safeguards:{
      performs_external_search:false,
      calls_openai_or_external_api:false,
      mutates_graph:false,
      invents_equipment_list:false,
      invents_missing_dates:false,
      promotes_scenario_to_fact:false
    }
  };
}

const inputFile=arg("--input");
const outFile=arg("--out");
if(inputFile){
  const result=resolveQuestionAnswer(readJson(inputFile));
  const text=JSON.stringify(result,null,2)+"\n";
  if(outFile){
    fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});
    fs.writeFileSync(outFile,text);
  }else process.stdout.write(text);
}
