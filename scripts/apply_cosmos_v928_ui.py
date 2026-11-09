#!/usr/bin/env python3
"""COSMOS v9.2.8: additive, idempotent frontend asset references. No Worker edits."""
from pathlib import Path
import sys

CSS = '<link rel="stylesheet" href="/assets/cosmos-v928-ui.css" data-cosmos-patch="v928">'
JS = '<script src="/assets/cosmos-v928-ui.js" defer data-cosmos-patch="v928"></script>'
MARKER = 'COSMOS v9.2.8 · Interface patch'

def apply(source: str) -> str:
    tests = ['id="journeyStage"', 'id="sheet"', 'cosmos', 'business-modal', '</head>', '</body>']
    missing = [term for term in tests if term not in source]
    if missing or len(source) < 170000:
        raise ValueError('Refusing to patch unfamiliar/short COSMOS source: ' + ', '.join(missing))
    # Older server and private-API logic are not modified.
    if source.count(CSS) > 1 or source.count(JS) > 1:
        raise ValueError('Duplicate v928 assets detected; clean duplicates before applying.')
    if CSS not in source:
        source = source.replace('</head>', f'<!-- {MARKER} -->\n{CSS}\n</head>', 1)
    if JS not in source:
        source = source.replace('</body>', f'{JS}\n</body>', 1)
    if source.count(CSS) != 1 or source.count(JS) != 1:
        raise AssertionError('v928 asset injection failed.')
    return source

def main():
    p=Path(sys.argv[1]) if len(sys.argv)>1 else Path('cosmos-next.html')
    mode=sys.argv[2] if len(sys.argv)>2 else 'validate'
    if mode not in ('validate','apply'): raise SystemExit('Use validate or apply.')
    original=p.read_text(encoding='utf-8')
    patched=apply(original)
    if apply(patched)!=patched: raise AssertionError('Not idempotent.')
    if mode=='apply':
        p.write_text(patched,encoding='utf-8')
    print('COSMOS v9.2.8',mode.upper(),'OK: existing COSMOS preserved; assets linked exactly once.')
    print('bytes:',len(original.encode()),'->',len(patched.encode()))

if __name__ == '__main__':main()
