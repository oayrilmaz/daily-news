// COSMOS LINKEDIN SHARE v9.1
// COSMOS CENTRAL TIMELINE v9.0 JOIN LINKS — public teaser remains indexed, participation needs account.
// COSMOS v8.1 — PUBLIC editorial timeline and user-initiated X sharing.
// Reads ONLY the already-published approved-moments registry. No API keys.
// No private D1/Cloudflare writes. No X API posts. No review artifacts committed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ORIGIN = 'https://ptdtoday.com';
const FEED = 'data/cosmos-approved-moments.json';
const EVENTS = 'data/cosmos-publication-events.json';
const PUBLIC_JSON = 'data/cosmos-public-timeline.json';
const PUBLIC_HTML = 'cosmos-public-moments.html';
const INDEX = 'q/trends/index.html';
const MANIFEST = 'artifacts/cosmos-autonomous-publish/commit-paths.txt';
const PREVIEW = 'artifacts/cosmos-public-distribution';

function readJSON(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function writeFile(f,s){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);}
function safeText(s,max=600){return String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);}
function h(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function urlAllowed(input,expected){
 try{
  const u=new URL(input);
  return u.protocol==='https:' && u.origin===ORIGIN && !u.search && !u.hash && expected.test(u.pathname) && !/%2f|%5c/i.test(u.pathname) ? u.href:null;
 }catch{return null;}
}
function sourceAllowed(input){try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&u.hostname!=='ptdtoday.com'&&u.hostname!=='www.ptdtoday.com'?u.href:null;}catch{return null;}}
function keyDate(t){const n=Date.parse(t);return Number.isFinite(n)?new Date(n).toISOString():null;}
function selectItems(feed,events){
 if(!Array.isArray(feed?.items))throw Error('Approved registry is not an items array');
 const eventMap=new Map();for(const e of events?.events||[])if(e&&typeof e.id==='string'&&['publish','retract'].includes(e.action)) eventMap.set(e.id,e.action);
 const out=[],ids=new Set();
 for(const item of feed.items){
  if(!item||item.publication_status!=='published'||item.moment_type!=='cosmos_editorial_question')continue;
  if(eventMap.get(item.id)==='retract')continue;
  if(item.automatic_evidence_review!==true&&item.manual_source_verification!==true)continue;
  if(typeof item.id!=='string'||!/^global-[a-z0-9-]{8,120}$/.test(item.id)||ids.has(item.id))continue;
  const url=urlAllowed(item.url,/^\/q\/trends\/global-[a-z0-9-]+\.html$/);
  const image=urlAllowed(item.image_url,/^\/assets\/cosmos-approved-cards\/global-[a-z0-9-]+\.png$/);
  const published_at=keyDate(item.published_at);
  const question=safeText(item.question,220),answer=safeText(item.short_answer,450);
  const sources=(Array.isArray(item.sources)?item.sources:[]).map(s=>({title:safeText(s.title,160),url:sourceAllowed(s.url)})).filter(x=>x.url&&x.title);
  const hosts=new Set(sources.map(s=>new URL(s.url).hostname.replace(/^www\./,'')));
  if(!url||!image||!published_at||!question||!answer||hosts.size<2)continue;
  if(!url.includes('/'+item.id+'.html')||!image.includes('/'+item.id+'.png'))continue;
  // Verify the published artifact files exist locally. Never show a missing page or image.
  if(!fs.existsSync(new URL(url).pathname.slice(1))||!fs.existsSync(new URL(image).pathname.slice(1)))continue;
  ids.add(item.id);
  out.push({id:item.id,type:'cosmos_editorial_question',visibility:'public',source:'ptdtoday_approved',published_at,
    category:safeText(item.category||'general',32).toLowerCase(),question,short_answer:answer,
    url,image_url:image,sources:sources.slice(0,5),regions:(Array.isArray(item.regions)?item.regions:[]).map(x=>safeText(x,3)).filter(x=>/^[A-Z]{2}$/.test(x)).slice(0,12)});
 }
 return out.sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.id.localeCompare(b.id)).slice(0,100);
}
function intent(item){
 const suffix=` ${item.url}`;
 const prefix=`${item.question} — ${item.short_answer}`;
 const text=prefix.slice(0,Math.max(40,235-suffix.length)) + suffix;
 return 'https://twitter.com/intent/tweet?text='+encodeURIComponent(text);
}
function page(items,updatedAt){
 const cards=items.map((x,i)=>`<article class="moment" data-category="${h(x.category)}">
  <div class="rail"><span class="orbit" aria-hidden="true"></span><time datetime="${h(x.published_at)}">${h(x.published_at.slice(0,10))}</time></div>
  <div class="panel"><div class="kicker">PUBLIC MOMENT · ${h(x.category.toUpperCase())}</div>
   <a class="headline" href="${h(x.url)}">${h(x.question)}</a><p>${h(x.short_answer)}</p>
   <a class="image" href="${h(x.url)}"><img loading="lazy" decoding="async" src="${h(x.image_url)}" alt="Illustrated card for ${h(x.question)}"></a>
   <div class="sources">Evidence: ${x.sources.slice(0,2).map((s,i)=>`<a rel="noopener noreferrer" target="_blank" href="${h(s.url)}">Source ${i+1}</a>`).join(' · ')}</div>
   <div class="actions"><a class="primary" href="${h(x.url)}">Read answer ↗</a><a href="/cosmos-next.html?public_moment=${encodeURIComponent(x.id)}">Explore in COSMOS ↗</a><a href="${h(intent(x))}" target="_blank" rel="noopener noreferrer" aria-label="Share this COSMOS moment on X">Share on X ↗</a><button type="button" class="linkedin-copy" data-li-title="${h(x.question)}" data-li-answer="${h(x.short_answer)}" data-li-url="${h(x.url)}" data-li-category="${h(x.category)}">Copy LinkedIn post + hashtags</button><a href="${h('https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(x.url))}" target="_blank" rel="noopener noreferrer">Open LinkedIn ↗</a></div>
  </div></article>`).join('\n');
 const categories=[...new Set(items.map(x=>x.category))].sort();
 const filters=categories.map(x=>`<button type="button" class="filter" data-filter="${h(x)}">${h(x)}</button>`).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><link rel="canonical" href="${ORIGIN}/${PUBLIC_HTML}"><meta name="description" content="Explore publicly published COSMOS questions as moments on one evolving global timeline."><title>Public moments | PTD COSMOS</title>
<style>:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#102438;background:#f8fbfd}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 55% 0%,#e6f5fc 0,#f8fbfd 38%,#f7fafc 100%);min-height:100vh}a{color:inherit}header{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:22px max(22px,calc((100vw - 1140px)/2))}header a{text-decoration:none;font-size:13px;letter-spacing:.04em;font-weight:700}header .links{display:flex;gap:18px;flex-wrap:wrap}main{max-width:1040px;margin:0 auto;padding:20px 20px 90px}.eyebrow{font-size:12px;letter-spacing:.16em;color:#20748b;font-weight:750}.hero{padding:32px 0 30px;border-bottom:1px solid #dae7ed}h1{font-size:clamp(38px,6vw,76px);line-height:1.03;letter-spacing:-.055em;margin:14px 0 18px}p{line-height:1.58;color:#45586b}.hero p{max-width:600px} .controls{display:flex;gap:10px;flex-wrap:wrap;padding:24px 0 14px}.filter{background:#fff;border:1px solid #d3e5ec;border-radius:999px;padding:9px 15px;cursor:pointer;color:#285369;font-size:13px;text-transform:capitalize}.filter[aria-pressed=true]{background:#15374b;color:white;border-color:#15374b}.timeline{position:relative;margin-top:6px}.timeline:before{content:'';position:absolute;left:49px;top:15px;bottom:0;width:2px;background:linear-gradient(#7eb5c9,#d9e9ef)}.moment{display:grid;grid-template-columns:101px minmax(0,1fr);margin-bottom:22px}.rail{position:relative;display:flex;align-items:center;flex-direction:column;gap:9px;padding-top:30px}.orbit{border:3px solid #347e99;background:#fff;width:15px;height:15px;border-radius:50%;box-shadow:0 0 0 6px #ecf5f8;z-index:1}.rail time{font-size:11px;color:#647a87;white-space:nowrap}.panel{background:rgba(255,255,255,.8);border:1px solid #dce8ee;border-radius:22px;padding:26px 30px;box-shadow:0 12px 35px rgba(26,74,99,.04);min-width:0}.kicker{color:#237f9f;font-weight:800;font-size:11px;letter-spacing:.09em;margin-bottom:12px}.headline{font-size:clamp(20px,3vw,30px);line-height:1.2;font-weight:760;letter-spacing:-.03em;text-decoration:none}.headline:hover{text-decoration:underline}.panel p{font-size:15px;margin:14px 0 18px}.image img{display:block;max-height:280px;width:100%;object-fit:contain;border-radius:14px;background:#f5f9fb}.sources{font-size:12px;color:#566e7f;margin:18px 0 16px}.sources a{color:#216d8a}.actions{display:flex;gap:13px;flex-wrap:wrap}.actions a{font-size:13px;text-decoration:none;font-weight:700;border:1px solid #c6dce6;border-radius:999px;padding:9px 14px}.actions .primary{background:#17374b;color:white;border-color:#17374b}.empty{margin:42px 0;padding:50px 25px;border:1px dashed #a6c4d3;border-radius:20px;text-align:center}.empty h2{margin:0}.foot{border-top:1px solid #dbe7ec;margin-top:45px;padding-top:22px;font-size:12px;color:#708290}button:focus-visible,a:focus-visible{outline:3px solid #2d9fce;outline-offset:3px}@media(max-width:640px){header{padding:18px 20px}.timeline:before{left:13px}.moment{grid-template-columns:31px minmax(0,1fr)}.rail{padding-top:24px}.rail time{display:none}.panel{padding:20px 16px;border-radius:17px}.image img{max-height:220px}}
.actions button{font-size:13px;font-weight:700;border:1px solid #c6dce6;border-radius:999px;padding:9px 14px;background:#fff;color:#21576b;cursor:pointer}</style></head><body><header><a href="/cosmos-next.html">PTD TODAY / COSMOS</a><nav class="links"><a href="/q/trends/">Global Questions</a><a href="/cosmos-next.html?join=1">Join COSMOS</a></nav></header><main><section class="hero"><div class="eyebrow">COSMOS · PUBLIC TIMELINE</div><h1>Every question becomes a moment.</h1><p>Explore verified, source-linked questions published on PTD Today. These are public editorial moments—not anyone's private COSMOS timeline. Share a moment yourself, or follow its source connections.</p><small style="color:#6c8190">${items.length} public moment${items.length===1?'':'s'} · Updated ${h(updatedAt.slice(0,10))}</small></section>
${items.length?`<div class="controls" role="group" aria-label="Filter by topic"><button type="button" class="filter" data-filter="all" aria-pressed="true">All</button>${filters}</div><section class="timeline" id="timeline">${cards}</section>`:'<div class="empty"><h2>No public moments yet</h2><p>Qualifying stories will appear here after evidence checks and publication.</p><a href="/q/trends/">Browse Global Questions ↗</a></div>'}
<footer class="foot">COSMOS public editorial stream. Automated evidence checks reduce risk but do not guarantee accuracy. X sharing is initiated by the person clicking Share; no automated X posting occurs.</footer></main>
<script>document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{let v=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('.moment').forEach(x=>{x.hidden=v!=='all'&&x.dataset.category!==v;});}));
// COSMOS LINKEDIN SHARE v9.1: user-initiated copy. Never posts automatically.
function cosmosLinkedInText(b){
 const category=String(b.dataset.liCategory||'').toLowerCase();
 const tag={technology:'#Technology',business:'#Business',science:'#Science',entertainment:'#Entertainment',sports:'#Sports',world:'#WorldNews',lifestyle:'#Lifestyle',transport:'#Transport'}[category]||'#Discoveries';
 return [String(b.dataset.liTitle||''),String(b.dataset.liAnswer||''),'Explore the sources: '+String(b.dataset.liUrl||''),['#COSMOS','#PTDToday',tag].join(' ')].filter(Boolean).join('\n\n');
}
async function cosmosSocialCopy(t){try{await navigator.clipboard.writeText(t);return true}catch{let f=document.createElement('textarea');f.value=t;f.style.cssText='position:fixed;left:-9999px';document.body.appendChild(f);f.select();let ok=document.execCommand('copy');f.remove();return ok}}
document.querySelectorAll('.linkedin-copy').forEach(b=>b.addEventListener('click',async()=>{
 const ok=await cosmosSocialCopy(cosmosLinkedInText(b));
 b.textContent=ok?'Copied — paste into LinkedIn':'Copy failed — try again';
}));
</script></body></html>`;
}
function addIndexLink(s){
 const link='<a href="/cosmos-public-moments.html" style="display:inline-block;margin-left:18px;color:#176b89">Public COSMOS timeline</a>';
 if(s.includes('href="/cosmos-public-moments.html"'))return s;
 return s.replace('</nav>',link+'</nav>');
}
function generate({base='.',mode=process.env.COSMOS_SITE_MODE||'dry_run'}={}){
 const old=process.cwd();process.chdir(base);try{
  if(mode==='live'&&!fs.existsSync(FEED))throw Error('Approved registry missing: live public timeline blocked');
  const items=selectItems(readJSON(FEED,{items:[]}),readJSON(EVENTS,{events:[]}));
  const updatedAt=items[0]?.published_at||'2026-11-03T00:00:00.000Z';
  const doc={version:'8.1.0',public_only:true,visibility:'public',updated_at:updatedAt,count:items.length,items};
  const live=mode==='live';const dir=live?'.':PREVIEW;
  writeFile(path.join(dir,PUBLIC_JSON),JSON.stringify(doc,null,2)+'\n');
  writeFile(path.join(dir,PUBLIC_HTML),page(items,updatedAt));
  if(live){
   if(!fs.existsSync(MANIFEST))throw Error('v8 publishing manifest missing');
   const existing=fs.readFileSync(MANIFEST,'utf8').split(/\r?\n/).filter(Boolean);
   const entries=[...new Set([...existing,PUBLIC_JSON,PUBLIC_HTML])];
   writeFile(MANIFEST,entries.join('\n')+'\n');
   if(fs.existsSync(INDEX))writeFile(INDEX,addIndexLink(fs.readFileSync(INDEX,'utf8')));
  }
  console.log(`COSMOS v8.1 ${live?'LIVE_STAGE':'DRY_RUN'}: ${items.length} approved public timeline moments; 0 automatic X posts; 0 private timeline writes`);
  return {items,doc};
 }finally{process.chdir(old);}
}
async function selfTest(){
 assert.equal(urlAllowed('javascript:evil',/^\/q/),null);
 assert.equal(urlAllowed('https://evil.example/q/trends/global-x.html',/^\/q/),null);
 assert.equal(sourceAllowed('http://evil.example/'),null);
 assert.equal(h('<script>'), '&lt;script&gt;');
 assert(!page([{id:'test',published_at:'2026-11-03T00:00:00.000Z',category:'test',question:'<script>alert(1)</script>',short_answer:'Hello',url:ORIGIN+'/q/trends/global-test.html',image_url:ORIGIN+'/assets/cosmos-approved-cards/global-test.png',sources:[{title:'x',url:'https://a.example/x'},{title:'y',url:'https://b.example/y'}]}],'2026-11-03T00:00:00.000Z').includes('<script>alert(1)</script>'));
 const s='<nav>hi</nav>';assert.equal(addIndexLink(addIndexLink(s)),addIndexLink(s));
 console.log('COSMOS v8.1 unit checks passed: safe URLs, escaping, idempotent navigation link, manual X intents only');
}
if(process.env.COSMOS_PUBLIC_SELF_TEST==='1')await selfTest();else generate();
