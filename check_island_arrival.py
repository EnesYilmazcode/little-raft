"""Headless probe: islands arrive and leave at the draw distance, never rising or sinking in view.
Usage: python check_island_arrival.py [dist_dir] [shot_dir]
Starts its own static server and a fresh solo game, spawns an island far out with the islands QA hook,
steps its clock frame by frame with the camera turned toward it, and asserts with the live camera
frustum, camera.far and scene fog that it is at full height (vegetation at full scale) on the first
frame any part of it is in view, already fully fogged, and that it never moves vertically while in
view on the way out. Then saves screenshots of the approach (far in fog, mid, near, docked)."""
import sys, json, threading, functools, http.server, socketserver, os
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else '.qa/island').resolve(); out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
exe = next((e for e in ('/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome') if os.path.exists(e)), None)

# Runs in the page. Steps the island clock by `step` s per animation frame and records, per frame, the
# island's height, vegetation scale and whether its bounding sphere is inside the camera frustum.
PROBE = """async ([seed, step]) => {
  const {T, scene, camera} = window.raftMount, isl = raftDebug.content.islands;
  const group = scene.getObjectByName('islands'), lagoon = scene.getObjectByName('islandLagoon');
  const fr = new T.Frustum(), pv = new T.Matrix4(), sph = new T.Sphere(), tmp = new T.Sphere();
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  isl.clear(); isl.spawnNear(seed, 0);
  const rows = [];
  let docked = false;
  for (let i = 0; i < 4000; i++) {
    let ph = isl.phase();
    if (ph.phase === 'docked' && !docked) { docked = true; isl.skip(ph.left - 0.01); ph = isl.phase(); }
    const yaw = isl.yawTo(); if (yaw !== null) raftDebug.aim(0, yaw);
    await frame();
    // what was just drawn: the island as placed and the camera as rendered this frame
    const st = isl.state(), row = { t: ph.t, phase: ph.phase, shown: st.shown, y: group.position.y, vis: group.visible, inView: false, fog: 0 };
    row.scale = group.children.filter(o => o.isInstancedMesh).every(o => o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1);
    if (st.shown) {
      camera.updateMatrixWorld();
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pv);
      let first = true;
      for (const o of [...group.children, lagoon]) {
        if (o.isInstancedMesh) { if (!o.count) continue; o.computeBoundingSphere(); tmp.copy(o.boundingSphere); }
        else { o.geometry.computeBoundingSphere(); tmp.copy(o.geometry.boundingSphere); }
        o.updateMatrixWorld(); tmp.applyMatrix4(o.matrixWorld);
        if (first) { sph.copy(tmp); first = false; } else sph.union(tmp);
      }
      row.inView = fr.intersectsSphere(sph);
      // fog on the nearest point (islands-models.js ends island fog at islandFogFar, reported as st.fogFar)
      const depth = camera.position.distanceTo(sph.center) - sph.radius, f = scene.fog;
      row.depth = depth; row.fog = smooth(f.near, Math.max(f.near + 1, Math.min(f.far, st.fogFar)), depth);
    }
    rows.push(row);
    if (ph.phase === 'calm' && docked) break;
    isl.skip(step);
  }
  return { rows, far: camera.far, fogNear: scene.fog.near, fogFar: scene.fog.far, islandFogFar: isl.state().fogFar };
}"""

report = {'errors': [], 'shots': []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=exe, headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_function('!!window.raftMount && !!raftDebug.content.islands', timeout=15000)
    # Clear midday: the thinnest fog (90 to 260 m), the hardest case. Rain pulls the fog in to 60 m.
    page.evaluate("() => { const d = raftDebug.content.daynight; if (d) { d.setPhase(0.3); d.setWeather('calm'); d.freeze(true); } }")
    page.wait_for_timeout(800)

    r = page.evaluate(PROBE, [1234, 0.25])
    rows = r['rows']; base = rows[0]['y']
    first = next(i for i, x in enumerate(rows) if x['inView'])
    last = max(i for i, x in enumerate(rows) if x['inView'])
    a, z = rows[first], rows[last]
    gone = next(i for i, x in enumerate(rows) if i > first and not x['shown'])
    shown = [x for x in rows if x['shown']]
    ys = [x['y'] for x in shown]
    dep = [x['y'] for x in rows[first:last + 1] if x['phase'] == 'depart']
    report.update(far=r['far'], fogNear=r['fogNear'], fogFar=r['fogFar'], islandFogFar=r['islandFogFar'], frames=len(rows),
                  firstInView={'t': a['t'], 'phase': a['phase'], 'y': a['y'], 'depth': a['depth'], 'fog': a['fog'], 'scale': a['scale']},
                  lastInView={'t': z['t'], 'phase': z['phase'], 'depth': z['depth'], 'fog': z['fog']},
                  removedAfterLastInView=gone > last, yRange=[min(ys), max(ys)], departYRange=[min(dep), max(dep)] if dep else None)
    assert first > 0 and not rows[0]['inView'], 'spawns out of view'
    assert a['phase'] == 'approach' and a['scale'], a
    assert a['fog'] > 0.999, f'fully fogged on its first visible frame: {a}'
    assert all(x['scale'] for x in shown), 'vegetation never scales'
    # only the gentle wave bob (a quarter of the local wave) moves it; the old rise/sink was 3 m
    assert max(ys) - min(ys) < 0.3, report['yRange']
    assert z['phase'] == 'depart' and z['fog'] > 0.999, z
    assert gone > last, 'removed only after it left view'

    # Screenshots of an approach: far in fog, mid, near, docked.
    page.evaluate('(() => { const i = raftDebug.content.islands; i.clear(); i.spawnNear(1234, 0); })()')
    for name, d in [('1-far-190m', 190), ('2-far-160m', 160), ('3-mid-110m', 110), ('4-mid-70m', 70), ('5-near-35m', 35), ('6-docked', 0)]:
        info = page.evaluate("""d => { const i = raftDebug.content.islands; let ph = i.phase();
          if (d <= 0) { if (ph.phase === 'approach') i.skip(ph.left + 1); }
          else while (ph.phase === 'approach' && Math.hypot(ph.x, ph.z) > d) { i.skip(0.25); ph = i.phase(); }
          ph = i.phase(); raftDebug.aim(-0.02, i.yawTo()); return { t: ph.t, phase: ph.phase, d: Math.hypot(ph.x, ph.z) }; }""", d)
        page.wait_for_timeout(700)
        page.evaluate('raftDebug.aim(-0.02, raftDebug.content.islands.yawTo())'); page.wait_for_timeout(300)
        path = out / f'{name}.png'; page.screenshot(path=str(path)); report['shots'].append({'path': str(path), **info})
    # ...and of it leaving: drifting off downstream into the fog.
    page.evaluate('(() => { const i = raftDebug.content.islands, ph = i.phase(); if (ph.phase === "docked") i.skip(ph.left + 0.01); })()')
    for name, d in [('7-leave-110m', 110), ('8-leave-160m', 160), ('9-leave-190m', 190)]:
        info = page.evaluate("""d => { const i = raftDebug.content.islands; let ph = i.phase();
          while (ph.phase === 'depart' && Math.hypot(ph.x, ph.z) < d) { i.skip(0.25); ph = i.phase(); }
          raftDebug.aim(-0.02, i.yawTo()); return { t: ph.t, phase: ph.phase, d: Math.hypot(ph.x, ph.z) }; }""", d)
        page.wait_for_timeout(700)
        page.evaluate('raftDebug.aim(-0.02, raftDebug.content.islands.yawTo())'); page.wait_for_timeout(300)
        path = out / f'{name}.png'; page.screenshot(path=str(path)); report['shots'].append({'path': str(path), **info})
    b.close()

assert not report['errors'], report['errors']
print(json.dumps(report, indent=1))
