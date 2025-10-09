/* PTD Today — minimal front-end
   - No filters. Shows today + yesterday (last 48h) from /data/news.json.
   - Single “Share” button: links to PTD article page, not the external source.
   - Thumbnails: story image if present, else publisher favicon via Google S2.
*/

(function(){
  const $  = (s, n=document)=>n.querySelector(s);
  const $$ = (s, n=document)=>[...n.querySelectorAll(s)];

  const RESULTS = $('#results');
  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');

  const cfg = (window.__PTD__ && window.__PTD__.endpoints) || {};
  const DATA_RECENT = cfg.recent || '/data/news.json';

  // Helpers
  const pick = (o, ks)=>ks.map(k=>o?.[k]).find(v=>v!==undefined && v!==null);
  const parseDate = v => v ? new Date(v) : null;
  const fmtDate = d => d
    ? d.toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,'Z').replace(/:\d\dZ$/,'Z')
    : '';
  const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return ''; } };

  function bestImage(item){
    if (item.image) return item.image;
    const d = item.publisher || domainOf(item.url);
    if (d) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`;
    return '/assets/og-default.png';
  }

  function normalize(raw){
    const title = pick(raw,['title','headline','name']) || '';
    const url   = pick(raw,['url','link','href']) || '#';
    const pdate = pick(raw,['published','date','time','pubDate','published_at']);
    const publisher = (pick(raw,['publisher','source','domain','site','site_name']) || '')
      .replace(/^https?:\/\/(www\.)?/,'').trim().toLowerCase();
    const category = pick(raw,['category','topic','section']) || '';
    const score = pick(raw,['score','rank','weight','hotness']);
    const image = pick(raw,['image','image_url','img','thumbnail','thumb']) || '';
    const d = parseDate(pdate) || null;
    const now = Date.now();
    const date = (d && d.getTime() > now) ? new Date(now) : d;
    return { title, url, publisher, category, date, score: (typeof score==='number'?score:null), image };
  }

  function articleUrl(item){
    const u = new URL('/article.html', location.origin);
    // pass through details for the article page
    u.searchParams.set('u', item.url);
    if (item.title)     u.searchParams.set('t', item.title);
    if (item.publisher) u.searchParams.set('p', item.publisher);
    if (item.category)  u.searchParams.set('c', item.category);
    if (item.image)     u.searchParams.set('img', item.image);
    if (item.date)      u.searchParams.set('d', item.date.toISOString());
    return u.toString();
  }

  function render(items){
    RESULTS.innerHTML='';
    if(!items || items.length===0){ RESULTS.style.display='none'; EMPTY.style.display='block'; return; }
    EMPTY.style.display='none'; RESULTS.style.display='grid';

    const frag = document.createDocumentFragment();
    items.forEach(item=>{
      const card = document.createElement('article');
      card.className = 'card';

      const metaBits = [];
      if(item.category) metaBits.push(item.category.toUpperCase());
      if(item.publisher) metaBits.push(item.publisher);
      if(item.date) metaBits.push(fmtDate(item.date));
      if(item.score!==null) metaBits.push('SCORE: '+Number(item.score).toFixed(3));
      const metaText = metaBits.join(' • ');

      const imgURL = bestImage(item);

      card.innerHTML = `
        <div class="thumb"><img loading="lazy" src="${imgURL}" alt=""></div>
        <div class="content">
          <div class="meta">${metaText}</div>
          <h3 class="headline"><a href="${articleUrl(item)}">${item.title}</a></h3>
          <div class="cta-row">
            <a class="btn" href="${articleUrl(item)}">Open Article</a>
            <a class="btn secondary" href="${item.url}" target="_blank" rel="noopener">Source</a>
            <button class="btn linkish share" data-url="${articleUrl(item)}">Share</button>
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
          if (navigator.share) {
            await navigator.share({ title, url });
          } else {
            await navigator.clipboard.writeText(url);
            btn.textContent = 'Copied';
            setTimeout(()=>btn.textContent='Share',1200);
          }
        } catch { /* ignore */ }
      });
    });
  }

  function setUpdated(d){
    const ts = d ? fmtDate(d) : fmtDate(new Date());
    UPDATED.textContent = 'Updated — ' + ts;
  }

  async function fetchJson(url){
    try {
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  }

  (async function boot(){
    setUpdated(new Date());
    const raw = await fetchJson(DATA_RECENT);
    const arr = (raw && (raw.items||raw.data||raw.stories||raw)) || [];
    let items = arr.map(normalize).filter(x=>x.title && x.url);

    // only today + yesterday (48h)
    const now = Date.now();
    items = items.filter(x => !x.date || (now - x.date.getTime()) <= 48*3600*1000);

    // sort by date desc (then score)
    items.sort((a,b)=>{
      const bd=(b.date?b.date.getTime():0), ad=(a.date?a.date.getTime():0);
      if (bd!==ad) return bd-ad;
      return (b.score??0) - (a.score??0);
    });

    // Update “Updated — …” using the freshest we kept
    const latest = items.reduce((m,x)=> (x.date && (!m || x.date>m)) ? x.date : m, null);
    setUpdated(latest || new Date());

    render(items);

    if(items.length===0){
      RESULTS.style.display='none';
      EMPTY.style.display='block';
      EMPTY.textContent='No stories found for the last 48 hours.';
    }
  })();

  // Optional PWA
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();