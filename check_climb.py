"""Climb / jump-onto probe (a report, not a test).

Usage: python check_climb.py [--strict] [--no-shots] [--only name,name] [--out docs/loop/climb-scale/climb-before.json]

Serves dist/ itself, loads saves with a big flat foundation floor and one object per slot (every building piece shape
plus every placeable decor / station the game knows, enumerated from the code at run time), then for each object:
  * puts the player on the deck in front of it, facing it (start spot only, never on the object),
  * drives a standing jump (W + Space together) and a running jump (Shift + W from 4 m back, Space at the take-off
    point) through the real key path (DOM keyboard events -> input.js -> controls.js -> PlayerPhysics/BuildGrid),
  * records every frame and every collision rule that moved the body (instrumented by wrapping prototype methods
    in-page; nothing under dist/ is edited),
  * compares the collision shapes with the visible mesh bounds (THREE.Box3.setFromObject, raft-local frame).
Prints a table, writes JSON, and with --no-shots skipped takes first-person screenshots with the normal HUD.
Expected rules (decided in dist/decor-collision.js and dist/building-pieces.js):
  * every building piece top is standable (floors, roofs, hatches, stairs, walls, half walls, windows, door tops at
    the jambs, railings, gates, pillars); a full wall or a floor edge one storey up is reached with the ledge clamber,
  * decor with a standable collider (crates, tables, beds, stations, planters...) must be landed on,
  * thin or tall decor (lamps, poles, flags, signs) blocks with its true height: the body may never be inside its
    collider while the feet are below its top,
  * flat decor (rug) has no collider.
Exit code is 0 unless --strict is given and an object broke its rule."""
import os, sys, json, math, re, threading, functools, http.server, socketserver, argparse, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--strict', action='store_true')
ap.add_argument('--no-shots', action='store_true')
ap.add_argument('--shots-only', action='store_true')
ap.add_argument('--only', default='')
ap.add_argument('--dist', default=str(ROOT / 'dist'))
ap.add_argument('--out', default=str(ROOT / 'docs/loop/climb-scale/climb-before.json'))
ap.add_argument('--shots-dir', default=str(ROOT / 'docs/loop/climb-scale'))
ap.add_argument('--shot-prefix', default='before-')
args = ap.parse_args()
dist = Path(args.dist).resolve(); out_json = Path(args.out).resolve(); shots_dir = Path(args.shots_dir).resolve()
out_json.parent.mkdir(parents=True, exist_ok=True); shots_dir.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
URL = f'http://127.0.0.1:{srv.server_address[1]}/?fixedres'
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ---------- object list ----------
src = (dist / 'game.js').read_text()
m = re.search(r"const DECOR_TYPES = Object\.freeze\(\[\.\.\.new Set\(\[(.*?)\]\)\]\)", src)
BASE_DECOR = re.findall(r"'([a-z0-9]+)'", m.group(1).split('...')[0]) if m else []
# CONTENT_DECOR and PLACEABLE_IDS are read in-page from the modules game.js imports (see enumerate()).

# Building pieces, each laid out relative to its slot cell (ci, cj). The player approaches from +z facing -z.
def piece_specs(ci, cj):
    corners = [(ci, cj), (ci + 1, cj), (ci, cj + 1), (ci + 1, cj + 1)]
    pillars = [{'t': 'pillar', 'i': a, 'j': b, 'l': 0} for a, b in corners]
    room = [{'t': 'wall', 'i': ci, 'j': cj, 'l': 0, 'r': 0}, {'t': 'wall', 'i': ci, 'j': cj + 1, 'l': 0, 'r': 0},
            {'t': 'wall', 'i': ci, 'j': cj, 'l': 0, 'r': 1}, {'t': 'wall', 'i': ci + 1, 'j': cj, 'l': 0, 'r': 1}]
    edge = lambda t, dx=0: {'main': [{'t': t, 'i': ci, 'j': cj, 'l': 0, 'r': 0}], 'support': [], 'ax': 2 * ci + dx}
    return {
        'piece:wall': edge('wall'), 'piece:halfwall': edge('halfwall'), 'piece:window': edge('window'),
        'piece:door': edge('door', -0.8),  # at the jamb: over the opening the lintel bumps the head (you walk through)
        'piece:railing': edge('railing'), 'piece:gate': edge('gate'),
        'piece:pillar': {'main': [{'t': 'pillar', 'i': ci, 'j': cj, 'l': 0}], 'support': [], 'ax': 2 * ci - 1},
        'piece:stairs': {'main': [{'t': 'stairs', 'i': ci, 'j': cj, 'l': 0, 'r': 2}], 'support': [], 'ax': 2 * ci, 'ramp': True},
        'piece:ladder': {'main': [{'t': 'ladder', 'i': ci, 'j': cj, 'l': 0, 'r': 2}], 'support': [], 'ax': 2 * ci, 'climb': True},
        'piece:floor-l1-on-pillars': {'main': [{'t': 'floor', 'i': ci, 'j': cj, 'l': 1}], 'support': pillars, 'ax': 2 * ci},
        'piece:floor-l1-on-walls': {'main': [{'t': 'floor', 'i': ci, 'j': cj, 'l': 1}], 'support': room, 'ax': 2 * ci, 'supportSolid': True},
        'piece:hatch-l1-on-pillars': {'main': [{'t': 'hatch', 'i': ci, 'j': cj, 'l': 1, 'r': 0}], 'support': pillars, 'ax': 2 * ci},
        'piece:roof-l1-on-pillars': {'main': [{'t': 'roof', 'i': ci, 'j': cj, 'l': 1, 'r': 2}], 'support': pillars, 'ax': 2 * ci, 'ramp': True},
    }
PIECE_NAMES = list(piece_specs(0, 0).keys())

SLOTS = [(3 * a, 3 * b) for b in (-2, -1, 0, 1, 2) for a in (-2, -1, 0, 1, 2)]
TILES = [[x, z] for x in range(-8, 9) for z in range(-8, 10)]  # 306 tiles (save limit 400)

PROBE_JS = r"""
(async () => {
  if (window.__P) return true;
  const urls = performance.getEntriesByType('resource').map(e => e.name);
  const find = n => urls.find(u => u.includes('/' + n + '?')) || urls.find(u => u.includes('/' + n));
  const PP = await import(find('player-physics.js')), BP = await import(find('building-pieces.js'));
  const T = await import(find('vendor/three.module.js'));
  const CI = await import(find('content-items.js')), IT = await import(find('items.js'));
  const P = window.__P = {PP, BP, T, CI, IT, phys:null, grid:null, deckY:0, scene:null, rec:null, trig:null, frames:0};
  const R = PP.PLAYER_CONSTANTS.BODY_RADIUS, EYE = PP.PLAYER_CONSTANTS.EYE_OFFSET;
  // capture the live scene, physics body and build grid
  // Trials do not need pixels: skip the GL draw while P.noRender (software GL is the slow part); screenshots render.
  const oRender = T.WebGLRenderer.prototype.render;
  T.WebGLRenderer.prototype.render = function (scene, cam) { if (P.noRender) { if (scene && scene.isScene) scene.updateMatrixWorld(); return; } return oRender.call(this, scene, cam); };
  const oUMW = T.Scene.prototype.updateMatrixWorld;
  T.Scene.prototype.updateMatrixWorld = function (f) { if (this !== P.scene && this.getObjectByName('buildingPieces')) P.scene = this; return oUMW.call(this, f); };
  const G = BP.BuildGrid.prototype, PH = PP.PlayerPhysics.prototype;
  const oPre = G.preStep;
  G.preStep = function (phys, deckY, climbing) { P.phys = phys; P.grid = this; P.deckY = deckY; return oPre.call(this, phys, deckY, climbing); };
  const ev = (k, o) => { const r = P.rec; if (!r || r.ev.length > 400) return; o.k = k; o.t = r.n; o.feet = +(P.phys.y - EYE - P.deckY).toFixed(3); r.ev.push(o); };
  const oSolids = G._solids;
  G._solids = function (phys, deckY, b, count, lo) {
    if (phys !== P.phys || !P.rec) return oSolids.call(this, phys, deckY, b, count, lo);
    const y0 = phys.y; this.__tag = b === this._slabs ? 'slab' : 'solid'; this.__arr = b; this.__lo = lo - deckY;
    const r = oSolids.call(this, phys, deckY, b, count, lo);
    if (phys.y < y0 - 1e-6) ev('headBump', {drop:+(y0 - phys.y).toFixed(3), tag:this.__tag});
    this.__tag = null; return r;
  };
  const oRamps = G._ramps;
  G._ramps = function (phys, deckY) { this.__tag = 'rampUnderside'; this.__arr = null; const r = oRamps.call(this, phys, deckY); this.__tag = null; return r; };
  const oPush = G._push;
  G._push = function (phys, x0, x1, z0, z1) {
    const px = phys.x, pz = phys.z, r = oPush.call(this, phys, x0, x1, z0, z1);
    if (phys === P.phys && P.rec && (Math.abs(phys.x - px) > 1e-6 || Math.abs(phys.z - pz) > 1e-6)) {
      let top = null, bot = null; const b = this.__arr;
      if (b) for (let k = 0; k < b.length; k += 6) if (b[k] === x0 && b[k + 3] === x1 && b[k + 2] === z0 && b[k + 5] === z1) { bot = b[k + 1]; top = b[k + 4]; break; }
      ev('sidePush', {tag:this.__tag || 'other', box:[x0, x1, z0, z1].map(v => +v.toFixed(3)), boxBottom:bot, boxTop:top, pushLimit:this.__lo != null ? +this.__lo.toFixed(3) : null, grounded:phys.grounded});
    }
    return r;
  };
  const oSweep = G._sweep;
  G._sweep = function (phys, deckY) { const px = phys.x, pz = phys.z; const r = oSweep.call(this, phys, deckY); if (phys === P.phys && P.rec && (Math.abs(phys.x - px) > 1e-6 || Math.abs(phys.z - pz) > 1e-6)) ev('sweepStop', {}); return r; };
  const oClamber = G._clamber;
  G._clamber = function (phys, deckY) { const r = oClamber.call(this, phys, deckY); if (phys === P.phys && P.rec && this._refused) ev('clamberRefused', {}); return r; };
  const oProp = PH._propOk;
  PH._propOk = function (blocked) {
    const ok = oProp.call(this, blocked);
    if (!ok && this === P.phys && P.rec) {
      for (const b of blocked) { if (!b || !Number.isFinite(b.x)) continue; const gn = PP.blockerGap(b, this._nx, this._nz), go = PP.blockerGap(b, this.x, this.z);
        const feet = this.y - EYE, top = Number.isFinite(b.top) ? this._baseY + b.top : Infinity, C = PP.PLAYER_CONSTANTS;
        if (feet >= top - (this.grounded && b.stand ? (C.DECOR_STEP ?? 0) : (C.PASS_TOL ?? 0))) continue;
        if (Number.isFinite(b.y0) && this.y + C.HEAD <= this._baseY + b.y0) continue;
        if (gn < R && !(go < R && gn > go)) { ev('decorBlock', {b:Number.isFinite(b.hx) ? {x:b.x, z:b.z, hx:b.hx, hz:b.hz, rot:b.rot, top:b.top} : {x:b.x, z:b.z, r:b.r, top:b.top}}); break; } }
    }
    return ok;
  };
  const kd = (type, code) => (document.body || document).dispatchEvent(new KeyboardEvent(type, {code, key:code === 'Space' ? ' ' : code, bubbles:true}));
  P.key = kd;
  const oPost = G.postStep;
  G.postStep = function (phys, deckY) {
    const r = oPost.call(this, phys, deckY);
    if (phys !== P.phys) return r;
    P.frames++;
    const au = P.auto; // screenshot driver: let go of the keys once on top (until) or freeze the clock mid pull-up (freeze)
    if (au) {
      const feet = phys.y - EYE - deckY, lp = typeof phys.ledgeProgress === 'function' ? phys.ledgeProgress() : -1;
      if (au.freeze != null && lp >= au.freeze) { window.__vt.step = 0; P.auto = null; kd('keyup', 'KeyW'); kd('keyup', 'Space'); }
      else if (au.until != null && phys.grounded && feet >= au.until) { kd('keyup', 'KeyW'); kd('keyup', 'Space'); P.auto = null; }
    }
    const rec = P.rec;
    if (rec) {
      rec.n++;
      if (rec.s.length < 2000) rec.s.push([+(phys.x).toFixed(3), +(phys.y - EYE - deckY).toFixed(3), +(phys.z).toFixed(3), phys.grounded ? 1 : 0, +phys.vy.toFixed(2), +Math.hypot(phys.vx, phys.vz).toFixed(2)]);
      const tr = P.trig;
      if (tr && tr.fired && !tr.up && P.frames - tr.fired >= 3) { tr.up = true; kd('keyup', 'Space'); }
      if (tr && !tr.fired) {
        const dist = phys.z - R - tr.front, sp = Math.hypot(phys.vx, phys.vz);
        if (dist <= sp * tr.rise + 0.02) { tr.fired = P.frames; tr.at = {dist:+dist.toFixed(3), speed:+sp.toFixed(2), feet:+(phys.y - EYE - deckY).toFixed(3)}; kd('keydown', 'Space'); }
      }
    }
    return r;
  };
  // Start spot: on the deck, facing yaw. Only used to line up in front of an object, never on it.
  P.start = (x, z, yaw) => {
    const p = P.phys; p.x = x; p.z = z; p.y = P.deckY + EYE; p.vx = p.vy = p.vz = 0; p.grounded = true; p.swimming = false;
    p._climb = null; p.climbing = false; p._jumpBuffer = 0; p._coyote = 0; window.raftDebug.aim(0, yaw);
  };
  // raft-local bounds (raft transform zeroed for one synchronous measurement, then restored)
  P.raft = () => { let r = null; P.scene?.traverse(o => { if (!r && o.userData && o.userData.tileKey !== undefined && o.parent) r = o.parent; }); return r; };
  P.measure = (decor, pieceGroups) => {
    const raft = P.raft(), bp = P.scene.getObjectByName('buildingPieces');
    const saved = [raft, bp].filter(Boolean).map(o => [o, o.position.clone(), o.rotation.clone(), o.quaternion.clone()]);
    for (const [o] of saved) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); }
    P.scene.updateMatrixWorld(true);
    const out = {decor:{}, pieces:{}};
    const visibleChain = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    const kids = raft ? raft.children.filter(c => c.userData.tileKey !== undefined) : [];
    for (const d of decor) {
      const g = kids.find(c => Math.abs(c.position.x - d.x * 2) < 1e-3 && Math.abs(c.position.z - d.z * 2) < 1e-3);
      if (!g) { out.decor[d.type] = null; continue; }
      const box = new T.Box3(), tmp = new T.Box3();
      g.traverse(o => { if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !visibleChain(o)) return; tmp.makeEmpty(); tmp.setFromObject(o, true); if (!tmp.isEmpty()) box.union(tmp); });
      const whole = new T.Box3().setFromObject(g, true);
      out.decor[d.type] = {mesh:box.isEmpty() ? null : [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], wholeGroup:whole.isEmpty() ? null : [whole.min.x, whole.min.y, whole.min.z, whole.max.x, whole.max.y, whole.max.z]};
    }
    if (bp) {
      const meshes = bp.children.filter(c => c.isInstancedMesh && c.name.startsWith('piece-'));
      const m4 = new T.Matrix4(), tmp = new T.Box3();
      for (const [name, recs] of Object.entries(pieceGroups)) {
        const box = new T.Box3();
        for (const p of recs) {
          const slot = P.BP.PIECES[p.t].slot, y = 0.2 + p.l * P.BP.LEVEL_H;
          const want = slot === 'edge' ? [p.r ? p.i * 2 - 1 : p.i * 2, y, p.r ? p.j * 2 : p.j * 2 - 1] : slot === 'corner' ? [p.i * 2 - 1, y, p.j * 2 - 1] : [p.i * 2, y, p.j * 2];
          for (const mesh of meshes) {
            const key = mesh.name.slice(6); if (key !== p.t && !key.startsWith(p.t)) continue;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            for (let i = 0; i < mesh.count; i++) {
              mesh.getMatrixAt(i, m4); const e = m4.elements;
              if (Math.abs(e[12] - want[0]) > 1e-3 || Math.abs(e[13] - want[1]) > 1e-3 || Math.abs(e[14] - want[2]) > 1e-3) continue;
              m4.premultiply(mesh.matrixWorld); tmp.copy(mesh.geometry.boundingBox).applyMatrix4(m4); box.union(tmp);
            }
          }
        }
        out.pieces[name] = box.isEmpty() ? null : [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
      }
    }
    for (const [o, p, r, q] of saved) { o.position.copy(p); o.quaternion.copy(q); }
    P.scene.updateMatrixWorld(true);
    return out;
  };
  // Collision boxes a set of pieces adds over its supports (y relative to the deck plane).
  P.pieceBoxes = (tiles, support, main) => {
    const boxes = recs => { const g = new P.BP.BuildGrid(); g.setTiles(tiles); g.load(recs); g._rebuild(); const o = [];
      for (const [arr, n, kind] of [[g._solid, g._solidN, 'solid'], [g._slabs, g._slabN, 'slab']]) for (let k = 0; k < n * 6; k += 6) o.push({kind, b:Array.from(arr.slice(k, k + 6)).map(v => +v.toFixed(3))}); return {o, placed:g.list.length}; };
    const a = boxes(support), b = boxes([...support, ...main]), seen = a.o.map(x => JSON.stringify(x));
    return {boxes:b.o.filter(x => !seen.includes(JSON.stringify(x))), placed:b.placed - a.placed};
  };
  // Walkable surface the build grid reports over (x, z) for feet a little above `top` (relative to deck).
  P.surfaceAt = (x, z, top) => {
    const g = P.grid; if (!g) return null;
    const d = g._deck, gr = g._grounded; g._deck = false; g._grounded = false;
    const s = g._scan(x, z, P.deckY + top + 0.05, P.deckY, -Infinity); g._deck = d; g._grounded = gr;
    return Number.isFinite(s) ? +(s - P.deckY).toFixed(3) : null;
  };
  P.blockersFor = (d) => { // the physics blockers game.js builds for this decor (decorBlockers + BLOCK_RADIUS), read back from a live frame
    return P.lastBlocked ? P.lastBlocked.filter(b => Math.hypot(b.x - d.x * 2, b.z - d.z * 2) < 1.2).map(b => ({...b})) : [];
  };
  const oUpd = PH.update;
  PH.update = function (dt, input) { if (this === P.phys && input && Array.isArray(input.blocked)) P.lastBlocked = input.blocked; return oUpd.call(this, dt, input); };
  P.enumerate = async () => {
    const base = window.__BASE_DECOR || [];
    return [...new Set([...base, ...P.CI.CONTENT_DECOR, ...P.IT.PLACEABLE_IDS])];
  };
  return true;
})()
"""

# Fixed-step game clock: the machine may render at 1-2 fps under software GL, and the game substeps real frame time
# (up to 0.25 s per frame), which would make take-off timing coarse. While __vt.on, performance.now() and the rAF
# timestamp advance exactly 1/20 s per rendered frame, so every trial plays at a steady 20 game fps (one 0.05 s physics step per frame).
VCLOCK_JS = r'''(() => {
  const realNow = performance.now.bind(performance), rRAF = window.requestAnimationFrame.bind(window);
  const V = window.__vt = {on:false, step:1000 / 20, t:0, start() { V.t = realNow(); V.on = true; }};
  performance.now = () => (V.on ? V.t : realNow());
  let lastTs = -1;
  window.requestAnimationFrame = cb => rRAF(ts => { if (V.on) { if (ts !== lastTs) { lastTs = ts; V.t += V.step; } cb(V.t); } else cb(ts); });
})();'''

def frames(page):
    return page.evaluate('__P.frames')

def wait_frames(page, n, until=None):
    t = frames(page) + n
    cond = f'__P.frames >= {t}' + (f' || ({until})' if until else '')
    page.wait_for_function(cond, polling=40, timeout=600000)

def boot(browser, save, w=960, h=540):
    ctx = browser.new_context(viewport={'width': w, 'height': h})
    ctx.add_init_script(VCLOCK_JS)
    ctx.add_init_script('localStorage.setItem("little-raft-v1",%s);window.__BASE_DECOR=%s;HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error("probe"))};'
                        % (json.dumps(json.dumps(save)), json.dumps(BASE_DECOR)))
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:300]))
    page.goto(URL); page.wait_for_function('!!window.raftDebug', timeout=90000)
    page.evaluate(PROBE_JS)
    page.evaluate("document.querySelector('#solo').click()")
    page.wait_for_function('raftDebug.state.running', timeout=30000)
    page.wait_for_function('window.__P.phys && window.__P.scene && window.__P.frames > 5', timeout=30000)
    page.evaluate('__vt.start(); __P.noRender = true')
    wait_frames(page, 10)
    return ctx, page, errs

def save_for(decor, pieces, inv=None):
    slots = inv or [{'kind': 'hook', 'count': 1, 'durability': 100}]
    slots = slots + [None] * (28 - len(slots))
    return {'tiles': TILES, 'decor': decor, 'pieces': pieces, 'stock': {}, 'fish': 0, 'collected': 1,
            'hostInventory': {'slots': slots, 'selected': 9 if not inv else 0},
            'vitals': {'hp': 100, 'food': 100, 'water': 100}}

def layout(names):
    decor, pieces, objs = [], [], []
    for name, (ci, cj) in zip(names, SLOTS):
        o = {'name': name, 'ci': ci, 'cj': cj}
        if name.startswith('piece:'):
            sp = piece_specs(ci, cj)[name]
            o.update(kind='piece', main=sp['main'], support=sp['support'], ax=sp['ax'], ramp=sp.get('ramp', False), climb=sp.get('climb', False), supportSolid=sp.get('supportSolid', False))
            pieces += sp['support'] + sp['main']
        else:
            o.update(kind='decor', type=name, ax=2 * ci)
            decor.append({'type': name, 'x': ci, 'z': cj})
        objs.append(o)
    return decor, pieces, objs

JUMP = {'v': 9.89, 'g': 20.0}  # replaced by the live PLAYER_CONSTANTS at enumerate time

def rise_time(h):
    v, g = JUMP['v'], JUMP['g']
    h = min(h, v * v / (2 * g) - 1e-3)
    return (v - math.sqrt(max(0.0, v * v - 2 * g * h))) / g

def analyse(page, o, mode, trial):
    s = trial['s']
    mb = o['meshLocal']  # raft-local, y includes deck 0.2
    if not mb:
        return {'outcome': 'no-mesh', 'maxFeet': max([r[1] for r in s] or [0])}
    x0, x1, z0, z1 = mb[0], mb[3], mb[2], mb[5]
    top = o['target']
    over = lambda r: x0 - 0.05 <= r[0] <= x1 + 0.05 and z0 - 0.05 <= r[2] <= z1 + 0.05
    maxFeet = max([r[1] for r in s] or [0])
    landed = any(r[3] and over(r) and r[1] >= max(top - 0.1, 0.08 if top >= 0.15 else -1) for r in s)
    wentOver = any(over(r) and r[1] >= top - 0.1 for r in s)
    entered = any(over(r) for r in s)
    evs = trial['ev']
    kinds = {}
    for e in evs: kinds.setdefault(e['k'], []).append(e)
    reasons = []
    if 'decorBlock' in kinds:
        b = kinds['decorBlock'][0]['b']; hf = max(e['feet'] for e in kinds['decorBlock'])
        shape = f"rect {2*b['hx']:.2f}x{2*b['hz']:.2f} m" if 'hx' in b else f"circle r={b['r']:.2f} m"
        hgt = f"top {b['top']:.2f} m" if b.get('top') is not None else 'no height: blocks at every feet height'
        reasons.append(f"side push: decor blocker ({shape}, {hgt}, seen up to feet {hf:.2f} m)")
    if 'headBump' in kinds:
        reasons.append(f"head bump x{len(kinds['headBump'])} ({kinds['headBump'][0]['tag']} underside)")
    if 'sidePush' in kinds:
        e = max(kinds['sidePush'], key=lambda e: e['feet'])
        tops = sorted({e2['boxTop'] for e2 in kinds['sidePush'] if e2['boxTop'] is not None})
        reasons.append(f"side push x{len(kinds['sidePush'])}: {e['tag']} box top {tops} m while feet up to {e['feet']:.2f} m (push applies while box top > feet + {'0.55 grounded' if e['grounded'] else '0.05 airborne'})")
    if 'sweepStop' in kinds: reasons.append(f"sweep stop x{len(kinds['sweepStop'])}")
    if 'clamberRefused' in kinds: reasons.append('auto clamber refused')
    if not o['surface'] and top >= 0.15:
        reasons.append('no walkable surface registered over the object (BuildGrid._scan / PlayerPhysics only know deck + floor/stairs/roof/hatch/ladder-top)')
    if maxFeet < top - 0.1: reasons.append(f'not high enough: max feet {maxFeet:.2f} < top {top:.2f}')
    inside = o['kind'] == 'decor' and top >= 0.3 and any(r[3] and over(r) and r[1] < top - 0.3 for r in s)
    if inside: reasons.insert(0, 'collider smaller than the mesh: the body stood on the deck inside the visible footprint')
    if wentOver and not landed and o['kind'] == 'piece' and not o['surface']: reasons.insert(0, 'went over the top (feet above it, centre over it) but nothing to stand on: no walkable surface registered')
    if top < 0.15 and not o['collision']:
        outcome = 'walk-over'  # flat (rug): no collision, nothing to land on
    else:
        outcome = 'landed' if landed else 'blocked(inside)' if inside else 'fell off' if wentOver else 'blocked'
    return {'outcome': outcome, 'maxFeet': round(maxFeet, 3), 'enteredFootprint': entered, 'reasons': [] if landed else reasons,
            'events': {k: len(v) for k, v in kinds.items()}, 'trigger': trial.get('trig'), 'track[x,feet,z,grounded,vy,speed]': s[::3]}

def run_trial(page, o, mode):
    front, ax, R = o['front'], o['ax'], 0.25
    page.evaluate(f"__P.start({ax}, {front + R + (0.06 if mode == 'standing' else 4.0)}, 0)")
    wait_frames(page, 6)
    page.evaluate('__P.rec = {n:0, s:[], ev:[]}; __P.trig = null')
    if mode == 'standing':
        low = o['target'] < 0.3  # a cushion-high top is walked onto (PlayerPhysics DECOR_STEP), a jump flies over it
        page.keyboard.down('KeyW')
        if not low: page.keyboard.down('Space'); wait_frames(page, 3); page.keyboard.up('Space')
        wait_frames(page, 30); page.keyboard.up('KeyW')
    else:
        page.evaluate(f"__P.trig = {{front:{front}, rise:{rise_time(o['target'] + 0.12):.4f}, fired:0}}")
        page.keyboard.down('ShiftLeft'); page.keyboard.down('KeyW')
        wait_frames(page, 60, '__P.trig.fired')
        wait_frames(page, 26)
        page.keyboard.up('KeyW'); page.keyboard.up('ShiftLeft')
    wait_frames(page, 10)
    return page.evaluate('(() => { const r = __P.rec; __P.rec = null; const t = __P.trig; __P.trig = null; if (t && t.fired && !t.up) __P.key("keyup", "Space"); return {s:r.s, ev:r.ev, trig:t ? (t.at || "not fired") : null}; })()')

def prep_objects(page, objs, decor):
    tiles = TILES
    meas = page.evaluate('([d, g]) => __P.measure(d, g)', [decor, {o['name']: o['main'] + (o['support'] if False else []) for o in objs if o['kind'] == 'piece'}])
    for o in objs:
        if o['kind'] == 'piece':
            pb = page.evaluate('([t, s, m]) => __P.pieceBoxes(t, s, m)', [tiles, o['support'], o['main']])
            o['collision'] = [{'kind': b['kind'], 'min': [b['b'][0], b['b'][1], b['b'][2]], 'max': [b['b'][3], b['b'][4], b['b'][5]]} for b in pb['boxes']]
            o['placed'] = pb['placed'] == len(o['main'])
            if o['ramp']:
                l = o['main'][0]['l']; base = l * 2.2; rise = 2.2 if o['main'][0]['t'] == 'stairs' else 1.0
                o['collision'].append({'kind': 'walkable ramp (BuildGrid._scan) + underside band (BuildGrid._ramps)', 'min': [2 * o['ci'] - 1, base, 2 * o['cj'] - 1], 'max': [2 * o['ci'] + 1, base + rise, 2 * o['cj'] + 1]})
            mb = meas['pieces'].get(o['name'])
        else:
            d = next(x for x in decor if x['type'] == o['type'])
            bl = page.evaluate('d => __P.blockersFor(d)', d)
            o['blockers'] = bl
            o['collision'] = []
            for b in bl:
                if 'hx' in b and b.get('hx') is not None:
                    c, s_ = abs(math.cos(b.get('rot') or 0)), abs(math.sin(b.get('rot') or 0))
                    ex, ez = b['hx'] * c + b['hz'] * s_, b['hx'] * s_ + b['hz'] * c
                else:
                    ex = ez = b['r']
                has_h = b.get('top') is not None
                o['collision'].append({'kind': ('decor-collider stand' if b.get('stand') else 'decor-collider block') if has_h else 'decor-blocker(2D)',
                                       'min': [b['x'] - ex, b.get('y0', 0) if has_h else None, b['z'] - ez], 'max': [b['x'] + ex, b['top'] if has_h else None, b['z'] + ez], 'shape': b})
            md = meas['decor'].get(o['type'])
            mb = md['mesh'] if md else None
            o['placed'] = md is not None
        o['meshLocal'] = mb
        o['mesh'] = None if not mb else {'min': [round(mb[0], 3), round(mb[1] - 0.2, 3), round(mb[2], 3)], 'max': [round(mb[3], 3), round(mb[4] - 0.2, 3), round(mb[5], 3)]}
        top = (mb[4] - 0.2) if mb else 0
        # landing target: flat objects their mesh top; ramps their low entry edge (stairs: any raised footing, roof: 2.2 m)
        if o['kind'] == 'piece' and o['name'].startswith('piece:stairs'): top = 0.3
        elif o['kind'] == 'piece' and o['name'].startswith('piece:roof'): top = 2.2
        elif o['kind'] == 'piece' and (o['name'].startswith('piece:floor') or o['name'].startswith('piece:hatch')): top = 2.2
        if o['kind'] == 'decor':
            st = [b['top'] for b in o.get('blockers', []) if b.get('stand') and b.get('top') is not None]
            o['stand'] = bool(st)
            if st: top = max(st)  # land on the collider's top (palm planter, hammock cloth), not the leaves / posts
        o['target'] = round(top, 3)
        # front face (the +z face the player runs at): collision when there is any, else mesh
        fz = [c['max'][2] for c in o['collision'] if c['max'][2] is not None]
        if o.get('supportSolid'):
            fz.append(2 * o['cj'] + 1 + 0.07)
        o['front'] = round(max(fz) if fz else (mb[5] if mb else 2 * o['cj']), 3)
        cx = (mb[0] + mb[3]) / 2 if mb else 2 * o['ci']; cz = (mb[2] + mb[5]) / 2 if mb else 2 * o['cj']
        if o['kind'] == 'piece' and o['name'] in ('piece:pillar',): cx, cz = 2 * o['ci'] - 1, 2 * o['cj'] - 1
        if o.get('ramp'): cx, cz, top_q = 2 * o['ci'], 2 * o['cj'] + 0.9, (top if top > 1 else 0.0)
        else: top_q = max(top, 0.0)
        o['surface'] = page.evaluate(f'__P.surfaceAt({cx}, {cz}, {top_q})')
        o['surface'] = o['surface'] is not None and o['surface'] > 0.05
        if o['kind'] == 'decor': o['surface'] = o['stand']  # decor tops are PlayerPhysics surfaces, not BuildGrid ones
        # bounds mismatch, raft-local, y relative to deck
        mism = []
        if mb and o['collision']:
            cmin = [min(c['min'][k] for c in o['collision'] if c['min'][k] is not None) if any(c['min'][k] is not None for c in o['collision']) else None for k in range(3)]
            cmax = [max(c['max'][k] for c in o['collision'] if c['max'][k] is not None) if any(c['max'][k] is not None for c in o['collision']) else None for k in range(3)]
            mm = o['mesh']
            for k, ax_ in enumerate('xyz'):
                for side, cv, mv in (('min', cmin[k], mm['min'][k]), ('max', cmax[k], mm['max'][k])):
                    if cv is None:
                        mism.append(f"{ax_}{side}: collision unbounded (infinite height) vs mesh {mv:.2f}")
                    elif abs(cv - mv) > 0.05:
                        mism.append(f"{ax_}{side}: collision {cv:.2f} vs mesh {mv:.2f} ({cv - mv:+.2f})")
            o['collisionBounds'] = {'min': cmin, 'max': cmax}
        elif mb and not o['collision']:
            mism.append('no collision at all (walk-through)')
        o['mismatch'] = mism

def expected_standable(o):
    if o['kind'] == 'piece':
        return not o['climb']  # every piece top is walkable now (walls, rails, pillars, door tops at the jambs)
    return bool(o.get('stand'))  # decor: the collider table decides (dist/decor-collision.js)

def gap(b, x, z):  # PlayerPhysics.blockerGap
    dx, dz = x - b['x'], z - b['z']
    if b.get('hx') is None: return math.hypot(dx, dz) - b['r']
    c, s_ = math.cos(b.get('rot') or 0), math.sin(b.get('rot') or 0)
    qx, qz = abs(dx * c - dz * s_) - b['hx'], abs(dx * s_ + dz * c) - b['hz']
    return math.hypot(max(qx, 0), max(qz, 0)) if qx > 0 or qz > 0 else max(qx, qz)

def penetration(o, s):
    # Deepest overlap of the body circle with a decor collider while the feet are below that collider's top.
    worst = 0.0
    for b in o.get('blockers', []):
        top = b.get('top')
        for r in s:
            if top is not None and r[1] >= top - 0.06: continue
            if (b.get('y0') or 0) > 0 and r[1] + 1.75 <= b['y0']: continue  # a raised part (glass box, boom) above the head
            worst = max(worst, 0.25 - gap(b, r[0], r[2]))
    return round(worst, 3)

def main():
    report = {'url': URL, 'errors': [], 'objects': [], 'shots': [], 'notes': [
        'Feet heights are metres above the deck plane (deckY). Mesh bounds come from THREE.Box3.setFromObject in the raft-local frame.',
        'Decor collision: PlayerPhysics blocked list entries; with a top (dist/decor-collision.js) they block only below it and standable tops are surfaces, without one (old build) they are full-height columns.',
        'penetration: deepest overlap (m) of the body circle with a decor collider while the feet were below its top (blocking decor must stay at 0).',
        'Start spots are set directly (in front of the object, on the deck, facing it); every move and jump after that is a key event through input.js/controls.js.',
        'Running jump: Shift+W from 4 m back; Space fires when the body front is speed*t_rise(target+0.12) from the object face (an ideally timed take-off).',
    ]}
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        except Exception:
            b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        if not args.no_shots:
            shoot(b, report)
        if args.shots_only:
            b.close(); srv.shutdown(); print(json.dumps(report['shots'])); return
        # enumerate decor from the live modules
        ctx, page, errs = boot(b, save_for([], []))
        decor_types = page.evaluate('__P.enumerate()')
        jc = page.evaluate('({v:__P.PP.PLAYER_CONSTANTS.JUMP_IMPULSE, g:__P.PP.PLAYER_CONSTANTS.GRAVITY})')
        JUMP.update(jc); report['jump'] = {'impulse': jc['v'], 'gravity': jc['g'], 'apex': round(jc['v'] ** 2 / (2 * jc['g']), 3)}
        report['enumerated'] = {'decorTypes': decor_types, 'pieces': PIECE_NAMES, 'baseDecorFromGameJs': BASE_DECOR}
        report['fps'] = page.evaluate("new Promise(r=>{let n=0,t0=performance.now();function f(){if(++n<30)requestAnimationFrame(f);else r(n/((performance.now()-t0)/1000))}requestAnimationFrame(f)})")
        ctx.close()
        names = PIECE_NAMES + [t for t in decor_types if t != 'net']
        report['skipped'] = [{'name': 'net', 'why': 'deck nets are migrated to raft-edge nets on load (cleanWorld), not a deck object'}]
        if args.only: names = [n for n in names if n in args.only.split(',')]
        for bi in range(0, len(names), len(SLOTS)):
            batch = names[bi:bi + len(SLOTS)]
            decor, pieces, objs = layout(batch)
            ctx, page, errs = boot(b, save_for(decor, pieces))
            prep_objects(page, objs, decor)
            for o in objs:
                if not o['placed']:
                    o['standing'] = o['running'] = {'outcome': 'not placed'}
                else:
                    for mode in ('standing', 'running'):
                        tr = run_trial(page, o, mode)
                        o[mode] = analyse(page, o, mode, tr)
                        if o['kind'] == 'decor': o[mode]['penetration'] = penetration(o, tr['s'])
                o['shouldStand'] = expected_standable(o)
                row = {k: o.get(k) for k in ('name', 'kind', 'target', 'front', 'surface', 'mesh', 'collision', 'collisionBounds', 'mismatch', 'standing', 'running', 'shouldStand', 'placed')}
                report['objects'].append(row)
                print(f"  {o['name']:<26} stand={o['standing']['outcome']:<10} run={o['running']['outcome']:<10} maxFeet={o['running'].get('maxFeet', 0)}", flush=True)
            report['errors'] += errs
            ctx.close()
        b.close()
    srv.shutdown()
    write(report)

def shoot(b, report):
    # Normal in-game HUD: a fresh solo session from the title, a hammer and a few items on the hotbar, no probe overlays.
    inv = [{'kind': 'hook', 'count': 1, 'durability': 100}, {'kind': 'hammer', 'count': 1, 'durability': 100},
           {'kind': 'wood', 'count': 14}, {'kind': 'plastic', 'count': 8}, {'kind': 'leaf', 'count': 6}]
    tiles = [[x, z] for x in range(-2, 3) for z in range(-2, 3)]
    decor = [{'type': 'crate', 'x': -1.4, 'z': 0}, {'type': 'maptable', 'x': 1.4, 'z': 0}]
    pieces = [{'t': 'wall', 'i': 0, 'j': -1, 'l': 0, 'r': 0}, {'t': 'wall', 'i': -1, 'j': -1, 'l': 0, 'r': 0}, {'t': 'wall', 'i': 1, 'j': -1, 'l': 0, 'r': 0}]
    save = {'tiles': tiles, 'decor': decor, 'pieces': pieces, 'stock': {}, 'fish': 0, 'collected': 1,
            'hostInventory': {'slots': inv + [None] * 23, 'selected': 0 if args.shot_prefix == 'before-' else 5}}  # after: an empty hand (no throw prompt under the crosshair)
    ctx = b.new_context(viewport={'width': 1536, 'height': 864})
    if args.shot_prefix != 'before-': ctx.add_init_script(VCLOCK_JS)
    ctx.add_init_script('localStorage.setItem("little-raft-v1",%s);localStorage.setItem("little-raft-hints",%s);window.__BASE_DECOR=[];'
                        % (json.dumps(json.dumps(save)), json.dumps(json.dumps(['look', 'walk', 'throw', 'pickup', 'build', 'inventory']))))
    page = ctx.new_page()
    page.goto(URL); page.wait_for_function('!!window.raftDebug', timeout=90000)
    page.evaluate(PROBE_JS)
    page.evaluate("document.querySelector('#solo').click()"); page.wait_for_function('raftDebug.state.running', timeout=30000)
    page.wait_for_function('window.__P.phys && window.__P.frames > 5', timeout=30000); page.wait_for_timeout(800)
    if args.shot_prefix != 'before-':
        shoot_after(page, report); ctx.close(); return
    # wall edge (0,-1,0) sits at z = -3; one tile (2 m) back from it is z = -1. Crate at x=-2.8 m, map table at x=+2.8 m.
    views = [('before-wall', 0.0, -1.0 + 0.0, 0.0, -0.05), ('before-chest', -2.8, 1.2, 0.0, -0.45), ('before-table', 2.8, 1.25, 0.0, -0.4)]
    for name, x, z, yaw, pitch in views:
        name = args.shot_prefix + name.split('-', 1)[1]
        page.evaluate(f'__P.start({x}, {z}, {yaw}); raftDebug.aim({pitch}, {yaw})')
        page.wait_for_timeout(900)
        path = shots_dir / f'{name}.png'; page.screenshot(path=str(path)); report['shots'].append(os.path.relpath(path, ROOT))
    ctx.close()

def shoot_after(page, report):
    # Get there through the real key path (W + Space from the deck in front of it), then look around and shoot.
    # Wall line z = -3 (face z = -2.93); crate at x = -2.8 (front z = 0.42); map table at x = 2.8 (front z = 0.40).
    page.evaluate('__vt.start()')
    views = [  # name, start x, z, yaw, until feet / freeze progress, view pitch, view yaw
        ('wall', 0.0, -2.62, 0.0, {'until': 2.0}, -0.55, 0.9),
        ('chest', -2.8, 0.75, 0.0, {'until': 0.6}, -0.95, 0.8),  # looking down past the feet at the crate top, away from the wall
        ('table', 2.8, 0.75, 0.0, {'until': 0.6}, -0.95, -0.8),
        ('clamber', -1.2, -2.62, 0.0, {'freeze': 0.12}, -1.1, 0.0),  # frozen mid pull-up, looking at the wall top
    ]
    for name, x, z, yaw, auto, pitch, vyaw in views:
        page.evaluate(f'__vt.step = 50; __P.start({x}, {z}, {yaw}); raftDebug.aim(-0.1, {yaw})')
        wait_frames(page, 6)
        page.evaluate(f'__P.auto = {json.dumps(auto)}')
        page.keyboard.down('KeyW'); page.keyboard.down('Space')
        wait_frames(page, 2); page.keyboard.up('Space')
        page.wait_for_function('__P.auto === null', polling=100, timeout=300000)
        page.keyboard.up('KeyW')
        if pitch is not None:
            if 'freeze' not in auto: wait_frames(page, 4)  # a frozen clock steps no physics frames
            page.evaluate(f'raftDebug.aim({pitch}, {vyaw})')
        page.wait_for_timeout(1500)
        p = page.evaluate('({feet:+(__P.phys.y - 1.6 - __P.deckY).toFixed(3), grounded:__P.phys.grounded, climbing:__P.phys.climbing})')
        path = shots_dir / f'{args.shot_prefix}{name}.png'; page.screenshot(path=str(path))
        report['shots'].append({'file': os.path.relpath(path, ROOT), **p})
        print('  shot', name, p, flush=True)
    page.evaluate('__vt.step = 50')
    # On the deck one tile (2 m) back from the full wall line (z = -3), facing it, eyes level (same spot as before-wall).
    page.evaluate('__P.start(0.0, -1.0, 0.0); raftDebug.aim(-0.05, 0.0)')
    page.wait_for_timeout(1500)
    p = page.evaluate('({feet:+(__P.phys.y - 1.6 - __P.deckY).toFixed(3), grounded:__P.phys.grounded, climbing:__P.phys.climbing})')
    path = shots_dir / f'{args.shot_prefix}nextwall.png'; page.screenshot(path=str(path))
    report['shots'].append({'file': os.path.relpath(path, ROOT), **p})
    print('  shot nextwall', p, flush=True)

def write(report):
    objs = report['objects']
    def cell(o, m):
        r = o.get(m) or {}
        return f"{r.get('outcome', '-')}({r.get('maxFeet', 0):.2f})"
    print()
    print(f"{'object':<26} {'top':>5} {'surf':>4} {'stand?':>6}  {'standing jump':<18} {'running jump':<18} reason (first, when not landed)")
    print('-' * 140)
    for o in objs:
        r = o.get('running') or {}; s = o.get('standing') or {}
        reason = (r.get('reasons') or s.get('reasons') or [''])[0]
        print(f"{o['name']:<26} {o['target']:>5.2f} {'yes' if o['surface'] else 'no':>4} {'yes' if o['shouldStand'] else 'no':>6}  {cell(o, 'standing'):<18} {cell(o, 'running'):<18} {reason[:90]}")
    print('\nBounds mismatches > 5 cm (collision vs visible mesh, raft-local, y from deck):')
    for o in objs:
        if o['mismatch']: print(f"  {o['name']:<26} " + '; '.join(o['mismatch']))
    fails = [o['name'] for o in objs if o['shouldStand'] and not any((o.get(m) or {}).get('outcome') == 'landed' for m in ('standing', 'running'))]
    # Blocking decor: the body circle never inside its collider (2 cm slack for the push-out) below its top.
    inside = [o['name'] for o in objs if o['kind'] == 'decor' and not o['shouldStand'] and o['collision']
              and any(((o.get(m) or {}).get('penetration') or 0) > 0.02 for m in ('standing', 'running'))]
    print('\nBlocking decor the body got inside below its top:', inside or 'none')
    report['summary'] = {'objects': len(objs), 'shouldStand': sum(1 for o in objs if o['shouldStand']),
                         'landedAny': [o['name'] for o in objs if any((o.get(m) or {}).get('outcome') == 'landed' for m in ('standing', 'running'))],
                         'shouldStandButNotLanded': fails, 'blockerPenetrated': inside}
    fails = fails + inside
    out_json.write_text(json.dumps(report, indent=1, default=str))
    print(f"\n{len(report['summary']['shouldStandButNotLanded'])} of {report['summary']['shouldStand']} objects that should be standable were not landed on. JSON: {out_json}")
    if report['errors']: print('page errors:', report['errors'][:5])
    sys.exit(1 if args.strict and fails else 0)

if __name__ == '__main__':
    main()
