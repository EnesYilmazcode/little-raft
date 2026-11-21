"""Desktop shell check: runs the real desktop/main.cjs in Electron against a candidate dist.

Usage: python3.13 tests/e2e/electron_check.py --dist <dist_dir> [--out <artifact_dir>]
                                               [--window show|offscreen|hidden] [--xvfb] [--input send|xtest]
                                               [--no-hot-swap] [--keep]

The shell is the graded tree's own desktop/ when it sits next to --dist (a git-archive export of a branch), else this
checkout's desktop/ (override with --desktop). The candidate is copied to a temp dir and served by the unmodified desktop/server.py (RAFT_DIST,
RAFT_PORT, release mode). An unmodified copy of desktop/main.cjs runs next to a config.json that
points its origin at that server, loaded through tools/electron_harness.cjs, which isolates
userData (and the single-instance lock) and exposes a stdin control channel. All input is real:
webContents.sendInputEvent keyboard and mouse events (trusted, with user activation), never JS
dispatch. Page state is only read through executeJavaScript (no gesture).
--input xtest drives the same steps with real X keyboard/mouse events (xdotool/XTest into the private Xvfb)
instead; the Esc/pointer-lock results are identical either way, so they are not sendInputEvent artifacts.

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

import argparse, base64, json, os, shutil, signal, socket, subprocess, sys, tempfile, threading, time, urllib.request
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
  P.keys = [];
  const kl = (type, key) => { P.keys.push({ t: Math.round(performance.now()), type, key, locked: !!document.pointerLockElement }); if (P.keys.length > 60) P.keys.shift(); };
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, (e) => { if (['Escape', 'Tab', 'i', 'I'].includes(e.key)) kl(type, e.key); }, true);
  for (const type of ['cancel', 'close']) document.addEventListener(type, (e) => kl(type, e.target && e.target.id), true);
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
    keys: (P.keys || []).slice(-6),
    pageErrors: P.errors.slice(0, 5),
    focused: document.hasFocus(), visibility: document.visibilityState,
    shellClaimsEsc: typeof window.raftDesktop?.claimEscape === 'function',
    relockWait: document.body.classList.contains('relock'),
  };
})()"""

# The onboarding title menu (.ob-item buttons) hides #solo/#newGame; those stay as fallbacks for older titles.
START_BUTTON = r"""(() => { for (const s of ['.ob-item[data-act="continue"]', '.ob-item[data-act="new"]', '#solo', '#newGame']) { const el = document.querySelector(s), r = el?.getBoundingClientRect();
  if (r && r.width && !el.disabled && getComputedStyle(el).visibility !== 'hidden') return s; } return null; })()"""

LOCK_OR_FALLBACK = 'document.pointerLockElement || raftDebug.state.lockFallback'


def _die_with_parent():
    """Linux: children get SIGKILL if this driver dies (even by SIGKILL), so a killed run never leaks Xvfb/Electron/server."""
    try:
        import ctypes
        ctypes.CDLL('libc.so.6', use_errno=True).prctl(1, signal.SIGKILL)  # PR_SET_PDEATHSIG
    except Exception: pass


CHILD = {'preexec_fn': _die_with_parent} if sys.platform.startswith('linux') else {}


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


def find_desktop(candidate: Path) -> Path:
    """The graded tree's own shell: <dist>/../desktop when it has main.cjs and server.py (a git-archive export of a branch,
    as tools/fleet-gate.sh makes), else this checkout's desktop/."""
    own = candidate.parent / 'desktop'
    return own if (own / 'main.cjs').is_file() and (own / 'server.py').is_file() else ROOT / 'desktop'


def http_json(url: str, timeout=1.5):
    with urllib.request.urlopen(url, timeout=timeout) as r: return json.load(r)


def start_xvfb(work: Path):
    xvfb = shutil.which('Xvfb')
    if not xvfb: raise Infra('no $DISPLAY and Xvfb not installed (apt install xvfb)')
    r, w = os.pipe()
    proc = subprocess.Popen([xvfb, '-displayfd', str(w), '-screen', '0', '1600x1000x24', '-nolisten', 'tcp', '-ac'],
                            pass_fds=(w,), **CHILD, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=open(work / 'xvfb.log', 'wb'))
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
    def __init__(self, candidate: Path, window: str, keep: bool, force_xvfb: bool, hot_swap: bool, input_mode: str = 'send', desktop: Path | None = None):
        self.candidate, self.window, self.keep, self.do_hot_swap = candidate, window, keep, hot_swap
        self.desktop = desktop or find_desktop(candidate)
        self.desktop_label = ("the graded tree's own desktop/main.cjs" if self.desktop == candidate.parent / 'desktop'
                              else f'desktop/main.cjs from {self.desktop.parent}')
        self.input = input_mode
        self.force_xvfb = force_xvfb or input_mode == 'xtest'  # XTest input only ever goes to a private Xvfb, never your desktop
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
        self.last_esc = 0.0
        self.real = False  # True while the session plays with real pointer lock (not lockFallback)
        self.frame_waits: list[int] = []
        nonce = os.urandom(4).hex()  # per-run build ids, so a run can tell its own server from a parallel run's
        self.build_a, self.build_b = f'electron-check-a-{nonce}', f'electron-check-b-{nonce}'

    # ---------- setup ----------
    def publish(self, build: str):
        tmp = self.dist / 'version.json.tmp'
        tmp.write_text(json.dumps({'build': build, 'protocol': 1})); os.replace(tmp, self.dist / 'version.json')

    def start(self):
        shutil.copytree(self.candidate, self.dist, ignore=shutil.ignore_patterns('*.tmp'))
        self.publish(self.build_a)
        self.start_server()
        # Unmodified copy of the shell (main.cjs plus whatever it loads next to it, e.g. a preload) with a config.json
        # that points it at our server.
        shutil.copytree(self.desktop, self.app, ignore=shutil.ignore_patterns('config.json', '__pycache__', '*.ico', '*.icns'))
        self.user.mkdir()
        (self.app / 'config.json').write_text(json.dumps({'origin': self.origin}))
        env = {**os.environ, 'LR_MAIN': str(self.app / 'main.cjs'), 'LR_USER_DATA': str(self.user), 'LR_WINDOW': self.window,
               'ELECTRON_ENABLE_LOGGING': '0', 'ELECTRON_DISABLE_SECURITY_WARNINGS': '1'}
        env.pop('ELECTRON_RUN_AS_NODE', None)
        if os.name != 'nt' and (self.force_xvfb or not os.environ.get('DISPLAY')):
            self.xvfb, env['DISPLAY'] = start_xvfb(self.work)
            env.pop('WAYLAND_DISPLAY', None)
        self.display = env.get('DISPLAY')
        self.metrics['display'] = self.display or 'native'
        self.metrics['input'] = 'xtest (xdotool on the private Xvfb)' if self.input == 'xtest' else 'webContents.sendInputEvent'
        if self.input == 'xtest' and not (self.xvfb and shutil.which('xdotool')): raise Infra('--input xtest needs Xvfb and xdotool (apt install xdotool)')
        self.metrics['xvfb'] = bool(self.xvfb)
        self.metrics['desktop'] = str(self.desktop)
        self.electron = subprocess.Popen([str(find_electron()), *ELECTRON_FLAGS, str(HARNESS)], cwd=str(self.app), env=env, **CHILD,
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

    def start_server(self):
        # free_port() releases the port before server.py binds it, so a parallel run can grab the same one: then our
        # server.py dies on bind and /health would answer from the OTHER run's server. Require our process to be alive
        # and serving our own per-run build id, else retry on a fresh port.
        for attempt in range(5):
            self.port = free_port(); self.origin = f'http://127.0.0.1:{self.port}'
            env = {**os.environ, 'RAFT_DIST': str(self.dist), 'RAFT_PORT': str(self.port), 'RAFT_RELEASE_MODE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
            self.server = subprocess.Popen([sys.executable, str(self.desktop / 'server.py')], env=env, **CHILD, stdin=subprocess.DEVNULL,
                                           stdout=subprocess.DEVNULL, stderr=open(self.work / 'server.log', 'ab'))
            for _ in range(150):
                if self.server.poll() is not None: break
                try:
                    if http_json(self.origin + '/health').get('app') == 'little-raft' and http_json(self.origin + '/version.json').get('build') == self.build_a:
                        if self.server.poll() is None: return
                        break
                except Exception: pass
                time.sleep(.1)
            if self.server.poll() is None: self.server.kill(); self.server.wait(5)
            self.notes.append(f'server start attempt {attempt + 1} on port {self.port} failed; retrying')
        raise Infra('desktop/server.py did not start: ' + (self.work / 'server.log').read_text(errors='replace')[-1000:])

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

    FLUSH = ('new Promise((res) => { const t = performance.now(); const done = () => res(Math.round(performance.now() - t));'
             ' requestAnimationFrame(() => requestAnimationFrame(done)); setTimeout(done, 6000); })')

    def flush(self):
        """Wait until the page has rendered two frames. Under swiftshader this window renders ~1-2 fps, and Chromium delivers
        dialog close / pointerlockchange events with the rendering update, so without this a step can land before the page has
        seen the previous step's events (e.g. a stale inventory `close` event arriving after the inventory was reopened).
        On real hardware a frame is ~16 ms, so a human never outruns it; the harness must not either."""
        ms = self.cmd('eval', code=self.FLUSH, timeout=15)
        self.frame_waits.append(ms)

    XKEYS = {'Escape': 'Escape', 'Tab': 'Tab', 'I': 'i'}

    def xdo(self, *args):
        r = subprocess.run(['xdotool', *map(str, args)], env={**os.environ, 'DISPLAY': self.display}, capture_output=True, text=True, timeout=10)
        if r.returncode: raise Infra(f'xdotool {" ".join(map(str, args))} failed: {r.stderr[-300:]}')

    def key(self, key, label=None, hold=100, flush=True):
        self.steps.append(label or key)
        if flush: self.flush()
        if self.input == 'xtest':
            self.xdo('keydown', self.XKEYS[key]); time.sleep(hold / 1000); self.xdo('keyup', self.XKEYS[key])
        else: self.cmd('key', key=key, hold=hold)

    def key_until(self, key, label, until, min_ms=100, max_ms=None, flush=True):
        """Press key, keep it down until JS `until` is true (at least min_ms, at most max_ms), release. Returns
        (held_ms, until_was_true_at_release). Used where the outcome depends on the release landing after a page reaction
        (a fast machine reacts within a few ms of keydown; swiftshader here can take longer than a 100 ms tap)."""
        # sendInputEvent has no autorepeat, so a long hold is safe; X autorepeats after ~600 ms.
        if max_ms is None: max_ms = 600 if self.input == 'xtest' else 4000
        if flush: self.flush()
        t0 = time.time()
        if self.input == 'xtest': self.xdo('keydown', self.XKEYS[key])
        else: self.cmd('down', key=key)
        hit = False
        while True:
            el = time.time() - t0
            if el >= max_ms / 1000: break
            if not hit: hit = bool(self.js(f'!!({until})'))
            if hit and el >= min_ms / 1000: break
            time.sleep(.02)
        held = round((time.time() - t0) * 1000)
        if self.input == 'xtest': self.xdo('keyup', self.XKEYS[key])
        else: self.cmd('up', key=key)
        if key == 'Escape': self.last_esc = time.time()
        self.steps.append(label.format(ms=held))
        return held, hit

    def click(self, x, y, label, flush=True):
        self.steps.append(label)
        if flush: self.flush()
        if self.input == 'xtest':
            b = self.cmd('status')['bounds']  # content bounds are root-window coordinates (no WM under Xvfb)
            self.xdo('mousemove', b['x'] + int(x), b['y'] + int(y)); time.sleep(.03)
            self.xdo('mousedown', 1); time.sleep(.06); self.xdo('mouseup', 1)
        else: self.cmd('click', x=int(x), y=int(y))

    def click_selector(self, sel, label):
        r = self.js(f"(() => {{ const r = document.querySelector({json.dumps(sel)})?.getBoundingClientRect(); return r && r.width ? {{x: r.x + r.width / 2, y: r.y + r.height / 2}} : null }})()")
        if not r: raise Infra(f'{sel} not visible to click')
        self.click(r['x'], r['y'], label)

    def click_canvas(self, label='click canvas'):
        vp = self.js('({w: innerWidth, h: innerHeight})')
        self.click(vp['w'] * .5, vp['h'] * .55, label)

    def repro(self, extra=''):
        seq = ' -> '.join(self.steps[-12:])
        how = 'real X keyboard/mouse via XTest' if self.input == 'xtest' else 'trusted input via webContents.sendInputEvent; real X/XTest input behaves the same'
        return (f'Desktop app (Electron {self.metrics.get("electron", "?")} running {self.desktop_label}, {self.window} window, {how}): '
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
        if not self.wait_for('!!window.raftDebug && !!window.raftLive && !!document.querySelector("#solo, #newGame")', timeout=60):
            raise Infra('game never booted in the desktop shell (no raftDebug/raftLive/#solo/#newGame)')
        self.js(PROBE)
        boot = self.js('({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, url: location.href})')
        ready = next((h for h in self.harness_log if h.get('harness') == 'ready'), {})
        self.metrics.update({'electron': ready.get('electron'), 'chrome': ready.get('chrome'), 'viewport': f"{boot['w']}x{boot['h']}", 'window': self.window})
        self.cmd('focus'); self.settle(400)
        s = self.snap()
        self.check('shell.origin', 'shell loads the candidate from the configured origin',
                   boot['url'].startswith(self.origin + '/') and s['build'] == self.build_a, {'url': boot['url'], 'build': s['build']})
        self.check('shell.sandbox', 'page runs sandboxed with no node integration', self.js("typeof require === 'undefined' && typeof process === 'undefined'"))

        # Solo with a real mouse click (trusted gesture through sendInputEvent). Branches with a Continue/New game title
        # (wip/fleet/menus) hide #solo until a save exists and start a fresh raft from #newGame.
        self.wait_for(START_BUTTON, timeout=10)
        start_btn = self.js(START_BUTTON)
        if not start_btn: raise Infra('no visible start button (.ob-item[data-act=continue|new], #solo or #newGame) on the title screen')
        self.metrics['start_button'] = start_btn
        self.click_selector(start_btn, f'click {start_btn} ({self.js(f"document.querySelector({json.dumps(start_btn)}).textContent.trim()")!r})')
        started = self.wait_for('raftDebug.state.running', timeout=20)
        if not self.check('solo.start', 'clicking Solo starts the game', started, None if started else self.snap()):
            return
        self.wait_for(LOCK_OR_FALLBACK, timeout=8); self.settle(400)
        s = self.snap()
        solo_mode = 'pointer-lock' if self.has_lock(s) else 'lockFallback' if s['lockFallback'] else 'none'
        self.metrics['lock_mode_after_solo'] = solo_mode
        if solo_mode == 'none':
            # The first canvas click is also a documented lock gesture.
            self.notes.append(f'Solo click did not lock (last request {s["lastCall"]}); trying a canvas click')
            self.click_canvas('click canvas (first lock attempt)')
            self.wait_for(LOCK_OR_FALLBACK, timeout=8); self.settle(300)
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
        self.real = mode == 'pointer-lock'

        self.pause_cycle('pause')
        self.inventory_cycle('inv.tab', 'Tab')
        self.inventory_cycle('inv.i', 'I')
        self.inventory_cycle('inv.dwell', 'Tab', dwell_ms=5000)
        self.pause_cycle('pause2')
        if self.do_hot_swap: self.hot_swap()
        if self.real: self.quick_reclick()

        gone = [h for h in self.harness_log if h.get('harness') == 'child-process-gone' and h.get('reason') != 'clean-exit']
        # The swiftshader GPU process can die under CPU starvation on this box (Chromium restarts it and the page keeps
        # running); report it, but only renderer crashes and other child processes count as failures.
        gpu = [h for h in gone if h.get('type') == 'GPU']
        if gpu: self.metrics['gpu_process_gone'] = gpu[:3]; self.notes.append(f'GPU process exited abnormally {len(gpu)}x (not counted as a game failure)')
        errs = [h for h in self.harness_log if h.get('harness') in ('render-process-gone', 'console-error')] + [h for h in gone if h.get('type') != 'GPU']
        page_errs = self.snap()['pageErrors']
        self.check('health.errors', 'no renderer crash, console error or uncaught page error', not errs and not page_errs, {'shell': errs[:5], 'page': page_errs})
        navs = [h for h in self.harness_log if h.get('harness') == 'did-navigate']
        self.check('health.navigation', 'one page load for the whole session', len(navs) <= 1 and self.snap()['nav'] == 1, navs)
        self.window_alive('window.final', 'the whole session')

    def relock(self, label):
        """Real canvas click back into locked play (Esc is not a user-activation key, so the game cannot relock by itself).
        Chromium refuses a re-lock for ~1 s after the user leaves lock with Esc, so wait 1.5 s since the last Esc first;
        quick_reclick() tests the faster case on its own."""
        s = self.snap()
        if not (self.has_lock(s) or s['lockFallback'] or s['dialogs']):
            gap = 1.5 - (time.time() - self.last_esc)
            if gap > 0: self.steps.append(f'wait {gap + .05:.1f} s'); time.sleep(gap)
            self.click_canvas(f'click canvas ({label})')
            self.wait_for(LOCK_OR_FALLBACK, timeout=8); self.settle(300)
            s = self.snap()
        if self.real and s['lockFallback']:
            self.check('lock.fallback-latch', 'game stays in pointer-lock mode (does not latch drag-look lockFallback) after a refused re-lock', False, s,
                       repro_extra=f'last lock request {s["lastCall"]}; raftDebug.state.lockFallback became true, so mouse look is drag-only for the rest of the session')
            self.real = False
            self.notes.append('lockFallback latched mid-session; continuing in fallback mode')
        if self.real:
            self.check(f'relock.{len(self.checks)}', 'a canvas click re-acquires pointer lock', self.has_lock(s), s)
        return s

    def pause_cycle(self, cid):
        s = self.relock('to resume play')
        if self.real and not self.has_lock(s): return
        mark = len(self.harness_log)
        self.key('Escape', 'Esc (in play)'); self.settle(700)
        s = self.snap()
        shell_saw = [h['type'] for h in self.harness_log[mark:] if h.get('harness') == 'before-input']
        self.window_alive(f'{cid}.window1', 'Esc in play')
        self.check(f'{cid}.unlock', 'Esc during play releases pointer lock', not s['locked'], s)
        opened = self.check(f'{cid}.open', 'the same Esc that releases the lock opens the pause menu', s['options'], s,
                            repro_extra=f'expected pause menu after one Esc; got dialogs={s["dialogs"]} locked={s["locked"]} resumeHint={s["resumeHint"]} ' +
                                        (f'(desktop/main.cjs claims Escape and opens pause via window.raftEscape() on keyDown, but its before-input-event saw only '
                                         f'{shell_saw or "nothing"} for this press: Chromium consumes the keyDown that ends pointer lock, so raftEscape() never runs)'
                                         if s['shellClaimsEsc'] and 'keyDown' not in shell_saw else
                                         f'(desktop/main.cjs claims Escape; its before-input-event saw {shell_saw} for this press, yet no pause menu)' if s['shellClaimsEsc'] else
                                         '(Electron delivers neither keydown nor keyup of the lock-releasing Esc to the page, so the settings.js keyup fallback never fires)'))
        # Exactly one Esc: a second press would hide LOCK-R3-1 (the shell dropping the lock-ending keyDown).
        self.metrics.setdefault('esc_presses_to_pause', {})[cid] = 1 if s['options'] else None
        if not opened: return
        self.screenshot(f'{cid}-menu')
        exits0 = self.js('__lrProbe.exits')
        self.key('Escape', 'Esc (in pause menu)'); self.settle(700)
        if self.real: self.wait_for('document.pointerLockElement', timeout=4)  # a loaded box can take seconds to grant the relock
        s = self.snap()
        self.window_alive(f'{cid}.window2', 'Esc in the pause menu')
        self.check(f'{cid}.resume', 'second Esc closes the pause menu and resumes the game',
                   not s['options'] and not s['dialogs'] and s['running'] and s['active'] is not False, s)
        if self.real and s['shellClaimsEsc']:
            # A shell that claims Escape hands the page a gesture for this press, so resuming can (and is meant to) relock.
            ev = [e for e in s['events'] if e['type'] == 'change']
            bounced = len(ev) >= 2 and ev[-2]['locked'] == 'world' and ev[-1]['locked'] is None
            self.check(f'{cid}.relocked', 'Esc in the pause menu resumes into locked play when the shell claims Escape', self.has_lock(s),
                       {'locked': s['locked'], 'resumeHint': s['resumeHint'], 'events': s['events'], 'exits': s['exits']},
                       repro_extra='desktop/main.cjs claims Escape and calls window.raftEscape() with a user gesture; pause closes and the game re-requests lock; '
                                   + (f'lock engages, then is dropped {ev[-1]["t"] - ev[-2]["t"]} ms later '
                                      + ('(the page called exitPointerLock())' if s['exits'] != exits0 else 'with no exitPointerLock() call from the page')
                                      + '; player is left unlocked'
                                      + (' with no cursor or resume hint (body.relock) until the next click' if s['relockWait'] else '')
                                      if bounced else 'lock was not re-acquired'))
        self.settle(800)
        self.check(f'{cid}.no-reopen', 'pause menu does not reopen on its own after resume', not self.snap()['options'])
        self.metrics.setdefault('after_pause_resume', {})[cid] = {'locked': s['locked'], 'resumeHint': s['resumeHint'], 'lockRequests': s['calls']}

    # Page-time gap between the key that opened the inventory and the Esc that closed it. Chromium's transient user
    # activation lasts 5 s and Esc does not grant one, so this decides whether the game CAN relock on that Esc.
    # A shell that claims Escape (main.cjs before-input-event, wip/fleet/menus) never lets the page see the Esc key; it
    # calls window.raftEscape() with a user gesture instead. Then the inventory's close event stands in for the Esc time
    # (an upper bound) and the activation window no longer limits the relock.
    ACT_GAP = r"""(() => { const k = (window.__lrProbe && __lrProbe.keys) || []; let esc = null, closed = null, open = null;
      for (let i = k.length - 1; i >= 0; i--) { const e = k[i];
        if ((e.type === 'cancel' || e.type === 'close') && e.key === 'inventory' && open === null) { closed = e.t; continue; }
        if (e.type !== 'keydown') continue;
        if (e.key === 'Escape') { if (open === null) esc = e.t; } else if (['Tab', 'i', 'I'].includes(e.key)) { open = e.t; break; } }
      const claimed = esc === null && typeof window.raftDesktop?.claimEscape === 'function';
      const at = esc !== null ? esc : claimed ? closed : null;
      return { gap: at !== null && open !== null ? at - open : null, claimed }; })()"""
    ACTIVATION_MS = 5000

    def inventory_cycle(self, cid, key, dwell_ms=400, hold=100):
        """Open the inventory with `key`, close it with Esc. A quick close (Esc well inside the 5 s activation window of the
        opening key) must put the player back in locked play; a slow close (activation expired) cannot relock and must leave
        the game waiting for a click with the resume hint. Under load a quick close can drift past 5 s; it is then retried."""
        quick = dwell_ms < 1000
        for attempt in range(3 if quick else 1):
            s = self.relock('to resume play')
            if self.real and not self.has_lock(s): return
            real = self.real
            self.key(key, f'{key} (open inventory)')
            opened = self.wait_for("document.querySelector('#inventory')?.open && !document.pointerLockElement && !document.querySelector('#options')?.open",
                                   timeout=8, poll=.05)
            if not self.check(f'{cid}.open', f'{key} opens the inventory and frees the cursor', opened, None if opened else self.snap()): return
            where = 'in inventory' + (f', after {dwell_ms // 1000}s' if not quick else '')
            exits0 = self.js('__lrProbe.exits')
            if quick:
                self.settle(max(0, dwell_ms - 300))
                # No frame wait: stay inside the activation window. Hold Esc until the game's relock lands (on real hardware
                # it lands within a normal key press), then release.
                held, relocked_while_down = self.key_until('Escape', f'Esc down ({where}), held {{ms}} ms until the game re-locked, Esc up',
                                                           'document.pointerLockElement', flush=False) if real else (None, None)
                if not real: self.key('Escape', f'Esc held {hold} ms ({where})', hold=hold, flush=False)
            else:
                self.settle(dwell_ms)
                self.key('Escape', f'Esc held {hold} ms ({where})', hold=hold, flush=False); held = hold; relocked_while_down = None
            self.settle(800)
            self.flush()  # the hint/crosshair follow lock and dialog state on the next frame (~1 fps under swiftshader)
            s = self.snap()
            g = self.js(self.ACT_GAP); gap, claimed = g['gap'], g['claimed']
            self.metrics.setdefault('inventory_esc', {})[cid] = {'open_to_esc_ms': gap, 'held_ms': held, 'locked_before_release': relocked_while_down,
                                                                 'attempts': attempt + 1, 'shell_claims_esc': claimed}
            if not (real and quick) or claimed or (gap is not None and gap < self.ACTIVATION_MS - 500): break
            self.notes.append(f'{cid}: Esc came {gap} ms after {key} (load), outside the activation window; retrying')
            if s['inventory']: self.key('Escape', 'Esc (close inventory)')
        self.window_alive(f'{cid}.window', f'Esc in the inventory ({key})')
        self.check(f'{cid}.close', 'Esc closes the inventory', not s['inventory'] and not s['engineInventoryOpen'], s)
        self.check(f'{cid}.no-pause', 'that Esc does not leave the pause menu open', not s['options'] and not s['dialogs'], s['dialogs'])
        self.check(f'{cid}.running', 'game is running again after closing the inventory', s['running'] and s['active'] is not False, s)
        if not real: return
        detail = {'locked': s['locked'], 'resumeHint': s['resumeHint'], 'lockFallback': s['lockFallback'], 'open_to_esc_ms': gap,
                  'lastCall': s['lastCall'], 'events': s['events'], 'keys': s['keys']}
        ev = [e for e in s['events'] if e['type'] == 'change']
        bounced = len(ev) >= 2 and ev[-2]['locked'] == 'world' and ev[-1]['locked'] is None
        if claimed:
            # The shell hands the page a gesture-backed Esc, so the game can relock whatever the dwell.
            via = (f'desktop/main.cjs claims Escape and calls window.raftEscape() with a user gesture; the inventory closes '
                   f'{gap} ms after {key} and the game re-requests lock')
            page_exit = s['exits'] != exits0
            left = ('body.relock: no cursor and no resume hint until the next click' if s['relockWait'] else
                    'with the click-to-resume hint' if s['resumeHint'] else 'no resume hint shown')
            why = (f'{via}; lock engages, then is dropped {ev[-1]["t"] - ev[-2]["t"]} ms later '
                   + ('(the page called exitPointerLock())' if page_exit else
                      'with no exitPointerLock() call from the page: the browser ends it for the Escape press even though main.cjs '
                      'preventDefaults Escape in before-input-event')
                   + f'; player is left unlocked ({left})') if bounced else f'{via}; lock was not re-acquired ({left})'
            if quick:
                self.check(f'{cid}.relocked', 'closing the inventory with Esc puts the player back in locked play (lock holds after Esc is released)',
                           self.has_lock(s), {**detail, 'locked_before_release': relocked_while_down, 'shell_claims_esc': True}, repro_extra=why)
            else:
                # Relocking or waiting for a click (hint or settings.js body.relock) are both fine; latching drag-look is not.
                self.check(f'{cid}.no-fallback', 'closing the inventory after a long dwell does not latch drag-look lockFallback',
                           self.has_lock(s) or not s['lockFallback'], {**detail, 'shell_claims_esc': True, 'relockWait': s['relockWait']}, repro_extra=why)
        elif gap is not None and gap < self.ACTIVATION_MS - 500:
            detail['locked_before_release'] = relocked_while_down
            self.check(f'{cid}.relocked', 'closing the inventory with Esc puts the player back in locked play (lock holds after Esc is released)',
                       self.has_lock(s), detail,
                       repro_extra=(f'Esc pressed {gap} ms after {key}; the game re-requests lock on Esc keydown (inventory close -> resume), lock engages '
                                    f'before the key is released, then Electron treats the Esc keyup as "leave pointer lock" and drops it '
                                    f'({ev[-1]["t"] - ev[-2]["t"]} ms after it engaged); player is left unlocked with the resume hint') if bounced and relocked_while_down else
                                   f'Esc pressed {gap} ms after {key}; the game did not re-acquire lock while Esc was held')
        elif gap is not None and gap > self.ACTIVATION_MS:
            self.check(f'{cid}.resume-hint', 'closing the inventory after the activation window shows the click-to-resume hint (no lock possible, no drag-look latch)',
                       not s['locked'] and s['resumeHint'] and not s['lockFallback'], detail)
        else:
            self.notes.append(f'{cid}: Esc came {gap} ms after {key}, at the activation boundary; lock outcome not asserted')

    def hot_swap(self):
        self.relock('to resume play')
        self.key('Tab', 'Tab (open inventory)'); self.settle(500)
        s0 = self.snap()
        state_js = "({tiles: raftDebug.state.tiles, inv: JSON.stringify(raftDebug.state.inventory)})"
        state0 = self.js(state_js)
        self.steps.append('publish a new version.json (live hot-swap)')
        self.publish(self.build_b)
        swapped = self.wait_for(f"raftLive.build === {json.dumps(self.build_b)}", timeout=30)
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
        self.pause_cycle('swap.pause')
        self.inventory_cycle('swap.inv', 'Tab')

    def quick_reclick(self):
        """A player who presses Esc and clicks straight back in (within Chromium's ~1 s re-lock cooldown) must not lose pointer
        lock for good. No frame waits here: the cooldown is wall-clock. The gap that matters (lock lost -> lock requested) is
        measured from page timestamps; if load stretched it past the cooldown the attempt did not exercise it and is retried."""
        COOLDOWN_MS = 900
        for attempt in range(3):
            s = self.relock('to resume play')
            if not self.has_lock(s): return
            vp = self.js('({w: innerWidth, h: innerHeight, ev: __lrProbe.events.length, calls: __lrProbe.calls.length})')
            self.key('Escape', 'Esc (in play)'); time.sleep(.25)
            if self.js("!!document.querySelector('#options')?.open"):  # pause opened on the first Esc: close it, as a player would
                self.key('Escape', 'Esc (close pause)', flush=False); time.sleep(.15)
            self.click(vp['w'] * .5, vp['h'] * .55, 'click canvas straight away (page-measured gap in the note below)', flush=False)
            self.wait_for(LOCK_OR_FALLBACK + ' || __lrProbe.calls.slice(' + str(vp['calls']) + ").some((c) => c.result !== 'pending')", timeout=8)
            self.settle(300)
            s = self.snap()
            P = self.js(f"({{ev: __lrProbe.events.slice({vp['ev']}), calls: __lrProbe.calls.slice({vp['calls']})}})")
            lost = next((e['t'] for e in P['ev'] if e['type'] == 'change' and e['locked'] is None), None)
            call = P['calls'][0] if P['calls'] else None
            gap = call['t'] - lost if call and lost is not None else None
            self.metrics.setdefault('quick_reclick', []).append({'gap_ms': gap, 'result': call and call['result'], 'locked': s['locked'], 'lockFallback': s['lockFallback']})
            if s['lockFallback'] or (gap is not None and gap < COOLDOWN_MS): break
            self.notes.append(f'quick re-click attempt {attempt + 1}: lock request came {gap} ms after the lock was lost (load), cooldown not exercised; retrying')
        else:
            self.notes.append('quick re-click: could not land a click inside the re-lock cooldown in 3 attempts; check not run'); return
        self.check('lock.quick-reclick', 'a quick click back in after Esc does not latch lockFallback (drag-look) for the session', not s['lockFallback'], s,
                   repro_extra=f'lock requested {gap} ms after Esc released it; request result: {call and call["result"]}; '
                               'game.js lockUnsupported() treats that SecurityError (Chromium re-lock cooldown) as "pointer lock unsupported" and latches lockFallback')
        if not s['lockFallback']:
            self.settle(1500); self.click_canvas('wait 1.5 s, click canvas'); self.wait_for(LOCK_OR_FALLBACK, timeout=8); self.settle(300)
            s = self.snap()
            self.check('lock.quick-reclick-recover', 'after a refused quick re-click, the next click locks', self.has_lock(s), s)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--dist', default=os.environ.get('RAFT_DIST') or str(ROOT / 'dist'))
    ap.add_argument('--out', help='artifact dir (report.json, screenshots, electron/server logs)')
    ap.add_argument('--window', choices=['show', 'offscreen', 'hidden'], default=os.environ.get('LR_WINDOW', 'show'),
                    help='show (default): real focused window and real pointer lock; hidden cannot lock')
    ap.add_argument('--xvfb', action='store_true', help='use a private Xvfb even when $DISPLAY is set')
    ap.add_argument('--input', choices=['send', 'xtest'], default='send',
                    help='send (default): webContents.sendInputEvent; xtest: real X events via xdotool into a private Xvfb (cross-check)')
    ap.add_argument('--desktop', help="shell dir with main.cjs + server.py (default: <dist>/../desktop if present, else this checkout's desktop/)")
    ap.add_argument('--no-hot-swap', action='store_true')
    ap.add_argument('--keep', action='store_true', help='keep the temp work dir')
    a = ap.parse_args()
    candidate = Path(a.dist).resolve()
    out = Path(a.out).resolve() if a.out else None
    report = {'tool': TOOL, 'pass': False, 'failures': [], 'metrics': {}, 'artifacts': []}
    if not (candidate / 'index.html').is_file():
        report['failures'] = [{'id': 'infra', 'detail': f'not a dist dir: {candidate}', 'repro': f'ls {candidate}/index.html'}]
        print(json.dumps(report)); sys.exit(2)
    run = Run(candidate, a.window, a.keep, a.xvfb, not a.no_hot_swap, a.input, Path(a.desktop).resolve() if a.desktop else None)
    def on_term(signum, _frame): raise KeyboardInterrupt(f'signal {signum}')
    signal.signal(signal.SIGTERM, on_term)
    infra = None
    try:
        run.start()
        run.run()
    except KeyboardInterrupt as e:  # killed by the caller (e.g. a gate timeout): still tear everything down
        run.stop(); print(json.dumps({**report, 'failures': [{'id': 'infra', 'detail': f'interrupted ({e})', 'repro': 'n/a'}]})); sys.exit(2)
    except Exception as e:
        infra = str(e) if isinstance(e, Infra) else f'{type(e).__name__}: {e}'
    if run.frame_waits:
        fw = sorted(run.frame_waits)
        run.metrics['two_frame_wait_ms'] = {'n': len(fw), 'median': fw[len(fw) // 2], 'max': fw[-1]}
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
    # Game failures already found outrank a later infra error, so the gate still sees them.
    sys.exit(1 if any(f['id'] != 'infra' for f in failures) else 2 if infra else 0)


if __name__ == '__main__':
    main()
