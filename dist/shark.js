// Shark ("Notchfin"): the one animal on the sea that threatens the raft. Two halves:
//  - a pure behaviour state machine (createSharkBrain), Node-testable and deterministic for a given dt
//    sequence and seed; no THREE, no DOM, no per-step allocations;
//  - createSharkModel(T): one merged vertex-coloured low-poly mesh (one draw call) whose tail sways in the
//    vertex shader, plus sharkPose(), shared by host and guest to turn a {state, t} into depth/roll/pitch.
// The host simulates; a co-op guest only renders the {x, z, yaw, s} pose it receives (see game.js [shark]).
// Raft frame = world frame in x/z: the raft sits at the origin and the world drifts past it (sailing-world.js).

export const SHARK_HP = 150;
export const RING_MARGIN = 4;       // circling radius = raft extent + this
export const BITE_TIME = 12;        // seconds a raft bite lasts before the tile is torn off
export const DRIVE_OFF = 15;        // damage during one attack that makes it give up
export const RETREAT_TIME = 25;     // seconds it stays away after being driven off
export const PLAYER_BITE_GAP = 2.5; // seconds between bites on a swimmer
export const PLAYER_DAMAGE = 30;
export const FLOAT_TIME = 10;       // dead: belly-up on the surface this long, then it sinks
export const SINK_TIME = 6;
export const RESPAWN_TIME = 180;    // seconds from death to a new shark
export const HUNT_RANGE = 40;       // a swimmer this far from the raft centre (m) still gets hunted
const CIRCLE_SPEED = 2.6, APPROACH_SPEED = 4.8, HUNT_SPEED = 5.4, TURN = 1.8, TAU = Math.PI * 2;
const EDGE_GAP = 1.45; // body centre this far outside the tile edge while biting (nose on the logs)
const NB = [1, 0, -1, 0, 0, 1, 0, -1];

const fin = v => typeof v === 'number' && Number.isFinite(v);
export function mulberry32(a) { let s = a | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

// ------------------------------------------------------------------ raft tiles (pure)

// Raft half-size in metres: max |tile coord| * 2 + 1 (tiles are 2 m). 0 with no tiles.
export function raftExtent(tiles) {
  if (!Array.isArray(tiles)) return 0;
  let m = -1;
  for (let k = 0; k < tiles.length; k++) { const t = tiles[k]; if (!t) continue; const a = Math.max(Math.abs(t[0]), Math.abs(t[1])); if (a > m) m = a; }
  return m < 0 ? 0 : m * 2 + 1;
}
const indexOf = (tiles, x, z) => { for (let k = 0; k < tiles.length; k++) if (tiles[k][0] === x && tiles[k][1] === z) return k; return -1; };

// Index of a missing neighbour direction of tile k (0..3 into NB pairs), preferring the one facing away from
// the raft centre, or -1 when all four neighbours exist (not an edge tile).
export function openSide(tiles, k) {
  const t = tiles[k]; let best = -1, bd = -Infinity;
  for (let d = 0; d < 4; d++) {
    const dx = NB[d * 2], dz = NB[d * 2 + 1];
    if (indexOf(tiles, t[0] + dx, t[1] + dz) >= 0) continue;
    const score = t[0] * dx + t[1] * dz; // outward-facing sides first
    if (score > bd) { bd = score; best = d; }
  }
  return best;
}
export const isEdgeTile = (tiles, k) => openSide(tiles, k) >= 0;

// Would removing tile k keep the rest of the raft in one 4-connected piece? Never true for the last tile.
export function keepsConnected(tiles, k) {
  const n = tiles.length; if (n <= 1 || k < 0 || k >= n) return false;
  if (n === 2) return true;
  const seen = new Uint8Array(n), stack = []; const start = k === 0 ? 1 : 0;
  seen[start] = 1; seen[k] = 1; stack.push(start); let count = 1;
  while (stack.length) {
    const t = tiles[stack.pop()];
    for (let d = 0; d < 4; d++) {
      const j = indexOf(tiles, t[0] + NB[d * 2], t[1] + NB[d * 2 + 1]);
      if (j >= 0 && !seen[j]) { seen[j] = 1; count++; stack.push(j); }
    }
  }
  return count === n - 1;
}

// Picks the tile to attack: an edge tile whose removal keeps the raft connected, not protected
// (isProtected(tx, tz) -> true for the tile a player stands on and the like). Returns an index or -1.
export function pickAttackTile(tiles, rng, isProtected = null) {
  if (!Array.isArray(tiles) || tiles.length <= 1) return -1;
  const ok = [];
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (!isEdgeTile(tiles, k) || (isProtected && isProtected(t[0], t[1])) || !keepsConnected(tiles, k)) continue;
    ok.push(k);
  }
  if (!ok.length) return -1;
  return ok[Math.min(ok.length - 1, Math.floor((rng ? rng() : 0) * ok.length))];
}

// ------------------------------------------------------------------ behaviour

// env (read every step, the caller reuses one object): {mode: MODES entry {sharkRaft, sharkBites} or null,
//   tiles, players: [{id, x, z, swimming}] (reused objects, may hold nulls), isProtected(tx, tz)}.
// Callbacks (optional, set on the brain): onAttack(tx, tz) (sets off), onRaftBite(tx, tz) (teeth in), onTileDestroyed(tx, tz) -> bool (false = could not),
//   onBite(playerId), onDriveOff(), onDeath(x, z), onRespawn().
export function createSharkBrain({ seed = 0x5ea5eed } = {}) {
  const rng = mulberry32(seed);
  const b = {
    state: 'inactive', hp: SHARK_HP, x: 0, z: 0, yaw: 0, t: 0, timer: 0, raftTimer: 0, dealt: 0,
    angle: rng() * TAU, dir: rng() < 0.5 ? -1 : 1, tx: 0, tz: 0, sx: 0, sz: 0, ax: 0, az: 0, targetId: null, ring: RING_MARGIN + 3,
    get alive() { return this.state !== 'dead' && this.state !== 'sink' && this.state !== 'gone' && this.state !== 'inactive'; },
    onAttack: null, onRaftBite: null, onTileDestroyed: null, onBite: null, onDriveOff: null, onDeath: null, onRespawn: null,
    step, hit, forceAttack, reset,
  };
  let tilesRef = null, tilesLen = -1, extCache = 0;

  function spawn() { // somewhere out on the ring, a little further out so it swims in
    b.state = 'circle'; b.hp = SHARK_HP; b.dealt = 0; b.timer = 0; b.raftTimer = 0;
    b.angle = rng() * TAU; const r = b.ring + 12; b.x = Math.cos(b.angle) * r; b.z = Math.sin(b.angle) * r;
    b.yaw = Math.atan2(-Math.sin(b.angle) * b.dir, Math.cos(b.angle) * b.dir);
  }
  function reset() { b.state = 'inactive'; b.hp = SHARK_HP; b.timer = b.raftTimer = b.dealt = 0; b.targetId = null; }

  // Turn toward (px, pz) at most TURN rad/s and swim forward at speed; arrive snaps within one step.
  function steer(px, pz, speed, dt, arrive = false) {
    const dx = px - b.x, dz = pz - b.z, d = Math.hypot(dx, dz);
    if (arrive && d <= speed * dt + 0.05) { b.x = px; b.z = pz; return true; }
    if (d > 1e-6) { const want = Math.atan2(dx, dz), dy = wrap(want - b.yaw), m = TURN * dt * (arrive && d < 4 ? 3 : 1); b.yaw = wrap(b.yaw + Math.max(-m, Math.min(m, dy))); }
    b.x += Math.sin(b.yaw) * speed * dt; b.z += Math.cos(b.yaw) * speed * dt;
    return false;
  }
  function circle(dt, speed = CIRCLE_SPEED) {
    b.angle = Math.atan2(b.z, b.x) + b.dir * Math.min(0.6, 2.4 / Math.max(1, b.ring)); // aim a little ahead on the ring
    steer(Math.cos(b.angle) * b.ring, Math.sin(b.angle) * b.ring, speed, dt);
  }
  function swimmer(env) { // nearest swimming player within HUNT_RANGE of the raft, or null
    const ps = env.players; if (!Array.isArray(ps)) return null;
    let best = null, bd = Infinity;
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k]; if (!p || !p.swimming || !fin(p.x) || !fin(p.z) || Math.hypot(p.x, p.z) > HUNT_RANGE + extCache) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function playerById(env, id) { const ps = env.players; if (Array.isArray(ps)) for (let k = 0; k < ps.length; k++) if (ps[k] && ps[k].id === id) return ps[k]; return null; }

  function beginAttack(env) {
    const tiles = env.tiles, k = pickAttackTile(tiles, rng, env.isProtected);
    if (k < 0) { b.raftTimer = 0; return false; }
    const t = tiles[k], d = openSide(tiles, k);
    b.tx = t[0]; b.tz = t[1]; b.sx = NB[d * 2]; b.sz = NB[d * 2 + 1];
    b.ax = t[0] * 2 + b.sx * (1 + EDGE_GAP); b.az = t[1] * 2 + b.sz * (1 + EDGE_GAP);
    b.state = 'approach'; b.timer = 0; b.dealt = 0; b.raftTimer = 0;
    if (b.onAttack) b.onAttack(b.tx, b.tz);
    return true;
  }
  function endAttack(next) { b.state = next; b.timer = 0; b.dealt = 0; b.raftTimer = 0; }

  function step(dt, env) {
    if (!fin(dt) || dt <= 0) return b;
    dt = Math.min(dt, 0.25); b.t += dt;
    const mode = env && env.mode;
    if (env && (env.tiles !== tilesRef || (env.tiles && env.tiles.length !== tilesLen))) { tilesRef = env.tiles; tilesLen = env.tiles ? env.tiles.length : -1; extCache = raftExtent(env.tiles); }
    b.ring = extCache + RING_MARGIN;
    if (!modeHasShark(mode)) { if (b.state !== 'inactive') reset(); return b; }
    if (b.state === 'inactive') spawn();
    const period = fin(mode.sharkRaft) ? mode.sharkRaft : 0, bites = !!mode.sharkBites;
    b.timer += dt;
    switch (b.state) {
      case 'dead': if (b.timer >= FLOAT_TIME) { b.state = 'sink'; } break;
      case 'sink': case 'gone':
        if (b.state === 'sink' && b.timer >= FLOAT_TIME + SINK_TIME) b.state = 'gone';
        if (b.timer >= RESPAWN_TIME) { spawn(); if (b.onRespawn) b.onRespawn(); }
        break;
      case 'circle': {
        circle(dt);
        const s = bites ? swimmer(env) : null;
        if (s) { b.state = 'hunt'; b.targetId = s.id; b.timer = 0; b.dealt = 0; break; }
        if (period > 0) { b.raftTimer += dt; if (b.raftTimer >= period) beginAttack(env); }
        break;
      }
      case 'approach': {
        const s = bites ? swimmer(env) : null;
        if (s) { b.state = 'hunt'; b.targetId = s.id; b.timer = 0; b.dealt = 0; b.raftTimer = Math.max(0, period - 20); break; }
        if (indexOf(env.tiles, b.tx, b.tz) < 0) { endAttack('circle'); break; } // the tile went away
        const ang = Math.atan2(b.az, b.ax), cur = Math.atan2(b.z, b.x), da = wrap(ang - cur);
        if (Math.abs(da) > 0.45) { // swing round the outside of the raft first, never through it
          const a = cur + Math.sign(da) * 0.6; steer(Math.cos(a) * b.ring, Math.sin(a) * b.ring, APPROACH_SPEED, dt);
        } else if (steer(b.ax, b.az, APPROACH_SPEED, dt, true)) { b.state = 'bite'; b.timer = 0; if (b.onRaftBite) b.onRaftBite(b.tx, b.tz); }
        if (b.timer > 60) endAttack('circle'); // stuck: give up
        break;
      }
      case 'bite': {
        const s = bites ? swimmer(env) : null;
        if (s) { b.state = 'hunt'; b.targetId = s.id; b.timer = 0; b.dealt = 0; b.raftTimer = Math.max(0, period - 20); break; }
        b.x = b.ax; b.z = b.az; b.yaw = Math.atan2(-b.sx, -b.sz) + 0.18 * Math.sin(b.t * 13); // shaking its head
        if (indexOf(env.tiles, b.tx, b.tz) < 0) { endAttack('circle'); break; }
        if (b.timer >= BITE_TIME) {
          const prot = env.isProtected && env.isProtected(b.tx, b.tz);
          const k = indexOf(env.tiles, b.tx, b.tz);
          if (!prot && keepsConnected(env.tiles, k) && b.onTileDestroyed) b.onTileDestroyed(b.tx, b.tz);
          endAttack('retreat'); b.timer = RETREAT_TIME - 6; // a short swim away after a meal
        }
        break;
      }
      case 'hunt': {
        const p = bites ? playerById(env, b.targetId) : null;
        if (!p || !p.swimming) { const s = bites ? swimmer(env) : null; if (s) b.targetId = s.id; else { b.state = 'circle'; b.timer = 0; b.targetId = null; } break; }
        if (steer(p.x, p.z, HUNT_SPEED, dt, false) || Math.hypot(p.x - b.x, p.z - b.z) < 1.3) {
          if (b.onBite) b.onBite(p.id);
          b.state = 'recoil'; b.timer = 0;
        }
        break;
      }
      case 'recoil': { // short swim away after a bite, then back for another
        const p = playerById(env, b.targetId);
        if (p) { const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz) || 1; steer(b.x + dx / d * 6, b.z + dz / d * 6, CIRCLE_SPEED * 1.4, dt); }
        else circle(dt);
        if (b.timer >= PLAYER_BITE_GAP - 0.4) { b.state = 'hunt'; b.timer = 0; }
        break;
      }
      case 'retreat': {
        const a = Math.atan2(b.z, b.x), r = b.ring + 18;
        steer(Math.cos(a + b.dir * 0.2) * r, Math.sin(a + b.dir * 0.2) * r, APPROACH_SPEED, dt);
        if (b.timer >= RETREAT_TIME) { b.state = 'circle'; b.timer = 0; }
        break;
      }
    }
    return b;
  }

  // Damage from a spear (or anything). Returns true when it landed.
  function hit(damage, point) {
    if (!b.alive || !fin(damage) || damage <= 0) return false;
    b.hp = Math.max(0, b.hp - damage);
    if (b.hp <= 0) {
      b.state = 'dead'; b.timer = 0; b.dealt = 0; b.targetId = null;
      if (b.onDeath) b.onDeath(b.x, b.z);
      return true;
    }
    if (b.state === 'approach' || b.state === 'bite' || b.state === 'hunt' || b.state === 'recoil') {
      b.dealt += damage;
      if (b.dealt >= DRIVE_OFF) { endAttack('retreat'); b.targetId = null; if (b.onDriveOff) b.onDriveOff(); }
    }
    return true;
  }

  // Debug/QA: start a raft attack now (from wherever it is). Returns the target tile or null.
  function forceAttack(env, instant = false) {
    if (!env || !env.mode) return null;
    if (b.state === 'inactive' || !b.alive) spawn();
    if (!beginAttack(env)) return null;
    if (instant) { b.x = b.ax; b.z = b.az; b.yaw = Math.atan2(-b.sx, -b.sz); b.state = 'bite'; b.timer = 0; if (b.onRaftBite) b.onRaftBite(b.tx, b.tz); }
    return { tx: b.tx, tz: b.tz };
  }

  return b;
}
// Does a mode entry have a shark at all? Relaxed (no damage, no needs) has none.
export function modeHasShark(mode) { return !!mode && !(mode.sharkRaft === 0 && !mode.sharkBites && mode.damage === 0); }

// ------------------------------------------------------------------ pose (shared by host and guest render)

// out: {y (relative to the water surface), pitch, roll, sway (tail amplitude 0..1), visible}
export function sharkPose(state, t, timer, out) {
  out.visible = state !== 'inactive' && state !== 'gone'; out.pitch = 0; out.roll = 0; out.sway = 1; out.y = -0.5;
  switch (state) {
    case 'circle': case 'retreat': out.y = -0.52 + 0.04 * Math.sin(t * 0.9); out.roll = 0.05 * Math.sin(t * 0.7); break;
    case 'approach': out.y = -0.42; out.sway = 1.4; break;
    case 'bite': out.y = -0.14 + 0.07 * Math.sin(t * 9); out.pitch = -0.3; out.roll = 0.38 * Math.sin(t * 13); out.sway = 2; break;
    case 'hunt': out.y = -0.4; out.sway = 1.6; break;
    case 'recoil': out.y = -0.55; out.sway = 1.2; break;
    case 'dead': out.y = -0.05 + 0.03 * Math.sin(t * 1.3); out.roll = Math.PI; out.sway = 0; break;
    case 'sink': { const u = Math.min(1, Math.max(0, (timer - FLOAT_TIME) / SINK_TIME)); out.y = -0.05 - 6 * u * u; out.roll = Math.PI - 0.6 * u; out.pitch = 0.3 * u; out.sway = 0; break; }
  }
  return out;
}

// ------------------------------------------------------------------ model

// Original low-poly shark, ~3.9 m nose to tail tip. Nose +z, up +y, origin at the body centre. One merged geometry with
// position, normal, color and `swayW` (0 at the head, 1 at the tail tip) for the vertex-shader tail sway.
export function sharkGeometry(T) {
  const back = 0x56697c, flank = 0x6f8396, belly = 0xe4e9ea, finC = 0x4b5d6f, dark = 0x1a1e24;
  const P = [];
  const add = (geo, color, place) => {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (place) {
      const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
      g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));
    }
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new T.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i)) : color);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (!g.attributes.normal) g.computeVertexNormals();
    P.push(g);
  };
  const tri = pts => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); g.computeVertexNormals(); return g; };
  // body: a lathe profile (radius by length), turned to lie along z, slightly taller than wide. Counter-shaded.
  const prof = [[0, -1.75], [0.08, -1.6], [0.16, -1.25], [0.28, -0.7], [0.39, -0.1], [0.43, 0.3], [0.39, 0.75], [0.3, 1.1], [0.18, 1.42], [0.07, 1.66], [0, 1.78]];
  const lathe = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 12);
  const shade = (x, y, z) => (y > 0.12 ? back : y > -0.12 ? flank : belly);
  lathe.rotateX(Math.PI / 2); // lathe y (length) -> z
  lathe.scale(0.92, 1.05, 1);
  { // wedge the head: flatter, with the snout tip dropped a touch, so it reads as a shark (not a ball) head-on
    const a = lathe.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const z = a.getZ(i), u = Math.min(1, Math.max(0, (z - 0.55) / 1.2));
      if (u > 0) { a.setY(i, a.getY(i) * (1 - 0.3 * u) - 0.06 * u * u); a.setX(i, a.getX(i) * (1 + 0.08 * u)); }
    }
    lathe.computeVertexNormals();
  }
  add(lathe, shade);
  // dorsal fin: tall, straight leading edge raked back, slightly concave trailing edge. A thin wedge.
  const D = [[0, 0.55], [0.62, -0.12], [0.5, -0.2], [0.18, -0.25], [0, -0.32]]; // [y, z] outline: base front, tip, trailing edge, base rear
  const dF = [];
  for (const s of [-1, 1]) {
    const w = y => s * 0.06 * (1 - y / 0.65);
    const q = (a, bb, cc) => dF.push(w(a[0]), a[0], a[1], w(bb[0]), bb[0], bb[1], w(cc[0]), cc[0], cc[1]);
    q(D[0], D[1], D[4]); q(D[1], D[2], D[4]); q(D[2], D[3], D[4]);
  }
  add(tri(dF), finC, [0, 0.4, 0.15]);
  add(tri([0, 0, 0.12, 0, 0.2, -0.1, 0, 0, -0.14]), finC, [0, 0.2, -1.0]); // small second dorsal
  // tail: tall upper lobe, short lower lobe (heterocercal), on the tail stock
  add(tri([0, 0, 0.1, 0, 0.95, -0.55, 0, 0.78, -0.62, 0, 0, 0.1, 0, 0.78, -0.62, 0, 0, -0.2]), finC, [0, 0.02, -1.62]);
  add(tri([0, 0, 0.05, 0, -0.5, -0.32, 0, -0.38, -0.4, 0, 0, 0.05, 0, -0.38, -0.4, 0, 0, -0.18]), finC, [0, 0.02, -1.62]);
  // pectoral fins: long, swept back and angled down
  for (const s of [-1, 1]) add(tri([0, 0, 0.3, s * 0.85, -0.05, -0.45, s * 0.7, -0.03, -0.55, 0, 0, 0.3, s * 0.7, -0.03, -0.55, 0, 0, -0.08]), finC, [s * 0.32, -0.18, 0.55, 0, 0, s * -0.38]);
  // eyes and gill slits
  for (const s of [-1, 1]) add(new T.SphereGeometry(0.05, 6, 4), dark, [s * 0.255, 0.05, 1.12]);
  // gaping jaw under the snout: a dark gape hanging below the head with white teeth round both rims (reads head-on while it bites)
  const under = (x, z) => -0.36 + (z - 0.9) * 0.42 + x * x * 0.9; // just outside the flattened underside
  const M = [[-0.27, 0.9], [-0.19, 1.12], [0, 1.26], [0.19, 1.12], [0.27, 0.9]], gape = 0.16, recess = 0.1;
  const jaw = [], teeth = [];
  const up = (x, z) => [x, under(x, z), z], lo = (x, z) => [x * 0.85, under(x, z) - gape, z - recess];
  for (let k = 0; k < M.length - 1; k++) {
    const [x0, z0] = M[k], [x1, z1] = M[k + 1];
    jaw.push(...up(x0, z0), ...up(x1, z1), ...lo(x1, z1), ...up(x0, z0), ...lo(x1, z1), ...lo(x0, z0));
  }
  for (let k = 0; k <= 8; k++) {
    const f = k / 8, a = (f - 0.5) * 2.2, x = Math.sin(a) * 0.26, z = 0.9 + Math.cos(a) * 0.36, w = 0.028, tx = Math.cos(a) * w, tz = -Math.sin(a) * w;
    const [ux, uy, uz] = up(x, z), [lx, ly, lz] = lo(x, z);
    teeth.push(ux - tx, uy, uz - tz, ux + tx, uy, uz + tz, ux, uy - 0.07, uz - 0.02);   // upper row, pointing down
    teeth.push(lx - tx, ly, lz - tz, lx + tx, ly, lz + tz, lx, ly + 0.06, lz + 0.02);   // lower row, pointing up
  }
  add(tri(jaw), 0x3a1c22, [0, 0, 0]);
  add(tri(teeth), 0xf4f1e6, [0, 0, 0]);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) add(new T.BoxGeometry(0.02, 0.2, 0.022), 0x3f4e5d, [s * 0.365, 0.0, 0.72 - k * 0.09]);
  // merge + sway weight
  let n = 0; for (const g of P) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), sw = new Float32Array(n);
  let o = 0;
  for (const g of P) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; sw[i] = z > 0.4 ? 0 : Math.min(1, ((0.4 - z) / 2.6) ** 1.5); }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.setAttribute('swayW', new T.BufferAttribute(sw, 1));
  geo.computeBoundingSphere();
  return geo;
}

// One Mesh, one draw call. mesh.userData.uniforms.uSway {value: [phase, amplitude]} drives the tail.
export function createSharkModel(T) {
  const geo = sharkGeometry(T);
  const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide });
  const uniforms = { uSway: { value: new T.Vector2(0, 1) } };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSway = uniforms.uSway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float swayW;\nuniform vec2 uSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.x += sin(uSway.x - transformed.z * 1.6) * 0.32 * swayW * uSway.y;`);
  };
  mat.customProgramCacheKey = () => 'shark-sway';
  const mesh = new T.Mesh(geo, mat);
  mesh.name = 'shark'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
  mesh.userData.uniforms = uniforms;
  mesh.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return mesh;
}

// ------------------------------------------------------------------ runtime (browser glue, used by game.js)

const STATES = ['inactive', 'circle', 'approach', 'bite', 'hunt', 'recoil', 'retreat', 'dead', 'sink', 'gone'];

// host: {T, scene, ocean, bus, modes (MODES), role() -> 'solo'|'host'|'guest', tiles() -> world tiles,
//   local() -> {x, z, swimming} (this player), other() -> remote pose or null,
//   isProtected(tx, tz), destroyTile(tx, tz) -> bool, emit(e, to), play(name, vol), action(a)}
// Host/solo simulate the brain; a guest renders the pose from netLoad(). bus.shark is set here.
export function createSharkRuntime(host) {
  const T = host.T, brain = createSharkBrain({ seed: (Date.now() ^ 0x5ea5eed) | 0 });
  const mesh = createSharkModel(T); host.scene.add(mesh);
  const uni = mesh.userData.uniforms.uSway.value;
  const pose = { y: 0, pitch: 0, roll: 0, sway: 1, visible: false };
  const v3 = new T.Vector3(), q4 = new T.Quaternion(), eul = new T.Euler(0, 0, 0, 'YXZ'), one = new T.Vector3(1, 1, 1);
  const P0 = { id: 'host', x: 0, z: 0, swimming: false }, P1 = { id: 'guest', x: 0, z: 0, swimming: false };
  const env = { mode: null, tiles: null, players: [P0, P1], isProtected: (x, z) => !!host.isProtected(x, z) };
  const position = { x: 0, y: 0, z: 0 };
  const guest = { has: false, x: 0, z: 0, yaw: 0, s: 'inactive', tm: 0, rx: 0, rz: 0, ryaw: 0 }; // received + rendered
  let debugMode = null, phase = 0, chomp = 0, disposed = false;
  const isGuest = () => host.role() === 'guest';
  const modeNow = () => debugMode || (host.modes && host.modes[host.bus.mode]) || null;

  const api = {
    hit(damage, point) {
      if (isGuest()) { // the host owns the shark: forward the hit
        if (!api.alive || !fin(damage) || damage <= 0) return false;
        host.action({ kind: 'sharkHit', d: Math.min(200, damage) }); return true;
      }
      return brain.hit(damage, point);
    },
    get state() { return isGuest() ? guest.s : brain.state; },
    get alive() { const s = api.state; return s !== 'dead' && s !== 'sink' && s !== 'gone' && s !== 'inactive'; },
    get hp() { return brain.hp; },
    position,
    onDeath: null, // the spear lane sets this to drop meat: onDeath({x, y, z})
  };
  host.bus.shark = api;

  brain.onRaftBite = () => { host.emit({ kind: 'notice', text: 'Something is biting the raft!', sound: 'splash' }, 'all'); };
  brain.onTileDestroyed = (x, z) => !!host.destroyTile(x, z);
  brain.onBite = id => host.emit({ kind: 'sharkBite', text: 'The shark bit you!', sound: 'deny' }, id === 'guest' ? 'guest' : 'host');
  brain.onDriveOff = () => host.emit({ kind: 'notice', text: 'The shark swims off', sound: 'splash' }, 'all');
  brain.onDeath = (x, z) => {
    host.emit({ kind: 'notice', text: 'The shark is dead', sound: 'splash' }, 'all');
    position.x = x; position.z = z;
    try { if (typeof api.onDeath === 'function') api.onDeath({ x, y: position.y, z }); } catch (e) { console.warn('shark onDeath failed', e); }
  };

  function update(dt, elapsed) {
    if (disposed) return;
    let x, z, yaw, s, tm;
    if (isGuest()) {
      if (!guest.has) { mesh.visible = false; return; }
      const k = Math.min(1, dt * 6);
      const jump = Math.hypot(guest.x - guest.rx, guest.z - guest.rz) > 12;
      guest.rx = jump ? guest.x : guest.rx + (guest.x - guest.rx) * k; guest.rz = jump ? guest.z : guest.rz + (guest.z - guest.rz) * k;
      guest.ryaw = wrap(guest.ryaw + wrap(guest.yaw - guest.ryaw) * k); guest.tm += dt;
      x = guest.rx; z = guest.rz; yaw = guest.ryaw; s = guest.s; tm = guest.tm;
    } else {
      const l = host.local(), o = host.other();
      P0.x = l ? l.x : 0; P0.z = l ? l.z : 0; P0.swimming = !!(l && l.swimming);
      P1.swimming = !!(o && o.swimming && fin(o.x) && fin(o.z)); P1.x = P1.swimming ? o.x : 0; P1.z = P1.swimming ? o.z : 0;
      env.mode = modeNow(); env.tiles = host.tiles();
      brain.step(dt, env);
      x = brain.x; z = brain.z; yaw = brain.yaw; s = brain.state; tm = brain.timer;
    }
    sharkPose(s, elapsed, tm, pose);
    mesh.visible = pose.visible;
    position.x = x; position.z = z;
    if (!pose.visible) return;
    const h = host.ocean ? host.ocean.getHeight(x, z) : 0;
    position.y = h + pose.y;
    v3.set(x, position.y, z); eul.set(pose.pitch, yaw, pose.roll, 'YXZ'); q4.setFromEuler(eul);
    mesh.matrix.compose(v3, q4, one); mesh.matrixWorldNeedsUpdate = true;
    phase += dt * (3 + 3 * pose.sway); uni.x = phase; uni.y = pose.sway;
    if (s === 'bite') { chomp += dt; if (chomp > 2.6) { chomp = 0; host.play('splash', 0.45); } } else chomp = 0;
  }

  // Host -> guest pose, sent with each state snapshot (~8 Hz). null while there is no shark.
  function netPose() {
    if (isGuest() || brain.state === 'inactive') return null;
    return { x: Math.round(brain.x * 100) / 100, z: Math.round(brain.z * 100) / 100, yaw: Math.round(brain.yaw * 1000) / 1000, s: brain.state, tm: Math.round(brain.timer * 10) / 10 };
  }
  function netLoad(p) {
    if (!p || typeof p !== 'object' || !fin(p.x) || !fin(p.z) || !fin(p.yaw) || !STATES.includes(p.s) || Math.abs(p.x) > 500 || Math.abs(p.z) > 500) { guest.has = false; guest.s = 'inactive'; return; }
    if (!guest.has) { guest.rx = p.x; guest.rz = p.z; guest.ryaw = p.yaw; }
    guest.has = true; guest.x = p.x; guest.z = p.z; guest.yaw = p.yaw; guest.s = p.s;
    if (fin(p.tm)) guest.tm = p.tm;
  }
  // QA: start a raft attack now (host/solo). In a mode without raft attacks it uses Normal rules from then on.
  function debugAttack(instant = true) {
    if (isGuest()) return null;
    const m = modeNow(); if (!modeHasShark(m) || m.sharkRaft === 0) debugMode = host.modes.normal;
    env.mode = modeNow(); env.tiles = host.tiles();
    return brain.forceAttack(env, instant);
  }
  function dispose() {
    disposed = true; mesh.removeFromParent(); mesh.userData.dispose();
    if (host.bus.shark === api) host.bus.shark = null;
  }
  return { update, netPose, netLoad, debugAttack, dispose, brain, mesh, api,
    debug: () => ({ state: api.state, hp: brain.hp, x: position.x, y: position.y, z: position.z, tile: brain.state === 'approach' || brain.state === 'bite' ? [brain.tx, brain.tz] : null, timer: brain.timer, raftTimer: brain.raftTimer, mode: debugMode ? 'debug-normal' : host.bus.mode }),
    clearDebugMode() { debugMode = null; } };
}
