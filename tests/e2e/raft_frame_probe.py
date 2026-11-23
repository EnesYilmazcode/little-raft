"""In-game raft-frame probe. Usage: python tests/e2e/raft_frame_probe.py <dist_dir> [seconds]
Starts a solo game, walks off the raft centre, stands still and samples every frame: the player's feet
(camera minus the eye height) in the raft group's local frame. Standing still on the deck, that point
should not move at all while the raft heaves, pitches and rolls. Prints JSON (metres)."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve()
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 8

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'

SAMPLE = """async secs => {
  const {T, scene, camera} = window.raftMount, st = raftDebug.state, r = st.raft;
  let raft = null;
  scene.traverse(o => { if (!raft && o.isGroup && o.parent === scene && Math.abs(o.position.y - r.y) < 1e-9 && Math.abs(o.rotation.x - r.pitch) < 1e-9 && Math.abs(o.rotation.z - r.roll) < 1e-9 && o.children.length) raft = o; });
  if (!raft) return {error: 'raft group not found'};
  const v = new T.Vector3(), xs = [], ys = [], zs = [], dts = [];
  let tilt = 0, last = performance.now();
  const t0 = last;
  await new Promise(done => {
    const tick = now => {
      raft.updateMatrixWorld(true);
      v.set(camera.position.x, camera.position.y - 1.6, camera.position.z); raft.worldToLocal(v);
      xs.push(v.x); ys.push(v.y); zs.push(v.z); dts.push(now - last); last = now;
      tilt = Math.max(tilt, Math.abs(raft.rotation.x), Math.abs(raft.rotation.z));
      if (now - t0 < secs * 1000) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  const sd = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
  let jerk = 0; for (let i = 2; i < ys.length; i++) jerk = Math.max(jerk, Math.abs(ys[i] - 2 * ys[i - 1] + ys[i - 2]));
  const me = raftDebug.state.me;
  return {frames: xs.length, fps: 1000 * dts.length / dts.reduce((p, q) => p + q, 0), maxTiltRad: tilt,
    localSd: Math.hypot(sd(xs), sd(ys), sd(zs)), localSdY: sd(ys), localRangeY: Math.max(...ys) - Math.min(...ys), maxJerkY: jerk,
    player: {x: me.x, z: me.z}, grounded: raftDebug.state.grounded};
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 960, 'height': 540})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url); page.wait_for_function('!!window.raftDebug && !!window.raftMount', timeout=60000)
    page.wait_for_timeout(800)
    page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click()
    page.wait_for_function('raftDebug.state.running', timeout=15000)
    page.wait_for_timeout(1200)
    page.mouse.move(480, 270)
    page.keyboard.down('w'); page.keyboard.down('d'); page.wait_for_timeout(700); page.keyboard.up('w'); page.keyboard.up('d')
    page.wait_for_timeout(1500)
    out = page.evaluate(SAMPLE, secs)
    out['errors'] = errors
    print(json.dumps(out, indent=1))
    b.close()
srv.shutdown()
