import test from 'node:test';
import assert from 'node:assert/strict';
import {MoveFeel, FEEL} from '../dist/move-feel.js';
import {PLAYER_CONSTANTS as PC} from '../dist/player-physics.js';

// Drive shapeInput -> simple speed model -> step for `secs` at `fps`.
function run(fps, secs, {forward = 1, sprint = false, crouch = false, feel = new MoveFeel()} = {}) {
  const dt = 1 / fps, n = Math.round(secs * fps);
  let steps = 0, last;
  for (let k = 0; k < n; k++) {
    const sh = feel.shapeInput(dt, {forward, strafe: 0, sprint, crouch, grounded: true});
    const speed = Math.hypot(sh.forward, sh.strafe) * (sh.sprint ? PC.SPRINT_SPEED : PC.WALK_SPEED);
    last = feel.step(dt, {speed, grounded: true, crouch, vy: 0});
    if (last.footstep) steps++;
  }
  return {feel, steps, last};
}

test('ramp is monotonic and reaches full in ~0.1-0.2s', () => {
  const f = new MoveFeel(); const dt = 1 / 240;
  let prev = 0, tFull = null;
  for (let k = 1; k <= 120; k++) {
    const v = f.shapeInput(dt, {forward: 1}).forward;
    assert.ok(v >= prev - 1e-12, 'monotonic');
    if (k * dt < 0.02) assert.ok(v < 0.15, 'eased start');
    if (tFull === null && v >= 0.999) tFull = k * dt;
    prev = v;
  }
  assert.ok(tFull >= 0.1 && tFull <= 0.2, `full at ${tFull}`);
});

test('stop is faster than start', () => {
  const f = new MoveFeel(); const dt = 1 / 240;
  let tStart = 0, tStop = 0;
  while (f.shapeInput(dt, {forward: 1}).forward < 0.999) tStart += dt;
  while (f.shapeInput(dt, {forward: 0}).forward > 0.001) tStop += dt;
  assert.ok(tStop < tStart, `stop ${tStop} < start ${tStart}`);
  assert.equal(f.shapeInput(dt, {}).forward, 0);
});

test('analog input keeps magnitude; crouch halves; sprint blends in', () => {
  const f = new MoveFeel();
  for (let k = 0; k < 60; k++) f.shapeInput(1 / 60, {forward: 0.5});
  assert.ok(Math.abs(f.shapeInput(1 / 60, {forward: 0.5}).forward - 0.5) < 1e-9);
  const c = new MoveFeel(); let o;
  for (let k = 0; k < 60; k++) o = c.shapeInput(1 / 60, {forward: 1, crouch: true, sprint: true});
  assert.ok(Math.abs(o.forward - FEEL.CROUCH_SPEED) < 1e-9 && !o.sprint, 'crouch cancels sprint');
  const s = new MoveFeel(); const speeds = [];
  for (let k = 0; k < 60; k++) {
    o = s.shapeInput(1 / 60, {forward: 1, sprint: true});
    speeds.push(o.forward * (o.sprint ? PC.SPRINT_SPEED : PC.WALK_SPEED));
  }
  for (let k = 1; k < speeds.length; k++) assert.ok(speeds[k] >= speeds[k - 1] - 1e-9);
  assert.ok(Math.abs(speeds.at(-1) - PC.SPRINT_SPEED) < 1e-9);
});

test('framerate independence: 30fps vs 144fps for 2s', () => {
  for (const opts of [{}, {sprint: true}, {crouch: true}]) {
    const a = run(30, 2, opts), b = run(144, 2, opts);
    assert.ok(Math.abs(a.feel.ramp - b.feel.ramp) < 1e-9, 'ramp');
    assert.ok(Math.abs(a.feel.phase - b.feel.phase) < 0.03, `phase ${a.feel.phase} vs ${b.feel.phase}`);
    assert.ok(Math.abs(a.steps - b.steps) <= 1, `steps ${a.steps} vs ${b.steps}`);
    assert.ok(Math.abs(a.last.bobY - b.last.bobY) < 0.003);
    assert.ok(Math.abs(a.last.eyeOffset - b.last.eyeOffset) < 1e-3);
  }
  // landing dip curve too
  const dipAt = (fps, t) => {
    const f = new MoveFeel(); const dt = 1 / fps; let o;
    f.step(dt, {vy: -6, grounded: false});
    o = f.step(dt, {vy: 0, grounded: true, landed: true});
    for (let k = 1; k < Math.round(t * fps); k++) o = f.step(dt, {grounded: true});
    return o.eyeOffset;
  };
  assert.ok(Math.abs(dipAt(30, 0.2) - dipAt(144, 0.2)) < 0.01);
});

test('footsteps per meter match stride', () => {
  const f = new MoveFeel(); let steps = 0;
  for (let k = 0; k < 600; k++) if (f.step(1 / 60, {speed: PC.WALK_SPEED, grounded: true}).footstep) steps++;
  const meters = PC.WALK_SPEED * 10;
  assert.ok(Math.abs(steps - meters / FEEL.STRIDE_WALK) <= 1, `${steps} steps over ${meters}m`);
  const s = new MoveFeel(); let ss = 0;
  for (let k = 0; k < 600; k++) if (s.step(1 / 60, {speed: PC.SPRINT_SPEED, grounded: true}).footstep) ss++;
  assert.ok(Math.abs(ss - PC.SPRINT_SPEED * 10 / FEEL.STRIDE_SPRINT) <= 1);
});

test('footstep alternates sides and lands at bob trough', () => {
  const f = new MoveFeel(); const sides = []; let minY = 0;
  for (let k = 0; k < 300; k++) {
    const o = f.step(1 / 120, {speed: 2.6, grounded: true});
    minY = Math.min(minY, o.bobY);
    if (o.footstep) { sides.push(o.stepSide); if (k > 120) assert.ok(o.bobY < minY * 0.85, 'near trough'); }
  }
  for (let k = 1; k < sides.length; k++) assert.notEqual(sides[k], sides[k - 1]);
});

test('no bob when idle, no steps in air/water, settles to 0 after stopping', () => {
  const f = new MoveFeel();
  for (let k = 0; k < 60; k++) {
    const o = f.step(1 / 60, {speed: 0, grounded: true});
    assert.ok(o.bobY === 0 && o.bobX === 0 && o.roll === 0); assert.ok(!o.footstep);
  }
  for (let k = 0; k < 60; k++) assert.ok(!f.step(1 / 60, {speed: 3, grounded: false}).footstep);
  for (let k = 0; k < 60; k++) assert.ok(!f.step(1 / 60, {speed: 2, grounded: true, swimming: true}).footstep);
  for (let k = 0; k < 120; k++) f.step(1 / 60, {speed: 2.6, grounded: true});
  let o, prev = Infinity;
  for (let k = 0; k < 120; k++) {
    o = f.step(1 / 60, {speed: 0, grounded: true});
    const mag = Math.abs(o.bobY) + Math.abs(o.bobX);
    assert.ok(mag <= prev + 1e-12); prev = mag;
  }
  assert.ok(Math.abs(o.bobY) < 1e-4 && Math.abs(o.bobX) < 1e-4 && Math.abs(o.roll) < 1e-4);
});

function peakDip(vy, f = new MoveFeel()) {
  f.step(1 / 120, {vy, grounded: false});
  let peak = 0, o = f.step(1 / 120, {vy: 0, grounded: true, landed: true});
  for (let k = 0; k < 120; k++) { peak = Math.min(peak, o.eyeOffset); o = f.step(1 / 120, {grounded: true}); }
  return {peak: -peak || 0, end: o.eyeOffset};
}

test('landing dip proportional, clamped, recovers', () => {
  const a = peakDip(-4), b = peakDip(-7), big = peakDip(-50), soft = peakDip(-0.5);
  assert.ok(b.peak > a.peak * 1.5, `${a.peak} ${b.peak}`);
  assert.ok(Math.abs(b.peak - 7 * FEEL.DIP_PER_MS) < 0.01);
  assert.ok(big.peak <= FEEL.DIP_MAX + 1e-6 && big.peak > FEEL.DIP_MAX * 0.95);
  assert.equal(soft.peak, 0);
  assert.ok(Math.abs(a.end) < 0.003 && Math.abs(big.end) < 0.003, 'recovered after 1s');
  // ~0.3s recovery: mostly back by 0.35s
  const f = new MoveFeel(); f.step(1 / 60, {vy: -8, grounded: false});
  let o = f.step(1 / 60, {grounded: true, landed: true});
  for (let k = 0; k < 21; k++) o = f.step(1 / 60, {grounded: true});
  assert.ok(Math.abs(o.eyeOffset) < 0.25 * 8 * FEEL.DIP_PER_MS);
});

test('crouch eyeOffset eases to -0.55 in ~0.15s and back', () => {
  const f = new MoveFeel(); let o;
  for (let k = 0; k < 9; k++) o = f.step(1 / 60, {grounded: true, crouch: true});
  assert.ok(o.eyeOffset < FEEL.CROUCH_EYE * 0.9 && o.eyeOffset >= FEEL.CROUCH_EYE);
  for (let k = 0; k < 60; k++) o = f.step(1 / 60, {grounded: true, crouch: true});
  assert.ok(Math.abs(o.eyeOffset - FEEL.CROUCH_EYE) < 1e-4);
  for (let k = 0; k < 60; k++) o = f.step(1 / 60, {grounded: true});
  assert.ok(o.eyeOffset === 0);
});

test('motionScale 0 disables camera effects but footsteps fire', () => {
  const f = new MoveFeel({motionScale: 0}); let steps = 0;
  f.step(1 / 60, {vy: -9, grounded: false});
  for (let k = 0; k < 240; k++) {
    const o = f.step(1 / 60, {speed: 3, grounded: true, landed: k === 0});
    assert.equal(o.bobY + o.bobX + o.roll + o.eyeOffset, 0);
    if (o.footstep) steps++;
  }
  assert.ok(steps > 5);
  const h = new MoveFeel({motionScale: 0.5}), full = new MoveFeel();
  let oh, of;
  for (let k = 0; k < 50; k++) { oh = h.step(1 / 60, {speed: 3, grounded: true}); of = full.step(1 / 60, {speed: 3, grounded: true}); }
  assert.ok(Math.abs(oh.bobX - of.bobX / 2) < 1e-12);
  f.setMotionScale(7); assert.equal(f.motionScale, 1);
});

test('ladder climb up/down, clamp at top/bottom, jump detaches', () => {
  const f = new MoveFeel(); const dt = 1 / 60;
  assert.equal(f.isOnLadder(), false);
  assert.equal(f.setLadder({bottomY: 0, topY: 3, x: 1, z: 2, normal: [0, 2]}), true);
  assert.ok(f.isOnLadder());
  let y = 0, r, steps = 0;
  for (let k = 0; k < 60; k++) {
    r = f.ladderInput(dt, {forward: 1, y}); y += r.vy * dt;
    if (f.step(dt, {onLadder: true}).footstep) steps++;
  }
  assert.ok(Math.abs(y - FEEL.CLIMB_SPEED) < 1e-9 && !r.detach);
  assert.ok(steps >= 3, 'ladder rung steps');
  for (let k = 0; k < 120; k++) { r = f.ladderInput(dt, {forward: 1, y}); y += r.vy * dt; }
  assert.ok(Math.abs(y - 3) < 1e-9 && r.atTop && r.vy === 0);
  for (let k = 0; k < 300; k++) { r = f.ladderInput(dt, {forward: -1, y}); y += r.vy * dt; }
  assert.ok(Math.abs(y) < 1e-9 && r.atBottom && r.vy === 0);
  // held jump from attach does not detach; fresh press does
  f.setLadder({bottomY: 0, topY: 3, normal: [0, 2]});
  assert.equal(f.ladderInput(dt, {jump: true, y: 1}).detach, false);
  f.ladderInput(dt, {jump: false, y: 1});
  r = f.ladderInput(dt, {jump: true, y: 1});
  assert.ok(r.detach && r.vy > 0 && Math.abs(r.pushZ - FEEL.LADDER_PUSH) < 1e-9 && r.pushX === 0);
  assert.equal(f.isOnLadder(), false);
  assert.equal(f.ladderInput(dt, {forward: 1}).vy, 0);
  assert.equal(f.setLadder({bottomY: 5, topY: 1}), false);
  assert.equal(f.setLadder(null), false);
});

test('NaN / garbage input is safe', () => {
  const f = new MoveFeel({motionScale: NaN, feel: 'x'});
  const junk = [undefined, null, 5, 'str', {forward: NaN, strafe: Infinity, sprint: 'y'}, {speed: -Infinity, vy: NaN, landed: true}];
  for (const dt of [NaN, -1, Infinity, 0, 1e9, 1 / 60]) for (const j of junk) {
    const s = f.shapeInput(dt, j);
    assert.ok(Number.isFinite(s.forward) && Number.isFinite(s.strafe));
    const o = f.step(dt, j);
    for (const k of ['bobY', 'bobX', 'roll', 'eyeOffset']) assert.ok(Number.isFinite(o[k]), k);
    f.setLadder({bottomY: 0, topY: 2, normal: [NaN, 'a']});
    const l = f.ladderInput(dt, j);
    assert.ok(Number.isFinite(l.vy));
  }
  assert.equal(f.setLadder({bottomY: NaN, topY: 2}), false);
});
