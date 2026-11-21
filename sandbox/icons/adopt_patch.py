"""Adopt the merged item icons into dist/ (see docs/tech/icons-ADOPT.md).

The merge keeps main's dist/item-icons.js public API byte-for-byte (iconURL, getItemIcon, loadItemIcon,
warmIcons, onIconReady, setModelProvider, buildFallbackModel), so NO caller changes: game.js and
survival-ui.js keep their import lines. The patch is two files:
  dist/item-icons.js        <- sandbox/icons/item-icons.js        (replaces main's renderer)
  dist/item-icon-models.js  <- sandbox/icons/item-icon-models.js  (new: icon-only stand-in models)
with the ?build= id rewritten to the target dist's id.

  python sandbox/icons/adopt_patch.py --check  [--dist D] [--no-game] [--no-tests]
      Copies D (default: repo dist/) to a temp dir, asserts every anchor exactly once there, applies,
      boots the REAL game headless through index.html / live.js (Solo, seeded save), screenshots the
      hotbar and the open bag into sandbox/icons/shots/adopt-*.png, and runs `node --test tests/` with
      RAFT_DIST pointing at the patched copy. D itself is never written.
  python sandbox/icons/adopt_patch.py --apply  [--dist D]
      Same anchor checks, then writes the two files into D.
"""
import re, sys, json, shutil, tempfile, subprocess, threading, functools, http.server, socketserver, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC_BUILD = 'v3-survival-ae77fa84ac2b'   # build id the sandbox sources are written against
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

# Each anchor must occur exactly once in the target file before the patch is allowed.
ANCHORS = {
    # main's item-icons.js: the public API the merged file preserves (proves we replace the right file)
    'item-icons.js': [
        "export function iconURL(kind) {\n",
        "export const getItemIcon = iconURL;\n",
        "export function loadItemIcon(kind) {\n",
        "export function warmIcons(kinds) { for (const k of kinds) iconURL(k); }\n",
        "export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }\n",
        "export function setModelProvider(fn) {\n",
        "export function buildFallbackModel(kind) {\n",
    ],
    # callers: unchanged by the patch, asserted so a caller-side API change is caught
    'game.js': [
        "import { getItemIcon, onIconReady } from './item-icons.js?build={B}';\n",
        "      getModel:modelOf, // 3D icons rendered from models.js\n",
        "    pickupFeed.setIconProvider(getItemIcon); offIconReady = onIconReady(k => pickupFeed.refresh(k));",
    ],
    'survival-ui.js': [
        "import { iconURL, warmIcons, onIconReady, setModelProvider } from './item-icons.js?build={B}';\n",
        "  if (typeof getModel === 'function') setModelProvider(getModel);\n",
        "  const offIcons = onIconReady(kind => {\n",
        "  const url = iconURL(kind);\n",
    ],
}
API = ['iconURL', 'getItemIcon', 'loadItemIcon', 'warmIcons', 'onIconReady', 'setModelProvider', 'buildFallbackModel']


def build_id(dist):
    m = re.search(r"\?build=([A-Za-z0-9._-]+)'", (dist / 'game.js').read_text())
    if not m: raise SystemExit('game.js: no ?build= id found')
    return m.group(1)


def new_files(b):
    out = {}
    for name in ('item-icons.js', 'item-icon-models.js'):
        src = (HERE / name).read_text()
        if SRC_BUILD not in src: raise SystemExit(f'sandbox/icons/{name}: source build id {SRC_BUILD} not found')
        out[name] = src.replace(SRC_BUILD, b)
    return out


def exports(src):
    names = set(re.findall(r'^export (?:async )?(?:function|const|let) ([A-Za-z_$][\w$]*)', src, re.M))
    return names


def check(dist):
    """Assert anchors, API parity and imports against dist. Returns (build id, new files)."""
    b = build_id(dist)
    for name, anchors in ANCHORS.items():
        src = (dist / name).read_text()
        for a in anchors:
            a = a.replace('{B}', b)
            n = src.count(a)
            if n != 1: raise SystemExit(f'{name}: anchor found {n} times, expected 1:\n{a}')
    if (dist / 'item-icon-models.js').exists():
        raise SystemExit('item-icon-models.js already exists in target dist (already adopted?)')
    files = new_files(b)
    old_api, new_api = exports((dist / 'item-icons.js').read_text()), exports(files['item-icons.js'])
    missing = [x for x in API if x not in new_api]
    if missing or not set(API) <= old_api: raise SystemExit(f'API mismatch: merged lacks {missing}; main has {sorted(old_api)}')
    for name, src in files.items():
        for mod in re.findall(r"^import [^;]*? from '\./([A-Za-z0-9_./-]+\.js)(?:\?[^']*)?';", src, re.M):
            if mod in files: continue
            if not (dist / mod).is_file(): raise SystemExit(f'{name} imports ./{mod}, missing from {dist}')
    return b, files


def apply(dist, files):
    for name, src in files.items(): (dist / name).write_text(src)


def save_script():
    slots = [None] * 28
    hot = [('hook', 1, 100), ('fishingrod', 1, 100), ('hammer', 1, 100), ('wood', 14, None), ('plastic', 9, None),
           ('scrap', 5, None), ('rope', 3, None), ('nail', 12, None)]
    bag = [('leaf', 20), ('fish', 2), ('net', 1), ('lantern', 1), ('bench', 1), ('crate', 1), ('palm', 1), ('sail', 1),
           ('sand', 6), ('metalingot', 2), ('bolt', 4), ('glass', 1), ('cookedfish', 1), ('metalhook', 1)]
    for i, (k, c, d) in enumerate(hot): slots[i] = {'kind': k, 'count': c, **({'durability': d} if d is not None else {})}
    for i, (k, c) in enumerate(bag): slots[10 + i] = {'kind': k, 'count': c}
    save = {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0,
            'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0}, 'guestInventory': None}
    return f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('little-raft-v1', {json.dumps(json.dumps(save))}); sessionStorage.setItem('seeded', '1'); }}"


def boot_game(dist, shots):
    from playwright.sync_api import sync_playwright
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store'); super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    rep = {'pageErrors': [], 'consoleErrors': []}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME, headless=True, args=ARGS)
            ctx = b.new_context(viewport={'width': 1280, 'height': 720})
            ctx.set_default_timeout(300000)
            ctx.add_init_script(save_script())
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: rep['pageErrors'].append(str(e)[:300]))
            pg.on('console', lambda m: m.type == 'error' and rep['consoleErrors'].append(m.text[:200]))
            pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=180000)
            t0 = time.time()
            pg.evaluate("document.querySelector('#solo').click()"); pg.wait_for_function('raftDebug.state.running', timeout=180000)
            pg.wait_for_function("document.querySelectorAll('.tools img.sv-3d').length >= 8", timeout=300000, polling=250)
            rep['hotbar3dAfterS'] = round(time.time() - t0, 1)
            rep['hotbar'] = pg.evaluate("[...document.querySelectorAll('.tools .sv-slot')].slice(0, 10).map(s => s.querySelector('img.sv-3d') ? 'img:' + s.querySelector('img').dataset.icon : s.querySelector('svg') ? 'svg' : 'empty')")
            bb = pg.evaluate("(() => { const r = document.querySelector('.tools').getBoundingClientRect(); return {x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 30), width: r.width + 12, height: r.height + 36}; })()")
            pg.screenshot(path=str(shots / 'adopt-game.png'))
            pg.screenshot(path=str(shots / 'adopt-hotbar.png'), clip=bb)
            pg.keyboard.press('Tab'); pg.wait_for_timeout(2500)
            pg.wait_for_function("document.querySelector('#inventory')?.open", timeout=30000)
            rep['bag'] = pg.evaluate("(() => { const d = document.querySelector('#inventory'); return { img3d: d.querySelectorAll('img.sv-3d').length, svg: d.querySelectorAll('svg.sv-icon').length }; })()")
            pg.screenshot(path=str(shots / 'adopt-bag.png'))
            pg.keyboard.press('Tab')
            b.close()
    finally:
        srv.shutdown()
    return rep


if __name__ == '__main__':
    argv = sys.argv[1:]
    dist = Path(argv[argv.index('--dist') + 1]).resolve() if '--dist' in argv else ROOT / 'dist'
    if '--apply' in argv:
        b, files = check(dist); apply(dist, files)
        print(f'applied to {dist}: item-icons.js (replaced), item-icon-models.js (new), build {b}')
        sys.exit(0)
    if '--check' not in argv: print(__doc__); sys.exit(2)
    tmp = Path(tempfile.mkdtemp(prefix='icons-adopt-')) / 'dist'
    shutil.copytree(dist, tmp)
    try:
        b, files = check(tmp)
        print(f'ok: {sum(len(v) for v in ANCHORS.values())} anchors matched exactly once; API {", ".join(API)} preserved; imports present (build {b})', flush=True)
        apply(tmp, files)
        for name, anchors in ANCHORS.items():   # callers untouched after apply
            if name == 'item-icons.js': continue
            src = (tmp / name).read_text()
            assert all(src.count(a.replace('{B}', b)) == 1 for a in anchors), name
        report = {'build': b}
        if '--no-game' not in argv:
            shots = HERE / 'shots'; shots.mkdir(exist_ok=True)
            report['game'] = boot_game(tmp, shots)
            print('game:', json.dumps(report['game']), flush=True)
        if '--no-tests' not in argv:
            r = subprocess.run('node --test tests/*.test.mjs', shell=True, cwd=ROOT, capture_output=True, text=True,
                               env={**__import__('os').environ, 'RAFT_DIST': str(tmp)}, timeout=1500)
            tail = [l for l in r.stdout.splitlines() if re.match(r'# (tests|pass|fail)', l) or l.startswith('not ok')]
            report['tests'] = tail
            print('tests (patched):', ' | '.join(tail), flush=True)
        if report.get('game', {}).get('pageErrors'): raise SystemExit('page errors in patched game')
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
