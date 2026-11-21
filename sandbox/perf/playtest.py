"""Hands-on headless playtest of a (patched) dist/: build floors with the hammer, place decor, hook items, hot-swap
through dist/live.js, and check that the incremental deck batch matches a from-scratch build and nothing leaks.

Usage: python sandbox/perf/playtest.py --dist DIR [--out DIR] [--tag NAME] [--swaps 4]
DIR is copied to a temp folder first (hot-swap rewrites version.json there), so dist/ is never touched.
The deck is the 'raft-floors' group (deck.js createRaftMesh on stock, deck-cache.js when patched).
Prints JSON: per step tiles/decor, renderer.info.memory (geometries, textures), programs, main-pass draw calls,
JS heap, long tasks during each action, and a deck checksum (vertex count and position sums per deck mesh, raft
space) taken after the incremental builds and again after each hot swap (a full rebuild from world.tiles).
Screenshots: <out>/play-<tag>-*.png. Read them.
"""
import json, shutil, tempfile, threading, http.server, socketserver, functools, argparse, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--dist', required=True); ap.add_argument('--out', default=str(Path(__file__).resolve().parent / 'shots'))
ap.add_argument('--tag', default='patched'); ap.add_argument('--swaps', type=int, default=4); ap.add_argument('--floors', type=int, default=8)
ap.add_argument('--big', action='store_true', help='start from a 5x5 raft with 8 decorations (rebuild cost grows with both)')
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp(prefix='raft-play-')); dist = tmp / 'dist'
shutil.copytree(Path(a.dist).resolve(), dist)
(dist / 'version.json').write_text(json.dumps({'build': 'play-0', 'protocol': 1}))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
socketserver.ThreadingTCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

slots = [None] * 28
slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}; slots[1] = {'kind': 'hammer', 'count': 1, 'durability': 100}
slots[2] = {'kind': 'sail', 'count': 2}; slots[3] = {'kind': 'lantern', 'count': 2}; slots[4] = {'kind': 'crate', 'count': 2}; slots[5] = {'kind': 'palm', 'count': 2}
for i, k in enumerate(['wood', 'wood', 'plastic', 'plastic']): slots[8 + i] = {'kind': k, 'count': 20}
SAVE = {'tiles': [[x, z] for z in [-1, 0, 1] for x in [-1, 0, 1]], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0,
        'hostInventory': {'slots': slots, 'selected': 0}}
if a.big:
    SAVE['tiles'] = [[x, z] for z in range(-2, 3) for x in range(-2, 3)]
    SAVE['decor'] = [{'type': t, 'x': x, 'z': z} for t, x, z in [('sail', -2, 2), ('palm', 2, 2), ('lantern', -2, -2), ('crate', 2, -2), ('bench', -2, 0), ('net', 2, 0), ('sail', 0, 2), ('crate', 1, -2)]]

HOOK = """
window.__longtasks = [];
try { new PerformanceObserver(l => { for (const e of l.getEntries()) __longtasks.push(Math.round(e.duration)); }).observe({entryTypes:['longtask']}); } catch {}
// Build hitch: time spent in input handlers (a floor or decoration is built synchronously inside the click).
window.__handlerMs = [];
for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) { let t0 = 0; addEventListener(t, () => { t0 = performance.now(); }, true); addEventListener(t, () => { const d = performance.now() - t0; if (d > 3) __handlerMs.push(Math.round(d)); }, false); }
HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('headless')); };
"""
# Capture the live renderer/scene each frame (survives hot swaps: same vendor module instance, new renderer).
CAPTURE = """async () => { const T = await import(new URL('vendor/three.module.js', location.href).href);
  if (!T.Scene.prototype.__pt) { const o = T.Scene.prototype.onBeforeRender; T.Scene.prototype.onBeforeRender = function (r, s, c) { if (s === this) { window.__R = r; window.__S = s; (window.__scenes ??= new Map()).set(s.uuid, performance.now()); } return o?.apply(this, arguments); }; T.Scene.prototype.__pt = 1;
    // leak finder: mark disposed geometries; remember, for every geometry drawn, the names of the object path that drew it
    const d = T.BufferGeometry.prototype.dispose; T.BufferGeometry.prototype.dispose = function () { this.__gone = true; return d.apply(this, arguments); };
    const seen = window.__seen = new Map();
    T.Mesh.prototype.onBeforeRender = function () { if (!seen.has(this.geometry)) { let p = this, path = []; while (p) { path.push(p.name || p.type); p = p.parent; } seen.set(this.geometry, path.slice(0, 4).join('<')); } }; } }"""
LEAKS = """() => { const out = {}; for (const [g, path] of window.__before) if (!g.__gone) out[path] = (out[path] || 0) + 1; window.__before = new Map(window.__seen); return out; }"""
SAMPLE = """() => { const r = __R, s = __S, st = raftDebug.state;
  const deck = []; let floorGroups = 0, meshes = 0;
  s.traverse(o => { if (o.isMesh) meshes++; if (o.name === 'raft-floors') floorGroups++; });
  const batch = s.getObjectByName('raft-floors');
  // checksum of every deck vertex in raft space: order-independent, so incremental == from-scratch iff same geometry
  const src = batch ? batch.children : []; for (const m of src) { const p = m.geometry.attributes.position.array, used = Math.min(p.length, m.geometry.drawRange.count * 3); let sx = 0, sy = 0, sz = 0, sq = 0; for (let i = 0; i < used; i += 3) { sx += p[i]; sy += p[i+1]; sz += p[i+2]; sq += p[i]*p[i] + p[i+1]*p[i+1] + p[i+2]*p[i+2]; } deck.push({mat: m.material.name || m.material.type, verts: used / 3, sum: [sx, sy, sz, sq].map(v => +v.toFixed(2))}); }
  deck.sort((a, b) => (a.mat + a.verts).localeCompare(b.mat + b.verts));
  const lt = __longtasks.splice(0), hm = __handlerMs.splice(0), now = performance.now(), live = [...(window.__scenes ?? new Map()).values()].filter(t => now - t < 3000).length;
  return {tiles: st.tiles, decor: st.decor.length, collected: st.collected, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
    programs: r.info.programs.length, callsMain: r.info.render.calls, meshes, floorGroups, deckMeshes: src.length, deck,
    heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), longtasks: lt, handlerMs: hm, scenesRendering: live, build: window.raftLive?.build ?? null}; }"""

log = []; errors = []
def step(page, name, shot=False):
    page.wait_for_timeout(400)
    s = page.evaluate(SAMPLE); s['step'] = name; log.append(s)
    print(name, json.dumps({k: s[k] for k in ('tiles', 'decor', 'collected', 'geometries', 'textures', 'programs', 'callsMain', 'deckMeshes', 'heapMB', 'scenesRendering', 'handlerMs')}), file=sys.stderr, flush=True)
    if shot:
        page.mouse.move(640, 60); page.wait_for_timeout(150)  # no hover ghost in the picture
        page.screenshot(path=str(out / f'play-{a.tag}-{name}.png'))
    return s

def click_placement(page, prefer=None):
    spots = page.evaluate('raftDebug.placements.filter(t=>t.screen?.visible&&t.screen.y>200&&t.screen.y<600&&t.screen.x>120&&t.screen.x<1160)')
    if not spots: return False
    spots.sort(key=prefer or (lambda t: -t['screen']['y']))
    sp = spots[0]['screen']; page.mouse.move(sp['x'], sp['y']); page.wait_for_timeout(120); page.mouse.click(sp['x'], sp['y']); page.wait_for_timeout(250)
    return True

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    ctx.add_init_script("try { if (!sessionStorage.getItem('pt')) { localStorage.setItem('little-raft-v1', %s); sessionStorage.setItem('pt', 1); } } catch (e) {}" % json.dumps(json.dumps(SAVE)))
    ctx.add_init_script(HOOK)
    page = ctx.new_page(); page.set_default_timeout(180000)
    page.on('pageerror', lambda e: errors.append(str(e)[:300]))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text[:300]))
    page.goto(URL); page.wait_for_function('!!window.raftDebug'); page.evaluate(CAPTURE)
    page.wait_for_function("!!document.querySelector('#solo') && !document.querySelector('#solo').disabled")
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running')  # the title menu hides #solo; page.wait_for_function('!!window.__R')
    page.wait_for_timeout(1500)
    step(page, '0-spawn', shot=True)

    # 1. hook (first, like check_hook.py, before decor can hide the sea): throw at the nearest item and reel it in
    for i in range(3):
        t = page.evaluate('raftDebug.targets.filter(t=>t.screen?.visible&&t.distance<13&&t.screen.x>200&&t.screen.x<1080&&t.screen.y>150&&t.screen.y<600).sort((a,b)=>a.distance-b.distance)')
        if not t: break
        s = t[0]['screen']; page.mouse.move(s['x'], s['y']); page.mouse.down()
        try:
            page.wait_for_function('raftDebug.state.charge > .9', timeout=60000); page.mouse.up()
            page.wait_for_function('raftDebug.state.hookStage!=="idle"', timeout=60000)
            page.wait_for_function('raftDebug.state.hookStage==="floating"||raftDebug.state.hookStage==="idle"', timeout=180000)
            caught = page.evaluate('raftDebug.state.hookCaught')
            page.mouse.down(); page.wait_for_function('raftDebug.state.hookStage==="idle"', timeout=300000); page.mouse.up()
            print('hook', i, t[0]['type'], 'caught', caught and caught.get('type'), 'collected', page.evaluate('raftDebug.state.collected'), file=sys.stderr)
        except Exception as e: page.mouse.up(); print('hook', i, 'failed', str(e).splitlines()[0], page.evaluate('raftDebug.state.hookStage'), file=sys.stderr)
        step(page, f'1-hook-{i + 1}')
    step(page, '1-hooked', shot=True)

    # 2. hammer: build floor tiles in front of the raft, one click at a time
    if a.big:  # the front edge of a 5x5 raft is out of build reach from the middle: walk up to it first
        z0 = page.evaluate('raftDebug.state.me.z'); page.keyboard.down('w')
        try: page.wait_for_function(f'raftDebug.state.me.z < {z0 - 2.6}', timeout=300000, polling=200)
        finally: page.keyboard.up('w')
        page.wait_for_timeout(500); print('walked to', page.evaluate('raftDebug.state.me'), file=sys.stderr)
    page.keyboard.press('2'); page.wait_for_timeout(300)
    assert page.evaluate('raftDebug.state.heldKind') == 'hammer', page.evaluate('raftDebug.state.heldKind')
    built = 0
    for i in range(a.floors):
        before = page.evaluate('raftDebug.state.tiles')
        if not click_placement(page, prefer=lambda t: (-t['screen']['y'], abs(t['screen']['x'] - 640))): break
        if page.evaluate('raftDebug.state.tiles') > before: built += 1
        step(page, f'2-floor-{i + 1}')
    step(page, '2-floors', shot=True)

    # 3. decor on existing tiles: sail, lantern, crate, palm (each placement is a rebuildRaft)
    for key, kind in (('3', 'sail'), ('4', 'lantern'), ('5', 'crate'), ('6', 'palm')):
        page.keyboard.press(key); page.wait_for_timeout(250)
        click_placement(page, prefer=lambda t: (abs(t['screen']['y'] - 420), abs(t['screen']['x'] - 640)))
        step(page, f'3-decor-{kind}')
    page.keyboard.press('1'); page.wait_for_timeout(300)
    inc = step(page, '3-decor', shot=True)

    # 4. hot swap through live.js: every swap mounts a new engine that rebuilds the raft from world.tiles in one go
    swaps = []; leaks = []
    page.evaluate('window.__before = new Map(window.__seen)')
    for k in range(1, a.swaps + 1):
        (dist / 'version.json').write_text(json.dumps({'build': f'play-{k}', 'protocol': 1}))
        # Let live.js's own 6 s poll find the new build. Calling raftLive.check() by hand can overlap a poll, and two
        # overlapping check()s both pass the `updating` guard (it is only set inside swap(), after an await) and mount
        # two engines: one is orphaned, keeps rendering and is never disposed. That race is in stock live.js too.
        page.wait_for_function(f'raftLive.build==="play-{k}" && !!window.raftDebug && raftDebug.state.running', timeout=600000)
        page.wait_for_timeout(1200)
        page.evaluate('window.gc?.()')
        swaps.append(step(page, f'4-swap-{k}', shot=(k == 1)))
        lk = page.evaluate(LEAKS); leaks.append(lk); print('undisposed after swap', k, json.dumps(lk), file=sys.stderr)
    # 5. one more build after the swap, so the batch grows on a remounted engine too
    page.keyboard.press('2'); page.wait_for_timeout(1500)
    held = page.evaluate('raftDebug.state.heldKind'); ok = click_placement(page, prefer=lambda t: (-t['screen']['y'], abs(t['screen']['x'] - 640)))
    page.wait_for_timeout(1500); page.keyboard.press('1')
    print('after swap: held', held, 'clicked', ok, file=sys.stderr)
    step(page, '5-floor-after-swap', shot=True)
    b.close()
srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)

same = all(s['deck'] == inc['deck'] for s in swaps)
mem = [(s['geometries'], s['textures'], s['programs']) for s in swaps]
hm = lambda pre: [x for s in log if s['step'].startswith(pre) for x in s['handlerMs']]
report = {'tag': a.tag, 'floorsBuilt': built, 'buildHandlerMs': {'floors': hm('2-floor'), 'decor': hm('3-decor')}, 'incrementalDeckEqualsFullRebuild': same,
          'memoryAfterSwaps': mem, 'memoryFlatAcrossSwaps': all(max(m[i] for m in mem) - min(m[i] for m in mem) <= 2 for i in range(3)),  # +-2: e.g. the rope is uploaded on first use
          'undisposedAfterSwap': leaks, 'errors': errors, 'log': log}
print(json.dumps(report, indent=1))
