/**
 * PTD Today / COSMOS v7.2.0 — review-only editorial gate; zero external/API calls.
 *
 * Safe defaults:
 *   - Never accepts or approves a story automatically.
 *   - Never writes public question pages or publishes to X.
 *   - Outputs review content + images ONLY to an Actions artifact directory.
 *   - Public manifest remains empty; keeps aggregate status only.
 *   - Removes obsolete, explicitly marked noindexed editorial preview pages.
 *
 * Usage: node scripts/cosmos_global_quality_gate_v7_2.mjs
 *        COSMOS_GATE_TEST=1 node scripts/cosmos_global_quality_gate_v7_2.mjs
 *        COSMOS_GATE_VALIDATE=1 node scripts/cosmos_global_quality_gate_v7_2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const VERSION='7.2.0';
const REVIEW='data/cosmos-global-questions-review.json';
const AUDIT='data/cosmos-global-questions-quality-audit.json';
const REPORT='data/cosmos-global-questions-quality-summary.md';
const LATEST='data/cosmos-global-questions-latest.json';
const STATUS='data/cosmos-global-questions-run-status.json';
const PRIVATE='artifacts/cosmos-editorial-review';
const CARDS=path.join(PRIVATE,'cards');
const PUBLIC_CARDS='assets/cosmos-global-cards';
const PUBLIC_PAGES='q/trends';
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const normalize=s=>clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validId=s=>/^global-[a-z0-9-]{8,110}$/.test(s||'');
const domain=s=>{try{return new URL(s).hostname.toLowerCase().replace(/^(www|m|amp)\./,'');}catch{return ''}};
const fileJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const saveJson=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const addReason=(entry,code,message,severity='hold')=>{
 if(!entry.reasons.some(x=>x.code===code))entry.reasons.push({code,message});
 if(severity==='exclude')entry.status='exclude';
 else if(entry.status!=='exclude')entry.status='hold';
};
const generalWords=new Set(['the','a','an','with','what','does','mean','why','how','which','for','from','after','and','this','that','would','could','their','about','recent','latest','today','stock','stocks','shares','price','news','update','in','on','of','de','del','da']);
const tokens=s=>normalize(s).split(' ').filter(w=>w.length>=3&&!generalWords.has(w));
const eventTokens=s=>new Set(tokens(s));
const topicsMatch=(topic,question,answer)=>{
 const t=tokens(topic);if(!t.length)return false;
 const c=new Set(tokens(question+' '+answer));
 return t.filter(w=>c.has(w)).length>=Math.max(1,Math.ceil(t.length*0.6));
};
function sameSourceStory(a,b){
 const ua=new Set((a.sources||[]).map(s=>{try{const x=new URL(s.url);return x.hostname.toLowerCase()+x.pathname.replace(/\/$/,'');}catch{return ''}}));
 const shared=(b.sources||[]).filter(s=>{try{const x=new URL(s.url);return ua.has(x.hostname.toLowerCase()+x.pathname.replace(/\/$/,''));}catch{return false}}).length;
 if(shared>=2)return true;
 // A single shared URL is a clue, not proof: demand a common named entity.
 if(shared===1){
  const ta=new Set(tokens(a.trend_topic)),tb=tokens(b.trend_topic);
  if(ta.size && tb.filter(t=>ta.has(t)).length/Math.max(ta.size,tb.length)>=0.66)return true;
 }
 return false;
}
function videoCheck(item){
 if(!item.youtube)return {keep:false,reason:null};
 const q=normalize(item.question),v=normalize(item.youtube.title),topic=normalize(item.trend_topic);
 const score=Number(item.youtube.match_score||0);
 if(/\b(birthday|viral|youtubeshorts|happy birthday|rumor|gossip|drama|prank)\b/i.test(v)
    && !/\b(birthday|viral|rumor|gossip|drama|prank)\b/i.test(q))return {keep:false,reason:'irrelevant_or_sensational_video'};
 if(/\b(lineup|rotation|minutes|injury|return|available to play)\b/i.test(q) && !/\b(lineup|rotation|minutes|injury|return|available|back)\b/i.test(v))
   return {keep:false,reason:'generic_video_for_specific_sports_update'};
 const subjectOverlap=topicsMatch(topic,item.youtube.title,'');
 const qTokens=eventTokens(item.question), vTokens=eventTokens(item.youtube.title);
 const match=[...qTokens].filter(w=>vTokens.has(w));
 // Having a celebrity's name does not establish an event/video match.
 const eventWords=new Set(['filming','graduate','revenue','earnings','voyager','spacecraft','signal','communication','outage','fitness','walking','tax','proposition','return','collison','collision','injury','investment','pension','lawsuit','blackstone','palantir']);
 const eventIntersection=match.some(x=>eventWords.has(x));
 if(!subjectOverlap)return {keep:false,reason:'video_missing_primary_topic'};
 if(score<0.65 && !eventIntersection)return {keep:false,reason:'weak_event_specific_video_match'};
 return {keep:true,reason:null};
}
function classify(item){
 const v=normalize(item.question+' '+item.answer?.explanation);
 if(/\b(tax|ballot|voters|proposition|election|referendum|public policy|legislature)\b/.test(v))return 'world';
 if(/\b(fitness|walking|workout|gym|exercise routine)\b/.test(v))return 'lifestyle';
 if(/\b(stock|shares|earnings|revenue|investment|wall street|hyperscaler|pension|fiscal|financial|acquisition|fund)\b/.test(v))return 'business';
 return item.editorial_category;
}
function auditItem(item){
 if(!validId(item.id))throw Error('Unsafe draft ID: '+clean(item.id));
 const result={id:item.id,question:clean(item.question),status:'review',category:item.editorial_category,
  reasons:[],corrections:[],videos_removed:false,readable_domains:0,linked_domains:0};
 const q=normalize(item.question),a=normalize([item.answer?.short_answer,item.answer?.explanation].join(' ')),all=q+' '+a;
 const src=Array.isArray(item.sources)?item.sources:[];
 const linked=new Set(src.map(x=>domain(x.url)).filter(Boolean));
 const readable=new Set(src.filter(x=>x.source_read==='retrieved').map(x=>domain(x.url)).filter(Boolean));
 result.linked_domains=linked.size;result.readable_domains=readable.size;
 if(linked.size<2)addReason(result,'too_few_linked_sources','Fewer than two different source domains');
 if(readable.size<2)addReason(result,'limited_full_source_evidence','Fewer than two independent full-text sources were retrieved. Human source verification required');
 if(!topicsMatch(item.trend_topic,item.question,([item.answer?.short_answer,item.answer?.explanation].join(' ')))){
   const distinctive=tokens(item.trend_topic).some(t=>t.length>=5);
   addReason(result,'topic_drift','Draft question and answer do not explicitly establish a connection to their original trending topic',distinctive?'exclude':'hold');
 }
 const sourceTitles=src.map(s=>clean(s.title+' '+s.snippet)).join(' ');
 const forward=/\b(to hit|will reach|expected to reach|set to reach|reaches on|due to reach|in \d+ days)\b/i.test(sourceTitles);
 if(forward && /\b(now|already|currently|has reached|now one light day away|is one light day away)\b/.test(all))
   addReason(result,'possible_future_past_mixup','A source discusses a future milestone that the answer may present as already achieved');
 const policy=/\b(prop(?:osition)? ?\d+|ballot|voters|election|referendum|endorsement|senate campaign|tax policy)\b/i.test(all);
 if(policy)addReason(result,'politics_policy_claims','Election, endorsement, tax or ballot claims require checking official and timely primary sources');
 if(/\b(?:death|died|killed|fatal|on field collision|cause of death|murder|suicide|assault)\b/i.test(all))
   addReason(result,'sensitive_fatality','Reported death, cause, legal responsibility or serious injury requires extra human confirmation');
 if(/\b(science (?:backs|supports|proves)|supported by science|backed by science|scientifically proven|research proves|studies prove)\b/i.test(all))
   addReason(result,'science_generalization','Scientific endorsement is not established by lifestyle reporting alone');
 if(/\b(to play|bench|player rotation|rotations|lineup|one game|doubtful|injury report|minutes|game against)\b/i.test(all) && item.editorial_category==='sports')
   addReason(result,'perishable_lineup_update','Single-game sports lineup reporting is not suited to the global evergreen feed','exclude');
 if((item.trend_regions||[]).length<=1 && /\b(homesickness|divorce|celebrity gossip|relationship drama|left mallorca|move to germany)\b/i.test(all))
   addReason(result,'narrow_personal_news','Local celebrity personal-life report does not meet the global editorial selection criteria','exclude');
 const correct=classify(item);
 if(correct!==item.editorial_category){result.corrections.push({field:'editorial_category',from:item.editorial_category,to:correct});item.editorial_category=correct;
  result.category=correct;addReason(result,'category_changed','Category label corrected; please verify this classification');}
 const media=videoCheck(item);
 if(item.youtube&&!media.keep){
  result.corrections.push({field:'youtube',from:item.youtube.title,to:null,reason:media.reason});
  item.youtube=null;result.videos_removed=true;
  if(typeof item.x_preview==='string')item.x_preview=item.x_preview.replace(/^🎥 https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}\n\n/m,'');
 }
 item.editorial_gate={version:VERSION,status:result.status,reasons:result.reasons,corrections:result.corrections,
  human_approval_required:true,approved:false,readable_independent_domains:readable.size,
  linked_independent_domains:linked.size};
 item.review_required=true;item.automated_x_eligible=false;item.site_publication_status='unpublished_review';
 return result;
}
function resolveDuplicateEvents(data,results){
 // Highest evidence/interest wins; no two drafts can cover the same normalized
 // entity/event in one daily batch. Different questions are NOT distinct events.
 const order=results.map((x,i)=>({i,rank:({review:20000,hold:10000,exclude:0}[x.status]||0)+
  (data.items[i].sources||[]).filter(s=>s.source_read==='retrieved').length*100+
  Number(data.items[i].editorial_interest||0)*10+Number(data.items[i].editorial_score||0)/1000})).sort((a,b)=>b.rank-a.rank);
 const kept=[];
 for(const {i} of order){
  const cur=data.items[i], key=normalize(cur.event_key||cur.trend_topic);
  const match=kept.find(j=>normalize(data.items[j].event_key||data.items[j].trend_topic)===key || sameSourceStory(cur,data.items[j]));
  if(match!==undefined){addReason(results[i],'duplicate_event',`Same development already represented by ${data.items[match].id}`,'exclude');
   cur.editorial_gate.status=results[i].status;cur.editorial_gate.reasons=results[i].reasons;
  }else kept.push(i);
 }
}
function privateHTML(data,audit){
 const rows=data.items.map((item,i)=>{
  const a=audit.items[i],img=fs.existsSync(path.join(CARDS,item.id+'.png'))?`<img src="cards/${escapeHtml(item.id)}.png" alt="Question visual">`:'';
  const sources=(item.sources||[]).map((s,j)=>`<li>[${j+1}] <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a> (${escapeHtml(s.source_read)})</li>`).join('');
  const video=item.youtube?`<p>Video: <a href="${escapeHtml(item.youtube.url)}">${escapeHtml(item.youtube.title)}</a></p>`:'';
  return `<article><span class="pill">${escapeHtml(a.status.toUpperCase())}</span> <small>${escapeHtml(item.editorial_category)}</small><h2>${escapeHtml(item.question)}</h2>${img}<p><b>${escapeHtml(item.answer?.short_answer)}</b></p><p>${escapeHtml(item.answer?.explanation)}</p><h3>Sources</h3><ol>${sources}</ol><p><b>Grok perspective:</b> ${escapeHtml(item.grok_perspective||'None')}</p>${video}<p><b>Human checks:</b> ${a.reasons.map(r=>escapeHtml(r.message)).join('; ')||'Human verification and approval required'}</p></article>`;
 }).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>COSMOS review-only editorial artifact</title><style>body{background:#f5f7fa;color:#1d2834;font:16px/1.6 system-ui;margin:0}main{max-width:1000px;margin:24px auto;padding:16px}article{background:white;border:1px solid #dce2ea;border-radius:14px;padding:24px;margin:16px 0}.pill{background:#e6ebf0;font-size:12px;padding:5px 10px;border-radius:14px;font-weight:bold}h1{font-size:32px}h2{font-size:22px}h3{font-size:16px}img{max-width:100%;width:480px;border-radius:12px;display:block;margin:16px 0}a{color:#175b98}</style></head><body><main><h1>COSMOS — review-only editorial artifact</h1><p>These are UNPUBLISHED AI-assisted drafts. This is an offline file in a GitHub Actions artifact, not on the PTD TODAY website. Access depends on repository visibility; artifacts from public repositories may be accessible to other GitHub users. No draft is independently fact-checked or automatically approved.</p><p><b>${audit.summary.review} review · ${audit.summary.hold} hold · ${audit.summary.exclude} exclude</b></p>${rows}</main></body></html>`;
}
function removeOldSiteDrafts(){
 let pages=0,cards=0;
 if(fs.existsSync(PUBLIC_PAGES))for(const file of fs.readdirSync(PUBLIC_PAGES)){
  if(file==='index.html'){
   const fp=path.join(PUBLIC_PAGES,file),txt=fs.readFileSync(fp,'utf8');
   if(/noindex,nofollow/i.test(txt)&&/editorial quality review|cosmos global questions.+editorial review|editorial review.+cosmos global questions/i.test(txt)){
    fs.unlinkSync(fp);pages++;}
   continue;
  }
  if(!/^global-[a-z0-9-]+\.html$/.test(file))continue;
  const fp=path.join(PUBLIC_PAGES,file),txt=fs.readFileSync(fp,'utf8');
  if(!/noindex,nofollow/i.test(txt)||!/editorial review draft|review required|cosmos editorial/i.test(txt))continue;
  fs.unlinkSync(fp);pages++;
  const png=path.join(PUBLIC_CARDS,file.slice(0,-5)+'.png');
  if(fs.existsSync(png)){fs.unlinkSync(png);cards++;}
 }
 return {pages,cards};
}
function run(){
 const data=fileJson(REVIEW);
 if(data.generator_version!=='7.2.0'||!Array.isArray(data.items)||!Number.isInteger(data.actual)||data.actual!==data.items.length)
  throw Error('Expected v7.2 generator review JSON; no changes made');
 const seenIds=new Set();
 const results=data.items.map(item=>{
  if(seenIds.has(item.id))throw Error('Duplicate ID: '+item.id);
  seenIds.add(item.id);
  return auditItem(item);
 });
 resolveDuplicateEvents(data,results);
 for(let i=0;i<results.length;i++){
  data.items[i].editorial_gate.status=results[i].status;
  data.items[i].editorial_gate.reasons=results[i].reasons;
 }
 fs.mkdirSync(CARDS,{recursive:true});
 let cardsMoved=0;
 for(const item of data.items){
  const src=path.join(PUBLIC_CARDS,item.id+'.png');
  const dst=path.join(CARDS,item.id+'.png');
  if(fs.existsSync(src)){fs.renameSync(src,dst);cardsMoved++;}
  item.preview_card_relative_path=fs.existsSync(dst)?'cards/'+item.id+'.png':null;
  // Canonical URLs are reserved identifiers, NOT live published links.
  item.reserved_site_url=item.canonical_url;
  item.reserved_image_url=item.image_url;
  item.canonical_url=null;
  item.image_url=null;
 }
 const cleaned=removeOldSiteDrafts();
 const summary={total:results.length,review:results.filter(x=>x.status==='review').length,hold:results.filter(x=>x.status==='hold').length,
  exclude:results.filter(x=>x.status==='exclude').length,videos_removed:results.filter(x=>x.videos_removed).length,
  duplicates_excluded:results.filter(x=>x.reasons.some(r=>r.code==='duplicate_event')).length,
  topic_drift_excluded:results.filter(x=>x.reasons.some(r=>r.code==='topic_drift')).length,
  private_cards:cardsMoved,old_site_pages_removed:cleaned.pages,old_site_cards_removed:cleaned.cards,approved:0};
 const audit={version:VERSION,generated_at:new Date().toISOString(),generator_version:data.generator_version,summary,items:results,
  note:'Deterministic risk screen only. All drafts require independent human editorial approval. No web pages or X posts are created.'};
 data.quality_gate_version=VERSION;data.quality_summary=summary;
 data.policy={...(data.policy||{}),status:'private_editorial_review_required',automatic_x_eligible:false,automatic_site_eligible:false,
  qa_not_independent_fact_check:true};
 // Public latest contains no links, questions, previews or content.
 saveJson(LATEST,{generated_at:audit.generated_at,quality_gate_version:VERSION,items:[],publication_status:'blocked_pending_human_editorial_approval'});
 saveJson(STATUS,{generated_at:audit.generated_at,version:VERSION,summary:{drafts:summary.total,review:summary.review,
  hold:summary.hold,exclude:summary.exclude,approved:0},publications:0,automated_x_posts:0});
 saveJson(REVIEW,data);saveJson(AUDIT,audit);
 fs.mkdirSync(PRIVATE,{recursive:true});
 fs.writeFileSync(path.join(PRIVATE,'index.html'),privateHTML(data,audit));
 const lines=[`# COSMOS v${VERSION} — Private editorial audit`,``,`Generated: ${audit.generated_at}`,
  `Drafts: ${summary.total} | REVIEW: ${summary.review} | HOLD: ${summary.hold} | EXCLUDE: ${summary.exclude}`,
  `Duplicate events: ${summary.duplicates_excluded} | Topic drift: ${summary.topic_drift_excluded} | Videos removed: ${summary.videos_removed}`,
  ``,`No automated approvals. No public Q&A pages. No X posting.`,
  ...results.flatMap(x=>['',`## ${x.question}`,`- Status: **${x.status}**`,`- Topic/category: ${data.items.find(i=>i.id===x.id)?.trend_topic} / ${x.category}`,
   ...x.reasons.map(r=>`- ${r.code}: ${r.message}`),...x.corrections.map(c=>`- Corrected ${c.field}: ${c.reason||`${c.from} -> ${c.to}`}`)])];
 fs.writeFileSync(REPORT,lines.join('\n')+'\n');
 console.log(`COSMOS v${VERSION} REVIEW-ONLY GATE: ${summary.total} drafts: ${summary.review} review, ${summary.hold} hold, ${summary.exclude} exclude; duplicate events ${summary.duplicates_excluded}, topic drifts ${summary.topic_drift_excluded}, unrelated videos ${summary.videos_removed}. Removed ${summary.old_site_pages_removed} old preview pages. ZERO approvals / public pages / X posts.`);
 results.forEach(x=>console.log(`[${x.status.toUpperCase()}] ${x.question} | ${x.reasons.map(r=>r.code).join(',')||'human_review_only'}`));
}
function validate(){
 const data=fileJson(REVIEW),audit=fileJson(AUDIT),latest=fileJson(LATEST),status=fileJson(STATUS);
 assert.equal(data.generator_version,'7.2.0');assert.equal(audit.version,VERSION);
 assert.equal(data.actual,data.items.length);assert.equal(audit.items.length,data.items.length);
 assert.equal(latest.items.length,0);assert.equal(status.publications,0);assert.equal(status.automated_x_posts,0);
 assert.equal(audit.summary.review+audit.summary.hold+audit.summary.exclude,data.items.length);
 for(const item of data.items){
  assert.equal(item.review_required,true);assert.equal(item.automated_x_eligible,false);
  assert.equal(item.site_publication_status,'unpublished_review');
  assert.equal(item.editorial_gate?.approved,false);
  assert.equal(item.canonical_url,null);assert.equal(item.image_url,null);
  assert.equal(fs.existsSync(path.join(PUBLIC_PAGES,item.id+'.html')),false);
  assert.equal(fs.existsSync(path.join(PUBLIC_CARDS,item.id+'.png')),false);
  if(item.preview_card_relative_path)assert.equal(fs.existsSync(path.join(PRIVATE,item.preview_card_relative_path)),true);
 }
 // Previous noindexed editorial pages may have existed. None may survive.
 if(fs.existsSync(PUBLIC_PAGES))for(const name of fs.readdirSync(PUBLIC_PAGES)){
  if(!/^global-[a-z0-9-]+\.html$/.test(name))continue;
  const text=fs.readFileSync(path.join(PUBLIC_PAGES,name),'utf8');
  if(/noindex,nofollow/i.test(text)&&/editorial review draft|review required|cosmos editorial/i.test(text))throw Error('Old public editorial draft survived: '+name);
 }
 console.log('COSMOS private editorial gate validation PASS: no public draft pages/cards, empty latest, 0 X posts, all items unapproved.');
}
function selfTest(){
 assert.equal(normalize('Jesús de Miguel'),normalize('Jesus de Miguel'));
 assert.equal(topicsMatch('playstation',"What does Chew Chor Meng's Mediacorp departure mean?",'Entertainment news'),false);
 assert.equal(topicsMatch('shopify stock',"Why is Bill Ackman bullish about hyperscalers?",'Market report'),false);
 assert.equal(topicsMatch('Blackstone',"What does Blackstone's LNG investment mean?",'Canadian LNG deal'),true);
 assert.equal(topicsMatch('Jesús de Miguel','What happened to Jesus de Miguel on the field?','Football player'),true);
 const a={trend_topic:'Jesus de Miguel',sources:[{url:'https://a.example/a'}]};
 const b={trend_topic:'Jesús de Miguel',sources:[{url:'https://a.example/a'}]};
 assert.equal(sameSourceStory(a,b),true);
 const x={question:'How does Liam Neeson stay fit?',trend_topic:'liam neeson',youtube:{title:'Happy birthday Liam Neeson #shorts',match_score:0.8}};
 assert.equal(videoCheck(x).keep,false);
 console.log('COSMOS v7.2 gate offline regressions PASS: accent dedup, topic drift, video relevance.');
}
if(process.env.COSMOS_GATE_TEST==='1')selfTest();
else if(process.env.COSMOS_GATE_VALIDATE==='1')validate();
else run();
