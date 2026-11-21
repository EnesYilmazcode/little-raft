"""AUDIT SAVE-2 (browser): one invalid slot in a saved v3 hostInventory (wood count 21 > stack 20)
makes the whole bag invalid; load falls back to the 4-kind legacy stock and crafted items/tools
(rope, sail) are lost, then re-saved. Expected after fix: only the bad slot is clamped/dropped.
Exit 1 on bug. Usage: python tests/audit/save2_one_bad_slot_discards_bag.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

def slots(lst): return lst + [None] * (28 - len(lst))
tiles = [[x, z] for x in range(-1, 2) for z in range(-1, 2)] + [[2, 0]]
host = {'slots': slots([{'kind': 'hook', 'count': 1, 'durability': 60}, {'kind': 'hammer', 'count': 1, 'durability': 100},
                        {'kind': 'rope', 'count': 5}, {'kind': 'sail', 'count': 1}, {'kind': 'wood', 'count': 21}]), 'selected': 2}
V3 = {'tiles': tiles, 'decor': [], 'stock': {'wood': 21, 'leaf': 0, 'scrap': 0, 'plastic': 0}, 'fish': 0, 'collected': 5,
      'hookHealth': 60, 'items': [], 'hostInventory': host, 'guestInventory': {'slots': slots([]), 'selected': 0}}
url, srv = serve()
with launch() as (b, page):
    page.goto(url); page.evaluate('s => localStorage.setItem("little-raft-v1", s)', json.dumps(V3)); page.reload()
    page.wait_for_function('!!window.raftDebug', timeout=60000)
    c = page.evaluate('raftDebug.state.stock')
srv.shutdown()
print('loaded bag:', {k: v for k, v in c.items() if v})
if c.get('rope') != 5 or c.get('sail') != 1:
    print(f'FAIL: one bad slot (wood count 21) dropped rope={c.get("rope")} sail={c.get("sail")} (expected rope 5, sail 1)'); sys.exit(1)
print('PASS')
