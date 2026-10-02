import fs from "node:fs";

const endpoint = "https://api.indexnow.org/indexnow";
const host = "ptdtoday.com";
const keyFile = process.env.INDEXNOW_KEY_FILE || "indexnow-key.txt";
const key = String(process.env.INDEXNOW_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8") : "")).trim();
const keyLocation = `https://${host}/${keyFile.replace(/^\.\//, "")}`;

if (!key) throw new Error("IndexNow key is missing.");
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error("IndexNow key format is invalid.");

const files = process.argv.slice(2).map(v => v.trim()).filter(Boolean);
const urls = [...new Set(files.map(fileToUrl).filter(Boolean))].slice(0, 10000);

function fileToUrl(file) {
  const normalized = String(file).replace(/^\.\//, "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith(".")) return null;
  if (!/\.html$/i.test(normalized)) return null;

  if (normalized === "index.html") return `https://${host}/`;
  return `https://${host}/${normalized.split("/").map(encodeURIComponent).join("/").replace(/%2F/gi, "/")}`;
}

if (!urls.length) {
  console.log("IndexNow: no changed public HTML URLs to submit.");
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation, urlList: urls })
});

const body = await response.text();
if (![200, 202].includes(response.status)) {
  throw new Error(`IndexNow ${response.status}: ${body.slice(0, 1200)}`);
}

console.log(`IndexNow accepted ${urls.length} URL(s) with status ${response.status}.`);
for (const url of urls) console.log(` - ${url}`);
