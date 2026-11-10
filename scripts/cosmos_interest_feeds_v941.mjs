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
// v9.4.2 — broad, source-linked discovery topics for all industries and lifestyles.
const TERM_SETS={"personal":{"travel":["travel","tourism","vacation","holiday destination"],"adventure-travel":["adventure travel","backpacking","trekking"],"road-trips":["road trip","roadtrip","scenic drive"],"air-travel":["airline","airport","flight booking","aviation passenger"],"hotels":["hotel","resort","accommodation","short term rental"],"local-culture":["local culture","tradition","heritage festival"],"geography":["geography","geographic","atlas","continent"],"languages":["language learning","linguistic","translation","polyglot"],"sports":["sports","athletic","championship"],"soccer":["soccer","football league","fifa","premier league"],"basketball":["basketball","nba"],"tennis":["tennis","wimbledon"],"golf":["golf","pga"],"cycling":["cycling","bicycle","cyclist"],"running":["marathon","half marathon","trail running"],"hiking":["hiking","hike","mountain trail"],"swimming":["swimming","swimmer"],"winter-sports":["skiing","snowboarding","olympic winter"],"motorsports":["formula one","formula 1","nascar","motorsport"],"esports":["esports","competitive gaming"],"arts-entertainment":["entertainment","artist","museum exhibition"],"music":["music","singer","concert","album"],"film":["movie","film premiere","cinema","filmmaker"],"television":["television","streaming series","netflix show"],"books":["book author","novel","literature"],"photography":["photography","photographer","photo exhibition"],"theatre":["theatre","theater","broadway"],"dance":["dance","dancer","ballet"],"podcasts":["podcast","audio series"],"gaming":["video game","gaming","console game"],"fashion-style":["fashion","style trends","designer clothing"],"science":["science","scientific discovery","researchers"],"space":["space","astronomy","nasa","cosmos","telescope","planet"],"physics":["physics","particle","quantum","cern"],"biology":["biology","genetics","evolution","dna"],"chemistry":["chemistry","chemical reaction","molecule"],"technology":["technology","tech device","digital technology"],"consumer-gadgets":["smartphone","iphone","android phone","wearable"],"ai-everyday":["artificial intelligence","chatgpt","AI assistant","generative ai"],"cyber-privacy":["cybersecurity","data breach","online privacy","hacking"],"automobiles":["electric vehicle","car model","automobile","auto industry"],"future-inventions":["invention","prototype","futuristic technology"],"family-life":["family life","parenting","children","childhood"],"parenting":["parenting","childcare","parent-child"],"relationships":["relationship","marriage","friendship"],"health-wellness":["health","wellness","healthy lifestyle"],"mental-wellbeing":["mental health","mindfulness","stress management"],"fitness":["fitness","workout","exercise training"],"nutrition":["nutrition","dietary","nutrients"],"food":["food","cooking","recipe","cuisine"],"restaurants":["restaurant","dining","chef","michelin star"],"home-garden":["home garden","household","gardening"],"interior-design":["interior design","home decor"],"pets":["pets","dog breed","cat rescue","pet health"],"personal-finance":["personal finance","savings account","mortgage"],"education-learning":["learning","education","study tips","student"],"diy":["do it yourself","woodworking","craft project"],"beauty":["skincare","beauty routine","cosmetics"],"history":["history","historical","ancient civilization"],"archaeology":["archaeology","archaeological excavation","fossil discovery"],"nature":["nature","wildlife","biodiversity"],"wildlife":["wildlife","endangered species","animal habitat"],"environment":["environment","conservation","climate change"],"philosophy":["philosophy","ethics","philosopher"],"culture-society":["cultural heritage","social change","society"],"current-affairs":["public affairs","global affairs","diplomacy"],"community":["local community","community event","volunteer"],"spirituality":["meditation","spirituality","faith tradition"],"human-discovery":["human evolution","exploration discovery","anthropology"]},"business":{"power-grid":["grid","substation","hvdc","transmission line","switchgear","high voltage"],"renewables":["solar energy","wind energy","renewable","clean energy"],"energy-markets":["power market","electricity price","energy market","utility tariff"],"oil-gas":["oil and gas","petroleum","natural gas","lng"],"nuclear-energy":["nuclear power","nuclear reactor"],"data-centers":["data center","data centre","hyperscale","colocation"],"epc-construction":["epc","engineering procurement construction","building contractor","construction project"],"manufacturing":["manufacturing","industrial plant","production line"],"mining":["mining","mineral extraction"],"critical-minerals":["rare earth","lithium","copper supply chain","critical mineral"],"water-environment":["water utility","wastewater","water treatment"],"chemicals":["chemical industry","chemical plant"],"agriculture":["agriculture","farming","agritech"],"food-beverage":["food manufacturer","food industry","beverage brand"],"ai-tech":["artificial intelligence","machine learning","AI infrastructure"],"software-cloud":["software platform","saas","cloud computing"],"cybersecurity":["cybersecurity","ransomware","cyber attack"],"telecom":["telecom","5g network","telecommunications"],"semiconductors":["semiconductor","chipmaker","microchip"],"robotics":["robotics","robot factory","industrial automation"],"data-analytics":["data analytics","big data","business intelligence"],"digital-products":["mobile app","product launch","platform economy"],"gaming-industry":["video game developer","gaming company"],"space-industry":["space startup","spacecraft","satellite business"],"finance":["finance","investment","financial market"],"banking":["banking","commercial bank","credit union"],"insurance":["insurance","insurer","underwriting"],"venture-capital":["venture capital","seed funding","startup investor"],"private-equity":["private equity","buyout fund"],"fintech":["fintech","digital payment","financial technology"],"accounting-audit":["accounting","auditing","accountant"],"legal-policy":["law firm","legal services","legal compliance"],"consulting":["management consulting","business advisory"],"real-estate":["real estate","commercial property","property developer"],"healthcare":["healthcare","hospital","clinical care"],"pharma":["pharmaceutical","drug developer","medicine manufacturing"],"biotech":["biotechnology","biotech firm","gene therapy"],"medical-devices":["medical device","health technology"],"education-edtech":["education technology","university","edtech","school district"],"government":["public sector","government agency","municipal"],"nonprofit":["nonprofit","charitable foundation","philanthropy"],"defense":["defense contractor","military procurement"],"retail":["retail","retailer","store chain"],"ecommerce":["ecommerce","online shopping","online retailer"],"consumer-goods":["consumer goods","consumer brands"],"hospitality":["hospitality","hotel business","tourism operator"],"transport-logistics":["logistics","supply transport","freight"],"automotive":["automotive","car manufacturer","auto supplier"],"aerospace":["aerospace","aircraft manufacturer","aviation industry"],"maritime":["shipping company","maritime","container ship"],"media-entertainment":["media company","entertainment company","film studio"],"fashion-beauty":["fashion brand","cosmetics company","beauty industry"],"arts-design":["architectural firm","design studio","creative agency"],"sports-business":["sports league","sports sponsorship","football club"],"leadership":["chief executive","ceo","board director","business strategy"],"operations":["operational excellence","business operations","plant operations"],"project-management":["project manager","program manager","project delivery"],"product-management":["product manager","product roadmap"],"sales":["sales director","sales management","account executive"],"marketing":["marketing campaign","digital marketing"],"advertising":["advertising","ad agency","brand campaign"],"business-development":["business development","commercial partnership"],"jobs-talent":["hiring","job market","recruitment","talent acquisition"],"hr-workforce":["human resources","workforce management","employee engagement"],"supply-chain":["supply chain","warehouse supply"],"procurement":["procurement","purchasing manager","sourcing supplier"],"quality":["quality assurance","quality control","quality management"],"risk-compliance":["risk management","regulatory compliance","corporate governance"],"customer-experience":["customer success","customer experience","customer service"],"entrepreneurship":["entrepreneur","small business owner","self employment"],"startups":["startup founder","startup funding","early stage company"],"mergers-acquisitions":["merger","acquisition","m&a"],"international-trade":["international trade","imports exports","trade tariffs"],"sustainability":["sustainability","esg","corporate climate"],"innovation-rd":["research and development","corporate innovation","patent portfolio"]}};
const matcher = new Map();
function detect(s,space){
  const val=String(s||'').toLowerCase();
  if(space!=='personal'&&space!=='business')return [];
  return Object.entries(TERM_SETS[space]).filter(([k,terms])=>terms.some(phrase=>{
    const term=String(phrase).toLowerCase();
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // Keep phrases bounded; a topic such as AI must not match inside another word.
    let regex=matcher.get(term);
    if(!regex){regex=new RegExp('(?:^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','i');matcher.set(term,regex);}
    return regex.test(val);
  })).map(([id])=>id);
}
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
  const doc={schema_version:'1.0',version:'9.4.2',space,public_only:true,updated_at:now.toISOString(),
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
 assert(detect('New hospital biotech trial','business').includes('healthcare'),'Business healthcare');
 assert(detect('Ballet performance tonight','personal').includes('dance'),'Personal dance');
 assert(detect('Global coffee shop expansion','business').includes('retail')===false,'No accidental retail tag');
 assert(!detect('Grenadine food recipe','business').length,'Personal article should not reach business');
 assert(detect('Travel to Paris','personal').includes('travel'),'Personal travel');
 assert(!safeUrl('javascript:alert(1)'),'URL failclosed');
 console.log('COSMOS interests classifier self-test PASS');
}else build();
