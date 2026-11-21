// Biofuel Refiner + Fuel Tank content module (docs/specs/biofuel.md §5). Slice: world.ext.biofuel.
// Host-authoritative actions 'bio.*'. The refiner turns organic scraps into Biofuel Jugs (no wood, no fire);
// the fuel tank stores jugs and, once a second on the host, pours a whole jug into each running Little Motor
// next to it (engine.pour). Motor fuel itself stays only in ext.engine. Pure rules live in biofuel-core.js.
import { BIO, ORGANIC, NAMES, keyOf, blank, cleanSlice, sliceOf, stepAll, progress, applyBioAction, topUp, refundBiofuel } from './biofuel-core.js?build=v3-survival-ae77fa84ac2b';
import { buildRefiner, buildTank, BULB } from './biofuel-model.js?build=v3-survival-ae77fa84ac2b';

export const OLD_HOST = 'Your friend’s raft doesn’t have a biofuel refiner yet';
const MAX_SHOWN = 164;
const NEAR2 = 14 * 14; // bubbles animate only within 14 m of the player (raft-local, squared)
const jugs = n => n + (n === 1 ? ' jug' : ' jugs');

export function createBiofuel(ctx, peer) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanSlice(undefined); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHas = true;
  let refModel = null, tankModel = null, dirty = false, childCount = -1, firstChild = null;
  let clock = 0, tick = 0;
  let pKey = null, pR = -1, pSel = null, pCnt = -1, pPct = -1, pSt = null, pOld = false, pOut = null;
  const groups = new Array(MAX_SHOWN).fill(null), gKeys = new Array(MAX_SHOWN).fill(null), gTank = new Array(MAX_SHOWN).fill(false);
  let shown = 0;
  const scratch = T ? new T.Vector3() : null;
  const BLANK = Object.freeze(blank());

  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const posOf = actor => { if (actor === 'guest') return ctx.other ?? null; const p = ctx.physics; return p ? { x: p.x, z: p.z } : null; };
  const env = { decorAt, pos: posOf };
  const host = () => ctx.role !== 'guest';
  const oldHost = () => ctx.role === 'guest' && !hostHas;
  const held = () => { const b = ctx.localBag?.(); const s = b && b.slots ? b.slots[b.selectedIndex] : null; return s ? s : null; };

  // Nearest refiner / tank along the view ray (or the camera forward when no aim), within reach.
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || (d.type !== 'refiner' && d.type !== 'fueltank')) continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > BIO.REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + (d.type === 'refiner' ? .7 : .5);
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = sliceOf(st); cacheSt = st; cacheR = st.r;
    return cache;
  }
  function load(data, from) {
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHas = data !== undefined;
      st = cleanSlice(data); dirty = true;
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHas = true;
    st = cleanSlice(data, decorAt); st.s = session; st.r++; dirty = true;
  }

  // ---- visuals (every role, local clock, never synced)
  function rescan() {
    shown = 0;
    const raft = ctx.raft; if (!raft) return;
    for (let c = 0; c < raft.children.length && shown < MAX_SHOWN; c++) {
      const g = raft.children[c]; if (!g.userData?.bio || (g.name !== 'bio_refiner' && g.name !== 'bio_tank')) continue;
      groups[shown] = g; gTank[shown] = g.name === 'bio_tank';
      gKeys[shown] = keyOf(Math.round(g.position.x / 2), Math.round(g.position.z / 2)); shown++;
    }
    for (let i = shown; i < MAX_SHOWN; i++) { groups[i] = null; gKeys[i] = null; }
  }
  const ease = (cur, goal, rate, dt) => { const d = goal - cur; const s = rate * dt; return Math.abs(d) <= s ? goal : cur + Math.sign(d) * s; };
  function visuals(dt) {
    const raft = ctx.raft; if (!raft || (!refModel && !tankModel)) return;
    if (dirty || raft.children.length !== childCount || raft.children[0] !== firstChild) {
      rescan(); childCount = raft.children.length; firstChild = raft.children[0] ?? null; dirty = false;
    }
    const d = dt > 0 && dt < 1 ? dt : 0;
    clock += d;
    const old = oldHost(), p = ctx.physics, px = p ? p.x : 0, pz = p ? p.z : 0;
    for (let i = 0; i < shown; i++) {
      const g = groups[i], b = g.userData.bio;
      if (gTank[i]) {
        const goal = old ? 0 : (st.k[gKeys[i]] ?? 0) / BIO.TANK, cur = b.cur ?? goal;
        if (b.cur === undefined || cur !== goal) {
          b.cur = b.cur === undefined ? goal : ease(cur, goal, 2, d);
          b.level.visible = b.cur > .002; b.level.scale.y = Math.max(.001, b.cur);
        }
        continue;
      }
      const e = old ? BLANK : st.f[gKeys[i]] ?? BLANK;
      if (b.n !== e.n) { b.n = e.n; for (let j = 0; j < b.jugs.length; j++) b.jugs[j].visible = j < e.n; }
      const goal = .15 + .85 * progress(e), cur = b.cur ?? goal;
      if (b.cur === undefined || cur !== goal) { b.cur = b.cur === undefined || goal < cur - .3 ? goal : ease(cur, goal, .6, d); b.liquid.scale.y = b.cur; }
      const ddx = g.position.x - px, ddz = g.position.z - pz;
      const busy = e.q > 0 && e.n < BIO.TRAY && (!p || ddx * ddx + ddz * ddz <= NEAR2); // review: far refiners skip the bubble work
      if (busy || b.bub) {
        b.bub = busy;
        for (let j = 0; j < b.bubbles.length; j++) {
          const m = b.bubbles[j]; m.visible = busy; if (!busy) continue;
          const ph = (clock * .7 + j / 3 + i * .13) % 1;
          m.position.y = BULB.y - .08 + ph * .16;
          m.position.x = BULB.x + (j - 1) * .035 + .01 * Math.sin(clock * 5 + j);
        }
      }
    }
  }

  function prune() {
    let cut = false;
    for (const key in st.f) { const c = key.indexOf(','); if (decorAt(+key.slice(0, c), +key.slice(c + 1)) !== 'refiner') { delete st.f[key]; cut = true; } }
    for (const key in st.k) { const c = key.indexOf(','); if (decorAt(+key.slice(0, c), +key.slice(c + 1)) !== 'fueltank') { delete st.k[key]; cut = true; } }
    if (cut) st.r++;
  }
  function update(dt) {
    if (host() && ctx.running) {
      if (stepAll(st, dt)) st.r++;
      tick += dt > 0 ? dt : 0;
      if (tick >= 1) {
        tick = tick >= 2 ? 0 : tick - 1;
        prune();
        try {
          const eng = peer?.peek?.('engine') ?? null;
          topUp(st, decor(), eng ?? {}, (x, z, s) => peer?.('engine')?.pour?.(x, z, s) ?? 0);
        } catch (err) { console.error('biofuel top-up failed', err); }
      }
    }
    visuals(dt);
  }

  function prompt(aim) {
    const d = target(aim); if (!d) return null;
    const old = oldHost();
    if (old) return OLD_HOST;
    const key = keyOf(d.x, d.z), tank = d.type === 'fueltank', s = held(), sel = s ? s.kind : null, cnt = s ? s.count : 0;
    const e = tank ? BLANK : st.f[key] ?? BLANK, pct = tank ? 0 : Math.round(progress(e) * 100);
    if (pOut !== null && key === pKey && st.r === pR && sel === pSel && cnt === pCnt && pct === pPct && st === pSt && old === pOld) return pOut;
    const esc = ctx.esc ?? (x => String(x));
    let out;
    if (tank) {
      const k = st.k[key] ?? 0;
      if (sel === 'biofuel' && k < BIO.TANK) out = `<kbd>E</kbd>${esc(`Pour in ${jugs(Math.min(cnt, BIO.TANK - k))} · ${k}/${BIO.TANK}`)}`;
      else if (sel === 'biofuel') out = esc(`Fuel Tank · full ${k}/${BIO.TANK} · feeds motors next to it`);
      else if (k > 0) out = `<kbd>E</kbd>${esc(`Take ${jugs(k)} · ${k}/${BIO.TANK} · feeds motors next to it`)}`;
      else out = esc('Fuel Tank · empty');
    } else {
      const parts = [];
      if (e.q > 0) parts.push(`${e.q} queued ${pct}%`);
      if (e.n > 0) parts.push(`${e.n} ready`);
      const tail = parts.length ? ' · ' + parts.join(' · ') : '';
      if (sel && ORGANIC[sel] && Object.prototype.hasOwnProperty.call(ORGANIC, sel)) {
        out = e.q >= BIO.QUEUE ? esc(`Biofuel Refiner · full${tail}`) : `<kbd>E</kbd>${esc(`Load ${ORGANIC[sel]} ${NAMES[sel]}${tail}`)}`;
      } else if (e.n > 0) out = `<kbd>E</kbd>${esc(`Take ${e.n} Biofuel Jug${e.n === 1 ? '' : 's'}${e.q > 0 ? ` · ${e.q} queued ${pct}%` : ''}`)}`;
      else out = esc(`Biofuel Refiner · hold leaves or fish${tail}`);
    }
    pOut = out; pKey = key; pR = st.r; pSel = sel; pCnt = cnt; pPct = pct; pSt = st; pOld = old;
    return pOut;
  }

  function interact(aim) {
    const d = target(aim); if (!d) return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    const s = held(), sel = s ? s.kind : null;
    if (d.type === 'refiner') {
      const e = st.f[keyOf(d.x, d.z)];
      if (sel && Object.prototype.hasOwnProperty.call(ORGANIC, sel)) ctx.action({ kind: 'bio.load', x: d.x, z: d.z, item: sel });
      else if (e && e.n > 0) ctx.action({ kind: 'bio.take', x: d.x, z: d.z });
      else ctx.notice?.('Hold leaves, seaweed, fish or fruit to refine');
      return true;
    }
    const k = st.k[keyOf(d.x, d.z)] ?? 0;
    if (sel === 'biofuel') ctx.action({ kind: 'bio.fill', x: d.x, z: d.z });
    else if (k > 0) ctx.action({ kind: 'bio.empty', x: d.x, z: d.z });
    else ctx.notice?.('Hold Biofuel Jugs to fill the tank');
    return true;
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('bio.')) return false;
    const r = applyBioAction(st, a, actor, bag ?? ctx.actorBag?.(actor), env);
    if (r.ok) ctx.emit({ kind: a.kind === 'bio.take' || a.kind === 'bio.empty' ? 'loot' : 'build', text: r.text }, actor);
    else ctx.emit({ kind: r.reason === 'bagfull' ? 'full' : 'notice', text: r.text }, actor);
    return true;
  }

  const okXZ = (x, z) => Number.isInteger(x) && Number.isInteger(z) && Math.abs(x) <= 25 && Math.abs(z) <= 25;
  const debug = {
    state: () => JSON.parse(JSON.stringify(sliceOf(st))),
    place(type, x = 1, z = 0) {
      const w = ctx.world;
      if (!host() || (type !== 'refiner' && type !== 'fueltank') || !okXZ(x, z) || !w) return false;
      if (!w.tiles.some(t => t[0] === x && t[1] === z) || w.decor.some(d => d.x === x && d.z === z)) return false;
      w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); dirty = true; return true;
    },
    jugs(x, z, n) {
      if (!host() || decorAt(x, z) !== 'fueltank' || !Number.isInteger(n)) return false;
      const k = Math.max(0, Math.min(BIO.TANK, n));
      if (k) st.k[keyOf(x, z)] = k; else delete st.k[keyOf(x, z)];
      st.r++; return true;
    },
    fast(sec) {
      if (!host() || !Number.isFinite(sec) || sec <= 0) return false;
      for (let n = Math.min(3600, sec); n > 0; n -= 1) stepAll(st, Math.min(1, n));
      st.r++; return true;
    },
    give(kind, n = 10) { if (!host()) return false; const b = ctx.localBag?.(); return b ? n - b.add(kind, n) : 0; },
    clear() { if (!host()) return false; st.f = {}; st.k = {}; st.r++; return true; },
  };

  return {
    name: 'biofuel',
    serialize, load, action, interact, prompt, update, debug,
    // Review (item loss): game.js has no decor removal today (the hammer removes pieces only; a shark-broken tile takes
    // its decor and contents, like chests). Any future removal must call this in the same host action: null = removed
    // stock refunded (or nothing stored), a string = refuse the removal and show it. Host only; guests always refuse.
    beforeRemove(type, x, z, actor, bag) {
      if (type !== 'refiner' && type !== 'fueltank') return null;
      if (!host()) return 'Ask the host to do that';
      const r = refundBiofuel(st, keyOf(x, z), bag ?? ctx.actorBag?.(actor));
      if (r.ok && r.n > 0) ctx.emit?.({ kind: 'loot', text: r.text }, actor);
      return r.ok ? null : r.text;
    },
    decorModel(type) {
      if (!T) return null;
      if (type === 'refiner') { refModel ??= buildRefiner(T); dirty = true; return refModel.instance(); }
      if (type === 'fueltank') { tankModel ??= buildTank(T); dirty = true; return tankModel.instance(); }
      return null;
    },
    dispose() { refModel?.dispose(); tankModel?.dispose(); refModel = tankModel = null; shown = 0; groups.fill(null); },
  };
}
