"""AUDIT UI-2 (browser): the crafting list is capped at max-height:min(520px, 94vh - 30px)
(survival-ui.js ~145), so at 1920x1080 the last recipes (Bench, Crate) sit below the fold with no visible
scrollbar or fade, although ~280px of screen height is unused. They can be wheel-scrolled to, so this is a
discoverability defect. Contract: at 1920x1080 every recipe is visible without scrolling.
Exit 1 on bug. Usage: python tests/audit/ui2_craft_list_cut_off.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

url, srv = serve()
with launch(viewport=(1920, 1080)) as (b, pg):
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000)
    pg.locator('#solo').click(); pg.wait_for_function('raftDebug.state.running', timeout=60000); pg.wait_for_timeout(800)
    pg.keyboard.press('KeyI'); pg.wait_for_function('raftDebug.state.inventoryOpen', timeout=60000); pg.wait_for_timeout(800)
    r = pg.evaluate("""()=>{const c=document.querySelector('#inventory .sv-craft'),cb=c.getBoundingClientRect();
      const hidden=[...c.querySelectorAll('.sv-recipe')].filter(e=>e.getBoundingClientRect().bottom>cb.bottom+1).map(e=>e.querySelector('.sv-rname').textContent);
      return {h:c.clientHeight,need:c.scrollHeight,vh:innerHeight,hidden}}""")
srv.shutdown()
print(r)
if r['hidden']:
    print(f"FAIL: {len(r['hidden'])} recipes below the fold ({', '.join(r['hidden'])}): list {r['h']}px of {r['need']}px at viewport height {r['vh']}"); sys.exit(1)
print('PASS')
