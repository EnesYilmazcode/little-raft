// Little Raft - movement feel layer (Raft-like start/stop ramp, head bob, footsteps,
// crouch, landing dip, ladder climbing). Pure ES module: no DOM, no THREE.
// Everything is framerate independent: ramps are linear in time, smoothing uses exp(-rate*dt),
// bob phase advances by distance travelled and the landing dip is an analytic spring curve.

import {PLAYER_CONSTANTS as PC} from './player-physics.js';

export const FEEL = Object.freeze({
  START_TIME: 0.14,       // s, input engagement 0 -> 1 (smoothstep eased: weighty start)
  STOP_TIME: 0.08,        // s, 1 -> 0 (quicker stop)
  SPRINT_IN: 0.25,        // s, walk -> sprint blend
  SPRINT_OUT: 0.15,       // s, sprint -> walk blend
  CROUCH_SPEED: 0.5,      // speed multiplier while crouched
  CROUCH_EYE: -0.55,      // m, eye offset when fully crouched
  CROUCH_RATE: 20,        // 1/s exp rate (~95% in 0.15s)
  STRIDE_WALK: 1.1,       // m per footfall at walk speed
  STRIDE_SPRINT: 1.45,    // m per footfall at sprint speed
  STRIDE_CROUCH: 0.8,     // m per footfall while crouched
  STRIDE_LADDER: 0.45,    // m of climb per hand/foot step on a ladder
  MIN_STEP_SPEED: 0.15,   // m/s, below this the bob does not advance
  BOB_Y: 0.035,           // m vertical bob amplitude at walk speed
  BOB_X: 0.018,           // m lateral sway amplitude at walk speed
  BOB_ROLL: 0.006,        // rad roll amplitude at walk speed
  BOB_MAX_SCALE: 1.5,     // amplitude cap relative to walk (sprint ~1.5)
  BOB_RATE: 9,            // 1/s exp rate for amplitude in/out (settles to 0 when stopped)
  LADDER_BOB: 0.4,        // bob amplitude scale while climbing
  DIP_PER_MS: 0.02,       // m of landing dip per m/s impact speed
  DIP_MIN: 0.04, DIP_MAX: 0.18,
  DIP_MIN_IMPACT: 1.0,    // m/s, softer landings give no dip
  DIP_OMEGA: 15,          // 1/s, dip peaks at 1/omega (~0.07s), ~90% recovered by ~0.35s after landing
  CLIMB_SPEED: 2,         // m/s on ladders
  LADDER_JUMP_VY: 3,      // m/s upward when jumping off a ladder
  LADDER_PUSH: 3,         // m/s along the ladder normal when jumping off
  MAX_DT: 0.1,
});

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = t => t * t * (3 - 2 * t);
const approach = (v, target, maxStep) => (v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep));
const expTo = (v, target, rate, dt) => target + (v - target) * Math.exp(-rate * dt);
const nz = v => v || 0; // normalise -0 to 0
const safeDt = dt => clamp(fin(dt, 0), 0, FEEL.MAX_DT);

export class MoveFeel {
  constructor(opts = {}) {
    const o = opts && typeof opts === 'object' ? opts : {};
    this.feel = {...FEEL, ...(o.feel && typeof o.feel === 'object' ? o.feel : {})};
    this.motionScale = clamp(fin(o.motionScale, 1), 0, 1);
    this.walkSpeed = fin(o.walkSpeed, PC.WALK_SPEED);
    this.sprintSpeed = fin(o.sprintSpeed, PC.SPRINT_SPEED);
    this.reset();
  }

  reset() {
    this.engage = 0;          // linear 0..1 input engagement
    this.ramp = 0;            // eased engagement actually applied
    this.sprintBlend = 0;
    this._dir = [0, 0];       // last non-zero raw input (used while stopping)
    this.phase = 0;           // footfalls travelled (integer crossings = footsteps)
    this.steps = 0;
    this.bobAmp = 0;
    this.crouch = 0;          // current crouch eye offset (<= 0)
    this._dip = null;         // {t, depth, residual}
    this._lastVy = 0;
    this._ladder = null;
    this._ladderVy = 0;
    this._prevJump = true;
  }

  setMotionScale(v) { this.motionScale = clamp(fin(v, this.motionScale), 0, 1); }

  // Shape raw movement input before PlayerPhysics.update. Output sprint=true means "use sprint speed",
  // with forward/strafe scaled so effective speed blends walk -> sprint smoothly.
  shapeInput(dt, inp = {}) {
    const F = this.feel; dt = safeDt(dt);
    const i = inp && typeof inp === 'object' ? inp : {};
    let f = clamp(fin(i.forward), -1, 1), s = clamp(fin(i.strafe), -1, 1);
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const active = len > 0.01;
    if (active) this._dir = [f, s];
    const e0 = ease(this.engage);
    this.engage = approach(this.engage, active ? 1 : 0, dt / (active ? F.START_TIME : F.STOP_TIME));
    this.ramp = ease(this.engage);
    const applied = (e0 + this.ramp) / 2; // frame-average (trapezoid) so distance is fps independent
    const crouch = !!i.crouch && !i.swimming;
    const wantSprint = !!i.sprint && !crouch && active && f > 0.1;
    this.sprintBlend = approach(this.sprintBlend, wantSprint ? 1 : 0, dt / (wantSprint ? F.SPRINT_IN : F.SPRINT_OUT));
    let scale = applied * (crouch ? F.CROUCH_SPEED : 1);
    const sprint = this.sprintBlend > 0;
    if (sprint) scale *= (this.walkSpeed + (this.sprintSpeed - this.walkSpeed) * this.sprintBlend) / this.sprintSpeed;
    if (this.engage === 0) this._dir = [0, 0];
    return {forward: this._dir[0] * scale, strafe: this._dir[1] * scale, sprint};
  }

  // Camera feel; call once per frame after physics. speed = horizontal m/s, vy = vertical speed,
  // landed = PlayerPhysics.update().landed (impact uses the last airborne vy if vy is already 0).
  step(dt, inp = {}) {
    const F = this.feel; dt = safeDt(dt);
    const i = inp && typeof inp === 'object' ? inp : {};
    const speed = Math.max(0, fin(i.speed));
    const vy = fin(i.vy);
    const onLadder = !!i.onLadder || !!this._ladder;
    const grounded = !!i.grounded && !i.swimming;
    const crouch = !!i.crouch && !i.swimming;
    const m = this.motionScale;

    // Footstep phase by distance travelled.
    let footstep = false, dist = 0, stride = F.STRIDE_WALK, ampTarget = 0;
    if (onLadder) {
      dist = Math.abs(this._ladderVy) * dt; stride = F.STRIDE_LADDER;
      ampTarget = Math.abs(this._ladderVy) > F.MIN_STEP_SPEED ? F.LADDER_BOB : 0;
    } else if (grounded && speed > F.MIN_STEP_SPEED) {
      const k = clamp((speed - this.walkSpeed) / Math.max(1e-6, this.sprintSpeed - this.walkSpeed), 0, 1);
      stride = crouch ? F.STRIDE_CROUCH : F.STRIDE_WALK + (F.STRIDE_SPRINT - F.STRIDE_WALK) * k;
      dist = speed * dt;
      ampTarget = clamp(speed / this.walkSpeed, 0, F.BOB_MAX_SCALE) * (crouch ? 0.6 : 1);
    }
    const before = Math.floor(this.phase);
    this.phase += dist / stride;
    if (this.phase > 1e6) this.phase -= 1e6;
    if (Math.floor(this.phase) !== before && dist > 0) { footstep = true; this.steps++; }
    this.bobAmp = expTo(this.bobAmp, ampTarget, F.BOB_RATE, dt);
    if (this.bobAmp < 1e-5 && ampTarget === 0) this.bobAmp = 0;

    // Crouch eye height.
    this.crouch = expTo(this.crouch, crouch ? F.CROUCH_EYE : 0, F.CROUCH_RATE, dt);
    if (Math.abs(this.crouch) < 1e-5) this.crouch = 0;

    // Landing dip (critically damped spring, evaluated analytically).
    if (i.landed) {
      const impact = Math.max(Math.abs(Math.min(0, vy)), Math.abs(Math.min(0, this._lastVy)));
      if (impact >= F.DIP_MIN_IMPACT) {
        const depth = clamp(impact * F.DIP_PER_MS, F.DIP_MIN, F.DIP_MAX);
        this._dip = {t: 0, depth, residual: this._dipValue()};
      }
    }
    if (this._dip) {
      this._dip.t += dt;
      if (this._dip.t * F.DIP_OMEGA > 12) this._dip = null;
    }
    this._lastVy = grounded ? 0 : vy;
    const dip = this._dipValue();

    const half = Math.PI * this.phase;            // one full sway cycle per two footfalls
    const a = this.bobAmp * m;
    const stepSide = Math.floor(this.phase) % 2 === 0 ? 1 : -1;
    return {
      bobY: nz(a * F.BOB_Y * (Math.abs(Math.sin(half)) - 1)),   // trough (cusp) exactly at footfall
      bobX: nz(a * F.BOB_X * Math.sin(half)),
      roll: nz(a * F.BOB_ROLL * Math.sin(half)),
      eyeOffset: nz(this.crouch + dip * m),
      landDip: nz(dip * m),
      footstep,
      stepSide,
    };
  }

  _dipValue() {
    const d = this._dip; if (!d) return 0;
    const x = this.feel.DIP_OMEGA * d.t, e = Math.exp(-x);
    return -d.depth * x * Math.E * e + d.residual * (1 + x) * e;
  }

  // ---- Ladders ----
  setLadder(l) {
    const ok = l && typeof l === 'object' && Number.isFinite(l.bottomY) && Number.isFinite(l.topY) && l.topY > l.bottomY;
    if (!ok) { this._ladder = null; this._ladderVy = 0; return false; }
    const n = Array.isArray(l.normal) ? l.normal : [0, 1];
    let nx = fin(n[0]), nz = fin(n[1]); const nl = Math.hypot(nx, nz) || 1;
    if (nx === 0 && nz === 0) nz = 1;
    this._ladder = {bottomY: l.bottomY, topY: l.topY, x: fin(l.x), z: fin(l.z), normal: [nx / nl, nz / nl]};
    this._ladderVy = 0;
    this._prevJump = true; // a jump held while grabbing must be released before it detaches
    return true;
  }

  isOnLadder() { return !!this._ladder; }

  // y is in the same space as bottomY/topY (feet height). Returns vertical velocity to apply.
  ladderInput(dt, inp = {}) {
    dt = safeDt(dt);
    const L = this._ladder, F = this.feel;
    const i = inp && typeof inp === 'object' ? inp : {};
    const jump = !!i.jump, jumpPressed = jump && !this._prevJump;
    this._prevJump = jump;
    if (!L) return {vy: 0, detach: false, pushX: 0, pushZ: 0, atTop: false, atBottom: false};
    if (jumpPressed) {
      const [nx, nz] = L.normal;
      this._ladder = null; this._ladderVy = 0;
      return {vy: F.LADDER_JUMP_VY, detach: true, pushX: nx * F.LADDER_PUSH, pushZ: nz * F.LADDER_PUSH, atTop: false, atBottom: false};
    }
    const y = fin(i.y, L.bottomY);
    let vy = clamp(fin(i.forward), -1, 1) * F.CLIMB_SPEED;
    if (dt > 0 && vy > 0) vy = Math.min(vy, Math.max(0, (L.topY - y) / dt));
    if (dt > 0 && vy < 0) vy = Math.max(vy, Math.min(0, (L.bottomY - y) / dt));
    const ny = y + vy * dt;
    const atTop = ny >= L.topY - 1e-6, atBottom = ny <= L.bottomY + 1e-6;
    this._ladderVy = vy;
    return {vy, detach: false, pushX: 0, pushZ: 0, atTop, atBottom};
  }
}

export default MoveFeel;
