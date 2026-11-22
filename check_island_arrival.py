"""Headless probe: islands arrive and leave at full height, hidden by distance fog, never rising or sinking.
Usage: python check_island_arrival.py [dist_dir] [out_dir]
Plays a solo game, spawns an island at the start of its approach, keeps the camera on it and steps the
island clock. On the first frame any part of the island is inside the camera frustum it must already be at
its docked height with full-size plants (and fully fogged); on the way out it must still be at full height
on the last frame it is inside the frustum. Prints JSON, saves screenshots, exits 1 on a failed check."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else '.qa/island-arrival').resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'

# One sample, taken after a rendered frame: is any part of the island inside the frustum, its height,
# plant scale, and the fog factor of its nearest point (1 = fully fogged).
SAMPLE = """() => {
  const { T, scene, camera } = window.raftMount, I = raftDebug.content.islands;
  const g = scene.getObjectByName('islands'), st = I.state(), ph = I.phase();
  if (!g || !g.visible || !st.shown) return { phase: ph.phase, shown: false };
  camera.updateMatrixWorld();
  const m = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const fr = new T.Frustum().setFromProjectionMatrix(m);
  const r = st.R * 1.15 + 0.5; // sand rim plus slack
  const box = new T.Box3(new T.Vector3(st.cx - r, st.gy - 1, st.cz - r), new T.Vector3(st.cx + r, st.gy + 7, st.cz + r));
  let depth = Infinity; const v = new T.Vector3();
  for (let i = 0; i < 8; i++) { v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse); depth = Math.min(depth, -v.z); }
  const f = scene.fog, far = Math.min(f.far, st.fogFar), u = Math.min(1, Math.max(0, (depth - f.near) / (far - f.near)));
  const veg = g.children.filter(c => c.name !== 'islandDome').map(c => c.scale.x * c.scale.y * c.scale.z);
  const cp = new T.Vector3(); camera.getWorldPosition(cp);
  return { phase: ph.phase, shown: true, inFrustum: fr.intersectsBox(box), y: g.position.y, z: st.cz, vegMin: Math.min(...veg), vegMax: Math.max(...veg),
    depth, fog: u * u * (3 - 2 * u), dist: Math.hypot(st.cx - cp.x, st.cz - cp.z), camFar: camera.far, fogNear: f.near, fogFar: f.far, islandFogFar: st.fogFar };
}"""
AIM = "() => { const y = raftDebug.content.islands.yawTo(); if (y !== null) raftDebug.aim(-0.02, y); }"
frame = lambda page: page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')

report = {'errors': [], 'console': [], 'shots': [], 'checks': {}}
ok = True
def check(name, cond, info):
    global ok
    report['checks'][name] = {'ok': bool(cond), **info}; ok = ok and bool(cond)
def shot(page, name):
    p = out / f'{name}.png'; page.screenshot(path=str(p)); report['shots'].append(str(p))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['console'].append(m.text[:300]))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_function('!!window.raftMount && !!raftDebug.content.islands', timeout=15000)
    page.evaluate("() => { const d = raftDebug.content.daynight; if (d) { d.setPhase(0.3); d.setWeather('calm'); d.freeze(true); } }")
    page.wait_for_timeout(500)
    report['spawn'] = page.evaluate('raftDebug.content.islands.spawnNear(1234, 0)')
    page.evaluate(AIM); frame(page)

    first = last = None; prev = None; samples = []
    want = {190: 'far-190m', 150: 'fog-150m', 100: 'approach-100m', 60: 'approach-60m', 30: 'approach-30m'}
    # approach: step the island clock in 0.25 s steps until it docks
    for i in range(2000):
        page.evaluate(AIM); frame(page)
        s = page.evaluate(SAMPLE); samples.append(s)
        if s.get('inFrustum') and first is None:
            first = s; shot(page, 'arrive-01-first-in-frustum')
        if s.get('shown'):
            for d in sorted(want, reverse=True):
                if s['dist'] <= d: shot(page, 'arrive-' + want.pop(d)); break
        if s['phase'] == 'docked': break
        page.evaluate('raftDebug.content.islands.skip(0.25)')
    docked = page.evaluate(SAMPLE); shot(page, 'arrive-02-docked')
    check('first in-frustum frame at full height', first and abs(first['y'] - docked['y']) < 0.15 and first['vegMin'] == 1 and first['vegMax'] == 1,
          {'first': first, 'dockedY': docked.get('y')})
    check('first in-frustum frame fully fogged', first and first['fog'] > 0.995, {'fog': first and first['fog'], 'depth': first and first['depth']})
    shown = [s for s in samples if s.get('shown')]
    check('never below full height or shrunk while shown', all(abs(s['y'] - docked['y']) < 0.15 and s['vegMin'] == 1 for s in shown),
          {'minY': min(s['y'] for s in shown), 'maxY': max(s['y'] for s in shown), 'samples': len(shown)})
    check('spawned out of sight', not samples[0].get('inFrustum') or samples[0]['fog'] > 0.999, {'spawn': samples[0]})

    # leave: skip to the end of the dock, then step out
    ph = page.evaluate('raftDebug.content.islands.phase()')
    page.evaluate(f'raftDebug.content.islands.skip({ph["left"] + 0.01})')
    samples = []; want = {30: 'leave-30m', 100: 'leave-100m', 150: 'leave-150m', 185: 'leave-185m'}
    for i in range(2000):
        page.evaluate(AIM); frame(page)
        s = page.evaluate(SAMPLE); samples.append(s)
        if s.get('inFrustum'): last = s
        if s.get('shown'):
            for d in sorted(want):
                if s['dist'] >= d: shot(page, want.pop(d)); break
        if s['phase'] != 'depart': break
        page.evaluate('raftDebug.content.islands.skip(0.25)')
    shown = [s for s in samples if s.get('shown')]
    check('last in-frustum frame at full height', last and abs(last['y'] - docked['y']) < 0.15 and last['vegMin'] == 1, {'last': last})
    check('fully fogged before it leaves the frustum', last and last['fog'] > 0.99, {'fog': last and last['fog']})
    check('never sinks while leaving', all(abs(s['y'] - docked['y']) < 0.15 and s['vegMin'] == 1 for s in shown), {'samples': len(shown)})
    check('gone afterwards', samples[-1]['phase'] == 'calm', {'end': samples[-1]})
    check('no page errors', not report['errors'] and not report['console'], {})
    b.close()
srv.shutdown()
report['ok'] = ok
print(json.dumps(report, indent=1, default=str))
sys.exit(0 if ok else 1)
