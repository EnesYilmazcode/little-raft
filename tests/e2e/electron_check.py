"""Desktop shell check: runs the real desktop/main.cjs in Electron against a candidate dist.

Usage: python3.13 tests/e2e/electron_check.py --dist <dist_dir> [--out <artifact_dir>]
                                               [--window show|offscreen|hidden] [--xvfb] [--no-hot-swap] [--keep]

The candidate is copied to a temp dir and served by the unmodified desktop/server.py (RAFT_DIST,
RAFT_PORT, release mode). An unmodified copy of desktop/main.cjs runs next to a config.json that
points its origin at that server, loaded through tools/electron_harness.cjs, which isolates
userData (and the single-instance lock) and exposes a stdin control channel. All input is real:
webContents.sendInputEvent keyboard and mouse events (trusted, with user activation), never JS
dispatch. Page state is only read through executeJavaScript (no gesture).

With no $DISPLAY (cloud box) a private Xvfb is started; --xvfb forces one even when $DISPLAY is
set (so your real mouse is never grabbed). Electron gets --no-sandbox and swiftshader GL flags.

Checked: Solo click acquires pointer lock (or the game's lockFallback path; which one is reported),
Esc releases lock and opens the pause menu, Esc again resumes, Tab/I opens inventory and Esc closes
it without leaving pause open, the window never closes / the app never quits on Esc, a fresh canvas
click re-acquires the lock, no renderer crash or console error, and (unless --no-hot-swap) a live
version.json hot-swap keeps Esc ownership sane.

Last stdout line is one JSON object {"tool","pass","failures","metrics","artifacts"}.
Exit 0 = pass, 1 = game/shell behaviour failure, 2 = harness/infra error.
"""
from __future__ import annotations

import argparse, base64, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
HARNESS = ROOT / 'tools' / 'electron_harness.cjs'
TOOL = 'electron_check'
ELECTRON_FLAGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                  '--ignore-gpu-blocklist', '--disable-gpu-sandbox']

# Installed into the page after boot. Records every lock request with the gesture state at call time
# and the outcome events, plus uncaught page errors.
PROBE = r"""(() => {
  if (window.__lrProbe) return true;
  const P = window.__lrProbe = { calls: [], events: [], exits: 0, errors: [] };
  const req = HTMLCanvasElement.prototype.requestPointerLock;
  HTMLCanvasElement.prototype.requestPointerLock = function (...a) {
    const c = { t: Math.round(performance.now()), id: this.id, active: !!navigator.userActivation?.isActive, result: 'pending' };
    P.calls.push(c);
    let r;
    try { r = req.apply(this, a); } catch (e) { c.result = 'threw ' + e.name; throw e; }
    if (r && typeof r.then === 'function') r.then(() => { c.result = 'ok'; }, (e) => { c.result = 'rejected ' + (e && e.name); });
    else c.result = 'no-promise';
    return r;
  };
  const exit = Document.prototype.exitPointerLock;
  Document.prototype.exitPointerLock = function (...a) { P.exits++; return exit.apply(this, a); };
  document.addEventListener('pointerlockchange', () => P.events.push({ t: Math.round(performance.now()), type: 'change', locked: document.pointerLockElement?.id || null }));
  document.addEventListener('pointerlockerror', () => P.events.push({ t: Math.round(performance.now()), type: 'error' }));
  window.addEventListener('error', (e) => P.errors.push(String(e.message).slice(0, 300)));
  window.addEventListener('unhandledrejection', (e) => P.errors.push('unhandledrejection: ' + String(e.reason && (e.reason.stack || e.reason)).slice(0, 300)));
  return true;
})()"""

SNAP = r"""(() => {
  const q = (s) => document.querySelector(s), P = window.__lrProbe || { calls: [], events: [], errors: [] };
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const st = window.raftDebug?.state || {};
  return {
    locked: document.pointerLockElement ? (document.pointerLockElement.id || document.pointerLockElement.tagName) : null,
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
    inventory: !!q('#inventory')?.open, options: !!q('#options')?.open,
    resumeHint: vis(q('#resumeHint')), crosshair: vis(q('#crosshair')),
    activation: !!navigator.userActivation?.isActive,
    running: !!st.running, active: st.active ?? null, lockFallback: !!st.lockFallback, lockSupported: st.lockSupported ?? null,
    engineInventoryOpen: !!st.inventoryOpen,
    build: window.raftLive?.build ?? null, liveError: window.raftLive?.lastError ?? null,
    nav: performance.getEntriesByType('navigation').length,
    calls: P.calls.length, lastCall: P.calls[P.calls.length - 1] || null, events: P.events.slice(-4), exits: P.exits,
    pageErrors: P.errors.slice(0, 5),
    focused: document.hasFocus(), visibility: document.visibilityState,
  };
})()"""

LOCK_OR_FALLBACK = 'document.pointerLockElement || raftDebug.state.lockFallback'


class Infra(Exception):
    """The harness could not run (exit 2)."""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


def find_electron() -> Path:
    env = os.environ.get('LR_ELECTRON')
    if env: return Path(env)
    exe = 'electron.exe' if os.name == 'nt' else 'electron'
    for base in [ROOT, *ROOT.parents]:
        p = base / 'node_modules' / 'electron' / 'dist' / exe
        if p.is_file(): return p
    raise Infra('electron binary not found; set LR_ELECTRON or npm install electron')


def http_json(url: str, timeout=1.5):
    with urllib.request.urlopen(url, timeout=timeout) as r: return json.load(r)


def start_xvfb(work: Path):
    xvfb = shutil.which('Xvfb')
    if not xvfb: raise Infra('no $DISPLAY and Xvfb not installed (apt install xvfb)')
    r, w = os.pipe()
    proc = subprocess.Popen([xvfb, '-displayfd', str(w), '-screen', '0', '1600x1000x24', '-nolisten', 'tcp', '-ac'],
                            pass_fds=(w,), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=open(work / 'xvfb.log', 'wb'))
    os.close(w)
    data = b''
    while not data.endswith(b'\n'):
        chunk = os.read(r, 16)
        if not chunk: break
        data += chunk
    os.close(r)
    if not data.strip(): proc.kill(); raise Infra('Xvfb did not report a display: ' + (work / 'xvfb.log').read_text(errors='replace')[-500:])
    return proc, ':' + data.decode().strip()


class Run:
    def __init__(self, candidate: Path, window: str, keep: bool, force_xvfb: bool, hot_swap: bool):
        self.candidate, self.window, self.keep, self.force_xvfb, self.do_hot_swap = candidate, window, keep, force_xvfb, hot_swap
        self.work = Path(tempfile.mkdtemp(prefix='lr-electron-'))
        self.dist = self.work / 'dist'; self.app = self.work / 'app'; self.user = self.work / 'userData'
        self.server = self.electron = self.xvfb = None
        self.harness_log: list[dict] = []
        self.checks: list[dict] = []
        self.notes: list[str] = []
        self.steps: list[str] = []  # human-readable input log used in repro strings
        self.metrics: dict = {}
        self._replies: dict = {}
        self._cv = threading.Condition()
        self._next = 0
        self.t0 = time.time()

    # ---------- setup ----------
    def publish(self, build: str):
        tmp = self.dist / 'version.json.tmp'
        tmp.write_text(json.dumps({'build': build, 'protocol': 1})); os.replace(tmp, self.dist / 'version.json')

    def start(self):
        shutil.copytree(self.candidate, self.dist, ignore=shutil.ignore_patterns('*.tmp'))
        self.publish('electron-check-a')
        self.port = free_port(); self.origin = f'http://127.0.0.1:{self.port}'
        env = {**os.environ, 'RAFT_DIST': str(self.dist), 'RAFT_PORT': str(self.port), 'RAFT_RELEASE_MODE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
        self.server = subprocess.Popen([sys.executable, str(ROOT / 'desktop' / 'server.py')], env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=open(self.work / 'server.log', 'wb'))
        for _ in range(100):
            try:
                if http_json(self.origin + '/health').get('app') == 'little-raft': break
            except Exception: time.sleep(.1)
        else: raise Infra('desktop/server.py did not start: ' + (self.work / 'server.log').read_text(errors='replace')[-1000:])
        # Unmodified main.cjs next to a config.json that points it at our server.
        self.app.mkdir(); self.user.mkdir()
        shutil.copy2(ROOT / 'desktop' / 'main.cjs', self.app / 'main.cjs')
        if (ROOT / 'desktop' / 'little-raft.png').is_file(): shutil.copy2(ROOT / 'desktop' / 'little-raft.png', self.app / 'little-raft.png')
        (self.app / 'config.json').write_text(json.dumps({'origin': self.origin}))
        env = {**os.environ, 'LR_MAIN': str(self.app / 'main.cjs'), 'LR_USER_DATA': str(self.user), 'LR_WINDOW': self.window,
               'ELECTRON_ENABLE_LOGGING': '0', 'ELECTRON_DISABLE_SECURITY_WARNINGS': '1'}
        env.pop('ELECTRON_RUN_AS_NODE', None)
        if os.name != 'nt' and (self.force_xvfb or not os.environ.get('DISPLAY')):
            self.xvfb, env['DISPLAY'] = start_xvfb(self.work)
            env.pop('WAYLAND_DISPLAY', None)
        self.metrics['display'] = env.get('DISPLAY') or 'native'
        self.metrics['xvfb'] = bool(self.xvfb)
        self.electron = subprocess.Popen([str(find_electron()), *ELECTRON_FLAGS, str(HARNESS)], cwd=str(self.app), env=env,
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(self.work / 'electron.err', 'wb'),
                                         text=True, bufsize=1)
        threading.Thread(target=self._pump, daemon=True).start()
        deadline = time.time() + 60
        while time.time() < deadline:
            if self.electron.poll() is not None:
                raise Infra(f'electron exited {self.electron.returncode}: ' + self.err_tail())
            if any(h.get('harness') == 'did-navigate' for h in self.harness_log): return
            time.sleep(.1)
        raise Infra('electron never loaded the game page: ' + self.err_tail())

    def err_tail(self, n=1500):
        try: return (self.work / 'electron.err').read_text(errors='replace')[-n:]
        except Exception: return ''

    def _pump(self):
        for line in self.electron.stdout:
            try: msg = json.loads(line)
            except Exception: continue
            if 'reply' in msg:
                with self._cv: self._replies[msg['reply']] = msg; self._cv.notify_all()
            else: self.harness_log.append(msg)
        with self._cv: self._cv.notify_all()

    def cmd(self, op, timeout=30, **kw):
        if self.electron.poll() is not None: raise Infra(f'electron exited {self.electron.returncode} during the run: ' + self.err_tail(600))
        with self._cv:
            self._next += 1; cid = self._next
        try:
            self.electron.stdin.write(json.dumps({'id': cid, 'op': op, **kw}) + '\n'); self.electron.stdin.flush()
        except (BrokenPipeError, OSError) as e: raise Infra(f'electron control channel closed: {e}')
        deadline = time.time() + timeout
        with self._cv:
            while cid not in self._replies:
                left = deadline - time.time()
                if left <= 0: raise Infra(f'electron did not answer {op} within {timeout}s')
                if self.electron.poll() is not None: raise Infra(f'electron exited {self.electron.returncode} during {op}')
                self._cv.wait(min(left, .5))
            r = self._replies.pop(cid)
        if not r.get('ok'): raise Infra(f'{op} failed in electron: {r.get("error", "")[:400]}')
        return r.get('value')

    def stop(self):
        for p in (self.electron, self.server, self.xvfb):
            if p and p.poll() is None:
                p.terminate()
                try: p.wait(5)
                except subprocess.TimeoutExpired: p.kill()
        if not self.keep: shutil.rmtree(self.work, ignore_errors=True)

    # ---------- helpers ----------
    def js(self, code): return self.cmd('eval', code=code)

    def snap(self): return self.js(SNAP)

    def wait_for(self, expr, timeout=15.0, poll=.15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.js(f'!!({expr})'): return True
            time.sleep(poll)
        return False

    def settle(self, ms=450): time.sleep(ms / 1000)

    def key(self, key, label=None):
        self.steps.append(label or key)
        self.cmd('key', key=key)

    def click(self, x, y, label):
        self.steps.append(label)
        self.cmd('click', x=int(x), y=int(y))

    def click_selector(self, sel, label):
        r = self.js(f"(() => {{ const r = document.querySelector({json.dumps(sel)})?.getBoundingClientRect(); return r && r.width ? {{x: r.x + r.width / 2, y: r.y + r.height / 2}} : null }})()")
        if not r: raise Infra(f'{sel} not visible to click')
        self.click(r['x'], r['y'], label)

    def click_canvas(self, label='click canvas'):
        vp = self.js('({w: innerWidth, h: innerHeight})')
        self.click(vp['w'] * .5, vp['h'] * .55, label)

    def repro(self, extra=''):
        seq = ' -> '.join(self.steps[-12:])
        return (f'Desktop app (Electron {self.metrics.get("electron", "?")} running desktop/main.cjs, {self.window} window, real OS-level input): '
                f'{seq}{"; " + extra if extra else ""}')

    def check(self, cid: str, name: str, ok: bool, detail=None, repro_extra=''):
        c = {'id': cid, 'name': name, 'ok': bool(ok)}
        if detail is not None: c['detail'] = detail
        if not ok: c['repro'] = self.repro(repro_extra)
        self.checks.append(c)
        return ok

    def window_alive(self, cid, after):
        st = self.cmd('status')
        quit_ev = [h['harness'] for h in self.harness_log if h.get('harness') in ('window-closed', 'before-quit', 'will-quit')]
        return self.check(cid, f'window stays open and app keeps running after {after}', st['windows'] == 1 and not quit_ev and not st['crashed'],
                          {'status': st, 'quit_events': quit_ev} if quit_ev or st['windows'] != 1 or st['crashed'] else None)

    @staticmethod
    def has_lock(s): return s['locked'] == 'world'

    def screenshot(self, name):
        try:
            png = base64.b64decode(self.cmd('capture', timeout=20))
            (self.work / f'{name}.png').write_bytes(png)
        except Infra as e: self.notes.append(f'screenshot {name} failed: {e}')

    # ---------- the run ----------
    def run(self):
        if not self.wait_for('!!window.raftDebug && !!window.raftLive && !!document.querySelector("#solo")', timeout=60):
            raise Infra('game never booted in the desktop shell (no raftDebug/raftLive/#solo)')
        self.js(PROBE)
        boot = self.js('({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, url: location.href})')
        ready = next((h for h in self.harness_log if h.get('harness') == 'ready'), {})
        self.metrics.update({'electron': ready.get('electron'), 'chrome': ready.get('chrome'), 'viewport': f"{boot['w']}x{boot['h']}", 'window': self.window})
        self.cmd('focus'); self.settle(400)
        s = self.snap()
        self.check('shell.origin', 'shell loads the candidate from the configured origin',
                   boot['url'].startswith(self.origin + '/') and s['build'] == 'electron-check-a', {'url': boot['url'], 'build': s['build']})
        self.check('shell.sandbox', 'page runs sandboxed with no node integration', self.js("typeof require === 'undefined' && typeof process === 'undefined'"))

        # Solo with a real mouse click (trusted gesture through sendInputEvent).
        self.click_selector('#solo', 'click #solo')
        started = self.wait_for('raftDebug.state.running', timeout=20)
        if not self.check('solo.start', 'clicking Solo starts the game', started, None if started else self.snap()):
            return
        self.wait_for(LOCK_OR_FALLBACK, timeout=4); self.settle(400)
        s = self.snap()
        solo_mode = 'pointer-lock' if self.has_lock(s) else 'lockFallback' if s['lockFallback'] else 'none'
        self.metrics['lock_mode_after_solo'] = solo_mode
        if solo_mode == 'none':
            # The first canvas click is also a documented lock gesture.
            self.notes.append(f'Solo click did not lock (last request {s["lastCall"]}); trying a canvas click')
            self.click_canvas('click canvas (first lock attempt)')
            self.wait_for(LOCK_OR_FALLBACK, timeout=4); self.settle(300)
            s = self.snap()
        perm = [h for h in self.harness_log if h.get('harness', '').startswith('permission') and h.get('perm') == 'pointerLock']
        mode = 'pointer-lock' if self.has_lock(s) else 'lockFallback' if s['lockFallback'] else 'none'
        self.metrics.update({'lock_mode': mode, 'pointerLock_permission': perm})
        self.notes.append(f'lock mode: {mode} (focused={s["focused"]}, last request {s["lastCall"]})')
        self.check('lock.acquire', 'Solo / canvas click acquires pointer lock or enters lockFallback', mode != 'none', s)
        self.check('lock.permission', 'shell grants the pointerLock permission', all(h['ok'] for h in perm), perm or 'no pointerLock permission query seen')
        if mode == 'pointer-lock':
            self.check('lock.ui', 'crosshair shown and resume hint hidden while locked', s['crosshair'] and not s['resumeHint'], s)
        self.screenshot('01-playing')
        if mode == 'none': return
        real = mode == 'pointer-lock'

        self.pause_cycle('pause', real)
        self.inventory_cycle('inv.tab', 'Tab', real)
        self.inventory_cycle('inv.i', 'I', real)
        self.inventory_cycle('inv.dwell', 'Tab', real, dwell_ms=5000)
        self.pause_cycle('pause2', real)
        if self.do_hot_swap: self.hot_swap(real)

        errs = [h for h in self.harness_log if h.get('harness') in ('render-process-gone', 'console-error')
                or (h.get('harness') == 'child-process-gone' and h.get('reason') != 'clean-exit')]
        page_errs = self.snap()['pageErrors']
        self.check('health.errors', 'no renderer crash, console error or uncaught page error', not errs and not page_errs, {'shell': errs[:5], 'page': page_errs})
        navs = [h for h in self.harness_log if h.get('harness') == 'did-navigate']
        self.check('health.navigation', 'one page load for the whole session', len(navs) <= 1 and self.snap()['nav'] == 1, navs)
        self.window_alive('window.final', 'the whole session')

    def relock(self, label):
        """Real canvas click back into locked play (Esc is not a user-activation key, so the game cannot relock by itself).
        Chromium refuses a re-lock for ~1 s after the user left lock with Esc, so one delayed retry is browser policy, not a bug."""
        s = self.snap()
        if self.has_lock(s) or s['lockFallback'] or s['dialogs']: return s
        for attempt in range(2):
            self.click_canvas(f'click canvas ({label})' if not attempt else 'wait 1.2 s, click canvas again')
            self.wait_for(LOCK_OR_FALLBACK, timeout=3); self.settle(300)
            s = self.snap()
            if self.has_lock(s) or s['lockFallback']: break
            self.metrics['relock_retries'] = self.metrics.get('relock_retries', 0) + 1
            self.notes.append(f'relock attempt {attempt + 1} failed: {s["lastCall"]}')
            self.settle(1200)
        return s

    def pause_cycle(self, cid, real):
        s = self.relock('to resume play')
        if real and not self.check(f'{cid}.relock', 'a canvas click re-acquires pointer lock', self.has_lock(s), s): return
        self.key('Escape', 'Esc (in play)'); self.settle(700)
        s = self.snap()
        self.window_alive(f'{cid}.window1', 'Esc in play')
        self.check(f'{cid}.unlock', 'Esc during play releases pointer lock', not s['locked'], s)
        opened = self.check(f'{cid}.open', 'the same Esc that releases the lock opens the pause menu', s['options'], s,
                            repro_extra=f'expected pause menu after one Esc; got dialogs={s["dialogs"]} locked={s["locked"]} resumeHint={s["resumeHint"]} '
                                        '(Electron delivers neither keydown nor keyup of the lock-releasing Esc to the page)')
        presses = 1
        if not opened and not s['dialogs']:
            # Keep going so the rest of the cycle is still tested: see how many more presses pause takes.
            self.key('Escape', 'Esc again (pause did not open)'); self.settle(700); presses += 1
            s = self.snap()
            self.window_alive(f'{cid}.window1b', 'the second Esc')
        self.metrics.setdefault('esc_presses_to_pause', {})[cid] = presses if s['options'] else None
        if not s['options']:
            self.check(f'{cid}.open-eventually', 'pause menu opens within two Esc presses', False, s); return
        self.screenshot(f'{cid}-menu')
        self.key('Escape', 'Esc (in pause menu)'); self.settle(700)
        s = self.snap()
        self.window_alive(f'{cid}.window2', 'Esc in the pause menu')
        self.check(f'{cid}.resume', 'second Esc closes the pause menu and resumes the game',
                   not s['options'] and not s['dialogs'] and s['running'] and s['active'] is not False, s)
        self.settle(800)
        self.check(f'{cid}.no-reopen', 'pause menu does not reopen on its own after resume', not self.snap()['options'])
        self.metrics.setdefault('after_pause_resume', {})[cid] = {'locked': s['locked'], 'resumeHint': s['resumeHint'], 'lockRequests': s['calls']}

    def inventory_cycle(self, cid, key, real, dwell_ms=400):
        s = self.relock('to resume play')
        if real and not self.check(f'{cid}.relock', 'a canvas click re-acquires pointer lock', self.has_lock(s), s): return
        self.key(key, f'{key} (open inventory)'); self.settle(500)
        s = self.snap()
        if not self.check(f'{cid}.open', f'{key} opens the inventory and frees the cursor', s['inventory'] and not s['locked'] and not s['options'], s): return
        self.settle(max(0, dwell_ms - 500))
        self.key('Escape', 'Esc (in inventory' + (f', after {dwell_ms // 1000}s)' if dwell_ms >= 1000 else ')')); self.settle(800)
        s = self.snap()
        self.window_alive(f'{cid}.window', f'Esc in the inventory ({key})')
        self.check(f'{cid}.close', 'Esc closes the inventory', not s['inventory'] and not s['engineInventoryOpen'], s)
        self.check(f'{cid}.no-pause', 'that Esc does not leave the pause menu open', not s['options'] and not s['dialogs'], s['dialogs'])
        self.check(f'{cid}.running', 'game is running again after closing the inventory', s['running'] and s['active'] is not False, s)

    def hot_swap(self, real):
        self.relock('to resume play')
        self.key('Tab', 'Tab (open inventory)'); self.settle(500)
        s0 = self.snap()
        state_js = "({tiles: raftDebug.state.tiles, inv: JSON.stringify(raftDebug.state.inventory)})"
        state0 = self.js(state_js)
        self.steps.append('publish a new version.json (live hot-swap)')
        self.publish('electron-check-b')
        swapped = self.wait_for("raftLive.build === 'electron-check-b'", timeout=30)
        self.settle(800)
        s = self.snap()
        if not self.check('swap.mount', 'hot-swap: new build mounts without navigation', swapped and s['nav'] == 1 and not s['liveError'],
                          {'build': s['build'], 'liveError': s['liveError'], 'nav': s['nav']}): return
        self.check('swap.state', 'hot-swap: raft and bag carried over', self.js(state_js) == state0, {'before': state0})
        self.check('swap.inventory', 'hot-swap: inventory opened before the swap is still open', s0['inventory'] and s['inventory'],
                   {'before': s0['dialogs'], 'after': s['dialogs']})
        self.key('Escape', 'Esc (in carried-over inventory)'); self.settle(800)
        s = self.snap()
        self.check('swap.inv-close', 'hot-swap: Esc closes the carried-over inventory without pausing', not s['inventory'] and not s['options'], s)
        self.pause_cycle('swap.pause', real)
        self.inventory_cycle('swap.inv', 'Tab', real)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--dist', default=os.environ.get('RAFT_DIST') or str(ROOT / 'dist'))
    ap.add_argument('--out', help='artifact dir (report.json, screenshots, electron/server logs)')
    ap.add_argument('--window', choices=['show', 'offscreen', 'hidden'], default=os.environ.get('LR_WINDOW', 'show'),
                    help='show (default): real focused window and real pointer lock; hidden cannot lock')
    ap.add_argument('--xvfb', action='store_true', help='use a private Xvfb even when $DISPLAY is set')
    ap.add_argument('--no-hot-swap', action='store_true')
    ap.add_argument('--keep', action='store_true', help='keep the temp work dir')
    a = ap.parse_args()
    candidate = Path(a.dist).resolve()
    out = Path(a.out).resolve() if a.out else None
    report = {'tool': TOOL, 'pass': False, 'failures': [], 'metrics': {}, 'artifacts': []}
    if not (candidate / 'index.html').is_file():
        report['failures'] = [{'id': 'infra', 'detail': f'not a dist dir: {candidate}', 'repro': f'ls {candidate}/index.html'}]
        print(json.dumps(report)); sys.exit(2)
    run = Run(candidate, a.window, a.keep, a.xvfb, not a.no_hot_swap)
    infra = None
    try:
        run.start()
        run.run()
    except Exception as e:
        infra = str(e) if isinstance(e, Infra) else f'{type(e).__name__}: {e}'
    run.metrics.update(seconds=round(time.time() - run.t0, 1), checks=len(run.checks), checks_failed=sum(not c['ok'] for c in run.checks), notes=run.notes)
    failures = [{'id': c['id'], 'detail': c['name'] + (': ' + json.dumps(c['detail'], default=str)[:800] if 'detail' in c else ''), 'repro': c['repro']}
                for c in run.checks if not c['ok']]
    if infra:
        failures.append({'id': 'infra', 'detail': infra[:1500],
                         'repro': f'python3.13 tests/e2e/electron_check.py --dist {candidate} --keep  (then read electron.err in the kept work dir)'})
    if out:
        out.mkdir(parents=True, exist_ok=True)
        for src in [run.work / n for n in ('electron.err', 'server.log', 'xvfb.log')] + sorted(run.work.glob('*.png')):
            if src.is_file(): shutil.copy2(src, out / src.name); report['artifacts'].append(str(out / src.name))
        (out / 'report.json').write_text(json.dumps({'candidate': str(candidate), 'checks': run.checks, 'metrics': run.metrics,
                                                     'shell': [h for h in run.harness_log if h.get('harness') not in ('focus', 'blur')][:120]},
                                                    indent=1, default=str))
        report['artifacts'].append(str(out / 'report.json'))
    run.stop()
    if a.keep: run.metrics['work'] = str(run.work)
    report.update({'pass': not failures, 'failures': failures, 'metrics': run.metrics})
    print(json.dumps(report, default=str))
    sys.exit(2 if infra else 1 if failures else 0)


if __name__ == '__main__':
    main()
