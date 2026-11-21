// Receiver, antennas and signal navigation. Pure ES module: no DOM, no THREE, no clocks.
// Randomness only through an injected rng. The host runs signalTick(); everyone reads signalReadout().
// See docs/specs/receiver-navigation.md.

export const CACHE_ID = 9000, FIRST_DELAY = 20, MAX_ANTENNAS = 3, NEAR_GAP = 22, STOP_GAP = 6, LIMIT = 78;
export const TIERS = Object.freeze([ // index = antenna count
  Object.freeze({range:45, wobble:25, step:0,  marker:'never',  speed:.30, cooldown:150}),
  Object.freeze({range:60, wobble:10, step:10, marker:'near',   speed:.35, cooldown:150}), // 'near' = distance < 40
  Object.freeze({range:70, wobble:0,  step:5,  marker:'always', speed:.40, cooldown:120}),
  Object.freeze({range:75, wobble:0,  step:1,  marker:'always', speed:.45, cooldown:90, beam:true}),
]);
const BASE_LOOT = Object.freeze({wood:6, plastic:4, scrap:3, rope:2});
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DEG = 180 / Math.PI;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = Number.isFinite;
const tierOf = n => TIERS[clamp(Number.isInteger(n) ? n : 0, 0, MAX_ANTENNAS)];
const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
const itemsOf = world => (Array.isArray(world.items) ? world.items : (world.items = []));
const hasReceiver = decor => Array.isArray(decor) && decor.some(d => d?.type === 'receiver');

export function cleanSignal(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const cooldown = fin(v.cooldown) ? clamp(v.cooldown, 0, 600) : 0;
  const c = v.cache;
  let cache = null;
  if (c && typeof c === 'object' && Number.isInteger(c.id) && typeof c.token === 'string' && c.token.length >= 1 && c.token.length < 80
    && fin(c.x) && fin(c.z) && Math.abs(c.x) < 80 && Math.abs(c.z) < 80)
    cache = {id:c.id, token:c.token, x:c.x, z:c.z, phase:fin(c.phase) ? c.phase : 0, near:!!c.near};
  return {cooldown, cache};
}

// 0..3: antennas at least 2 tiles (Chebyshev) from the first receiver. No receiver -> 0.
export function countAntennas(decor) {
  if (!Array.isArray(decor)) return 0;
  const r = decor.find(d => d?.type === 'receiver'); if (!r) return 0;
  let n = 0;
  for (const d of decor) if (d?.type === 'antenna' && Math.max(Math.abs(d.x - r.x), Math.abs(d.z - r.z)) >= 2) n++;
  return Math.min(MAX_ANTENNAS, n);
}

// World-space centre of the raft and a radius that covers every tile.
export function raftCentre(tiles) {
  const list = Array.isArray(tiles) ? tiles.filter(t => Array.isArray(t) && fin(t[0]) && fin(t[1])) : [];
  if (!list.length) return {x:0, z:0, r:1};
  let x = 0, z = 0;
  for (const t of list) { x += t[0] * 2; z += t[1] * 2; }
  x /= list.length; z /= list.length;
  let r = 0;
  for (const t of list) r = Math.max(r, Math.hypot(t[0] * 2 - x, t[1] * 2 - z));
  return {x, z, r:r + 1};
}

// Host-only. Mutates world.signal and world.items. Returns [{kind:'detected'|'near'}].
export function signalTick(world, dt, {rng = Math.random, token, held = new Set()} = {}) {
  if (!world || typeof world !== 'object') return [];
  const step = fin(dt) && dt > 0 ? dt : 0;
  const makeToken = typeof token === 'function' ? token : () => 'sig-' + rng().toString(36).slice(2);
  const hasR = hasReceiver(world.decor);
  if (!hasR && !world.signal?.cache) { world.signal = null; removeStale(world, null); return []; }
  if (world.signal == null) world.signal = {cooldown:FIRST_DELAY, cache:null};
  const s = world.signal, events = [];
  removeStale(world, s.cache?.token ?? null);
  const n = countAntennas(world.decor), tier = tierOf(n), C = raftCentre(world.tiles);
  if (!s.cache) {
    if (!hasR) return events;
    s.cooldown = Math.max(0, (fin(s.cooldown) ? s.cooldown : 0) - step);
    if (s.cooldown > 0) return events;
    const a = rng() * Math.PI * 2, d = tier.range;
    s.cache = {id:CACHE_ID, token:String(makeToken()).slice(0, 79) || 'sig', x:clamp(C.x + Math.sin(a) * d, -LIMIT, LIMIT), z:clamp(C.z + Math.cos(a) * d, -LIMIT, LIMIT), phase:rng() * 6, near:false};
    events.push({kind:'detected'});
    ensureMirror(world, s.cache);
    return events;
  }
  const c = s.cache, mirror = ensureMirror(world, c);
  const stop = C.r + STOP_GAP;
  let dist = Math.hypot(C.x - c.x, C.z - c.z);
  if (!held.has(c.token)) {
    if (dist > stop) {
      const move = Math.min(tier.speed * step, dist - stop);
      c.x += (C.x - c.x) / dist * move; c.z += (C.z - c.z) / dist * move;
      dist -= move;
    }
    mirror.x = c.x; mirror.z = c.z;
  }
  if (!c.near && dist <= C.r + NEAR_GAP) { c.near = true; events.push({kind:'near'}); }
  return events;
}
function removeStale(world, keep) {
  const items = itemsOf(world);
  for (let i = items.length - 1; i >= 0; i--) if (items[i]?.type === 'cache' && items[i].token !== keep) items.splice(i, 1);
}
function ensureMirror(world, c) {
  const items = itemsOf(world);
  let it = items.find(i => i?.type === 'cache' && i.token === c.token);
  if (!it) { it = {id:c.id, token:c.token, type:'cache', x:c.x, z:c.z, phase:c.phase}; items.push(it); }
  return it;
}

export function onCacheCollected(world) {
  world.signal = {cooldown:tierOf(countAntennas(world.decor)).cooldown, cache:null};
  removeStale(world, null);
}

export function cacheLoot(antennas, rng = Math.random) {
  const loot = {...BASE_LOOT};
  if (antennas >= MAX_ANTENNAS && rng() < .25) { if (rng() < .5) loot.fish = (loot.fish ?? 0) + 1; else loot.leaf = (loot.leaf ?? 0) + 2; }
  return loot;
}

export function signalReadout(signal, me, antennas, elapsed) {
  if (!signal || typeof signal !== 'object') return null;
  const c = signal.cache;
  if (!c) return {listening:true, label:'SIGNAL · listening…'};
  const n = clamp(Number.isInteger(antennas) ? antennas : 0, 0, MAX_ANTENNAS), tier = TIERS[n];
  const mx = fin(me?.x) ? me.x : 0, mz = fin(me?.z) ? me.z : 0, yaw = fin(me?.yaw) ? me.yaw : 0;
  const dx = c.x - mx, dz = c.z - mz, dist = Math.hypot(dx, dz);
  const wob = tier.wobble ? tier.wobble * Math.sin((fin(elapsed) ? elapsed : 0) * .9 + (fin(c.phase) ? c.phase : 0)) : 0;
  const bearing = Math.atan2(dx, -dz) * DEG;
  const heading = (((bearing + wob + 360) % 360) + 360) % 360;
  const point = POINTS[Math.round(heading / 45) % 8];
  const arrow = wrap180(bearing + wob + yaw * DEG);
  const distText = tier.step === 0 ? (dist > 30 ? 'far' : 'near') : Math.round(dist / tier.step) * tier.step + ' m';
  const marker = tier.marker === 'always' || (tier.marker === 'near' && dist < 40);
  return {listening:false, heading, point, arrow, distance:dist, distText, marker, beam:!!tier.beam, antennas:n, label:`SIGNAL ${point} · ${distText}`};
}

// Screen position for an indicator: on-screen points pass through, others hug an inset rectangle.
export function edgePoint(sx, sy, inFront, w, h, margin = 24) {
  const okX = fin(sx), okY = fin(sy);
  if (inFront && okX && okY && sx >= margin && sx <= w - margin && sy >= margin && sy <= h - margin) return {x:sx, y:sy, edge:false};
  const cx = w / 2, cy = h / 2;
  let vx = okX ? sx - cx : 0, vy = okY ? sy - cy : 0;
  if (!inFront) { vx = -vx; vy = -vy; }
  if (vx === 0 && vy === 0) vy = 1;
  const hw = Math.max(0, cx - margin), hh = Math.max(0, cy - margin);
  const k = Math.min(vx ? hw / Math.abs(vx) : Infinity, vy ? hh / Math.abs(vy) : Infinity);
  return {x:cx + vx * k, y:cy + vy * k, edge:true};
}
