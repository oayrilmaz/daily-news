// COSMOS v9.4.1: source-linked interest discovery, NOT an automatic user post.
// Emits two public, static lists; each member's topic selections stay in private D1.
import fs from 'node:fs';
import crypto from 'node:crypto';

const read=(p,alt)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return alt;throw e;}};
const out=(p,obj)=>{fs.mkdirSync('data',{recursive:true});fs.writeFileSync(p,JSON.stringify(obj,null,2)+'\n');};
const origin='https://ptdtoday.com';
const dayMs=86400000;
const freshDays=Number(process.env.COSMOS_DISCOVERY_MAX_AGE_DAYS||14);
const now=new Date();
function safeUrl(x,allowPTD=true){
 try{const u=new URL(String(x||''));if(u.protocol!=='https:'||!u.hostname.includes('.')||u.username||u.password)return null;
  if(!allowPTD&&['ptdtoday.com','www.ptdtoday.com'].includes(u.hostname))return null;
  return u.href; }catch{return null;}
}
function asDate(x){const d=Date.parse(String(x||''));return Number.isFinite(d)&&d<=Date.now()+dayMs&&Date.now()-d<=freshDays*dayMs?new Date(d).toISOString():null;}
function text(x,n=200){return String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);}
const BUS={
 'power-grid': /\b(grid|substation|transmission|distribution|power utility|switchgear|transformer|hvdc|high.voltage|FACTS|synchro(?:nous)? condens|grid connection|electrical infrastructure)\b/i,
 'data-centers': /\b(data.cent(?:er|re)|hyperscale|colocation|AI infrastructure|power density|rack power)\b/i,
 'renewables': /\b(solar|wind farm|renewable|battery storage|BESS|energy transition|clean energy)\b/i,
 'ai-tech': /\b(artificial intelligence|\bAI\b|machine learning|semiconductor|software platform|automation|robotics)\b/i,
 'energy-markets': /\b(electricity price|power market|energy market|capacity market|grid investment|utility regulation|energy policy)\b/i,
 'epc-construction': /\b(EPC|engineering procurement construction|project delivery|infrastructure construction|industrial construction|megaproject)\b/i,
 'leadership': /\b(executive|CEO|CFO|CTO|leadership|board of directors|business strategy|merger|acquisition)\b/i,
 'critical-minerals': /\b(rare earth|critical mineral|copper mining|lithium|supply chain)\b/i,
 'finance': /\b(investment|financing|capital expenditure|earnings|venture capital|IPO)\b/i,
 'jobs-talent': /\b(hiring|recruitment|talent|workforce|labor market|job market)\b/i
};
const PER={
 'travel': /\b(travel|vacation|tourism|trip|hotel|flight|destination|visa|roadtrip)\b/i,
 'sports': /\b(soccer|football|basketball|cricket|tennis|sport|match|world cup)\b/i,
 'science': /\b(scien(?:ce|tist)|physics|particle|space|astronomy|research|universe|CERN)\b/i,
 'technology': /\b(tech|phone|AI|internet|privacy|cyber|app|software|gadget|computer)\b/i,
 'family-life': /\b(family|parenting|children|school|relationship|home life|childhood)\b/i,
 'health-wellness': /\b(health|nutrition|exercise|wellness|fitness|sleep|medical)\b/i,
 'food': /\b(cook|recipe|food|drink|restaurant|coffee|kitchen|grenadine)\b/i,
 'arts-entertainment': /\b(film|movie|music|book|art|theater|actor|Batman|cinema|entertainment)\b/i,
 'history': /\b(history|historical|ancient|century|archaeology|BCE|warfare|hussar)\b/i,
 'nature': /\b(nature|wildlife|forest|ocean|environment|climate|biodiversity)\b/i
};
function detect(s,space){const defs=space==='business'?BUS:PER;return Object.keys(defs).filter(k=>defs[k].test(s));}
function normKey(item){return crypto.createHash('sha256').update(item.url.split('?')[0]).digest('hex').slice(0,18);}
function add(arr,item,space){
 const val=String(item.title||'')+' '+String(item.category||'');
 const topics=detect(val,space);
 if(!topics.length)return;
 const url=safeUrl(item.url),published_at=asDate(item.published_at);
 if(!url||!published_at||text(item.title,220).length<12)return;
 arr.push({id:space+'-'+normKey({url}),title:text(item.title,220),published_at,url,topics,
  category:text(item.category||'Discovery',55),source:text(item.source||'Linked source',70),
  provenance:item.provenance||'linked_headline',kind:'public_link',visibility:'public'});
}
function build(){
 const business=[],personal=[];
 const news=read('data/news.json',[]);
 for(const row of Array.isArray(news)?news:[]){
  if(!row||!safeUrl(row.url,false))continue;
  const entry={title:row.title,url:row.url,published_at:row.published||row.published_at,category:row.category||'News',source:row.publisher||'External source',provenance:'linked_headline'};
  add(business,entry,'business');add(personal,entry,'personal');
 }
 const qa=read('data/cosmos-real-qa-latest.json',{items:[]});
 for(const row of Array.isArray(qa.items)?qa.items:[]){
  const url=safeUrl(row.cosmos);if(!url||!url.startsWith(origin+'/q/realqa-'))continue;
  const id=String(row.id||'');const category=id.match(/^realqa-([a-z]+)-/)?.[1]||'question';
  // Only source-linked Q&A items published by existing Q&A generator; never call them globally top-ranked.
  const originSource=safeUrl(row.source,false);if(!originSource)continue;
  const entry={title:row.question,url,category,source:'COSMOS sourced Q&A',published_at:qa.generated_at,
    provenance:'source_linked_qa'};
  add(personal,entry,'personal');add(business,entry,'business');
 }
 const editorial=read('data/cosmos-public-timeline.json',{items:[]});
 if(editorial.public_only===true)for(const row of Array.isArray(editorial.items)?editorial.items:[]){
  if(row?.visibility!=='public'||row.type!=='cosmos_editorial_question'||!/^global-[a-z0-9-]{8,120}$/.test(row.id||''))continue;
  const url=safeUrl(row.url);
  if(!url||!url.startsWith(origin+'/q/trends/global-'))continue;
  const entry={title:row.question,url,category:row.category,source:'COSMOS editorial',published_at:row.published_at,
    provenance:'approved_editorial'};
  add(personal,entry,'personal');add(business,entry,'business');
 }
 function write(space,items){
  const seen=new Set();items.sort((a,b)=>b.published_at.localeCompare(a.published_at));
  items=items.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;}).slice(0,120);
  const doc={schema_version:'1.0',version:'9.4.1',space,public_only:true,updated_at:now.toISOString(),
    source_coverage:{news_last_updated:Array.isArray(news)&&news.length?news[0].published||news[0].published_at||null:null,
      q_and_a_last_generated:qa.generated_at||null,editorial_last_published:editorial.updated_at||null},
    note:'Source-linked discovery suggestions, not private user posts or a worldwide popularity ranking. No editorial claims are invented.',
    count:items.length,items};
  out('data/cosmos-'+space+'-discovery.json',doc);
  console.log(`${space} discovery: ${items.length} source-linked suggestions`);
  return doc;
 }
 return {business:write('business',business),personal:write('personal',personal)};
}
if(process.env.COSMOS_INTEREST_SELF_TEST==='1'){
 const assert=(cond,msg)=>{if(!cond)throw Error(msg);};
 assert(detect('HVDC transmission substation project director','business').includes('power-grid'),'Business grid');
 assert(!detect('Grenadine food recipe','business').length,'Personal article should not reach business');
 assert(detect('Travel to Paris','personal').includes('travel'),'Personal travel');
 assert(!safeUrl('javascript:alert(1)'),'URL failclosed');
 console.log('COSMOS interests classifier self-test PASS');
}else build();
