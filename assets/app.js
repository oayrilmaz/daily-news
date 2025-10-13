/* PTD Today — today+yesterday, articles + YouTube videos, short share links */
(function(){
  const $  = (s, n=document)=>n.querySelector(s);
  const $$ = (s, n=document)=>[...n.querySelectorAll(s)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');
  const cfg = (window.__PTD__ && window.__PTD__.endpoints) || {};
  const DATA_RECENT = cfg.recent || '/data/news.json';

  const pick = (o, ks)=>ks.map(k=>o?.[k]).find(v=>v!==undefined && v!==null);
  const parseDate = v => v ? new Date(v) : null;
  const fmtDate = d => d ? d.toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,'Z').replace(/:\d\dZ$/,'Z') : '';
  const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return ''; } };

  function bestImage(item){
    if (item.image) return item.image;
    const d = item.publisher || domainOf(item.url);
    if (d) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
    return '/assets/og-default.png';
  }

  function normalize(raw){
    const title = pick(raw,['title']) || '';
    const url   = pick(raw,['url']) || '#';
    const pdate = pick(raw,['published']);
    const publisher = (pick(raw,['publisher']) || '').replace(/^https?:\/\/(www\.)?/,'').trim().toLowerCase();
    const category = pick(raw,['category']) || '';
    const score = pick(raw,['score']);
    const image = pick(raw,['image']) || '';
    const share = pick(raw,['share']); // /s/<id>/
    const type  = pick(raw,['type']) || 'article';
    const videoId = pick(raw,['videoId']) || '';
    const d = parseDate(pdate) || null;
    const now = Date.now();
    const date = (d && d.getTime() > now) ? new Date(now) : d;
    return { title, url, publisher, category, date, score: (typeof score==='number'?score:null), image, share, type, videoId };
  }

  function render(items){
    RESULTS.innerHTML='';
    if(!items || items.length===0){ RESULTS.style.display='none'; EMPTY.style.display='block'; return; }
    EMPTY.style.display='none'; RESULTS.style.display='grid';

    const frag = document.createDocumentFragment();
    items.forEach(item=>{
      const shareUrl = item.share || `/article.html?u=${encodeURIComponent(item.url)}&t=${encodeURIComponent(item.title)}&p=${encodeURIComponent(item.publisher||'')}&c=${encodeURIComponent(item.category||'')}&img=${encodeURIComponent(item.image||'')}&d=${encodeURIComponent(item.date?item.date.toISOString():'')}`;
      const metaBits = [
        (item.category||'').toUpperCase(),
        item.publisher||'',
        item.date ? fmtDate(item.date) : '',
        (item.score!=null) ? ('SCORE: '+Number(item.score).toFixed(3)) : ''
      ].filter(Boolean).join(' • ');

      const isVideo = item.type === 'video';
      const ctaLabel = isVideo ? 'Watch' : 'Open Article';

      const card = document.createElement('article'); card.className='card';
      card.innerHTML = `
        <div class="thumb ${isVideo ? 'is-video' : ''}">
          <img loading="lazy" src="${bestImage(item)}" alt="">
          ${isVideo ? '<span class="play-badge" aria-hidden="true">▶</span>' : ''}
        </div>
        <div class="content">
          <div class="meta">${metaBits}</div>
          <h3 class="headline"><a href="${shareUrl}">${item.title}</a></h3>
          <div class="cta-row">
            <a class="btn" href="${shareUrl}">${ctaLabel}</a>
            <a class="btn secondary" href="${item.url}" target="_blank" rel="noopener">${isVideo ? 'YouTube' : 'Source'}</a>
            <button class="btn linkish share" data-url="${shareUrl}">Share</button>
          </div>
        </div>
      `;
      frag.appendChild(card);
    });
    RESULTS.appendChild(frag);

    // Unified Share
    $$('.share', RESULTS).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const url = btn.getAttribute('data-url');
        const title = 'PTD Today — Daily Energy & Power News';
        try {
          if (navigator.share) { await navigator.share({ title, url }); }
          else { await navigator.clipboard.writeText(url); btn.textContent='Copied'; setTimeout(()=>btn.textContent='Share',1200); }
        } catch {}
      });
    });
  }

  function setUpdated(d){
    const ts = d ? fmtDate(d) : fmtDate(new Date());
    UPDATED.textContent = 'Updated — ' + ts;
  }

  async function fetchJson(url){
    try{ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw 0; return await r.json(); }
    catch{ return null; }
  }

  (async function boot(){
    setUpdated(new Date());
    const raw = await fetchJson(DATA_RECENT);
    const arr = (raw && (raw.items||raw.data||raw.stories||raw)) || raw || [];
    let items = arr.map(normalize).filter(x=>x.title && x.url);

    // last 48h
    const now = Date.now();
    items = items.filter(x => !x.date || (now - x.date.getTime()) <= 48*3600*1000);

    // sort newest first
    items.sort((a,b)=>{
      const bd=(b.date?b.date.getTime():0), ad=(a.date?a.date.getTime():0);
      if(bd!==ad) return bd-ad;
      return (b.score??0) - (a.score??0);
    });

    const latest = items.reduce((m,x)=> (x.date && (!m || x.date>m)) ? x.date : m, null);
    setUpdated(latest || new Date());
    render(items);

    if(items.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No stories found for the last 48 hours.';
    }
  })();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();
