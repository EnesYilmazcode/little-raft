"""ui-feel in the REAL game, headless.
Usage: python sandbox/ui-feel/realgame.py [--hook-tries N] [--freeze MS] [--phone]

1. Copies dist/ to a temp folder and applies docs/tech/ui-feel-ADOPT.md (steps 1, 2, 3a-3i) as exact string
   replacements; each must match exactly once, so this also proves ADOPT is current against dist.
2. Boots the game (Solo), checks the feel layer attached, then tries to land a real hook catch
   (aim at a supply, charge, throw, hold to reel). SwiftShader runs the game at a few fps and the throw is
   ballistic, so a catch is not guaranteed; after N misses it falls back to a scratch-only QA line
   (`window.__qaAction = a => action(a)`, added to the temp copy only) that sends the same
   {kind:'collect'} action the hook sends on a catch. Either way the loot reaches ui-feel through the real
   applyAction -> emit -> effect -> feelEffect -> uiFeel.pickup path.
3. Freezes every animation MS after the pickup and writes sandbox/ui-feel/shots/rg-*.png. Prints JSON.
"""
import sys, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'sandbox/ui-feel/shots'; OUT.mkdir(parents=True, exist_ok=True)
argv = sys.argv[1:]
TRIES = int(argv[argv.index('--hook-tries') + 1]) if '--hook-tries' in argv else 2
FREEZE_MS = int(argv[argv.index('--freeze') + 1]) if '--freeze' in argv else 330
PHONE = '--phone' in argv
W, H = (390, 844) if PHONE else (1280, 720)
PFX = 'rg-phone-' if PHONE else 'rg-'
TOK = 'v3-survival-ae77fa84ac2b'

# ---------- 1. ADOPT on a scratch copy ----------
tmp = Path(tempfile.mkdtemp(prefix='uifeel-rg-'))
D = tmp / 'dist'
shutil.copytree(REPO / 'dist', D)
shutil.copy(REPO / 'sandbox/ui-feel/ui-feel.js', D / 'ui-feel.js')                       # step 1

def edit(name, pairs):
    p = D / name; s = p.read_text()
    for step, a, b in pairs:
        n = s.count(a)
        assert n == 1, f'ADOPT step {step}: expected 1 match in dist/{name}, found {n}: {a[:80]!r}'
        s = s.replace(a, b)
    p.write_text(s)

edit('survival-ui.js', [('2', 'function iconSVG(kind) {', 'export function iconSVG(kind) {')])
edit('game.js', [
    ('3a', f"import {{ createSurvivalUI }} from './survival-ui.js?build={TOK}';",
     f"import {{ createSurvivalUI, iconSVG }} from './survival-ui.js?build={TOK}';\nimport {{ createUIFeel }} from './ui-feel.js?build={TOK}';"),
    ('3b', "  let survivalUI = null, settingsController = null, options =", "  let survivalUI = null, uiFeel = null, settingsController = null, options ="),
    ('3c', "      onPause:guard(clearInput),\n    });\n",
     "      onPause:guard(clearInput),\n    });\n"
     "    try { uiFeel = createUIFeel({ getBag: () => localBag(), iconHTML: iconSVG, hotbarSize: HOTBAR }); }\n"
     "    catch (e) { uiFeel = null; console.error('ui-feel failed', e); } // purely cosmetic: never block the game\n"),
    ('3d', "    try { survivalUI?.destroy?.(); } catch {}\n", "    try { survivalUI?.destroy?.(); } catch {}\n    try { uiFeel?.destroy(); } catch {}\n"),
    ('3e', """    if (typeof e.text === 'string' && e.text) notice(e.text.slice(0, 90));
    beep(e.kind === 'build' ? 640 : e.kind === 'craft' ? 560 : e.kind === 'full' ? 220 : 440);
  }
""", """    const felt = uiFeel && feelEffect(e);
    if (typeof e.text === 'string' && e.text && !felt) notice(e.text.slice(0, 90));
    beep(e.kind === 'build' ? 640 : e.kind === 'craft' ? 560 : e.kind === 'full' ? 220 : 440);
  }
  // Loot / craft / build / full go to the toast stack (and fly into the hotbar); 'notice' stays under the crosshair.
  function feelEffect(e) {
    const name = k => ITEM_INFO[k]?.name ?? k;
    if (e.kind === 'loot' && e.loot && typeof e.loot === 'object') {
      const items = Object.entries(e.loot).filter(([k, n]) => ITEM_INFO[k] && n > 0).map(([kind, count]) => ({kind, count}));
      uiFeel.pickup(items);
      uiFeel.crosshair.hit('gold');
      for (const it of items) uiFeel.toast(name(it.kind), {kind:'loot', icon:iconSVG(it.kind), amount:it.count, key:'loot:' + it.kind});
      return true;
    }
    if (e.kind === 'craft') { uiFeel.crafted(e.recipe); uiFeel.toast(e.text, {kind:'craft', icon:ITEM_INFO[e.recipe] ? iconSVG(e.recipe) : ''}); return true; }
    if (e.kind === 'build') { uiFeel.crosshair.hit('hit'); uiFeel.toast(e.text, {kind:'build'}); return true; }
    if (e.kind === 'full') { uiFeel.crosshair.hit('deny'); uiFeel.toast(e.text, {kind:'full'}); return true; }
    return false;
  }
"""),
    ('3f supply', "      if (!a.net) emit({kind:'loot', text:'+ '", "      if (!a.net) emit({kind:'loot', loot, text:'+ '"),
    ('3f fish', "      world.fish++; emit({kind:'loot', text:'You caught a fish!'}, actor); return;",
     "      world.fish++; emit({kind:'loot', loot:{fish:1}, text:'You caught a fish!'}, actor); return;"),
    ('3f craft', "      if (r.ok) emit({kind:'craft', text:`Crafted", "      if (r.ok) emit({kind:'craft', recipe:a.recipe, text:`Crafted"),
    ('3g', "    refreshPointerUI(); updateCharge(); updateContext(dialog);\n",
     "    refreshPointerUI(); updateCharge(); updateContext(dialog);\n"
     "    if (uiFeel) { uiFeel.crosshair.hover(!!pickTarget || !!hover); uiFeel.crosshair.charge(charging && running ? chargeValue() : null); }\n"),
    ('3h', "    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) beep(520 + caught.length * 30); lastCaughtCount = caught.length; }",
     "    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) { beep(520 + caught.length * 30); uiFeel?.crosshair.hit('gold'); } lastCaughtCount = caught.length; }"),
    # NOT part of ADOPT: scratch-only QA line for the fallback in step 2.
    ('qa', "  window.raftDebug = debugApi;\n", "  window.raftDebug = debugApi;\n  window.__qaAction = a => action(a);\n"),
])
css = D / 'graphics.css'; css.write_text(css.read_text() + '\nhtml:has(#crosshair.uf-xh) #chargeMeter{display:none!important}\n')  # 3i

# ---------- 2/3. drive it ----------
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(tmp)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/dist/index.html'
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
# Wrap the live instance's pickup: run it, and once effect() has also queued its toasts (a microtask later, same
# task) pause every animation at currentTime = ms. Wall-clock waits do not work here: SwiftShader renders the game
# at a few fps, so 330 ms after the pickup its animations have often not had their first frame yet. After the
# first pickup the game's rAF is throttled to one frame per 1.5 s (harness only), so the compositor keeps up and
# the toasts, whose 3.2 s life is wall-clock, are seen in their real timing.
FREEZE = """ms => { const f = window.__littleRaftUIFeel, orig = f.pickup; window.__flies = 0;
  f.pickup = (items, from) => { orig(items, from); window.__loot = items;
    if (window.__flies === 0) { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => setTimeout(() => raf(cb), 1500); }
    if (++window.__flies === 1) queueMicrotask(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } window.__frozen = 1; }); }; }"""
SEEK = '(ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }'
log, errors = {'adopt': 'all steps matched exactly once', 'viewport': [W, H]}, []
shots = []
def shot(name, **kw):
    pg.screenshot(path=str(OUT / f'{PFX}{name}.png'), **kw); shots.append(f'{PFX}{name}.png')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)
    c = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2 if PHONE else 1)
    c.add_init_script("HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error('QA fallback'))};")
    pg = c.new_page(); pg.set_default_timeout(180000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text[:200]))
    pg.goto(URL); pg.wait_for_function('!!window.raftDebug', timeout=60000)
    pg.locator('#solo').click()
    pg.wait_for_function('raftDebug.state.running', timeout=60000)
    pg.wait_for_timeout(1500)
    log['feelAttached'] = pg.evaluate("!!window.__littleRaftUIFeel && !!document.querySelector('#crosshair.uf-xh') && !!document.querySelector('.uf-cursor.on')")
    log['toastsInTopLayer'] = pg.evaluate("document.getElementById('uf-toasts').matches(':popover-open')")
    pg.mouse.click(W / 2, H * .3); pg.wait_for_timeout(600)       # first click: pointer lock is refused -> drag/aim fallback
    log['lockFallback'] = pg.evaluate('raftDebug.state.lockFallback')
    pg.evaluate(FREEZE, FREEZE_MS)
    VIS = f't=>t.screen?.visible&&!t.pending&&t.screen.x>{W*.15}&&t.screen.x<{W*.85}&&t.screen.y>{H*.3}&&t.screen.y<{H*.85}'
    log['via'] = None; tries = []
    for attempt in range(TRIES):
        ts = pg.evaluate(f'raftDebug.targets.filter({VIS}&&t.distance>4&&t.distance<14).sort((a,b)=>a.distance-b.distance)')
        if not ts: pg.wait_for_timeout(800); continue
        t = ts[0]; s = t['screen']
        pg.mouse.move(s['x'], s['y']); pg.mouse.down(); pg.wait_for_timeout(600)
        if attempt == 0: shot('01-charge')
        pg.wait_for_timeout(350); pg.mouse.up()
        try: pg.wait_for_function('raftDebug.state.hookStage!=="flying"', timeout=8000)
        except Exception: pass
        pg.mouse.down(); hooked = None
        for _ in range(80):
            st = pg.evaluate('({stage: raftDebug.state.hookStage, n: raftDebug.state.hookCaughtItems.length, frozen: window.__frozen})')
            if st['n'] and not hooked: hooked = st; shot('02-hooked')
            if st['frozen'] or st['stage'] == 'idle': break
            pg.wait_for_timeout(150)
        pg.mouse.up()
        tries.append({'type': t['type'], 'dist': round(t['distance'], 1), 'hooked': bool(hooked), 'landedLoot': bool(st['frozen'])})
        if st['frozen']: log['via'] = 'hook catch'; break
        pg.wait_for_timeout(400)
    log['hookTries'] = tries
    if not log['via']:
        # Fallback: the same collect action a catch sends, on the nearest visible supply (prefer a barrel: 4 items).
        ts = pg.evaluate(f'raftDebug.targets.filter({VIS}).sort((a,b)=>(b.type==="barrel")-(a.type==="barrel")||a.distance-b.distance)')
        if not ts: ts = pg.evaluate('raftDebug.targets.filter(t=>!t.pending)')
        t = ts[0]; log['via'] = 'qa collect action (' + t['type'] + ')'
        pg.evaluate('t => window.__qaAction({kind:"collect", id:t.id, token:t.token})', t)
        pg.wait_for_function('window.__frozen === 1', timeout=15000)
    shot('03-loot-fly-330ms')
    log['diag'] = pg.evaluate("""() => ['#uf-toasts', '.uf-toast', '#uf-layer', '.uf-fly', '#crosshair'].map(sel => {
      const e = document.querySelector(sel); if (!e) return sel + ': missing';
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      return `${sel}: display=${cs.display} vis=${cs.visibility} op=${cs.opacity} z=${cs.zIndex} pos=${cs.position} rect=${r.x|0},${r.y|0},${r.width|0}x${r.height|0} anims=${e.getAnimations().length} parent=${e.parentElement?.tagName}`; })""")
    log['loot'] = pg.evaluate('window.__loot')
    log['hotbar'] = pg.evaluate('raftDebug.state.inventory.slots.slice(0,8).map(s => s ? s.kind + "x" + s.count : null)')
    pg.evaluate(SEEK, 600); pg.wait_for_timeout(150); shot('04-flight-600ms')
    pg.evaluate('document.getAnimations().forEach(a => a.play())')
    pg.wait_for_timeout(900); shot('05-toasts')
    # open the inventory and craft whatever the loot allows (craft toast must sit above the backdrop)
    pg.keyboard.press('Tab'); pg.wait_for_timeout(600)
    btn = pg.locator('#inventory .sv-recipe:not([disabled])')
    log['craftable'] = btn.count()
    if btn.count():
        btn.first.click(); pg.wait_for_timeout(500)
    shot('06-inventory-craft')
    log['toastsAboveInventory'] = pg.evaluate("document.getElementById('uf-toasts').matches(':popover-open') && document.getElementById('inventory').open")
    log['errors'] = errors
    b.close()
srv.shutdown()
if "--keep" in argv: log["scratch"] = str(tmp)
else: shutil.rmtree(tmp, ignore_errors=True)
log['shots'] = shots
print(json.dumps(log, indent=1))
