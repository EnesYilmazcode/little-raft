"""Applies docs/tech/viewmodel-ADOPT.md to a temp copy of dist/ and plays the patched game headless.
Usage: python sandbox/viewmodel/adopt_check.py [out_dir]   (default out_dir: scratchpad-ish temp dir, printed)
Env: SKIP_TESTS=1 skips the node test comparison; SKIP_BASE=1 skips booting the unpatched copy.

1. cp dist -> <tmp>/patched (+ <tmp>/base untouched copy), cp sandbox/viewmodel/viewmodel.js -> patched/viewmodel.js
2. applies every edit in adopt_edits.py, asserting each quoted anchor matches exactly once; prints its line number
3. node --test tests/*.test.mjs with RAFT_DIST=patched vs RAFT_DIST=base (tests without RAFT_DIST run dist/ twice)
4. boots both copies headless with a seeded save, plays: spawn, idle, full charge + throw, hotbar swaps (fast too),
   hammer build (strike frames), back to the hook; a second boot at FOV 100; screenshots each, prints JSON (errors, checks)."""
import os, sys, json, time, shutil, tempfile, subprocess, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from adopt_edits import EDITS, apply

out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='vm-adopt-shots-'))
out.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp(prefix='vm-adopt-'))
base, patched = tmp / 'base', tmp / 'patched'
shutil.copytree(ROOT / 'dist', base); shutil.copytree(ROOT / 'dist', patched)
R = {'tmp': str(tmp), 'out': str(out), 'anchors': [], 'tests': {}, 'runs': {}, 'fails': []}

# ---- 1-2: apply
shutil.copy(HERE / 'viewmodel.js', patched / 'viewmodel.js')
apply(patched, EDITS, R['anchors'])
# the sandbox hands.js must be exactly dist/hands.js + the hands edits (import path aside)
sb = (HERE / 'hands.js').read_text().replace("from '../../dist/held-items.js", "from './held-items.js")
if sb != (patched / 'hands.js').read_text(): R['fails'].append('sandbox/viewmodel/hands.js != dist/hands.js + adopt edits (run adopt_edits.py --sandbox)')

# ---- 3: node tests
def run_tests(d):
    files = sorted(str(p) for p in (ROOT / 'tests').glob('*.test.mjs'))
    r = subprocess.run(['node', '--test', '--test-reporter=tap', *files], cwd=ROOT, env={**os.environ, 'RAFT_DIST': str(d)}, capture_output=True, text=True, timeout=900)
    tail = {}
    for line in r.stdout.splitlines():
        for k in ('# tests', '# pass', '# fail'):
            if line.startswith(k): tail[k[2:]] = int(line.split()[-1])
    failed = [l.strip() for l in r.stdout.splitlines() if l.lstrip().startswith('not ok')]
    return {**tail, 'failed': failed[:20]}
if not os.environ.get('SKIP_TESTS'):
    R['tests']['base'] = run_tests(base); R['tests']['patched'] = run_tests(patched)
    if R['tests']['patched'].get('fail', 1) > R['tests']['base'].get('fail', 0): R['fails'].append('patched copy fails more node tests than base')

# ---- 4: play
slots = [None] * 28
for i, (k, n) in enumerate([('hook', 1), ('hammer', 1), ('fishingrod', 1), ('crate', 2)]): slots[i] = {'kind': k, 'count': n, **({'durability': 60} if k == 'hook' else {})}
for i, k in enumerate(['wood', 'wood', 'leaf', 'leaf', 'plastic', 'scrap', 'rope']): slots[8 + i] = {'kind': k, 'count': 20}
SAVE = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0, 'hookHealth': 60,
        'items': [], 'hostInventory': {'slots': slots, 'selected': 0}, 'guestInventory': None}

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
socketserver.TCPServer.allow_reuse_address = True

def wait_js(page, expr, timeout):
    end = time.monotonic() + timeout / 1000
    while True:
        try:
            if page.evaluate('() => !!(' + expr + ')'): return True
        except Exception: pass
        if time.monotonic() > end: return False
        page.wait_for_timeout(150)

def play(browser, d, tag, fov=None, short=False):
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(d)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    run = {'errors': [], 'console': [], 'checks': {}, 'shots': []}
    page = browser.new_context(viewport={'width': 960, 'height': 540}).new_page()
    page.on('pageerror', lambda e: run['errors'].append(str(e)[:300]))
    page.on('console', lambda m: m.type in ('error', 'warning') and run['console'].append(f'{m.type}: {m.text[:200]}'))
    page.add_init_script('if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem("little-raft-v1", ' + json.dumps(json.dumps(SAVE)) + ')'
                         + (f'; localStorage.setItem("little-raft-settings", {json.dumps(json.dumps({"fov": fov}))})' if fov else '') + ' }')
    st = lambda: page.evaluate('raftDebug.state')
    def shot(name):
        p = out / f'{tag}-{name}.png'; page.screenshot(path=str(p)); run['shots'].append(p.name)
    def frames(n=6):  # let the game render a few frames (software GL is slow; wait on rAF, not the clock)
        page.evaluate(f'() => new Promise(r => {{ let n = {n}; const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }})')
    page.goto(f'http://127.0.0.1:{srv.server_address[1]}/')
    if not wait_js(page, '!!window.raftDebug', 30000): run['errors'].append('no raftDebug'); return run
    page.evaluate("document.querySelector('#solo').click()")
    run['checks']['running'] = wait_js(page, 'raftDebug.state.running', 20000)
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    frames(20)
    page.evaluate('raftDebug.aim(-0.15, 0)'); frames(10)
    s = st(); run['checks']['held0'] = s['heldKind']; run['checks']['vm0'] = s['viewmodel']
    shot('01-spawn-hook')
    ri = page.evaluate('raftDebug.renderInfo'); run['renderInfo'] = {k: ri[k] for k in ('calls', 'triangles', 'programs', 'geometries')}
    run['checks']['fov'] = st()['camera']['fov']
    if short: page.close(); srv.shutdown(); return run
    # full charge, then release (throw)
    page.mouse.move(480, 200); page.mouse.down()
    wait_js(page, 'raftDebug.state.charge >= 1', 8000); frames(4)
    shot('02-charge-full')
    page.mouse.up(); frames(3)
    shot('03-throw')
    wait_js(page, "raftDebug.state.hookStage !== 'idle'", 8000); frames(6)
    s = st(); run['checks']['hookStage'] = s['hookStage']; run['checks']['hand'] = s['hand']; run['checks']['me'] = s['me']
    shot('04-hook-out-rope')
    # reel back in
    page.mouse.down(); wait_js(page, "raftDebug.state.hookStage === 'idle'", 40000); page.mouse.up(); frames(6)
    run['checks']['hookBack'] = st()['hookStage']
    # hotbar: hammer, rod, crate, fast swap, back to hook
    for key, name in [('Digit2', '05-hammer'), ('Digit3', '06-rod'), ('Digit4', '07-crate')]:
        page.keyboard.press(key); wait_js(page, f"raftDebug.state.viewmodel.held === raftDebug.state.heldKind && raftDebug.state.viewmodel.dip < .02", 8000); frames(4)
        shot(name)
    # re-select mid-lower: hook settled, press 2, and once the hook is on its way down press 1 again
    page.keyboard.press('Digit1'); wait_js(page, "raftDebug.state.viewmodel.held === 'hook' && raftDebug.state.viewmodel.dip < .02", 8000)
    page.evaluate('''() => { const f = () => { const v = raftDebug.state.viewmodel;   // press 1 on the first frame the hook is part-lowered
      if (v.held === 'hook' && v.target === 'hammer' && v.dip > .1) { for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, {code:'Digit1', key:'1', bubbles:true})); window.__reselDip = v.dip; }
      else requestAnimationFrame(f); }; requestAnimationFrame(f); }''')
    page.keyboard.press('Digit2'); wait_js(page, 'window.__reselDip', 6000); frames(2)
    run['checks']['reselectAtDip'] = page.evaluate('window.__reselDip')
    shot('08-reselect-mid')
    run['checks']['reselectSettles'] = wait_js(page, "raftDebug.state.viewmodel.held === 'hook' && raftDebug.state.viewmodel.dip < .02", 6000); frames(4)
    shot('08b-reselect-settled')
    run['checks']['reselectState'] = {k: st()['viewmodel'][k] for k in ('held', 'target', 'dip')}
    # hammer: aim at a free placement spot, click, catch the strike frames
    page.keyboard.press('Digit2'); wait_js(page, "raftDebug.state.viewmodel.held === 'hammer' && raftDebug.state.viewmodel.dip < .02", 8000)
    cands = page.evaluate('raftDebug.placements')
    me = st()['me']
    import math
    best = min(cands, key=lambda c: math.hypot(c['world']['x'] - me['x'], c['world']['z'] - me['z'])) if cands else None
    run['checks']['placements'] = len(cands)
    if best:
        dx, dz, dy = best['world']['x'] - me['x'], best['world']['z'] - me['z'], best['world']['y'] - me['y']
        page.evaluate(f'raftDebug.aim({math.atan2(dy, math.hypot(dx, dz))}, {math.atan2(-dx, -dz)})'); frames(8)
        tiles0 = st()['tiles']
        # record the viewmodel every frame; freeze the game clock (dt = 0) on the cock and on the hit so they can be shot
        page.evaluate('''() => { const real = performance.now.bind(performance); let frozen = null, phase = 0; window.__rec = []; window.__frozen = 0;
          performance.now = () => frozen ?? real(); window.__thaw = () => { frozen = null; window.__frozen = 0; };
          const f = () => { const v = raftDebug.state.viewmodel, s = v.strike ?? 0; __rec.push(+s.toFixed(2));
            if (frozen === null && ((phase === 0 && s < -0.5) || (phase === 1 && s > 0.6))) { phase++; frozen = real(); window.__frozen = phase; }
            if (__rec.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); }''')
        page.mouse.move(480, 270); page.mouse.down(); page.mouse.up()
        for ph, name in ((1, '09a-strike-cock'), (2, '09b-strike-hit')):
            if wait_js(page, f'window.__frozen === {ph}', 8000): frames(2); shot(name); page.evaluate('__thaw()')
        frames(10)
        seq = page.evaluate('__rec')
        run['checks']['strikeMin'], run['checks']['strikeMax'] = min(seq), max(seq)
        page.evaluate('() => { delete performance.now; }')
        wait_js(page, f'raftDebug.state.tiles > {tiles0}', 8000)
        run['checks']['tiles'] = [tiles0, st()['tiles']]
    page.keyboard.press('Digit1'); wait_js(page, "raftDebug.state.viewmodel.held === 'hook' && raftDebug.state.viewmodel.dip < .02", 8000)
    page.evaluate('raftDebug.aim(-0.15, 0)'); frames(6); shot('10-back-to-hook')
    run['checks']['final'] = {k: st()[k] for k in ('heldKind', 'running')}
    run['renderInfoEnd'] = {k: page.evaluate('raftDebug.renderInfo')[k] for k in ('calls', 'triangles', 'programs', 'geometries')}
    page.close(); srv.shutdown()
    return run

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    R['runs']['patched'] = play(b, patched, 'patched')
    R['runs']['patched-fov100'] = play(b, patched, 'patched-fov100', fov=100, short=True)
    if not os.environ.get('SKIP_BASE'):
        R['runs']['base'] = play(b, base, 'base')
        R['runs']['base-fov100'] = play(b, base, 'base-fov100', fov=100, short=True)
    b.close()

pr = R['runs']['patched']
if pr['errors']: R['fails'].append('page errors in the patched game')
if not pr['checks'].get('running'): R['fails'].append('patched game did not start')
if not pr['checks'].get('reselectSettles'): R['fails'].append('fast re-select did not settle')
if not (pr['checks'].get('strikeMin', 0) < -0.5 and pr['checks'].get('strikeMax', 0) > 0.6): R['fails'].append('hammer build did not play the strike (cock < -.5, hit > .6)')
if pr['checks'].get('tiles', [0, 0])[1] <= pr['checks'].get('tiles', [0, 0])[0]: R['fails'].append('hammer build did not add a tile')
print(json.dumps(R, indent=1))
sys.exit(1 if R['fails'] else 0)
