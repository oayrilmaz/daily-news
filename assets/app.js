const DATA_URL = "/briefs/daily-ai.json";
const $ = (id) => document.getElementById(id);

function fmtUtc(iso){
  try { return new Date(iso).toUTCString().replace("GMT","UTC"); }
  catch { return iso || ""; }
}
function normalize(s){ return (s || "").toString().toLowerCase(); }
function escapeHtml(str){
  return (str ?? "").toString()
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function slugify(s){
  return normalize(s)
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/(^-|-$)/g,"")
    .slice(0,80) || "item";
}
function wordCount(text){
  const t = (text || "").toString().trim();
  if(!t) return 0;
  return t.split(/\s+/).length;
}
function readMins(text){
  const w = wordCount(text);
  const mins = Math.max(1, Math.round(w / 200));
  return `${mins} min read`;
}

function applySearch(items, q){
  q = normalize(q).trim();
  if(!q) return items;
  return items.filter(it=>{
    const hay = [
      it.title, it.dek, it.summary, it.body, it.category, it.region,
      ...(Array.isArray(it.tags) ? it.tags : [])
    ].map(normalize).join(" ");
    return hay.includes(q);
  });
}

function cardHtml(item){
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const created = item.created_at || item.createdAt || item.publishedAt || "";
  const kicker = [
    item.category ? item.category.toUpperCase() : "BRIEFING",
    item.region ? item.region.toUpperCase() : "GLOBAL",
    created ? fmtUtc(created) : ""
  ].filter(Boolean).join(" • ");

  const title = item.title || "Untitled";
  const dek = item.dek || item.summary || "";
  const body = item.body || "";

  const id = item.id || slugify(`${created}-${title}`);
  const shareUrl = `${location.origin}/index.html#${encodeURIComponent(id)}`;

  return `
    <article class="card" id="${escapeHtml(id)}" data-id="${escapeHtml(id)}" data-share="${escapeHtml(shareUrl)}">
      <div class="kicker">${escapeHtml(kicker)}</div>
      <h3 class="headline">${escapeHtml(title)}</h3>

      <div class="bylineRow">
        <span>By PTD Today Desk</span>
        <span class="dot">•</span>
        <span>${escapeHtml(readMins(body || dek))}</span>
      </div>

      ${dek ? `<p class="dek">${escapeHtml(dek)}</p>` : ""}

      <div class="actions">
        <button class="actionBtn" type="button" data-action="toggle">Read</button>
        <button class="actionBtn" type="button" data-action="share">Share</button>
      </div>

      <div class="bodyWrap">
        <div class="bodyCollapsed"></div>
        <div class="bodyExpanded">
          ${body ? `<p class="bodyText">${escapeHtml(body)}</p>` : `<p class="bodyText">No extended text available.</p>`}
        </div>
      </div>

      ${tags.length ? `<div class="tags">${tags.slice(0,14).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </article>
  `;
}

function render(payload, query=""){
  const updatedAt = payload.updated_at || payload.updatedAt || "";
  const dateUtc = payload.date_utc || payload.date || "";

  $("updatedLine").textContent = updatedAt ? `Updated — ${fmtUtc(updatedAt)}` : "Updated —";
  $("disclaimerLine").textContent =
    payload.disclaimer ||
    "Informational only — AI-assisted; may contain errors. Not investment or engineering advice.";

  $("datePill").textContent = `Date (UTC): ${dateUtc || "—"}`;

  const allItems = Array.isArray(payload.items) ? payload.items : [];
  const items = applySearch(allItems, query);

  $("countPill").textContent = `Items: ${items.length}`;

  $("feed").innerHTML = items.length
    ? items.map(cardHtml).join("")
    : `<div class="errorBox">No items matched your search.</div>`;

  // Expand if URL has #id
  const hash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if(hash){
    const el = document.getElementById(hash);
    if(el){
      el.classList.add("expanded");
      const btn = el.querySelector('[data-action="toggle"]');
      if(btn) btn.textContent = "Close";
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

async function doShare(title, url){
  try{
    if(navigator.share){
      await navigator.share({ title, url });
      return;
    }
  }catch(_){ /* ignore */ }

  try{
    await navigator.clipboard.writeText(url);
    alert("Link copied.");
  }catch(_){
    prompt("Copy this link:", url);
  }
}

async function load(){
  $("year").textContent = new Date().getFullYear();

  const res = await fetch(DATA_URL, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${DATA_URL} (${res.status})`);
  const payload = await res.json();

  render(payload, $("q").value);

  $("q").addEventListener("input", ()=>render(payload, $("q").value));

  $("feed").addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-action]");
    if(!btn) return;

    const card = e.target.closest(".card");
    if(!card) return;

    const action = btn.getAttribute("data-action");
    if(action === "toggle"){
      const expanded = card.classList.toggle("expanded");
      btn.textContent = expanded ? "Close" : "Read";
      if(expanded){
        history.replaceState(null, "", `#${encodeURIComponent(card.dataset.id)}`);
      }else{
        history.replaceState(null, "", location.pathname);
      }
      return;
    }

    if(action === "share"){
      const url = card.dataset.share || location.href;
      const h = card.querySelector(".headline")?.textContent || "PTD Today";
      await doShare(h, url);
    }
  });
}

$("btnRefresh").addEventListener("click", ()=>location.reload());
$("btnTop").addEventListener("click", ()=>window.scrollTo({top:0,behavior:"smooth"}));

load().catch(err=>{
  $("updatedLine").textContent = "Could not load briefing.";
  $("disclaimerLine").textContent = "";
  $("feed").innerHTML = `
    <div class="errorBox">
      <strong>Briefing not available yet.</strong><br/>
      Expected file: <code>${DATA_URL}</code><br/>
      <div style="margin-top:10px;color:#6b665c;">${escapeHtml(err.message || String(err))}</div>
    </div>`;
});