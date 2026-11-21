"""AUDIT AUDIO-1 (browser): turning Sound off with #soundButton must survive a page reload.
On main the label returns to 'Sound: on' and the next hook throw beeps again.
Exit 1 on bug. Usage: python tests/audit/audio1_sound_toggle_persists.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

INIT = """(() => { window.__osc = 0; const o = BaseAudioContext.prototype.createOscillator;
  BaseAudioContext.prototype.createOscillator = function(...a){ window.__osc++; return o.apply(this, a); }; })();"""
fails = []
url, srv = serve()
with launch(init_script=INIT) as (b, page):
    page.goto(url); page.wait_for_function('!!window.raftDebug', timeout=60000)
    page.evaluate("document.getElementById('soundButton').click()")
    label = page.evaluate("document.getElementById('soundButton').textContent")
    if label != 'Sound: off': fails.append(f'toggle did not turn sound off: {label!r}')
    page.reload(); page.wait_for_function('!!window.raftDebug', timeout=60000)
    label = page.evaluate("document.getElementById('soundButton').textContent")
    if label != 'Sound: off': fails.append(f'after reload sound label is {label!r}, expected "Sound: off"')
    page.locator('#solo').click(); page.wait_for_function('raftDebug.state.running', timeout=60000)
    page.wait_for_timeout(1000)
    page.mouse.move(640, 360); page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.wait_for_function("raftDebug.state.hookStage !== 'idle'", timeout=30000)
    page.wait_for_timeout(500)
    n = page.evaluate('window.__osc')
    if n: fails.append(f'after reload with sound off, hook throw created {n} oscillator(s) (beeped)')
srv.shutdown()
for f in fails: print('FAIL:', f)
print('PASS' if not fails else 'FAILED'); sys.exit(1 if fails else 0)
