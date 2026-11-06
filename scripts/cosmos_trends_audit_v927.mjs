/**
 * COSMOS v9.2.7 – read-only publishing / public-feed health audit.
 * Does not access secrets, user records, private editorial passages, or network.
 * Does not change or publish anything. Node >=20.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const PUB = 'data/cosmos-approved-moments.json';
const TIMELINE = 'data/cosmos-public-timeline.json';
const STATUS = 'data/cosmos-auto-publication-status.json';
const OUT = 'artifacts/cosmos-trends-audit-v927';
const read = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const dateUtc = s => {
  const d = new Date(s ?? '');
  return Number.isFinite(d.valueOf()) ? d.toISOString().slice(0,10) : null;
};
function dateNy(s) {
  const d = new Date(s ?? '');
  if (!Number.isFinite(d.valueOf())) return null;
  const fields = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(d);
  const f = Object.fromEntries(fields.map(x => [x.type,x.value]));
  return `${f.year}-${f.month}-${f.day}`;
}
const collection = v => Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
const tally = (arr, dateKey) => {
  const out = {};
  for (const x of arr) {
    const d = dateKey(x.published_at || x.created_at);
    if (d) out[d] = (out[d] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,14));
};
const cleanId = s => typeof s === 'string' && /^global-[a-z0-9-]{8,120}$/.test(s);
function audit(approvedData, timelineData, statusData) {
  const approved = collection(approvedData).filter(x => cleanId(x?.id) &&
    (x.publication_status === 'published' || x.publication_status === undefined));
  const publicFeed = collection(timelineData).filter(x => cleanId(x?.id) &&
    x.visibility === 'public' && x.type === 'cosmos_editorial_question');
  const approvedIds = new Set(approved.map(x=>x.id));
  const feedIds = new Set(publicFeed.map(x=>x.id));
  const missingFromFeed = [...approvedIds].filter(x=>!feedIds.has(x));
  const unmatchedFeed = [...feedIds].filter(x=>!approvedIds.has(x));
  const latestDate = new Date().toISOString().slice(0,10);
  const result = {
    audit_utc:new Date().toISOString(),
    data_presence: { approved_registry: approvedData!==null, public_feed:timelineData!==null,
      last_run_status:statusData!==null },
    approved_total:approved.length,
    timeline_total:publicFeed.length,
    approved_by_utc_day:tally(approved,dateUtc),
    visible_by_utc_day:tally(publicFeed,dateUtc),
    visible_by_new_york_day:tally(publicFeed,dateNy),
    today_utc:latestDate,
    today_approved_utc:approved.filter(x=>dateUtc(x.published_at)===latestDate).length,
    today_visible_utc:publicFeed.filter(x=>dateUtc(x.published_at)===latestDate).length,
    missing_from_public_feed_count:missingFromFeed.length,
    missing_from_public_feed_ids:missingFromFeed.slice(0,25),
    unmatched_feed_count:unmatchedFeed.length,
    last_publishing_run:statusData && typeof statusData==='object' ? {
      run_at:statusData.run_at||null, mode:statusData.mode||null,
      drafted:statusData.drafted??null, selected:statusData.selected??null,
      published:statusData.published??null, skipped:statusData.skipped??null,
      autopublish_enabled:statusData.autopublish_enabled??null,
      pending_git_push:statusData.publication_pending_git_push??null,
    } : null,
    notes:[
      'This inspects the GitHub main-branch snapshot; it cannot independently verify CDN freshness or the current production Worker.',
      'The last-run status only reports aggregate skipped counts; detailed skip reasons are in the PRIVATE GitHub Actions run artifact.',
      'Public Metro filters by a selected day; it does not show every trending Google query.',
      'The approved registry is the source of published articles; the public feed is a distinct delivery step.',
      'No private user records or email addresses were accessed.'
    ]
  };
  return result;
}
function markdown(r) {
  const lines=['# COSMOS v9.2.7 — Trends publishing audit','',`Generated: ${r.audit_utc}`,'',
    '| Check | Count |','|---|---:|',
    `| Approved published questions | ${r.approved_total} |`,
    `| Public timeline entries | ${r.timeline_total} |`,
    `| Approved but missing from public feed | ${r.missing_from_public_feed_count} |`,
    `| UTC today: approved | ${r.today_approved_utc} |`,
    `| UTC today: visible | ${r.today_visible_utc} |`,'',
    '## Visible by New York local day','', '| Day | Public questions |','|---|---:|'];
  for (const [k,v] of Object.entries(r.visible_by_new_york_day)) lines.push(`| ${k} | ${v} |`);
  lines.push('', '## Last publication run', '', '```json',JSON.stringify(r.last_publishing_run,null,2),'```','',
    '## Missing approved IDs in feed','', r.missing_from_public_feed_ids.join('\n') || 'None', '',
    '## Notes','', ...r.notes.map(s=>`- ${s}`), '');
  return lines.join('\n');
}
function selfTest() {
  const a={items:[{id:'global-alpha-12345678',published_at:'2026-11-05T01:00:00Z',publication_status:'published'},
    {id:'global-beta-12345678',published_at:'2026-11-05T13:00:00Z',publication_status:'published'}]};
  const t={public_only:true,items:[{id:'global-alpha-12345678',published_at:'2026-11-05T01:00:00Z',visibility:'public',type:'cosmos_editorial_question'}]};
  const r=audit(a,t,{mode:'live',drafted:7,selected:1,skipped:6});
  assert.equal(r.approved_total,2); assert.equal(r.timeline_total,1);
  assert.equal(r.missing_from_public_feed_count,1);
  assert.equal(r.visible_by_new_york_day['2026-11-04'],1);
  assert.equal(r.last_publishing_run.skipped,6);
  console.log('COSMOS v9.2.7 offline audit self-test PASS');
}
if (process.argv.includes('--self-test')) selfTest();
else {
  const result=audit(read(PUB),read(TIMELINE),read(STATUS));
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,'report.md'),markdown(result));
  console.log(markdown(result));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown(result)+'\n');
  if (!result.data_presence.approved_registry || !result.data_presence.public_feed)
    console.warn('WARNING: A required publishing file is missing in this repo snapshot. Inspect generation workflow.');
}
