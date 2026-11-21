// [musicbox] Wind-up Music Box decor (docs/specs/musicbox.md). Content module 'musicbox'.
// Slice world.ext.musicbox = {v:1, r, b:{"x,z":{on, t, s}}}: s is the start time in daynight clock seconds, so both
// peers derive the same bar from the shared clock and no notes ever cross the network. Only the nearest box that is
// on plays locally; its notes are scheduled ~.15 s ahead in AudioContext time (no timers), and the clock only places
// the anchor. Every box that is on turns its cylinder from the shared clock.
import { STORM_LIVE } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { TUNES, TUNE_COUNT, HEAR_MAX, SWITCH_HYST, LOOKAHEAD, DRIFT_MAX, JUMP_MAX, compose, phaseAt, windowNotes, boxGain,
  cleanBoxes, applySet, boxKeys, tileKey } from './musicbox-core.js?build=v3-survival-ae77fa84ac2b';
import { buildMusicBox, disposeMusicBox } from './musicbox-model.js?build=v3-survival-ae77fa84ac2b';

export const REACH = 2.6, LID_OPEN = -1.75, DOUBLE_E = 1, NOTICE_AFTER = 3;
const GLYPH_MAX = 4, GLYPH_LIFE = 1.2, GLYPH_RISE = 0.3, GLYPH_TINT = '#ffbd66';
const OLD_HOST = "The host's game is older, so music boxes stay quiet here.";
const TAU = Math.PI * 2, EPS = 1e-6;
const mod = (a, n) => ((a % n) + n) % n;

function glyphTexture(T) {
  let c = null;
  try {
    if (typeof document !== 'undefined' && document.createElement) c = document.createElement('canvas');
    else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(64, 64);
  } catch { c = null; }
  const g = c?.getContext?.('2d');
  if (!g) return null;
  c.width = 64; c.height = 64;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.ellipse(24, 46, 10, 7.5, -0.4, 0, Math.PI * 2); g.fill();          // an eighth note
  g.lineWidth = 5; g.beginPath(); g.moveTo(33, 44); g.lineTo(33, 10); g.quadraticCurveTo(38, 22, 50, 26); g.stroke();
  const t = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
  return t;
}

export function createMusicBox(ctx) {
  const T = ctx.T;
  let st = cleanBoxes(undefined), rev = 0, netSig = null, sawSlice = false, noticeAt = 0, noticed = false, scheduled = 0, disposed = false;
  const models = new Map();                       // key -> model group
  const sched = { key: null, tune: -1, s: NaN, anchor: NaN, cursor: NaN, checkAt: 0, bar: -1, prevMax: -Infinity };
  const buf = [];                                 // windowNotes output, reused
  let onList = [], onRev = -1;                    // [{key, x, z}] boxes that are on, rebuilt when rev changes
  let last = null, pendingStop = null;            // last E {key, at, t}; delayed stop {key, at, t}
  let aud = null;                                 // {key, d} audible box this frame
  const audOut = { key: null, d: Infinity };
  const v1 = T ? new T.Vector3() : null, v2 = T ? new T.Vector3() : null;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const clockNow = () => (STORM_LIVE.ready && Number.isFinite(STORM_LIVE.clock) ? STORM_LIVE.clock : null);
  const entry = key => (Object.prototype.hasOwnProperty.call(st.b, key) ? st.b[key] : null);

  // ---------------------------------------------------------------- glyph sprites (view only)
  let glyphTex = null, glyphTried = false;
  const glyphs = [], gfree = [];                  // {sprite, mat, age, key}
  function spawnGlyph(key) {
    if (!T || !ctx.scene) return;
    if (!glyphTried) { glyphTried = true; glyphTex = glyphTexture(T); }
    if (!glyphTex) return;
    let f = null;
    if (glyphs.length >= GLYPH_MAX) f = glyphs.shift();
    else if (gfree.length) { f = gfree.pop(); ctx.scene.add(f.sprite); }
    else {
      const mat = new T.SpriteMaterial({ map: glyphTex, color: GLYPH_TINT, transparent: true, depthWrite: false, opacity: 0.9 });
      const sprite = new T.Sprite(mat); sprite.name = 'musicboxNote'; sprite.raycast = () => {}; sprite.renderOrder = 25; sprite.scale.setScalar(0.12);
      f = { sprite, mat, age: 0, key: null };
      ctx.scene.add(sprite);
    }
    f.age = 0; f.key = key; f.sprite.visible = true; f.mat.opacity = 0.9;
    glyphs.push(f);
  }
  function updateGlyphs(dt) {
    for (let i = glyphs.length - 1; i >= 0; i--) {
      const f = glyphs[i], g = models.get(f.key);
      f.age += dt;
      if (f.age >= GLYPH_LIFE || !g || !g.parent) { f.sprite.visible = false; f.sprite.parent?.remove(f.sprite); glyphs.splice(i, 1); gfree.push(f); continue; }
      const k = f.age / GLYPH_LIFE;
      g.getWorldPosition(v2);
      f.sprite.position.set(v2.x + Math.sin(k * 5 + i) * 0.03, v2.y + 0.28 + k * GLYPH_RISE, v2.z);
      f.mat.opacity = 0.9 * (1 - k);
    }
  }

  // ---------------------------------------------------------------- targeting (photo-frame.js pattern)
  function target(aim) {
    const w = ctx.world, p = ctx.physics, c = ctx.camera; if (!w || !p || !c || !Array.isArray(w.decor) || !v1) return null;
    let best = null, bestScore = Infinity;
    const ox = c.position.x, oy = c.position.y, oz = c.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; } else { c.getWorldDirection(v1); dx = v1.x; dy = v1.y; dz = v1.z; }
    const cy = (ctx.raft?.position.y ?? 0) + 0.4;
    for (const d of w.decor) {
      if (!d || d.type !== 'musicbox') continue;
      const cx = d.x * 2, cz = d.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > 0.6) continue;
      const score = off + along * 0.05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  // ---------------------------------------------------------------- actions
  function send(a) {
    if (ctx.role === 'guest' && !noticeAt) noticeAt = (ctx.elapsed ?? 0) + NOTICE_AFTER;
    try { ctx.action(a); } catch {}
  }
  const set = (key, on, t) => send({ kind: 'musicbox:set', key, on, t });

  function resetSched() { sched.key = null; sched.tune = -1; sched.s = NaN; sched.anchor = NaN; sched.cursor = NaN; sched.checkAt = 0; sched.bar = -1; sched.prevMax = -Infinity; }

  // ---------------------------------------------------------------- audible box
  function rebuildOn() {
    onRev = rev; onList = [];
    for (const k of Object.keys(st.b)) if (st.b[k].on === 1) { const [x, z] = k.split(',').map(Number); onList.push({ key: k, x, z }); }
  }
  function pickAudible() {
    if (onRev !== rev) rebuildOn();
    const p = ctx.physics;
    if (!p || !onList.length) return null;
    let cand = null, cd = Infinity, curD = Infinity;
    for (let i = 0; i < onList.length; i++) {
      const b = onList[i], d = Math.hypot(p.x - b.x * 2, p.z - b.z * 2);
      if (b.key === sched.key) curD = d;
      if (d < HEAR_MAX && d < cd) { cd = d; cand = b.key; }
    }
    if (sched.key !== null && curD < HEAR_MAX && !(cd < curD - SWITCH_HYST)) { audOut.key = sched.key; audOut.d = curD; return audOut; }
    if (cand === null) return null;
    audOut.key = cand; audOut.d = cd; return audOut;
  }

  // toBar: a re-anchor starts at the next bar line after anything already queued, so no note is struck twice
  function anchorAt(now, ph, tune, toBar) {
    const lead = toBar && Number.isFinite(sched.cursor) ? Math.max(0, sched.cursor - now) : 0;
    sched.anchor = now - ph;
    const unit = toBar ? tune.bar : tune.step;
    const k = Math.ceil((ph + lead) / unit - 1e-6) * unit;      // next step (or bar line) at or after this phase
    sched.cursor = now + (k - ph);
    sched.checkAt = now + tune.bar;
  }

  function schedule(clock) {
    const now = typeof ctx.audioNow === 'function' ? ctx.audioNow() : null;
    const music = ctx.options?.music ?? 0.7;
    if (!aud || clock === null || now === null || !Number.isFinite(now) || !(music > 0)) { sched.cursor = NaN; sched.anchor = NaN; sched.prevMax = -Infinity; return; }
    const e = entry(aud.key); if (!e) return;
    const tune = compose(e.t), loop = tune.loop, ph = phaseAt(clock, e.s, loop);
    if (!Number.isFinite(sched.anchor) || !Number.isFinite(sched.cursor)) anchorAt(now, ph, tune, false);
    else {
      let err = mod(now - sched.anchor, loop) - ph;
      if (err > loop / 2) err -= loop; else if (err < -loop / 2) err += loop;
      let re = Math.abs(err) > JUMP_MAX || now - sched.cursor > JUMP_MAX;
      if (!re && now >= sched.checkAt) { sched.checkAt = now + tune.bar; re = Math.abs(err) > DRIFT_MAX; }
      if (re) anchorAt(now, ph, tune, true);                     // skip to the next bar line: a short rest, never a burst
    }
    const end = now + LOOKAHEAD;
    if (sched.cursor < end) {
      // the window starts EPS early so float error at the seam never drops a note; prevMax drops the overlap
      const from = sched.cursor - EPS, n = windowNotes(tune, mod(from - sched.anchor, loop), end - from, buf), gain = boxGain(aud.d);
      let max = sched.prevMax;
      for (let i = 0; i < n; i++) {
        const c = buf[i], at = from + c.dt;
        if (at <= sched.prevMax + EPS) continue;
        if (at > max) max = at;
        if (ctx.box?.(c.n.hz, at < now ? now : at, c.n.g * gain)) scheduled++;
      }
      sched.prevMax = max; sched.cursor = end;
    }
  }

  // ---------------------------------------------------------------- per-frame view
  let animDt = 0, animClock = null;
  function animate(g, key) {
    const e = entry(key), on = !!e && e.on === 1, u = g.userData;
    if (!u?.lidPivot) return;
    const lid = u.lidPivot.rotation, goal = on ? LID_OPEN : 0;
    lid.x += (goal - lid.x) * (1 - Math.exp(-6 * animDt));
    if (on && animClock !== null) {
      const tune = compose(e.t), a = phaseAt(animClock, e.s, tune.loop) / tune.loop * TAU * tune.bars / 4;
      u.cylinder.rotation.x = a; u.crank.rotation.x = a;
    }
  }
  const pruneOrAnimate = (g, key) => { if (!g.parent) models.delete(key); else animate(g, key); };

  function update(dt) {
    if (disposed) return;
    const el = ctx.elapsed ?? 0, clock = clockNow();
    if (pendingStop && el >= pendingStop.at) {
      const p = pendingStop; pendingStop = null;
      const e = entry(p.key); if (e && e.on === 1) set(p.key, 0, e.t);
    }
    if (noticeAt && !sawSlice && !noticed && el >= noticeAt) { noticed = true; try { ctx.notice?.(OLD_HOST); } catch {} }
    // audible box: switch (and reset the scheduler) when the box, its tune or its start changes
    aud = pickAudible();
    if (aud) {
      const e = entry(aud.key);
      if (aud.key !== sched.key || e.t !== sched.tune || e.s !== sched.s) { resetSched(); sched.key = aud.key; sched.tune = e.t; sched.s = e.s; }
    } else if (sched.key !== null) resetSched();
    schedule(clock);
    // glyph on each bar line of the audible box
    if (aud && clock !== null) {
      const e = entry(aud.key), tune = compose(e.t), b = Math.floor(phaseAt(clock, e.s, tune.loop) / tune.bar);
      if (b !== sched.bar) { if (sched.bar !== -1) spawnGlyph(aud.key); sched.bar = b; }
    }
    animDt = dt > 0 ? dt : 0; animClock = clock;
    models.forEach(pruneOrAnimate);
    if (glyphs.length) updateGlyphs(animDt);
  }

  // ---------------------------------------------------------------- slice
  function load(data, from) {
    if (from === 'net') {
      if (data !== undefined) sawSlice = true;
      const sig = data === undefined ? '' : JSON.stringify(data);
      if (sig === netSig) return;
      netSig = sig;
    } else netSig = null;
    st = cleanBoxes(data, ctx.world?.decor); rev++;
  }
  let serCache = null, serRev = -1, serDecor = null;
  function serialize() {
    const d = decor(), sig = [...boxKeys(d)].join(';');
    if (serCache && serRev === rev && serDecor === sig) return serCache;
    const clean = cleanBoxes(st, d);
    if (Object.keys(clean.b).length !== Object.keys(st.b).length) { st = clean; rev++; }
    st.r = rev;
    serCache = JSON.parse(JSON.stringify(st)); serRev = rev; serDecor = sig;
    return serCache;
  }

  // ---------------------------------------------------------------- prompt
  function promptFor(c) {
    const s = c?.state;
    if (!s || s.pickup || s.swimming || ctx.uiOpen?.()) return null;
    const t = target(null); if (!t) return null;
    const e = entry(t.key), name = TUNES[e?.t ?? 0].name, on = e?.on === 1 && !(pendingStop && pendingStop.key === t.key);
    return [{ key: 'E', label: (on ? 'Stop · ♪ ' : 'Play · ') + name }, { label: 'E twice or right-click: next tune', muted: true }];
  }
  let unprompt = null;
  try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'musicbox', priority: 2, prompt: promptFor }) ?? null; } catch { unprompt = null; }

  // ---------------------------------------------------------------- host helpers (debug)
  const firstKey = () => { const k = [...boxKeys(decor())][0]; return k ?? null; };
  function hostSet(key, on, t) {
    if (ctx.role === 'guest') return false;
    key = key ?? firstKey(); if (!key) return false;
    const ok = applySet(st, decor(), { kind: 'musicbox:set', key, on, t }, clockNow() ?? 0);
    if (ok) rev++;
    return ok;
  }

  return {
    name: 'musicbox',
    load, serialize, update,
    interact(aim) {
      const t = target(aim); if (!t) return false;
      const el = ctx.elapsed ?? 0, e = entry(t.key) ?? { on: 0, t: 0 };
      if (last && last.key === t.key && el - last.at < DOUBLE_E) {
        pendingStop = null;
        const nt = (last.t + 1) % TUNE_COUNT;
        set(t.key, 1, nt); last = { key: t.key, at: el, t: nt };
      } else if (e.on !== 1) {
        set(t.key, 1, e.t); last = { key: t.key, at: el, t: e.t };
      } else {
        pendingStop = { key: t.key, at: el + DOUBLE_E }; last = { key: t.key, at: el, t: e.t };
      }
      return true;
    },
    alt(aim) {
      const t = target(aim); if (!t) return false;
      const e = entry(t.key) ?? { on: 0, t: 0 }, nt = (e.t + 1) % TUNE_COUNT;
      pendingStop = null; set(t.key, 1, nt); last = { key: t.key, at: ctx.elapsed ?? 0, t: nt };
      return true;
    },
    action(a) {
      if (a?.kind !== 'musicbox:set') return false;
      if (applySet(st, ctx.world?.decor, a, STORM_LIVE.clock)) rev++;
      return true;
    },
    decorModel(type, d) {
      if (type !== 'musicbox' || !T) return null;
      const g = buildMusicBox(T);
      if (d && Number.isInteger(d.x) && Number.isInteger(d.z)) {
        const key = tileKey(d.x, d.z), e = entry(key);
        if (e?.on === 1) g.userData.lidPivot.rotation.x = LID_OPEN;            // a rebuilt raft keeps an open lid
        models.set(key, g);
      }
      return g;
    },
    afterUndecor(d) {
      try {
        if (!d || d.type !== 'musicbox') return;
        const key = tileKey(d.x, d.z);
        if (Object.prototype.hasOwnProperty.call(st.b, key)) { delete st.b[key]; rev++; }
        if (sched.key === key) resetSched();
        if (pendingStop?.key === key) pendingStop = null;
      } catch {}
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      tunes: () => TUNES.map(t => t.name),
      target: aim => target(aim),
      place(x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !Number.isInteger(x) || !Number.isInteger(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: 'musicbox', x, z }); ctx.rebuildRaft?.(); return true;
      },
      play: (n = 0, key) => hostSet(key, 1, Number.isInteger(n) ? ((n % TUNE_COUNT) + TUNE_COUNT) % TUNE_COUNT : 0),
      stop: key => { key = key ?? firstKey(); const e = key && entry(key); return hostSet(key, 0, e?.t ?? 0); },
      next: key => { key = key ?? firstKey(); const e = key && entry(key); return hostSet(key, 1, ((e?.t ?? 0) + 1) % TUNE_COUNT); },
      active() {
        if (!aud || !sched.key) return null;
        const e = entry(sched.key); if (!e) return null;
        return { key: sched.key, tune: e.t, name: TUNES[e.t].name, d: aud.d, gain: boxGain(aud.d), anchor: Number.isFinite(sched.anchor) ? sched.anchor : null, cursor: Number.isFinite(sched.cursor) ? sched.cursor : null };
      },
      notes(sec = 4) {
        const key = sched.key ?? Object.keys(st.b)[0] ?? null, e = key ? entry(key) : null;
        if (!e) return [];
        const tune = compose(e.t), out = [];
        windowNotes(tune, phaseAt(clockNow() ?? 0, e.s, tune.loop), sec, out);
        return out.map(c => ({ t: c.dt, m: c.n.m, hz: c.n.hz, bass: c.n.bass }));
      },
      scheduled: () => scheduled,
    },
    dispose() {
      disposed = true;
      try { unprompt?.(); } catch {}
      for (const f of [...glyphs, ...gfree]) { f.sprite.parent?.remove(f.sprite); f.mat.dispose(); }
      glyphs.length = 0; gfree.length = 0;
      glyphTex?.dispose?.(); glyphTex = null;
      models.forEach(g => { try { disposeMusicBox(g); } catch {} });
      models.clear();
    },
  };
}

export default createMusicBox;
