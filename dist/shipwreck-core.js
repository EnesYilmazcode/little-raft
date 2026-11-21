// Sunken shipwreck dive sites: pure logic (no THREE, no DOM). Schedule, placement candidates, layout,
// loot, the host open check and save validation. See docs/specs/shipwreck.md.
import { rng, hash3 } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';

export { rng, hash3 };

export const SW = Object.freeze({
  FIRST: 420, CALM_MIN: 480, CALM_MAX: 720,
  APPROACH: 20, DOCK: 240, DOCK_CAP: 600, DEPART: 20, WARN: 30, NEAR: 25,
  START_Z: -60, END_Z: 60, RETRY: 60,
  FLOOR_MIN: -12, FLOOR_MAX: -6,
  REACH: 2.8, SLACK: 1.5,
  OFF_MIN: 10, OFF_MAX: 30, GAP: 9,
});

export const MAX_SLOTS = 7;
export const VARIANTS = Object.freeze(['keel', 'listing', 'bow']);

const U32 = 4294967296;
const TAU = Math.PI * 2;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isSeed = s => Number.isInteger(s) && s >= 0 && s < U32;

// ---------- schedule ----------
export function nextDelay(seed, first = false) {
  if (first) return SW.FIRST;
  return SW.CALM_MIN + (SW.CALM_MAX - SW.CALM_MIN) * hash3(seed >>> 0, 91, 7);
}

const easeOut = u => 1 - (1 - u) * (1 - u) * (1 - u);
const easeIn = u => u * u * u;
// Phase t seconds after the site was born. Writes out.phase/left/mz (marker z); no allocation.
// The hull and containers exist only while 'docked'; approach and depart move the surface marker only.
export function pathAt(t, dock, z, out = {}) {
  const A = SW.APPROACH, D = fin(dock) ? Math.max(0, dock) : SW.DOCK, P = SW.DEPART;
  if (!fin(t) || t < 0) t = 0;
  if (!fin(z)) z = 0;
  if (t < A) { out.phase = 'approach'; out.left = A - t; out.mz = SW.START_Z + (z - SW.START_Z) * easeOut(t / A); }
  else if (t < A + D) { out.phase = 'docked'; out.left = A + D - t; out.mz = z; }
  else if (t < A + D + P) { out.phase = 'depart'; out.left = A + D + P - t; out.mz = z + (SW.END_Z - z) * easeIn((t - A - D) / P); }
  else { out.phase = 'gone'; out.left = 0; out.mz = SW.END_Z; }
  return out;
}

// ---------- placement ----------
export const dockZFor = seed => -4 + 8 * hash3(seed >>> 0, 5, 9);
// Raft bbox edge (m from the origin) on one x side; same tile loop as islands-layout dockOffset.
export function raftEdge(tiles, side) {
  let lo = 0, hi = 0, any = false;
  if (Array.isArray(tiles)) for (const t of tiles) {
    if (!Array.isArray(t) || !fin(t[0])) continue;
    const x = t[0] * 2;
    if (!any) { lo = x - 1; hi = x + 1; any = true; } else { lo = Math.min(lo, x - 1); hi = Math.max(hi, x + 1); }
  }
  if (!any) { lo = -1; hi = 1; }
  return side > 0 ? hi : -lo;
}
export const offsetFor = edge => clamp((fin(edge) ? edge : 1) + SW.GAP, SW.OFF_MIN, SW.OFF_MAX);
// Six [x, z] candidate points on `side`, written into out6 (allocated once if not given).
export function candidates(seed, side, off, dockZ, out6) {
  const out = Array.isArray(out6) && out6.length === 6 ? out6 : [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
  const s = side < 0 ? -1 : 1;
  for (let k = 0; k < 6; k++) {
    const p = Array.isArray(out[k]) ? out[k] : (out[k] = [0, 0]);
    p[0] = s * (off + 2 * (k % 3));
    p[1] = dockZ + (k < 3 ? 0 : (hash3(seed >>> 0, k, 3) - 0.5) * 6);
  }
  return out;
}

// ---------- layout ----------
const SPOTS = {
  keel: { crate: [[-1.2, -2.5], [1.2, -2.5], [-1, 0.5], [1.1, 1], [-2.4, 2.8], [2.6, -0.8]], barrel: [[0, -3.6], [-2.2, -0.6], [2, 3.2]], chest: [0, 3.4, 0.3] },
  listing: { crate: [[1.8, -2], [2.8, -0.4], [2.2, 1.6], [3.6, 0.8], [-0.6, -1.2], [0.4, 2.6]], barrel: [[3.4, -2.4], [4.2, 2.2], [-1.6, 3.4]], chest: [1.2, 3.6, 0] },
  bow: { crate: [[-0.8, -3], [0.9, -1.8], [-1.5, 0.4], [2.2, 2.4], [-2.6, 3.6], [0.6, 4.2]], barrel: [[1.6, 0.2], [-0.4, 2.6], [3, 4.6]], chest: [-0.2, -0.4, 0] },
};
export const HULL_HALF = 4.5; // hull runs along local z, 9 m
const layoutCache = new Map();
// Layout of a wreck, a pure function of its seed (cached, frozen). Site-local metres.
export function layoutFor(seed) {
  seed = seed >>> 0;
  const hit = layoutCache.get(seed);
  if (hit) return hit;
  const r = rng(seed ^ 0x5eed5);
  const variant = VARIANTS[seed % 3];
  const yaw = r() * TAU;
  const S = SPOTS[variant];
  const slots = [Object.freeze({ kind: 'chest', x: S.chest[0], z: S.chest[1], h: S.chest[2], rot: 0 })];
  const pick = (spots, n, kind) => {
    const left = spots.slice();
    for (let i = 0; i < n; i++) {
      const [x, z] = left.splice(Math.floor(r() * left.length), 1)[0];
      slots.push(Object.freeze({ kind, x: x + (r() - 0.5) * 0.6, z: z + (r() - 0.5) * 0.6, h: 0, rot: r() * TAU }));
    }
  };
  pick(S.crate, 3 + (r() < 0.5 ? 1 : 0), 'crate');
  pick(S.barrel, 1 + (r() < 0.5 ? 1 : 0), 'barrel');
  const kelp = [], want = 10 + Math.floor(r() * 7);
  for (let i = 0; i < want; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const a = r() * TAU, d = 6 * Math.sqrt(r()), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < 0.6 && Math.abs(z) < HULL_HALF) continue;
      let ok = true;
      for (const s of slots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < 0.64) { ok = false; break; }
      if (!ok) continue;
      kelp.push(Object.freeze({ x, z, s: 0.7 + r() * 0.6, rot: r() * TAU }));
      break;
    }
  }
  const fish = [], nf = 6 + Math.floor(r() * 3);
  for (let i = 0; i < nf; i++) fish.push(Object.freeze({ orbitR: 3 + 2 * r(), orbitH: 1.5 + 1.5 * r(), speed: 0.25 + 0.15 * r(), phase: i * TAU / nf }));
  const out = Object.freeze({ seed, variant, yaw, slots: Object.freeze(slots), kelp: Object.freeze(kelp), fish: Object.freeze(fish) });
  if (layoutCache.size > 64) layoutCache.clear();
  layoutCache.set(seed, out);
  return out;
}
export const fullMask = lay => (1 << lay.slots.length) - 1;

// Site-local (x, z) of slot k yawed and moved to the site, written into out[0..1] (world x/z).
export function slotWorld(lay, k, site, out = [0, 0]) {
  const s = lay.slots[k], c = Math.cos(lay.yaw), n = Math.sin(lay.yaw);
  out[0] = site.x + s.x * c + s.z * n;
  out[1] = site.z - s.x * n + s.z * c;
  return out;
}
// Fill a Float32Array(21) with each slot's world base (x, y, z). floorAt(x, z) -> y or NaN.
export function fillSlotPos(lay, site, floorAt, out = new Float32Array(MAX_SLOTS * 3)) {
  const w = [0, 0];
  for (let k = 0; k < lay.slots.length && k < MAX_SLOTS; k++) {
    slotWorld(lay, k, site, w);
    let y = typeof floorAt === 'function' ? floorAt(w[0], w[1]) : NaN;
    y = fin(y) ? clamp(y, site.y - 1.5, site.y + 1.5) : site.y;
    out[k * 3] = w[0]; out[k * 3 + 1] = y + lay.slots[k].h; out[k * 3 + 2] = w[1];
  }
  return out;
}
export const SLOT_CENTRE = 0.35; // container centre above its base (targets and the reach check)

// ---------- loot ----------
const TABLES = {
  crate: [['wood', 2, 3, 4], ['scrap', 2, 3, 4], ['rope', 1, 2, 3], ['nail', 2, 3, 3], ['plastic', 1, 2, 2], ['glass', 1, 1, 1], ['metalingot', 1, 1, 1]],
  barrel: [['rope', 2, 2, 3], ['seaweed', 2, 2, 2], ['clay', 2, 2, 2], ['copperore', 1, 1, 1], ['cup', 1, 1, 1]],
  chest: [['glassfloat', 1, 1, 4], ['metalingot', 2, 2, 3], ['copperingot', 1, 1, 2], ['shellwreath', 1, 1, 1]],
};
// What container `slot` of wreck `seed` holds: [[id, n], ...] (merged). known(id) filters item ids.
export function lootFor(seed, slot, kind, hasNote = false, known = () => true) {
  const r = rng((hash3(seed >>> 0, slot | 0, 13) * U32) >>> 0);
  const ok = typeof known === 'function' ? id => { try { return !!known(id); } catch { return false; } } : () => true;
  const got = new Map();
  const add = (id, n) => { if (n > 0) got.set(id, (got.get(id) || 0) + n); };
  const roll = name => {
    const t = TABLES[name].filter(e => ok(e[0]));
    let tot = 0; for (const e of t) tot += e[3];
    const u = r(), v = r();
    if (!t.length) return;
    let x = u * tot, i = 0;
    while (i < t.length - 1 && x >= t[i][3]) x -= t[i++][3];
    const e = t[i];
    add(e[0], e[1] + Math.floor(v * (e[2] - e[1] + 1)));
  };
  if (kind === 'crate') { roll('crate'); roll('crate'); }
  else if (kind === 'barrel') { if (ok('plastic')) add('plastic', 1); roll('barrel'); }
  else if (kind === 'chest') { const n = 3 + Math.floor(r() * 3); if (ok('shell')) add('shell', n); if (!hasNote) roll('chest'); }
  const out = [...got];
  if (!out.length && ok('wood')) out.push(['wood', 1]);
  return out;
}

// ---------- host open check ----------
// st: {site, clock, lay, slotPos}. pos: the actor's {x, y, z}. Mutates bag and site.opened only on success.
const pathScratch = { phase: 'gone', left: 0, mz: 0 };
export function applyOpen(st, a, actor, pos, bag, hasNote = false, known) {
  const no = reason => ({ ok: false, reason, loot: null, note: false });
  if (!a || a.kind !== 'wreck.open') return no('kind');
  const site = st && st.site;
  if (!site) return no('none');
  if (a.seed !== site.seed) return no('stale');
  if (pathAt(st.clock - site.born, site.dock, site.z, pathScratch).phase !== 'docked') return no('phase');
  const lay = st.lay || layoutFor(site.seed), k = a.slot;
  if (!Number.isInteger(k) || k < 0 || k >= lay.slots.length) return no('slot');
  if ((site.opened >> k) & 1) return no('opened');
  const sp = st.slotPos;
  if (!pos || !fin(pos.x) || !fin(pos.y) || !fin(pos.z) || !sp) return no('reach');
  const dx = pos.x - sp[k * 3], dy = pos.y - (sp[k * 3 + 1] + SLOT_CENTRE), dz = pos.z - sp[k * 3 + 2];
  if (!(Math.hypot(dx, dy, dz) <= SW.REACH + SW.SLACK)) return no('reach');
  if (!bag || !Array.isArray(bag.slots) || typeof bag.snapshot !== 'function') return no('bag');
  const kind = lay.slots[k].kind;
  const loot = lootFor(site.seed, k, kind, hasNote, known);
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return no('bag'); }
  for (const [id, n] of loot) if (scratch.add(id, n) > 0) return no('full');
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  site.opened |= 1 << k;
  return { ok: true, reason: null, loot, note: kind === 'chest' && !!hasNote };
}

// ---------- save ----------
export const DEFAULTS = () => ({ v: 1, clock: 0, next: SW.FIRST, site: null });

// Validate a save / net slice. Never throws; always returns a fresh valid object.
export function clean(data) {
  const out = DEFAULTS();
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return out;
    if (fin(data.clock)) out.clock = clamp(data.clock, 0, 1e9);
    out.next = fin(data.next) ? clamp(data.next, out.clock, out.clock + SW.DOCK_CAP + SW.CALM_MAX) : out.clock + SW.FIRST;
    const s = data.site;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
    if (!isSeed(s.seed) || !fin(s.x) || !fin(s.z) || !fin(s.y) || !fin(s.born) || !fin(s.dock)) return out;
    if (Math.abs(s.x) > 80 || Math.abs(s.z) > 80 || s.y < -25 || s.y > -2) return out;
    const born = clamp(s.born, out.clock - (SW.APPROACH + SW.DOCK_CAP + SW.DEPART), out.clock);
    const dock = clamp(s.dock, 0, SW.DOCK_CAP);
    if (pathAt(out.clock - born, dock, s.z, {}).phase === 'gone') return out;
    const lay = layoutFor(s.seed);
    out.site = { seed: s.seed, born, dock, x: s.x, z: s.z, y: s.y, opened: (s.opened | 0) & fullMask(lay) };
  } catch { return DEFAULTS(); }
  return out;
}
