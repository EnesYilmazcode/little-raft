"""AUDIT NET-1 (browser, fake PeerJS transport): co-op drops when either player's tab is backgrounded
for > 8 s. All sends (host state, guest 'move' keepalive) and both 8 s liveness checks run only inside
the requestAnimationFrame loop (game.js frame()); Chrome stops rAF in hidden tabs while timers and data
channels keep running. Simulated by suspending rAF on one page. A control run (no suspension) must stay
connected, so a failure is not just harness slowness. Exit 1 on bug.
Usage: python tests/audit/net1_background_tab_drops_coop.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from _fakenet import serve, launch, new_page, connect, FakeNet, S

HIDE_RAF = "(() => { window.requestAnimationFrame = () => 0; })()"

def session(b, url, hide):
    h = new_page(b, url); g = new_page(b, url); net = FakeNet([h, g]); connect(net, h, g)
    if hide == 'host': h.evaluate(HIDE_RAF)
    if hide == 'guest': g.evaluate(HIDE_RAF)
    net.run(11000)
    hs, gs = S(h), S(g)
    h.context.close(); g.context.close()
    return {'guestRole': gs['role'], 'guestReady': gs['networkReady'], 'hostSeesGuest': bool(hs['other'])}

srv, url = serve()
fails = []
with sync_playwright() as p:
    b = launch(p)
    try:
        ctl = session(b, url, None); print('control:', ctl)
        if not (ctl['guestRole'] == 'guest' and ctl['guestReady'] and ctl['hostSeesGuest']):
            print('INCONCLUSIVE: control session did not stay connected'); sys.exit(2)
        for side in ('host', 'guest'):
            r = session(b, url, side); print(f'{side} tab hidden 11 s:', r)
            if not (r['guestRole'] == 'guest' and r['guestReady'] and r['hostSeesGuest']):
                fails.append(f'co-op dropped after {side} tab was backgrounded 11 s: {r}')
    finally:
        b.close(); srv.shutdown()
for f in fails: print('FAIL:', f)
print('PASS' if not fails else 'FAILED'); sys.exit(1 if fails else 0)
