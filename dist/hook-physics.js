// hook-physics.js — Raft-style throwable hook simulation (pure logic, no scene/DOM/audio).
//
// API
//   new HookCast(T, { origin, target, maxRange = 26, charge = 1, drift = { x: 0, z: 0.22 } })
//     T       : the THREE namespace (only T.Vector3 is used)
//     origin  : THREE.Vector3 throw start (e.g. player hand). Copied, never mutated.
//     target  : THREE.Vector3 aim point. Only its horizontal direction/distance is used. Copied.
//     charge  : [0,1]; range = 4 + charge * (maxRange - 4). Shorter target distance is respected.
//     drift   : optional water drift velocity (units/s) for the floating hook; defaults match
//               game.js item drift (z += .22/s, x += sin(time*.13)*.04/s).
//
//   Public fields
//     position : THREE.Vector3  current hook position
//     stage    : 'flying' | 'floating' | 'reeling' | 'done'
//     caught   : null | { id, token, type }
//     distance : horizontal distance from last known hand to hook
//     tension  : [0,1] rope tension (0 slack, 1 taut)
//     landing  : THREE.Vector3 computed throw destination (y = WATER_Y)
//     flightTime : seconds the throw arc takes (.55 .. 1.1)
//
//   update(dt, { hand, items, reeling = false, time = 0 }) -> null | { kind:'collected', id, token } | { kind:'returned' }
//     hand  : THREE.Vector3 current hand position (not mutated)
//     items : Array of { id, token, type, x, z } (or with .position Vector3). Not mutated.
//     Returns an event exactly once when the hook reaches the hand while reeling; null otherwise.
//
//   caughtPosition() -> THREE.Vector3 | null  where to draw the caught item (follows hook)
//   ropePoints(hand, segments = 16) -> Array<THREE.Vector3> from hand to hook, sagging with slack
//   cancel() -> stage = 'done' (no event)
//
// Integration example (coordinator side):
//   import { HookCast } from './hook-physics.js?build=38a181a923a6';
//   // on release of charge button:
//   hook = new HookCast(THREE, { origin: handPos, target: aimPoint, charge });
//   // every frame:
//   if (hook) {
//     const ev = hook.update(dt, { hand: handPos, items: world.items, reeling: input.reelHeld, time: elapsed });
//     hookMesh.position.copy(hook.position);
//     ropeGeometry.setFromPoints(hook.ropePoints(handPos));
//     const cp = hook.caughtPosition(); if (cp && hook.caught) itemMeshes[hook.caught.id].position.copy(cp);
//     if (ev?.kind === 'collected') action({ kind: 'collect', id: ev.id, token: ev.token });
//     if (hook.stage === 'done') hook = null;
//   }

export const WATER_Y = 0.05;
const MIN_RANGE = 4;
const REEL_SPEED = 8;
const CATCH_RADIUS_FLOAT = 1.3;
const CATCH_RADIUS_REEL = 0.75;
const COLLECT_DIST = 0.7;
const MAX_DT = 0.05;
const MAX_SAG_BELOW = 0.12;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const itemX = (it) => (it.position ? it.position.x : it.x);
const itemZ = (it) => (it.position ? it.position.z : it.z);

export class HookCast {
  constructor(T, { origin, target, maxRange = 26, charge = 1, drift } = {}) {
    this.T = T;
    this.origin = origin.clone();
    const c = clamp(Number.isFinite(charge) ? charge : 1, 0, 1);
    const range = MIN_RANGE + c * Math.max(0, maxRange - MIN_RANGE);
    let dx = target.x - origin.x, dz = target.z - origin.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 0; dz = -1; len = 1; } // degenerate aim: throw forward
    const dist = Math.min(len, range);
    this.landing = new T.Vector3(origin.x + (dx / len) * dist, WATER_Y, origin.z + (dz / len) * dist);
    this.throwDistance = dist;
    // Flight time scales with distance: .55s short toss, 1.1s at max range.
    this.flightTime = 0.55 + 0.55 * clamp(dist / Math.max(maxRange, MIN_RANGE), 0, 1);
    this.arcHeight = 1.2 + dist * 0.28;
    this.drift = drift ? { x: drift.x || 0, z: drift.z || 0 } : null;

    this.position = this.origin.clone();
    this.stage = 'flying';
    this.caught = null;
    this.distance = 0;
    this.tension = 0;
    this.flightT = 0;
    this.floatTime = 0;
    this.base = this.landing.clone(); // floating anchor (drifts), bob applied on top
    this._lastHand = this.origin.clone();
    this._emitted = false;
    this._tmp = new T.Vector3();
  }

  _tryCatch(items, radius) {
    if (this.caught || !Array.isArray(items)) return;
    let best = null, bestD = radius;
    for (const it of items) {
      if (!it) continue;
      const d = Math.hypot(itemX(it) - this.position.x, itemZ(it) - this.position.z);
      if (d <= bestD) { bestD = d; best = it; }
    }
    if (best) this.caught = { id: best.id, token: best.token, type: best.type };
  }

  _caughtStillExists(items) {
    if (!this.caught || !Array.isArray(items)) return false;
    return items.some((it) => it && it.id === this.caught.id && it.token === this.caught.token);
  }

  update(dt, { hand, items, reeling = false, time = 0 } = {}) {
    if (this.stage === 'done') return null;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_DT);
    if (hand) this._lastHand.copy(hand);
    const h = this._lastHand;

    // Drop the catch if the item vanished (collected by someone else / respawned).
    if (this.caught && !this._caughtStillExists(items)) this.caught = null;

    if (this.stage === 'flying') {
      this.flightT = Math.min(1, this.flightT + dt / this.flightTime);
      const t = this.flightT;
      this.position.lerpVectors(this.origin, this.landing, t);
      this.position.y = this.origin.y + (WATER_Y - this.origin.y) * t + this.arcHeight * 4 * t * (1 - t);
      if (t >= 1) {
        this.position.copy(this.landing);
        this.base.copy(this.landing);
        this.stage = 'floating';
        this._tryCatch(items, CATCH_RADIUS_FLOAT);
      }
      this._updateMetrics(h, reeling);
      return null;
    }

    if (reeling) this.stage = 'reeling';
    else if (this.stage === 'reeling') {
      // Reel released: settle back onto water where we are.
      this.stage = 'floating';
      this.base.set(this.position.x, WATER_Y, this.position.z);
    }

    if (this.stage === 'floating') {
      this.floatTime += dt;
      const vx = this.drift ? this.drift.x : Math.sin(time * 0.13) * 0.04;
      const vz = this.drift ? this.drift.z : 0.22;
      this.base.x += vx * dt;
      this.base.z += vz * dt;
      this.position.set(
        this.base.x,
        WATER_Y + Math.sin(this.floatTime * 2.6) * 0.04 + 0.03,
        this.base.z,
      );
      this._tryCatch(items, CATCH_RADIUS_FLOAT);
    } else if (this.stage === 'reeling') {
      const to = this._tmp.set(h.x - this.position.x, 0, h.z - this.position.z);
      const d = to.length();
      const step = REEL_SPEED * dt;
      if (d > 1e-6) {
        const k = Math.min(1, step / d);
        this.position.x += to.x * k;
        this.position.z += to.z * k;
      }
      // Skim the water while far; rise toward the hand height in the last couple of units.
      const rem = Math.hypot(h.x - this.position.x, h.z - this.position.z);
      const rise = clamp(1 - rem / 2, 0, 1);
      this.position.y = Math.max(WATER_Y, WATER_Y + 0.06 + (h.y - WATER_Y) * rise);
      this.base.set(this.position.x, WATER_Y, this.position.z);
      this._tryCatch(items, CATCH_RADIUS_REEL);

      if (rem <= COLLECT_DIST) {
        this.stage = 'done';
        this._updateMetrics(h, true);
        if (this._emitted) return null;
        this._emitted = true;
        if (this.caught && this._caughtStillExists(items)) {
          const { id, token } = this.caught;
          return { kind: 'collected', id, token };
        }
        this.caught = null;
        return { kind: 'returned' };
      }
    }

    this._updateMetrics(h, this.stage === 'reeling');
    return null;
  }

  _updateMetrics(hand, reeling) {
    this.distance = Math.hypot(this.position.x - hand.x, this.position.z - hand.z);
    if (this.stage === 'flying') this.tension = 0;
    else if (reeling) this.tension = this.caught ? 1 : 0.8;
    else this.tension = this.caught ? 0.35 : 0.1;
  }

  /** Where to render the caught item: just behind the hook, on the water while floating. */
  caughtPosition() {
    if (!this.caught) return null;
    const p = this.position.clone();
    p.y = Math.max(WATER_Y, p.y - 0.15);
    return p;
  }

  /** Rope polyline from hand to hook. Sag proportional to slack; nearly straight when taut. */
  ropePoints(hand, segments = 16) {
    const T = this.T;
    const h = hand || this._lastHand;
    const n = Math.max(1, Math.floor(segments));
    const span = h.distanceTo(this.position);
    const slack = this.stage === 'flying' ? 0.15 : 1 - this.tension;
    const sag = span * 0.12 * slack;
    const floorY = WATER_Y - MAX_SAG_BELOW;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new T.Vector3().lerpVectors(h, this.position, t);
      if (i > 0 && i < n) p.y = Math.max(floorY, p.y - sag * 4 * t * (1 - t));
      pts.push(p);
    }
    return pts;
  }

  cancel() {
    this.stage = 'done';
    this.tension = 0;
  }
}

export default HookCast;
