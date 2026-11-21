"""ui-feel in the REAL game, headless.
Usage: python sandbox/ui-feel/realgame.py [--hook-tries N] [--freeze MS] [--keep] [--patch-only] [--topup]

1. Copies dist/ to a temp folder and applies docs/tech/ui-feel-ADOPT.md literally: every block tagged
   <!-- copy: ... -->, <!-- apply: FILE --> (a ```diff whose '-' and ' ' lines must occur exactly once in FILE)
   or <!-- append: FILE --> is parsed out of the doc, so the doc and this check cannot drift apart. It stops
   with an error if dist/game.js is not the N-line base the doc header names (re-check the doc first).
   A scratch-only QA line (`window.__qaAction` / `window.__qaEffect`) is added on top; it is not part of ADOPT.
   --patch-only stops here and prints the scratch folder (for running tests/ with RAFT_DIST=<it>/dist).
2. Boots the game (Solo) at 1280x720 and checks the layer attached in "main" mode (no own hotbar cursor, no
   toast popover). Tries to land a real hook catch; after N misses sends the same {kind:'collect'} action a
   catch sends. Either way loot reaches ui-feel through applyAction -> emit -> effect -> feelEffect.
3. Freezes the fly MS after the pickup (rg-01), at 600 ms (rg-02) and landed (rg-03); records that the target
   slots keep their old count until the icon lands, and that every flying icon has art (img/svg). Crafts
   through the real recipe row + craft button (rg-04, 1280x720); if nothing is craftable (or --topup) it first
   gives 2 leaf through raftDebug.give, so the craft is never skipped. Resizes to 1024x600 with the bag open
   (rg-05). Checks the partner-build marker, the guards (a throwing pickup, a throwing hit marker) and that
   main's reticle is untouched (4 px dot, .usable 8 px, only the .uf-x-hit part added). Enters fullscreen
   through Pause > Graphics and lands another pickup (rg-06). Writes sandbox/ui-feel/shots/rg-*.png, prints
   JSON with a `checks` map and exits 1 if any check failed.
"""
import re, sys, json, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'sandbox/ui-feel/shots'
argv = sys.argv[1:]
TRIES = int(argv[argv.index('--hook-tries') + 1]) if '--hook-tries' in argv else 2
FREEZE_MS = int(argv[argv.index('--freeze') + 1]) if '--freeze' in argv else 330
if '--out' in argv: OUT = Path(argv[argv.index('--out') + 1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1280, 720

# ---------- 1. ADOPT on a scratch copy, parsed from the doc ----------
tmp = Path(tempfile.mkdtemp(prefix='uifeel-rg-'))
D = tmp / 'dist'
shutil.copytree(REPO / 'dist', D)
doc = (REPO / 'docs/tech/ui-feel-ADOPT.md').read_text()
BLOCK = re.compile(r'<!-- (copy|apply|append): (.+?) -->\n```[a-z]*\n(.*?)```', re.S)
# The doc names the dist it was checked against; a different game.js means the doc must be re-checked first.
base = re.search(r'`dist/game\.js` (\d+) lines', doc)
assert base, 'ADOPT header must name the `dist/game.js` N lines it was checked against'
have = (REPO / 'dist/game.js').read_text().count('\n')
assert have == int(base.group(1)), f'ADOPT was checked against a {base.group(1)}-line dist/game.js, this dist has {have}: re-check every block against current main'
applied = []
for verb, arg, body in BLOCK.findall(doc):
    if verb == 'copy':
        src, dst = [x.strip() for x in arg.split('->')]
        shutil.copy(REPO / src, D / dst); applied.append(f'copy {dst}'); continue
    p = D / arg.strip(); s = p.read_text()
    if verb == 'append':
        p.write_text(s + '\n' + body); applied.append(f'append {arg}'); continue
    old, new = [], []
    for ln in body.rstrip('\n').split('\n'):
        tag, text = ln[:1], ln[1:]
        if tag in ('-', ' '): old.append(text)
        if tag in ('+', ' '): new.append(text)
    old_s, new_s = '\n'.join(old) + '\n', '\n'.join(new) + '\n'
    n = s.count(old_s)
    assert n == 1, f'ADOPT block for dist/{arg}: expected 1 match, found {n}:\n{old_s[:300]}'
    p.write_text(s.replace(old_s, new_s)); applied.append(f'apply {arg}: {old[0].strip()[:60]}')
assert sum(a.startswith('apply game.js') for a in applied) == 10, applied
assert sum(a.startswith('apply live.js') for a in applied) == 1, applied
# scratch-only QA hooks (NOT part of ADOPT)
g = D / 'game.js'; s = g.read_text(); a = '  window.raftDebug = debugApi;\n'
assert s.count(a) == 1
g.write_text(s.replace(a, a + '  window.__qaAction = a => action(a); window.__qaEffect = e => effect(e);\n'))
log = {'adopt': applied, 'scratch': str(tmp)}
if '--patch-only' in argv:
    print(json.dumps(log, indent=1)); sys.exit(0)

from playwright.sync_api import sync_playwright

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(tmp)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/dist/index.html'
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
# Wrap the live instance's pickup: once effect() has run (a microtask later, same task) pause every animation at
# currentTime = ms and pin performance.now (SwiftShader runs the game at a few fps; screenshots must not age the
# HUD). release() restores the clock and plays everything again.
FREEZE = """ms => { const f = window.__littleRaftUIFeel, orig = f.pickup; window.__frozen = 0; window.__pn ??= performance.now;
  f.pickup = (items, from) => { const r = orig(items, from); window.__loot = items;
    if (!window.__frozen) queueMicrotask(() => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
      const t0 = performance.now(); performance.now = () => t0; window.__frozen = 1;
      window.__feedAtFreeze = [...document.querySelectorAll('#pickupFeed .pf-row')].map(r => r.textContent.trim());
      window.__flyArt = [...document.querySelectorAll('#uf-layer .uf-fly')].filter(f => f.getAnimations().length).map(f => {
        const a = f.querySelector('.uf-art'), i = a.querySelector('img,svg');
        return {label: f.lastChild.textContent, artChars: a.innerHTML.length, art: i ? i.tagName.toLowerCase() : 'none'}; });
      window.__held = [...document.querySelectorAll('.tools .sv-slot.uf-wait')].map(s => ({slot: +s.dataset.slot,
        painted: s.querySelector('.sv-count').textContent, shown: s.querySelector('.sv-count').dataset.ufOld, fresh: s.classList.contains('uf-fresh')})); });
    return r; };
  window.__release = () => { f.pickup = orig; performance.now = window.__pn; document.getAnimations().forEach(a => a.play()); }; }"""
SEEK = '(ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }'
errors, expected = [], []
shots = []
def shot(name):
    pg.screenshot(path=str(OUT / f'rg-{name}.png')); shots.append(f'rg-{name}.png')
def on_console(m):
    if m.type != 'error': return
    (expected if 'QA-EXPECTED' in m.text else errors).append(m.text[:200])

def collect_supply():
    ts = pg.evaluate('raftDebug.targets.filter(t=>!t.pending).sort((a,b)=>(b.type==="barrel")-(a.type==="barrel")||a.distance-b.distance)')
    t = ts[0]
    pg.evaluate('t => window.__qaAction({kind:"collect", id:t.id, token:t.token})', t)
    pg.wait_for_function('window.__frozen === 1', timeout=30000)
    return t['type']

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)
    c = b.new_context(viewport={'width': W, 'height': H})
    c.add_init_script("HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error('QA fallback'))};")
    pg = c.new_page(); pg.set_default_timeout(180000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', on_console)
    missing = set(); pg.on('response', lambda r: r.status >= 400 and missing.add(r.url.split('/dist/')[-1]))
    pg.goto(URL); pg.wait_for_function('!!window.raftDebug', timeout=90000)
    pg.evaluate("document.querySelector('#solo').click()")  # the title card may be animating/covered (onboarding); same as tests/playtest.py
    pg.wait_for_function('raftDebug.state.running', timeout=90000)
    pg.wait_for_timeout(2500)
    log['attached'] = pg.evaluate("""() => ({feel: !!window.__littleRaftUIFeel, reticle: !!document.querySelector('#crosshair.uf-xh'),
      ownCursorShown: !!document.querySelector('.uf-cursor.on'), cursorClass: !!document.querySelector('.tools.uf-has-cursor'), mainCursor: !!document.querySelector('.tools>.sv-cursor'),
      toastPopover: !!document.getElementById('uf-toasts'), style: document.querySelectorAll('#ui-feel-style').length})""")
    pg.mouse.click(W / 2, H * .3); pg.wait_for_timeout(600)       # pointer lock is refused -> drag/aim fallback
    pg.evaluate(FREEZE, FREEZE_MS)

    # ---------- pickup: a real hook catch, else the same collect action ----------
    VIS = f't=>t.screen?.visible&&!t.pending&&t.screen.x>{W*.15}&&t.screen.x<{W*.85}&&t.screen.y>{H*.3}&&t.screen.y<{H*.85}'
    log['via'] = None; tries = []
    for attempt in range(TRIES):
        ts = pg.evaluate(f'raftDebug.targets.filter({VIS}&&t.distance>4&&t.distance<14).sort((a,b)=>a.distance-b.distance)')
        if not ts: pg.wait_for_timeout(800); continue
        t = ts[0]; s = t['screen']
        pg.mouse.move(s['x'], s['y']); pg.mouse.down(); pg.wait_for_timeout(600)
        if attempt == 0:
            shot('00-charge')
            log['chargeRing'] = pg.evaluate("(() => { const m = document.getElementById('chargeMeter'); return {shown: !!m && !m.hidden && getComputedStyle(m).display !== 'none', c: m && m.style.getPropertyValue('--c')}; })()")
        pg.wait_for_timeout(350); pg.mouse.up()
        try: pg.wait_for_function('raftDebug.state.hookStage!=="flying"', timeout=8000)
        except Exception: pass
        pg.mouse.down(); st = {}
        for _ in range(60):
            st = pg.evaluate('({stage: raftDebug.state.hookStage, n: raftDebug.state.hookCaughtItems.length, frozen: window.__frozen})')
            if st['frozen'] or st['stage'] == 'idle': break
            pg.wait_for_timeout(150)
        pg.mouse.up()
        tries.append({'type': t['type'], 'dist': round(t['distance'], 1), 'landedLoot': bool(st.get('frozen'))})
        if st.get('frozen'): log['via'] = 'hook catch'; break
        pg.wait_for_timeout(400)
    log['hookTries'] = tries
    if not log['via']: log['via'] = 'qa collect action (' + collect_supply() + ')'
    shot('01-loot-fly-%dms' % FREEZE_MS)
    log['loot'] = pg.evaluate('window.__loot')
    log['heldWhileFlying'] = pg.evaluate('window.__held')
    log['feedAtFreeze'] = pg.evaluate('window.__feedAtFreeze')
    log['flyArt'] = pg.evaluate('window.__flyArt')
    pg.evaluate(SEEK, 600); pg.wait_for_timeout(150); shot('02-flight-600ms')
    log['flightAt600ms'] = pg.evaluate("""() => [...document.querySelectorAll('#uf-layer .uf-fly')].filter(f => f.getAnimations().length)
      .map(f => { const r = f.querySelector('.uf-art').getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), opacity: +(+getComputedStyle(f).opacity).toFixed(2)}; })""")
    # finish() (not a seek) so the flights' onfinish runs: the slots release their held count and bump
    pg.evaluate("document.getAnimations().forEach(a => { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); })")
    pg.wait_for_timeout(400); pg.evaluate(SEEK, 100000); pg.wait_for_timeout(150); shot('03-landed')
    log['afterLanding'] = pg.evaluate("""() => ({waiting: document.querySelectorAll('.tools .sv-slot.uf-wait').length,
      feed: raftDebug.state.feed, hotbar: raftDebug.state.inventory.slots.slice(0, 8).map(s => s ? s.kind + 'x' + s.count : null)})""")
    pg.evaluate('window.__release()'); pg.wait_for_timeout(500)

    # ---------- craft through the real UI, inventory at 1280 and 1024 ----------
    pg.keyboard.press('Tab'); pg.wait_for_function('raftDebug.state.inventoryOpen'); pg.wait_for_timeout(500)
    ready = pg.locator('#inventory .sv-recipe.sv-ready')
    log['craftReady'] = ready.count(); log['craftToppedUp'] = None
    if not ready.count() or '--topup' in argv:  # nothing craftable from this pickup: give one rope's worth (2 leaf), reopen
        pg.keyboard.press('Tab'); pg.wait_for_function('!raftDebug.state.inventoryOpen')
        log['craftToppedUp'] = pg.evaluate("raftDebug.give('leaf', 2)")  # leftover that did not fit: 0 = all added
        pg.keyboard.press('Tab'); pg.wait_for_function('raftDebug.state.inventoryOpen'); pg.wait_for_timeout(500)
        log['craftReady'] = ready.count()
    if ready.count():
        # recipes are filtered by category tab and the list scrolls: pick through the real click handlers in JS
        log['craftPicked'] = pg.evaluate("""() => { const r = document.querySelector('#inventory .sv-recipe.sv-ready');
          document.querySelector(`#inventory .sv-tab[data-cat="${r.dataset.cat}"]`)?.click();
          r.scrollIntoView({block: 'nearest'}); r.click(); return r.dataset.recipe; }""")
        pg.wait_for_timeout(300)
        pg.evaluate("""() => { const f = window.__littleRaftUIFeel, o = f.crafted; window.__crafted = [];
          f.crafted = id => { const r = o(id); window.__crafted.push({id, flashed: r,
            anims: document.querySelector('#inventory .sv-recipe.sv-pick')?.getAnimations({subtree: true}).length ?? 0,
            feed: [...document.querySelectorAll('#pickupFeed .pf-row')].map(r => r.textContent.trim())}); return r; }; }""")
        pg.locator('#inventory .sv-craftbtn').click(); pg.wait_for_timeout(250)
        log['craft'] = pg.evaluate('window.__crafted')
    pg.wait_for_timeout(600); shot('04-inventory-craft-1280')
    pg.set_viewport_size({'width': 1024, 'height': 600}); pg.wait_for_timeout(800); shot('05-inventory-1024')
    log['inventory1024'] = pg.evaluate("""() => { const r = document.querySelector('#inventory .sv-wrap').getBoundingClientRect();
      return {panel: [r.left|0, r.top|0, r.width|0, r.height|0], fitsViewport: r.right <= innerWidth && r.bottom <= innerHeight + 1,
        topAtCentre: document.elementFromPoint(r.left + r.width / 2, r.top + 12)?.closest('#inventory') ? 'inventory' : 'other',
        toastPopover: !!document.getElementById('uf-toasts')}; }""")
    pg.keyboard.press('Tab'); pg.wait_for_function('!raftDebug.state.inventoryOpen'); pg.wait_for_timeout(300)
    pg.set_viewport_size({'width': W, 'height': H}); pg.wait_for_timeout(500)

    # ---------- hit marker only for your own build ----------
    HITS = "() => document.querySelector('#crosshair .uf-x-hit').getAnimations().length"
    log['buildMarker'] = {}
    for label, by in [('partner (by:guest)', 'guest'), ('no owner', None), ('mine (by:host)', 'host')]:
        pg.evaluate("document.querySelector('#crosshair .uf-x-hit').getAnimations().forEach(a => a.cancel())")
        e = {'kind': 'build', 'text': 'A little more room!'}
        if by: e['by'] = by
        pg.evaluate('e => window.__qaEffect(e)', e)
        log['buildMarker'][label] = pg.evaluate(HITS)

    # ---------- guards ----------
    n0 = len(errors)
    pg.evaluate("""() => { const f = window.__littleRaftUIFeel; window.__origPickup = f.pickup; f.pickup = () => { throw new Error('QA-EXPECTED pickup'); }; }""")
    pg.evaluate("window.__qaEffect({kind:'loot', loot:{wood:1}, text:'+ 1 Plank'})")
    pg.evaluate("() => { window.__littleRaftUIFeel.pickup = window.__origPickup; }")
    log['guardEffect'] = {'feedStillGotIt': pg.evaluate("raftDebug.state.feed.some(r => /Plank/.test(r))"), 'pageErrors': len(errors) - n0}
    pg.evaluate("window.__qaEffect({kind:'craft', loot:{'x\"]\\n[y':1}, text:'Crafted ?'})")
    pg.evaluate("window.__qaEffect({kind:'craft', loot:{toString:null}, text:'Crafted ?'})")
    log['guardHostileCraft'] = {'pageErrors': len(errors) - n0}
    pg.evaluate("""() => { const x = window.__littleRaftUIFeel.crosshair; window.__origHit = x.hit; x.hit = () => { throw new Error('QA-EXPECTED hit'); }; }""")
    pg.evaluate("window.__qaEffect({kind:'full', text:'Your bag is full'})")
    pg.evaluate("() => { window.__littleRaftUIFeel.crosshair.hit = window.__origHit; }")
    pg.wait_for_timeout(800)
    log['guardHit'] = {'stillRunning': pg.evaluate('raftDebug.state.running'), 'pageErrors': len(errors) - n0, 'expectedConsoleErrors': len(expected)}

    # ---------- reticle: main's dot + .usable + #chargeMeter stay main's; ui-feel adds only the hit ticks ----------
    log['reticle'] = pg.evaluate("""() => { const x = document.getElementById('crosshair'), s = getComputedStyle(x);
      const base = {cls: x.className, width: s.width, shadow: s.boxShadow, radius: s.borderRadius,
        parts: [...x.querySelectorAll('.uf-x')].map(c => [...c.classList].join(' '))};
      x.classList.add('usable'); const u = getComputedStyle(x).width; x.classList.remove('usable');
      return {...base, usableWidth: u, chargeMeterHiddenByFeel: !!document.querySelector('#ui-feel-style')?.textContent.includes('#chargeMeter')}; }""")

    # ---------- fullscreen through Pause > Graphics, then another pickup ----------
    pg.keyboard.press('Escape')
    try:
        pg.wait_for_function('document.querySelector("#options")?.open', timeout=8000)
        if pg.locator('#options [data-act="settings"]').count(): pg.locator('#options [data-act="settings"]').click()
        pg.locator('#options [data-tab="graphics"]').click(); pg.wait_for_timeout(200)
        pg.locator('#options [data-act="fullscreen"]').click(); pg.wait_for_timeout(800)
        log['fullscreen'] = pg.evaluate('document.fullscreenElement === document.documentElement')
        pg.locator('#options [data-act="resume"]').click(); pg.wait_for_timeout(600)
    except Exception as ex:
        log['fullscreen'] = 'not reachable: ' + str(ex)[:120]
    pg.evaluate(FREEZE, 420)
    collect_supply()
    shot('06-fullscreen-fly-420ms')
    log['fullscreenFly'] = pg.evaluate("""() => ({fullscreen: !!document.fullscreenElement,
      flying: [...document.querySelectorAll('.uf-fly')].filter(f => +getComputedStyle(f).opacity > .5).length,
      feedAtFreeze: window.__feedAtFreeze})""")
    pg.evaluate('window.__release()')
    log['errors'] = errors; log['missingResources'] = sorted(missing)
    b.close()
srv.shutdown()
if '--keep' not in argv: shutil.rmtree(tmp, ignore_errors=True); log.pop('scratch')
log['shots'] = shots
fa = log.get('flyArt') or []
checks = {
    'flyIconsNonEmpty': bool(fa) and all(f['artChars'] > 0 and f['art'] != 'none' for f in fa),
    'heldWhileFlying': bool(log.get('heldWhileFlying')),
    'crafted': log.get('craftToppedUp') in (None, 0) and bool(log.get('craft')) and all(c['flashed'] is True for c in log['craft']),
    'buildMarkerOwnOnly': log.get('buildMarker') == {'partner (by:guest)': 0, 'no owner': 0, 'mine (by:host)': 1},
    'reticleIsMains': 'uf-xm' in log['reticle']['cls'] and 'uf-xh' not in log['reticle']['cls'] and log['reticle']['width'] == '4px'
                      and log['reticle']['usableWidth'] == '8px' and len(log['reticle']['parts']) == 1 and log['reticle']['parts'][0].startswith('uf-x uf-x-hit') and not log['reticle']['chargeMeterHiddenByFeel'],
    'guards': log['guardEffect']['pageErrors'] == 0 and log['guardHostileCraft']['pageErrors'] == 0 and log['guardHit']['pageErrors'] == 0 and log['guardHit']['stillRunning'],
    'noPageErrors': not [e for e in errors if 'favicon' not in e and '404' not in e],
}
log['checks'] = checks
print(json.dumps(log, indent=1))
failed = [k for k, v in checks.items() if not v]
if failed: print('FAILED: ' + ', '.join(failed), file=sys.stderr); sys.exit(1)
