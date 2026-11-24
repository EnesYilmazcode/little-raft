// Little Raft - first-person player physics.
// Pure ES module: no DOM, no THREE, no dependencies.
// Position (x, y, z) is the EYE position. Feet are at y - EYE_OFFSET.
// Tiles are integer [tx, tz] pairs; each covers a 2x2 square centred on (tx*2, tz*2).
// Movement convention matches game.js: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).

export const PLAYER_CONSTANTS = Object.freeze({
  WALK_SPEED: 2.6,
  SPRINT_SPEED: 4.3,
  SWIM_SPEED: 2.1,
  // Jump: apex = JUMP_IMPULSE^2 / (2 * GRAVITY) = 1.37 m (Raft about 1.23 m): clears a railing (0.95), a half
  // wall (1.1), chests, tables, beds and stations with margin. A full wall (2.2) or a one-storey floor edge is
  // reached with the ledge clamber below (or from a chest beside it). Falling pulls harder than rising (snappy).
  JUMP_IMPULSE: 7.4,
  GRAVITY: 20,               // rising (vy > 0)
  FALL_GRAVITY: 30,          // falling (vy <= 0)
  EYE_OFFSET: 1.6,
  HEAD: 0.15,                // head top above the eye
  BODY_RADIUS: 0.25,
  TILE_SIZE: 2,
  MAX_DT: 0.05,
  // Feet may hang this far past a tile edge and still stand (ledge catch).
  SUPPORT_MARGIN: 0.15,
  // Swimming
  WATER_ENTER: 0.1,          // feet below waterY + this => swimming
  WATER_EXIT_HYST: 0.2,      // extra height needed to stop swimming
  SWIM_EYE_ABOVE_WATER: 0.45,
  SWIM_RISE_BONUS: 0.35,     // target lift while jump is held
  BUOY_SPRING: 60,
  BUOY_DAMP: 12,             // ~0.8 of critical: rides the swell closely, settles with one small overshoot
  BUOY_STEP: 1 / 240,        // s, buoyancy integration substep
  SPLASH_DAMP: 0.45,
  // Auto clamber
  CLAMBER_REACH: 0.8,        // body edge distance to a tile
  CLAMBER_TIME: 0.42,
  CLAMBER_INSET: 0.45,
  // Decor colliders (blockers with a height, dist/decor-collision.js)
  DECOR_STEP: 0.3,           // a grounded body walks up onto a decor top this far above its feet (cushions)
  LAND_TOL: 0.06,            // a falling body lands on a surface its feet just dipped below (out of water)
  PASS_TOL: 0.04,            // an airborne body passes over a decor top its feet are this close below
  DROP: 0.35,                // grounded feet this far above the surface: walked off a raised top, fall
  SURF_MARGIN: 0.15,         // body centre may hang this far past a decor top and still stand
  // Ledge clamber: airborne after a jump, pushing forward, near the apex, hands reach a ledge in front.
  LEDGE_REACH: 1.3,          // m, ledge top above the feet the hands can still pull the body onto
  LEDGE_VY: 2.5,             // m/s, only once the rise has slowed to this (near the apex) or while falling
  LEDGE_FORWARD: 0.25,       // forward input needed (walking past a wall with strafe never grabs it)
  LEDGE_TIME: 0.34,          // s, pull-up time for a small step; + LEDGE_TIME_M per metre of rise (<= 0.5 s)
  LEDGE_TIME_M: 0.12,
  // A jump press this long before landing still jumps on landing (s).
  JUMP_BUFFER: 0.12,
  // Walked off a ledge this recently (s): a jump press still jumps and steering stays grounded.
  COYOTE: 0.1,
  // Horizontal response rates (1/s)
  GROUND_ACCEL: 20,
  GROUND_DECEL: 22,          // slowing down or stopping on the ground (crisp stop, little slide)
  GROUND_FRICTION: 6,        // m/s^2 constant part of the ground response
  AIR_ACCEL: 1.2,
  WATER_ACCEL: 4.5,
  // Safety
  MAX_RAFT_DISTANCE: 50,
  MAX_FALL_SPEED: 30,
});
export const MOVE_MUL = { walk: 1, swim: 1, jump: 1 }; // live multipliers for local buffs (cookpot.js); 1 = neutral

const C = PLAYER_CONSTANTS;
const HALF = C.TILE_SIZE / 2;
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Distance from (x, z) to the edge of one prop blocker; negative inside. A blocker is a circle
// {x, z, r} or a rotated rectangle {x, z, hx, hz, rot} (three.js rotation.y, like the decor footprint).
export function blockerGap(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  if (!Number.isFinite(b.hx)) return Math.sqrt(dx * dx + dz * dz) - Math.max(0, fin(b.r, 0)); // not Math.hypot: it allocates
  const rot = fin(b.rot, 0), c = Math.cos(rot), s = Math.sin(rot);
  const qx = Math.abs(dx * c - dz * s) - Math.max(0, b.hx), qz = Math.abs(dx * s + dz * c) - Math.max(0, fin(b.hz, 0));
  if (qx > 0 || qz > 0) { const ex = Math.max(qx, 0), ez = Math.max(qz, 0); return Math.sqrt(ex * ex + ez * ez); }
  return Math.max(qx, qz);
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isTile = t => Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1]);
// Math.hypot is a varargs builtin that V8 does not lower: it allocates on every call.
const len2 = (x, z) => Math.sqrt(x * x + z * z);
const NONE = Object.freeze([]); // shared stand-in for missing tiles/blocked arrays
// Cheap reject before blockerGap: no decor footprint corner plus the body radius reaches 2.4 m from its centre (half sizes <= 1.4 m).
const far = (b, x, z) => b.x - x > 2.4 || x - b.x > 2.4 || b.z - z > 2.4 || z - b.z > 2.4;
const isTop = t => !!t && typeof t === 'object' && !Array.isArray(t) && Number.isFinite(t.x) && Number.isFinite(t.z);
// Is blocker b (optionally with a height: y0 / top above baseY, see dist/decor-collision.js) solid for a body whose
// feet are at `feet`? Above its top less `tol` the body passes over it; a blocker without a top is a full column.
const solidFor = (b, feet, head, baseY, tol) =>
  !Number.isFinite(b.top) || (feet < baseY + b.top - tol && head > baseY + fin(b.y0, 0));

export class PlayerPhysics {
  constructor({x = 0, y = 1.8, z = 1.2, vx = 0, vy = 0, vz = 0, swimming = false} = {}) {
    this.x = fin(x, 0); this.y = fin(y, 1.8); this.z = fin(z, 1.2);
    this.vx = fin(vx, 0); this.vy = fin(vy, 0); this.vz = fin(vz, 0);
    this.swimming = !!swimming;
    this.grounded = false;
    this.verticalSpeed = this.vy;
    this.climbing = false;
    this._climb = null;
    this._prevJump = false;
    this._jumpBuffer = 0;
    this._coyote = 0; // s left to still jump after walking off a ledge
    this._jumped = false; // airborne because of a jump (the ledge clamber only grabs then)
    this._baseY = 0.2; this._surfY = 0; this._surfOne = [null]; // decor top chosen this update (see _decorSurface)
    this.decorTop = NaN;
    // Reused result of _nearest() (consumed immediately by its callers; never escapes).
    this._dt = 0.01; this._deckY = 0.2; this._nx = 0.5; this._nz = 0.5; // per-update scratch (see _moveHorizontal)
    this._near = {tx: 0, tz: 0, px: 0.5, pz: 0.5, cx: 0.5, cz: 0.5, dist: 0.5};
    // First update decides grounded: if standing exactly at deck height over a tile we snap to it.
    this._fresh = true;
  }

  capture() {
    return {
      x: this.x, y: this.y, z: this.z,
      vx: this.vx, vy: this.vy, vz: this.vz,
      grounded: this.grounded, swimming: this.swimming,
      verticalSpeed: this.verticalSpeed,
      climbing: this.climbing,
      climbProgress: this._climb ? clamp(this._climb.t / (this._climb.dur || C.CLAMBER_TIME), 0, 1) : 0,
    };
  }

  update(dt, input = {}) {
    const out = {landed: false, splashed: false, leftWater: false};
    const inp = input && typeof input === 'object' ? input : {};
    dt = fin(dt, 0);
    if (dt <= 0) return out;
    if (dt > C.MAX_DT) dt = C.MAX_DT;

    let forward = clamp(fin(inp.forward, 0), -1, 1);
    let strafe = clamp(fin(inp.strafe, 0), -1, 1);
    const yaw = fin(inp.yaw, 0);
    const jump = !!inp.jump;
    const sprint = !!inp.sprint;
    let tiles = Array.isArray(inp.tiles) ? inp.tiles : NONE;
    const blocked = Array.isArray(inp.blocked) ? inp.blocked : NONE;
    let deckY = fin(inp.deckY, 0.2);
    // baseY: the raft deck plane decor stands on (deckY may be a raised floor the build grid found under the feet).
    this._baseY = fin(inp.baseY, deckY);
    // Per-update scalars for helpers read from fields: double args to non-inlined calls get boxed.
    this._dt = dt; this._deckY = deckY;
    const waterY = fin(inp.waterY, -0.24);
    const jumpPressed = jump && !this._prevJump;
    this._prevJump = jump;
    this._jumpBuffer = jumpPressed ? C.JUMP_BUFFER : Math.max(0, this._jumpBuffer - dt);
    if (this._coyote > 0) this._coyote = Math.max(0, this._coyote - dt);

    this._sanitize(tiles);

    // A standable decor top (crate, table, bed, station) above the surface the caller found: stand on it instead.
    if (blocked.length && !this.swimming && !this._climb && this._decorSurface(blocked, deckY)) {
      deckY = this._deckY = this._surfY; tiles = this._surfOne;
    }

    if (this._fresh) {
      this._fresh = false;
      const feet = this.y - C.EYE_OFFSET;
      if (!this.swimming && Math.abs(feet - deckY) < 0.05 && this._supported(tiles)) {
        this.grounded = true; this.y = deckY + C.EYE_OFFSET; this.vy = 0;
      }
    }

    // ---- Auto clamber in progress ----
    if (this._climb) {
      this._stepClimb(out);
      this.verticalSpeed = this.vy;
      return out;
    }

    // ---- Stuck below the deck inside a tile footprint (spawn / deck shift): lift onto deck ----
    if (this.y - C.EYE_OFFSET < deckY - 0.05 && this._inside(tiles)) {
      this.y = deckY + C.EYE_OFFSET; this.vy = 0;
      if (!this.grounded) out.landed = true;
      if (this.swimming) { this.swimming = false; out.leftWater = true; }
      this.grounded = true;
    }

    // ---- Horizontal ----
    const len = len2(forward, strafe);
    if (len > 1) { forward /= len; strafe /= len; }
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const dirX = -s * forward + c * strafe;
    const dirZ = -c * forward - s * strafe;
    let speed, rate;
    if (this.swimming) { speed = C.SWIM_SPEED * MOVE_MUL.swim; rate = C.WATER_ACCEL; }
    else if (this.grounded) {
      speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk;
      const gx = dirX * speed, gz = dirZ * speed;
      rate = gx * gx + gz * gz < this.vx * this.vx + this.vz * this.vz ? C.GROUND_DECEL : C.GROUND_ACCEL;
    }
    else { speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk; rate = this._coyote > 0 ? C.GROUND_ACCEL : C.AIR_ACCEL; }
    const k = 1 - Math.exp(-rate * dt);
    if (!this.grounded && !this.swimming && len < 0.01) {
      // Keep momentum in the air when there is no input.
    } else {
      const tx = dirX * speed, tz = dirZ * speed;
      this.vx += (tx - this.vx) * k;
      this.vz += (tz - this.vz) * k;
      if (this.grounded) {
        // Constant friction on top of the exponential blend: speed settles in finite time instead of creeping.
        const ex = tx - this.vx, ez = tz - this.vz, e = len2(ex, ez), f = C.GROUND_FRICTION * dt;
        if (e <= f) { this.vx = tx; this.vz = tz; } else { this.vx += ex / e * f; this.vz += ez / e * f; }
      }
    }

    this._moveHorizontal(blocked);

    // Raft hull sides are solid below deck level (swimming or falling past an edge).
    if (this.y - C.EYE_OFFSET < deckY - 0.05) this._pushOutOfTiles(tiles);

    // ---- Vertical ----
    if (this.grounded) {
      if (this._supported(tiles) && this.y - C.EYE_OFFSET - deckY <= C.DROP) { // DROP: walked off a raised top
        this.y = deckY + C.EYE_OFFSET; this.vy = 0; this._jumped = false;
        if (this._jumpBuffer > 0) { this._jumpBuffer = 0; this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump; this.grounded = false; this._jumped = true; }
      } else {
        this.grounded = false; // walked off the edge
        this._coyote = C.COYOTE;
        if (this.vy > 0) this.vy = 0;
      }
    }

    if (!this.grounded) {
      if (this._coyote > 0 && this._jumpBuffer > 0 && !this.swimming) { // just walked off: the jump still counts
        this._coyote = 0; this._jumpBuffer = 0; this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump; this._jumped = true;
      }
      const prevFeet = this.y - C.EYE_OFFSET;
      if (this.swimming) {
        // Buoyancy spring in fixed small substeps so the surface bob and splash dunk match at any fps.
        const target = waterY + C.SWIM_EYE_ABOVE_WATER + (jump ? C.SWIM_RISE_BONUS : 0);
        const n = Math.ceil(dt / C.BUOY_STEP - 1e-9), h = dt / n;
        for (let i = 0; i < n; i++) {
          this.vy += (C.BUOY_SPRING * (target - this.y) - C.BUOY_DAMP * this.vy) * h;
          this.vy = clamp(this.vy, -C.MAX_FALL_SPEED, C.MAX_FALL_SPEED);
          this.y += this.vy * h;
        }
      } else this._fall();
      const feet = this.y - C.EYE_OFFSET;

      // Land only when falling and feet cross the surface plane over its footprint. Out of the water the feet may
      // have dipped LAND_TOL under it (a top they passed over at PASS_TOL): they are lifted onto it.
      if (this.vy <= 0 && prevFeet >= deckY - (this.swimming ? 0.02 : C.LAND_TOL) && feet <= deckY && this._supported(tiles)) {
        this.y = deckY + C.EYE_OFFSET; this.vy = 0; this.grounded = true; out.landed = true; this._coyote = 0; this._jumped = false;
        if (this.swimming) { this.swimming = false; out.leftWater = true; }
        if (this._jumpBuffer > 0) { this._jumpBuffer = 0; this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump; this.grounded = false; this._jumped = true; } // buffered jump
      } else if (!this.swimming && feet < waterY + C.WATER_ENTER) {
        this.swimming = true; out.splashed = true; this._coyote = 0; this._jumped = false;
        this.vy *= C.SPLASH_DAMP;
        this.vx *= 0.6; this.vz *= 0.6;
      } else if (this.swimming && feet > waterY + C.WATER_ENTER + C.WATER_EXIT_HYST) {
        this.swimming = false; out.leftWater = true;
      }
    }

    // ---- Coming down beside a decor top (not on it): slide off its side instead of sinking into it ----
    if (!this.grounded && !this.swimming && blocked.length) this._pushOutProps(blocked);

    // ---- Ledge clamber: jumped, pushing forward, a ledge within reach of the hands in front ----
    if (this._jumped && !this.grounded && !this.swimming && !this._climb && forward > C.LEDGE_FORWARD && this.vy < C.LEDGE_VY) {
      this._tryLedge(inp.ledge, blocked, yaw);
      if (this._climb) { this.verticalSpeed = this.vy; return out; }
    }

    // ---- Friendly auto clamber: hold jump in water near the raft ----
    if (this.swimming && jump && !this._climb) {
      const n = this._nearest(tiles);
      if (n && n.dist - C.BODY_RADIUS <= C.CLAMBER_REACH) this._beginClimb(n, deckY, blocked);
    }

    // ---- Safety: absurd distance from the raft ----
    this._safety(tiles);
    // Feet height of the decor top stood on (NaN otherwise): BuildGrid.preStep must not call that a walk off its floors.
    this.decorTop = this.grounded && tiles === this._surfOne ? deckY : NaN;

    this.verticalSpeed = this.vy;
    return out;
  }

  // ---------- internals ----------

  // Airborne vertical step: GRAVITY while rising, FALL_GRAVITY while falling. Exact per piece (mean velocity,
  // split at the apex when vy crosses zero mid-step), so the jump height and airtime match at any fps.
  _fall() {
    const dt = this._dt;
    const vy0 = this.vy;
    let dy;
    if (vy0 > 0 && vy0 < C.GRAVITY * dt) {
      const t1 = vy0 / C.GRAVITY, t2 = dt - t1;
      this.vy = -C.FALL_GRAVITY * t2;
      dy = vy0 * t1 / 2 + this.vy * t2 / 2;
    } else {
      this.vy -= (vy0 > 0 ? C.GRAVITY : C.FALL_GRAVITY) * dt;
      dy = (vy0 + this.vy) / 2 * dt;
    }
    this.vy = clamp(this.vy, -C.MAX_FALL_SPEED, C.MAX_FALL_SPEED);
    this.y += dy;
  }

  _sanitize(tiles) {
    const deckY = this._deckY;
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y) || !Number.isFinite(this.z)) {
      const n = this._nearest(tiles, 0, 0);
      this.x = n ? n.tx * C.TILE_SIZE : 0; this.z = n ? n.tz * C.TILE_SIZE : 0;
      this.y = deckY + C.EYE_OFFSET; this.grounded = !!n; this.swimming = false; this._climb = null; this.climbing = false;
      this.vx = this.vy = this.vz = 0;
    }
    if (!Number.isFinite(this.vx)) this.vx = 0;
    if (!Number.isFinite(this.vy)) this.vy = 0;
    if (!Number.isFinite(this.vz)) this.vz = 0;
  }

  _safety(tiles) {
    const deckY = this._deckY;
    const n = this._nearest(tiles);
    if (n && n.dist > C.MAX_RAFT_DISTANCE) {
      this.x = n.tx * C.TILE_SIZE; this.z = n.tz * C.TILE_SIZE; this.y = deckY + C.EYE_OFFSET;
      this.vx = this.vy = this.vz = 0; this.grounded = true; this.swimming = false;
    }
  }

  // Feet supported by any tile (footprint expanded by SUPPORT_MARGIN). An entry may also be a top shape: a
  // blocker-style circle / rectangle {x, z, r | hx, hz, rot, m} (wall and pillar tops, decor tops), whose own
  // margin m (default SURF_MARGIN) is how far the body centre may hang past it.
  _supported(tiles, x = this.x, z = this.z) {
    const h = HALF + C.SUPPORT_MARGIN;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!isTile(t)) { if (isTop(t) && blockerGap(t, x, z) <= fin(t.m, C.SURF_MARGIN)) return true; continue; }
      if (Math.abs(x - t[0] * C.TILE_SIZE) <= h && Math.abs(z - t[1] * C.TILE_SIZE) <= h) return true;
    }
    return false;
  }

  _inside(tiles, x = this.x, z = this.z) {
    const h = HALF - 0.02;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!isTile(t)) { if (isTop(t) && blockerGap(t, x, z) < -0.02) return true; continue; }
      if (Math.abs(x - t[0] * C.TILE_SIZE) < h && Math.abs(z - t[1] * C.TILE_SIZE) < h) return true;
    }
    return false;
  }

  // Nearest point on any tile footprint to (x, z). Returns a reused object (this._near) or null.
  _nearest(tiles, x = this.x, z = this.z) {
    let bi = -1, bestD2 = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!isTile(t)) continue;
      const cx = t[0] * C.TILE_SIZE, cz = t[1] * C.TILE_SIZE;
      const px = clamp(x, cx - HALF, cx + HALF), pz = clamp(z, cz - HALF, cz + HALF);
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < bestD2) { bestD2 = d2; bi = i; }
    }
    if (bi < 0) return null;
    const t = tiles[bi], n = this._near;
    n.tx = t[0]; n.tz = t[1]; n.cx = t[0] * C.TILE_SIZE; n.cz = t[1] * C.TILE_SIZE;
    n.px = clamp(x, n.cx - HALF, n.cx + HALF); n.pz = clamp(z, n.cz - HALF, n.cz + HALF);
    n.dist = Math.sqrt(bestD2);
    return n;
  }

  _pushOutOfTiles(tiles) {
    const R = C.BODY_RADIUS;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (!isTile(t)) continue;
        const cx = t[0] * C.TILE_SIZE, cz = t[1] * C.TILE_SIZE;
        if (Math.abs(this.x - cx) > HALF + R || Math.abs(this.z - cz) > HALF + R) continue;
        const px = clamp(this.x, cx - HALF, cx + HALF), pz = clamp(this.z, cz - HALF, cz + HALF);
        const dx = this.x - px, dz = this.z - pz, d = len2(dx, dz);
        if (d >= R || d < 1e-6) continue; // d ~ 0 means centre inside; handled by lift-to-deck
        const push = R / d;
        const nx = px + dx * push, nz = pz + dz * push;
        // Remove velocity into the hull.
        const ux = dx / d, uz = dz / d, vn = this.vx * ux + this.vz * uz;
        if (vn < 0) { this.vx -= vn * ux; this.vz -= vn * uz; }
        this.x = nx; this.z = nz;
      }
    }
  }

  // Axis-separated movement (velocity * this._dt) against prop circles and rectangles; escape allowed if starting inside.
  // Candidate positions go through this._nx/_nz: double args to non-inlined calls get boxed.
  _moveHorizontal(blocked) {
    const mx = this.vx * this._dt, mz = this.vz * this._dt;
    if (!blocked.length) { this.x += mx; this.z += mz; return; }
    this._nx = this.x + mx; this._nz = this.z;
    if (this._propOk(blocked)) this.x = this._nx; else this.vx = 0;
    this._nx = this.x; this._nz = this.z + mz;
    if (this._propOk(blocked)) this.z = this._nz; else this.vz = 0;
  }

  // Is moving from (this.x, this.z) to (this._nx, this._nz) allowed?
  _propOk(blocked) {
    const ox = this.x, oz = this.z, nx = this._nx, nz = this._nz;
    const feet = this.y - C.EYE_OFFSET, head = this.y + C.HEAD, step = this.grounded ? C.DECOR_STEP : C.PASS_TOL;
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      // Only a standable top is stepped onto (DECOR_STEP); a low lamp or candle stays solid until jumped over.
      if (far(b, nx, nz)) continue;
      if (!solidFor(b, feet, head, this._baseY, b.stand === true ? step : C.PASS_TOL)) continue;
      const gn = blockerGap(b, nx, nz);
      if (gn >= C.BODY_RADIUS) continue;
      const go = blockerGap(b, ox, oz);
      if (go < C.BODY_RADIUS && gn > go) continue; // escaping outward
      return false;
    }
    return true;
  }

  // Is the body circle at (x, z) clear of every blocker (feet: only those still solid at that height)?
  _propFree(x, z, blocked, feet = -Infinity, r = C.BODY_RADIUS) {
    const head = feet + C.EYE_OFFSET + C.HEAD;
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      if (feet > -Infinity && !solidFor(b, feet, head, this._baseY, 0.02)) continue;
      if (blockerGap(b, x, z) < r) return false;
    }
    return true;
  }

  // Airborne body overlapping a decor collider with a height below its top (it came down past the top beside it, or
  // over a lamp or post it cannot stand on): push the body circle out sideways and drop the velocity into it.
  _pushOutProps(blocked) {
    const R = C.BODY_RADIUS, feet = this.y - C.EYE_OFFSET, head = this.y + C.HEAD;
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      if (far(b, this.x, this.z) || !solidFor(b, feet, head, this._baseY, C.PASS_TOL) || blockerGap(b, this.x, this.z) >= R) continue;
      const dx = this.x - b.x, dz = this.z - b.z;
      let nx, nz, ox, oz; // outward normal and the new offset from the blocker centre
      if (!Number.isFinite(b.hx)) {
        const d = len2(dx, dz); nx = d > 1e-6 ? dx / d : 1; nz = d > 1e-6 ? dz / d : 0;
        const r = Math.max(0, fin(b.r, 0)) + R; ox = nx * r; oz = nz * r;
      } else { // rectangle: local frame as in blockerGap
        const rot = fin(b.rot, 0), c = Math.cos(rot), s = Math.sin(rot), hx = Math.max(0, b.hx), hz = Math.max(0, fin(b.hz, 0));
        let lx = dx * c - dz * s, lz = dx * s + dz * c;
        const px = clamp(lx, -hx, hx), pz = clamp(lz, -hz, hz), ex = lx - px, ez = lz - pz, e = len2(ex, ez);
        let ux, uz;
        if (e > 1e-6) { ux = ex / e; uz = ez / e; lx = px + ux * R; lz = pz + uz * R; }
        else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) { ux = lx < 0 ? -1 : 1; uz = 0; lx = ux * (hx + R); }
        else { ux = 0; uz = lz < 0 ? -1 : 1; lz = uz * (hz + R); }
        ox = lx * c + lz * s; oz = -lx * s + lz * c; nx = ux * c + uz * s; nz = -ux * s + uz * c;
      }
      this.x = b.x + ox; this.z = b.z + oz;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) { this.vx -= vn * nx; this.vz -= vn * nz; }
    }
  }

  // Highest standable decor top the body can use now: at or just under the feet with the centre within its margin,
  // or (grounded) a step of up to DECOR_STEP with the centre over it. Only tops above the caller's surface deckY.
  // Sets this._surfY / this._surfOne[0] and returns true when one is found.
  _decorSurface(blocked, deckY) {
    const feet = this.y - C.EYE_OFFSET, up = this.grounded ? C.DECOR_STEP : C.LAND_TOL, base = this._baseY;
    let best = -Infinity, bi = -1;
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || b.stand !== true || !Number.isFinite(b.top) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      const top = base + b.top;
      if (!(top > deckY + 1e-6) || top <= best || top > feet + up) continue;
      if (far(b, this.x, this.z)) continue;
      const g = blockerGap(b, this.x, this.z);
      if (g > (top > feet + 0.04 ? 0 : C.SURF_MARGIN)) continue; // stepping up: centre over the top
      best = top; bi = i;
    }
    if (bi < 0) return false;
    this._surfY = best; this._surfOne[0] = blocked[bi];
    return true;
  }

  // Ledge clamber trigger. Probe in front of the body (facing yaw) for the highest walkable top within reach of the
  // hands: ledge.ledgeAt (build pieces: floors, roofs, wall / half wall / railing / pillar tops) and standable decor.
  // The landing spot needs room for the body (no solid between the top and head height there, ledge.clearAt and
  // the decor list) and the column above the body must be open up to that head height, so a ceiling stops it.
  _tryLedge(ledge, blocked, yaw) {
    const R = C.BODY_RADIUS, feet = this.y - C.EYE_OFFSET, base = this._baseY;
    const lo = feet + 0.05, hi = feet + C.LEDGE_REACH;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const L = ledge && typeof ledge.ledgeAt === 'function' ? ledge : null;
    let top = -Infinity, d1 = 0;
    for (let k = 0; k < 4 && top === -Infinity; k++) { // probe 0.07 .. 0.37 m past the body front
      d1 = R + 0.07 + 0.1 * k;
      top = this._ledgeAt(L, blocked, this.x + fx * d1, this.z + fz * d1, lo, hi, base);
    }
    if (top === -Infinity) return false;
    // Stand well on it when it is deep enough (a floor, a crate), else on the thin top itself (wall, rail).
    let d = d1 + 0.3;
    const deep = this._ledgeAt(L, blocked, this.x + fx * d, this.z + fz * d, top - 0.06, top + 0.06, base);
    if (!(deep > -Infinity)) d = d1;
    const tx = this.x + fx * d, tz = this.z + fz * d, headTop = top + C.EYE_OFFSET + C.HEAD + 0.05;
    const r = R - 0.04;
    if (L && typeof L.clearAt === 'function' &&
      (!L.clearAt(this.x, this.z, this.y + C.HEAD, headTop, base, r) || !L.clearAt(tx, tz, top + 0.03, headTop, base, r)
       || !L.clearAt((this.x + tx) / 2, (this.z + tz) / 2, top + 0.03, headTop, base, r))) return false;
    if (!this._propFree(tx, tz, blocked, top, r) || !this._propFree((this.x + tx) / 2, (this.z + tz) / 2, blocked, top, r)) return false;
    const rise = top - feet;
    this._climb = {t: 0, sx: this.x, sy: this.y, sz: this.z, tx, tz, ty: top + C.EYE_OFFSET,
      dur: Math.min(0.5, C.LEDGE_TIME + C.LEDGE_TIME_M * Math.max(0, rise)), ledge: true};
    this.climbing = true;
    this.vx = this.vz = 0; this.vy = 0;
    return true;
  }

  _ledgeAt(L, blocked, x, z, lo, hi, base) {
    let top = L ? L.ledgeAt(x, z, lo, hi, base) : -Infinity;
    if (!(top > -Infinity)) top = -Infinity;
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || b.stand !== true || !Number.isFinite(b.top) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      const t = base + b.top;
      if (t < lo || t > hi || t <= top) continue;
      if (!far(b, x, z) && blockerGap(b, x, z) <= 0) top = t;
    }
    return top;
  }

  // Ledge clamber progress 0..1 (camera dip), or -1 when not pulling up onto a ledge.
  ledgeProgress() { const c = this._climb; return c && c.ledge ? clamp(c.t / c.dur, 0, 1) : -1; }

  _beginClimb(n, deckY, blocked) {
    // Target: just inside the tile edge nearest to the swimmer.
    let dx = n.px - this.x, dz = n.pz - this.z, d = len2(dx, dz);
    if (d < 1e-6) { dx = n.cx - this.x; dz = n.cz - this.z; d = len2(dx, dz) || 1; }
    const lim = HALF - 0.3;
    const ex = clamp(n.px + dx / d * C.CLAMBER_INSET, n.cx - lim, n.cx + lim);
    const ez = clamp(n.pz + dz / d * C.CLAMBER_INSET, n.cz - lim, n.cz + lim);
    // Props sit at tile centres, so never fall back to the centre. Try the edge spot, then that spot
    // slid along the edge, then the tile corners (nearest to the swimmer first).
    const near = (a, b) => Math.hypot(a[0] - this.x, a[1] - this.z) - Math.hypot(b[0] - this.x, b[1] - this.z);
    const side = Math.abs(dx) >= Math.abs(dz)
      ? [[ex, n.cz - lim], [ex, n.cz + lim]]
      : [[n.cx - lim, ez], [n.cx + lim, ez]];
    const corners = [[n.cx - lim, n.cz - lim], [n.cx + lim, n.cz - lim], [n.cx - lim, n.cz + lim], [n.cx + lim, n.cz + lim]];
    const spot = [[ex, ez], ...side.sort(near), ...corners.sort(near)].find(([x, z]) => this._propFree(x, z, blocked));
    if (!spot) return; // fully blocked tile: keep swimming
    const [tx, tz] = spot;
    this._climb = {t: 0, sx: this.x, sy: this.y, sz: this.z, tx, tz};
    this.climbing = true;
    this.vx = this.vz = 0; this.vy = 0;
  }

  _stepClimb(out) {
    const dt = this._dt, deckY = this._deckY;
    const cl = this._climb;
    cl.t += dt;
    const u = clamp(cl.t / (cl.dur || C.CLAMBER_TIME), 0, 1);
    const ty = cl.ledge ? cl.ty : deckY + C.EYE_OFFSET;
    // Rise first (ease out), then roll forward over the edge (ease in-out), with a small arc. A ledge pull-up
    // gets the feet over the top before the body moves in (hands on the edge, then a knee over it).
    let up, fwd;
    if (cl.ledge) {
      up = 1 - (1 - Math.min(1, u * 1.6)) ** 2;
      const v = clamp((u - 0.3) / 0.7, 0, 1); fwd = v * v * (3 - 2 * v);
    } else { up = 1 - (1 - Math.min(1, u * 1.4)) ** 2; fwd = u * u * (3 - 2 * u); }
    const prevY = this.y;
    this.x = cl.sx + (cl.tx - cl.sx) * fwd;
    this.z = cl.sz + (cl.tz - cl.sz) * fwd;
    this.y = cl.sy + (ty - cl.sy) * up + Math.sin(u * Math.PI) * (cl.ledge ? 0.06 : 0.12);
    this.vy = (this.y - prevY) / dt;
    if (this.swimming && u > 0.35) { this.swimming = false; out.leftWater = true; }
    if (u >= 1) {
      this.x = cl.tx; this.z = cl.tz; this.y = ty;
      this.vx = this.vy = this.vz = 0;
      this.grounded = true; this.climbing = false; this._climb = null; this._jumped = false;
      if (this.swimming) { this.swimming = false; out.leftWater = true; }
      out.landed = true;
    }
  }
}

// ---------- Riding the raft's tilt ----------
// PlayerPhysics works on a flat deck plane at deckY (the raft never moves in x/z, it only heaves,
// pitches and rolls). The deck mesh tilts, so a player standing away from the raft centre would see
// the deck swell up and sink under the camera. RaftRide gives the offset that carries the camera
// with the raft's pitch and roll, so the player lives in the raft's local frame while aboard.
// The offset blends in and out (WEIGHT_RATE) so stepping off into the water never pops the view.
// game.js: raftRide.update(dt, physics, raft.position.y, raft.rotation.x, raft.rotation.z, world.tiles, FLOOR_Y, rideOff),
// then add rideOff to the camera position.

export const RIDE = Object.freeze({
  WEIGHT_RATE: 10,   // 1/s, blend toward aboard / not aboard
  FOOT_MARGIN: 0.4,  // m, feet up to this far past a tile edge still ride (ledge, mid-jump over the edge)
  BELOW: 0.35,       // m, feet this far under the deck plane (in the water) no longer ride
});

// Offset (world minus local) of the raft-local point (x, y, z) under rotation Euler XYZ (rx, 0, rz),
// which is how three.js composes raft.rotation (R = Rx * Rz). Writes out.x/y/z and returns out.
export function tiltOffset(rx, rz, x, y, z, out) {
  const cz = Math.cos(rz), sz = Math.sin(rz), cx = Math.cos(rx), sx = Math.sin(rx);
  const x1 = x * cz - y * sz, y1 = x * sz + y * cz;   // Rz
  const y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx; // Rx
  out.x = x1 - x; out.y = y2 - y; out.z = z2 - z;
  return out;
}

function overRaft(tiles, x, z) {
  if (!Array.isArray(tiles)) return false;
  const h = C.TILE_SIZE / 2 + RIDE.FOOT_MARGIN;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!Array.isArray(t)) continue;
    if (Math.abs(x - t[0] * C.TILE_SIZE) <= h && Math.abs(z - t[1] * C.TILE_SIZE) <= h) return true;
  }
  return false;
}

export class RaftRide {
  constructor() { this.weight = 0; this._first = true; }

  // Is the player riding the raft right now (on deck, on a raised floor, mid-jump above it, clambering)?
  aboard(p, raftY, tiles, floorY) {
    if (!p || p.swimming) return false;
    const feet = fin(p.y, 0) - C.EYE_OFFSET;
    return feet >= raftY + floorY - RIDE.BELOW && overRaft(tiles, fin(p.x, 0), fin(p.z, 0));
  }

  update(dt, p, raftY, rx, rz, tiles, floorY, out) {
    dt = Math.max(0, fin(dt, 0)); raftY = fin(raftY, 0); rx = fin(rx, 0); rz = fin(rz, 0); floorY = fin(floorY, 0.2);
    const target = this.aboard(p, raftY, tiles, floorY) ? 1 : 0;
    if (this._first) { this.weight = target; this._first = false; }
    else this.weight = target + (this.weight - target) * Math.exp(-RIDE.WEIGHT_RATE * Math.min(dt, 0.1));
    if (this.weight < 1e-4) this.weight = 0;
    if (!p || this.weight === 0) { out.x = 0; out.y = 0; out.z = 0; return out; }
    // Rotate the feet point about the raft origin; the eye stays straight above the feet.
    tiltOffset(rx, rz, fin(p.x, 0), fin(p.y, 0) - C.EYE_OFFSET - raftY, fin(p.z, 0), out);
    out.x *= this.weight; out.y *= this.weight; out.z *= this.weight;
    return out;
  }

  reset() { this.weight = 0; this._first = true; }
}

export default PlayerPhysics;
