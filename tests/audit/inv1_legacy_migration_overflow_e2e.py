"""AUDIT INV-1 (browser): a v2 save with large shared stock loses supplies on first v3 load and the
loss is written back to localStorage by the next save.
Contract for the fix: for each kind, saved hostInventory count + saved world.legacyOverflow[kind]
equals the legacy stock. Exit 1 on bug. Usage: python tests/audit/inv1_legacy_migration_overflow_e2e.py
(env RAFT_DIST overrides dist; env CHROMIUM overrides the browser binary)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

tiles = [[x, z] for x in range(-1, 2) for z in range(-1, 2)] + [[2, 0], [3, 0], [2, 1]]
STOCK = {'wood': 600, 'leaf': 120, 'scrap': 40}
V2 = {'tiles': tiles, 'decor': [{'type': 'net', 'x': 2, 'z': 0}], 'stock': STOCK, 'fish': 7, 'collected': 500, 'hookHealth': 40}
url, srv = serve()
with launch() as (b, page):
    page.goto(url); page.evaluate('s => localStorage.setItem("little-raft-v1", s)', json.dumps(V2)); page.reload()
    page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('#solo').click(timeout=120000); page.wait_for_function('raftDebug.state.running', timeout=60000)
    page.evaluate("dispatchEvent(new Event('beforeunload'))")  # same save() path as autosave
    saved = json.loads(page.evaluate('localStorage.getItem("little-raft-v1")'))
srv.shutdown()
bag = {}
for s in saved['hostInventory']['slots']:
    if s: bag[s['kind']] = bag.get(s['kind'], 0) + s['count']
over = saved.get('legacyOverflow') or {}
fails = [f"{k}: legacy {n}, saved bag {bag.get(k, 0)} + overflow {over.get(k, 0)}" for k, n in STOCK.items() if bag.get(k, 0) + over.get(k, 0) != n]
for f in fails: print('FAIL:', f)
print('PASS' if not fails else 'FAILED'); sys.exit(1 if fails else 0)
