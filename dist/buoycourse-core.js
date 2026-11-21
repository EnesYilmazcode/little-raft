// Buoy Ring Course: pure rules (docs/specs/buoycourse.md). No THREE, no DOM, no side effects.
// Gates are [x, z, yaw] in world metres around the raft; the normal n = (sin yaw, cos yaw) is the travel direction.

export const SHAPES = Object.freeze(['loop', 'sprint', 'zigzag', 'eight']);
export const NAMES = Object.freeze({ loop: 'Loop', sprint: 'Sprint', zigzag: 'Zigzag', eight: 'Figure 8' });
export const MODES = Object.freeze(['swim', 'board']);
export const RING = Object.freeze({ R: 1.5, HIT: 1.6, YLO: -1.6, YHI: 1.4, YHI_BOARD: 2.0, TELEPORT: 3, CLEAR: 5, FAR: 20, LIM: 40, MAXG: 10, TOP: 5 });
export const MAX_MS = 600000, MIN_SPEED = 6;

const fin = Number.isFinite;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const isTile = t => Array.isArray(t) && fin(t[0]) && fin(t[1]);

export function bbox(tiles) {
  if (!Array.isArray(tiles)) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of tiles) {
    if (!isTile(t)) continue;
    const x = t[0] * 2, z = t[1] * 2;
    if (x - 1 < x0) x0 = x - 1; if (x + 1 > x1) x1 = x + 1;
    if (z - 1 < z0) z0 = z - 1; if (z + 1 > z1) z1 = z + 1;
  }
  return x0 === Infinity ? null : { x0, x1, z0, z1 };
}

export function clearOf(b, x, z) {
  const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.sqrt(dx * dx + dz * dz);
}

export function nearestTile(tiles, x, z) {
  let best = Infinity;
  if (!Array.isArray(tiles)) return best;
  for (const t of tiles) {
    if (!isTile(t)) continue;
    const dx = Math.max(Math.abs(x - t[0] * 2) - 1, 0), dz = Math.max(Math.abs(z - t[1] * 2) - 1, 0);
    const d = Math.sqrt(dx * dx + dz * dz); if (d < best) best = d;
  }
  return best;
}

const wrap = a => { let y = a % (Math.PI * 2); if (y > Math.PI) y -= Math.PI * 2; else if (y < -Math.PI) y += Math.PI * 2; return y; };

/** Course gates for a shape around the raft, or null (unknown shape, no tiles, or out of bounds). */
export function makeCourse(shape, tiles, flag) {
  if (!SHAPES.includes(shape)) return null;
  const b = bbox(tiles); if (!b) return null;
  if (!Array.isArray(flag) || !fin(flag[0]) || !fin(flag[1])) return null;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hx = (b.x1 - b.x0) / 2, hz = (b.z1 - b.z0) / 2;
  const FX = flag[0] * 2, FZ = flag[1] * 2;
  // flag side: the bbox side nearest the flag tile centre (ties: +x, -x, +z, -z)
  const sides = [[b.x1 - FX, 1, 0, b.x1], [FX - b.x0, -1, 0, b.x0], [b.z1 - FZ, 0, 1, b.z1], [FZ - b.z0, 0, -1, b.z0]];
  let s = sides[0]; for (const c of sides) if (c[0] < s[0]) s = c;
  const dx = s[1], dz = s[2], e = s[3], ax = dz, az = -dx;
  const sideLen = dx ? b.z1 - b.z0 : b.x1 - b.x0;
  const flagAlong = FX * ax + FZ * az, midAlong = cx * ax + cz * az;
  // (out, along) frame point -> world, measured from side e; tangent (to, ta) in the same frame
  const raw = [];
  const sx = dx ? e : 0, sz = dz ? e : 0; // point on the side line whose along coordinate (p·a) is 0
  const frame = (out, along, base, to, ta) => {
    raw.push([sx + dx * out + ax * (base + along), sz + dz * out + az * (base + along), Math.atan2(dx * to + ax * ta, dz * to + az * ta)]);
  };
  if (shape === 'loop') {
    const A = hx + 6, B = hz + 6;
    for (let i = 0; i < 6; i++) {
      const th = i * Math.PI / 3, sn = Math.sin(th), cs = Math.cos(th);
      raw.push([cx + A * sn, cz + B * cs, Math.atan2(cs * A, -sn * B)]);
    }
  } else if (shape === 'sprint') {
    frame(5, -2.5, flagAlong, 1, 0); frame(10, -2.5, flagAlong, 1, 0); frame(16, 0, flagAlong, 0, 1);
    frame(10, 2.5, flagAlong, -1, 0); frame(5, 2.5, flagAlong, -1, 0);
  } else if (shape === 'zigzag') {
    const L = Math.max(12, sideLen + 4);
    for (let k = 0; k < 6; k++) frame(k % 2 ? 11 : 5, -L / 2 + k * L / 5, midAlong, 0, 1);
  } else {
    for (let i = 0; i < 8; i++) {
      const th = (i + .5) * Math.PI / 4, sn = Math.sin(th), cs = Math.cos(th);
      frame(10 + 4.5 * sn * cs, 9 * sn, midAlong, 4.5 * Math.cos(2 * th), 9 * cs);
    }
  }
  const out = [];
  for (const g of raw) {
    let x = g[0], z = g[1];
    const vx = x - cx, vz = z - cz, l = Math.sqrt(vx * vx + vz * vz);
    if (l > 1e-6) for (let k = 0; k < 40 && clearOf(b, x, z) < RING.CLEAR; k++) { x += vx / l * .5; z += vz / l * .5; }
    x = r1(x); z = r1(z);
    if (Math.abs(x) > RING.LIM || Math.abs(z) > RING.LIM || nearestTile(tiles, x, z) > RING.FAR) return null;
    out.push([x, z, r2(wrap(g[2]))]);
  }
  if (shape === 'loop' || shape === 'eight') out.push(out[0].slice());
  return out.length > RING.MAXG ? null : out;
}

/** True when the eye moved from behind gate g to on/past its plane, inside the ring disc. */
export function crossGate(p0, p1, g, waterY, hi = RING.YHI) {
  if (!p0 || !p1 || !Array.isArray(g)) return false;
  const x0 = p0.x, y0 = p0.y, z0 = p0.z, x1 = p1.x, y1 = p1.y, z1 = p1.z, cx = g[0], cz = g[1], yaw = g[2];
  if (!fin(x0) || !fin(y0) || !fin(z0) || !fin(x1) || !fin(y1) || !fin(z1) || !fin(cx) || !fin(cz) || !fin(yaw) || !fin(waterY) || !fin(hi)) return false;
  const mx = x1 - x0, mz = z1 - z0;
  if (Math.sqrt(mx * mx + mz * mz) > RING.TELEPORT) return false;
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = nz, tz = -nx;
  const d0 = (x0 - cx) * nx + (z0 - cz) * nz, d1 = (x1 - cx) * nx + (z1 - cz) * nz;
  if (!(d0 < 0 && d1 >= 0)) return false;
  const s = d0 / (d0 - d1), qx = x0 + mx * s, qy = y0 + (y1 - y0) * s, qz = z0 + mz * s;
  if (Math.abs((qx - cx) * tx + (qz - cz) * tz) > RING.HIT) return false;
  return qy >= waterY + RING.YLO && qy <= waterY + hi;
}

export function pathLength(gates, fx, fz) {
  if (!Array.isArray(gates)) return 0;
  let px = fx * 2, pz = fz * 2, L = 0;
  for (const g of gates) { const dx = g[0] - px, dz = g[1] - pz; L += Math.sqrt(dx * dx + dz * dz); px = g[0]; pz = g[1]; }
  return fin(L) ? L : 0;
}
export const minMs = (gates, fx, fz) => Math.floor(pathLength(gates, fx, fz) / MIN_SPEED * 1000);

/** Insert a time: new array sorted ascending, one row per name (the faster one), at most TOP rows. */
export function addBest(list, name, ms) {
  const all = [];
  let old = null;
  if (Array.isArray(list)) for (const r of list) { if (!Array.isArray(r)) continue; if (r[0] === name) { if (!old || r[1] < old[1]) old = r; } else all.push([r[0], r[1]]); }
  const fresh = !(old && old[1] <= ms), mine = fresh ? [name, ms] : [old[0], old[1]];
  all.push(mine);
  all.sort((a, b) => a[1] - b[1]); // stable: a tie keeps the older row first
  const out = all.slice(0, RING.TOP), at = out.indexOf(mine);
  const rank = fresh ? at : -1;
  return { list: out, rank, best: rank === 0 };
}

export function cleanName(s, fallback) {
  if (typeof s !== 'string') return fallback;
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 16).trim();
  return t || fallback;
}

const BEST_KEYS = SHAPES.flatMap(s => MODES.map(m => s + ':' + m));
export function cleanCourse(v) {
  const out = { v: 1, shape: 'loop', f: null, g: [], best: {}, r: 0 };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  try {
    if (SHAPES.includes(v.shape)) out.shape = v.shape;
    const f = v.f;
    if (Array.isArray(f) && f.length === 2 && Number.isInteger(f[0]) && Number.isInteger(f[1]) && Math.abs(f[0]) <= 64 && Math.abs(f[1]) <= 64) out.f = [f[0], f[1]];
    if (Array.isArray(v.g) && v.g.length <= RING.MAXG) {
      const g = [];
      for (const row of v.g) {
        if (!Array.isArray(row) || row.length !== 3 || !row.every(fin)) { g.length = 0; break; }
        const c = x => Math.max(-RING.LIM, Math.min(RING.LIM, x));
        g.push([c(row[0]), c(row[1]), wrap(row[2])]);
      }
      if (g.length === v.g.length) out.g = g;
    }
    if (v.best && typeof v.best === 'object' && !Array.isArray(v.best)) {
      for (const k of BEST_KEYS) {
        const rows = v.best[k]; if (!Array.isArray(rows)) continue;
        let list = [];
        for (const r of rows.slice(0, 100)) {
          if (!Array.isArray(r)) continue;
          const n = cleanName(r[0], ''), ms = r[1];
          if (!n || !Number.isInteger(ms) || ms < 1 || ms > MAX_MS) continue;
          list = addBest(list, n, ms).list;
        }
        if (list.length) out.best[k] = list;
      }
    }
    if (Number.isInteger(v.r) && v.r >= 0) out.r = v.r;
  } catch { return { v: 1, shape: 'loop', f: null, g: [], best: {}, r: 0 }; }
  return out;
}

export function fmt(ms) {
  const t = fin(ms) && ms > 0 ? Math.floor(ms / 100) : 0;
  const m = Math.floor(t / 600), s = Math.floor(t / 10) % 60, d = t % 10;
  return m + ':' + (s < 10 ? '0' : '') + s + '.' + d;
}

export function gateHash(g) {
  let h = 0;
  if (!Array.isArray(g)) return 0;
  for (let i = 0; i < g.length; i++) {
    const r = g[i]; if (!Array.isArray(r)) continue;
    h = (h + (i + 1) * (Math.round(r[0] * 10) * 31 + Math.round(r[1] * 10) * 17 + Math.round(r[2] * 100))) | 0;
  }
  return h;
}

export const gkOf = st => st.shape + ':' + gateHash(st.g);

/** Host predicate for buoy.finish. */
export function validFinish(st, a) {
  if (!st || !a || typeof a !== 'object') return false;
  if (!Array.isArray(st.g) || !st.g.length || !Array.isArray(st.f)) return false;
  if (a.shape !== st.shape || a.gk !== gkOf(st) || !MODES.includes(a.mode)) return false;
  if (!Number.isInteger(a.ms) || a.ms > MAX_MS) return false;
  return a.ms >= Math.max(1, minMs(st.g, st.f[0], st.f[1]));
}
