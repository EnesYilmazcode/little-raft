// Unit tests for dist/coop-interp.js (SnapshotBuffer + lerpAngle).
// Run: node --test tests/coop-interp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
const { SnapshotBuffer, lerpAngle } = await import(new URL('../dist/coop-interp.js', import.meta.url));

// Deterministic PRNG (mulberry32).
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Simulate: `sends` = [{t, snap}] in sender time; each arrives at t + clockOffset + 30 + jitter.
// Returns per-frame samples [{now, ...out}] at 60 fps.
function run(sends, { jitter = 0, clockOffset = 0, seed = 1, endMs, buf = new SnapshotBuffer(), onFrame } = {}) {
  const r = rng(seed);
  const arrivals = sends.map(({ snap }) => ({ snap, at: snap.t + clockOffset + 30 + (r() * 2 - 1) * jitter }))
    .sort((a, b) => a.at - b.at);
  const end = endMs ?? (sends[sends.length - 1].snap.t + clockOffset + 600);
  const frames = [];
  let k = 0;
  for (let now = arrivals[0].at; now <= end; now += 1000 / 60) {
    while (k < arrivals.length && arrivals[k].at <= now) { buf.push(arrivals[k].snap, arrivals[k].at); k++; }
    const out = buf.sample(now, {});
    if (out) frames.push({ now, ...out, hook: out.hook && { ...out.hook } });
    onFrame?.(now, buf);
  }
  return { frames, buf };
}
const snapAt = (t, x, extra = {}) => ({ t, x, y: 0, z: 0, yaw: 0, pitch: 0, ...extra });
const moving = (t0, t1, hz, posAt, extra) => { const a = []; for (let t = t0; t <= t1; t += 1000 / hz) a.push({ snap: snapAt(t, posAt(t), extra?.(t)) }); return a; };

test('15 Hz with ±40 ms jitter: monotone, bounded per-frame step', () => {
  const v = 3 / 1000; // 3 m/s
  const { frames, buf } = run(moving(0, 6000, 15, (t) => v * t), { jitter: 40, seed: 7 });
  const steady = frames.filter((f) => f.now > 1500 && f.x < v * 5900);
  assert.ok(steady.length > 200);
  let maxStep = 0, extrap = 0;
  for (let i = 1; i < steady.length; i++) {
    const d = steady[i].x - steady[i - 1].x;
    assert.ok(d >= -1e-9, `backwards step ${d} at frame ${i}`);
    maxStep = Math.max(maxStep, d);
    if (steady[i].extrapolating) extrap++;
  }
  assert.ok(maxStep < v * (1000 / 60) * 1.6, `max step ${maxStep}`);
  assert.ok(extrap / steady.length < 0.05, `extrapolating ${extrap} frames`);
  const st = buf.stats;
  assert.ok(st.delayMs >= 50 && st.delayMs <= 250, `delay ${st.delayMs}`);
  assert.ok(Math.abs(st.intervalMs - 1000 / 15) < 2, `interval ${st.intervalMs}`);
  assert.ok(steady.every((f) => Math.abs(f.speed - 3) < 0.6), 'speed ~3 m/s');
});

test('reordering and duplicates', () => {
  const b = new SnapshotBuffer();
  const snaps = [0, 1, 2, 3, 4, 5].map((i) => snapAt(i * 66, i));
  const order = [0, 2, 1, 3, 5, 4];
  for (const i of order) assert.equal(b.push(snaps[i], 1000 + i * 66), true);
  assert.equal(b.push(snaps[2], 1500), false, 'duplicate rejected');
  assert.equal(b.push({ ...snaps[3] }, 1500), false, 'duplicate t rejected');
  assert.deepEqual(b.snaps.map((s) => s.t), [0, 66, 132, 198, 264, 330]);
  assert.equal(b.push({ t: NaN, x: 0 }, 1), false);
  // Shuffled delivery samples identically to in-order delivery.
  const a = new SnapshotBuffer();
  snaps.forEach((s, i) => a.push(s, 1000 + i * 66));
  for (let now = 1100; now < 1500; now += 16) {
    const oa = a.sample(now), ob = b.sample(now);
    assert.ok(Math.abs(oa.x - ob.x) < 1e-9);
  }
});

test('large clock offset (either sign) is cancelled', () => {
  for (const clockOffset of [-5e9, 3.7e8]) {
    const v = 2 / 1000;
    const { frames, buf } = run(moving(1e6, 1e6 + 4000, 15, (t) => v * (t - 1e6)), { jitter: 20, clockOffset });
    assert.ok(Math.abs(buf.stats.offsetMs - (clockOffset + 30 - 20)) < 25, `offset ${buf.stats.offsetMs}`);
    const f = frames.find((q) => q.now > 1e6 + clockOffset + 2000);
    // Rendered roughly (latency + delay) behind the sender.
    const lagMs = (v * (f.now - clockOffset - 1e6) - f.x) / v;
    assert.ok(lagMs > 30 && lagMs < 350, `lag ${lagMs}`);
  }
});

test('extrapolation is capped then holds', () => {
  const v = 4 / 1000;
  const b = new SnapshotBuffer({ maxExtrapolateMs: 250 });
  const { frames } = run(moving(0, 2000, 15, (t) => v * t), { buf: b, endMs: 4000 });
  const last = 2000 - (2000 % (1000 / 15)) ; const lastX = v * last;
  const ex = frames.filter((f) => f.extrapolating);
  assert.ok(ex.length > 0);
  const maxX = Math.max(...frames.map((f) => f.x));
  assert.ok(maxX - lastX < v * 250, `overshoot ${maxX - lastX}`);
  const tail = frames.filter((f) => f.now > 3000);
  assert.ok(tail.every((f) => f.x === tail[0].x && f.speed === 0), 'holds after cap');
});

test('teleport snaps instead of sliding, flagged once', () => {
  const sends = [...moving(0, 1000, 15, (t) => t / 1000), ...moving(1000 + 1000 / 15, 2500, 15, (t) => 100 + t / 1000)];
  const { frames } = run(sends);
  assert.equal(frames.filter((f) => f.teleported).length, 1);
  assert.ok(!frames.some((f) => f.x > 1.2 && f.x < 100), 'no intermediate positions');
});

test('idle-rate gaps (4 Hz repeats) do not inflate delay or stutter', () => {
  const v = 3 / 1000;
  // Move 0..3s at 15 Hz, stand still 3..7s (snaps at 4 Hz with same pos), move again 7..10s.
  const stopX = v * 3000;
  const sends = [
    ...moving(0, 3000, 15, (t) => v * t),
    ...moving(3250, 7000, 4, () => stopX),
    ...moving(7000 + 1000 / 15, 10000, 15, (t) => stopX + v * (t - 7000)),
  ];
  let maxDelay = 0;
  const { frames, buf } = run(sends, { jitter: 30, seed: 3, onFrame: (now, b) => { if (now > 1500) maxDelay = Math.max(maxDelay, b.stats.delayMs); } });
  assert.ok(maxDelay < 200, `delay inflated to ${maxDelay}`);
  assert.ok(buf.stats.intervalMs < 80, `interval ${buf.stats.intervalMs}`);
  const idle = frames.filter((f) => f.now > 4500 && f.now < 7000);
  assert.ok(idle.every((f) => Math.abs(f.x - stopX) < 1e-6), 'holds exactly while idle');
  const stopOvershoot = Math.max(...frames.filter((f) => f.now < 7000).map((f) => f.x)) - stopX;
  assert.ok(stopOvershoot < 0.25, `stop overshoot ${stopOvershoot}`);
  // Resume: monotone with bounded steps, no lurch.
  const res = frames.filter((f) => f.now > 7000 && f.now < 9900);
  for (let i = 1; i < res.length; i++) {
    const d = res[i].x - res[i - 1].x;
    assert.ok(d >= -1e-9 && d < v * (1000 / 60) * 2, `resume step ${d}`);
  }
});

test('sender restart (t jumps back) auto-resets', () => {
  const b = new SnapshotBuffer();
  for (let i = 0; i < 20; i++) b.push(snapAt(50000 + i * 66, i), 1000 + i * 66);
  b.sample(2300);
  assert.equal(b.push(snapAt(10, 50), 2400), false, 'single straggler is not trusted');
  assert.equal(b.count ?? b.stats.count, 20);
  assert.equal(b.push(snapAt(76, 50), 2466), true, 'second consistent snap confirms restart');
  assert.equal(b.stats.count, 2);
  assert.ok(Math.abs(b.stats.offsetMs - 2390) < 1);
  for (let i = 2; i < 10; i++) b.push(snapAt(10 + i * 66, 50), 2400 + i * 66);
  assert.equal(b.sample(3500).x, 50);
  // A lone late straggler after the reset is simply dropped.
  assert.equal(b.push(snapAt(-5000, 0), 3500), false);
  assert.equal(b.sample(3520).x, 50);
});

test('yaw wraps on the shortest arc at ±PI', () => {
  const a = Math.PI - 0.1, c = -Math.PI + 0.1;
  const m = lerpAngle(a, c, 0.5);
  assert.ok(Math.abs(Math.cos(m) + 1) < 1e-9 && Math.abs(Math.sin(m)) < 1e-9);
  assert.ok(Math.abs(lerpAngle(c, a, 0.25) - (c - 0.05)) < 1e-9);
  assert.ok(Math.abs(lerpAngle(0, 3 * Math.PI, 1) - Math.PI) < 1e-9 || Math.abs(lerpAngle(0, 3 * Math.PI, 1) + Math.PI) < 1e-9);
  // Turning steadily through the seam: per-frame angular change stays tiny.
  const w = 2 / 1000; // rad/ms... 2 rad/s
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const { frames } = run(moving(0, 4000, 15, () => 0, (t) => ({ yaw: wrap(2 + (w / 1) * t) })), { jitter: 20 });
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(wrap(frames[i].yaw - frames[i - 1].yaw));
    assert.ok(d < 0.1, `yaw jump ${d}`);
  }
});

test('hook sub-position is interpolated when consecutive snaps have it', () => {
  const sends = moving(0, 2000, 15, () => 0, (t) => (t >= 1000 ? { hook: { x: t / 100, y: 1, z: 0 } } : {}));
  const { frames } = run(sends);
  const withHook = frames.filter((f) => f.hook);
  assert.ok(withHook.length > 30);
  assert.ok(frames.filter((f) => f.now < 900).every((f) => f.hook === null));
  for (let i = 1; i < withHook.length; i++) assert.ok(withHook[i].hook.x >= withHook[i - 1].hook.x - 1e-9);
});
