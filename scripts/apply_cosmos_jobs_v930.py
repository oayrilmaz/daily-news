#!/usr/bin/env python3
"""COSMOS v9.3.0 guarded frontend installer. Run from the GitHub repository root.
Source: the supplied 2026-11-09 ZIP. Does not change backend, D1, R2, authentication or secrets.
"""
import sys,hashlib,pathlib,tempfile,subprocess
from html.parser import HTMLParser
BASE_SHA256='df7e8ab3b0990c802f6c01fa41979422ed86d5f83cab62d77837af805419229e'
VERSION='cosmos-next-v9.3.0-jobs-ai-on-v9.2.9'
def replace_once(base,old,new,label):
 n=base.count(old)
 if n!=1:raise RuntimeError(f'{label}: expected one original section, found {n}. Aborting.')
 return base.replace(old,new,1)
mode=sys.argv[1] if len(sys.argv)>1 else 'validate'
if mode not in ('validate','apply'):raise SystemExit('Use validate or apply.')
path=pathlib.Path('cosmos-next.html')
raw=path.read_bytes()
h=raw.decode('utf-8')
if VERSION in h:
 print('ALREADY INSTALLED: '+VERSION)
 raise SystemExit(0)
actual=hashlib.sha256(raw).hexdigest()
if actual!=BASE_SHA256:
 raise SystemExit(f'BLOCKED: source SHA256 differs ({actual}). No files changed. Review newer changes before applying.')

# frontend browse filter
old='''            const internal=(listing.jobs||[]).filter(j=>!normalized||[j.title,j.organization,j.location,j.description].join(' ').toLowerCase().includes(normalized));'''
new='''            const localized=loc?await api('/api/business/jobs?location='+encodeURIComponent(loc)):listing;
            const internal=(localized.jobs||[]).filter(j=>!normalized||[j.title,j.organization,j.location,j.description].join(' ').toLowerCase().includes(normalized));'''
h=replace_once(h,old,new,'browse internal location filter')

# frontend card rendering / privacy note
old="""      ${withEvidence&&e?`<div class="cosmos-jobs-evidence"><strong>Documented overlap:</strong> ${escapeHtml(e.mentioned_in_both?.join(', ')||'No common skill phrases detected; manual review may still find a fit.')}
      <div class="business-note">Automated keywords are not a candidate score. Missing phrases do not prove missing ability.</div></div>`:''}"""
new="""      ${job.relevance?`<div class="cosmos-jobs-evidence"><strong>${escapeHtml(job.relevance.tier)}</strong>
        <div>${escapeHtml(job.relevance.reason||'Professional role context')}</div>
        <div class="business-note">${escapeHtml(job.relevance.note||'Opportunity discovery, not an employment decision.')}</div></div>`:''}
      ${withEvidence&&!job.relevance&&e?`<div class="cosmos-jobs-evidence"><strong>Documented evidence:</strong> ${escapeHtml(e.mentioned_in_both?.join(', ')||'Job requirements available in original listing.')}</div>`:''}"""
h=replace_once(h,old,new,'frontend card')
old="""  async function businessJobsUpload(type,element,after){
    const file=element.files?.[0];if(!file)return toastMsg('Choose a PDF, DOCX or TXT file.');
    const status=$('businessJobsUploadStatus');if(status)status.textContent='Uploading and extracting professional text…';"""
new="""  async function businessJobsUpload(type,element,after){
    const file=element.files?.[0];if(!file)return toastMsg('Choose a PDF, DOCX or TXT file.');
    const status=$('businessJobsUploadStatus');if(status)status.textContent=type==='resume'?'Uploading and preparing your private AI career assessment…':'Uploading and extracting professional text…';"""
h=replace_once(h,old,new,'upload wording')
old="""      toastMsg(result.note||'Document uploaded securely.');
      if(status)status.textContent=result.note||'Document uploaded.';"""
new="""      toastMsg(result.note||'Document uploaded securely.');
      if(status)status.textContent=result.note||'Document uploaded.';"""
# no change

old="""            <p class="business-note">Remote positions are available without setup. For broader US on-site and hybrid jobs, configure Adzuna API credentials on the COSMOS Life Worker.</p>"""
new="""            <p class="business-note">Worldwide search is the default. Jobicy currently provides recent remote vacancies; Adzuna adds its supported national markets only when configured. Coverage is not exhaustive.</p>"""
h=replace_once(h,old,new,'global browse wording')
old="""            <p>Upload a PDF, DOCX or TXT (up to 5 MB). COSMOS extracts text securely with Cloudflare. Files are private until you choose to apply.</p>"""
new="""            <p>Upload a PDF, DOCX or TXT (up to 5 MB). COSMOS automatically analyzes your work history and suggests relevant roles. Your original file and career assessment remain private until you explicitly apply.</p>"""
h=replace_once(h,old,new,'profile wording')
old="""            <label class="cosmos-jobs-check"><input type="checkbox" id="jobsResumeProcessConsent"> I understand COSMOS will store my document privately in Cloudflare and extract its text for skills matching. It is not shared with an employer unless I apply.</label>"""
new="""            <label class="cosmos-jobs-check"><input type="checkbox" id="jobsResumeProcessConsent"> I consent to COSMOS privately extracting and analyzing my professional résumé with Workers AI for career guidance and job discovery. The original résumé is not sent to external job providers or employers unless I explicitly apply.</label>"""
h=replace_once(h,old,new,'processing consent')
old="""            <div class="business-field"><label for="jobsTargetRole">Target position for external search (optional)</label>"""
new="""            <div id="jobsCareerAssessment" class="cosmos-jobs-card" role="region" aria-label="Private AI career assessment"><p class="business-note">Your AI career assessment will appear here when a résumé is selected.</p></div>
            <div class="business-field"><label for="jobsTargetRole">Target position for external search (optional)</label>"""
h=replace_once(h,old,new,'profile panel')
old="""            <div class="business-field"><label for="jobsTargetLocation">Preferred location (optional)</label>
              <input id="jobsTargetLocation" maxlength="90" placeholder="e.g. Raleigh, NC" value="${escapeHtml(businessJobsSearchLocation)}" /></div>"""
new="""            <div class="business-field"><label for="jobsTargetLocation">Preferred location — optional (blank = global)</label>
              <input id="jobsTargetLocation" maxlength="90" placeholder="Global / all available countries" value="${escapeHtml(businessJobsSearchLocation)}" /></div>"""
h=replace_once(h,old,new,'global location')
old="""            <p class="business-note">COSMOS shows all current openings without automatically rejecting or ranking applicants.</p></div>"""
new="""            <p class="business-note">COSMOS organizes opportunities by professional relevance. This is not an eligibility score or automated hiring decision. Global is the default; country/city filters narrow results on request.</p></div>"""
h=replace_once(h,old,new,'rank wording')

# introduce function to render structured private career guidance
old="""  async function openBusinessJobs(view='browse'){"""
new="""  function businessJobsCareerHtml(data){
    if(data?.status==='needs_text')return '<p>Add readable résumé text to enable career analysis.</p>';
    if(!data?.profile)return `<h3>Private AI career assessment</h3><p>AI assessment has not completed. Retry it to receive a professional summary and role-specific recommendations.</p>
      <button type="button" id="jobsRetryCareerAnalysis">Retry AI analysis</button>`;
    const p=data.profile;
    const list=(items)=>Array.isArray(items)?items.map(s=>`<li>${escapeHtml(s)}</li>`).join(''):'';
    return `<div class="business-eyebrow">PRIVATE · EVIDENCE-BASED CAREER OVERVIEW</div>
      <h3>${escapeHtml(p.headline||'Professional career assessment')}</h3><p>${escapeHtml(p.career_summary||'')}</p>
      ${p.leadership_scope?`<p><strong>Documented leadership:</strong> ${escapeHtml(p.leadership_scope)}</p>`:''}
      <h4>Closest role directions</h4><ul>${list(p.target_roles)}</ul>
      <h4>Documented strengths</h4><ul>${list(p.strengths)}</ul>
      <h4>Career development directions</h4><ul>${list(p.development_paths)}</ul>
      ${p.limitations?.length?`<p class="business-note">Assessment limitations: ${escapeHtml(p.limitations.join(' · '))}</p>`:''}
      <p class="business-note">Derived from your uploaded CV; not a hiring or eligibility decision. Verify the details and adjust your search terms as needed.</p>
      <button type="button" id="jobsRetryCareerAnalysis">Reanalyze this résumé</button>`;
  }
  async function openBusinessJobs(view='browse'){"""
h=replace_once(h,old,new,'profile helper')

# Replace the whole click handler with 3-way Promise.allSettled preserving internal-first UI.
start=h.index("          $('jobsRefreshMatches').onclick=async()=>{")
end=h.index("          // Automatically start internal-first matching",start)
old_handler=h[start:end]
new_handler=r'''          $('jobsRefreshMatches').onclick=async()=>{
            if(!selector.value)return toastMsg('Choose a résumé.');
            businessJobsResumeId=selector.value;
            const picked=resumes.find(d=>d.id===selector.value);
            if(picked?.parse_status!=='ready'){
              $('jobsResumeText').hidden=false;
              $('jobsResumeText').innerHTML=`<h3>Add your professional experience as text</h3>
                <p>We stored the document, but could not reliably extract its contents. Paste your experience for private career analysis.</p>
                <textarea id="jobsManualResume" rows="7" maxlength="48000" placeholder="Paste text from your résumé"></textarea>
                <button class="primary" id="jobsSaveResumeText">Save text & analyze career</button>`;
              $('jobsSaveResumeText').onclick=async()=>{try{await api('/api/business/jobs/documents/'+selector.value,{method:'PATCH',body:JSON.stringify({extracted_text:$('jobsManualResume').value})});await openBusinessJobs('matches');}catch(e){toastMsg(e.message);}};return;
            }
            const role=$('jobsTargetRole').value.trim(),location=$('jobsTargetLocation').value.trim();
            businessJobsSearchQuery=role;businessJobsSearchLocation=location;
            $('jobsMatches').innerHTML='<p role="status">Analyzing your CV and searching COSMOS first, then available global sources…</p>';
            const docId=selector.value;
            // Build a missing career profile first (for résumés uploaded before v9.3.0),
            // so both internal and external suggestions use the same completed assessment.
            let career;
            try{career={status:'fulfilled',value:await api('/api/business/jobs/career-profile?resume_id='+encodeURIComponent(docId))};}
            catch(e){career={status:'rejected',reason:e};}
            const [inside,outside]=await Promise.allSettled([
              api('/api/business/jobs/matches?resume_id='+encodeURIComponent(docId)+'&location='+encodeURIComponent(location)),
              api('/api/business/jobs/discover?q='+encodeURIComponent(role)+'&location='+encodeURIComponent(location)+'&resume_id='+encodeURIComponent(docId))
            ]);
            if(!$('jobsMatches')||selector.value!==docId)return;
            const careerData=career.status==='fulfilled'?career.value:null;
            const panel=$('jobsCareerAssessment');if(panel){
              panel.innerHTML=businessJobsCareerHtml(careerData);
              const retry=$('jobsRetryCareerAnalysis');if(retry)retry.onclick=async()=>{
                retry.disabled=true;panel.innerHTML='<p>Reanalyzing your professional résumé privately…</p>';
                try{await api('/api/business/jobs/career-profile',{method:'POST',body:JSON.stringify({resume_id:docId})});
                  if(selector.value===docId)$('jobsRefreshMatches')?.click();
                }catch(e){panel.innerHTML='<p role="alert">'+escapeHtml(e.message)+'</p><button id="jobsRetryCareerAnalysis">Retry analysis</button>';
                  $('jobsRetryCareerAnalysis').onclick=()=>{$('jobsRefreshMatches')?.click();};}
              };
            }
            const internal=inside.status==='fulfilled'?(inside.value.jobs||[]):[];
            internal.forEach(j=>businessJobsCache.set(j.id,j));
            const external=outside.status==='fulfilled'?(outside.value.external||[]):[];
            const providers=outside.status==='fulfilled'?(outside.value.providers||[]):[];
            const scope=location?'Requested region: '+location:'Global-first · available sources';
            $('jobsMatches').innerHTML=`<p class="business-note">${escapeHtml(scope)} · Internal COSMOS openings shown first; each group ordered by documented role relevance.</p>
              <h3 class="cosmos-job-group">1 · COSMOS openings</h3>${internal.map(j=>businessJobsCard(j,true)).join('')||'<div class="business-empty">No sufficiently relevant internal openings found.</div>'}
              <h3 class="cosmos-job-group">2 · External openings</h3>${external.map(j=>businessJobsCard(j,true)).join('')||'<div class="business-empty">No relevant external positions returned from currently available sources. Broader coverage needs additional providers.</div>'}
              <p class="business-note">Search coverage: ${escapeHtml(providers.map(p=>p.name+': '+(p.status==='ok'?p.count+' listings':p.status.replace('_',' '))).join(' · ')||'Provider status unavailable')}.</p>
              <p class="business-note">Only currently returned postings are displayed; verify availability and eligibility on each original listing. Only generic role search terms—not the uploaded document—are sent to external job providers.</p>`;
            businessJobsBindCards();
            if(career.status==='rejected'||inside.status==='rejected'||outside.status==='rejected')toastMsg('Some AI analysis or providers were unavailable; check coverage details.');
          };
'''
h=h[:start]+new_handler+h[end:]
# Avoid privacy leaks on browse? untouched.

h=replace_once(h,'<meta name="cosmos-build" content="cosmos-next-v9.2.9-source-corrected" />','<meta name="cosmos-build" content="cosmos-next-v9.3.0-jobs-ai-on-v9.2.9" />','frontend build marker')

if VERSION not in h:raise SystemExit('FAIL: new build marker missing.')
required=['cosmos929-origin-orb','cosmos929ShowRecentWork','jobsCareerAssessment','businessJobsCareerHtml','jobsRetryCareerAnalysis','/cosmos-market-business.html']
for marker in required:
 if marker not in h:raise SystemExit('FAIL: required application marker '+marker+' missing')
class _ScriptCollector(HTMLParser):
 def __init__(self):super().__init__();self.scripts=[];self.active=False;self.data=''
 def handle_starttag(self,name,attrs):
  if name=='script' and 'src' not in dict(attrs):self.active=True;self.data=''
 def handle_data(self,part):
  if self.active:self.data+=part
 def handle_endtag(self,name):
  if name=='script' and self.active:self.scripts.append(self.data);self.active=False
collector=_ScriptCollector();collector.feed(h)
if len(collector.scripts)<4:raise SystemExit('FAIL: unexpected number of JavaScript sections')
with tempfile.TemporaryDirectory() as tmp:
 for i,script in enumerate(collector.scripts):
  file=pathlib.Path(tmp)/f'script_{i}.js';file.write_text(script,encoding='utf-8')
  result=subprocess.run(['node','--check',str(file)],text=True,capture_output=True)
  if result.returncode:raise SystemExit('FAIL JavaScript syntax check #'+str(i)+'\n'+result.stderr)
print('PASS: core UI markers and',len(collector.scripts),'inline JavaScript syntax checks.')
if mode=='apply':
 path.write_text(h,encoding='utf-8')
 print('APPLIED: v9.3.0 Jobs into the existing v9.2.9 COSMOS source.')
else:
 print('VALIDATED: safe, guarded v9.3.0 Jobs patch can be applied without replacing the rest of COSMOS.')
