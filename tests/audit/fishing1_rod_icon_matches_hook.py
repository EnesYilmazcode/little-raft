"""AUDIT FISHING-1 (browser): the Fishing Rod hotbar slot renders the exact same icon as the Hook
(<use href="...#icon-hook">), so the two tools are indistinguishable. Exit 1 on bug.
Usage: python tests/audit/fishing1_rod_icon_matches_hook.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch
from _save import rod_save

url, srv = serve()
with launch(viewport=(480, 300), init_script=rod_save(0)) as (b, pg):
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000)
    pg.locator('#solo').click(); pg.wait_for_function('raftDebug.state.running', timeout=60000)
    pg.wait_for_function("document.querySelector('.tools .sv-slot[data-slot=\"1\"] svg')", timeout=60000)
    icons = pg.evaluate("""[0,1].map(i => document.querySelector(`.tools .sv-slot[data-slot="${i}"] svg`).innerHTML)""")
srv.shutdown()
print('hook slot icon:', icons[0][:120]); print('rod  slot icon:', icons[1][:120])
if icons[0] == icons[1]:
    print('FAIL: Fishing Rod hotbar icon is identical to the Hook icon'); sys.exit(1)
print('PASS')
