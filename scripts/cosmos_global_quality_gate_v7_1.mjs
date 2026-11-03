/**
 * PTD TODAY / COSMOS v7.1.0 — offline, fail-closed editorial quality gate.
 * Runs AFTER v7.0 question+visual generation, BEFORE GitHub commit.
 * It does not contact any API, claim to independently fact-check the news,
 * approve drafts, or publish to social media.
 *
 * Arguments: none. Run from repository root:
 *   node scripts/cosmos_global_quality_gate_v7_1.mjs
 * For a temporary offline fixture, run from a sandbox repo root with data/...
 */
import fs from 'node:fs';
import path from 'node:path';

const VERSION = '7.1.0';
const REVIEW = 'data/cosmos-global-questions-review.json';
const LATEST = 'data/cosmos-global-questions-latest.json';
const AUDIT = 'data/cosmos-global-questions-quality-audit.json';
const REPORT = 'data/cosmos-global-questions-quality-summary.md';
const INDEX = 'q/trends/index.html';
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const writeJson = (filename, data) => {fs.mkdirSync(path.dirname(filename), {recursive:true}); fs.writeFileSync(filename, JSON.stringify(data,null,2)+'\n');};
const html = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = s => String(s??'').replace(/\s+/g,' ').trim();
const safeId = s => /^global-[a-z0-9-]{8,110}$/.test(s||'');
const domain = s => {try{return new URL(s).hostname.toLowerCase().replace(/^(www|m|amp)\./,'');}catch{return '';}};
const lower = s => clean(s).toLowerCase();

function matchingVideo(item) {
  if (!item.youtube) return {keep:false, reason:null};
  const q=lower(item.question), t=lower(item.youtube.title), topic=lower(item.trend_topic);
  const score=Number(item.youtube.match_score||0);
  // A person's name is insufficient: birthday/shorts/drama videos about someone
  // do not answer questions about their fitness, departure or professional news.
  if (/\b(birthday|happy birthday|viral|youtubeshorts|#shorts)\b/i.test(t) && !/birthday|viral|shorts/i.test(q))
    return {keep:false,reason:'unrelated_youtube_celebration_or_shorts'};
  if (/\b(drama|gossip|rumor|scandal)\b/i.test(t) && !/drama|gossip|rumor|scandal/i.test(q))
    return {keep:false,reason:'unrelated_youtube_gossip'};
  // A handful of event synonyms are used ONLY to retain contextual videos,
  // never to establish factual truth. All retained videos still need human review.
  const communicationEvent = /voyager|spacecraft|probe/.test(topic+' '+q)
    && /\b(communication|contact|signal|loss|silence)\b/.test(q)
    && /\b(silent|signal|contact|communication|outage|lost touch)\b/.test(t);
  if (score<0.65 && !communicationEvent) return {keep:false,reason:'youtube_title_does_not_match_question'};
  // A generic team/player video should not accompany a game-day lineup update.
  if (/\b(lineup|rotation|minutes|return|injury)\b/.test(q) && !/\b(lineup|rotation|minutes|return|injury|back|available)\b/.test(t))
    return {keep:false,reason:'youtube_missing_specific_game_event'};
  return {keep:true,reason:null};
}

function evaluate(item){
  const reasons=[];
  const correction=[];
  const q=lower(item.question), a=lower([item.answer?.short_answer,item.answer?.explanation].join(' '));
  const all=q+' '+a, topic=lower(item.trend_topic);
  const src=Array.isArray(item.sources)?item.sources:[];
  const domains=new Set(src.map(s=>domain(s.url)).filter(Boolean));
  const read=new Set(src.filter(s=>s.source_read==='retrieved').map(s=>domain(s.url)).filter(Boolean));
  let status='review';
  const add=(code,message,type='hold')=>{
    if(!reasons.some(x=>x.code===code))reasons.push({code,message});
    if(type==='exclude')status='exclude';
    else if(status!=='exclude')status='hold';
  };
  if(!safeId(item.id))throw Error('Unsafe or missing draft ID: '+item.id);
  if(domains.size<2)add('not_two_independent_domains','Fewer than two distinct linked source domains');
  if(read.size<2)add('insufficient_retrieved_sources','Fewer than two independent sources were read beyond their headline/snippet; full answer cannot be safely corroborated');

  // An event announced for the future must not be described as already achieved.
  // This is deliberately a RISK FLAG, not a replacement of the reporter's facts.
  const forwardSource=src.some(s=>/\b(to hit|will reach|expected to reach|set to reach|reaches on|in \d+ days|due to reach|on track to reach)\b/i.test(clean(s.title+' '+s.snippet)));
  const alreadyClaim=/\b(now|already|currently|has reached|is one light.day away|now one light.day away)\b/i.test(a);
  if(forwardSource && alreadyClaim)add('future_milestone_potentially_presented_as_past','A linked source describes a future milestone but the answer may state it has already occurred');

  const policy=/(?:\bprop(?:osition)?\s*\d+\b|\bballot\b|\bvoters\b|\breferendum\b|\belection\b)/i.test(all)
    && /\b(tax|rates?|constitutional|permanent|voters|revenue|school|policy)\b/i.test(all);
  if(policy)add('election_or_tax_policy_timing','Ballot/tax-policy timing and effect require checking official primary material immediately before publication');
  if(/\b(science (?:backs|supports|proves)|(?:supported|backed|validated|proven) by science|scientifically proven|research proves|studies prove)\b/i.test(all))
    add('unsupported_science_generalization','A general scientific endorsement must be supported by appropriate research, not a celebrity interview');

  const cat=lower(item.editorial_category);
  if(cat==='science' && /\b(fitness|gym|walking|action.hero|workout|actor)\b/i.test(all)){
    correction.push({field:'editorial_category',from:item.editorial_category,to:'lifestyle'});
    item.editorial_category='lifestyle';
    add('category_needs_editorial_review','Reclassified a personal fitness item from science to lifestyle');
  }
  if(cat==='lifestyle' && policy){
    correction.push({field:'editorial_category',from:item.editorial_category,to:'world'});
    item.editorial_category='world';
  }

  const sportUpdate=/\b(lineup|rotation|minutes|one.game|doubtful|injury|injuries|to play|available to play|game against|bench)\b/i.test(all);
  if(cat==='sports' && sportUpdate)add('perishable_sports_lineup','Single-game injury and lineup updates are unsuitable for evergreen global questions','exclude');

  const localizedPersonal= (cat==='other'||cat==='entertainment') && (item.trend_regions||[]).length<=1
    && /\b(personal|leave|left|move|mallorca|marriage|relationship|returned|return to|divorce|homesickness)\b/i.test(all);
  if(localizedPersonal)add('limited_global_editorial_relevance','Local celebrity personal-life update does not clear broad global relevance test','exclude');

  const media=matchingVideo(item);
  if(item.youtube && !media.keep){
    item.youtube=null;
    correction.push({field:'youtube',from:'attached',to:'removed',reason:media.reason});
  }
  // Drop the stale video URL from the prebuilt, manual X-preview text.
  if(!item.youtube && typeof item.x_preview==='string')
    item.x_preview=item.x_preview.replace(/^🎥 https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}\n\n/m,'');

  // Final publication approval is NEVER granted by software: "review" means
  // eligible for an editor to examine, not "true" or "published".
  item.editorial_gate={version:VERSION,status,reasons,corrections:correction,
    readable_independent_domains:read.size,linked_independent_domains:domains.size,
    human_approval_required:true,approved:false,
    video_removed:!!media.reason};
  item.review_required=true; item.automated_x_eligible=false;
  return {id:item.id,question:item.question,category:item.editorial_category,status,reasons,corrections:correction,
    readable_independent_domains:read.size,linked_independent_domains:domains.size,
    video_removed:!!media.reason};
}

function renderIndex(data,audit){
  const counts=audit.summary;
  const rows=audit.items.map(x=>{
    const item=data.items.find(z=>z.id===x.id);
    const href=x.status==='review'?`<p><a href="${html(item.canonical_url)}">Open source-linked draft</a></p>`:'';
    const why=x.reasons.length?`<ul>${x.reasons.map(z=>`<li>${html(z.message)}</li>`).join('')}</ul>`:'<p>For manual source and copy review. Not approved for publishing.</p>';
    return `<article><div class="tag">${html(x.status.toUpperCase())} · ${html(x.category)}</div><h2>${html(x.question)}</h2>${why}${href}</article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>COSMOS — Editorial QA</title><style>body{font:16px/1.55 system-ui;background:#f6f7fa;color:#172534;margin:0}main{max-width:900px;margin:0 auto;padding:30px 20px}article,.intro{background:#fff;border:1px solid #dae2e7;border-radius:16px;padding:21px;margin:14px 0}h1{font-size:clamp(28px,5vw,42px);line-height:1.2}h2{font-size:21px}.tag{font-size:12px;letter-spacing:.12em;font-weight:800}ul{padding-left:22px}a{color:#165e92}</style></head><body><main><p>PTD TODAY / COSMOS</p><h1>Editorial quality review</h1><div class="intro"><strong>${counts.review} need editorial review · ${counts.hold} held for fact checking · ${counts.exclude} excluded</strong><p>Generated drafts are NOT fact-checked simply because a workflow passed. None are auto-approved or posted to X. Held and excluded pages are not published. This page is noindexed but may be visible to anyone who knows its URL.</p><small>Audit ${html(audit.generated_at)}</small></div>${rows}</main></body></html>`;
}

function run(){
  const data=readJson(REVIEW);
  if(data.generator_version!=='7.0.0'||!Array.isArray(data.items))throw Error('Expected existing v7.0 review data; refusing to change files.');
  const items=data.items.map(evaluate);
  const summary={total:items.length,review:items.filter(x=>x.status==='review').length,
    hold:items.filter(x=>x.status==='hold').length,exclude:items.filter(x=>x.status==='exclude').length,
    videos_removed:items.filter(x=>x.video_removed).length,approved:0};
  const audit={version:VERSION,generated_at:new Date().toISOString(),generator_version:data.generator_version,
    summary,items,note:'Deterministic risk screen, NOT a source-independent news fact-check. Every draft requires human approval; social posting disabled.'};
  // Fail closed on latest feed. JSON remains available for the editor to audit.
  // A separate deliberate approval process must populate live items later.
  const previousManifest=fs.existsSync(LATEST)?readJson(LATEST):{};
  const manifest={...previousManifest,generated_at:audit.generated_at,quality_gate_version:VERSION,
    review_candidates:items.filter(x=>x.status==='review').map(x=>({id:x.id,question:x.question,editorial_status:'review_required'})),
    items:[],publication_status:'blocked_pending_human_editorial_approval'};
  data.quality_gate_version=VERSION;
  data.policy={...(data.policy||{}),status:'editorial_quality_review_required',automatic_x_eligible:false,automatic_site_eligible:false,qa_not_independent_fact_check:true};
  data.quality_summary=summary;
  // Remove individual HTML and image assets for held/excluded drafts. The JSON
  // retains their complete text for audit. Never delete other site files.
  for(const x of items){
    if(x.status==='review')continue;
    const page=path.join('q','trends',x.id+'.html');
    const picture=path.join('assets','cosmos-global-cards',x.id+'.png');
    if(fs.existsSync(page))fs.unlinkSync(page);
    if(fs.existsSync(picture))fs.unlinkSync(picture);
  }
  writeJson(REVIEW,data); writeJson(LATEST,manifest);writeJson(AUDIT,audit);
  fs.mkdirSync(path.dirname(INDEX),{recursive:true});fs.writeFileSync(INDEX,renderIndex(data,audit));
  const lines=[`# COSMOS v${VERSION} — Editorial quality screen`,'',`Generated: ${audit.generated_at}`,
    `Drafts: ${summary.total} | Manual-review candidates: ${summary.review} | Held: ${summary.hold} | Excluded: ${summary.exclude} | Videos removed: ${summary.videos_removed}`,
    '', '**No draft is automatically approved or posted.**','',
    ...items.flatMap(x=>[`## ${x.question}`,`Status: **${x.status}**`,...x.reasons.map(r=>`- ${r.code}: ${r.message}`),
    ...x.corrections.map(c=>`- Correction: ${c.field} — ${c.reason||`${c.from} → ${c.to}`}`),''])];
  fs.writeFileSync(REPORT,lines.join('\n')+'\n');
  console.log(`COSMOS editorial gate ${VERSION}: ${summary.total} drafts; ${summary.review} for manual review, ${summary.hold} held, ${summary.exclude} excluded, ${summary.videos_removed} unrelated videos removed. 0 approved; 0 social posts.`);
  for(const x of items)console.log(`[${x.status.toUpperCase()}] ${x.question} | ${x.reasons.map(r=>r.code).join(',')||'manual_approval_required'}`);
}
run();
