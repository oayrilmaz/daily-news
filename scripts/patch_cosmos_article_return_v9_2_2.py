#!/usr/bin/env python3
"""COSMOS v9.2.2 — Return from a public article to the central Metro timeline.

This additive and repeat-safe patch updates:
  1. scripts/cosmos_autonomous_publish_v7_4.mjs (the publishing template)
  2. Existing PUBLISHED q/trends/global-*.html articles (not editorial previews)

It does not touch authentication, membership, Cloudflare, My/Connections/Business,
private moments, source citations, or the public distribution workflow.

From the repository root:
  python3 scripts/patch_cosmos_article_return_v9_2_2.py --check
  python3 scripts/patch_cosmos_article_return_v9_2_2.py --apply
"""
from pathlib import Path
import argparse
import sys

VERSION = 'COSMOS ARTICLE RETURN v9.2.2'
ROOT = Path.cwd()
GENERATOR = ROOT / 'scripts/cosmos_autonomous_publish_v7_4.mjs'
ARTICLES = ROOT / 'q/trends'

# Static link works when the article was opened from anywhere. Returning to
# Metro requires no token, account ID, user data or authenticated API call.
# For a same-tab hop from the central timeline, browser Back restores the
# previous selected day/scroll position when the browser retained the page.
RETURN_URL = '/cosmos-next.html'

CSS = '''
/* COSMOS ARTICLE RETURN v9.2.2: always accessible on mobile and desktop. */
.cosmos-article-return-top {position:sticky;top:0;z-index:50;
 margin:12px 0 22px;padding:10px 0;
 background:rgba(249,250,251,.96);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
 border-bottom:1px solid #dbe3ea}
.cosmos-article-return-bottom {margin:34px 0 12px;padding:22px 0;
 border-top:1px solid #dbe3ea;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.cosmos-article-return-top a,.cosmos-article-return-bottom a {
 display:inline-flex;align-items:center;justify-content:center;
 min-height:48px;padding:10px 18px;border-radius:999px;
 text-decoration:none!important;font-weight:750;font-size:15px;line-height:1.35;
 background:#193347;color:#fff!important;border:1px solid #193347;
 box-shadow:0 2px 6px rgba(18,42,58,.10)}
.cosmos-article-return-top a:focus-visible,.cosmos-article-return-bottom a:focus-visible {
 outline:3px solid #2082b8;outline-offset:3px}
@media(max-width:640px){.cosmos-article-return-top{margin:8px -4px 16px;padding:6px 4px}
.cosmos-article-return-top a,.cosmos-article-return-bottom a{width:100%;max-width:100%;font-size:16px}}
'''

TOP = '<div class="cosmos-article-return-top" id="cosmos-article-return-v922"><a href="/cosmos-next.html" data-cosmos-return>← Back to COSMOS Timeline</a></div>'
BOTTOM = '<footer class="cosmos-article-return-bottom"><a href="/cosmos-next.html" data-cosmos-return>← Back to COSMOS Timeline</a></footer>'
JS = '''<script id="cosmos-article-return-script-v922">
/* COSMOS ARTICLE RETURN v9.2.2: same-browser navigation, never forces login. */
(function(){
  'use strict';
  document.addEventListener('click',function(event){
    var link=event.target.closest && event.target.closest('a[data-cosmos-return]');
    if(!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      var prev=new URL(document.referrer);
      var backToMetro=prev.origin===location.origin &&
        (prev.pathname==='/cosmos-next.html' || prev.pathname==='/cosmos-next');
      if(backToMetro && history.length>1){
        event.preventDefault();
        history.back();
      }
    }catch(_e){ /* Missing/foreign referrer: use normal href fallback. */ }
  });
})();
</script>'''


def fail(message):
    sys.exit('STOP (no changes written): ' + message)


def inspect_generator(code):
    begin = code.find('function page(rec)')
    end = code.find('function indexPage(', begin + 1)
    if begin < 0 or end < 0 or end <= begin:
        fail('Cannot identify the v8 publishing article template; generator layout changed.')
    chunk = code[begin:end]
    if VERSION in chunk:
        if chunk.count('id="cosmos-article-return-v922"') != 1 or \
           chunk.count('cosmos-article-return-script-v922') != 1 or \
           chunk.count('class="cosmos-article-return-bottom"') != 1:
            fail('Partial existing article-return installation in generator.')
        return None
    for needle in ('</style>', '</nav><p class="muted">', '</main></body></html>'):
        if chunk.count(needle) != 1:
            fail('Expected v8 article-template anchor missing or repeated: ' + needle)
    return begin, end, chunk


def patch_generator(code):
    anchors = inspect_generator(code)
    if anchors is None:
        return code, False
    begin,end,chunk = anchors
    chunk = chunk.replace('</style>', '\n' + CSS + '\n</style>', 1)
    chunk = chunk.replace('</nav><p class="muted">', '</nav>' + TOP + '<p class="muted">', 1)
    chunk = chunk.replace('</main></body></html>', BOTTOM + '</main>' + JS + '</body></html>', 1)
    result = code[:begin] + chunk + code[end:]
    if result.count('id="cosmos-article-return-v922"') != 1:
        fail('Unexpected generator insertion count.')
    return result, True


def eligible_article(html):
    # Published articles are indexed and source-linked; review-only drafts
    # must be left untouched. No published article content is changed.
    return ('<meta name="robots" content="index,follow">' in html and
            '<main>' in html and '</main>' in html and
            ('Published through automated editorial checks.' in html or
             'Source-linked · AI-assisted' in html))


def patch_article(html):
    if 'id="cosmos-article-return-v922"' in html:
        if html.count('id="cosmos-article-return-v922"') != 1 or \
            html.count('cosmos-article-return-script-v922') != 1 or \
            html.count('class="cosmos-article-return-bottom"') != 1:
            fail('Partially modified published article found; manual review required.')
        return html,False
    if not eligible_article(html):
        return html,False
    if html.count('</head>')!=1 or html.count('<main>')!=1 or html.count('</main>')!=1 or html.count('</body>')!=1:
        fail('A published article has an unexpected document structure.')
    html=html.replace('</head>', '<style id="cosmos-article-return-style-v922">'+CSS+'</style></head>',1)
    html=html.replace('<main>', '<main>'+TOP,1)
    html=html.replace('</main>', BOTTOM+'</main>',1)
    html=html.replace('</body>', JS+'</body>',1)
    return html,True


def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true',help='Verify anchors; do not write')
    mode.add_argument('--apply',action='store_true',help='Install the reversible additive patch')
    args=parser.parse_args()

    if not GENERATOR.is_file() or not ARTICLES.is_dir():
        fail('Run at daily-news repository root; generator or q/trends folder is missing.')

    original=GENERATOR.read_text(encoding='utf-8')
    new_gen,gen_change=patch_generator(original)
    candidate_updates={}
    published_count=0
    for file in sorted(ARTICLES.glob('global-*.html')):
        original_html=file.read_text(encoding='utf-8')
        if eligible_article(original_html):
            published_count+=1
        revised,changed=patch_article(original_html)
        if changed:
            candidate_updates[file]=revised

    # Collect and validate every change before writing anything.
    if args.check:
        print(f'PASS: generator compatible; {published_count} published articles identified; '
              f'{len(candidate_updates)} need the navigation patch. No files changed.')
        return

    if gen_change:
        GENERATOR.write_text(new_gen,encoding='utf-8')
        print('UPDATED future article template: '+str(GENERATOR.relative_to(ROOT)))
    else:
        print('ALREADY INSTALLED in future article template')
    for file,html in candidate_updates.items():
        file.write_text(html,encoding='utf-8')
    print(f'PASS: {len(candidate_updates)} existing published articles updated; '
          f'{published_count} published articles inspected; no drafts or private data changed.')

if __name__=='__main__':
    main()
