/* PTD Today front-end logic — refined
   - Loads /data/news.json (recent) and /data/7d.json (top) — with fallback to /data/news_7d.json
   - Normalizes/infer categories including Transport, Equipment, Lead Times, AI
   - Deep-link tabs via ?tab=top7d&topic=AI
   - Thumbnails with fallback SVG
   - Share: LinkedIn popup + Copy Link fallback
   - Honest "No stories found"
   - Correct 7-day window (ignores future-dated items)
*/

(function(){
  const $  = (sel, node=document)=>node.querySelector(sel);
  const $$ = (sel, node=document)=>[...node.querySelectorAll(sel)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');
  $('#yr').textContent = String(new Date().getFullYear());

  // Data endpoints (top7d tries both names to match your repo)
  const DATA_RECENT = '/data/news.json';
  const TOP7D_CANDIDATES = ['/data/7d.json','/data/news_7d.json'];

  // Category canonicalization (adds Transport, Equipment, Lead Times)
  const CANON = {
    'GRID':'Grid','SUBSTATION':'Substations','SUBSTATIONS':'Substations',
    'PROTECTION':'Protection','CABLE':'Cables','CABLES':'Cables',
    'HVDC':'HVDC','RENEWABLE':'Renewables','RENEWABLES':'Renewables',
    'POLICY':'Policy','AI':'AI',
    'DATA CENTER':'Data Centers','DATA CENTERS':'Data Centers',
    'DATACENTER':'Data Centers','DATACENTERS':'Data Centers','DC':'Data Centers',
    'TRANSPORT':'Transport','EQUIPMENT':'Equipment','LEAD TIME':'Lead Times','LEAD TIMES':'Lead Times'
  };

  const toCanon = (val='')=>{
    if(!val) return '';
    const key = String(val).trim().toUpperCase();
    if (CANON[key]) return CANON[key];
    const singular = key.replace(/S$/,'');
    return CANON[singular] || (val && val[0].toUpperCase()+val.slice(1));
  };

  const parseDate = v => v ? new Date(v) : null;

  // Format ISO without duplicating Z (renders "... HH:MMZ")
  const fmtDate = d => {
    if(!d) return '';
    return d.toISOString()
      .replace('T',' ')
      .replace(/:\d\d\.\d{3}Z$/,'Z')
      .replace(/:\d\dZ$/,'Z');
  };

  const pick = (obj, keys)=>keys.map(k=>obj?.[k]).find(v=>v!==undefined && v!==null);

  // Fallback category inference from the title/url if the feed didn't supply a good one
  function inferCategoryFromTitle(title='', url='') {
    const s = (String(title)+' '+String(url)).toLowerCase();
    if (/\bhvdc\b/.test(s)) return 'HVDC';
    if (/substation|iec 61850|bay control/.test(s)) return 'Substations';
    if (/protection relay|distance protection|iec 60255|fault|arc flash/.test(s)) return 'Protection';
    if (/cable|xlpe|subsea|hvac cable/.test(s)) return 'Cables';
    if (/renewable|solar|wind|pv|geothermal|green hydrogen/.test(s)) return 'Renewables';
    if (/policy|ferc|doe|nrel|commission|regulat/.test(s)) return 'Policy';
    if (/\bai\b|machine learning|genai|llm|foundation model/.test(s)) return 'AI';
    if (/data ?center|hyperscale|colocation|coreweave|cooling/.test(s)) return 'Data Centers';
    if (/transport|transit|rail|port|shipping|ev fleet|charging/.test(s)) return 'Transport';
    if (/transformer|breaker|switchgear|statcom|smes|synchronous condenser|equipment/.test(s)) return 'Equipment';
    if (/lead time|backlog|supply chain|delivery time|order book|capacity constraints/.test(s)) return 'Lead Times';
    if (/grid|transmission|distribution|miso|pjm|ercot|substation/.test(s)) return 'Grid';
    return '';
  }

  // Normalize incoming item to our internal shape
  const normalize = (raw)=>{
    const title = pick(raw,['title','headline','name']) || '';
    const url   = pick(raw,['url','link','href']) || '#';
    const publisher = (pick(raw,['publisher','source','domain','site','site_name']) || '')
      .replace(/^https?:\/\/(www\.)?/,'').trim().toLowerCase();
    const categoryRaw = pick(raw,['category','topic','section','tags']) || '';
    const pdate = pick(raw,['published','date','time','pubDate','published_at']);
    const score = pick(raw,['score','rank','weight','hotness']);
    const image = pick(raw,['image','image_url','img','thumbnail','thumb']);

    let cat='';
    if (Array.isArray(categoryRaw))      cat = toCanon(categoryRaw[0]||'');
    else if (typeof categoryRaw==='string') cat = toCanon(categoryRaw.split(/[,\|/]/)[0]);
    if (!cat) cat = inferCategoryFromTitle(title, url) || 'Grid';

    // Guard against future-dated items from feeds
    const d = parseDate(pdate) || null;
    const now = Date.now();
    const date = (d && d.getTime() > now) ? new Date(now) : d;

    return {
      title: String(title).trim(),
      url: String(url).trim(),
      publisher,
      category: cat || '',
      date: date,
      score: (typeof score==='number'? score : null),
      image: (image && String(image).trim()) || ''
    };
  };

  // Placeholder SVG
  const placeholderSVG = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
       <rect width='100%' height='100%' fill='#e8ddcb'/>
       <g fill='#6f675d' font-family='Georgia,serif' font-size='14'>
         <text x='50%' y='46%' text-anchor='middle'>PTD</text>
         <text x='50%' y='60%' text-anchor='middle'>No Image</text>
       </g>
     </svg>`
  );

  const escapeHtml = s=>String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');

  const sourceHomepage = item => item.publisher ? ('https://' + item.publisher.replace(/\/.+$/,'')) : (item.url || '#');

  // Share helpers
  function openLinkedInShare(url){
    const u = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    window.open(u, '_blank', 'noopener,noreferrer,width=720,height=640');
  }

  // Render
  const renderList = items=>{
    RESULTS.innerHTML='';
    if(!items || items.length===0){ RESULTS.style.display='none'; EMPTY.style.display='block'; return; }
    EMPTY.style.display='none'; RESULTS.style.display='grid';

    const frag=document.createDocumentFragment();
    items.forEach(item=>{
      const card=document.createElement('article'); card.className='card';
      const metaBits=[];
      if(item.category) metaBits.push(item.category.toUpperCase());
      if(item.publisher) metaBits.push(item.publisher);
      if(item.date) metaBits.push(fmtDate(item.date));
      if(item.score!==null) metaBits.push('SCORE: '+Number(item.score).toFixed(3));
      const metaText = metaBits.join(' • ');

      const imgHTML = item.image
        ? `<img loading="lazy" src="${escapeHtml(item.image)}" alt="">`
        : `<img src="data:image/svg+xml,${placeholderSVG}" alt="">`;

      card.innerHTML = `
        <div class="thumb">${imgHTML}</div>
        <div class="content">
          <div class="meta">${escapeHtml(metaText)}</div>
          <h3 class="headline"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
          <div class="cta-row">
            <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open on PTD Today</a>
            <a class="btn secondary" href="${sourceHomepage(item)}" target="_blank" rel="noopener">Source</a>
            <button class="btn linkish share-li" data-url="${encodeURIComponent(item.url)}">LinkedIn</button>
            <button class="btn linkish share-copy" data-url="${encodeURIComponent(item.url)}">Copy Link</button>
          </div>
        </div>
      `;

      frag.appendChild(card);
    });
    RESULTS.appendChild(frag);

    // Share bindings
    $$('.share-li', RESULTS).forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const url = decodeURIComponent(btn.getAttribute('data-url'));
        openLinkedInShare(url);
      });
    });
    $$('.share-copy', RESULTS).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        try{
          const url = decodeURIComponent(btn.getAttribute('data-url'));
          await navigator.clipboard.writeText(url);
          btn.textContent = 'Copied';
          setTimeout(()=>btn.textContent='Copy Link',1200);
        }catch(e){}
      });
    });
  };

  // State
  let ALL_ITEMS=[], TOP_ITEMS=[], activeTab='all', activeTopic='';

  const filterAndRender = ()=>{
    const base = (activeTab==='top7d') ? TOP_ITEMS : ALL_ITEMS;
    let list = base;

    if(activeTopic){
      list = list.filter(x=> (x.category||'').toLowerCase()===activeTopic.toLowerCase());
    }

    list = list.slice().sort((a,b)=>{
      const ad=a.date? a.date.getTime():0, bd=b.date? b.date.getTime():0;
      if(activeTab==='top7d'){
        const as=(a.score??-999), bs=(b.score??-999);
        if(bs!==as) return bs-as;
        return bd-ad;
      }
      return bd-ad || ((b.score??-999)-(a.score??-999));
    });

    renderList(list);
  };

  const setActiveTab = tab=>{
    activeTab=tab;
    $$('.pill[data-tab]').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===tab ? 'true' : 'false'));
    const qp = new URLSearchParams(location.search);
    qp.set('tab', tab);
    if(activeTopic) qp.set('topic', activeTopic); else qp.delete('topic');
    history.replaceState(null,'','?'+qp.toString());
    filterAndRender();
  };

  const setActiveTopic = topic=>{
    activeTopic = topic || '';
    $$('.pill[data-filter]').forEach(b=>b.setAttribute('aria-selected', b.dataset.filter===activeTopic ? 'true' : 'false'));
    const qp = new URLSearchParams(location.search);
    if(activeTopic) qp.set('topic', activeTopic); else qp.delete('topic');
    qp.set('tab', activeTab||'all');
    history.replaceState(null,'','?'+qp.toString());
    filterAndRender();
  };

  $('#tabs').addEventListener('click', ev=>{
    const b = ev.target.closest('.pill'); if(!b) return;
    if(b.dataset.tab) setActiveTab(b.dataset.tab);
    else if(b.dataset.filter) setActiveTopic(b.dataset.filter);
  });

  const setUpdated = d => UPDATED.textContent = 'Updated — ' + (d ? fmtDate(d) : fmtDate(new Date()));

  async function loadJson(url){
    try{ const res = await fetch(url, {cache:'no-store'}); if(!res.ok) throw new Error('HTTP '+res.status); return await res.json(); }
    catch(e){ console.error('Fetch failed for', url, e); return null; }
  }

  async function loadTop7d(){
    for(const u of TOP7D_CANDIDATES){
      const j = await loadJson(u);
      if(j) return j;
    }
    return null;
  }

  const deriveUpdated = (arr, metaUpdated)=>{
    const now = new Date();
    if(metaUpdated){
      const d = new Date(metaUpdated);
      if(!Number.isNaN(d.getTime()) && d <= now) return d;
    }
    const latest = arr.reduce((m,x)=> (x.date && x.date<=now && (!m || x.date>m)) ? x.date : m, null);
    return latest || now;
  };

  (async function boot(){
    const qp = new URLSearchParams(location.search);
    const qTab = qp.get('tab');
    const qTopic = qp.get('topic');

    setUpdated(new Date()); // provisional

    const [recentRaw, topRaw] = await Promise.all([ loadJson(DATA_RECENT), loadTop7d() ]);
    const recentArr = (recentRaw && (recentRaw.items||recentRaw.data||recentRaw.stories||recentRaw)) || [];
    const topArr    = (topRaw    && (topRaw.items   ||topRaw.data   ||topRaw.stories   ||topRaw))    || [];

    // Normalize
    const now = Date.now();
    ALL_ITEMS = recentArr.map(normalize).filter(x=>x.title && x.url && (!x.date || x.date.getTime()<=now));
    TOP_ITEMS = topArr.map(normalize).filter(x=>x.title && x.url && (!x.date || x.date.getTime()<=now));

    // If your 7d file actually contains >7 day items, we still respect it.
    // But for safety, filter to last 7d here as a guard:
    const SEVEN_D_MS = 7*24*3600*1000;
    const cutoff = Date.now() - SEVEN_D_MS;
    TOP_ITEMS = TOP_ITEMS.filter(x=> !x.date || x.date.getTime() >= cutoff);

    if(ALL_ITEMS.length===0 && TOP_ITEMS.length>0) activeTab='top7d';
    if(qTab && (qTab==='all'||qTab==='top7d')) activeTab=qTab;
    if(qTopic) activeTopic=toCanon(qTopic);

    $$('.pill[data-tab]').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===activeTab ? 'true' : 'false'));
    $$('.pill[data-filter]').forEach(b=>b.setAttribute('aria-selected', b.dataset.filter===activeTopic ? 'true' : 'false'));

    const metaUpdated = (recentRaw && (recentRaw.updated||recentRaw.lastUpdated)) || (topRaw && (topRaw.updated||topRaw.lastUpdated));
    setUpdated(deriveUpdated(activeTab==='top7d'?TOP_ITEMS:ALL_ITEMS, metaUpdated));

    filterAndRender();

    if(ALL_ITEMS.length===0 && TOP_ITEMS.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No stories found (check /data/news.json and /data/7d.json).';
    }
  })();

  // Optional PWA registration (safe no-op if missing)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();