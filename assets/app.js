/* PTD Today — render Today+Yesterday articles + YouTube; unified Share. */
(function(){
  const $  = (s, n=document)=>n.querySelector(s);
  const $$ = (s, n=document)=>[...n.querySelectorAll(s)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');

  const endpoints = (window.__PTD__ && window.__PTD__.endpoints) || {};
  const DATA_RECENT = endpoints.recent || '/data/news.json';

  const parseDate = v => v ? new Date(v) : null;
  const fmtDate = d => d ? d.toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,'Z').replace(/:\d\dZ$/,'Z') : '';

  function domainOf(url){
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); }
    catch { return ''; }
  }

  function bestImage(item){
    if (item.image) return item.image;
    const d = item.publisher || domainOf(item.url);
    if (d) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
    return '/assets/og-default.png';
  }

  function normalize(raw){
    const title = String(raw.title||'').trim();
    const url   = String(raw.url||'').trim();
    const publisher = (raw.publisher||'').trim();
    const category  = (raw.category||'').trim();
    const type  = raw.type || 'article';
    const videoId = raw.videoId || '';
    const image = raw.image || '';
    const d = parseDate(raw.published);
    const now = Date.now();
    const date = (d && d.getTime() > now) ? new Date(now) : d;
    const share = raw.share || `/article.html?u=${encodeURIComponent(url)}`;
    const score = typeof raw.score==='number' ? raw.score : null;
    return { title, url, publisher, category, image, date, share, score, type, videoId };
  }

  function render(items){
    RESULTS.innerHTML='';
    if(!items || items.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No stories found for the last 48–60 hours.';
      return;
    }
    EMPTY.style.display='none';
    RESULTS.style.display='grid';

    const frag = document.createDocumentFragment();
    for(const item of items){
      const isVideo = item.type === 'video';
      const metaBits = [
        (item.category||'').toUpperCase(),
        item.publisher || domainOf(item.url),
        item.date ? fmtDate(item.date) : '',
        (item.score!=null) ? ('SCORE: '+Number(item.score).toFixed(3)) : ''
      ].filter(Boolean).join(' • ');

      const card = document.createElement('article'); card.className='card';
      card.innerHTML = `
        <div class="thumb ${isVideo ? 'is-video' : ''}">
          <img loading="lazy" src="${bestImage(item)}" alt="">
          ${isVideo ? '<span class="play-badge" aria-hidden="true">▶</span>' : ''}
        </div>
        <div class="content">
          <div class="meta">${metaBits}</div>
          <h3 class="headline"><a href="${item.share}">${item.title}</a></h3>
          <div class="cta-row">
            <a class="btn" href="${item.share}">${isVideo ? 'Watch' : 'Open Article'}</a>
            <a class="btn secondary" href="${item.url}" target="_blank" rel="noopener">${isVideo ? 'YouTube' : 'Source'}</a>
            <button class="btn linkish share" data-url="${item.share}">Share</button>
          </div>
        </div>
      `;
      frag.appendChild(card);
    }
    RESULTS.appendChild(frag);

    // Unified Share
    $$('.share', RESULTS).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const url = btn.getAttribute('data-url');
        try {
          if (navigator.share) await navigator.share({ title: 'PTD Today', url });
          else { await navigator.clipboard.writeText(url); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Share',1200); }
        } catch {}
      });
    });
  }

  function setUpdated(d){
    UPDATED.textContent = 'Updated — ' + (d ? fmtDate(d) : fmtDate(new Date()));
  }

  async function fetchJson(url){
    try{
      const r = await fetch(url, { cache:'no-store' });
      if(!r.ok) throw 0;
      return await r.json();
    }catch{
      return null;
    }
  }

  (async function boot(){
    setUpdated(new Date());
    const raw = await fetchJson(DATA_RECENT);
    if(!raw){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No data file yet. Waiting for the builder to publish /data/news.json';
      return;
    }

    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    let items = arr.map(normalize).filter(x=>x.title && x.url);

    // keep ~48–60 hours
    const now = Date.now();
    items = items.filter(x => !x.date || (now - x.date.getTime()) <= 60*3600*1000);

    items.sort((a,b)=>{
      const bd=(b.date?b.date.getTime():0), ad=(a.date?a.date.getTime():0);
      if(bd!==ad) return bd-ad;
      return (b.score??0) - (a.score??0);
    });

    const latest = items.reduce((m,x)=> (x.date && (!m || x.date>m)) ? x.date : m, null);
    setUpdated(latest || new Date());
    render(items);
  })();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();