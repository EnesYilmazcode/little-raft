"""AUDIT BUILDING-1 (browser): with a hammer, the placement preview (placementFor/placementCandidates)
offers cells beyond the host's limits (|x|,|z| > 25, or 400 tiles); the ghost is green, the hammer swings,
and the host silently drops the build. Contract: raftDebug.placements must only list cells the host accepts.
Exit 1 on bug. Usage: python tests/audit/building1_ghost_beyond_bounds.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

s = [None] * 28
for i, v in enumerate([{'kind': 'hammer', 'count': 1, 'durability': 100}, {'kind': 'wood', 'count': 20}, {'kind': 'plastic', 'count': 20}]): s[i] = v
tiles = [[x, z] for x in range(-1, 2) for z in range(-1, 2)] + [[x, 0] for x in range(2, 26)]  # strip reaches the x=25 limit
save = {'tiles': tiles, 'decor': [], 'fish': 0, 'collected': 5, 'items': [],
        'hostInventory': {'slots': s, 'selected': 0}, 'guestInventory': {'slots': [None] * 28, 'selected': 0}}
url, srv = serve()
with launch(init_script='localStorage.setItem("little-raft-v1", %s)' % json.dumps(json.dumps(save))) as (b, page):
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running && raftDebug.state.heldKind === "hammer"', timeout=60000)
    n = page.evaluate('raftDebug.state.tiles')
    bad = [(c['x'], c['z']) for c in page.evaluate('raftDebug.placements') if abs(c['x']) > 25 or abs(c['z']) > 25]
srv.shutdown()
if n != len(tiles): print(f'FAIL: save did not load ({n} tiles)'); sys.exit(2)
if bad: print(f'FAIL: build preview offers cells the host always rejects: {bad}'); sys.exit(1)
print('PASS')
