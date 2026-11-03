/**
 * COSMOS v7.3.0 — EXPLICIT HUMAN APPROVAL publisher for v7.2 review artifacts.
 * No API calls; never writes an X queue or COSMOS Next private timeline.
 * Separate public registry: data/cosmos-approved-moments.json (v7.2 leaves it alone).
 * Modes: preview, publish, retract. Must run on approved GitHub workflow/manual user action.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const VERSION='7.3.0';
const ARTIFACT=process.env.COSMOS_ARTIFACT_DIR || 'artifacts/cosmos-editorial-review-input';
const MODE=(process.env.COSMOS_PUBLISH_MODE||'preview').toLowerCase().trim();
const ID=(process.env.COSMOS_ITEM_ID||'').trim();
const RUN_ID=(process.env.COSMOS_SOURCE_RUN_ID||'').trim();
const REVIEWER=(process.env.COSMOS_REVIEWER||'').trim();
const OWNER=(process.env.COSMOS_REPOSITORY_OWNER||'').trim();
const VERIFY=(process.env.COSMOS_SOURCE_VERIFIED||'').trim();
const CONFIRM=(process.env.COSMOS_PUBLISH_CONFIRM||'').trim();
const NOTE=(process.env.COSMOS_EVIDENCE_NOTE||'').trim();
const OVERRIDES={question:process.env.COSMOS_EDIT_QUESTION||'',short_answer:process.env.COSMOS_EDIT_SHORT||'',explanation:process.env.COSMOS_EDIT_EXPLANATION||''};
const INCLUDE_GROK=process.env.COSMOS_INCLUDE_GROK==='true';
const INCLUDE_VIDEO=process.env.COSMOS_INCLUDE_VIDEO==='true';
const REGISTRY='data/cosmos-approved-moments.json';
const HISTORY='data/cosmos-publication-events.json';
const PUBLIC_DIR='q/trends';
const CARD_DIR='assets/cosmos-approved-cards';
const INDEX=path.join(PUBLIC_DIR,'index.html');
const OUTPUT='artifacts/cosmos-publish-preview';
const ALLOWED_ID=/^global-[a-z0-9-]{8,110}$/;
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const norm=s=>clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
const fail=m=>{throw new Error('COSMOS APPROVAL BLOCKED: '+m)};
const assert=(v,m)=>{if(!v)fail(m)};
const uniqueDomains=src=>new Set(src.map(s=>{try{return new URL(s.url).hostname.toLowerCase().replace(/^(www|m|amp)\./,'');}catch{return ''}}).filter(Boolean));
const sourceUrl=u=>{let x;try{x=new URL(u)}catch{fail('Invalid source URL')}assert(x.protocol==='https:' && !x.username && !x.password,'Source URL must be HTTPS and contain no credentials');return x.href};
const validText=(s,min,max,label)=>{assert(s.length>=min && s.length<=max,`${label} must be ${min}-${max} characters`);return s};
const jsonBytes=x=>Buffer.from(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const siteOrigin='https://ptdtoday.com';
const siteLink=id=>`${siteOrigin}/q/trends/${id}.html`;
const imageLink=id=>`${siteOrigin}/assets/cosmos-approved-cards/${id}.png`;

function validateCommon(){
 assert(['preview','publish','retract'].includes(MODE),'Invalid operation');
 assert(ALLOWED_ID.test(ID),'Invalid item ID');
 assert(/^[a-zA-Z0-9-]{1,60}$/.test(REVIEWER),'GitHub reviewer identity missing');
 assert(/^[a-zA-Z0-9-]{1,60}$/.test(OWNER),'GitHub repository owner missing');
 assert(REVIEWER.toLowerCase()===OWNER.toLowerCase(),'Only repository owner may publish or retract');
 if(MODE!=='retract')assert(/^\d{5,20}$/.test(RUN_ID),'Provide source GitHub Actions run ID');
}
function getInputs(){
 const reviewPath=path.join(ARTIFACT,'data/cosmos-global-questions-review.json');
 const auditPath=path.join(ARTIFACT,'data/cosmos-global-questions-quality-audit.json');
 assert(fs.existsSync(reviewPath)&&fs.existsSync(auditPath),'Source review/audit files missing from downloaded artifact');
 const review=read(reviewPath,null),audit=read(auditPath,null);
 assert(review?.generator_version==='7.2.0' && review?.quality_gate_version==='7.2.0','Expected v7.2 post-gate data, not original generator output');
 assert(audit?.version==='7.2.0','Editorial audit version mismatch');
 assert(Array.isArray(review.items)&&Array.isArray(audit.items),'Missing vetted items');
 assert(review.items.length===audit.items.length && review.actual===review.items.length,'Review/audit item count mismatch');
 const item=review.items.find(x=>x.id===ID),a=audit.items.find(x=>x.id===ID);
 assert(item&&a,'Selected ID not found in that exact review run');
 assert(['review','hold','exclude'].includes(a.status),'Unexpected editorial status');
 assert(item.editorial_gate?.version==='7.2.0' && item.editorial_gate?.status===a.status,'Editorial status mismatch');
 assert(item.editorial_gate?.approved===false && item.automated_x_eligible===false,'Artifact is not a valid unpublished item');
 assert(a.status!=='exclude','EXCLUDE stories cannot be published from this workflow');
 const reasons=a.reasons||[];
 assert(!reasons.some(x=>['duplicate_event','topic_drift','narrow_personal_news','perishable_lineup_update'].includes(x.code)),
 'Duplicate, off-topic, or excluded subjects must not be published');
 // Hard safety block on fatality claims; rework through a new editorial review first.
 assert(!reasons.some(x=>x.code==='sensitive_fatality'),'Fatality reports require a separate enhanced editorial review; not supported in v7.3');
 const src=item.sources||[];
 assert(src.length>=2 && uniqueDomains(src).size>=2,'At least two distinct linked source domains required');
 src.forEach(s=>sourceUrl(s.url));
 const card=path.join(ARTIFACT,'artifacts/cosmos-editorial-review/cards',ID+'.png');
 assert(fs.existsSync(card),'Matching reviewed card is missing');
 const cardBuffer=fs.readFileSync(card);
 assert(cardBuffer.length>=100 && cardBuffer.length<10_000_000,'Card image size out of bounds');
 assert(cardBuffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG card');
 return {review,audit,item,entry:a,src,cardBuffer};
}
function editable(item,src){
 const q=validText(clean(OVERRIDES.question)||clean(item.question),15,250,'Question');
 const short=validText(clean(OVERRIDES.short_answer)||clean(item.answer?.short_answer),20,700,'Short answer');
 const explanation=validText(clean(OVERRIDES.explanation)||clean(item.answer?.explanation),65,4200,'Explanation');
 const refs=[...explanation.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1]));
 assert(new Set(refs).size>=2 && refs.every(n=>n>=1&&n<=src.length),
  'Explanation must cite at least two existing linked sources via [1], [2], etc. Source numbers must be valid');
 return {question:q,short_answer:short,explanation};
}
function renderPage(obj,inlineCard){
 const title=obj.question;
 const desc=obj.short_answer.slice(0,200);
 const img=inlineCard||obj.image_url;
 const srcList=obj.sources.map((s,i)=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">[${i+1}] ${esc(s.title||s.url)}</a><small>${esc(s.domain||new URL(s.url).hostname)}</small></li>`).join('');
 const grok=obj.grok_perspective?`<section><h2>Additional AI perspective</h2><p>${esc(obj.grok_perspective)}</p><p class="fine">AI-generated interpretation; not independently established by the cited reporting.</p></section>`:'';
 const video=obj.youtube?`<section><h2>Related video</h2><a href="${esc(obj.youtube.url)}" target="_blank" rel="noopener noreferrer">${esc(obj.youtube.title)} — ${esc(obj.youtube.channel||'YouTube')}</a><p class="fine">Video is supplementary and may not substantiate the answer.</p></section>`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><title>${esc(title)} | PTD COSMOS</title><meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(obj.image_url)}"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(obj.url)}"><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#1c2430;font:16px/1.65 system-ui,-apple-system,sans-serif}main{width:min(860px,100%);margin:0 auto;padding:clamp(20px,5vw,60px)}a{color:#1a5f94}a:hover{text-decoration:underline}.nav{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;font-size:13px;font-weight:700;letter-spacing:.06em}.nav a{text-decoration:none}h1{font-size:clamp(28px,5vw,45px);line-height:1.18;letter-spacing:-.035em}h2{font-size:19px}section{border-top:1px solid #dfe5e9;padding:24px 0}.hero{width:100%;border-radius:16px;margin:20px 0;object-fit:cover}.meta,.fine{color:#687482;font-size:13px}.answer{font-size:19px;font-weight:650}.sources li{margin:12px 0;overflow-wrap:anywhere}.sources small{display:block;color:#687482}.pill{display:inline-block;background:#f0f4f7;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700}.back{display:inline-block;background:#1c2430;color:white;padding:11px 17px;border-radius:25px;text-decoration:none}</style></head><body><main><nav class="nav"><a href="https://ptdtoday.com/">PTD TODAY · COSMOS</a><a href="https://ptdtoday.com/q/trends/">Global questions</a></nav><p class="meta">COSMOS editorial question · ${esc(obj.category)} · Published ${esc(obj.published_at.slice(0,10))}</p><h1>${esc(title)}</h1><span class="pill">Human-reviewed editorial content</span><img class="hero" src="${esc(img)}" alt="COSMOS question visual"><section><h2>Short answer</h2><p class="answer">${esc(obj.short_answer)}</p><h2>Explore</h2><p>${esc(obj.explanation)}</p></section>${grok}${video}<section><h2>Sources and provenance</h2><p class="fine">Editorial question based on linked reporting. Original Google Trends signals indicate topical interest, not verified search-question popularity. The source links below support manual verification; they are not a guarantee that every claim remains current.</p><ol class="sources">${srcList}</ol><p class="meta">Trend: ${esc(obj.trend_topic)} · Regions: ${esc(obj.regions.join(', '))} · Human approval: ${esc(obj.reviewer)}</p></section><a class="back" href="/q/trends/">Explore more COSMOS questions</a></main></body></html>`;
}
function renderIndex(registry){
 const entries=registry.items.slice(0,100).map(x=>`<article><a class="tile" href="${esc(x.url)}"><img loading="lazy" src="${esc(x.image_url)}" alt="COSMOS editorial visual"><div class="detail"><small>${esc(x.category)} · ${esc(x.published_at.slice(0,10))}</small><h2>${esc(x.question)}</h2><p>${esc(x.short_answer)}</p></div></a></article>`).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COSMOS Global Questions | PTD Today</title><meta name="description" content="Human-reviewed global questions, insights and sources from PTD Today COSMOS."><meta name="robots" content="index,follow"><link rel="canonical" href="https://ptdtoday.com/q/trends/"><style>*{box-sizing:border-box}body{font:16px/1.5 system-ui;background:#fff;color:#19212c;margin:0}main{max-width:1080px;margin:auto;padding:clamp(20px,5vw,60px)}nav{display:flex;gap:25px;justify-content:space-between}a{color:inherit}nav a{text-decoration:none}h1{font-size:clamp(36px,6vw,60px);letter-spacing:-.06em;line-height:1.1;margin:50px 0 12px}p.lede{color:#586575;margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:24px}.tile{text-decoration:none;display:block;border:1px solid #e3e9ef;border-radius:14px;overflow:hidden;height:100%;transition:box-shadow .2s}.tile:hover{box-shadow:0 4px 18px #1020301f}.tile img{width:100%;aspect-ratio:16/9;object-fit:cover}.detail{padding:18px}.detail small{color:#697789;text-transform:uppercase;font-size:12px;letter-spacing:.05em}.detail h2{font-size:19px;line-height:1.35}.detail p{color:#556473;font-size:14px}</style></head><body><main><nav><strong>PTD TODAY · COSMOS</strong><a href="https://ptdtoday.com/">Home</a></nav><h1>Questions worth exploring.</h1><p class="lede">Human-reviewed questions connected to worldwide developments. Published selectively, with sources and context.</p><div class="grid">${entries||'<p>No approved questions have been published yet.</p>'}</div></main></body></html>`;
}
function store(){
 const p=read(REGISTRY,{version:VERSION,updated_at:null,items:[]});
 assert(p && Array.isArray(p.items),'Corrupt approved-moments registry');
 assert(p.items.every(x=>ALLOWED_ID.test(x.id)&&x.publication_status==='published'),'Unapproved/invalid entry in public registry');
 return p;
}
function writeAll(registry,event,commitPaths){
 registry.version=VERSION;registry.updated_at=new Date().toISOString();
 save(REGISTRY,registry);
 fs.mkdirSync(PUBLIC_DIR,{recursive:true});fs.writeFileSync(INDEX,renderIndex(registry));
 const log=read(HISTORY,{version:VERSION,events:[]});
 assert(Array.isArray(log.events),'Invalid publication event log');
 log.version=VERSION;
 log.events.push(event);
 save(HISTORY,log);
 fs.mkdirSync(OUTPUT,{recursive:true});
 const paths=[REGISTRY,HISTORY,INDEX,...commitPaths];
 fs.writeFileSync(path.join(OUTPUT,'commit-paths.txt'),[...new Set(paths)].join('\n')+'\n');
 save(path.join(OUTPUT,'operation-summary.json'),{mode:MODE,item_id:ID,event,commit_paths:[...new Set(paths)],public_url:event.action==='publish'?siteLink(ID):null});
}
function preview(){
 const {item,entry,src,cardBuffer}=getInputs();
 const edited=editable(item,src);
 const obj=makeMoment(item,edited,src,'PREVIEW',cardBuffer);
 fs.mkdirSync(OUTPUT,{recursive:true});
 const offlineCard='data:image/png;base64,'+cardBuffer.toString('base64');
 fs.writeFileSync(path.join(OUTPUT,'preview.html'),renderPage(obj,offlineCard).replace('<meta name="robots" content="index,follow">','<meta name="robots" content="noindex,nofollow">').replace('</h1><span class="pill">','</h1><p style="border:2px solid #c55;padding:10px">UNPUBLISHED LOCAL PREVIEW — DO NOT SHARE AS FACT-CHECKED CONTENT.</p><span class="pill">'));
 save(path.join(OUTPUT,'preview-summary.json'),{mode:'preview',source_run_id:RUN_ID,item_id:ID,editorial_status:entry.status,flagged_reasons:entry.reasons,question:edited.question,publication_performed:false});
 console.log(`[COSMOS v${VERSION}] PREVIEW ONLY: ${ID} (${entry.status}); no public website edits`);
}
function makeMoment(item,edited,src,reviewedAt,cardBuffer){
 const sources=src.map(s=>({title:clean(s.title||s.url),url:sourceUrl(s.url),domain:new URL(s.url).hostname,source_read:s.source_read||null}));
 return {id:ID,moment_type:'cosmos_editorial_question',publication_status:'published',question:edited.question,short_answer:edited.short_answer,explanation:edited.explanation,category:clean(item.editorial_category),trend_topic:clean(item.trend_topic),event_key:norm(item.event_key||item.trend_topic),regions:Array.isArray(item.trend_regions)?item.trend_regions:[],sources,source_run_id:RUN_ID,reviewer:REVIEWER,published_at:reviewedAt,url:siteLink(ID),image_url:imageLink(ID),youtube:INCLUDE_VIDEO&&item.youtube?{title:clean(item.youtube.title),channel:clean(item.youtube.channel),url:sourceUrl(item.youtube.url)}:null,grok_perspective:INCLUDE_GROK?clean(item.grok_perspective):null,manual_source_verification:true,automatic_x_eligible:false,editorial_source_type:item.question_source_type};
}
function publish(){
 assert(VERIFY==='I_VERIFIED','You must explicitly attest I_VERIFIED after checking primary and independent sources');
 assert(CONFIRM==='PUBLISH','Type PUBLISH as second confirmation');
 const {item,entry,src,cardBuffer}=getInputs();
 const explanation=editable(item,src);
 validText(NOTE,entry.status==='hold'?80:30,2000,'Verification notes');
 const registry=store();
 assert(!registry.items.some(x=>x.id===ID),'Already published: retract first to replace');
 const incomingEvent=norm(item.event_key||item.trend_topic);
 const recentDays=7*24*60*60*1000;
 assert(!registry.items.some(x=>norm(x.event_key||x.trend_topic)===incomingEvent &&
   Date.now()-Date.parse(x.published_at||0)<recentDays),'Another question for this event was published in the last seven days');
 const time=new Date().toISOString(),obj=makeMoment(item,explanation,src,time,cardBuffer);
 const outFile=path.join(PUBLIC_DIR,ID+'.html');
 const outCard=path.join(CARD_DIR,ID+'.png');
 assert(!fs.existsSync(outFile) && !fs.existsSync(outCard),'Existing public file collision; publisher refuses overwrite');
 fs.mkdirSync(PUBLIC_DIR,{recursive:true});fs.mkdirSync(CARD_DIR,{recursive:true});
 fs.writeFileSync(outFile,renderPage(obj));fs.writeFileSync(outCard,cardBuffer);
 registry.items.unshift(obj);
 const event={action:'publish',id:ID,at:time,reviewer:REVIEWER,source_run_id:RUN_ID,original_status:entry.status,verification_note_sha256:hash(NOTE),source_review_sha256:hash(jsonBytes({item,audit:entry})),claims_attested:true};
 writeAll(registry,event,[outFile,outCard]);
 console.log(`[COSMOS v${VERSION}] HUMAN-APPROVED PUBLICATION staged: ${siteLink(ID)}. NOT pushed to X or private timeline.`);
}
function retract(){
 assert(CONFIRM==='RETRACT','Type RETRACT to remove an existing published question');
 const registry=store();
 const found=registry.items.find(x=>x.id===ID);
 assert(found,'Question not in public approved registry');
 registry.items=registry.items.filter(x=>x.id!==ID);
 const page=path.join(PUBLIC_DIR,ID+'.html'),card=path.join(CARD_DIR,ID+'.png');
 if(fs.existsSync(page))fs.unlinkSync(page);
 if(fs.existsSync(card))fs.unlinkSync(card);
 const event={action:'retract',id:ID,at:new Date().toISOString(),reviewer:REVIEWER,original_publish_date:found.published_at};
 writeAll(registry,event,[page,card]);
 console.log(`[COSMOS v${VERSION}] RETRACT staged: ${ID}; CDN/search engine caches may persist.`);
}
try{validateCommon();if(MODE==='preview')preview();else if(MODE==='publish')publish();else retract();}catch(e){console.error(e.message);process.exitCode=1}
