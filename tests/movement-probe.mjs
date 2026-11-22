// Little Raft - headless movement probe. Drives the same stack game.js runs every frame
// (MoveFeel.shapeInput -> PlayerPhysics.update in splitSteps substeps -> controls stop brake -> MoveFeel.step)
// and prints movement metrics as JSON. Point it at any build to compare:
//   node tests/movement-probe.mjs                 (this checkout's dist/)
//   RAFT_DIST=/path/to/old/dist node tests/movement-probe.mjs
//   node tests/movement-probe.mjs --compare /path/to/old/dist   (prints before/after with % change)
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const here = fileURLToPath(new URL('../dist/', import.meta.url));

export async function loadStack(dir) {
  const base = pathToFileURL(resolve(dir) + '/').href;
  const P = await import(new URL('player-physics.js', base));
  const F = await import(new URL('move-feel.js', base));
  const R = await import(new URL('input-rules.js', base));
  const m = /STOP_BRAKE\s*=\s*([\d.]+)/.exec(readFileSync(join(dir, 'controls.js'), 'utf8'));
  return {PlayerPhysics: P.PlayerPhysics, PC: P.PLAYER_CONSTANTS, MoveFeel: F.MoveFeel, splitSteps: R.splitSteps, ride: P.RaftRide ? P : null, brake: m ? +m[1] : 0};
}

const DECK = 0.2, WATER = -0.24;
const grid = n => { const t = []; for (let x = -n; x <= n; x++) for (let z = -n; z <= n; z++) t.push([x, z]); return t; };

// One game frame of the movement stack. raw: {forward, strafe, sprint, jump, crouch, yaw}.
function makeRig(S, opts = {}) {
  const tiles = opts.tiles ?? grid(6), steps = {n: 0, step: 0};
  const physics = new S.PlayerPhysics(opts.start ?? {x: 0, y: DECK + S.PC.EYE_OFFSET, z: 0});
  const feel = new S.MoveFeel({motionScale: 1});
  const rig = {physics, feel, t: 0, tiles, deckY: () => DECK, water: () => WATER, ev: null};
  rig.frame = (dt, raw = {}) => {
    S.splitSteps(dt, 0.05, 0.25, steps);
    const laneDt = Math.min(steps.n * steps.step, 0.05);
    const p = rig.physics;
    const sh = feel.shapeInput(laneDt, {forward: raw.forward ?? 0, strafe: raw.strafe ?? 0, sprint: !!raw.sprint, crouch: !!raw.crouch, grounded: p.grounded, swimming: p.swimming});
    let ev = null;
    for (let i = 0; i < steps.n; i++) {
      const e = p.update(steps.step, {forward: sh.forward, strafe: sh.strafe, sprint: sh.sprint, jump: !!raw.jump, yaw: raw.yaw ?? 0,
        tiles, deckY: rig.deckY(rig.t), waterY: rig.water(p.x, p.z, rig.t), blocked: []});
      rig.t += steps.step;
      if (e) { if (!ev) ev = {...e}; else for (const k in e) if (e[k] === true) ev[k] = true; }
    }
    const idle = Math.hypot(raw.forward ?? 0, raw.strafe ?? 0) < 0.05;
    if (S.brake && idle && p.grounded && !p.swimming) { const k = Math.exp(-S.brake * laneDt); p.vx *= k; p.vz *= k; }
    feel.step(laneDt, {speed: Math.hypot(p.vx, p.vz), grounded: p.grounded, swimming: p.swimming, vy: p.vy, landed: !!ev?.landed, crouch: !!raw.crouch});
    rig.ev = ev;
    return ev;
  };
  return rig;
}

const speedOf = p => Math.hypot(p.vx, p.vz);
const r3 = v => Math.round(v * 1000) / 1000;

function accel(S, fps, sprint = false) {
  const rig = makeRig(S), dt = 1 / fps, top = sprint ? S.PC.SPRINT_SPEED : S.PC.WALK_SPEED;
  let t90 = null, t95 = null;
  for (let k = 1; k <= fps * 2; k++) {
    rig.frame(dt, {forward: 1, sprint});
    const s = speedOf(rig.physics);
    if (t90 === null && s >= 0.9 * top) t90 = k * dt;
    if (t95 === null && s >= 0.95 * top) t95 = k * dt;
  }
  return {t90, t95, top: speedOf(rig.physics)};
}

function stop(S, fps, sprint = false) {
  const rig = makeRig(S), dt = 1 / fps;
  for (let k = 0; k < fps * 1.5; k++) rig.frame(dt, {forward: 1, sprint});
  const z0 = rig.physics.z; let time = null;
  for (let k = 1; k <= fps; k++) { rig.frame(dt, {}); if (time === null && speedOf(rig.physics) < 0.02) time = k * dt; }
  return {dist: Math.abs(rig.physics.z - z0), time};
}

function jump(S, fps) {
  const rig = makeRig(S), dt = 1 / fps;
  for (let k = 0; k < 5; k++) rig.frame(dt, {});
  let apex = 0, air = 0, left = false;
  for (let k = 0; k < fps * 3; k++) {
    rig.frame(dt, {jump: k < 3});
    const p = rig.physics;
    apex = Math.max(apex, p.y - S.PC.EYE_OFFSET - DECK);
    if (!p.grounded) { left = true; air += dt; } else if (left) break;
  }
  return {apex, air};
}

// Standing jump, strafe held from takeoff: how far air control carries you sideways by landing.
function airControl(S, fps) {
  const rig = makeRig(S), dt = 1 / fps;
  for (let k = 0; k < 5; k++) rig.frame(dt, {});
  let left = false;
  for (let k = 0; k < fps * 3; k++) {
    rig.frame(dt, {jump: k < 3, strafe: 1});
    if (!rig.physics.grounded) left = true; else if (left) break;
  }
  return {lateral: Math.abs(rig.physics.x), landSpeed: speedOf(rig.physics)};
}

// Walk off the deck edge and press jump `late` seconds after the feet leave it: does it still jump?
function edgeJump(S, fps, late) {
  const rig = makeRig(S, {tiles: [[0, 0]]}), dt = 1 / fps;
  let leftAt = null;
  for (let k = 0; k < fps * 2; k++) {
    const jump = leftAt !== null && rig.t - leftAt >= late && rig.t - leftAt < late + 0.1;
    rig.frame(dt, {forward: 1, jump});
    const p = rig.physics;
    if (leftAt === null && !p.grounded) leftAt = rig.t;
    if (jump && p.vy > 2) return 1;
    if (p.swimming) return 0;
  }
  return 0;
}

// Surface swim: open water with a heaving swell; speed and how steadily the eye rides the surface.
function swim(S, fps) {
  const rig = makeRig(S, {tiles: [[0, 0]], start: {x: 6, y: WATER + 0.45, z: 0, swimming: true}});
  rig.water = (x, z, t) => WATER + 0.18 * Math.sin(2 * Math.PI * t / 3.5) + 0.06 * Math.sin(0.9 * x + 1.7 * t);
  const dt = 1 / fps, rel = [];
  for (let k = 0; k < fps * 6; k++) {
    rig.frame(dt, {forward: 1, yaw: -Math.PI / 2}); // swim +x, away from the raft
    if (k > fps * 2) rel.push(rig.physics.y - rig.water(rig.physics.x, rig.physics.z, rig.t));
  }
  const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
  const sd = Math.sqrt(rel.reduce((a, b) => a + (b - mean) ** 2, 0) / rel.length);
  return {speed: speedOf(rig.physics), eyeAboveWater: mean, eyeSd: sd, swimming: rig.physics.swimming};
}

// Walk off the edge: how deep the splash dunks you and how long until you ride the surface.
function splash(S, fps) {
  const rig = makeRig(S, {tiles: [[0, 0]]}), dt = 1 / fps;
  let minRel = Infinity, inAt = null, settle = null;
  for (let k = 0; k < fps * 5; k++) {
    rig.frame(dt, {forward: k * dt < 0.6 ? 1 : 0});
    const p = rig.physics, rel = p.y - WATER;
    if (p.swimming && inAt === null) inAt = rig.t;
    if (inAt !== null) {
      minRel = Math.min(minRel, rel);
      if (settle === null && Math.abs(rel - S.PC.SWIM_EYE_ABOVE_WATER) < 0.03 && Math.abs(p.vy) < 0.1) settle = rig.t - inAt;
    }
  }
  return {dunk: S.PC.SWIM_EYE_ABOVE_WATER - minRel, settle};
}

// Climb out: swim at the 3x3 raft from many spots, facing it, holding W (+Space when asked).
function climb(S, fps, withJump) {
  const tiles = grid(1), dt = 1 / fps;
  let ok = 0, n = 0, tSum = 0;
  for (const d of [0.2, 0.5, 0.9, 1.4, 2.0]) for (const off of [-2.6, -1.5, -0.5, 0, 0.8, 1.9]) for (const side of [0, 1, 2, 3]) {
    const ang = side * Math.PI / 2, ex = 3 + S.PC.BODY_RADIUS + d;
    const x = Math.cos(ang) * ex - Math.sin(ang) * off, z = Math.sin(ang) * ex + Math.cos(ang) * off;
    const rig = makeRig(S, {tiles, start: {x, y: WATER + 0.45, z, swimming: true}});
    const yaw = Math.atan2(x, z); // forward = (-sin yaw, -cos yaw) points at the raft centre
    let t = 0; n++;
    for (let k = 0; k < fps * 4; k++) {
      rig.frame(dt, {forward: 1, jump: withJump, yaw}); t += dt;
      const p = rig.physics;
      if (p.grounded && !p.climbing && Math.abs(p.y - DECK - S.PC.EYE_OFFSET) < 1e-6) { ok++; tSum += t; break; }
    }
  }
  return {success: ok / n, meanTime: ok ? tSum / ok : null};
}

// Standing on a heaving, pitching, rolling raft (game.js updateRaft driven by a synthetic swell).
// Rendered player = physics position (+ the raft-ride offset when the build has one). Measures the feet in the
// raft's own frame (the eye stays upright above them): zero spread means the deck and the player move as one.
function raftJitter(S, fps) {
  const dt = 1 / fps, raft = {y: 0, rx: 0, rz: 0};
  const h = (x, z, t) => 0.22 * Math.sin(0.55 * x + 0.3 * z - 1.1 * t) + 0.12 * Math.sin(-0.4 * x + 0.8 * z - 0.9 * t + 1) + 0.05 * Math.sin(1.7 * x - 2.3 * t);
  const rig = makeRig(S, {tiles: grid(2), start: {x: 3.2, y: DECK + S.PC.EYE_OFFSET, z: 2.6}});
  rig.deckY = () => raft.y + DECK;
  const ride = S.ride ? new S.ride.RaftRide() : null, off = {x: 0, y: 0, z: 0};
  const xs = [], ys = [], zs = []; let time = 0;
  for (let k = 0; k < fps * 12; k++) {
    time += dt;
    const e = 0.6, s = {h: h(0, 0, time), sx: (h(e, 0, time) - h(-e, 0, time)) / (2 * e), sz: (h(0, e, time) - h(0, -e, time)) / (2 * e)};
    const ky = Math.min(1, dt * 2), kr = Math.min(1, dt * 1.5);
    raft.y += (s.h * 0.3 - raft.y) * ky; raft.rx += (-s.sz * 0.35 - raft.rx) * kr; raft.rz += (s.sx * 0.35 - raft.rz) * kr;
    rig.frame(dt, {});
    const p = rig.physics;
    let cx = p.x, cy = p.y, cz = p.z;
    if (ride) { ride.update(dt, p, raft.y, raft.rx, raft.rz, rig.tiles, DECK, off); cx += off.x; cy += off.y; cz += off.z; }
    // world -> raft local: subtract raft position, then inverse rotation (Euler XYZ: R = Rx * Rz, inverse = Rz^T * Rx^T)
    let vx = cx, vy = cy - S.PC.EYE_OFFSET - raft.y, vz = cz;
    const c1 = Math.cos(raft.rx), s1 = Math.sin(raft.rx), y1 = vy * c1 + vz * s1, z1 = -vy * s1 + vz * c1;
    const c2 = Math.cos(raft.rz), s2 = Math.sin(raft.rz), x2 = vx * c2 + y1 * s2, y2 = -vx * s2 + y1 * c2;
    if (k > fps * 2) { xs.push(x2); ys.push(y2); zs.push(z1); }
  }
  const sd = a => { const m = a.reduce((u, v) => u + v, 0) / a.length; return Math.sqrt(a.reduce((u, v) => u + (v - m) ** 2, 0) / a.length); };
  // Frame-to-frame jerk of the local position (high-frequency jitter, independent of slow drift).
  let jerk = 0; for (let i = 2; i < ys.length; i++) jerk = Math.max(jerk, Math.abs(ys[i] - 2 * ys[i - 1] + ys[i - 2]));
  return {sd: Math.hypot(sd(xs), sd(ys), sd(zs)), sdY: sd(ys), maxJerk: jerk};
}

export async function probe(dir) {
  const S = await loadStack(dir), out = {};
  const fpsList = [30, 60, 144];
  for (const fps of fpsList) {
    const a = accel(S, fps), sa = accel(S, fps, true), st = stop(S, fps), ss = stop(S, fps, true), j = jump(S, fps), ac = airControl(S, fps);
    const ej = edgeJump(S, fps, 0.06), sw = swim(S, fps), sp = splash(S, fps), cj = climb(S, fps, true), cw = climb(S, fps, false), jt = raftJitter(S, fps);
    out[fps] = {
      walkT90: a.t90, walkT95: a.t95, walkTop: a.top, sprintT90: sa.t90, sprintTop: sa.top,
      stopDist: st.dist, stopTime: st.time, sprintStopDist: ss.dist,
      jumpApex: j.apex, airTime: j.air, airLateral: ac.lateral, edgeJumpLate60ms: ej,
      swimSpeed: sw.speed, swimEyeSd: sw.eyeSd, splashDunk: sp.dunk, splashSettle: sp.settle,
      climbJump: cj.success, climbJumpTime: cj.meanTime, climbForwardOnly: cw.success,
      raftLocalSd: jt.sd, raftLocalSdY: jt.sdY, raftLocalJerk: jt.maxJerk,
    };
    for (const k in out[fps]) if (typeof out[fps][k] === 'number') out[fps][k] = Math.round(out[fps][k] * 1e5) / 1e5;
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ci = process.argv.indexOf('--compare');
  const after = await probe(process.env.RAFT_DIST ?? here);
  if (ci < 0) console.log(JSON.stringify(after, null, 1));
  else {
    const before = await probe(process.argv[ci + 1]);
    const rows = [];
    for (const fps of Object.keys(after)) for (const k of Object.keys(after[fps])) {
      const b = before[fps][k], a = after[fps][k];
      const pct = typeof b === 'number' && typeof a === 'number' && b !== 0 ? `${((a - b) / Math.abs(b) * 100).toFixed(1)}%` : '';
      rows.push(`${fps}fps ${k.padEnd(16)} before ${String(b).padStart(9)}  after ${String(a).padStart(9)}  ${pct}`);
    }
    console.log(rows.join('\n'));
  }
}
