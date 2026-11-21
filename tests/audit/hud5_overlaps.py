"""AUDIT HUD-5 (browser): no two HUD panels overlap at the common window sizes.
Holds the hammer (build chip + "Aim at the raft edge" side prompt), pins a recipe (tracker), posts long-lived
feed rows, keeps the onboarding checklist up, then measures pairwise overlaps among #lrVitals, every
#pickupFeed row, the hotbar, #craftTracker, .bm-chip, #lrPrompt and .ob-notes at 800x600, 1024x768,
1280x720 and 1920x1080. Contract: zero overlaps. Also checks that the faint text is not centred.
Exit 1 on bug. Usage: python tests/audit/hud5_overlaps.py [outdir-for-screenshots]"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if os.path.exists('/usr/bin/google-chrome'): os.environ.setdefault('CHROMIUM', '/usr/bin/google-chrome')
from _harness import serve, launch

SIZES = [(800, 600), (1024, 768), (1280, 720), (1920, 1080)]
OUT = sys.argv[1] if len(sys.argv) > 1 else None
MEASURE = """() => {
  const vis = e => { if (!e || e.hidden) return false; const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width > 0 && r.height > 0; };
  const box = (name, e) => { const r = e.getBoundingClientRect(); return {name, l:Math.round(r.left), t:Math.round(r.top), r:Math.round(r.right), b:Math.round(r.bottom)}; };
  const out = [], one = (name, sel) => { const e = document.querySelector(sel); if (vis(e)) out.push(box(name, e)); };
  one('vitals', '#lrVitals'); one('hotbar', '.tools.sv-hotbar'); one('tracker', '#craftTracker');
  one('chip', '.bm-chip'); one('prompt', '#lrPrompt.lr-on'); one('notes', '.ob-notes');
  document.querySelectorAll('#pickupFeed .pf-row:not(.out)').forEach((e, i) => { if (vis(e)) out.push(box('feed' + i, e)); });
  return out;
}"""
FEED = """() => { for (const t of ['+3 Plank (a long-lived probe row)', 'Wood x2 picked up from the sea', 'Rope'])
  window.raftFeed.note(t, {life:15000});
  document.getAnimations().forEach(a => { try { if (a.effect?.target?.closest?.('#pickupFeed')) a.finish(); } catch {} }); }"""

def overlaps(boxes):
    bad = []
    for i, a in enumerate(boxes):
        for c in boxes[i + 1:]:
            if a['name'].startswith('feed') and c['name'].startswith('feed'): continue
            w = min(a['r'], c['r']) - max(a['l'], c['l']); h = min(a['b'], c['b']) - max(a['t'], c['t'])
            if w > 0 and h > 0: bad.append(f"{a['name']}x{c['name']} ({w}x{h}px)")
    return bad

url, srv = serve()
fails, table = [], []
for W, H in SIZES:
    with launch(viewport=(W, H)) as (b, pg):
        pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=90000)
        pg.locator('.ob-menu [data-act="new"]').click(); pg.wait_for_function('raftDebug.hud.running', timeout=90000); pg.wait_for_timeout(1500)
        # pin the first recipe from the bag, then close it so the tracker shows
        pg.keyboard.press('Tab'); pg.wait_for_function('raftDebug.state.inventoryOpen', timeout=30000); pg.wait_for_timeout(500)
        pg.evaluate("document.querySelector('#inventory .sv-recipe')?.click()"); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('#inventory button.sv-pinbtn[aria-pressed=\"false\"]')?.click()"); pg.wait_for_timeout(300)
        pg.keyboard.press('Tab'); pg.wait_for_timeout(800)
        pg.evaluate("raftDebug.give('hammer',1)"); pg.wait_for_timeout(400)
        slot = pg.evaluate("(raftDebug.state.inventory?.slots || []).findIndex(s => s && s.kind === 'hammer')")
        pg.keyboard.press(str((slot + 1) % 10) if 0 <= slot < 10 else '2')
        pg.evaluate('raftDebug.aim(-0.45)'); pg.wait_for_timeout(1500)
        pg.evaluate(FEED); pg.wait_for_timeout(400)
        boxes = pg.evaluate(MEASURE)
        names = {x['name'] for x in boxes}
        missing = [n for n in ('vitals', 'hotbar', 'tracker', 'chip', 'prompt', 'notes', 'feed0') if n not in names]
        bad = overlaps(boxes)
        if OUT: pg.screenshot(path=os.path.join(OUT, f'hud5-{W}x{H}.png'))
        pg.evaluate('raftDebug.hurt(1000)'); pg.wait_for_timeout(900)
        faint = pg.evaluate("""() => { const d = document.querySelector('#lrFaint div'); if (!d) return null; const r = d.getBoundingClientRect();
          return {cx:(r.left + r.right) / 2, cy:(r.top + r.bottom) / 2}; }""")
        if OUT: pg.screenshot(path=os.path.join(OUT, f'hud5-{W}x{H}-faint.png'))
    centred = faint and abs(faint['cx'] - W / 2) < W * 0.15 and abs(faint['cy'] - H / 2) < H * 0.15
    table.append((f'{W}x{H}', len(bad), ', '.join(bad) or '-', ' '.join(f"{x['name']}[{x['l']},{x['t']},{x['r']},{x['b']}]" for x in boxes)))
    if bad: fails.append(f'{W}x{H}: ' + ', '.join(bad))
    if missing: fails.append(f'{W}x{H}: not shown: ' + ', '.join(missing))
    if centred: fails.append(f'{W}x{H}: faint text centred at {faint}')
srv.shutdown()
for row in table: print('%-10s overlaps=%d  %s\n           %s' % row)
if fails: print('FAIL: ' + '; '.join(fails)); sys.exit(1)
print('PASS')
