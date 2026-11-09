/** COSMOS v9.2.8: add ONLY supported public category/region metadata to public timeline.
 *  Reads already-published, public registry records. Does not generate or publish questions.
 *  Does not read personal COSMOS, Jobs, D1, emails, or credentials.
 */
import fs from 'node:fs';
const REG='data/cosmos-approved-moments.json',FEED='data/cosmos-public-timeline.json';
const mode=process.argv[2]||'validate';
if(!['validate','apply'].includes(mode))throw Error('Use validate or apply');
if(!fs.existsSync(REG)||!fs.existsSync(FEED)){
 console.log('Metadata enrichment skipped: no published public registry or feed present yet.');process.exit(0);
}
const reg=JSON.parse(fs.readFileSync(REG,'utf8'));
const f=JSON.parse(fs.readFileSync(FEED,'utf8'));
if(!Array.isArray(reg.items)||f.public_only!==true||!Array.isArray(f.items))throw Error('Unexpected public registry/feed structure; refusing change.');
const entries=new Map(reg.items.filter(x=>x.publication_status==='published'&&/^global-[a-z0-9-]{8,120}$/.test(x.id||''))
 .map(x=>[x.id,x]));
let changes=0, tagged=0;
for(const x of f.items){
 if(!x||x.visibility!=='public'||x.type!=='cosmos_editorial_question')throw Error('Nonpublic record in public feed: stop.');
 const r=entries.get(x.id);if(!r)continue;
 const regions=Array.isArray(r.regions)?[...new Set(r.regions.map(v=>String(v||'').toUpperCase()).filter(v=>/^[A-Z]{2}$/.test(v)))].slice(0,25):[];
 if(regions.length)tagged++;
 if(regions.length&&JSON.stringify(x.regions||[])!==JSON.stringify(regions)){x.regions=regions;changes++;}
 const cat=String(r.category||'').trim().slice(0,60);
 if(cat&&cat!==x.category){x.category=cat;changes++;}
}
console.log('Public metadata inspection:',f.items.length,'records;',tagged,'with supported region tags;',changes,'field changes.');
if(mode==='apply'&&changes){fs.writeFileSync(FEED,JSON.stringify(f,null,2)+'\n');console.log('Public metadata enriched: no private records copied.');}
