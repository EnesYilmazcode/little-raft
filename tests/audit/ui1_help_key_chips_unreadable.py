"""AUDIT UI-1 (browser): in the How to play dialog the key chips (.guide kbd) render cream text on a
white chip (style.css `.guide kbd{background:#fff;color:var(--ink)}` + graphics.css redefines --ink as
cream) at ~1.2:1, and `.guide li` text #2f5f60 sits on the navy dialog at ~2.5:1. Requires WCAG AA 4.5:1.
Exit 1 on bug. Usage: python tests/audit/ui1_help_key_chips_unreadable.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

JS = """()=>{document.querySelector('#help').showModal();
const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const bg=getComputedStyle(document.querySelector('#help')).backgroundColor;
const k=[...document.querySelectorAll('#help .guide kbd')].map(e=>{const c=getComputedStyle(e);return {t:e.textContent,r:+ratio(c.color,c.backgroundColor).toFixed(2)}});
const li=[...document.querySelectorAll('#help .guide li>span')].map(e=>({t:e.textContent.slice(0,24),r:+ratio(getComputedStyle(e).color,bg).toFixed(2)}));
return {k,li}}"""
url, srv = serve()
with launch() as (b, pg):
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000); pg.wait_for_timeout(500)
    r = pg.evaluate(JS)
srv.shutdown()
fails = []
if not r['k'] or not r['li']: print('INCONCLUSIVE: no guide chips/text found'); sys.exit(2)
wk = min(r['k'], key=lambda x: x['r']); wl = min(r['li'], key=lambda x: x['r'])
if wk['r'] < 4.5: fails.append(f"help key chip '{wk['t']}' contrast {wk['r']}:1 < 4.5:1")
if wl['r'] < 4.5: fails.append(f"help guide text '{wl['t']}' contrast {wl['r']}:1 < 4.5:1")
for f in fails: print('FAIL:', f)
print('PASS' if not fails else 'FAILED'); sys.exit(1 if fails else 0)
