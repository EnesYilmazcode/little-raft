// Little Raft - first-person player physics.
// Pure ES module: no DOM, no THREE, no dependencies.
// Position (x, y, z) is the EYE position. Feet are at y - EYE_OFFSET.
// Tiles are integer [tx, tz] pairs; each covers a 2x2 square centred on (tx*2, tz*2).
// Movement convention matches game.js: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).

export const PLAYER_CONSTANTS = Object.freeze({
  WALK_SPEED: 2.6,
  SPRINT_SPEED: 4,
  SWIM_SPEED: 2.1,
  JUMP_IMPULSE: 4.6,
  GRAVITY: 12,
  EYE_OFFSET: 1.6,
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
  BUOY_SPRING: 30,
  BUOY_DAMP: 7,
  SPLASH_DAMP: 0.45,
  // Auto clamber
  CLAMBER_REACH: 0.8,        // body edge distance to a tile
  CLAMBER_TIME: 0.42,
  CLAMBER_INSET: 0.45,
  // A jump press this long before landing still jumps on landing (s).
  JUMP_BUFFER: 0.12,
  // Horizontal response rates (1/s)
  GROUND_ACCEL: 14,
  AIR_ACCEL: 3.5,
  WATER_ACCEL: 4.5,
  // Safety
  MAX_RAFT_DISTANCE: 50,
  MAX_FALL_SPEED: 30,
});
export const MOVE_MUL = { walk: 1, swim: 1, jump: 1 }; // live multipliers for local buffs (cookpot.js); 1 = neutral

const C = PLAYER_CONSTANTS;
const HALF = C.TILE_SIZE / 2;
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isTile = t => Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1]);
// Math.hypot is a varargs builtin that V8 does not lower: it allocates on every call.
const len2 = (x, z) => Math.sqrt(x * x + z * z);
const NONE = Object.freeze([]); // shared stand-in for missing tiles/blocked arrays

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
      climbProgress: this._climb ? clamp(this._climb.t / C.CLAMBER_TIME, 0, 1) : 0,
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
    const tiles = Array.isArray(inp.tiles) ? inp.tiles : NONE;
    const blocked = Array.isArray(inp.blocked) ? inp.blocked : NONE;
    const deckY = fin(inp.deckY, 0.2);
    // Per-update scalars for helpers read from fields: double args to non-inlined calls get boxed.
    this._dt = dt; this._deckY = deckY;
    const waterY = fin(inp.waterY, -0.24);
    const jumpPressed = jump && !this._prevJump;
    this._prevJump = jump;
    this._jumpBuffer = jumpPressed ? C.JUMP_BUFFER : Math.max(0, this._jumpBuffer - dt);

    this._sanitize(tiles);

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
    else if (this.grounded) { speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk; rate = C.GROUND_ACCEL; }
    else { speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk; rate = C.AIR_ACCEL; }
    const k = 1 - Math.exp(-rate * dt);
    if (!this.grounded && !this.swimming && len < 0.01) {
      // Keep momentum in the air when there is no input.
    } else {
      this.vx += (dirX * speed - this.vx) * k;
      this.vz += (dirZ * speed - this.vz) * k;
    }

    this._moveHorizontal(blocked);

    // Raft hull sides are solid below deck level (swimming or falling past an edge).
    if (this.y - C.EYE_OFFSET < deckY - 0.05) this._pushOutOfTiles(tiles);

    // ---- Vertical ----
    if (this.grounded) {
      if (this._supported(tiles)) {
        this.y = deckY + C.EYE_OFFSET; this.vy = 0;
        if (this._jumpBuffer > 0) { this._jumpBuffer = 0; this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump; this.grounded = false; }
      } else {
        this.grounded = false; // walked off the edge
        if (this.vy > 0) this.vy = 0;
      }
    }

    if (!this.grounded) {
      const prevFeet = this.y - C.EYE_OFFSET;
      if (this.swimming) {
        const target = waterY + C.SWIM_EYE_ABOVE_WATER + (jump ? C.SWIM_RISE_BONUS : 0);
        const ay = C.BUOY_SPRING * (target - this.y) - C.BUOY_DAMP * this.vy;
        this.vy += ay * dt;
      } else {
        this.vy -= C.GRAVITY * dt;
      }
      this.vy = clamp(this.vy, -C.MAX_FALL_SPEED, C.MAX_FALL_SPEED);
      this.y += this.vy * dt;
      const feet = this.y - C.EYE_OFFSET;

      // Land on deck only when falling and feet cross the deck plane over a tile.
      if (this.vy <= 0 && prevFeet >= deckY - 0.02 && feet <= deckY && this._supported(tiles)) {
        this.y = deckY + C.EYE_OFFSET; this.vy = 0; this.grounded = true; out.landed = true;
        if (this.swimming) { this.swimming = false; out.leftWater = true; }
        if (this._jumpBuffer > 0) { this._jumpBuffer = 0; this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump; this.grounded = false; } // buffered jump
      } else if (!this.swimming && feet < waterY + C.WATER_ENTER) {
        this.swimming = true; out.splashed = true;
        this.vy *= C.SPLASH_DAMP;
        this.vx *= 0.6; this.vz *= 0.6;
      } else if (this.swimming && feet > waterY + C.WATER_ENTER + C.WATER_EXIT_HYST) {
        this.swimming = false; out.leftWater = true;
      }
    }

    // ---- Friendly auto clamber: hold jump in water near the raft ----
    if (this.swimming && jump && !this._climb) {
      const n = this._nearest(tiles);
      if (n && n.dist - C.BODY_RADIUS <= C.CLAMBER_REACH) this._beginClimb(n, deckY, blocked);
    }

    // ---- Safety: absurd distance from the raft ----
    this._safety(tiles);

    this.verticalSpeed = this.vy;
    return out;
  }

  // ---------- internals ----------

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

  // Feet supported by any tile (footprint expanded by SUPPORT_MARGIN).
  _supported(tiles, x = this.x, z = this.z) {
    const h = HALF + C.SUPPORT_MARGIN;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!isTile(t)) continue;
      if (Math.abs(x - t[0] * C.TILE_SIZE) <= h && Math.abs(z - t[1] * C.TILE_SIZE) <= h) return true;
    }
    return false;
  }

  _inside(tiles, x = this.x, z = this.z) {
    const h = HALF - 0.02;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!isTile(t)) continue;
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

  // Axis-separated movement (velocity * this._dt) against circular props; escape allowed if starting inside.
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
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      const r = Math.max(0, fin(b.r, 0)) + C.BODY_RADIUS;
      const d2n = (nx - b.x) * (nx - b.x) + (nz - b.z) * (nz - b.z);
      if (d2n >= r * r) continue;
      const d2o = (ox - b.x) * (ox - b.x) + (oz - b.z) * (oz - b.z);
      if (d2o < r * r && d2n > d2o) continue; // escaping outward
      return false;
    }
    return true;
  }

  _propFree(x, z, blocked) {
    for (let i = 0; i < blocked.length; i++) {
      const b = blocked[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      const r = Math.max(0, fin(b.r, 0)) + C.BODY_RADIUS;
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < r * r) return false;
    }
    return true;
  }

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
    const u = clamp(cl.t / C.CLAMBER_TIME, 0, 1);
    const ty = deckY + C.EYE_OFFSET;
    // Rise first (ease out), then roll forward over the edge (ease in-out), with a small arc.
    const up = 1 - (1 - Math.min(1, u * 1.4)) ** 2;
    const fwd = u * u * (3 - 2 * u);
    const prevY = this.y;
    this.x = cl.sx + (cl.tx - cl.sx) * fwd;
    this.z = cl.sz + (cl.tz - cl.sz) * fwd;
    this.y = cl.sy + (ty - cl.sy) * up + Math.sin(u * Math.PI) * 0.12;
    this.vy = (this.y - prevY) / dt;
    if (this.swimming && u > 0.35) { this.swimming = false; out.leftWater = true; }
    if (u >= 1) {
      this.x = cl.tx; this.z = cl.tz; this.y = ty;
      this.vx = this.vy = this.vz = 0;
      this.grounded = true; this.climbing = false; this._climb = null;
      if (this.swimming) { this.swimming = false; out.leftWater = true; }
      out.landed = true;
    }
  }
}

export default PlayerPhysics;
