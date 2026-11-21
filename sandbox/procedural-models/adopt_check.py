"""Apply docs/tech/procedural-models-ADOPT.md to a temp copy of dist/ and compare it with the unpatched dist in the
real game. Run from anywhere:
    python sandbox/procedural-models/adopt_check.py                 # recommended adoption (crafts only)
    python sandbox/procedural-models/adopt_check.py --mode full     # also deck + debris + plastic (not recommended)
    python sandbox/procedural-models/adopt_check.py --no-game       # anchors + node --check only
    python sandbox/procedural-models/adopt_check.py --tests         # also run `node --test tests/*.test.mjs` on both

1. Copies dist/ twice into a temp dir (stock + patched), copies lowpoly-props.js into the patched one and applies
   every ADOPT edit, asserting each anchor string occurs exactly once and sits on the line the doc quotes.
2. `node --check` on every patched file.
3. Boots both builds headless (brief's executable_path launch, ?pinQuality so shadows stay on), seeded with a
   3x3 raft and a bag of decor. Measures the spawn frame, then places sail/palm/lantern/net/bench/crate with real
   clicks, hammer-builds one floor tile, and measures again. Draw calls are counted twice: renderer.info (game.js
   resets it by hand, so the shadow pass is included) and a WebGL draw*() hook on the game canvas per frame.
   Also checks the cross-lane contracts on the placed crafts (sail cloth/pennant, lantern glow, palm planter pivot).
4. Writes PNGs to sandbox/procedural-models/shots/adopt/ and prints JSON. Exit 1 on an anchor miss, a page error,
   a failed placement or a broken contract.
Nothing in the repo's dist/ is modified."""
import argparse, json, math, shutil, subprocess, sys, tempfile, threading, functools, http.server, socketserver, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'shots' / 'adopt'
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
W, H = 960, 540
BUILD = 'v3-survival-ae77fa84ac2b'

# (file, line the doc quotes, old, new). Line numbers are 1-based, as in the ADOPT doc.
CRAFTS = [
    ('game.js', 12,
     f"import {{ createCraft }} from './crafts.js?build={BUILD}';",
     f"import {{ createCraft }} from './lowpoly-props.js?build={BUILD}';"),
    ('placement.js', 91,
     "for (const m of [].concat(o.material)) if (m !== mat) m.dispose();",
     "for (const m of [].concat(o.material)) if (m !== mat && !m.userData.shared) m.dispose();"),
]
# Quality-tier variant: lowpoly crafts only on the 'low' graphics preset, rebuilt when the preset changes.
TIER = [
    ('game.js', 12,
     f"import {{ createCraft }} from './crafts.js?build={BUILD}';",
     f"import {{ createCraft as createDetailedCraft }} from './crafts.js?build={BUILD}'; import {{ createCraft as createLowCraft }} from './lowpoly-props.js?build={BUILD}'; let lowProps = false; const createCraft = (T, k) => (lowProps ? createLowCraft : createDetailedCraft)(T, k); // procedural-models: low preset uses lowpoly crafts"),
    ('game.js', 1010,
     "if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics);",
     "if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics); if ((next.graphics === 'low') !== lowProps) { lowProps = next.graphics === 'low'; if (scene) rebuildRaft(); }"),
    CRAFTS[1],
]
FULL = CRAFTS + [
    ('game.js', 9,
     f"import {{ createRaftMesh, createFloor }} from './deck.js?build={BUILD}';",
     f"import {{ createRaftMesh, createFloor }} from './lowpoly-props.js?build={BUILD}';"),
    ('game.js', 10,
     f"import {{ createDebris }} from './debris.js?build={BUILD}';",
     f"import {{ createDebris }} from './lowpoly-props.js?build={BUILD}';"),
    ('game.js', 46,
     f"import {{ createPlastic }} from './plastic.js?build={BUILD}';",
     f"import {{ createPlastic }} from './lowpoly-props.js?build={BUILD}';"),
    ('game.js', 520,
     "if (o.isMesh && o.material.vertexColors) { o.material.dispose(); o.material = mat('#8e9aa2'); }",
     "if (o.isMesh && o.material.vertexColors && !o.material.userData.shared) { o.material.dispose(); o.material = mat('#8e9aa2'); }"),
    ('game.js', 521,
     "const b = jug.getObjectByName('jugBody'); if (b) {",
     "const b = jug.getObjectByName('jugBody'); if (b && !b.material.userData.shared) {"),
]

ap = argparse.ArgumentParser()
ap.add_argument('--mode', choices=['crafts', 'full', 'tier'], default='crafts')
ap.add_argument('--no-game', action='store_true')
ap.add_argument('--tests', action='store_true')
ap.add_argument('--frames', type=int, default=12)
a = ap.parse_args()
PATCHES = {'crafts': CRAFTS, 'full': FULL, 'tier': TIER}[a.mode]

tmp = Path(tempfile.mkdtemp(prefix='rt-pm-adopt-'))
stock, patched = tmp / 'stock' / 'dist', tmp / 'patched' / 'dist'
shutil.copytree(ROOT / 'dist', stock)
shutil.copytree(ROOT / 'dist', patched)
shutil.copy(HERE / 'lowpoly-props.js', patched / 'lowpoly-props.js')
report = {'mode': a.mode, 'anchors': [], 'fails': []}

for fname, line, old, new in PATCHES:
    f = patched / fname
    src = f.read_text()
    n = src.count(old)
    at = src[:src.find(old)].count('\n') + 1 if n else None
    report['anchors'].append({'file': fname, 'line': at, 'expectedLine': line, 'matches': n})
    if n != 1: report['fails'].append(f'{fname}: anchor matches {n}x: {old[:70]}'); continue
    if at != line: report['fails'].append(f'{fname}: anchor on line {at}, doc says {line}')
    f.write_text(src.replace(old, new))
for fname in sorted({p[0] for p in PATCHES}) + ['lowpoly-props.js']:
    r = subprocess.run(['node', '--check', str(patched / fname)], capture_output=True, text=True)
    if r.returncode: report['fails'].append(f'node --check {fname}: {r.stderr.strip()[:200]}')
if report['fails']:
    print(json.dumps(report, indent=1)); shutil.rmtree(tmp, ignore_errors=True); sys.exit(1)

if a.tests:
    tests = sorted(str(p) for p in (ROOT / 'tests').glob('*.test.mjs'))
    for tag, d in (('stock', stock), ('patched', patched)):
        # tests import ../dist/...: run them from a copy of tests/ that sits next to this dist
        shutil.copytree(ROOT / 'tests', d.parent / 'tests')
        for extra in ('package.json',):
            if (ROOT / extra).exists(): shutil.copy(ROOT / extra, d.parent / extra)
        for sub in ('sandbox', 'docs'):
            if (ROOT / sub).exists() and not (d.parent / sub).exists(): (d.parent / sub).symlink_to(ROOT / sub)
        names = [Path(t).name for t in tests]
        if tag == 'patched':  # the planter contract test again, on the lowpoly palm the patched game now places
            w = (d.parent / 'tests' / 'watering.test.mjs').read_text()
            assert w.count("new URL('crafts.js', base)") == 1, 'watering.test.mjs no longer imports crafts.js'
            (d.parent / 'tests' / 'lowpoly-watering.test.mjs').write_text(w.replace("new URL('crafts.js', base)", "new URL('lowpoly-props.js', base)"))
            names.append('lowpoly-watering.test.mjs')
        r = subprocess.run(['node', '--test', *[str(d.parent / 'tests' / n) for n in names]], cwd=d.parent, capture_output=True, text=True, timeout=1800)
        tail = [l for l in r.stdout.splitlines() if l.startswith(('# pass', '# fail', '# tests'))]
        report[f'tests_{tag}'] = {'exit': r.returncode, 'summary': tail, 'failed': [l.strip() for l in r.stdout.splitlines() if l.lstrip().startswith('not ok')][:20]}

if a.tests:  # only failures the patch introduces count (timing tests can fail on a loaded machine either way)
    new = sorted(set(report['tests_patched']['failed']) - set(report['tests_stock']['failed']))
    if new: report['fails'].append(f'tests failing only when patched: {new}')

if a.no_game:
    if report['fails']: print(json.dumps(report, indent=1)); shutil.rmtree(tmp, ignore_errors=True); sys.exit(1)
    print(json.dumps(report, indent=1)); shutil.rmtree(tmp, ignore_errors=True); sys.exit(0)

# ---------------------------------------------------------------- game probe
slots = [None] * 28
for i, k in enumerate(['hammer', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate']):
    slots[i] = {'kind': k, 'count': 1, 'durability': 100} if k == 'hammer' else {'kind': k, 'count': 2}
slots[7] = {'kind': 'wood', 'count': 20}; slots[8] = {'kind': 'plastic', 'count': 20}; slots[9] = {'kind': 'wood', 'count': 20}
SAVE = {'tiles': [[x, z] for z in (-1, 0, 1) for x in (-1, 0, 1)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0, 'hookHealth': 100,
        'items': [], 'hostInventory': {'slots': slots, 'selected': 1}, 'guestInventory': None}
INIT = """
{ let a = 12345; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; } // same debris on both builds
if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('little-raft-v1', %s); }
window.__gl = 0;%s
for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
  const f = C.prototype[fn]; if (!f) continue;
  C.prototype[fn] = function (...x) { if (this.canvas && this.canvas.width >= 300) window.__gl++; return f.apply(this, x); };
}
""" % (json.dumps(json.dumps(SAVE)), "\nlocalStorage.setItem('little-raft-settings', JSON.stringify({graphics: 'low'})); // tier mode: both builds on the low preset" if a.mode == 'tier' else '')
# Contracts other lanes rely on (read-only scene walk).
CONTRACTS = """() => {
  const s = window.raftMount?.scene; if (!s) return null;
  const by = n => { let g = null; s.traverse(o => { if (!g && o.name === n) g = o; }); return g; };
  const sail = by('craft_sail'), lan = by('craft_lantern'), palm = by('craft_palm');
  const kids = g => g ? g.children.filter(c => c.isMesh).map(c => c.name) : null;
  const glow = lan?.children.find(c => c.name === 'lanternGlow');
  return { sailCloth: !!sail?.children.find(c => c.name === 'sailCloth'), pennant: !!sail?.children.find(c => c.name === 'pennant'),
    lanternGlowEmissive: !!glow && 'emissiveIntensity' in glow.material, palmPivot: !!palm?.getObjectByName('plantPivot'),
    palmSoil: !!palm?.getObjectByName('soil')?.material?.color, palmCoconuts: !!palm?.getObjectByName('coconuts'),
    sailKids: kids(sail), lanternKids: kids(lan), palmKids: kids(palm), sailing: window.raftDebug.state.sailing };
}"""


def wait_js(page, expr, timeout):  # Python-side poll: in-page waits stall under software GL
    end = time.monotonic() + timeout
    while True:
        try:
            if page.evaluate('() => !!(' + expr + ')'): return True
        except Exception: pass
        if time.monotonic() > end: return False
        page.wait_for_timeout(250)


def frames(page, n):
    """n frames: renderer.info of the last one, GL draw calls per frame, mean frame ms."""
    return page.evaluate("""n => new Promise(res => { let k = 0, t0 = 0, g0 = 0;
      const tick = t => { if (k === 1) { t0 = t; g0 = window.__gl; } if (k++ <= n) return requestAnimationFrame(tick);
        const i = raftDebug.renderInfo; res({ calls: i.calls, triangles: i.triangles, geometries: i.geometries, textures: i.textures, programs: i.programs,
          shadows: i.shadows, glCallsPerFrame: +((window.__gl - g0) / n).toFixed(1), frameMs: +((t - t0) / n).toFixed(1) }); };
      requestAnimationFrame(tick); })""", n)


def place(page, digit, kind, R, tag):
    page.keyboard.press(f'Digit{digit}'); page.wait_for_timeout(400)
    before = page.evaluate('raftDebug.state.decor.length + raftDebug.state.tiles')
    cands = page.evaluate('raftDebug.placements')
    me = page.evaluate('raftDebug.state.camera')
    # nearest candidates first; turn the camera onto each one, then click where it projects
    cands.sort(key=lambda c: (c['world']['x'] - me['x']) ** 2 + (c['world']['z'] - me['z']) ** 2)
    for c in cands[:4]:
        w = c['world']; dx, dy, dz = w['x'] - me['x'], w['y'] - me['y'], w['z'] - me['z']
        page.evaluate(f'raftDebug.aim({math.atan2(dy, math.hypot(dx, dz)) * 0.8}, {math.atan2(-dx, -dz)})'); page.wait_for_timeout(600)
        sc = page.evaluate(f"raftDebug.project({w['x']}, {w['y']}, {w['z']})")
        if not sc or not sc['visible']: continue
        page.mouse.move(sc['x'], sc['y']); page.wait_for_timeout(600)
        page.mouse.click(sc['x'], sc['y'])
        if wait_js(page, f'raftDebug.state.decor.length + raftDebug.state.tiles > {before}', 20): return
    R['fails'].append(f'{tag}: {kind} was not placed (notice: {page.evaluate("document.body.innerText.slice(0, 160)")!r})')


OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.png'): f.unlink()
from playwright.sync_api import sync_playwright


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)
    for tag, d in (('stock', stock), ('patched', patched)):
        srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(d)))
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        R = report.setdefault(tag, {'errors': [], 'fails': []})
        pg = b.new_context(viewport={'width': W, 'height': H}).new_page(); pg.set_default_timeout(300000)
        pg.on('pageerror', lambda e, R=R: R['errors'].append(str(e)[:300]))
        pg.on('console', lambda m, R=R: m.type == 'error' and R['errors'].append(m.text[:300]))
        pg.add_init_script(INIT)
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/?pinQuality')
        if not wait_js(pg, '!!window.raftDebug', 120): R['fails'].append('no raftDebug'); continue
        pg.evaluate("document.querySelector('#solo').click()")
        if not wait_js(pg, 'raftDebug.state.running', 120): R['fails'].append('not running'); continue
        pg.wait_for_timeout(1500)
        pg.evaluate('raftDebug.aim(-0.55, 0)')  # look down over the raft, toward -z (where debris drifts in)
        R['spawn'] = frames(pg, a.frames)
        pg.screenshot(path=str(OUT / f'{tag}-1-spawn.png'))
        for i, k in enumerate(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']):
            place(pg, i + 2, k, R, tag)
        place(pg, 1, 'floor', R, tag)
        st = pg.evaluate('raftDebug.state')
        R['decor'] = [d['type'] for d in st['decor']]; R['tiles'] = st['tiles']
        pg.keyboard.press('Digit8'); pg.wait_for_timeout(600)  # wood in hand: no ghost in the measurement
        for name, pitch, yaw in (('2-decor', -0.5, 0.0), ('3-decor-back', -0.45, 3.14)):
            pg.evaluate(f'raftDebug.aim({pitch}, {yaw})'); pg.wait_for_timeout(300)
            R[name] = frames(pg, a.frames)
            pg.screenshot(path=str(OUT / f'{tag}-{name}.png'))
        R['contracts'] = pg.evaluate(CONTRACTS)
        c = R['contracts'] or {}
        for key in ('sailCloth', 'pennant', 'lanternGlowEmissive', 'palmPivot', 'palmSoil', 'palmCoconuts'):
            if not c.get(key): R['fails'].append(f'{tag}: contract {key} missing')
        if tag == 'patched' and 'sailSolid' not in (c.get('sailKids') or []): R['fails'].append('patched: the placed sail is not the lowpoly one')
        pg.context.close(); srv.shutdown()
    b.close()

shutil.rmtree(tmp, ignore_errors=True)
bad = report['fails'] + [f for t in ('stock', 'patched') for f in report.get(t, {}).get('fails', [])] + \
      [f'{t}: page error {e}' for t in ('stock', 'patched') for e in report.get(t, {}).get('errors', [])]
report['ok'] = not bad
for t in ('stock', 'patched'): (report.get(t, {}).get('contracts') or {}).pop('sailing', None)
(OUT / f'report-{a.mode}.json').write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
sys.exit(0 if not bad else 1)
