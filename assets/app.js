/* PTD Today front-end logic — final complete file
   - Loads /data/news.json and /data/7d.json (or /data/news_7d.json)
   - ALL = last 72h from the UNION of both files
   - TOP(7d) = last 7 days from the UNION, sorted by score/date
   - Clicking “All” clears any topic filter so everything shows
   - Category inference: Grid, Substations, Protection, Cables, HVDC, Renewables, Policy, AI, Data Centers, Transport, Equipment, Lead Times
   - Thumbnails with placeholder
   - LinkedIn share popup + Copy Link
   - Ignores future-dated items from feeds
*/

(function(){
  /* ---------------- DOM helpers ---------------- */
  const $  = (sel, node=document)=>node.querySelector(sel);
  const $$ = (sel, node=document)=>[...node.querySelectorAll(sel)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');

  const YEAR_EL = $('#yr');
  if (YEAR_EL) YEAR_EL.textContent = String(new Date().getFullYear());

  /* ---------------- Endpoints ---------------- */
  const cfg = (window.__PTD__ && window.__PTD__.endpoints) || {};
  const DATA_RECENT = cfg.recent || '/data/news.json';
  const TOP7D_CANDIDATES = cfg.top7dCandidates || ['/data/7d.json','/data/news_7d.json'];

  /* ---------------- Category canonicalization ---------------- */
  const CANON = {
    'GRID':'Grid','SUBSTATION':'Substations','SUBSTATIONS':'Substations',
    'PROTECTION':'Protection','CABLE':'Cables','CABLES':'Cables',
    'HVDC':'HVDC','RENEWABLE':'Renewables','RENEWABLES':'Renewables',
    'POLICY':'Policy','AI':'AI',
    'DATA CENTER':'Data Centers','DATA CENTERS':'Data Centers',
    'DATACENTER':'Data Centers','DATACENTERS':'Data Centers','DC':'Data Centers',
    'TRANSPORT':'Transport','EQUIPMENT':'Equipment',
    'LEAD TIME':'Lead Times','LEAD TIMES':'Lead Times'
  };
  const toCanon = (val='')=>{
    if(!val) return '';
    const key = String(val).trim().toUpperCase();
    if (CANON[key]) return CANON[key];
    const singular = key.replace(/S$/,'');
    return CANON[singular] || (val && val[0].toUpperCase()+val.slice(1));
  };

  /* ---------------- Utilities ---------------- */
  const parseDate = v => v ? new Date(v) : null;
  const fmtDate = d => d
    ? d.toISOString()
      .replace('T',' ')
      .replace(/:\d\d\.\d{3}Z$/,'Z')
      .replace(/:\d\dZ$/,'Z')
    : '';

  const pick = (o, ks)=>ks.map(k=>o?.[k]).find(v=>v!==undefined && v!==null);

  function inferCategory(title='', url=''){
    const s=(String(title)+' '+String(url)).toLowerCase();
    if(/\bhvdc\b/.test(s)) return 'HVDC';
    if(/substation|iec 61850|bay control/.test(s)) return 'Substations';
    if(/protection relay|distance protection|iec 60255|fault|arc ?flash/.test(s)) return 'Protection';
    if(/cable|xlpe|subsea|hvac cable/.test(s)) return 'Cables';
    if(/renewable|solar|wind|pv|geothermal|green hydrogen/.test(s)) return 'Renewables';
    if(/policy|ferc|doe|nrel|commission|regulat/.test(s)) return 'Policy';
    if(/\bai\b|machine learning|genai|llm|foundation model/.test(s)) return 'AI';
    if(/data ?center|hyperscale|colocation|coreweave|cooling/.test(s)) return 'Data Centers';
    if(/transport|transit|rail|port|shipping|ev fleet|charging/.test(s)) return 'Transport';
    if(/transformer|breaker|switchgear|statcom|smes|synch(?:ronous)? condenser|equipment/.test(s)) return 'Equipment';
    if(/lead time|backlog|supply chain|delivery time|order book|capacity constraints/.test(s)) return 'Lead Times';
    if(/grid|transmission|distribution|miso|pjm|ercot|substation/.test(s)) return 'Grid';
    return '';
  }

  // Normalize one item (flexible keys)
  const normalize = raw => {
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
    if (!cat) cat = inferCategory(title, url) || 'Grid';

    // Guard against future-dated feed items
    const d = parseDate(pdate) || null;
    const now = Date.now();
    const date = (d && d.getTime() > now) ? new Date(now) : d;

    return {
      title: String(title).trim(),
      url: String(url).trim(),
      publisher,
      category: cat,
      date,
      score: (typeof score==='number'? score : null),
      image: (image && String(image).trim()) || ''
    };
  };

  // Fallback score (newer = higher)
  function fallbackScore(item){
    if (typeof item.score === 'number') return item.score;
    if (!item.date) return 0;
    const ageH = Math.max(1, (Date.now() - item.date.getTime())/36e5);
    return 10 / ageH;
  }

  // Image placeholder (SVG)
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

  /* ---------------- Share helpers ---------------- */
  function openLinkedInShare(url){
    const u = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    window.open(u, '_blank', 'noopener,noreferrer,width=720,height=640');
  }

  /* ---------------- Rendering ---------------- */
  const renderList = items=>{
    RESULTS.innerHTML='';
    if(!items || items.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      return;
    }
    EMPTY.style.display='none';
    RESULTS.style.display='grid';

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
          btn.textContent='Copied';
          setTimeout(()=>btn.textContent='Copy Link',1200);
        }catch(e){}
      });
    });
  };

  /* ---------------- State & filtering ---------------- */
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
        const as=fallbackScore(a), bs=fallbackScore(b);
        if(bs!==as) return bs-as;
        return bd-ad;
      }
      return bd-ad || (fallbackScore(b)-fallbackScore(a));
    });

    renderList(list);
  };

  // Clicking a tab
  const setActiveTab = tab=>{
    activeTab=tab;

    // IMPORTANT: “All” must clear topic filters so everything shows.
    if(tab==='all'){ activeTopic=''; }

    // Update UI selection
    $$('.pill[data-tab]').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===tab ? 'true' : 'false'));
    $$('.pill[data-filter]').forEach(b=>b.setAttribute('aria-selected', b.dataset.filter===activeTopic ? 'true' : 'false'));

    // Update URL
    const qp = new URLSearchParams(location.search);
    qp.set('tab', tab);
    if(activeTopic) qp.set('topic', activeTopic); else qp.delete('topic');
    history.replaceState(null,'','?'+qp.toString());

    filterAndRender();
  };

  // Clicking a topic pill
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

  /* ---------------- Data loading & shaping ---------------- */
  const setUpdated = d => UPDATED.textContent = 'Updated — ' + (d ? fmtDate(d) : fmtDate(new Date()));

  async function fetchJson(url){
    try{ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw 0; return await r.json(); }
    catch{ return null; }
  }

  async function loadTopRaw(){
    for(const u of TOP7D_CANDIDATES){
      const j = await fetchJson(u);
      if(j) return j;
    }
    return null;
  }

  // Merge + dedupe by URL (fallback to title|publisher)
  function dedupeMerge(arrA, arrB){
    const out=[]; const seen=new Set();
    const add = it=>{
      if(!it || !it.title || !it.url) return;
      const key = (it.url || '').trim() || (it.title+'|'+(it.publisher||''));
      if(seen.has(key)) return;
      seen.add(key); out.push(it);
    };
    arrA.forEach(add); arrB.forEach(add);
    return out;
  }

  const SEVEN_D_MS = 7*24*3600*1000;
  const RECENT_MS  = 72*3600*1000;

  function clampWindow(items, ms){
    const now = Date.now();
    return items.filter(x=> !x.date || (now - x.date.getTime()) <= ms);
  }

  function deriveUpdated(items, meta){
    const now = new Date();
    if(meta){ const d=new Date(meta); if(!Number.isNaN(d.getTime()) && d<=now) return d; }
    const latest = items.reduce((m,x)=> (x.date && x.date<=now && (!m || x.date>m)) ? x.date : m, null);
    return latest || now;
  }

  (async function boot(){
    setUpdated(new Date()); // provisional timestamp

    const [recentRaw, topRaw] = await Promise.all([ fetchJson(DATA_RECENT), loadTopRaw() ]);

    // Accept various shapes: {items:[]}, {data:[]}, []…
    const recentArr = (recentRaw && (recentRaw.items||recentRaw.data||recentRaw.stories||recentRaw)) || [];
    const topArr    = (topRaw    && (topRaw.items   ||topRaw.data   ||topRaw.stories   ||topRaw))    || [];

    // Normalize both lists
    let R = recentArr.map(normalize).filter(x=>x.title && x.url);
    let T = topArr.map(normalize).filter(x=>x.title && x.url);

    // Remove any future-dated items (feeds sometimes do this)
    const now = Date.now();
    const noFuture = it => (!it.date || it.date.getTime() <= now);
    R = R.filter(noFuture);
    T = T.filter(noFuture);

    // UNION ensures we’re not limited by a single JSON’s timespan
    const UNION = dedupeMerge(R, T);

    // Build views
    ALL_ITEMS = clampWindow(UNION, RECENT_MS);   // last 72h
    TOP_ITEMS = clampWindow(UNION, SEVEN_D_MS);  // last 7 days

    // If "All" is empty but 7d has items, show 7d by default
    if(ALL_ITEMS.length===0 && TOP_ITEMS.length>0) activeTab='top7d';

    // Deep-link support
    const qp = new URLSearchParams(location.search);
    const qTab = qp.get('tab');
    const qTopic = qp.get('topic');
    if(qTab && (qTab==='all'||qTab==='top7d')) activeTab=qTab;
    if(qTopic) activeTopic=toCanon(qTopic);

    // Reflect selection UI
    $$('.pill[data-tab]').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===activeTab ? 'true' : 'false'));
    $$('.pill[data-filter]').forEach(b=>b.setAttribute('aria-selected', b.dataset.filter===activeTopic ? 'true' : 'false'));

    // Updated timestamp: prefer meta from files, else latest in current view
    const metaUpdated = (recentRaw && (recentRaw.updated||recentRaw.lastUpdated)) || (topRaw && (topRaw.updated||topRaw.lastUpdated));
    setUpdated(deriveUpdated(activeTab==='top7d' ? TOP_ITEMS : ALL_ITEMS, metaUpdated));

    // Initial paint
    filterAndRender();

    // Final guard if absolutely nothing came through
    if(ALL_ITEMS.length===0 && TOP_ITEMS.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No stories found (check /data/news.json and /data/7d.json).';
    }
  })();

  /* ---------------- PWA (optional) ---------------- */
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();