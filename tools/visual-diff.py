"""Visual regression for Little Raft: render a fixed set of seeded, frozen-clock scenes from one or two dist
folders, pixel-diff them with numpy and write a labelled contact sheet (PNG + HTML).

  python3.13 tools/visual-diff.py --dist <dist> [--out <dir>]
      Self-determinism check (the branch gate): render the same build twice and require near-identical
      frames. A scene over --self-fail-over percent is a failure (exit 1).

  python3.13 tools/visual-diff.py --base <main-dist> --head <branch-dist> [--out <dir>] [--fail-on-diff]
      Informational diff between two builds. Diffs are reported in metrics and on the sheet; they only fail
      the run with --fail-on-diff (scene over --fail-over percent). Add --check-determinism to also render
      head a second time and gate on its noise floor.

Every scene runs in a fresh browser context with tools/determinism.js injected and the page opened at
?seed=<n>&freeze=1: Math.random is seeded; performance.now, Date, setTimeout/setInterval and
requestAnimationFrame run on a virtual clock advanced only by window.__det.step(); pointer lock and Web Audio
are removed (the game falls back to drag-to-look); WebGL draws are skipped on every stepped frame except the
last one before a screenshot; any request that is not to the local server is blocked (today only the Google
Fonts stylesheet, so text uses fallback fonts). live.js still polls version.json, but on the virtual clock, and
an unchanged build never swaps. Runs go side by side in --jobs browsers. Same build twice is byte-identical
under swiftshader, across runs and processes. Timing on a loaded 4-core box: about 3.5 min for --dist or
--base/--head, about 7 min with --check-determinism.

Last stdout line is one JSON object {tool, pass, failures, metrics, artifacts}. Exit 0 pass, 1 failure
(nondeterminism, page error, scene unreachable, or --fail-on-diff diff), 2 harness/infra error.
"""
import argparse, html, json, sys, threading, time, traceback
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / 'tests' / 'e2e'))
from harness import StaticServer, launch_chromium  # noqa: E402

SHIM = (HERE / 'determinism.js').read_text(encoding='utf-8')
TOOL = 'visual-diff'
W, H = 1280, 720
CX, CY = W // 2, H // 2
RAD_PX = 1 / .005  # game.js DRAG_SENSITIVITY: 0.005 rad per dragged pixel

# Each scene is a list of steps:
#   ('frames', n)  advance the virtual clock n frames (1/60 s each)
#   ('click', sel) DOM click            ('key', key) press+release      ('hold', key, frames) key held for n frames
#   ('yaw', rad) / ('pitch', rad)  drag-to-look by that many radians    ('down',) / ('up',) left mouse at centre
START = [('frames', 10), ('click', '#solo'), ('frames', 90)]
SCENES = {
    'title':        [('frames', 30)],
    'title-help':   [('frames', 10), ('click', '#helpButton'), ('frames', 10)],
    'title-crew':   [('frames', 10), ('click', '#welcomeCrew'), ('frames', 10)],
    'spawn':        START,
    'look-left':    START + [('yaw', 1.5708), ('frames', 20)],
    'look-right':   START + [('yaw', -1.5708), ('frames', 20)],
    'look-back':    START + [('yaw', 3.1416), ('frames', 20)],
    'look-sky':     START + [('pitch', 1.0), ('frames', 20)],
    'look-deck':    START + [('pitch', -1.0), ('frames', 20)],
    'look-water':   START + [('yaw', 1.2), ('pitch', -.45), ('frames', 20)],
    'horizon':      START + [('pitch', .28), ('frames', 20)],
    'ocean-later':  START + [('frames', 600)],
    'walk-forward': START + [('hold', 'w', 60), ('frames', 30)],
    'walk-strafe':  START + [('hold', 'd', 45), ('frames', 30)],
    'slot-2':       START + [('key', '2'), ('frames', 20)],
    'slot-3':       START + [('key', '3'), ('frames', 20)],
    'slot-4':       START + [('key', '4'), ('frames', 20)],
    'inventory':    START + [('key', 'Tab'), ('frames', 20)],
    'pause':        START + [('key', 'Escape'), ('frames', 20)],
    'hook-charge':  START + [('pitch', -.25), ('down',), ('frames', 40)],
    'hook-thrown':  START + [('pitch', -.25), ('down',), ('frames', 40), ('up',), ('frames', 50)],
}

STATE_JS = '''(()=>{const s=raftDebug.state;return {running:s.running,tool:s.tool,heldKind:s.heldKind,
selectedIndex:s.selectedIndex,items:s.items,inventoryOpen:s.inventoryOpen,hookStage:s.hookStage,charge:s.charge,
me:s.me,lockFallback:s.lockFallback,pointerLocked:s.pointerLocked,frame:__det.frame,
dialogOpen:!!document.querySelector('dialog[open]')}})()'''


def describe(steps, seed):
    out = [f'serve the dist, inject tools/determinism.js as an init script, open /?seed={seed}&freeze=1 at {W}x{H}']
    for s in steps:
        k = s[0]
        out.append({'frames': lambda: f'step {s[1]} frames', 'click': lambda: f'click {s[1]}',
                    'key': lambda: f'press {s[1]}', 'hold': lambda: f'hold {s[1]} for {s[2]} frames',
                    'yaw': lambda: f'drag-look yaw {s[1]:+.2f} rad', 'pitch': lambda: f'drag-look pitch {s[1]:+.2f} rad',
                    'down': lambda: 'mouse down at centre', 'up': lambda: 'mouse up'}[k]())
    return '; '.join(out) + '; screenshot'


def drag(page, dx, dy):
    # game.js drag-to-look: pointerdown, >4px move applies look(dx, dy), pointerup without a click.
    # Chunked so the pointer stays inside the canvas.
    while abs(dx) > 0.5 or abs(dy) > 0.5:
        sx = max(-500, min(500, dx)); sy = max(-300, min(300, dy))
        page.mouse.move(CX - sx / 2, CY - sy / 2); page.mouse.down()
        page.mouse.move(CX + sx / 2, CY + sy / 2, steps=1); page.mouse.up()
        dx -= sx; dy -= sy


def run_steps(page, steps):
    step = lambda n: page.evaluate(f'window.__det.step({int(n)})')
    for s in steps:
        k = s[0]
        if k == 'frames': step(s[1])
        elif k == 'click': page.click(s[1], timeout=10000)
        elif k == 'key': page.keyboard.press(s[1])
        elif k == 'hold':
            page.keyboard.down(s[1]); step(s[2]); page.keyboard.up(s[1])
        elif k == 'yaw': drag(page, -s[1] * RAD_PX, 0)   # look(): yaw -= dx * k
        elif k == 'pitch': drag(page, 0, -s[1] * RAD_PX)  # pitch -= dy * k
        elif k == 'down': page.mouse.move(CX, CY); page.mouse.down()
        elif k == 'up': page.mouse.up()
        else: raise ValueError(f'unknown step {s!r}')


def wait_js(page, expr, timeout_s):
    # Poll from Python on wall time: the page's own timers are virtual, so Playwright's in-page polling is avoided.
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            if page.evaluate(expr): return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def capture(browser, dist, out, names, seed, label):
    """Render every scene of one dist into out/<scene>.png. Returns {scene: info}."""
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    with StaticServer(dist) as srv:
        url = f'{srv.url}?seed={seed}&freeze=1'
        for name in names:
            t0 = time.time(); info = {'ok': False, 'errors': [], 'console': [], 'blocked': []}
            ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1,
                                      reduced_motion='reduce', locale='en-US', timezone_id='UTC',
                                      service_workers='block')
            ctx.add_init_script(SHIM)

            def route(r, _req, i=info['blocked']):
                host = urlparse(r.request.url).hostname
                if host in ('127.0.0.1', 'localhost') or r.request.url.startswith('data:'):
                    r.continue_()
                else:
                    i.append(r.request.url[:200]); r.abort()
            ctx.route('**/*', route)
            page = ctx.new_page()
            page.on('pageerror', lambda e, i=info: i['errors'].append('pageerror: ' + str(e)[:300]))
            page.on('console', lambda m, i=info: m.type == 'error' and i['console'].append(m.text[:300]))
            try:
                page.goto(url, wait_until='load', timeout=60000)
                if not wait_js(page, '!!window.__det && !!window.__det.step', 10):
                    raise RuntimeError('determinism shim did not install (window.__det missing)')
                wait_js(page, "!!window.raftDebug || !!document.getElementById('raftLiveError')", 45)
                if not page.evaluate('!!window.raftDebug'):
                    # The page loaded and the shim ran, so a missing raftDebug with live.js's fatal panel, a page error or
                    # a console error means the game build is broken (exit 1); a silent stall stays an infra error.
                    fatal = page.evaluate("document.getElementById('raftLiveError')?.innerText || ''")
                    info['booted'] = bool(fatal or info['errors'] or info['console'])
                    why = fatal or '; '.join(info['errors'] + info['console'])
                    raise RuntimeError('window.raftDebug never appeared (game did not boot): ' + ' '.join(why.split())[:300])
                info['booted'] = True
                run_steps(page, SCENES[name])
                page.screenshot(path=str(out / f'{name}.png'), caret='hide', timeout=60000)
                try: info['state'] = page.evaluate(STATE_JS)
                except Exception as e: info['errors'].append('state: ' + str(e).splitlines()[0][:200])
                info['ok'] = True
            except Exception as e:
                info['exception'] = str(e).splitlines()[0][:300]
            info['seconds'] = round(time.time() - t0, 2)
            meta[name] = info
            ctx.close()
            print(f'  {label}:{name} {"ok" if info["ok"] else "FAILED " + info.get("exception", "")} {info["seconds"]}s',
                  file=sys.stderr)
    (out / 'capture.json').write_text(json.dumps(meta, indent=1), encoding='utf-8')
    return meta


def diff(a_png, b_png, d_png, tol):
    a = np.asarray(Image.open(a_png).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(b_png).convert('RGB'), dtype=np.int16)
    if a.shape != b.shape:
        return {'pct': 100.0, 'exactPct': 100.0, 'mean': 255.0, 'max': 255, 'box': None, 'note': f'size {a.shape} vs {b.shape}'}
    d = np.abs(a - b).max(axis=2)
    mask = d > tol
    gray = (a.mean(axis=2) * .35).astype(np.uint8)
    img = np.stack([gray, gray, gray], axis=2)
    img[(d > 0) & ~mask] = [255, 190, 60]
    img[mask] = [255, 40, 90]
    Image.fromarray(img).save(d_png)
    ys, xs = np.nonzero(mask)
    box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
    return {'pct': round(100 * float(mask.mean()), 4), 'exactPct': round(100 * float((d > 0).mean()), 4),
            'mean': round(float(d.mean()), 4), 'max': int(d.max()), 'box': box}


def font(size):
    for f in ('DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    try: return ImageFont.load_default(size=size)
    except TypeError: return ImageFont.load_default()


def contact_png(path, la, lb, names, results, limit, title):
    TW, TH, LW, PAD, HEAD = 400, 225, 190, 8, 26
    f_big, f = font(17), font(13)
    rowh = TH + HEAD + PAD
    sheet = Image.new('RGB', (LW + 3 * (TW + PAD) + PAD, 54 + len(names) * rowh), (24, 28, 34))
    dr = ImageDraw.Draw(sheet)
    dr.text((PAD, 10), title, fill=(235, 232, 225), font=f_big)
    dr.text((PAD, 32), f'A = {la}    B = {lb}    red: delta over tolerance, amber: any smaller delta', fill=(160, 168, 178), font=f)
    for i, n in enumerate(names):
        y = 54 + i * rowh
        r = results.get(n)
        bad = r is None or r['pct'] > limit
        col = (255, 92, 134) if bad else (79, 209, 154)
        dr.rectangle([0, y, 4, y + TH + HEAD], fill=col)
        dr.text((PAD + 4, y + HEAD), n, fill=(235, 232, 225), font=f_big)
        if r is None:
            dr.text((PAD + 4, y + HEAD + 24), 'capture failed', fill=col, font=f)
        else:
            dr.text((PAD + 4, y + HEAD + 24), f'{r["pct"]:.3f}% over tol', fill=col, font=f)
            dr.text((PAD + 4, y + HEAD + 42), f'{r["exactPct"]:.3f}% any delta', fill=(160, 168, 178), font=f)
            dr.text((PAD + 4, y + HEAD + 60), f'mean {r["mean"]}  max {r["max"]}', fill=(160, 168, 178), font=f)
        for j, (sub, cap) in enumerate((('A', 'A ' + la), ('B', 'B ' + lb), ('diff', 'diff'))):
            x = LW + PAD + j * (TW + PAD)
            p = path.parent / sub / f'{n}.png'
            dr.text((x, y + 6), cap[-60:], fill=(160, 168, 178), font=f)
            if p.exists():
                sheet.paste(Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS), (x, y + HEAD))
            else:
                dr.rectangle([x, y + HEAD, x + TW, y + HEAD + TH], outline=(90, 90, 90))
                dr.text((x + 10, y + HEAD + 10), 'missing', fill=(160, 168, 178), font=f)
    sheet.save(path, optimize=True)


def contact_html(path, la, lb, names, results, ma, mb, limit, title):
    rows = []
    for n in names:
        r = results.get(n)
        bad = r is None or r['pct'] > limit
        badge = 'capture failed' if r is None else f'{r["pct"]:.3f}%'
        errs = []
        for tag, m in (('A', ma), ('B', mb)):
            i = m.get(n, {})
            errs += [f'{tag}: {e}' for e in i.get('errors', []) + ([i['exception']] if i.get('exception') else [])]
        cells = ''.join(f'<figure><a href="{s}/{n}.png"><img loading="lazy" src="{s}/{n}.png" alt="{html.escape(c)} {n}"></a>'
                        f'<figcaption>{html.escape(c)}</figcaption></figure>'
                        for s, c in (('A', 'A ' + la), ('B', 'B ' + lb), ('diff', 'diff')))
        detail = '' if r is None else f'any delta {r["exactPct"]}% · mean {r["mean"]} · max {r["max"]}' + (f' · box {r["box"]}' if r.get('box') else '')
        rows.append(f'<section class="{"bad" if bad else "ok"}" id="{n}"><header><h2>{n}</h2><span class="pct">{badge}</span>'
                    f'<small>{detail}</small></header><div class="trio">{cells}</div>'
                    + (f'<pre>{html.escape(chr(10).join(errs))}</pre>' if errs else '') + '</section>')
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raft Visual Diff</title><style>
:root{{--bg:#f4f1ea;--fg:#1b2430;--muted:#5d6774;--card:#fff;--line:#d9d3c7;--bad:#c4234f;--ok:#1f7a55}}
@media (prefers-color-scheme:dark){{:root{{--bg:#12161c;--fg:#e8e6e1;--muted:#98a0aa;--card:#1b2129;--line:#2c3440;--bad:#ff5c86;--ok:#4fd19a}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,Segoe UI,sans-serif}}
main{{max-width:1500px;margin:0 auto;padding:20px 16px}}h1{{font-size:20px;margin:0 0 4px}}.meta{{color:var(--muted);margin-bottom:18px}}
section{{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:8px;padding:10px 12px;margin:0 0 14px}}
section.bad{{border-left-color:var(--bad)}}header{{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}}
h2{{font-size:15px;margin:0}}.pct{{font-weight:700;font-variant-numeric:tabular-nums}}.bad .pct{{color:var(--bad)}}.ok .pct{{color:var(--ok)}}
small{{color:var(--muted)}}.trio{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}}
@media (max-width:800px){{.trio{{grid-template-columns:1fr}}}}
figure{{margin:0}}img{{width:100%;display:block;border-radius:4px;border:1px solid var(--line)}}
figcaption{{color:var(--muted);font-size:12px;margin-top:2px;overflow-wrap:anywhere}}pre{{white-space:pre-wrap;color:var(--bad);font-size:12px;margin:8px 0 0}}
</style></head><body><main><h1>{html.escape(title)}</h1>
<div class="meta">A = {html.escape(la)} · B = {html.escape(lb)} · threshold {limit}% of pixels over tolerance<br>
Diff colors: red = channel delta above tolerance, amber = any smaller delta. <a href="contact-sheet.png">PNG contact sheet</a></div>
{''.join(rows)}</main></body></html>'''
    path.write_text(page, encoding='utf-8')


def state_delta(a, b):
    """Keys whose raftDebug values differ between two runs (rounded so last-digit float noise is ignored)."""
    def norm(v):
        if isinstance(v, float): return round(v, 4)
        if isinstance(v, dict): return {k: norm(x) for k, x in v.items()}
        if isinstance(v, list): return [norm(x) for x in v]
        return v
    a, b = norm(a or {}), norm(b or {})
    return {k: [a.get(k), b.get(k)] for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dist', help='self-determinism: render this dist twice')
    ap.add_argument('--base', help='reference dist (e.g. main)')
    ap.add_argument('--head', help='dist under test (e.g. the branch)')
    ap.add_argument('--out', default='visual-diff-out', help='artifact directory (default ./visual-diff-out)')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--tol', type=int, default=24, help='per-channel delta (0-255) that counts a pixel as changed (default 24)')
    ap.add_argument('--fail-over', type=float, default=0.5, help='base/head: percent of changed pixels that marks a scene as different (default 0.5)')
    ap.add_argument('--self-fail-over', type=float, default=0.05, help='self-check: percent of changed pixels that counts as nondeterminism (default 0.05)')
    ap.add_argument('--self-tol', type=int, default=2, help='per-channel tolerance for the determinism comparison (default 2: same build must be near pixel-identical)')
    ap.add_argument('--fail-on-diff', action='store_true', help='base/head: fail (exit 1) when a scene differs over --fail-over')
    ap.add_argument('--check-determinism', action='store_true', help='base/head: also render head twice and gate on its noise')
    ap.add_argument('--jobs', type=int, default=2, help='browsers rendering runs side by side (default 2; 1 = sequential)')
    ap.add_argument('--only', default='', help='comma list of scene names')
    ap.add_argument('--list', action='store_true', help='print scene names and exit')
    args = ap.parse_args()
    if args.list:
        for n, s in SCENES.items(): print(f'{n:13} {describe(s, args.seed)}')
        return 0

    out = Path(args.out).resolve()
    result = {'tool': TOOL, 'pass': False, 'failures': [], 'metrics': {}, 'artifacts': []}

    def finish(code):
        result['pass'] = code == 0
        print(json.dumps(result))
        return code

    def infra(detail):
        result['failures'].append({'id': 'harness', 'detail': detail, 'repro': ' '.join(['python3.13'] + sys.argv)})
        return finish(2)

    if args.dist and (args.base or args.head): return infra('use either --dist or --base/--head, not both')
    if args.dist: mode, base, head = 'self', Path(args.dist), Path(args.dist)
    elif args.base and args.head: mode, base, head = 'compare', Path(args.base), Path(args.head)
    else: return infra('need --dist <dist> or --base <dist> --head <dist>')
    for d in {base, head}:
        if not (d / 'index.html').exists(): return infra(f'{d} has no index.html')
    names = [n for n in args.only.split(',') if n] or list(SCENES)
    unknown = [n for n in names if n not in SCENES]
    if unknown: return infra(f'unknown scenes {unknown}; see --list')

    base, head = base.resolve(), head.resolve()
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    jobs = [(head, 'A', 'run1'), (head, 'B', 'run2')] if mode == 'self' else \
        [(base, 'A', 'base'), (head, 'B', 'head')] + ([(head, 'C', 'head2')] if args.check_determinism else [])
    metas, errors = {}, []

    def worker(batch):
        # One Playwright driver + browser per thread (the sync API is per-thread). Runs are independent, and
        # frames are a pure function of seed + steps, so running them side by side cannot change pixels.
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = launch_chromium(p)
                try:
                    for dist, sub, label in batch:
                        metas[sub] = capture(browser, dist, out / sub, names, args.seed, label)
                finally:
                    browser.close()
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            errors.append(str(e).splitlines()[0][:300] if str(e) else repr(e))

    n_threads = max(1, min(args.jobs, len(jobs)))
    threads = [threading.Thread(target=worker, args=(jobs[i::n_threads],)) for i in range(n_threads)]
    for t in threads: t.start()
    for t in threads: t.join()
    if errors: return infra(f'browser run failed: {errors[0]}')
    ma, mb, mc = metas['A'], metas['B'], metas.get('C')

    allinfo = [i for m in (ma, mb) for i in m.values()]
    if not any(i['ok'] or i.get('booted') for i in allinfo):
        first = next(iter(mb.values()))
        return infra(f'no scene could be captured in either run; first error: {first.get("exception")}')

    (out / 'diff').mkdir(exist_ok=True)
    tol = args.self_tol if mode == 'self' else args.tol
    results = {n: diff(out / 'A' / f'{n}.png', out / 'B' / f'{n}.png', out / 'diff' / f'{n}.png', tol)
               for n in names if ma[n]['ok'] and mb[n]['ok']}
    noise = {}
    if mc is not None:
        (out / 'noise').mkdir(exist_ok=True)
        noise = {n: diff(out / 'B' / f'{n}.png', out / 'C' / f'{n}.png', out / 'noise' / f'{n}.png', args.self_tol)
                 for n in names if mb[n]['ok'] and mc[n]['ok']}

    limit = args.self_fail_over if mode == 'self' else args.fail_over
    la, lb = (f'{head} run 1', f'{head} run 2') if mode == 'self' else (f'base {base}', f'head {head}')
    title = ('Little Raft self-determinism' if mode == 'self' else 'Little Raft visual diff') + f' · seed {args.seed} · tol {tol}'
    contact_png(out / 'contact-sheet.png', la, lb, names, results, limit, title)
    contact_html(out / 'index.html', la, lb, names, results, ma, mb, limit, title)

    def repro(n, dist):
        cmd = f'python3.13 tools/visual-diff.py --dist {dist} --only {n} --seed {args.seed}'
        return f'{cmd}  (scene: {describe(SCENES[n], args.seed)})'

    fails = result['failures']
    # Scenes that cannot be reached, or that throw page errors, in the build under test are game failures.
    runs = [('run1', ma), ('run2', mb)] if mode == 'self' else [('head', mb)] + ([('head2', mc)] if mc else [])
    seen = set()
    for lab, m in runs:
        for n in names:
            info = m[n]
            if not info['ok'] and ('capture', n) not in seen:
                seen.add(('capture', n))
                fails.append({'id': f'capture:{n}', 'detail': f'{lab}: scene could not be rendered: {info.get("exception")}',
                              'repro': repro(n, head)})
            for e in info['errors']:
                if e.startswith('pageerror') and ('pageerror', n) not in seen:
                    seen.add(('pageerror', n))
                    fails.append({'id': f'pageerror:{n}', 'detail': f'{lab}: {e}', 'repro': repro(n, head)})
    det = results if mode == 'self' else noise
    sa, sb = (ma, mb) if mode == 'self' else (mb, mc)
    for n, r in det.items():
        if r['pct'] > args.self_fail_over:
            fails.append({'id': f'nondeterministic:{n}',
                          'detail': f'same build, same seed rendered differently: {r["pct"]}% of pixels over tol {args.self_tol} '
                                    f'(limit {args.self_fail_over}%), box {r["box"]}; raftDebug state delta '
                                    f'{json.dumps(state_delta(sa[n].get("state"), sb[n].get("state")))[:400]}',
                          'repro': repro(n, head) + ' -- run it twice and compare'})
    diffs_over = sorted((n for n, r in results.items() if r['pct'] > args.fail_over), key=lambda n: -results[n]['pct'])
    if mode == 'compare' and args.fail_on_diff:
        for n in diffs_over:
            r = results[n]
            fails.append({'id': f'diff:{n}', 'detail': f'head differs from base: {r["pct"]}% of pixels over tol {args.tol} '
                                                         f'(limit {args.fail_over}%), box {r["box"]}',
                          'repro': f'python3.13 tools/visual-diff.py --base {base} --head {head} --only {n} --seed {args.seed}; '
                                   f'open {out / "index.html"}#{n}'})

    result['metrics'] = {
        'mode': mode, 'seed': args.seed, 'tol': tol, 'threshold': limit, 'scenes': len(names),
        'captured': sum(1 for n in names if ma[n]['ok'] and mb[n]['ok']),
        'seconds': round(time.time() - t0, 1),
        'worstPct': max((r['pct'] for r in results.values()), default=None),
        'perScenePct': {n: results[n]['pct'] if n in results else None for n in names},
        'perSceneExactPct': {n: results[n]['exactPct'] for n in results},
        'blockedRequests': sorted({u for m in (ma, mb) for i in m.values() for u in i['blocked']})[:20],
    }
    if mode == 'compare':
        result['metrics']['differentScenes'] = diffs_over
        if base_only := [n for n in names if not ma[n]['ok']]:
            result['metrics']['baseCaptureFailed'] = base_only
        if noise:
            result['metrics']['headNoisePct'] = {n: r['pct'] for n, r in noise.items()}
    report = {'mode': mode, 'base': str(base), 'head': str(head), 'seed': args.seed, 'tol': tol,
              'scenes': {n: {'steps': describe(SCENES[n], args.seed), 'diff': results.get(n), 'noise': noise.get(n),
                             'a': ma[n], 'b': mb[n]} for n in names}}
    (out / 'report.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    result['artifacts'] = [str(out / 'contact-sheet.png'), str(out / 'index.html'), str(out / 'report.json')]
    for n in names:
        r = results.get(n)
        print(f'{n:13} ' + ('capture failed' if r is None else f'{r["pct"]:8.4f}% over tol  {r["exactPct"]:8.4f}% any'),
              file=sys.stderr)
    return finish(1 if fails else 0)


if __name__ == '__main__':
    sys.exit(main())
