// Kelp Line content module (see docs/specs/kelp.md). A float line hung off a raft edge tile grows seaweed in
// the water in 3 stages; E harvests a Lush line. Host-authoritative slice world.ext.kelpline, actions
// 'kelpline.*'. The rules live in kelpline-core.js (pure); the model in kelpline-model.js.
import { cleanKelp, tickKelp, kelpInfo, harvest, yieldFor, lineAt, stageOf, isKey, isEdgeTile, openSide, tileKey,
  STAGES, LUSH_AT, MAX_TICK, REACH, HOST_SLACK, OVERHANG, OLD_HOST, NOT_EDGE } from './kelpline-core.js?build=v3-survival-ae77fa84ac2b';
import { createKelpLine as createLineModel, paintKelp } from './kelpline-model.js?build=v3-survival-ae77fa84ac2b';
import { seaweedGeometry } from './seafloor.js?build=v3-survival-ae77fa84ac2b';

const isInt = Number.isInteger;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const hasTile = (tiles, x, z) => { if (Array.isArray(tiles)) for (const t of tiles) if (t && t[0] === x && t[1] === z) return true; return false; };

export function createKelpLine(ctx, peer) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanKelp(undefined, null); st.s = session;
  let ver = 0, cache = null, cacheVer = -1, cacheSt = null; // ver: bumps on every change (growth too), not saved
  let netR = -1, netS = null, netUndef = false, hostHasLine = true;
  let clock = 0, env = null, weedGeo = null;
  const lines = []; // {g, k, x, z, phase} for each craft_kelpline group in ctx.raft
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const scratch = T ? new T.Vector3() : null, camPos = T ? new T.Vector3() : null;
  const frustum = T ? new T.Frustum() : null, projView = T ? new T.Matrix4() : null, bound = T ? new T.Sphere(new T.Vector3(), 1.6) : null;

  const oldHost = () => ctx.role === 'guest' && !hostHasLine;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const tiles = () => (Array.isArray(ctx.world?.tiles) ? ctx.world.tiles : []);
  // The overhang point out over the open side (tile centre when none is open): writes spotX / spotZ.
  let spotX = 0, spotZ = 0;
  function spot(d) {
    const s = openSide(tiles(), d.x, d.z, d.rot);
    spotX = d.x * 2 + (s ? s[0] * OVERHANG : 0); spotZ = d.z * 2 + (s ? s[1] * OVERHANG : 0);
  }

  // Nearest line along the view ray (or the camera forward), within reach of the player (as fish-trap.js).
  function target(aim) {
    const w = ctx.world, p = ctx.physics, cam = ctx.camera; if (!w || !p || !cam || !Array.isArray(w.decor)) return null;
    let best = null, bestScore = Infinity;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    const cy = (ctx.raft?.position.y ?? 0) + .05;
    for (let i = 0; i < w.decor.length; i++) {
      const d = w.decor[i]; if (!d || d.type !== 'kelpline') continue;
      if (Math.hypot(p.x - d.x * 2, p.z - d.z * 2) > REACH + OVERHANG + .1) continue;
      spot(d); const cx = spotX, cz = spotZ;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .85) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best ? { x: best.x, z: best.z, key: tileKey(best.x, best.z) } : null;
  }

  function scanLines() {
    const raft = ctx.raft; if (!raft) { lines.length = 0; return; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    lines.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_kelpline') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2), d = lineAt(decor(), x, z);
      const s = openSide(tiles(), x, z, d?.rot ?? 0);
      g.rotation.y = s ? Math.atan2(s[0], s[1]) : (d?.rot || 0);
      lines.push({ g, k: tileKey(x, z), x, z, phase: (x * 7 + z * 13) % 6.28 });
    }
  }

  function paint() {
    scanLines(); if (!lines.length) return;
    const cam = ctx.camera, elapsed = ctx.elapsed ?? 0, old = oldHost();
    const near = !!(cam && camPos), cull = near && !!cam.projectionMatrix && !!cam.matrixWorldInverse;
    if (near) cam.getWorldPosition(camPos);
    if (cull) frustum.setFromProjectionMatrix(projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (let i = 0; i < lines.length; i++) {
      const { g, k, phase } = lines[i];
      let move = true;
      if (near) { g.getWorldPosition(bound.center); move = bound.center.distanceToSquared(camPos) <= 900 && (!cull || frustum.intersectsSphere(bound)); }
      paintKelp(g, old ? 0 : stageOf(st.t[k] ?? 0), elapsed, phase, move); // stage cues always; bob only when seen
    }
  }

  function sunny() { // host only; never blocks growth
    try {
      const night = env?.night?.(), rain = peer?.('daynight')?.rain;
      if (!Number.isFinite(rain) || !Number.isFinite(night)) return false;
      return night < .5 && rain < .2;
    } catch { return false; }
  }

  function load(data, from) {
    if (from === 'net') {
      if (isObj(data) && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasLine = data !== undefined;
      st = cleanKelp(data, ctx.world?.decor); ver++;
      netR = isObj(data) ? data.r : -1; netS = isObj(data) ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasLine = true;
    st = cleanKelp(data, ctx.world?.decor);
    st.s = session; st.r++; ver++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheVer === ver) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheVer = ver;
    return cache;
  }

  function step(n, sun) {
    const r = tickKelp(st, ctx.world?.tiles, ctx.world?.decor, n, sun);
    if (r.grew) ver++;
    return r;
  }

  return {
    name: 'kelpline',
    link(e) { env = e; },
    load,
    serialize,
    update(dt) {
      if (T) paint();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        const r = step(n, sunny());
        if (r.ripe.length) ctx.emit?.({ kind: 'notice', text: 'A kelp line is lush' }, 'all');
      }
    },
    placeBlock(kind, x, z) {
      return kind === 'kelpline' && !isEdgeTile(ctx.world?.tiles, x, z) ? 'kelpedge' : null;
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      if (oldHost()) return OLD_HOST;
      const info = kelpInfo(st, tiles(), decor(), t.x, t.z); if (!info) return null;
      if (info.stage === 2) return `<kbd>E</kbd>Harvest seaweed (${yieldFor(decor(), t.x, t.z)})`; // before the edge check: a closed-in Lush line still harvests
      if (!info.edge) return NOT_EDGE;
      return ctx.role === 'guest' ? `Kelp line: ${STAGES[info.stage]}…` : `Kelp line: ${STAGES[info.stage]}… ${info.pct}%`;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
      const info = kelpInfo(st, tiles(), decor(), t.x, t.z);
      if (!info) { ctx.notice?.('Nothing to harvest'); return true; }
      if (info.stage === 2) { ctx.action({ kind: 'kelpline.harvest', x: t.x, z: t.z }); return true; }
      if (!info.edge) { ctx.notice?.(NOT_EDGE, 2400); return true; }
      ctx.notice?.('Still growing');
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('kelpline.')) return false;
      if (!isInt(a.x) || !isInt(a.z)) return true;
      const d = lineAt(decor(), a.x, a.z); if (!d) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      spot(d);
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(spotX - pose.x, spotZ - pose.z) > REACH + HOST_SLACK) return true;
      if (a.kind === 'kelpline.harvest') {
        const r = harvest(st, decor(), tileKey(a.x, a.z), bag);
        if (r.ok) {
          st.r++; ver++;
          ctx.emit?.({ kind: 'loot', text: r.text, loot: { seaweed: r.n } }, actor);
        } else ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      }
      return true;
    },
    // [undecor] a line is never busy; a Lush line gives its seaweed back with the item
    beforeUndecor() { return null; },
    undecorLoot(d) {
      if (!d || d.type !== 'kelpline' || !isInt(d.x) || !isInt(d.z)) return [];
      return stageOf(st.t[tileKey(d.x, d.z)] ?? 0) === 2 ? [['seaweed', yieldFor(decor(), d.x, d.z)]] : [];
    },
    afterUndecor(d) {
      if (!d || d.type !== 'kelpline') return;
      delete st.t[tileKey(d.x, d.z)]; st.r++; ver++;
    },
    decorModel(type) {
      if (!T || type !== 'kelpline') return null;
      if (!weedGeo) { weedGeo = seaweedGeometry(T); weedGeo.userData.shared = true; weedGeo.dispose = () => {}; } // shared by every line: rebuildRaft / ghost never free it
      return createLineModel(T, weedGeo);
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      lines: () => decor().filter(d => d && d.type === 'kelpline').map(d => ({ x: d.x, z: d.z, key: tileKey(d.x, d.z), ...kelpInfo(st, tiles(), decor(), d.x, d.z) })),
      target: aim => target(aim),
      /** Host QA: put a kelp line on a free raft tile. */
      place(x, z, rot = 0) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!hasTile(w.tiles, x, z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push(rot ? { type: 'kelpline', x, z, rot } : { type: 'kelpline', x, z }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: run the growth rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 60, sun = false) {
        if (ctx.role === 'guest') return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); step(n, !!sun); left -= n; }
        return true;
      },
      /** Host QA: make one line Lush. */
      ripen(key) {
        if (ctx.role === 'guest' || !isKey(key)) return false;
        const [x, z] = key.split(',').map(Number); if (!lineAt(decor(), x, z)) return false;
        st.t[key] = LUSH_AT; st.r++; ver++; return true;
      },
    },
    dispose() { lines.length = 0; if (weedGeo) { weedGeo.dispose = Object.getPrototypeOf(weedGeo).dispose; weedGeo.dispose(); weedGeo = null; } },
  };
}
