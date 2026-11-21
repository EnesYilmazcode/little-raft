"""Shark Bait probe: python tests/e2e/bait_probe.py dist <out_dir>. Forces a raft attack, throws a Shark Bait with a real
left click, screenshots the shark at the bait and the resume; prints JSON (errors must be [])."""
import sys, json, threading, functools, http.server, socketserver, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
url = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
threading.Thread(target=srv.serve_forever, daemon=True).start()
rep = {'errors': [], 'console': [], 'log': []}

def look_at(page, x, y, z):
    page.evaluate(f"""(()=>{{const m=raftDebug.state.me;const dx={x}-m.x,dy={y}-m.y,dz={z}-m.z;raftDebug.aim(Math.atan2(dy,Math.hypot(dx,dz)),Math.atan2(-dx,-dz));}})()""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
    page.on('pageerror', lambda e: rep['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and rep['console'].append(m.text[:300]))
    sh = lambda: page.evaluate('({state:raftDebug.shark.state,timer:raftDebug.shark.timer,pose:raftDebug.shark.pose,target:raftDebug.shark.target,bait:raftDebug.bait,me:raftDebug.state.me})')
    wait = lambda pred, secs: page.wait_for_function(pred, timeout=secs * 1000, polling=250)
    try:
        page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=90000)
        page.locator('.ob-item[data-act="new"]:visible, #solo:visible').first.click(); page.wait_for_function('raftDebug.state.running', timeout=60000)
        page.wait_for_timeout(1500)
        page.evaluate('raftDebug.shark.forceAttack()')
        wait('raftDebug.shark.state==="approach" || raftDebug.shark.state==="bite"', 30)
        rep['log'].append(['attacking', sh()])
        rep['give'] = page.evaluate("raftDebug.give('sharkbait', 2)")
        idx = page.evaluate("raftDebug.state.inventory.slots.findIndex(s => s && s.kind === 'sharkbait')")
        page.keyboard.press(str((idx + 1) % 10)); page.wait_for_timeout(500)
        rep['held'] = page.evaluate('raftDebug.state.heldKind')
        page.evaluate('raftDebug.aim(-0.05, Math.PI)'); page.wait_for_timeout(300)  # face +z, just above the horizon
        page.screenshot(path=str(out / 'b0-held.png'))
        page.mouse.move(640, 360); page.mouse.down(); page.mouse.up()
        page.wait_for_timeout(250); page.screenshot(path=str(out / 'b1-flying.png'))
        rep['log'].append(['thrown', sh()])
        wait('raftDebug.bait && raftDebug.bait.stage==="floating"', 10)
        rep['log'].append(['floating', sh(), page.evaluate("raftDebug.state.inventory.slots.filter(s=>s&&s.kind==='sharkbait').reduce((n,s)=>n+s.count,0)")])
        wait('raftDebug.shark.state==="lure"', 10)
        wait('(()=>{const s=raftDebug.shark.pose,bb=raftDebug.bait;return Math.hypot(s.x-bb.x,s.z-bb.z)<4.5})()', 60)
        page.wait_for_timeout(2500)
        s = sh(); bb = s['bait']; look_at(page, bb['x'], -0.4, bb['z']); page.wait_for_timeout(150)
        page.screenshot(path=str(out / 'b2-shark-at-bait.png'))
        rep['log'].append(['at-bait', s])
        page.wait_for_timeout(1600); s = sh(); bb = s['bait']; look_at(page, bb['x'], -0.4, bb['z']); page.wait_for_timeout(100)
        page.screenshot(path=str(out / 'b3-shark-at-bait-2.png'))
        rep['frameMs'] = page.evaluate("""new Promise(r=>{let n=0,t0=performance.now(),worst=0,last=t0;function f(t){worst=Math.max(worst,t-last);last=t;if(++n<60)requestAnimationFrame(f);else r({avg:(t-t0)/n,worst})}requestAnimationFrame(f)})""")
        rep['calls'] = page.evaluate('raftDebug.renderInfo')
        page.evaluate("raftDebug.bait.place(raftDebug.bait.x, raftDebug.bait.z, 0.5)")  # use it up early
        wait('raftDebug.shark.state==="circle"', 10)
        rep['log'].append(['resumed', sh()])
    except Exception:
        rep['fail'] = traceback.format_exc()[-800:]
        try: rep['log'].append(['at-fail', sh()]); page.screenshot(path=str(out / 'fail.png'))
        except Exception: pass
    b.close()
srv.shutdown()
print(json.dumps(rep, indent=1, default=str))
