/* PTD Today front-end logic (with B1+B2 timestamp fixes)
   - Loads /data/news.json (recent) and /data/7d.json (top)
   - Normalizes fields and categories
   - Deep-link tabs via ?tab=top7d&topic=HVDC
   - Thumbnails with fallback SVG
   - Honest "No stories found"
*/

(function(){
  const $  = (sel, node=document)=>node.querySelector(sel);
  const $$ = (sel, node=document)=>[...node.querySelectorAll(sel)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');
  $('#yr').textContent = String(new Date().getFullYear());

  // Data endpoints
  const DATA_RECENT = '/data/news.json';
  const DATA_TOP7D  = '/data/7d.json';

  // Category canonicalization
  const CANON = {
    'GRID':'Grid','SUBSTATION':'Substations','SUBSTATIONS':'Substations',
    'PROTECTION':'Protection','CABLE':'Cables','CABLES':'Cables',
    'HVDC':'HVDC','RENEWABLE':'Renewables','RENEWABLES':'Renewables',
    'POLICY':'Policy','AI':'AI',
    'DATA CENTER':'Data Centers','DATA CENTERS':'Data Centers',
    'DATACENTER':'Data Centers','DATACENTERS':'Data Centers','DC':'Data Centers'
  };
  const toCanon = (val='')=>{
    if(!val) return '';
    const key = String(val).trim().toUpperCase();
    return CANON[key] || CANON[key.replace(/S$/,'')] || (val && val[0].toUpperCase()+val.slice(1));
  };

  const parseDate = v => v ? new Date(v) : null;

  // B2 — format ISO without duplicating Z (renders "... HH:MMZ")
  const fmtDate = d => {
    if(!d) return '';
    // "2025-10-07T09:32:00.000Z" -> "2025-10-07 09:32Z"
    return d.toISOString()
      .replace('T',' ')
      .replace(/:\d\d\.\d{3}Z$/,'Z')   // drop milliseconds
      .replace(/:\d\dZ$/,'Z');         // ensure single trailing Z
  };

  const pick = (obj, keys)=>keys.map(k=>obj?.[k]).find(v=>v!==undefined && v!==null);

  // Normalize story objects from varied sources
  const normalize = raw=>{
    const title = pick(raw,['title','headline','name']) || '';
    const url   = pick(raw,['url','link','href']) || '#';
    const publisher = (pick(raw,['publisher','source','domain','site','site_name']) || '')
      .replace(/^https?:\/\/(www\.)?/,'').trim();
    const categoryRaw = pick(raw,['category','topic','section','tags']) || '';
    const pdate = pick(raw,['published','date','time','pubDate','published_at']);
    const score = pick(raw,['score','rank','weight','hotness']);
    const image = pick(raw,['image','image_url','img','thumbnail','thumb']);

    let cat='';
    if (Array.isArray(categoryRaw))      cat = toCanon(categoryRaw[0]||'');
    else if (typeof categoryRaw==='string') cat = toCanon(categoryRaw.split(/[,\|/]/)[0]);

    return {
      title:String(title).trim(),
      url:String(url).trim(),
      publisher,
      category:cat||'',
      date: parseDate(pdate) || null,
      score: (typeof score==='number'? score : null),
      image: (image && String(image).trim()) || ''
    };
  };

  // Placeholder SVG for images
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

  const sourceLink = item => item.publisher
    ? 'https://' + item.publisher.replace(/^https?:\/\//,'').replace(/\/.+$/,'')
    : (item.url || '#');

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
      if(item.publisher) metaBits.push(item.publisher.toLowerCase());
      // B1 — do NOT append 'Z' here; fmtDate already returns "...Z"
      if(item.date) metaBits.push(fmtDate(item.date));
      if(item.score!==null) metaBits.push('SCORE: '+Number(item.score).toFixed(3));
      const metaText = metaBits.join(' • ');

      const imgHTML = item.image
        ? `<img loading="lazy" src="${escapeHtml(item.image)}" alt="">`
        : `<div class="ph">No Image</div>`;

      card.innerHTML = `
        <div class="thumb">${imgHTML}</div>
        <div class="content">
          <div class="meta">${escapeHtml(metaText)}</div>
          <h3 class="headline"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
          <div class="cta-row">
            <a class="btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open on PTD Today</a>
            <a class="btn secondary" href="${sourceLink(item)}" target="_blank" rel="noopener">Source</a>
            <button class="btn linkish" data-share='${encodeURIComponent(JSON.stringify({title:item.title,url:item.url}))}'>Share</button>
          </div>
        </div>
      `;

      const imgEl = card.querySelector('img');
      if(imgEl){
        imgEl.addEventListener('error', ()=>{
          card.querySelector('.thumb').innerHTML = `<img src="data:image/svg+xml,${placeholderSVG}" alt="">`;
        });
      }else{
        card.querySelector('.thumb').innerHTML = `<img src="data:image/svg+xml,${placeholderSVG}" alt="">`;
      }

      frag.appendChild(card);
    });
    RESULTS.appendChild(frag);

    $$('.btn.linkish', RESULTS).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        try{
          const data = JSON.parse(decodeURIComponent(btn.getAttribute('data-share')));
          if(navigator.share) await navigator.share({title:data.title, url:data.url});
          else { await navigator.clipboard.writeText(data.url); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Share',1200); }
        }catch(e){}
      });
    });
  };

  // State
  let ALL_ITEMS=[], TOP_ITEMS=[], activeTab='all', activeTopic='';

  const filterAndRender = ()=>{
    const base = (activeTab==='top7d') ? TOP_ITEMS : ALL_ITEMS;
    let list = base;
    if(activeTopic){ list = list.filter(x=> (x.category||'').toLowerCase()===activeTopic.toLowerCase()); }

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

  // B1 — no extra 'Z' appended here
  const setUpdated = d => UPDATED.textContent = 'Updated — ' + (d ? fmtDate(d) : fmtDate(new Date()));

  async function loadJson(url){
    try{ const res = await fetch(url, {cache:'no-store'}); if(!res.ok) throw new Error('HTTP '+res.status); return await res.json(); }
    catch(e){ console.error('Fetch failed for', url, e); return null; }
  }

  const deriveUpdated = (arr, metaUpdated)=>{
    if(metaUpdated){ const d = new Date(metaUpdated); if(!Number.isNaN(d.getTime())) return d; }
    const latest = arr.reduce((m,x)=> (x.date && (!m || x.date>m)) ? x.date : m, null);
    return latest || new Date();
  };

  (async function boot(){
    const qp = new URLSearchParams(location.search);
    const qTab = qp.get('tab');
    const qTopic = qp.get('topic');

    setUpdated(new Date());

    const [recentRaw, topRaw] = await Promise.all([ loadJson(DATA_RECENT), loadJson(DATA_TOP7D) ]);
    const recentArr = (recentRaw && (recentRaw.items||recentRaw.data||recentRaw.stories||recentRaw)) || [];
    const topArr    = (topRaw    && (topRaw.items   ||topRaw.data   ||topRaw.stories   ||topRaw))    || [];

    ALL_ITEMS = recentArr.map(normalize).filter(x=>x.title && x.url);
    TOP_ITEMS = topArr.map(normalize).filter(x=>x.title && x.url);

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

  // Optional PWA registration (safe no-op if file missing)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();