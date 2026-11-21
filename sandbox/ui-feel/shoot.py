"""Headless check of the ui-feel sandbox.
Usage: python sandbox/ui-feel/shoot.py [out_dir] [--cost-only | --shots-only] [--reps N]   (default: sandbox/ui-feel/shots, 3 reps)

The mock wires ui-feel the way docs/tech/ui-feel-ADOPT.md wires dist/game.js (pickup feed keeps the text,
ui-feel flies loot and drives the reticle); the toast frames and the placement/fullscreen checks use the
standalone `?toasts=1` mode.
1. Key frames, frozen mid-animation: every running animation (WAAPI, CSS transition, CSS animation) is paused
   and its currentTime set, so a PNG shows e.g. the select cursor 90 ms into its slide.
2. Cost: each scenario runs ~150 real frames in a fresh page; Chrome's Performance domain gives
   style-recalc / layout / script time and counts, a PerformanceObserver counts long tasks.
   'naive-*' scenarios are the width/top/reflow patterns ui-feel avoids, for comparison.
Prints JSON. SwiftShader/headless timings are relative only.
"""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
argv = sys.argv[1:]
COST_ONLY = '--cost-only' in argv
SHOTS_ONLY = '--shots-only' in argv
REPS = int(argv[argv.index('--reps') + 1]) if '--reps' in argv else 3
pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--reps')]
out = Path(pos[0]).resolve() if pos else Path(__file__).resolve().parent / 'shots'
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/sandbox/ui-feel/index.html'
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
LONGTASKS = "window.__long=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(e.duration)}).observe({type:'longtask',buffered:true})}catch(e){}"

errors = []

def open_page(b, w=1280, h=720, dpr=1, rm=False, q=''):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, reduced_motion='reduce' if rm else 'no-preference')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text[:300]))
    pg.add_init_script(LONGTASKS)
    pg.goto(base + ('?' + q if q else ''))
    pg.wait_for_function('document.documentElement.dataset.ready === "1"')
    pg.evaluate('document.body.classList.add("shot")')
    pg.wait_for_timeout(300)
    return pg

def shot(pg, name, clip=None):
    pg.screenshot(path=str(out / f'{name}.png'), clip=clip)

def act_freeze(pg, js, ms):
    """Run js, then pause every animation at currentTime=ms (same task, so they all start together)."""
    # await one microtask: ui-feel reacts to survival-ui's DOM writes from a MutationObserver callback
    pg.evaluate(f'async () => {{ {js}; await 0; return feelDemo.freeze({ms}); }}')
    pg.wait_for_timeout(60)

def unfreeze(pg):
    pg.evaluate('document.getAnimations().forEach(a => a.finish ? (a.effect.getComputedTiming().endTime === Infinity ? a.cancel() : a.finish()) : 0)')
    pg.wait_for_timeout(80)

report = {'shots': [], 'cost': {}, 'errors': errors}

def key_frames(b):
    # ---------- key frames, desktop ----------
    pg = open_page(b)
    pg.evaluate("feelDemo.select(1); feelDemo.say.text('Your brother joined the raft!', 'build'); feelDemo.pickup('wood')")
    pg.wait_for_timeout(1100)
    shot(pg, '01-hud'); report['shots'].append('01-hud')

    act_freeze(pg, 'feelDemo.select(4)', 90); shot(pg, '02-select-90ms')
    unfreeze(pg)
    act_freeze(pg, 'feelDemo.select(2)', 150); shot(pg, '03-select-150ms')
    unfreeze(pg); pg.wait_for_timeout(400)

    act_freeze(pg, "feelDemo.pickup('barrel')", 150); shot(pg, '04-pickup-150ms')
    unfreeze(pg); pg.wait_for_timeout(1500)
    act_freeze(pg, "feelDemo.pickup('barrel')", 420); shot(pg, '05-pickup-420ms')
    unfreeze(pg); pg.wait_for_timeout(1500)
    pg.evaluate("feelDemo.pickup('wood')"); pg.wait_for_timeout(700)
    pg.evaluate('document.getAnimations().forEach(a => a.pause())')
    shot(pg, '06-pickup-landing'); unfreeze(pg); pg.wait_for_timeout(3600)
    report['countHeldUntilLanding'] = pg.evaluate("""async () => { feelDemo.pickup('wood'); await 0; await new Promise(r => requestAnimationFrame(r));
      const s = document.querySelector('.tools .sv-slot.uf-wait'); const c = s?.querySelector('.sv-count');
      return s ? {painted: c.textContent, shown: getComputedStyle(c, '::after').content, hidden: getComputedStyle(c).visibility} : null; }""")
    pg.wait_for_timeout(1200)
    pg.context.close()

    pg = open_page(b, q='toasts=1')
    pg.evaluate("""() => { const f = feelDemo.feel;
      f.toast('Wood', {kind:'loot', amount:2, key:'loot:wood'}); f.toast('Wood', {kind:'loot', amount:2, key:'loot:wood'});
      f.toast('Crafted Rope', {kind:'craft'}); f.toast('A little more room!', {kind:'build'});
      f.toast('Your bag is full', {kind:'full'}); }""")
    pg.wait_for_timeout(500)
    shot(pg, '07-toast-stack')
    act_freeze(pg, "feelDemo.feel.toast('Wood', {kind:'loot', amount:3, key:'loot:wood'}); feelDemo.feel.toast('Palm Leaf', {kind:'loot', amount:1, key:'loot:leaf'})", 110)
    shot(pg, '08-toast-merge-110ms'); unfreeze(pg); pg.wait_for_timeout(3700)

    act_freeze(pg, "feelDemo.hurt('health', .38)", 300); shot(pg, '09-damage-300ms', clip={'x': 0, 'y': 600, 'width': 320, 'height': 120})
    unfreeze(pg)
    pg.evaluate("feelDemo.stats.health.set(.86)"); pg.wait_for_timeout(1200)
    act_freeze(pg, "feelDemo.hurt('health', .38)", 700); shot(pg, '10-damage-700ms', clip={'x': 0, 'y': 600, 'width': 320, 'height': 120})
    unfreeze(pg)
    act_freeze(pg, "feelDemo.heal('water', .4)", 380); shot(pg, '11-heal-380ms', clip={'x': 0, 'y': 600, 'width': 320, 'height': 120})
    unfreeze(pg)
    pg.evaluate("feelDemo.stats.food.set(.18)"); pg.wait_for_timeout(1200)
    pg.evaluate("document.getAnimations().forEach(a => { if (a.effect.getComputedTiming().endTime === Infinity) { a.pause(); a.currentTime = 1000; } })")
    shot(pg, '12-low-pulse', clip={'x': 0, 'y': 600, 'width': 320, 'height': 120}); unfreeze(pg)

    # inventory open/close
    act_freeze(pg, 'feelDemo.ui.open()', 70); shot(pg, '13-inv-open-70ms')
    unfreeze(pg); pg.wait_for_timeout(400)
    shot(pg, '14-inv-open')
    # press state on a recipe and a bag slot
    box = pg.locator('#inventory .sv-recipe.sv-ready').first.bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.mouse.down(); pg.wait_for_timeout(120)
    shot(pg, '15-recipe-pressed', clip={'x': box['x'] - 20, 'y': box['y'] - 20, 'width': box['width'] + 40, 'height': box['height'] * 2 + 40})
    pg.mouse.up(); pg.wait_for_timeout(200)
    # survival-ui sv3: the recipe row only picks; the craft button crafts one on pointerdown
    cb = pg.locator('#inventory .sv-craftbtn').bounding_box()
    pg.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(30)
    pg.evaluate('document.getAnimations().forEach(a => { a.pause(); a.currentTime = 140; })')
    shot(pg, '16-craft-140ms'); unfreeze(pg); pg.wait_for_timeout(300)
    shot(pg, '24-inv-craft-toast-rest')
    act_freeze(pg, 'feelDemo.ui.close()', 60); shot(pg, '17-inv-close-60ms')
    unfreeze(pg); pg.wait_for_timeout(300)

    sl = pg.locator('.tools .sv-slot').nth(5).bounding_box()
    pg.mouse.move(sl['x'] + sl['width'] / 2, sl['y'] + sl['height'] / 2); pg.mouse.down(); pg.wait_for_timeout(120)
    shot(pg, '18-slot-pressed', clip={'x': sl['x'] - 140, 'y': sl['y'] - 30, 'width': sl['width'] + 280, 'height': sl['height'] + 50})
    pg.mouse.up(); pg.context.close()

    # ---------- crosshair states at 2x, stitched ----------
    pg = open_page(b, dpr=3)
    cx, cy = 640, 360
    clip = {'x': cx - 30, 'y': cy - 30, 'width': 60, 'height': 60}
    states = [
        ('idle', '', None),
        ('hover', "feelDemo.setHover(true)", None),
        ('charge 40%', "feelDemo.setHover(false); feelDemo.feel.crosshair.charge(.4)", None),
        ('charge full', "feelDemo.feel.crosshair.charge(1)", 400),
        ('hit 90ms', "feelDemo.feel.crosshair.charge(null); feelDemo.feel.crosshair.hit('hit')", 90),
        ('catch 60ms', "feelDemo.feel.crosshair.hit('gold')", 60),
        ('deny 80ms', "feelDemo.feel.crosshair.hit('deny')", 80),
    ]
    paths = []
    pg.evaluate("document.getElementById('lrPrompt').style.visibility='hidden'")
    for i, (label, js, ms) in enumerate(states):
        if js:
            pg.evaluate(f'async () => {{ {js}; await 0; {"feelDemo.freeze(%d)" % ms if ms is not None else ""} }}')
        pg.wait_for_timeout(250 if ms is None else 60)
        pth = out / f'_xh{i}.png'; pg.screenshot(path=str(pth), clip=clip); paths.append((label, pth))
        unfreeze(pg)
    pg.context.close()
    # stitch in the browser (no PIL dependency)
    import base64
    cells = ''.join(f'<figure><img src="data:image/png;base64,{base64.b64encode(pth.read_bytes()).decode()}"><figcaption>{label}</figcaption></figure>' for label, pth in paths)
    sp = b.new_page(viewport={'width': 140 * len(paths), 'height': 170})
    sp.set_content('<style>body{margin:0;display:flex;background:#24170c;font:600 12px system-ui;color:#ffe3a6}figure{margin:0;width:140px;text-align:center}img{width:140px;height:140px;display:block;image-rendering:pixelated}figcaption{padding-top:6px}</style>' + cells)
    sp.screenshot(path=str(out / '19-crosshair-states.png')); sp.close()
    for _, pth in paths: pth.unlink()

    # ---------- reduced motion ----------
    pg = open_page(b, rm=True)
    act_freeze(pg, "feelDemo.pickup('barrel'); feelDemo.select(3); feelDemo.hurt('health', .3)", 150)
    shot(pg, '20-reduced-motion-150ms')
    report['reducedMotionActive'] = pg.evaluate('feelDemo.feel.reducedMotion')
    pg.context.close()

    # ---------- phone portrait ----------
    pg = open_page(b, w=390, h=844, dpr=2)
    pg.evaluate("feelDemo.pickup('barrel'); feelDemo.select(2)")
    pg.wait_for_timeout(1200)
    act_freeze(pg, "feelDemo.pickup('wood')", 300)
    shot(pg, '21-phone-pickup-300ms')
    unfreeze(pg); pg.wait_for_timeout(300)
    pg.evaluate("feelDemo.ui.open()"); pg.wait_for_timeout(400)
    pg.locator('#inventory .sv-recipe.sv-ready').first.click(); pg.wait_for_timeout(150)
    pg.locator('#inventory .sv-craftbtn').click(); pg.wait_for_timeout(250)
    shot(pg, '23-phone-inv-craft')
    pg.context.close()

    # ---------- toasts with the inventory open at desktop widths 761-1279 (they must not cover the panel) ----------
    report['toastPlacement'] = {}
    for w, h in [(1280, 720), (1024, 600), (800, 600)]:
        pg = open_page(b, w=w, h=h, q='toasts=1')
        pg.wait_for_timeout(1500)  # let survival-ui finish rendering its 3D icons (long tasks) first
        pg.evaluate("feelDemo.ui.open()"); pg.wait_for_timeout(400)
        # toasts + freeze in one task: a stalled headless frame cannot age them past their 3.2 s life
        pg.evaluate("""async () => { const f = feelDemo.feel; f.toast('Wood', {kind:'loot', amount:3, key:'loot:wood'});
          f.toast('Crafted Rope', {kind:'craft'}); f.toast('Your bag is full', {kind:'full'}); await 0; feelDemo.freeze(1000); }""")
        pg.wait_for_timeout(100)
        shot(pg, f'25-inv-toasts-{w}x{h}')
        report['toastPlacement'][f'{w}x{h}'] = pg.evaluate("""() => { const d = document.querySelector('#inventory .sv-wrap').getBoundingClientRect();
          const rows = [...document.querySelectorAll('.uf-toast')].filter(t => +getComputedStyle(t).opacity > .05).map(t => t.getBoundingClientRect());
          const hit = rows.filter(r => r.right > d.left && r.left < d.right && r.bottom > d.top && r.top < d.bottom).length;
          const c = document.querySelector('#inventory .sv-craft').getBoundingClientRect(); // panel content (inside the padding)
          const hitContent = rows.filter(r => r.right > c.left && r.left < d.right && r.bottom > c.top && r.top < c.bottom).length;
          return {mode: document.getElementById('uf-toasts').className || 'br', rows: rows.length, overlapPanelFrame: hit, overlapPanelContent: hitContent}; }""")
        pg.context.close()

    # ---------- fullscreen: the stack must stay above a fullscreen <html> ----------
    pg = open_page(b, q='toasts=1')
    pg.evaluate("document.body.addEventListener('click', () => document.documentElement.requestFullscreen().catch(e => window.__fsErr = String(e)), {once:true})")
    pg.mouse.click(200, 200); pg.wait_for_timeout(500)
    # toasts + freeze in one task (as frame 25): the PNG shows the rows the JSON checks, not an expired stack
    pg.evaluate("""async () => { feelDemo.feel.toast('A little more room!', {kind:'build'}); feelDemo.feel.toast('Your bag is full', {kind:'full'});
      await 0; feelDemo.freeze(1000); }""")
    pg.wait_for_timeout(100)
    report['fullscreen'] = pg.evaluate("""() => { const t = [...document.querySelectorAll('.uf-toast')].find(t => +getComputedStyle(t).opacity > .5);
      const r = t?.getBoundingClientRect(); t && (t.style.pointerEvents = 'auto');
      const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null; t && (t.style.pointerEvents = '');
      return {fullscreen: document.fullscreenElement === document.documentElement, err: window.__fsErr || null,
        toastIsTopmost: !!top && t.contains(top)}; }""")
    shot(pg, '26-fullscreen-toasts')
    pg.context.close()

    # ---------- guest fallback: the effect arrives before the predicted bag has the item ----------
    pg = open_page(b)
    act_freeze(pg, "feelDemo.feel.pickup([{kind:'fish', count:1}, {kind:'wood', count:2}])", 590)
    shot(pg, '22-guest-generic-590ms')
    pg.context.close()

def cost(b):
    # ---------- cost ----------
    # (label, scenario, query). '*-nofeel' = same input on the same real survival UI without ui-feel: the delta is
    # what the feel layer itself costs. Each scenario runs once to warm up (JIT, first WAAPI/style), then is measured.
    runs = [('idle', 'idle', ''), ('select', 'select', ''), ('select-nofeel', 'select', 'nofeel=1'),
            ('pickup', 'pickup', ''), ('pickup-nofeel', 'pickup', 'nofeel=1'), ('toast', 'toast', ''), ('stats', 'stats', ''),
            ('crosshair', 'crosshair', ''), ('inventory', 'inventory', ''), ('inventory-nofeel', 'inventory', 'nofeel=1'),
            ('naive-select', 'naive-select', ''), ('naive-toast', 'naive-toast', ''), ('naive-stats', 'naive-stats', '')]
    keys = ['RecalcStyleCount', 'RecalcStyleDuration', 'LayoutCount', 'LayoutDuration', 'ScriptDuration', 'TaskDuration']
    samples = {}
    for rep, (label, n, q) in [(r, x) for r in range(REPS) for x in runs]:
        pg = open_page(b, q=q)
        cold = pg.evaluate(f'feelDemo.run({json.dumps(n)}).then(() => Math.max(0, ...__long))')
        cdp = pg.context.new_cdp_session(pg)
        cdp.send('Performance.enable', {'timeDomain': 'threadTicks'})
        pg.wait_for_timeout(300)
        pg.evaluate('__long.length = 0')
        m0 = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        r = pg.evaluate(f'feelDemo.run({json.dumps(n)})')
        m1 = {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        lt = pg.evaluate('__long.slice()')
        d = {k: m1.get(k, 0) - m0.get(k, 0) for k in keys}
        samples.setdefault(label, []).append({'coldLongestTaskMs': round(cold, 1),
            'frames': r['frames'], 'avgFrameMs': r['avgFrame'], 'worstFrameMs': r['worstFrame'],
            'styleMs': round(d['RecalcStyleDuration'] * 1000, 2), 'styleCount': int(d['RecalcStyleCount']),
            'layoutMs': round(d['LayoutDuration'] * 1000, 2), 'layoutCount': int(d['LayoutCount']),
            'scriptMs': round(d['ScriptDuration'] * 1000, 2), 'taskMs': round(d['TaskDuration'] * 1000, 2),
            'longTasks': len(lt), 'longestTaskMs': round(max(lt), 1) if lt else 0,
        })
        pg.context.close()
    med = lambda xs: sorted(xs)[len(xs) // 2]
    for label, ss in samples.items():  # per-metric median over REPS fresh pages
        report['cost'][label] = {k: med([x[k] for x in ss]) for k in ss[0]}
    report['cost_reps'] = REPS
    idle = report['cost']['idle']
    for n, c in report['cost'].items():
        f = max(1, c['frames'])
        c['perFrame'] = {k: round((c[k] - idle[k]) / f, 3) for k in ('styleMs', 'layoutMs', 'scriptMs')}
        c['extraLayouts'] = c['layoutCount'] - idle['layoutCount']

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)
    if not COST_ONLY:
        key_frames(b)
    if not SHOTS_ONLY:
        cost(b)
    b.close()
srv.shutdown()
report['shots'] = sorted(x.name for x in out.glob('*.png'))
print(json.dumps(report, indent=1))
