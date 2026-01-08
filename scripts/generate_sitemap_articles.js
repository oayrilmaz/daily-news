// scripts/generate_sitemap_articles.js
// Builds sitemap-articles.xml from briefs/daily-ai.json
// Includes /articles/<id>.html (and optionally /p/<id>.html if you use it)

import fs from "fs";
import path from "path";

const SITE = "https://ptdtoday.com";

function esc(s=""){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function main(){
  const input = path.join("briefs", "daily-ai.json");
  if(!fs.existsSync(input)){
    console.error("Missing briefs/daily-ai.json — cannot build sitemap-articles.xml");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(input, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lastmod = (payload.updated_at || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD

  const urls = [];
  for(const it of items){
    const id = (it.id || "").toString().trim();
    if(!id) continue;

    // Main SEO/share pages you generate
    urls.push(`${SITE}/articles/${encodeURIComponent(id)}.html`);

    // OPTIONAL: if you also keep /p/<id>.html share pages, uncomment:
    // urls.push(`${SITE}/p/${encodeURIComponent(id)}.html`);
  }

  // Deduplicate
  const uniq = Array.from(new Set(urls));

  const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniq.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${esc(lastmod)}</lastmod><changefreq>hourly</changefreq></url>`).join("\n")}
</urlset>
`;

  fs.writeFileSync("sitemap-articles.xml", xml, "utf8");
  console.log(`Wrote sitemap-articles.xml with ${uniq.length} URLs`);
}

main();