"""AUDIT FISHING-2 (browser): while the rod line is out, #contextPrompt goes blank once the 2.5 s
wall-clock "Wait for a bite..." notice expires, for the rest of the 3.8-5.8 s (game time) cast,
including the bite. v2 (5b5beb7) kept "Bobbing along..." / "A bite! Pulling it in..." up.
Fails at any frame rate (notice is wall-clock, cast is game-time). Exit 1 on bug.
Usage: python tests/audit/fishing2_blank_prompt_while_fishing.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch
from _save import rod_save

url, srv = serve()
blank = None
with launch(viewport=(480, 300), init_script=rod_save(1)) as (b, pg):
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000)
    pg.locator('#solo').click(); pg.wait_for_function('raftDebug.state.running && raftDebug.state.heldKind === "fishingrod"', timeout=60000)
    pg.wait_for_timeout(800)
    pg.mouse.down(); pg.wait_for_timeout(80); pg.mouse.up()
    pg.wait_for_function('raftDebug.state.hook && raftDebug.state.hook.fishing', timeout=30000)
    for _ in range(600):
        s = pg.evaluate("""(()=>{const s=raftDebug.state, el=document.querySelector('#contextPrompt');
            return {fishing:!!(s.hook&&s.hook.fishing), t:s.hook&&s.hook.t, text:el && !el.hidden ? el.textContent.trim() : ''}})()""")
        if not s['fishing']: break
        if not s['text']: blank = s; break
        pg.wait_for_timeout(250)
srv.shutdown()
if blank:
    print(f"FAIL: context prompt is blank while the fishing line is out (game hook.t={blank['t']:.2f}s)"); sys.exit(1)
print('PASS')
