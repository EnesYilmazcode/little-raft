"""Visual regression for Little Raft: capture a fixed, seeded set of game states from two dist folders
and build an HTML contact sheet with per-state pixel-diff percentages.

  python tools/visual-diff.py <distA> <distB> <outDir> [--seed 7] [--tol 24] [--fail-over 0.5] [--only a,b]
  python tools/visual-diff.py --capture <dist> <outDir>      # one side only, no sheet

Pass the same folder twice to measure the noise floor. Each state runs in a fresh browser context with
tools/determinism.js injected and the page opened at ?seed=<n>&freeze=1, so Math.random is seeded and
frames advance only through window.__det.step(). Exit code: 0 ok, 1 a state is over --fail-over percent
or a capture failed, 2 bad usage.
"""
import argparse, functools, html, http.server, json, socketserver, sys, threading, time
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
SHIM = (HERE / 'determinism.js').read_text(encoding='utf-8')
W, H = 1280, 720
CX, CY = W // 2, H // 2
RAD_PX = 1 / .005  # game.js DRAG_SENSITIVITY: 0.005 rad per dragged pixel

# Each state: list of steps. ('frames', n) | ('click', sel) | ('key', key) | ('hold', key, frames)
# | ('yaw', rad) | ('pitch', rad) | ('wait', ms of wall time, for setTimeout-driven UI)
START = [('frames', 10), ('click', '#solo'), ('frames', 90)]
STATES = {
    'title':          [('frames', 30)],
    'title-help':     [('frames', 10), ('click', '#helpButton'), ('frames', 10)],
    'title-crew':     [('frames', 10), ('click', '#welcomeCrew'), ('frames', 10)],
    'spawn':          START,
    'look-left':      START + [('yaw', 1.5708), ('frames', 20)],
    'look-right':     START + [('yaw', -1.5708), ('frames', 20)],
    'look-back':      START + [('yaw', 3.1416), ('frames', 20)],
    'look-sky':       START + [('pitch', 1.0), ('frames', 20)],
    'look-deck':      START + [('pitch', -1.0), ('frames', 20)],
    'horizon':        START + [('pitch', .28), ('frames', 20)],
    'ocean-later':    START + [('frames', 600)],
    'walk-forward':   START + [('hold', 'w', 60), ('frames', 30)],
    'walk-strafe':    START + [('hold', 'd', 45), ('frames', 30)],
    'tool-build':     START + [('key', '2'), ('frames', 20)],
    'tool-fish':      START + [('key', '3'), ('frames', 20)],
    'slot-4':         START + [('key', '4'), ('frames', 20)],
    'inventory':      START + [('key', 'Tab'), ('frames', 20)],
    'pause':          START + [('key', 'Escape'), ('frames', 20)],
    'hook-charge':    START + [('pitch', -.25), ('down',), ('frames', 40)],
    'hook-thrown':    START + [('pitch', -.25), ('down',), ('frames', 40), ('up',), ('frames', 50)],
}


def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store'); super().end_headers()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def drag(page, dx, dy):
    # game.js drag-to-look: pointerdown, >4px move applies look(dx, dy), pointerup without a click.
    # Split into chunks so the pointer stays inside the 1280x720 canvas.
    while abs(dx) > 0.5 or abs(dy) > 0.5:
        sx = max(-500, min(500, dx)); sy = max(-300, min(300, dy))
        page.mouse.move(CX - sx / 2, CY - sy / 2); page.mouse.down()
        page.mouse.move(CX + sx / 2, CY + sy / 2, steps=1); page.mouse.up()
        dx -= sx; dy -= sy


def run_state(page, steps):
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
        elif k == 'wait': page.wait_for_timeout(s[1])
        else: raise ValueError(f'unknown step {s!r}')


def capture(dist, out, names, seed):
    dist = Path(dist).resolve(); out = Path(out); out.mkdir(parents=True, exist_ok=True)
    if not (dist / 'index.html').exists(): raise SystemExit(f'{dist} has no index.html')
    srv = serve(dist); url = f'http://127.0.0.1:{srv.server_address[1]}/?seed={seed}&freeze=1'
    meta = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel='chrome', headless=True,
                                  args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            for name in names:
                t0 = time.time(); info = {'errors': [], 'console': []}
                ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, reduced_motion='reduce')
                ctx.add_init_script(SHIM)
                page = ctx.new_page()
                page.on('pageerror', lambda e, i=info: i['errors'].append(str(e)[:300]))
                page.on('console', lambda m, i=info: m.type == 'error' and i['console'].append(m.text[:300]))
                try:
                    page.goto(url, wait_until='load')
                    page.wait_for_function('!!window.__det && !!window.raftDebug', timeout=20000, polling=100)
                    run_state(page, STATES[name])
                    page.screenshot(path=str(out / f'{name}.png'), animations='disabled', caret='hide')
                    try:
                        st = page.evaluate('(()=>{const s=raftDebug.state;return {running:s.running,tool:s.tool,heldKind:s.heldKind,items:s.items,camera:s.camera,frame:__det.frame}})()')
                        info['state'] = st
                    except Exception as e: info['errors'].append('state: ' + str(e)[:200])
                    info['ok'] = True
                except Exception as e:
                    info['ok'] = False; info['errors'].append('capture: ' + str(e).splitlines()[0][:300])
                info['seconds'] = round(time.time() - t0, 2)
                meta[name] = info; ctx.close()
                print(f'  {dist.name}:{name} {"ok" if info["ok"] else "FAILED"} {info["seconds"]}s', file=sys.stderr)
            b.close()
    finally:
        srv.shutdown()
    (out / 'capture.json').write_text(json.dumps(meta, indent=1), encoding='utf-8')
    return meta


def diff(a_png, b_png, d_png, tol):
    a = np.asarray(Image.open(a_png).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(b_png).convert('RGB'), dtype=np.int16)
    if a.shape != b.shape: return {'pct': 100.0, 'mean': 255.0, 'note': f'size {a.shape} vs {b.shape}'}
    d = np.abs(a - b).max(axis=2)
    mask = d > tol
    gray = (a.mean(axis=2) * .35).astype(np.uint8)
    img = np.stack([gray, gray, gray], axis=2)
    img[mask] = [255, 40, 90]
    soft = (d > 2) & ~mask
    img[soft] = [255, 190, 60]
    Image.fromarray(img).save(d_png)
    ys, xs = np.nonzero(mask)
    box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
    return {'pct': round(100 * mask.mean(), 3), 'mean': round(float(d.mean()), 3), 'max': int(d.max()), 'box': box}


def sheet(out, la, lb, names, results, ma, mb, args):
    rows = []
    for n in names:
        r = results.get(n) or {}
        pct = r.get('pct'); bad = pct is None or pct > args.fail_over
        badge = 'n/a' if pct is None else f'{pct:.2f}%'
        errs = [f'A: {e}' for e in ma.get(n, {}).get('errors', [])] + [f'B: {e}' for e in mb.get(n, {}).get('errors', [])]
        cells = ''.join(f'<figure><a href="{s}/{n}.png"><img loading="lazy" src="{s}/{n}.png" alt="{c} {n}"></a><figcaption>{c}</figcaption></figure>'
                        for s, c in (('A', html.escape(la)), ('B', html.escape(lb)), ('diff', 'diff')))
        detail = '' if pct is None else f'mean {r["mean"]} · max {r["max"]}' + (f' · box {r["box"]}' if r.get('box') else '')
        rows.append(f'<section class="{"bad" if bad else "ok"}" id="{n}"><header><h2>{n}</h2><span class="pct">{badge}</span>'
                    f'<small>{detail}</small></header><div class="trio">{cells}</div>'
                    + (f'<pre>{html.escape(chr(10).join(errs))}</pre>' if errs else '') + '</section>')
    worst = sorted(((results[n].get('pct', 100), n) for n in names if n in results), reverse=True)
    summary = ' · '.join(f'<a href="#{n}">{n} {p:.2f}%</a>' for p, n in worst[:6])
    over = sum(1 for p, _ in worst if p > args.fail_over)
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raft Visual Diff</title><style>
:root{{--bg:#f4f1ea;--fg:#1b2430;--muted:#5d6774;--card:#fff;--line:#d9d3c7;--bad:#c4234f;--ok:#1f7a55}}
@media (prefers-color-scheme:dark){{:root{{--bg:#12161c;--fg:#e8e6e1;--muted:#98a0aa;--card:#1b2129;--line:#2c3440;--bad:#ff5c86;--ok:#4fd19a}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,Segoe UI,sans-serif}}
main{{max-width:1500px;margin:0 auto;padding:20px 16px}}h1{{font-size:20px;margin:0 0 4px}}
.meta{{color:var(--muted);margin-bottom:18px}}.meta a{{color:inherit}}
section{{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:8px;padding:10px 12px;margin:0 0 14px}}
section.bad{{border-left-color:var(--bad)}}header{{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}}
h2{{font-size:15px;margin:0}}.pct{{font-weight:700;font-variant-numeric:tabular-nums}}.bad .pct{{color:var(--bad)}}.ok .pct{{color:var(--ok)}}
small{{color:var(--muted)}}.trio{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}}
@media (max-width:800px){{.trio{{grid-template-columns:1fr}}}}
figure{{margin:0}}img{{width:100%;display:block;border-radius:4px;border:1px solid var(--line)}}
figcaption{{color:var(--muted);font-size:12px;margin-top:2px;overflow-wrap:anywhere}}pre{{white-space:pre-wrap;color:var(--bad);font-size:12px;margin:8px 0 0}}
</style></head><body><main><h1>Little Raft visual diff</h1>
<div class="meta">A = {html.escape(la)} · B = {html.escape(lb)} · seed {args.seed} · tolerance {args.tol}/255 · fail over {args.fail_over}%<br>
{over} of {len(names)} states over threshold. Worst: {summary}<br>Diff colors: red = channel delta above tolerance, amber = small delta (3 to {args.tol}).</div>
{''.join(rows)}</main></body></html>'''
    (out / 'index.html').write_text(page, encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('paths', nargs='+')
    ap.add_argument('--capture', action='store_true', help='capture one dist only: <dist> <outDir>')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--tol', type=int, default=24, help='per-channel delta (0-255) that counts as changed')
    ap.add_argument('--fail-over', type=float, default=0.5, help='percent of changed pixels that fails a state')
    ap.add_argument('--only', default='', help='comma list of state names')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()
    if args.list: print('\n'.join(STATES)); return 0
    names = [n for n in args.only.split(',') if n] or list(STATES)
    unknown = [n for n in names if n not in STATES]
    if unknown: print(f'unknown states: {unknown}', file=sys.stderr); return 2
    if args.capture:
        if len(args.paths) != 2: ap.error('--capture takes <dist> <outDir>')
        meta = capture(args.paths[0], args.paths[1], names, args.seed)
        return 0 if all(m['ok'] for m in meta.values()) else 1
    if len(args.paths) != 3: ap.error('need <distA> <distB> <outDir>')
    da, db, out = Path(args.paths[0]), Path(args.paths[1]), Path(args.paths[2])
    (out / 'diff').mkdir(parents=True, exist_ok=True)
    ma = capture(da, out / 'A', names, args.seed)
    mb = capture(db, out / 'B', names, args.seed)
    results = {}
    for n in names:
        if ma[n]['ok'] and mb[n]['ok']:
            results[n] = diff(out / 'A' / f'{n}.png', out / 'B' / f'{n}.png', out / 'diff' / f'{n}.png', args.tol)
    sheet(out, str(da), str(db), names, results, ma, mb, args)
    report = {'a': str(da.resolve()), 'b': str(db.resolve()), 'seed': args.seed, 'tol': args.tol, 'failOver': args.fail_over,
              'states': {n: {'diff': results.get(n), 'a': ma[n], 'b': mb[n]} for n in names}}
    (out / 'report.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    failed = [n for n in names if n not in results or results[n]['pct'] > args.fail_over]
    for n in names:
        r = results.get(n); print(f'{n:14} ' + ('FAILED capture' if r is None else f'{r["pct"]:7.3f}%'))
    print(f'sheet: {(out / "index.html").resolve()}')
    print(f'{len(failed)} over threshold: {", ".join(failed) or "none"}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
