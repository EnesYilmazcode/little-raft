"""Scripted play session ("play-bot") for Little Raft, Solo mode, with invariants checked every ~0.5 s.

Usage:
  python3.13 tests/e2e/playbot.py --dist <dist_dir> [--out <dir>] [--duration 300] [--seed 1]
                                  [--kit starter|fresh] [--stall-ms 8000] [--headed]

The bot walks, looks around, jumps, swaps hotbar slots 1-5, throws the hook at floating debris
(aimed from raftDebug.targets), reels it in, presses E near debris, opens/closes the inventory
(Tab, and Esc-from-inventory), opens/closes the pause menu (Esc), builds floor tiles with the hammer
(aimed from raftDebug.placements) and fishes with the rod.

Determinism: the action script is drawn from random.Random(--seed) and the page's Math.random is
replaced with a seeded PRNG before any game script runs, so `--seed N` replays the same session
(wall-clock timing on software GL still varies a little).

--kit starter (default) pre-loads a save through the game's own localStorage format holding a hook,
hammer, fishing rod, 20 wood, 20 plastic and 10 leaves so that building and fishing get exercised in
a short run. --kit fresh starts a brand-new raft (hook only); build/fish actions then just notice the
missing tool.

Mouse-look is sent as `mousemove` events with movementX/Y on document (the game's pointer-lock look
handler), because Playwright's absolute mouse cannot express unbounded relative motion. Clicks,
keys and wheel are real Playwright input.

Last stdout line is one JSON object (see tests/e2e contract). Exit 0 pass, 1 game invariant failed,
2 harness/infra error.
"""
import argparse, json, math, random, sys, time, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / 'tools'))

TOOL = 'playbot'
LOOK_K = .0022            # game.js LOOK_SENSITIVITY (options.sensitivity defaults to 1)
PITCH_LIMIT = 1.35        # game.js PITCH_LIMIT
FOV_RANGE = (60, 95)      # settings.js fov min/max while running
# Game seconds a hook may legitimately sit in a stage (hook-physics MAX_FLIGHT_TIME = 8; 'done' is ended next frame).
HOOK_STUCK_SIM_S = {'flying': 12, 'done': 2}
HOOK_STAGES = {'idle', 'flying', 'floating', 'reeling', 'done', 'fishing'}
# Stage transitions the bot may observe between two samples (skips allowed when the sim is fast).
HOOK_NEXT = {
    'idle': {'idle', 'flying', 'floating', 'fishing', 'done'},
    'flying': {'flying', 'floating', 'reeling', 'done', 'idle'},
    'floating': {'floating', 'reeling', 'done', 'idle'},
    'reeling': {'reeling', 'floating', 'done', 'idle'},
    'done': {'done', 'idle'},
    'fishing': {'fishing', 'idle'},
}

PAGE_INIT = r"""
(() => {
  // Seeded Math.random so item spawns / fish bites replay with --seed.
  let s = (%(seed)d >>> 0) || 1;
  Math.random = function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  // Independent rAF probe: worst gap between animation frames since the last read.
  // sim/totalFrames are cumulative: game.js clamps each frame's dt to 50 ms, so on slow software GL game time runs far
  // slower than wall time and "stuck"/"frozen" checks must be measured in frames / sim seconds, not wall seconds.
  const pb = window.__playbot = {maxGap: 0, frames: 0, last: 0, sim: 0, totalFrames: 0};
  const f = t => { if (pb.last) { pb.maxGap = Math.max(pb.maxGap, t - pb.last); pb.sim += Math.min(t - pb.last, 50) / 1000; }
    pb.last = t; pb.frames++; pb.totalFrames++; requestAnimationFrame(f);
    if (t - pb.lastSample >= %(interval)d - 20) take(); };
  requestAnimationFrame(f);
  pb.read = () => { const r = {maxGap: pb.maxGap, frames: pb.frames, sim: pb.sim, totalFrames: pb.totalFrames}; pb.maxGap = 0; pb.frames = 0; return r; };
  pb.reset = () => { pb.maxGap = 0; pb.last = 0; };
  // In-page sampler: snapshots raftDebug.state every %(interval)d ms into a buffer that Python drains,
  // so the invariant cadence does not depend on (slow) Playwright round-trips.
  // Sampled from rAF (and a timer fallback) because timers starve behind slow software-GL frames.
  pb.buf = []; pb.on = false; pb.lastSample = 0;
  function take() {
    if (!pb.on || !window.raftDebug) return;
    pb.lastSample = performance.now();
    try { pb.buf.push(pb.sample()); } catch (e) { pb.buf.push({err: String(e && e.stack || e), now: performance.now()}); }
    if (pb.buf.length > 4000) pb.buf.shift();
  }
  setInterval(() => { if (performance.now() - pb.lastSample >= %(interval)d) take(); }, %(interval)d);
  pb.drain = () => { const b = pb.buf; pb.buf = []; return {now: performance.now(), samples: b}; };
  pb.sample = () => {
  const s = raftDebug.state, od = document.querySelector('#options');
  const otherDialogs = [...document.querySelectorAll('dialog')].filter(d => d.open && d.id !== 'options' && d.id !== 'inventory').map(d => d.id || '?');
  return {running: s.running, active: s.active, disposed: s.disposed, tool: s.tool, heldKind: s.heldKind,
    selectedIndex: s.selectedIndex, pointerLocked: s.pointerLocked, lockFallback: s.lockFallback,
    tiles: s.tiles, tileList: s.tileList || [], decor: (s.decor || []).length, stock: s.stock, inventory: s.inventory, fish: s.fish,
    collected: s.collected, items: s.items, me: s.me, camera: s.camera, raft: s.raft, physics: s.physics,
    grounded: s.grounded, swimming: s.swimming, hookStage: s.hookStage, hook: s.hook, fishWait: s.fishWait,
    hookHealth: s.hookHealth, charge: s.charge, charging: s.charging, reeling: s.reeling,
    inventoryOpen: s.inventoryOpen, pauseOpen: !!(od && od.open), otherDialogs,
    build: {active: s.build?.active, candidates: s.build?.candidates, affordable: s.build?.affordable, hover: s.build?.hover},
    probe: pb.read(), now: performance.now()};
  };
  // Aim the camera at a world point / set an absolute view in ONE round-trip (each Playwright call costs ~1 s here).
  // Mirrors game.js look(): yaw -= dx*k, pitch -= dy*k, with the game clamping each event to +-200 px.
  const look = (dx, dy) => { const n = Math.max(1, Math.floor(Math.max(Math.abs(dx), Math.abs(dy)) / 150) + 1);
    for (let i = 0; i < n; i++) document.dispatchEvent(new MouseEvent('mousemove', {movementX: dx / n, movementY: dy / n, bubbles: true})); };
  const wrap = a => { a = (a + Math.PI) %% (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  pb.view = (yaw, pitch) => { const me = raftDebug.state.me;
    look(wrap(me.yaw - yaw) / %(look_k)s, (me.pitch - pitch) / %(look_k)s); return raftDebug.state; };
  pb.aim = (x, y, z) => { const s = raftDebug.state, c = s.camera, dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const lim = %(pitch_limit)s - .02, pitch = Math.max(-lim, Math.min(lim, Math.atan2(dy, Math.hypot(dx, dz))));
    return pb.view(Math.atan2(-dx, -dz), pitch); };
  %(save)s
})();
"""



def starter_save():
    slots = [None] * 28
    slots[0] = {'kind': 'hook', 'count': 1, 'durability': 100}
    slots[1] = {'kind': 'hammer', 'count': 1, 'durability': 100}
    slots[2] = {'kind': 'fishingrod', 'count': 1, 'durability': 100}
    slots[3] = {'kind': 'wood', 'count': 20}
    slots[4] = {'kind': 'plastic', 'count': 20}
    slots[8] = {'kind': 'leaf', 'count': 10}
    return {'tiles': [[i % 3 - 1, i // 3 - 1] for i in range(9)], 'decor': [], 'stock': {}, 'fish': 0, 'collected': 0,
            'hookHealth': 100, 'items': [], 'hostInventory': {'slots': slots, 'selected': 0},
            'guestInventory': {'slots': [None] * 28, 'selected': 0}}


def finite(*v):
    return all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in v)


class InfraError(Exception):
    pass


class PageCrashed(Exception):
    """The game tab's renderer died; already recorded as a page_crashed failure."""


class TimeUp(Exception):
    """Raised inside an action once the session is past --duration (+ a short grace)."""


class Timed:
    """Proxy that adds wall time per Playwright call into `acc` (name -> [calls, seconds])."""

    def __init__(self, obj, acc, prefix=''):
        self._o, self._acc, self._p = obj, acc, prefix

    def __getattr__(self, name):
        v = getattr(self._o, name)
        if name in ('keyboard', 'mouse'):
            return Timed(v, self._acc, name + '.')
        if not callable(v):
            return v

        def call(*a, **k):
            t = time.monotonic()
            try:
                return v(*a, **k)
            finally:
                c = self._acc.setdefault(self._p + name, [0, 0.0])
                c[0] += 1; c[1] += time.monotonic() - t
        return call


class Bot:
    def __init__(self, page, args, out):
        self.io = {}
        self.page, self.args, self.out = Timed(page, self.io), args, out
        self.rng = random.Random(args.seed)
        self.t0 = time.monotonic()
        self.log = []            # (elapsed, text)
        self.failures = []
        self.fail_ids = {}
        self.page_errors, self.console_errors, self.console_warnings = [], [], 0
        self.warning_texts = []
        self.seen_err = {}
        self.prev = None
        self.samples = 0
        self.next_check = 0
        self.next_shot = 0
        self.shots, self.shot_labels = [], []
        self.shot_windows = []         # (start, end) elapsed of screenshots: rAF gaps there are ours
        self.cx, self.cy = 480, 270
        self.expect_tiles_until = -1   # tiles may grow until this elapsed time (after a build click)
        self.hook_stage_since = (None, 0, 0)
        self.frame_ms = []             # recent per-frame wall ms (for the relative stall threshold)
        self.frozen_since = None
        self.active_bad = 0
        self.max_tiles = None
        self.m = {'actions': {}, 'action_s': {}, 'throws': 0, 'catches': 0, 'builds_tried': 0, 'tiles_built': 0, 'fish_casts': 0,
                  'fish_caught': 0, 'collected': 0, 'menus': 0, 'max_raf_gap_ms': 0, 'raf_frames': 0,
                  'min_y': None, 'max_dist': 0, 'swim_samples': 0, 'pause_open_after_inv_esc': None,
                  'relock_failures': 0}

    # ---------- bookkeeping ----------
    def el(self):
        return time.monotonic() - self.t0

    def ft(self):
        """Time of the failure: the sample's own time when checking a buffered sample."""
        return self.sample_t if self.sample_t is not None else self.el()

    def act(self, text):
        self.log.append((round(self.el(), 2), text))

    def repro(self):
        ft = self.ft()
        tail = '; '.join(f'{t:.1f}s {a}' for t, a in [x for x in self.log if x[0] <= ft + .5][-12:])
        return (f'python3.13 tests/e2e/playbot.py --dist {self.args.dist} --seed {self.args.seed} --duration {self.args.duration:g} '
                f'--kit {self.args.kit}{self.args.extra}  (failed at t={self.ft():.1f}s; last actions: {tail})')

    def fail(self, fid, detail, shot=True):
        n = self.fail_ids.get(fid, 0)
        self.fail_ids[fid] = n + 1
        if n >= 3:  # keep the report readable: first 3 of each id, rest counted
            return
        self.failures.append({'id': fid, 'detail': detail, 'repro': self.repro(), 't': round(self.ft(), 2)})
        if shot:
            self.screenshot('!' + fid)

    def screenshot(self, label):
        p = self.out / 'frames' / f'{len(self.shots):03d}-{self.el():06.1f}s-{label.strip("!")}.jpg'
        t0 = self.el()
        try:
            self.page.screenshot(path=str(p), timeout=30000, type='jpeg', quality=70, scale='css')
            self.shots.append(str(p))
            self.shot_labels.append(f'{label} {self.el():.0f}s')
        except Exception as e:
            self.act(f'screenshot failed: {e}')
        self.shot_windows = self.shot_windows[-20:] + [(t0, self.el())]
        self.m['screenshot_s'] = round(self.m.get('screenshot_s', 0) + self.el() - t0, 2)

    # ---------- core loop ----------
    def wait(self, ms):
        """Sleep in <=250 ms chunks, checking invariants and taking periodic screenshots."""
        end = time.monotonic() + ms / 1000
        while True:
            e = self.el()
            if self.stopping and e > self.args.duration + 8:
                raise TimeUp()
            if e >= self.next_check:
                self.check()
                self.next_check = e + self.args.drain_interval
            if e >= self.next_shot:
                self.screenshot(self.log[-1][1].split(' ')[0] if self.log else 'start')
                self.next_shot = self.el() + self.args.shot_interval
            left = end - time.monotonic()
            if left <= 0:
                return
            self.page.wait_for_timeout(int(min(left, .25) * 1000) + 1)

    def check(self):
        """Drain the in-page sample buffer and run every invariant on each sample in order."""
        t = time.monotonic()
        try:
            d = self.page.evaluate('window.__playbot.drain()')
        except Exception as e:
            # A renderer crash is the game's doing (e.g. memory blow-up); any other failed round-trip is the harness's.
            if self.crashed:
                self.fail('page_crashed', f'the game tab crashed (renderer died): {e}', shot=False)
                raise PageCrashed()
            raise InfraError(f'sample buffer could not be read: {type(e).__name__}: {e}')
        now = self.el()
        for kind, lst in (('pageerror', self.page_errors), ('console_error', self.console_errors)):
            seen = self.seen_err.get(kind, 0)
            for at, msg in lst[seen:]:
                self.sample_t = at
                self.fail(kind, msg[:400], shot=False)
            self.seen_err[kind] = len(lst)
        self.sample_t = None
        self.m['drain_s'] = round(self.m.get('drain_s', 0) + time.monotonic() - t, 2)
        self.m['drain_ms_max'] = max(self.m.get('drain_ms_max', 0), round((time.monotonic() - t) * 1000))
        for s in d['samples']:
            self.sample_t = now - (d['now'] - s['now']) / 1000
            if 'err' in s:
                self.fail('sample_failed', f'raftDebug.state threw: {s["err"][:300]}')
                continue
            self.check_sample(s, self.sample_t)
        self.sample_t = None

    sample_t = None
    crashed = False

    def check_sample(self, s, el):
        self.samples += 1
        p = self.prev

        if not s['running']:
            self.fail('not_running', 'raftDebug.state.running became false during Solo play')
        if s['disposed']:
            self.fail('disposed', 'engine reports disposed=true during play')

        # rAF stall
        pr = s.get('probe') or {}
        gap = pr.get('maxGap') or 0
        self.m['raf_frames'] += pr.get('frames') or 0
        self.m['max_raf_gap_ms'] = max(self.m['max_raf_gap_ms'], round(gap))
        if p and pr.get('frames') and (p.get('probe') or {}).get('frames') is not None:
            self.frame_ms = (self.frame_ms + [(s['now'] - p['now']) / pr['frames']])[-60:]
        # Relative to this box's own typical frame time, so a slower/more loaded machine does not trip it.
        typical = sorted(self.frame_ms)[len(self.frame_ms) // 2] if len(self.frame_ms) >= 5 else 0
        limit = max(self.args.stall_ms, 8 * typical)
        self.m['stall_limit_ms'] = round(max(self.m.get('stall_limit_ms', 0), limit))
        ours = any(a - 1 <= el and el - gap / 1000 - 1 <= b for a, b in self.shot_windows)  # stall overlapped a screenshot
        if gap > limit and not ours:
            self.fail('frame_stall', f'requestAnimationFrame gap of {gap:.0f} ms (threshold {limit:.0f} ms = max(--stall-ms, 8x median frame {typical:.0f} ms))')

        # player
        me, ph = s['me'] or {}, s['physics'] or {}
        x, y, z = me.get('x'), me.get('y'), me.get('z')
        if not finite(x, y, z, me.get('yaw'), me.get('pitch')):
            self.fail('player_nonfinite', f'player pose not finite: {me}')
        else:
            self.m['min_y'] = y if self.m['min_y'] is None else min(self.m['min_y'], y)
            self.m['max_dist'] = max(self.m['max_dist'], math.hypot(x, z))
            if s['swimming']:
                self.m['swim_samples'] += 1
            if y < self.args.y_floor:
                self.fail('player_below_floor', f'player eye y={y:.2f} < {self.args.y_floor} (swimming={s["swimming"]}) at x={x:.2f} z={z:.2f}')
            if math.hypot(x, z) > 100:
                self.fail('player_far_away', f'player at distance {math.hypot(x, z):.1f} from the raft origin')
            ry = (s['raft'] or {}).get('y', 0)
            tx, tz = round(x / 2), round(z / 2)
            over = any(t[0] == tx and t[1] == tz for t in s['tileList']) and abs(x / 2 - tx) < .4 and abs(z / 2 - tz) < .4
            if over and not s['swimming'] and not ph.get('climbing') and y < ry + 1.0:
                self.fail('fell_through_deck', f'eye y={y:.2f} is below deck+1.0 ({ry + 1.0:.2f}) while standing inside tile ({tx},{tz}), not swimming')
        if not finite(*(ph.get(k) for k in ('vx', 'vy', 'vz'))):
            self.fail('velocity_nonfinite', f'physics velocity not finite: {ph}')
        elif max(abs(ph['vx']), abs(ph['vy']), abs(ph['vz'])) > 60:
            self.fail('velocity_huge', f'physics velocity implausible: {ph}')

        # camera
        cam = s['camera'] or {}
        if not finite(cam.get('x'), cam.get('y'), cam.get('z'), cam.get('fov'), cam.get('pitch'), cam.get('roll')):
            self.fail('camera_nonfinite', f'camera not finite: {cam}')
        else:
            if not FOV_RANGE[0] - .01 <= cam['fov'] <= FOV_RANGE[1] + .01:
                self.fail('camera_fov', f'camera fov {cam["fov"]} outside {FOV_RANGE} while running')
            if abs(cam['pitch']) > PITCH_LIMIT + 1e-6:
                self.fail('camera_pitch', f'camera pitch {cam["pitch"]:.3f} beyond +-{PITCH_LIMIT}')
            if abs(cam['roll']) > .35:
                self.fail('camera_roll', f'camera roll {cam["roll"]:.3f} rad is implausible')

        # inventory
        inv = s['inventory'] or {}
        for i, sl in enumerate(inv.get('slots') or []):
            if sl is None:
                continue
            c = sl.get('count')
            if not isinstance(c, int) or isinstance(c, bool) or c < 1:
                self.fail('inventory_count', f'slot {i} {sl.get("kind")} has count {c!r}')
            d = sl.get('durability')
            if d is not None and not (finite(d) and 0 <= d <= 100):
                self.fail('inventory_durability', f'slot {i} {sl.get("kind")} durability {d!r}')
        for k, v in (s['stock'] or {}).items():
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                self.fail('stock_count', f'stock[{k}] = {v!r}')
        si = s['selectedIndex']
        if not isinstance(si, int) or not 0 <= si < 8:
            self.fail('selected_index', f'selectedIndex {si!r} not a hotbar slot')
        if p:
            for k in ('fish', 'collected'):
                if isinstance(s[k], int) and isinstance(p[k], int) and s[k] < p[k]:
                    self.fail(f'{k}_decreased', f'world.{k} went {p[k]} -> {s[k]}')
            self.m['collected'] = s['collected']

        # tiles
        tiles = s['tiles']
        if self.max_tiles is not None:
            if tiles < self.max_tiles:
                lost = [t for t in p['tileList'] if t not in s['tileList']] if p else '?'
                self.fail('tiles_decreased', f'raft tiles went {self.max_tiles} -> {tiles} with no removal action (lost {lost})')
            elif tiles > self.max_tiles:
                if el > self.expect_tiles_until:
                    self.fail('tiles_unexpected_growth', f'raft tiles went {self.max_tiles} -> {tiles} without a recent build click')
                self.m['tiles_built'] += tiles - self.max_tiles
        self.max_tiles = tiles   # report each change once
        if len({tuple(t) for t in s['tileList']}) != len(s['tileList']):
            self.fail('tiles_duplicate', f'duplicate tile coords in {s["tileList"]}')

        # hook state machine
        st = s['hookStage']
        if st not in HOOK_STAGES:
            self.fail('hook_stage_invalid', f'hookStage {st!r}')
        elif p and p['hookStage'] in HOOK_NEXT and st not in HOOK_NEXT[p['hookStage']]:
            self.fail('hook_transition', f'hook stage jumped {p["hookStage"]} -> {st}')
        if (st == 'idle') != (s['hook'] is None):
            self.fail('hook_state_mismatch', f'hookStage={st} but hook={s["hook"]}')
        h = s['hook'] or {}
        if h and not h.get('fishing'):
            if not finite(h.get('x'), h.get('y'), h.get('z'), h.get('tension'), h.get('distance')):
                self.fail('hook_nonfinite', f'hook state not finite: {h}')
            elif not -1e-6 <= h['tension'] <= 1 + 1e-6:
                self.fail('hook_tension', f'hook tension {h["tension"]} outside [0,1]')
            elif h['distance'] > 80:
                self.fail('hook_far', f'hook {h["distance"]:.1f} m away (range is {s["hookRange"] if "hookRange" in s else "~32"})')
        # Measured in game time: hook-physics forces a splash after MAX_FLIGHT_TIME=8 sim s and 'done' ends the same
        # frame, but at ~1 fps with the 50 ms dt clamp 8 sim s is ~2 wall minutes, so wall time alone is not "stuck".
        sim = pr.get('sim') or 0
        if st != self.hook_stage_since[0]:
            self.hook_stage_since = (st, el, sim)
        elif st in HOOK_STUCK_SIM_S:
            wall, game = el - self.hook_stage_since[1], sim - self.hook_stage_since[2]
            if wall > self.args.hook_stuck_s and game > HOOK_STUCK_SIM_S[st]:
                self.fail('hook_stuck', f'hook stuck in stage {st!r} for {game:.1f} game s ({wall:.0f} wall s; limit {HOOK_STUCK_SIM_S[st]} game s)')
                self.hook_stage_since = (st, el, sim)
        if not (0 <= (s['charge'] or 0) <= 1):
            self.fail('charge_range', f'charge {s["charge"]}')

        # menus
        if s['inventoryOpen'] and s['pauseOpen']:
            self.fail('inventory_and_pause_open', 'inventory and pause menu are both open at the same time')
        menu = s['inventoryOpen'] or s['pauseOpen'] or bool(s['otherDialogs'])
        if not menu and not s['active']:
            self.active_bad += 1
            if self.active_bad == 3:
                self.fail('engine_inactive', 'no menu is open but the engine stayed inactive (active=false) for 3 samples')
        else:
            self.active_bad = 0

        # liveness: raft bob or camera must change while unpaused
        sig = ((s['raft'] or {}).get('y'), (s['raft'] or {}).get('roll'))
        # Needs both wall time and rendered frames: samples taken by the timer fallback while rAF is slow legitimately
        # repeat the pose; only frames that ran without moving the raft mean the world is frozen.
        nf = pr.get('totalFrames') or 0
        if not menu and p and sig == self.last_sig:
            self.frozen_since = self.frozen_since or (el, nf)
            secs, frames = el - self.frozen_since[0], nf - self.frozen_since[1]
            if secs > self.args.stall_ms / 1000 + 2 and frames >= 10:
                self.fail('world_frozen', f'raft pose unchanged for {secs:.1f}s / {frames} rendered frames while unpaused')
                self.frozen_since = (el, nf)
        else:
            self.frozen_since = None
        self.last_sig = sig
        self.prev = s

    last_sig = None
    stopping = False

    # ---------- input helpers ----------
    held = ()
    mouse_held = False

    def key_down(self, k):
        self.held = set(self.held) | {k}
        self.page.keyboard.down(k)

    def key_up(self, k):
        self.held = set(self.held) - {k}
        self.page.keyboard.up(k)

    def mouse_down(self):
        self.mouse_held = True
        self.page.mouse.down()

    def mouse_up(self):
        self.mouse_held = False
        self.page.mouse.up()

    def state(self):
        t = time.monotonic()
        try:
            return self.page.evaluate('raftDebug.state')
        finally:
            self.m['state_calls'] = self.m.get('state_calls', 0) + 1
            self.m['state_s'] = round(self.m.get('state_s', 0) + time.monotonic() - t, 2)

    def until(self, js, timeout_s=6.0):
        """Poll a page condition (timer-polled, so it does not wait on slow rAF) instead of a fixed sleep + one read:
        returns as soon as it holds, and tolerates a heavily loaded box up to timeout_s. Then runs due checks."""
        if self.stopping:   # never wait past the run's hard deadline
            timeout_s = max(.2, min(timeout_s, self.args.duration + 8 - self.el()))
        try:
            # Fast path: key/click handlers run synchronously, so the condition usually holds already and one
            # evaluate (~1 s) is far cheaper than setting up wait_for_function (~5 s on this box).
            ok = bool(self.page.evaluate(f'!!({js})'))
            if not ok:
                t = self.el()
                self.page.wait_for_function(js, polling=100, timeout=timeout_s * 1000)
                ok = True
                self.m['slow_waits'] = (self.m.get('slow_waits') or [])[-9:] + [[js[:60], round(self.el() - t, 1)]]
        except Exception as e:
            if 'Timeout' not in type(e).__name__ and 'Timeout' not in str(e):
                raise
            ok = False
        self.wait(0)
        return ok

    def aim_at(self, wx, wy, wz):
        """Point the camera at a world point (computed in-page: one round-trip). Returns the state after aiming."""
        return self.page.evaluate('([x, y, z]) => window.__playbot.aim(x, y, z)', [wx, wy, wz])

    def set_view(self, yaw, pitch):
        return self.page.evaluate('([y, p]) => window.__playbot.view(y, p)', [yaw, pitch])

    def ensure_lock(self):
        """Close stray menus and get pointer lock back (first canvas click only locks)."""
        for _ in range(4):
            s = self.page.evaluate("({lock: raftDebug.state.pointerLocked, inv: raftDebug.state.inventoryOpen, fb: raftDebug.state.lockFallback,"
                                   " dlg: [...document.querySelectorAll('dialog')].some(d => d.open)})")
            if s['inv']:
                self.page.keyboard.press('Tab'); self.until('!raftDebug.state.inventoryOpen', 3); continue
            if s['dlg']:
                self.page.keyboard.press('Escape'); self.until("![...document.querySelectorAll('dialog')].some(d => d.open)", 3); continue
            if s['lock'] or s['fb']:
                return True
            self.page.mouse.click(self.cx, self.cy)
            self.until('raftDebug.state.pointerLocked || raftDebug.state.lockFallback', 3)
        self.m['relock_failures'] += 1
        self.act('could not regain pointer lock')
        return False

    def select(self, kind, st=None):
        st = st or self.state()
        if st['heldKind'] == kind:
            return True
        slots = st['inventory']['slots']
        i = next((j for j in range(8) if slots[j] and slots[j]['kind'] == kind), None)
        if i is None:
            self.act(f'no {kind} in hotbar')
            return False
        self.act(f'select {kind} Digit{i + 1}')
        self.page.keyboard.press(f'Digit{i + 1}')
        if not self.until(f'raftDebug.state.selectedIndex === {i}'):
            self.fail('hotbar_select_failed', f'Digit{i + 1} did not select hotbar slot {i} ({kind}) within 6 s '
                      f'(selectedIndex still {self.page.evaluate("raftDebug.state.selectedIndex")})')
            return False
        return True

    def wait_idle_hook(self, max_s):
        return self.until("raftDebug.state.hookStage === 'idle'", max_s)

    # ---------- actions ----------
    def a_walk(self):
        st = self.state()
        me = st['me']
        if math.hypot(me['x'], me['z']) > 2.2 or st['swimming']:   # head back to the raft centre
            me2 = self.aim_at(0, me['y'], 0)['me']
            self.set_view(me2['yaw'], -.2)
            key, ms = 'KeyW', 1500 + self.rng.randint(0, 1500)
            self.act(f'walk home {key} {ms}ms')
        else:
            key = self.rng.choice(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
            ms = self.rng.randint(400, 1600)
            self.act(f'walk {key} {ms}ms')
        self.key_down(key)
        if self.rng.random() < .25:
            self.key_down('ShiftLeft')
        self.wait(ms)
        for k in list(self.held):
            self.key_up(k)

    def a_jump(self):
        self.act('jump Space')
        self.key_down('Space'); self.wait(200); self.key_up('Space'); self.wait(600)

    def a_look(self):
        dx, dy = self.rng.uniform(-700, 700), self.rng.uniform(-250, 250)
        if self.rng.random() < .15:
            dy = self.rng.choice([-1, 1]) * 2000   # slam into the pitch limit
        self.act(f'look dx={dx:.0f} dy={dy:.0f}')
        # a smooth sweep: 8 mousemoves spread over ~1 s inside the page (one round-trip)
        self.page.evaluate("""([dx, dy]) => { for (let i = 0; i < 8; i++) setTimeout(() =>
            document.dispatchEvent(new MouseEvent('mousemove', {movementX: dx / 8, movementY: dy / 8, bubbles: true})), i * 120); }""", [dx, dy])
        self.wait(1000)

    def a_hotbar(self):
        keys = [f'Digit{self.rng.randint(1, 5)}' for _ in range(self.rng.randint(2, 5))]
        self.act('hotbar ' + ','.join(keys))
        for k in keys:
            self.page.keyboard.press(k); self.wait(200)
        if self.rng.random() < .3:
            self.act('wheel')
            self.page.mouse.wheel(0, 120); self.wait(200)

    def a_throw(self):
        r = self.page.evaluate('({st: raftDebug.state, tg: raftDebug.targets})')
        if not self.select('hook', r['st']):
            return
        st = r['st']
        if st['hookStage'] != 'idle':
            self.act('throw skipped: hook busy'); return
        coll0 = st['collected']
        tg = [t for t in r['tg'] if not t['pending'] and t['distance'] < 18]
        if tg:
            tg.sort(key=lambda t: (t['distance'], t['id']))
            t = tg[min(len(tg) - 1, self.rng.randint(0, 2))]
            self.aim_at(t['x'], t['y'] + t['distance'] * .12, t['z'])   # a little above for the arc
            desc = f'debris#{t["id"]} {t["type"]} d={t["distance"]:.1f}'
        else:
            self.set_view(self.rng.uniform(-math.pi, math.pi), .1); desc = 'open water'
        hold = self.rng.randint(350, 900)
        self.act(f'throw hook at {desc} hold={hold}ms')
        self.m['throws'] += 1
        self.page.mouse.move(self.cx, self.cy); self.mouse_down(); self.wait(hold); self.mouse_up()
        # let it fly / land, then reel
        self.until("['floating', 'idle', 'done'].includes(raftDebug.state.hookStage)", self.args.hook_wait_s)
        if self.page.evaluate('raftDebug.state.hookStage') in ('floating', 'reeling'):
            self.act('reel (hold LMB)')
            self.mouse_down()
            self.wait_idle_hook(self.args.hook_wait_s)
            self.mouse_up()
        if not self.wait_idle_hook(4):
            self.act('hook still out after reel')
        got = self.state()['collected'] - coll0
        if got > 0:
            self.m['catches'] += got
            self.act(f'caught {got}')

    def a_collect(self):
        tg = sorted(self.page.evaluate('raftDebug.targets'), key=lambda t: t['distance'])
        if tg and tg[0]['distance'] < 4:
            self.aim_at(tg[0]['x'], tg[0]['y'], tg[0]['z'])
        self.act('press E (collect / inventory)')
        self.page.keyboard.press('KeyE'); self.wait(600)
        if self.page.evaluate('raftDebug.state.inventoryOpen'):
            self.page.keyboard.press('Tab'); self.wait(400)

    def a_inventory(self):
        self.m['menus'] += 1
        self.act('open inventory Tab')
        self.page.keyboard.press('Tab')
        if not self.until('raftDebug.state.inventoryOpen'):
            self.fail('inventory_did_not_open', 'Tab while playing did not open the inventory within 6 s')
            return
        self.wait(300)
        n = self.m['actions'].get('inventory', 0)   # 1st close is Esc, 2nd Tab, then random
        if n == 1 or (n > 2 and self.rng.random() < .5):
            self.act('close inventory Esc')
            self.page.keyboard.press('Escape')
            self.until('!raftDebug.state.inventoryOpen')
            self.wait(300)   # a late keyup-path pause would show up here
            r = self.page.evaluate("({inv: raftDebug.state.inventoryOpen, pause: !!document.querySelector('#options')?.open})")
            if self.m['pause_open_after_inv_esc'] is None:
                self.m['pause_open_after_inv_esc'] = r['pause']
            if r['inv'] and r['pause']:
                self.fail('esc_inventory_both_open', 'Esc from the inventory left both inventory and pause open')
            elif r['inv']:
                self.fail('esc_inventory_stuck', 'Esc did not close the inventory within 6 s')
        else:
            self.act('close inventory Tab')
            self.page.keyboard.press('Tab')
            if not self.until('!raftDebug.state.inventoryOpen'):
                self.fail('tab_inventory_stuck', 'Tab did not close the inventory within 6 s')

    def a_pause(self):
        self.m['menus'] += 1
        self.act('pause Esc')
        self.page.keyboard.press('Escape')
        if not self.until("!!document.querySelector('#options')?.open"):
            self.fail('pause_did_not_open', 'Esc while playing (pointer locked) did not open the pause menu within 6 s')
        self.wait(self.rng.randint(300, 1200))
        self.act('resume Esc')
        self.page.keyboard.press('Escape')
        if not self.until("!document.querySelector('#options')?.open"):
            self.fail('pause_did_not_close', 'second Esc did not close the pause menu within 6 s')

    def a_build(self):
        if not self.select('hammer'):
            return
        r = self.page.evaluate('({pl: raftDebug.placements, me: raftDebug.state.me})')
        pl, me = r['pl'], r['me']
        if not pl:
            self.act('no placements'); return
        pl.sort(key=lambda c: (math.hypot(c['world']['x'] - me['x'], c['world']['z'] - me['z']), c['x'], c['z']))
        c = pl[min(len(pl) - 1, self.rng.randint(0, 3))]
        self.aim_at(c['world']['x'], c['world']['y'], c['world']['z'])
        self.wait(500)   # let the frame compute hover
        st = self.state()
        self.act(f'build floor at ({c["x"]},{c["z"]}) hover={st["build"]["hover"]} affordable={st["build"]["affordable"]}')
        self.m['builds_tried'] += 1
        self.expect_tiles_until = self.el() + 8
        t0 = st['tiles']
        self.page.mouse.click(self.cx, self.cy); self.wait(1200)
        if st['build']['hover'] and st['build']['affordable'] and self.state()['tiles'] == t0:
            self.wait(2000)
            if self.state()['tiles'] == t0:
                self.fail('build_no_effect', f'clicked with hammer while hover={st["build"]["hover"]} and affordable, but tiles stayed {t0}')

    def a_fish(self):
        if not self.select('fishingrod'):
            return
        if self.page.evaluate('raftDebug.state.hookStage') != 'idle':
            self.act('fish skipped: hook busy'); return
        st = self.state()
        me = st['me']
        # aim at open water ~6 m out, away from the tiles
        ang = self.rng.uniform(-math.pi, math.pi)
        wx, wz = me['x'] - math.sin(ang) * 7, me['z'] - math.cos(ang) * 7
        self.aim_at(wx, 0, wz)
        self.wait(300)
        fish0 = self.state()['fish']
        self.act(f'cast rod toward ({wx:.1f},{wz:.1f})')
        self.m['fish_casts'] += 1
        self.page.mouse.click(self.cx, self.cy); self.wait(600)
        if self.page.evaluate('raftDebug.state.hookStage') == 'fishing':
            self.wait_idle_hook(self.args.fish_wait_s)
        got = self.state()['fish'] - fish0
        if got > 0:
            self.m['fish_caught'] += got
            self.act(f'fish +{got}')

    ACTIONS = [('walk', 5), ('look', 4), ('hotbar', 2), ('jump', 1), ('throw', 3), ('collect', 1),
               ('inventory', 2), ('pause', 1), ('build', 2), ('fish', 1)]

    # Every action once first, highest-value checks first (a 90 s gate on a ~1 fps box only fits ~10 actions):
    # inventory+Esc, pause, inventory+Tab, build, throw (throw is the slowest: flight + reel), then the rest.
    FIRST_PASS = ['inventory', 'pause', 'inventory', 'build', 'throw', 'hotbar', 'look', 'walk', 'jump', 'fish', 'collect']

    def plan(self):
        names = [n for n, w in self.ACTIONS for _ in range(w)]
        # every action once first (cheap ones first) so even a short run touches all of them, then weighted random
        yield from self.FIRST_PASS
        while True:
            yield self.rng.choice(names)

    def run(self):
        dur = self.args.duration
        for name in self.plan():
            if self.el() >= dur:
                break
            self.m['actions'][name] = self.m['actions'].get(name, 0) + 1
            self.stopping = True
            ta = self.el()
            try:
                self.ensure_lock()
                getattr(self, 'a_' + name)()
                self.wait(self.rng.randint(100, 400))
            except TimeUp:
                self.act(f'time up during {name}')
                break
            except PageCrashed:
                self.act(f'page crashed during {name}')
                return
            except Exception as e:
                if not self.crashed:
                    raise
                self.act(f'page crashed during {name}')
                self.fail('page_crashed', f'the game tab crashed (renderer died) during {name}: {e}', shot=False)
                return
            finally:
                self.m['action_s'][name] = round(self.m['action_s'].get(name, 0) + self.el() - ta, 1)
                self.stopping = False
                if self.crashed:
                    self.held, self.mouse_held = (), False
                for k in list(self.held):
                    self.key_up(k)
                if self.mouse_held:
                    self.mouse_up()
        self.check()
        self.screenshot('end')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', required=True)
    ap.add_argument('--out', default='artifacts/playbot')
    ap.add_argument('--duration', type=float, default=300, help='seconds of scripted play (default 300)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--kit', choices=['starter', 'fresh'], default='starter')
    ap.add_argument('--check-interval', type=float, default=.5, help='in-page invariant sample period (s)')
    ap.add_argument('--drain-interval', type=float, default=4.0, help='how often Python drains/checks the samples (s)')
    ap.add_argument('--viewport', default='960x540', help='WxH; smaller keeps swiftshader responsive')
    ap.add_argument('--shot-interval', type=float, default=None, help='seconds between screenshots (default max(45, duration/10))')
    ap.add_argument('--stall-ms', type=float, default=8000, help='max rAF gap before frame_stall (swiftshader-generous)')
    ap.add_argument('--y-floor', type=float, default=-4.0, help='player eye y below this is a failure')
    ap.add_argument('--hook-wait-s', type=float, default=None, help='max wait for hook flight / reel (default min(25, duration/6))')
    ap.add_argument('--hook-stuck-s', type=float, default=20,
                    help='min wall seconds in flying/done before hook_stuck (game-time limit must also be exceeded)')
    ap.add_argument('--fish-wait-s', type=float, default=None, help='max wait for a bite (default min(15, duration/10))')
    ap.add_argument('--headed', action='store_true')
    args = ap.parse_args()
    # Non-default tuning flags go into every repro string so the replay uses the same thresholds.
    args.extra = ''.join(f' --{k.replace("_", "-")} {v:g}' if isinstance(v, float) else f' --{k.replace("_", "-")} {v}'
                         for k, v in vars(args).items()
                         if k not in ('dist', 'out', 'duration', 'seed', 'kit', 'headed') and v is not None and v != ap.get_default(k))
    # each screenshot costs ~5 s on swiftshader (it waits for a composited frame), so keep periodic ones sparse
    args.shot_interval = args.shot_interval or max(45.0, args.duration / 10)
    # keep slow hook/fish waits proportional so a short run is not one long wait
    args.hook_wait_s = args.hook_wait_s or min(25.0, max(8.0, args.duration / 6))
    args.fish_wait_s = args.fish_wait_s or min(15.0, max(6.0, args.duration / 10))
    out = Path(args.out).resolve()
    result = {'tool': TOOL, 'pass': False, 'failures': [], 'metrics': {}, 'artifacts': []}
    code = 2
    bot = None
    try:
        try:
            (out / 'frames').mkdir(parents=True, exist_ok=True)
            for f in [*(out / 'frames').glob('*.png'), *(out / 'frames').glob('*.jpg')]:
                f.unlink()
        except OSError as e:
            raise InfraError(f'cannot use --out {out}: {e}')
        dist = Path(args.dist).resolve()
        if not (dist / 'index.html').is_file():
            raise InfraError(f'no index.html in {dist}')
        from harness import StaticServer, launch_chromium
        from playwright.sync_api import sync_playwright
        save = ''
        if args.kit == 'starter':
            save = "try { localStorage.setItem('little-raft-v1', %s); } catch (e) {}" % json.dumps(json.dumps(starter_save()))
        else:
            save = "try { localStorage.removeItem('little-raft-v1'); } catch (e) {}"
        with StaticServer(dist) as srv, sync_playwright() as p:
            browser = launch_chromium(p, headless=not args.headed)
            try:
                vw, vh = (int(v) for v in args.viewport.lower().split('x'))
                page = browser.new_page(viewport={'width': vw, 'height': vh})
                page.set_default_timeout(60000)
                page.add_init_script(PAGE_INIT % {'seed': args.seed, 'save': save, 'interval': max(50, int(args.check_interval * 1000)),
                                                   'look_k': LOOK_K, 'pitch_limit': PITCH_LIMIT})
                bot = Bot(page, args, out)
                page.on('pageerror', lambda e: bot.page_errors.append((round(bot.el(), 2), f'{e}\n{(getattr(e, "stack", None) or "")[:300]}'.strip())))

                def on_console(m):
                    if m.type == 'error':
                        bot.console_errors.append((round(bot.el(), 2), m.text[:400]))
                    elif m.type == 'warning':
                        bot.console_warnings += 1
                        if len(bot.warning_texts) < 5:
                            bot.warning_texts.append(m.text[:200])
                page.on('console', on_console)
                page.on('crash', lambda *_: setattr(bot, 'crashed', True))
                try:
                    page.goto(srv.url, timeout=60000)
                    # live.js catches a throwing mount(), logs console.error and shows #raftLiveError: stop waiting then.
                    page.wait_for_function("!!window.raftDebug || !!document.getElementById('raftLiveError')", timeout=60000)
                    page.wait_for_timeout(500)
                    if page.evaluate("!window.raftDebug && !!document.getElementById('raftLiveError')"):
                        raise RuntimeError('live.js reported that the game failed to start (#raftLiveError shown)')
                    # Title buttons differ between branches: #solo may be a hidden "Continue" with #newGame next to it.
                    btn = page.locator('#solo:visible, #newGame:visible').first
                    btn.click()
                    page.wait_for_function('raftDebug.state.running', timeout=30000)
                except Exception as e:
                    errs = bot.page_errors + bot.console_errors
                    try:
                        webgl = page.evaluate("(() => { try { const c = document.createElement('canvas');"
                                              " return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })()")
                    except Exception:
                        webgl = True   # page unusable: let the recorded errors decide
                    if errs and webgl:
                        bot.fail('boot_failed', f'game did not start: {e}; page/console errors: {errs[:3]}', shot=False)
                    else:
                        raise InfraError(f'could not start Solo game: {e}' + ('' if webgl else ' (WebGL unavailable in this Chromium)'))
                if not bot.failures:
                    bot.t0 = time.monotonic()
                    bot.cx, bot.cy = vw // 2, vh // 2
                    page.evaluate('window.__playbot.reset(); window.__playbot.on = true')
                    bot.act('solo start')
                    if args.kit == 'starter':
                        # A branch with a different save schema may drop the kit (the game then falls back to a fresh
                        # bag): not a bug, but build/fish then only notice the missing tool, so say so in the metrics.
                        kinds = page.evaluate("(raftDebug.state.inventory?.slots || []).filter(Boolean).map(s => s.kind)")
                        bot.m['kit_loaded'] = all(k in kinds for k in ('hook', 'hammer', 'fishingrod'))
                        if not bot.m['kit_loaded']:
                            bot.act(f'starter kit not loaded by this build (inventory: {kinds})')
                    page.wait_for_timeout(1000)
                    try:
                        bot.check()
                        bot.run()
                    except PageCrashed:
                        pass
            finally:
                browser.close()
        from timeline_strip import build_strip
        strip = out / 'timeline.png'
        if build_strip(bot.shots, strip, labels=bot.shot_labels, cols=6):
            result['artifacts'].append(str(strip))
        result['artifacts'] += bot.shots
        (out / 'actions.log').write_text('\n'.join(f'{t:8.2f}  {a}' for t, a in bot.log) + '\n')
        result['artifacts'].append(str(out / 'actions.log'))
        result['failures'] = bot.failures
        result['pass'] = not bot.failures
        code = 0 if result['pass'] else 1
    except InfraError as e:
        result['failures'] = [{'id': 'infra', 'detail': str(e), 'repro': 'check --dist and the Chromium install'}]
        if bot and bot.failures:   # game failures found before the harness broke are still real
            result['failures'] += bot.failures
            code = 1
    except Exception as e:
        result['failures'] = [{'id': 'infra', 'detail': f'{type(e).__name__}: {e}', 'repro': traceback.format_exc()[-1500:]}]
        if bot:
            result['failures'] += bot.failures
            if bot.failures:
                code = 1
    if bot:
        m = bot.m
        m.update(seed=args.seed, kit=args.kit, duration_s=round(bot.el(), 1), requested_duration_s=args.duration,
                 samples=bot.samples, page_errors=len(bot.page_errors), console_errors=len(bot.console_errors),
                 console_warnings=bot.console_warnings, warning_samples=bot.warning_texts, failure_counts=bot.fail_ids,
                 min_y=None if m['min_y'] is None else round(m['min_y'], 3), max_dist=round(m['max_dist'], 2),
                 avg_fps=round(m['raf_frames'] / max(bot.el(), 1e-6), 2),
                 io={k: [c, round(t, 1)] for k, (c, t) in sorted(bot.io.items(), key=lambda kv: -kv[1][1])},
                 mean_sample_interval_s=round(bot.el() / max(bot.samples, 1), 2))
        result['metrics'] = m
    print(json.dumps(result))
    sys.exit(code)


if __name__ == '__main__':
    main()
