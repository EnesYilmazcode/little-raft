"""Applies docs/tech/foliage-ADOPT.md to a temporary copy of dist/ and checks it end to end.

  python sandbox/foliage/adopt_check.py [--no-tests] [--no-browser] [--keep]

1. Parses the ADOPT doc: `- copy: <src> -> <dst>` lines and `#### A<n> · <file>` sections with a `js find` and a
   `js replace` fence. Every find must occur exactly once in the current file (asserted), then it is replaced.
2. `node --check` on every changed or added dist file.
3. Runs `node --test tests/*.test.mjs` on an unpatched and a patched copy (tests/ copied next to each dist/).
4. Boots both copies headless through index.html (live.js) with a palm decor in the save, noon, calm weather.
   Spawns island 1234 through raftDebug.content.islands, shoots raft / ashore / palm / mid / far / raft-palm
   views, checks the palm pick and gathers it until spent (E key), then hot-swaps twice through live.js by
   announcing new builds in version.json, and counts programs and live program users (sum of usedTimes).
Shots: sandbox/foliage/shots/adopt/{base,patched}-<view>.png and side-by-side pairs. Prints JSON."""
import sys, re, json, shutil, tempfile, threading, functools, subprocess, http.server, socketserver
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DOC = ROOT / 'docs/tech/foliage-ADOPT.md'
SHOTS = HERE / 'shots/adopt'
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
OLD = json.loads((ROOT / 'dist/version.json').read_text())['build']


def parse_doc(text):
    copies = re.findall(r'^- copy: `([^`]+)` -> `([^`]+)`', text, re.M)
    edits = []
    for m in re.finditer(r'^#### (A\d+) · (dist/\S+) · (.*)$', text, re.M):
        rest = text[m.end():]
        nxt = re.search(r'^#### A\d+ ', rest, re.M)
        body = rest[:nxt.start()] if nxt else rest
        f = re.search(r'```js find\n(.*?)\n```', body, re.S)
        r = re.search(r'```js replace\n(.*?)\n```', body, re.S)
        assert f and r, f'{m.group(1)}: missing find/replace fence'
        edits.append({'id': m.group(1), 'file': m.group(2), 'what': m.group(3).strip(), 'find': f.group(1), 'replace': r.group(1)})
    return copies, edits


def apply(root, copies, edits):
    report, touched = [], set()
    for src, dst in copies:
        shutil.copyfile(ROOT / src, root / dst); touched.add(dst)
    for e in edits:
        p = root / e['file']
        s = p.read_text()
        n = s.count(e['find'])
        report.append({'id': e['id'], 'file': e['file'], 'count': n})
        assert n == 1, f"{e['id']} {e['file']}: find occurs {n} times"
        p.write_text(s.replace(e['find'], e['replace'], 1)); touched.add(e['file'])
    return report, sorted(touched)


def make_copy(base, name):
    d = base / name
    shutil.copytree(ROOT / 'dist', d / 'dist')
    shutil.copytree(ROOT / 'tests', d / 'tests')
    shutil.copyfile(ROOT / 'package.json', d / 'package.json')
    return d


def run_tests(d):
    p = subprocess.run('node --test tests/*.test.mjs', shell=True, cwd=d, capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    g = lambda k: int(re.search(rf'^# {k} (\d+)', out, re.M).group(1)) if re.search(rf'^# {k} (\d+)', out, re.M) else None
    fails = re.findall(r'^not ok \d+ - (.*)$', out, re.M)
    return {'tests': g('tests'), 'pass': g('pass'), 'fail': g('fail'), 'failed': fails[:20]}


# ------------------------------------------------------------------ browser
SAVE = {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [{'type': 'palm', 'x': 1, 'z': 0, 'rot': 0}], 'stock': {},
        'fish': 0, 'collected': 0, 'hookHealth': 100, 'items': [], 'hostInventory': None, 'guestInventory': None}
INIT = "localStorage.setItem('little-raft-v1', %s);" % json.dumps(json.dumps(SAVE))
PROBE = r"""(() => { const r = window.__rend && window.__rend(); if (!r) return null; const P = r.info.programs || [];
  let users = 0, fol = 0, folUsers = 0; for (const p of P) { users += p.usedTimes; if ((p.cacheKey || '').includes('foliage')) { fol++; folUsers += p.usedTimes; } }
  const i = window.raftDebug.renderInfo;
  return { programs: P.length, programUsers: users, foliagePrograms: fol, foliageUsers: folUsers, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
           calls: i.calls, triangles: i.triangles, meshes: i.meshes, shadowCasters: i.shadowCasters }; })()"""
FRAME_MS = r"""new Promise(res => { const d = []; let last = performance.now(), n = 0;
  const f = t => { d.push(t - last); last = t; if (++n < 40) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b); res({ avg: d.reduce((a, b) => a + b, 0) / d.length, p50: d[d.length >> 1], worst: d[d.length - 1] }); } };
  requestAnimationFrame(f); })"""


def browser(variant, d, hotswap=True):
    from playwright.sync_api import sync_playwright
    dist = d / 'dist'
    announced = {'build': OLD}

    def instrument(name, text):
        if name == 'game.js':
            text = text.replace('window.raftDebug = debugApi;', 'window.raftDebug = debugApi; window.__rend = () => renderer;', 1)
        return text

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/'

    def route(r):
        u = urlparse(r.request.url); name = u.path.lstrip('/') or 'index.html'
        if u.netloc != base.split('/')[2]: return r.abort()  # no fonts or CDNs in the check
        if name == 'version.json':
            return r.fulfill(status=200, content_type='application/json', body=json.dumps({'build': announced['build'], 'protocol': 1}))
        f = dist / name
        if name.endswith('.js') and f.is_file():
            b = parse_qs(u.query).get('build', [None])[0]
            text = f.read_text()
            if b and b != OLD: text = text.replace(OLD, b)
            return r.fulfill(status=200, content_type='text/javascript', body=instrument(name, text), headers={'Cache-Control': 'no-store'})
        return r.continue_()

    R = {'errors': [], 'console': [], 'views': {}}
    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = br.new_context(viewport={'width': 960, 'height': 540}); ctx.add_init_script(INIT)
        page = ctx.new_page(); page.route('**/*', route)
        page.on('pageerror', lambda e: R['errors'].append(str(e)[:300]))
        page.on('console', lambda m: m.type == 'error' and 'ReadPixels' not in m.text and R['console'].append(m.text[:240]))
        page.goto(base); page.wait_for_function('!!window.raftDebug && !!window.__rend', timeout=180000)
        page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('window.raftDebug.state.running', timeout=60000)
        ev = page.evaluate
        ev("(() => { const dn = raftDebug.content.daynight; dn?.setPhase(0.3); dn?.setWeather('calm'); dn?.freeze(true); })()")
        page.wait_for_timeout(1500)
        R['boot'] = ev(PROBE)
        page.add_style_tag(content='.ob-notes,.sv-hotbar{visibility:hidden!important}')  # unclutter shots
        def shot(view, setup, settle=900):
            ev(setup); page.wait_for_timeout(settle)
            info = ev(PROBE); info['frame'] = ev(FRAME_MS)
            page.screenshot(path=str(SHOTS / f'{variant}-{view}.png'))
            R['views'][view] = info
            return info

        # raft palm decor close up: palm at tile (1, 0) = world (+2, 0); the player starts mid deck
        shot('raftpalm', "raftDebug.aim(0.1, -Math.PI / 2 + 0.3)", 900)
        isl = 'raftDebug.content.islands'
        R['island'] = ev(f'{isl}.spawnNear(1234)')
        page.wait_for_timeout(800)
        nodes = ev(f'{isl}.nodes()')
        palm = next(n['i'] for n in nodes if n['kind'] == 'palm')
        R['nodes'] = {k: sum(1 for n in nodes if n['kind'] == k) for k in ('palm', 'bush', 'rock', 'sand')}

        # raft deck, looking at the docked island
        shot('raft', f"raftDebug.aim(0.02, {isl}.yawTo())", 1200)
        # mid and far: swim out on the far side of the raft, facing the island
        I = ev(f'{isl}.phase()')
        for view, far_m in (('mid', 45), ('far', 68)):
            shot(view, f"""(() => {{ const I = {json.dumps(I)}, px = 0, pz = 0, dx = px - I.x, dz = pz - I.z, l = Math.hypot(dx, dz) || 1;
                const x = I.x + dx / l * {far_m}, z = I.z + dz / l * {far_m}; raftDebug.swimAt(x, z, 0.04, Math.atan2(-(I.x - x), -(I.z - z))); }})()""", 1500)
        # ashore: a step from the palm, aim at its trunk and check the pick
        ev(f"window.__n = {isl}.aimAt({palm})"); page.wait_for_timeout(700)
        pick = ev(f"""(() => {{ const n = window.__n, c = raftDebug.state.camera; const p = Math.atan2(n.cy - c.y, Math.hypot(n.ax - c.x, n.az - c.z));
            raftDebug.aim(p, n.yaw); return p; }})()""")
        page.wait_for_timeout(500)
        R['pick'] = {'palm': palm, 'picked': ev(f'{isl}.pick()')}
        shot('ashore', f"raftDebug.aim(0.32, window.__n.yaw)", 600)
        # canopy from under the crown
        shot('canopy', f"(() => {{ {isl}.aimAt({palm}, 1.2); raftDebug.aim(1.0, window.__n.yaw); }})()", 900)
        # wide beach view: stand on the shore across from the palm, facing the island centre
        shot('beach', f"""(() => {{ const I = {isl}.phase(), n = {isl}.nodes()[{palm}], dx = n.x - I.x, dz = n.z - I.z, l = Math.hypot(dx, dz) || 1;
            {isl}.teleportAshore(-dx / l * I.R * 0.72, -dz / l * I.R * 0.72); raftDebug.aim(0.05, Math.atan2(-dx, -dz)); }})()""", 900)
        shot('palm', f"(() => {{ {isl}.aimAt({palm}, 4.5); raftDebug.aim(0.3, window.__n.yaw); }})()", 900)
        # gather the palm until spent (E key, 0.35 s local cooldown), the spent model must swap in
        ev(f"window.__n = {isl}.aimAt({palm})"); page.wait_for_timeout(500)
        ev("(() => { const n = window.__n, c = raftDebug.state.camera; raftDebug.aim(Math.atan2(n.cy - c.y, Math.hypot(n.ax - c.x, n.az - c.z)), n.yaw); })()")
        page.wait_for_timeout(400)
        R['prompt'] = ev("document.getElementById('lrPrompt')?.textContent || null")
        for _ in range(12):
            nn = ev(f'{isl}.nodes()[{palm}]')
            if nn['used'] >= nn['max']: break
            ev("(() => { const n = window.__n, c = raftDebug.state.camera; raftDebug.aim(Math.atan2(n.cy - c.y, Math.hypot(n.ax - c.x, n.az - c.z)), n.yaw); })()")
            page.wait_for_timeout(150); page.keyboard.press('KeyE'); page.wait_for_timeout(700)
        nn = ev(f'{isl}.nodes()[{palm}]')
        R['gather'] = {'used': nn['used'], 'max': nn['max']}
        shot('spent', f"(() => {{ {isl}.aimAt({palm}, 4.5); raftDebug.aim(0.3, window.__n.yaw); }})()", 900)
        if hotswap:
            R['swaps'] = [ev(PROBE)]
            for k in (1, 2):
                old = ev('window.__dbgRef = window.raftDebug, 1')
                announced['build'] = f'v3-foliage-swap{k}'
                try:
                    page.wait_for_function('window.raftDebug && window.raftDebug !== window.__dbgRef && window.raftDebug.state.running', timeout=120000, polling=200)
                except Exception as e:
                    R['swapError'] = {'k': k, 'status': ev("document.getElementById('updateStatus')?.textContent || null"),
                                      'fatal': ev("document.getElementById('raftLiveError')?.textContent || null"), 'err': str(e)[:200]}
                    break
                page.wait_for_timeout(2500)
                ev(f"raftDebug.aim(0.02, {isl}.yawTo() ?? 0)"); page.wait_for_timeout(800)
                R['swaps'].append(ev(PROBE))
            page.screenshot(path=str(SHOTS / f'{variant}-afterswap.png'))
        br.close()
    srv.shutdown()
    return R


def pairs():
    """Side-by-side base | patched PNGs, composed in the same headless browser (no PIL needed)."""
    import base64
    from playwright.sync_api import sync_playwright
    out = []
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = br.new_page(viewport={'width': 1928, 'height': 540})
        for f in sorted(SHOTS.glob('base-*.png')):
            g = SHOTS / f.name.replace('base-', 'patched-')
            if not g.exists(): continue
            u = lambda x: 'data:image/png;base64,' + base64.b64encode(x.read_bytes()).decode()
            page.set_content(f'<body style="margin:0;background:#fff;display:flex;gap:8px"><img src="{u(f)}"><img src="{u(g)}"></body>')
            page.wait_for_timeout(100)
            dst = SHOTS / f.name.replace('base-', 'pair-'); page.screenshot(path=str(dst)); out.append(dst.name)
        br.close()
    return out


def main():
    copies, edits = parse_doc(DOC.read_text())
    tmp = Path(tempfile.mkdtemp(prefix='foliage-adopt-'))
    base, patched = make_copy(tmp, 'base'), make_copy(tmp, 'patched')
    R = {'tmp': str(tmp), 'copies': copies}
    R['anchors'], touched = apply(patched, copies, edits)
    R['nodeCheck'] = {}
    for f in touched:
        p = subprocess.run(['node', '--check', str(patched / f)], capture_output=True, text=True)
        R['nodeCheck'][f] = 'ok' if p.returncode == 0 else p.stderr[-400:]
    assert all(v == 'ok' for v in R['nodeCheck'].values()), R['nodeCheck']
    c = subprocess.run(['node', str(HERE / 'islands_contract.mjs')], capture_output=True, text=True, cwd=ROOT,
                       env={**__import__('os').environ, 'RAFT_DIST': str(patched / 'dist')})
    try: R['islandsContract'] = json.loads(c.stdout.strip().splitlines()[-1])
    except Exception: R['islandsContract'] = {'ok': False, 'stderr': (c.stderr or c.stdout)[-600:]}
    if '--no-tests' not in sys.argv:
        R['testsBase'], R['testsPatched'] = run_tests(base), run_tests(patched)
    if '--no-browser' not in sys.argv:
        only = next((a.split('=')[1] for a in sys.argv if a.startswith('--only=')), None)
        if only in (None, 'base'): R['base'] = browser('base', base)
        if only in (None, 'patched'): R['patched'] = browser('patched', patched)
        R['pairs'] = pairs()
    if '--keep' not in sys.argv:
        shutil.rmtree(tmp, ignore_errors=True)
    R['anchors'] = ' '.join(f"{a['id']}:{a['count']}" for a in R['anchors'])
    print(json.dumps(R, indent=1))


if __name__ == '__main__':
    main()
