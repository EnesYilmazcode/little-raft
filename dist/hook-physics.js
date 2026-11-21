// hook-physics.js — ballistic throwable hook + multi-catch reeling (pure logic, no scene/DOM/audio).
//
// All numeric constants below are OUR tuning values for this game. They are not taken from,
// and do not claim to reproduce, any other game's internals.
//
// API
//   new HookCast(T, { origin, direction, target, maxRange = 32, charge = 1, drift, deck })
//     T         : the THREE namespace (only T.Vector3 is used)
//     origin    : Vector3-like throw start (player hand, y ~ 1.2). Copied, never mutated.
//     direction : Vector3-like camera aim. Copied and normalized. Elevation decides the arc/range.
//     target    : LEGACY ONLY. Used solely to derive a direction (target - origin) when `direction`
//                 is missing/invalid. The hook is never snapped/teleported to it.
//     maxRange  : rope length (m), measured horizontally from the *current* hand.
//     charge    : [0,1]; launch speed = 7 + charge * 11 m/s (+1.0 m/s upward throw boost).
//     drift     : optional {x,z} m/s water drift for the floating hook. Default mirrors game.js
//                 item drift (z += .22/s, x += sin(time*.13)*.04/s) so hook and supplies co-drift.
//     deck      : optional (x, z) -> deck surface y, or null over water. A hook coming down onto
//                 the raft rests on the planks (onDeck) instead of falling through to the water.
//                 `deckAt` is accepted as an older name for the same callback.
//
//   Public fields
//     position    : Vector3  current hook position
//     velocity    : Vector3  current flight velocity (zero after splash)
//     stage       : 'flying' | 'floating' | 'reeling' | 'done'
//     caughtItems : Array<{ id, token, type }> (max 8), in catch order
//     caught      : getter -> caughtItems[0] ?? null (back-compat)
//     distance    : horizontal distance from last known hand to hook
//     tension     : [0,1] rope tension (0 slack, 1 taut)
//     tethered    : true once the rope hit maxRange during flight (horizontal motion stopped)
//     landing     : null while flying, then Vector3 splash point (actual ballistic x/z, y = WATER_Y
//                   or the deck height when it landed on the raft)
//     onDeck      : true while the hook rests on (or is reeled across) the deck
//     flightT     : seconds spent in flight (used by game.js for the spin animation)
//
//   update(dt, { hand, items, reeling = false, time, skip })
//     -> null | { kind:'collected', items:[{id,token,type}...], id, token } | { kind:'returned' }
//     items: Array of { id, token, type, x, z } (or with .position). Never mutated.
//     skip : optional predicate skip(item) -> truthy to ignore that item, exactly as if it were
//            absent from `items` (not catchable; a caught entry matching only skipped items is
//            dropped). Lets callers pass their live item array instead of a filtered copy, e.g.
//            hook.update(dt, { hand, items: world.items, skip: isPending, reeling, time }).
//     When `items` is an array, caught entries whose id/token vanished are dropped.
//     The per-frame path (update/ropePoints with `out`) allocates nothing.
//     The event is emitted EXACTLY ONCE, when a reeling hook comes within 0.7 m of the hand.
//
//   caughtPosition(index = 0, out?) -> Vector3 | null   bundled render spot for caughtItems[index]
//   ropePoints(hand, segments = 16, out?) -> Array<Vector3>   hand -> hook. Without `out` the array and
//     vectors are reused per hook. With `out` (an array, ideally of Vector3s) it is filled in place:
//     missing/invalid entries are replaced by new Vector3s, length is set to segments + 1; returns `out`.
//   cancel() -> stage = 'done' (no event)

export const WATER_Y = 0.05;

const GRAVITY = 9.8;              // m/s^2
const BASE_SPEED = 7;             // m/s launch speed at charge 0
const CHARGE_SPEED = 11;          // extra m/s at charge 1
const UP_BOOST = 1.0;             // m/s added to vertical launch velocity (throw flick)
const MAX_DT = 0.05;              // s, frame dt clamp
const SUBSTEP = 0.01;             // s, max integration step (≤ ~0.2 m per step at full speed)
const MAX_FLIGHT_TIME = 8;        // s, safety: force a splash if somehow never reaching water
const REEL_SPEED = 8;             // m/s horizontal reel speed
const CATCH_RADIUS = 1.0;         // m, swept catch radius while floating / reeling / at splash
const CATCH_RADIUS_FLIGHT = 0.65; // m, swept catch radius during flight near the water
const FLIGHT_CATCH_HEIGHT = 0.35; // m above WATER_Y where a flying hook can snag things
const COLLECT_DIST = 0.7;         // m, hook-to-hand distance that completes a reel
const MAX_CAUGHT = 8;
const MAX_SAG_BELOW = 0.12;       // m, rope may dip this far under WATER_Y
const BOB_AMP = 0.04, BOB_FREQ = 2.6, BOB_LIFT = 0.03; // floating bob (m, rad/s, m)
const REEL_SKIM = 0.06, REEL_RISE_DIST = 2;           // reeling: skim height, rise-to-hand zone (m)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const finVec = (v) => !!v && fin(v.x) && fin(v.y) && fin(v.z);
// Math.hypot is a varargs builtin that V8 does not lower: it allocates on every call. Hot paths use these.
const len2 = (x, z) => Math.sqrt(x * x + z * z);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export class HookCast {
  constructor(T, { origin, direction, target, maxRange = 32, charge = 1, drift, deck, deckAt } = {}) {
    this.T = T;
    const o = finVec(origin) ? origin : { x: 0, y: 1.2, z: 0 };
    this.origin = new T.Vector3(o.x, o.y, o.z);
    this.maxRange = fin(maxRange) && maxRange > 0 ? Math.max(1, maxRange) : 32;
    this.charge = clamp(fin(charge) ? charge : 1, 0, 1);

    // Direction: explicit aim > legacy (target - origin) > straight ahead (-Z).
    const dir = new T.Vector3(0, 0, -1);
    if (finVec(direction) && Math.hypot(direction.x, direction.y, direction.z) > 1e-6) {
      dir.set(direction.x, direction.y, direction.z);
    } else if (finVec(target)) {
      const tx = target.x - o.x, ty = target.y - o.y, tz = target.z - o.z;
      if (Math.hypot(tx, ty, tz) > 1e-6) dir.set(tx, ty, tz);
    }
    dir.normalize();
    this.direction = dir;

    const speed = BASE_SPEED + this.charge * CHARGE_SPEED;
    this.velocity = new T.Vector3(dir.x * speed, dir.y * speed + UP_BOOST, dir.z * speed);
    this.drift = drift && (fin(drift.x) || fin(drift.z))
      ? { x: fin(drift.x) ? drift.x : 0, z: fin(drift.z) ? drift.z : 0 } : null;

    this.deck = typeof deck === 'function' ? deck : typeof deckAt === 'function' ? deckAt : null; // deckAt: older name
    this.position = this.origin.clone();
    this.stage = 'flying';
    this.caughtItems = [];
    this.distance = 0;
    this.tension = 0;
    this.tethered = false;
    this.landing = null;
    this.flightT = 0;
    this.onDeck = false;
    this.floatTime = 0;
    this.base = this.origin.clone(); // floating anchor on the water (bob applied on top)
    this._hand = this.origin.clone();
    this._clock = 0;
    this._emitted = false;
    this._ropePts = [];
    this._skip = null; // per-update skip predicate (see update)
    this._h = 0.01;    // current substep length (s) and its sim time, set by update()
    this._t = 0.01;

    // Thrown from at/below the water: it is simply in the water where it is.
    if (this.position.y <= WATER_Y) this._splash(this.position.x, this.position.z, null);
  }

  get caught() { return this.caughtItems.length ? this.caughtItems[0] : null; }
  set caught(v) { this.caughtItems.length = 0; if (v) this.caughtItems.push({ id: v.id, token: v.token, type: v.type }); }

  // ---------- catching ----------

  _isCaught(it) {
    const c = this.caughtItems, id = it.id, token = it.token;
    for (let i = 0; i < c.length; i++) if (c[i].id === id && c[i].token === token) return true;
    return false;
  }

  /** Catch every not-yet-caught item within `radius` of the horizontal segment A->B. */
  _sweep(items, ax, az, bx, bz, radius) {
    if (!items || this.caughtItems.length >= MAX_CAUGHT) return;
    const r2 = radius * radius, skip = this._skip;
    // Segment terms hoisted out of the item loop (squared point-to-segment distance, inlined).
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, il2 = l2 > 1e-12 ? 1 / l2 : 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      const pos = it.position;
      const x = pos ? pos.x : it.x, z = pos ? pos.z : it.z;
      if (!fin(x) || !fin(z)) continue;
      let t = ((x - ax) * dx + (z - az) * dz) * il2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      if (ex * ex + ez * ez > r2 || this._isCaught(it) || (skip && skip(it))) continue;
      this.caughtItems.push({ id: it.id, token: it.token, type: it.type });
      if (this.caughtItems.length >= MAX_CAUGHT) return;
    }
  }

  /** Flight sweep: only the part of the segment within FLIGHT_CATCH_HEIGHT of the water counts. */
  _sweepFlight(items, ax, ay, az, bx, by, bz) {
    const lim = WATER_Y + FLIGHT_CATCH_HEIGHT;
    if (ay > lim && by > lim) return;
    let sx = ax, sz = az, ex = bx, ez = bz;
    if (ay > lim) { const f = (ay - lim) / (ay - by); sx = ax + (bx - ax) * f; sz = az + (bz - az) * f; }
    else if (by > lim) { const f = (lim - ay) / (by - ay); ex = ax + (bx - ax) * f; ez = az + (bz - az) * f; }
    this._sweep(items, sx, sz, ex, ez, CATCH_RADIUS_FLIGHT);
  }

  _prune(items) {
    const c = this.caughtItems, skip = this._skip;
    for (let i = c.length - 1; i >= 0; i--) {
      const id = c[i].id, token = c[i].token;
      let found = false;
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (it && it.id === id && it.token === token && !(skip && skip(it))) { found = true; break; }
      }
      if (!found) c.splice(i, 1);
    }
  }

  // ---------- integration ----------

  /** Keep (x,z) within maxRange of the hand. Returns true if it had to clamp. */
  _tether(p) {
    const h = this._hand, dx = p.x - h.x, dz = p.z - h.z, d = len2(dx, dz);
    if (d <= this.maxRange || d < 1e-9) return false;
    const k = this.maxRange / d;
    p.x = h.x + dx * k; p.z = h.z + dz * k;
    return true;
  }

  /** Deck surface y at (x,z), or null over water. */
  _deckAt(x, z) {
    if (!this.deck) return null;
    const y = this.deck(x, z);
    return fin(y) && y > WATER_Y ? y : null;
  }

  _splash(x, z, items, y = WATER_Y) {
    this.onDeck = y > WATER_Y;
    this.position.set(x, y, z);
    this.base.set(x, WATER_Y, z);
    this.landing = new this.T.Vector3(x, y, z);
    this.velocity.set(0, 0, 0);
    this.stage = 'floating';
    if (items && !this.onDeck) this._sweep(items, x, z, x, z, CATCH_RADIUS);
  }

  _stepFlight(items) {
    const h = this._h;
    const p = this.position, v = this.velocity;
    const px = p.x, py = p.y, pz = p.z;
    let nx = px + v.x * h, nz = pz + v.z * h;
    const ny = py + v.y * h - 0.5 * GRAVITY * h * h;
    v.y -= GRAVITY * h;
    { // tether (same as _tether, on scalars): rope taut -> stop horizontal motion, just drop
      const hd = this._hand, dx = nx - hd.x, dz = nz - hd.z, d = len2(dx, dz);
      if (d > this.maxRange && d >= 1e-9) {
        const k = this.maxRange / d;
        nx = hd.x + dx * k; nz = hd.z + dz * k;
        v.x = 0; v.z = 0; this.tethered = true;
      }
    }
    this.flightT += h;
    // Only a hook coming down from above the planks can land on them.
    const dy = this._deckAt(nx, nz), floor = dy !== null && py >= dy ? dy : WATER_Y;
    if (ny <= floor || this.flightT >= MAX_FLIGHT_TIME) {
      const f = ny <= floor && py > ny ? clamp((py - floor) / (py - ny), 0, 1) : 1;
      const sx = px + (nx - px) * f, sz = pz + (nz - pz) * f;
      if (floor === WATER_Y) this._sweepFlight(items, px, py, pz, sx, WATER_Y, sz);
      this._splash(sx, sz, items, floor);
      return;
    }
    // Guarded here so the common high-flight substep makes no call (double args would be boxed).
    const lim = WATER_Y + FLIGHT_CATCH_HEIGHT;
    if (items && (py <= lim || ny <= lim)) this._sweepFlight(items, px, py, pz, nx, ny, nz);
    p.set(nx, ny, nz);
  }

  _stepFloat(items) {
    const h = this._h, time = this._t;
    const b = this.base, ax = b.x, az = b.z;
    if (this.onDeck) { // resting on the planks: no drift, no bob, only the rope can drag it
      this._tether(b);
      const dy = this._deckAt(b.x, b.z);
      if (dy !== null) { this.position.set(b.x, dy, b.z); return; }
      this.onDeck = false; // dragged off the edge: back in the water
    }
    const vx = this.drift ? this.drift.x : Math.sin(time * 0.13) * 0.04;
    const vz = this.drift ? this.drift.z : 0.22;
    b.x += vx * h; b.z += vz * h;
    const dragged = this._tether(b); // a walking player drags the floating hook along
    const dy = this._deckAt(b.x, b.z);
    if (dy !== null) {
      // The rope hauls it up onto the planks; plain drift just bumps it against the hull.
      if (dragged) { this.onDeck = true; this.position.set(b.x, dy, b.z); return; }
      b.x = ax; b.z = az;
    }
    this.floatTime += h;
    this._sweep(items, ax, az, b.x, b.z, CATCH_RADIUS);
    this.position.set(b.x, WATER_Y + Math.sin(this.floatTime * BOB_FREQ) * BOB_AMP + BOB_LIFT, b.z);
  }

  /** Returns true when the hook reached the hand. */
  _stepReel(items) {
    const h = this._h;
    const p = this.position, hd = this._hand, ax = p.x, az = p.z;
    const dx = hd.x - ax, dz = hd.z - az, d = len2(dx, dz);
    if (d > 1e-9) { const k = Math.min(1, (REEL_SPEED * h) / d); p.x += dx * k; p.z += dz * k; }
    this._sweep(items, ax, az, p.x, p.z, CATCH_RADIUS);
    const rem = len2(hd.x - p.x, hd.z - p.z);
    const rise = clamp(1 - rem / REEL_RISE_DIST, 0, 1);
    const dy = this._deckAt(p.x, p.z), floor = dy !== null ? dy : WATER_Y;
    this.onDeck = dy !== null;
    p.y = Math.max(floor, floor + REEL_SKIM + (hd.y - floor) * rise);
    this.base.set(p.x, WATER_Y, p.z);
    return rem <= COLLECT_DIST;
  }

  update(dt, { hand, items, reeling = false, time, skip } = {}) {
    if (this.stage === 'done') return null;
    this._skip = typeof skip === 'function' ? skip : null;
    dt = clamp(fin(dt) ? dt : 0, 0, MAX_DT);
    if (finVec(hand)) this._hand.set(hand.x, hand.y, hand.z);
    this._clock += dt;
    const t = fin(time) ? time : this._clock;
    const list = Array.isArray(items) ? items : null;
    if (list) this._prune(list);

    // Reel input only matters once the hook is in the water.
    if (this.stage === 'floating' && reeling) this.stage = 'reeling';
    else if (this.stage === 'reeling' && !reeling) { // let go: float where it is
      this.stage = 'floating';
      this.base.set(this.position.x, WATER_Y, this.position.z);
      this.onDeck = this._deckAt(this.position.x, this.position.z) !== null;
    }

    let arrived = false;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9)), h = dt / steps;
    if (dt > 0) {
      for (let i = 0; i < steps && !arrived; i++) {
        // Substep inputs go through fields: double args to these (non-inlined) calls get boxed.
        this._h = h; this._t = t + h * (i + 1) - dt;
        if (this.stage === 'flying') this._stepFlight(list);
        else if (this.stage === 'floating') this._stepFloat(list);
        else if (this.stage === 'reeling') arrived = this._stepReel(list);
      }
    } else if (this.stage === 'reeling') {
      arrived = len2(this._hand.x - this.position.x, this._hand.z - this.position.z) <= COLLECT_DIST;
    }

    this._skip = null; // don't retain the caller's closure between frames
    if (arrived) {
      this.stage = 'done';
      this._updateMetrics();
      if (this._emitted) return null;
      this._emitted = true;
      return this._result();
    }
    this._updateMetrics();
    return null;
  }

  _result() {
    if (!this.caughtItems.length) return { kind: 'returned' };
    const out = this.caughtItems.map(({ id, token, type }) => ({ id, token, type }));
    return { kind: 'collected', items: out, id: out[0].id, token: out[0].token };
  }

  _updateMetrics() {
    const h = this._hand;
    this.distance = len2(this.position.x - h.x, this.position.z - h.z);
    const has = this.caughtItems.length > 0;
    if (this.stage === 'flying') this.tension = this.tethered ? 1 : 0;
    else if (this.stage === 'reeling' || this.stage === 'done') this.tension = has ? 1 : 0.8;
    else {
      const r = clamp(this.distance / this.maxRange, 0, 1);
      this.tension = clamp((has ? 0.35 : 0.1) + 0.65 * r * r * r * r, 0, 1);
    }
  }

  /** Bundled render spot for caughtItems[index]: a small cluster trailing the hook. Pure. */
  caughtPosition(index = 0, out) {
    index = fin(index) ? Math.floor(index) : 0;
    if (index < 0 || index >= this.caughtItems.length) return null;
    const p = this.position, h = this._hand;
    let bx = p.x - h.x, bz = p.z - h.z;
    const l = len2(bx, bz);
    if (l > 1e-6) { bx /= l; bz /= l; } else { bx = 0; bz = 1; }
    // index 0 sits right behind the hook; the rest spiral around it (golden angle).
    const back = 0.15 + (index ? 0.2 : 0);
    const r = index ? 0.28 + 0.05 * index : 0;
    const a = index * 2.39996;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const o = out || new this.T.Vector3();
    return o.set(p.x + bx * back + ox, Math.max(WATER_Y, p.y - 0.15), p.z + bz * back + oz);
  }

  /** Rope polyline hand -> hook. Sag proportional to slack. The returned array is reused. */
  ropePoints(hand, segments = 16, out) {
    const h = finVec(hand) ? hand : this._hand;
    const n = Math.max(1, Math.floor(fin(segments) ? segments : 16));
    const pts = Array.isArray(out) ? out : this._ropePts;
    for (let i = 0; i <= n; i++) {
      const q = pts[i];
      if (!q || typeof q.set !== 'function') pts[i] = new this.T.Vector3();
    }
    if (pts.length !== n + 1) pts.length = n + 1;
    const p = this.position;
    const span = len3(p.x - h.x, p.y - h.y, p.z - h.z);
    const slack = this.stage === 'flying' ? (this.tethered ? 0 : 0.15) : 1 - this.tension;
    const sag = span * 0.12 * slack;
    const floorY = WATER_Y - MAX_SAG_BELOW;
    for (let i = 0; i <= n; i++) {
      const t = i / n, q = pts[i];
      q.set(h.x + (p.x - h.x) * t, h.y + (p.y - h.y) * t, h.z + (p.z - h.z) * t);
      if (i > 0 && i < n) q.y = Math.max(floorY, q.y - sag * 4 * t * (1 - t));
    }
    return pts;
  }

  cancel() {
    this.stage = 'done';
    this.tension = 0;
  }
}

export default HookCast;

// ---------- throw start (used by game.js) ----------
export const MIN_THROW_Y = WATER_Y + 0.3; // a swimmer's hand sits under the 0.05 plane: start the throw above it

/** Throw origin from the hand: same x/z, y lifted to at least MIN_THROW_Y. Pure. */
export function throwOrigin(hand, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  o.x = hand.x; o.y = Math.max(hand.y, MIN_THROW_Y); o.z = hand.z;
  return o;
}

// ---------- bag-full reel stop (used by game.js) ----------
export const FULL_HOLD_DIST = 2; // m: a catch that will not fit stops this far out, still in the water

/** Sums the loot of every caught item. table: type -> {kind: count}, or a function item -> {kind: count}. Pure. */
export function catchLoot(items, table) {
  const out = {}, of = typeof table === 'function' ? table : it => table?.[it?.type];
  for (const it of items || []) for (const [k, n] of Object.entries(of(it) || {})) out[k] = (out[k] || 0) + n;
  return out;
}

/** True when the reel must stop short of the hand because the catch will not fit. fits(caughtItems) -> bool. */
export function holdForFullBag(hook, fits) {
  const c = hook?.caughtItems;
  return !!c?.length && fin(hook.distance) && hook.distance <= FULL_HOLD_DIST && !fits(c);
}
