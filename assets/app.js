/* PTD Today — 2-column layout (masonry by HEIGHT):
   Left: Videos then Articles continue immediately
   Right: Articles
   Articles are placed one-by-one into the currently shorter column,
   so the right column never “runs out” (even when videos make the left taller).
*/
(function(){
  const $  = (s, n=document)=>n.querySelector(s);
  const $$ = (s, n=document)=>[...n.querySelectorAll(s)];

  const GRID          = $('#ptdGrid');
  const VIDEOS_EL     = $('#videos');
  const ARTS_LEFT_EL  = $('#articlesLeft');
  const ARTS_RIGHT_EL = $('#articlesRight');
  const RESULTS_FALLBACK = $('#results');

  const EMPTY   = $('#empty');
  const UPDATED = $('#updated');

  const endpoints   = (window.__PTD__ && window.__PTD__.endpoints) || {};
  const DATA_RECENT = endpoints.recent || '/data/news.json';

  const parseDate = v => v ? new Date(v) : null;
  const fmtDate = d => d
    ? d.toISOString()
       .replace('T',' ')
       .replace(/:\d\d\.\d{3}Z$/,'Z')
       .replace(/:\d\dZ$/,'Z')
    : '';

  function domainOf(url){
    try { return new URL(url).hostname.replace(/^www\./,'').toLowerCase(); }
    catch { return ''; }
  }

  // We only show thumbs for video on the homepage
  function bestImage(item){
    if (item.type === 'video' && item.image) return item.image;
    return '';
  }

  function normalize(raw){
    const title = String(raw.title||'').trim();
    const url   = String(raw.url||'').trim();
    const publisher = (raw.publisher||'').trim();
    const category  = (raw.category||'').trim();
    const type      = raw.type || 'article';
    const videoId   = raw.videoId || '';
    const image     = raw.image || '';
    const d         = parseDate(raw.published);
    const now       = Date.now();
    const date      = (d && d.getTime() > now) ? new Date(now) : d;
    const score     = typeof raw.score==='number' ? raw.score : null;

    // internal page
    const share = (raw.share && String(raw.share).trim())
      ? String(raw.share).trim()
      : `/article.html?u=${encodeURIComponent(url)}`;

    return { title, url, publisher, category, image, date, score, type, videoId, share };
  }

  function setUpdated(d){
    if (!UPDATED) return;
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

  function clearContainers(){
    if (VIDEOS_EL) VIDEOS_EL.innerHTML = '';
    if (ARTS_LEFT_EL) ARTS_LEFT_EL.innerHTML = '';
    if (ARTS_RIGHT_EL) ARTS_RIGHT_EL.innerHTML = '';
    if (RESULTS_FALLBACK) RESULTS_FALLBACK.innerHTML = '';
  }

  function showEmpty(msg){
    if (GRID) GRID.setAttribute('aria-busy','false');
    if (EMPTY){
      EMPTY.style.display = 'block';
      EMPTY.textContent = msg || 'No stories found.';
    }
    if (VIDEOS_EL) VIDEOS_EL.style.display = 'none';
    if (ARTS_LEFT_EL) ARTS_LEFT_EL.style.display = 'none';
    if (ARTS_RIGHT_EL) ARTS_RIGHT_EL.style.display = 'none';
    if (RESULTS_FALLBACK) RESULTS_FALLBACK.style.display = 'none';
  }

  function hideEmpty(){
    if (EMPTY) EMPTY.style.display = 'none';
    if (VIDEOS_EL) VIDEOS_EL.style.display = '';
    if (ARTS_LEFT_EL) ARTS_LEFT_EL.style.display = '';
    if (ARTS_RIGHT_EL) ARTS_RIGHT_EL.style.display = '';
  }

  function buildCard(item){
    const isVideo = item.type === 'video';

    const metaBits = [
      (item.category||'').toUpperCase(),
      item.publisher || domainOf(item.url),
      item.date ? fmtDate(item.date) : '',
      (item.score!=null) ? ('SCORE: '+Number(item.score).toFixed(3)) : ''
    ].filter(Boolean).join(' • ');

    const card = document.createElement('article');
    card.className = 'card';

    const thumbHtml = (isVideo && bestImage(item))
      ? `<div class="thumb is-video">
           <img loading="lazy" src="${bestImage(item)}" alt="">
           <span class="play-badge" aria-hidden="true">▶</span>
         </div>`
      : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="content">
        <div class="meta">${metaBits}</div>
        <h3 class="headline">
          <a href="${item.share}">${item.title}</a>
        </h3>
        <div class="cta-row">
          <a class="btn" href="${item.share}">${isVideo ? 'Watch' : 'Open Article'}</a>
          <a class="btn secondary" href="${item.url}" target="_blank" rel="noopener">
            ${isVideo ? 'YouTube' : 'Source'}
          </a>
          <button class="btn linkish share" data-share="${item.share}">Share</button>
        </div>
      </div>
    `;

    const btn = card.querySelector('.share');
    if (btn){
      btn.addEventListener('click', async () => {
        const rel = btn.getAttribute('data-share') || '/';
        const fullUrl = new URL(rel, window.location.href).toString();
        try {
          if (navigator.share) {
            await navigator.share({ title: 'PTD Today', url: fullUrl });
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(fullUrl);
            const old = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(() => { btn.textContent = old; }, 1200);
          }
        } catch (e) {}
      });
    }

    return card;
  }

  function renderVideos(videos){
    if (!VIDEOS_EL) return;
    VIDEOS_EL.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const v of videos) frag.appendChild(buildCard(v));
    VIDEOS_EL.appendChild(frag);
  }

  // ✅ True fix: Masonry distribute by current rendered HEIGHT
  function renderArticlesMasonry(articles){
    if (!ARTS_LEFT_EL || !ARTS_RIGHT_EL) return;

    ARTS_LEFT_EL.innerHTML = '';
    ARTS_RIGHT_EL.innerHTML = '';

    // Important: LEFT column height includes VIDEOS section (above articlesLeft).
    // We'll measure the column containers themselves, not just the article lists.
    const leftCol  = ARTS_LEFT_EL.parentElement;   // .ptd-col (contains videos + articlesLeft)
    const rightCol = ARTS_RIGHT_EL.parentElement;  // .ptd-col--right

    // If parent elements aren't found, fallback to alternating
    const canMeasure = leftCol && rightCol && typeof leftCol.getBoundingClientRect === 'function';

    const appendOne = (node) => {
      if (!canMeasure){
        // fallback
        if (ARTS_RIGHT_EL.childElementCount <= ARTS_LEFT_EL.childElementCount) ARTS_RIGHT_EL.appendChild(node);
        else ARTS_LEFT_EL.appendChild(node);
        return;
      }

      // Force a reflow-friendly measurement:
      // Put the next card into whichever column is currently shorter.
      const leftH  = leftCol.getBoundingClientRect().height;
      const rightH = rightCol.getBoundingClientRect().height;

      if (rightH <= leftH) ARTS_RIGHT_EL.appendChild(node);
      else ARTS_LEFT_EL.appendChild(node);
    };

    // Build + append progressively so height decisions are real.
    // This is slightly more work but fixes your exact “right column empty” issue.
    for (const a of articles){
      const node = buildCard(a);
      appendOne(node);
    }
  }

  (async function boot(){
    setUpdated(new Date());
    clearContainers();
    if (GRID) GRID.setAttribute('aria-busy','true');

    const raw = await fetchJson(DATA_RECENT);
    if (!raw){
      showEmpty('No data file yet. Waiting for the builder to publish /data/news.json');
      return;
    }

    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    let items = arr.map(normalize).filter(x => x.title && x.url);

    // Keep roughly last 48–60 hours
    const now = Date.now();
    items = items.filter(x => !x.date || (now - x.date.getTime()) <= 60 * 3600 * 1000);

    if (!items.length){
      showEmpty('No stories found for the last 48–60 hours.');
      return;
    }

    // Sort newest first, then by score
    items.sort((a,b)=>{
      const bd=(b.date?b.date.getTime():0), ad=(a.date?a.date.getTime():0);
      if(bd!==ad) return bd-ad;
      return (b.score??0) - (a.score??0);
    });

    const latest = items.reduce((m,x)=> (x.date && (!m || x.date>m)) ? x.date : m, null);
    setUpdated(latest || new Date());

    const articles = items.filter(x => x.type !== 'video');
    const videos   = items.filter(x => x.type === 'video');

    hideEmpty();

    const hasNewLayout = VIDEOS_EL && ARTS_LEFT_EL && ARTS_RIGHT_EL;
    if (hasNewLayout){
      renderVideos(videos);

      // Wait one frame so video heights are in the DOM before masonry placement
      requestAnimationFrame(() => {
        renderArticlesMasonry(articles);
        if (GRID) GRID.setAttribute('aria-busy','false');
      });
      return;
    }

    // Fallback to single list if needed
    if (RESULTS_FALLBACK){
      const frag = document.createDocumentFragment();
      for (const x of items) frag.appendChild(buildCard(x));
      RESULTS_FALLBACK.innerHTML = '';
      RESULTS_FALLBACK.appendChild(frag);
      RESULTS_FALLBACK.style.display = 'grid';
      if (GRID) GRID.setAttribute('aria-busy','false');
      return;
    }

    showEmpty('Layout containers not found in HTML.');
  })();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
})();