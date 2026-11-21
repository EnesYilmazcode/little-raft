"""Shark visual probe: python tests/e2e/shark_probe.py dist <out_dir>. Forces an attack via raftDebug.shark, screenshots circle, bite, broken tile, dead body, harvest; prints JSON (errors must be [])."""
import sys, json, math, threading, functools, http.server, socketserver, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()
rep = {'errors': [], 'console': [], 'log': []}

def look_at(page, x, y, z):
    page.evaluate(f"""(()=>{{const m=raftDebug.state.me;const dx={x}-m.x,dy={y}-m.y,dz={z}-m.z;raftDebug.aim(Math.atan2(dy,Math.hypot(dx,dz)),Math.atan2(-dx,-dz));}})()""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: rep['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and rep['console'].append(m.text[:300]))
    sh = lambda: page.evaluate('({state:raftDebug.shark.state,hp:raftDebug.shark.hp,timer:raftDebug.shark.timer,pose:raftDebug.shark.pose,target:raftDebug.shark.target,tileHp:raftDebug.shark.tileHp,tiles:raftDebug.state.tiles,me:raftDebug.state.me})')
    def wait_state(pred, secs):
        page.wait_for_function(pred, timeout=secs * 1000, polling=250)
    try:
        page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=90000)
        page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=60000)
        page.wait_for_timeout(1500)
        rep['fps0'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now();function f(t){if(++n<30)requestAnimationFrame(f);else r((t-t0)/n)}requestAnimationFrame(f)})""")
        rep['log'].append(['start', sh()])
        wait_state('Math.hypot(raftDebug.shark.pose.x,raftDebug.shark.pose.z)<11', 120)
        s = sh(); look_at(page, s['pose']['x'], -0.3, s['pose']['z']); page.wait_for_timeout(100)
        page.screenshot(path=str(out / 's1-circle.png'))
        rep['log'].append(['circle', sh()])
        rep['calls'] = page.evaluate('raftDebug.renderInfo')
        page.evaluate('raftDebug.shark.forceAttack()')
        wait_state('raftDebug.shark.state==="bite"', 240)
        wait_state('Object.keys(raftDebug.shark.tileHp).length>0 && Object.values(raftDebug.shark.tileHp)[0]<=40', 240)
        s = sh(); t = s['target']
        look_at(page, t['x'] * 2 + t['nx'] * 1.2, -0.1, t['z'] * 2 + t['nz'] * 1.2); page.wait_for_timeout(150)
        page.screenshot(path=str(out / 's2-bite.png'))
        rep['log'].append(['bite', s, page.evaluate("document.querySelector('#contextPrompt').textContent")])
        wait_state('raftDebug.shark.state==="flee"', 240)
        page.screenshot(path=str(out / 's3-broken.png'))
        rep['log'].append(['broken', sh(), page.evaluate("document.querySelector('#contextPrompt').textContent")])
        page.evaluate('raftDebug.shark.kill()')
        page.wait_for_timeout(8000)
        s = sh(); look_at(page, s['pose']['x'], -0.2, s['pose']['z']); page.wait_for_timeout(150)
        page.screenshot(path=str(out / 's4-dead.png'))
        rep['log'].append(['dead', s, page.evaluate('raftDebug.shark.canHarvest'), page.evaluate("document.querySelector('#contextPrompt').textContent")])
        rep['log'].append(['harvest', page.evaluate('raftDebug.shark.harvest()'), page.evaluate("({m:raftDebug.state.stock.sharkmeat,h:raftDebug.state.stock.sharkhead})")])
        page.wait_for_timeout(500); page.screenshot(path=str(out / 's5-harvested.png'))
        rep['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<60)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
    except Exception:
        rep['fail'] = traceback.format_exc()[-600:]
        try: rep['log'].append(['at-fail', sh()]); page.screenshot(path=str(out / 'fail.png'))
        except Exception: pass
    b.close()
srv.shutdown()
print(json.dumps(rep, indent=1, default=str))
