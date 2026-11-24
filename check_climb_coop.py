"""Co-op guest climbing over the loopback transport: the guest (its own PlayerPhysics + BuildGrid fed by host snapshots)
hops onto a crate and clambers onto a wall top; the host sees the guest's pose up there. usage: python check_climb_coop.py [dist] [out.json]"""
import sys, json, functools, threading, http.server, socketserver
from playwright.sync_api import sync_playwright
dist = sys.argv[1] if len(sys.argv) > 1 else "dist"; out = sys.argv[2] if len(sys.argv) > 2 else "/dev/null"
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=dist)); threading.Thread(target=s.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{s.server_address[1]}/index.html?loopback'
tiles = [[x, z] for x in range(-2, 3) for z in range(-2, 3)]
save = {'tiles': tiles, 'decor': [{'type': 'crate', 'x': -1, 'z': 0}], 'pieces': [{'t': 'wall', 'i': 1, 'j': -1, 'l': 0, 'r': 0}],
        'stock': {}, 'fish': 0, 'collected': 1}
INIT = '''for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) { if (!C) continue;
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = C.prototype[k]; if (o) C.prototype[k] = function (...a) { return; }; } }
HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('QA fallback')); };
try { if (!localStorage.getItem('little-raft-v1')) localStorage.setItem('little-raft-v1', %s); localStorage.setItem('little-raft-settings', JSON.stringify({graphics:'low', volume:0})); } catch {}
''' % json.dumps(json.dumps(save))
HOOK = '''(async () => { const urls = performance.getEntriesByType('resource').map(e => e.name);
  const BP = await import(urls.find(u => u.includes('/building-pieces.js')));
  const o = BP.BuildGrid.prototype.preStep; BP.BuildGrid.prototype.preStep = function (ph, d, c) { window.__ph = ph; window.__d = d; window.__g = this; return o.call(this, ph, d, c); };
  window.__climbed = false; const PP = await import(urls.find(u => u.includes('/player-physics.js')));
  const u = PP.PlayerPhysics.prototype.update; PP.PlayerPhysics.prototype.update = function (...a) { const r = u.apply(this, a); if (this.climbing && this.ledgeProgress() >= 0) window.__climbed = true; return r; }; })()'''
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 960, 'height': 540}); ctx.add_init_script(INIT)
    host, guest = ctx.new_page(), ctx.new_page(); errs = []
    for n, pg in (('host', host), ('guest', guest)): pg.on('pageerror', lambda e, n=n: errs.append(n + ': ' + str(e)[:200]))
    for pg in (host, guest): pg.goto(URL); pg.wait_for_function('!!window.raftDebug && !!window.coopChaos', timeout=60000)
    host.evaluate("document.querySelector('#welcomeCrew').click()"); host.wait_for_timeout(300); host.evaluate("document.querySelector('#host').click()")
    host.wait_for_function("document.querySelector('#roomCode').textContent.length === 6", timeout=20000)
    code = host.locator('#roomCode').inner_text()
    guest.evaluate("document.querySelector('#welcomeCrew').click()"); guest.wait_for_timeout(300); guest.evaluate(f"document.querySelector('#roomInput').value = '{code}'; document.querySelector('#roomInput').dispatchEvent(new Event('input', {{bubbles:true}})); document.querySelector('#joinForm button').click()")
    guest.wait_for_function('window.raftDebug.state.networkReady', timeout=30000); host.wait_for_function('!!window.raftDebug.state.other', timeout=30000)
    res['roles'] = [host.evaluate('raftDebug.state.role'), guest.evaluate('raftDebug.state.role')]
    guest.evaluate(HOOK); guest.wait_for_timeout(1500)
    res['guestPieces'] = guest.evaluate('window.__g.list.length')
    def hop(x, z, until, name):
        guest.evaluate(f'(() => {{ const p = window.__ph; p.x = {x}; p.z = {z}; p.y = window.__d + 1.6; p.vx = p.vy = p.vz = 0; p.grounded = true; window.__climbed = false; raftDebug.aim(-0.2, 0); }})()')
        guest.wait_for_timeout(600)
        guest.bring_to_front(); guest.keyboard.down('KeyW'); guest.keyboard.down('Space'); guest.wait_for_timeout(250); guest.keyboard.up('Space')
        ok = True
        try: guest.wait_for_function(f'window.__ph.grounded && window.__ph.y - 1.6 - window.__d > {until}', timeout=20000)
        except Exception: ok = False
        guest.keyboard.up('KeyW'); guest.wait_for_timeout(2500)
        g = guest.evaluate('({feet:+(window.__ph.y - 1.6 - window.__d).toFixed(3), x:window.__ph.x, z:window.__ph.z, climbed:window.__climbed})')
        h = host.evaluate('(() => { const o = raftDebug.state.other; return o ? {y:o.y, x:o.x, z:o.z} : null; })()')
        hd = host.evaluate('raftDebug.state.raft ? raftDebug.state.raft.y : null')
        res[name] = {'reached': ok, 'guest': g, 'hostSeesGuest': h}
        print(name, res[name], flush=True)
    hop(-2, 0.42 + 0.25 + 0.06, 0.6, 'crate')
    hop(2, -3 + 0.07 + 0.25 + 0.05, 2.0, 'wall')
    res['errors'] = errs
    b.close()
json.dump(res, open(out, 'w'), indent=1); print(json.dumps(res, indent=1))
