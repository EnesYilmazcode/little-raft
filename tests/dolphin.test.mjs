// Unit tests for dist/dolphin-core.js (dolphin friend, docs/specs/dolphin.md).
// Run: node --test tests/dolphin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const D = await import(new URL('dolphin-core.js', base));
const W = await import(new URL('wildlife.js', base));

const bagOf = n => ({ n, count(k) { return k === 'fish' ? this.n : 0; }, remove(k, c) { if (k !== 'fish' || this.n < c) return false; this.n -= c; return true; } });
const friend = (extra = {}) => Object.assign(D.emptyState(), { friend: true, pts: 3, hearts: 1, seed: 1234, name: 'Nori' }, extra);

test('cleanDolphin: junk -> defaults, clamps, names, roles, nudge dropped', () => {
  for (const v of [undefined, null, [], 'x', 7, [1, 2]]) {
    const s = D.cleanDolphin(v);
    assert.deepEqual(s, D.emptyState());
    assert.equal(s.friend, false); assert.equal(s.pts, 0); assert.equal(s.tossAt, -1e9); assert.equal(s.nextNudge, 120);
  }
  const s = D.cleanDolphin({ t: 50, pts: 99, hearts: 40, friend: true, seed: -1, tossAt: 900, patAt: NaN, callAt: 60, name: '<b>Bubbles the Magnificent</b>', esc: 'shark', callWho: 'guest', by: 7, nudge: { tok: 'a', at: 3 }, pops: -4, nextNudge: 99999 });
  assert.equal(s.pts, 3); assert.equal(s.hearts, 10);
  assert.equal(s.tossAt, 50); assert.equal(s.patAt, -1e9); assert.equal(s.callAt, 50);
  assert.equal(s.seed, 0xffffffff);
  assert.ok(Array.from(s.name).length <= 14 && s.name.startsWith('<b>Bubbles'), s.name); // escaped on display, drawn as canvas text
  assert.equal(s.esc, ''); assert.equal(s.callWho, 'guest'); assert.equal(s.by, '');
  assert.equal(s.nudge, null); assert.equal(s.pops, 0); assert.equal(s.nextNudge, 650);
  assert.equal(D.cleanDolphin({ friend: true, seed: 5 }).name, D.defaultName(5));
  assert.equal(D.cleanDolphin({ friend: false, pts: 3, name: 'Zed' }).pts, 2);
  assert.equal(D.cleanDolphin({ friend: false, pts: 3, name: 'Zed' }).name, '');
  assert.equal(D.cleanDolphin({ t: 1e12 }).t, 1e9);
  assert.equal(D.cleanDolphin({ t: -5, nextNudge: -3 }).nextNudge, 0);
  assert.equal(D.defaultName(0), 'Splash'); assert.equal(D.defaultName(13), 'Marina');
});

test('toss: needs a fish, a wild dolphin and the cooldown; the 3rd toss bonds', () => {
  const st = D.emptyState(), bag = bagOf(5);
  assert.deepEqual(D.toss(st, bagOf(0), 0, true), { ok: false, text: 'Bring a raw fish', bonded: false });
  assert.equal(D.toss(st, bag, 0, false).ok, false);
  assert.equal(D.toss(st, bag, 0, false).text, '');
  let r = D.toss(st, bag, 0, true);
  assert.ok(r.ok && !r.bonded); assert.equal(st.pts, 1); assert.equal(bag.n, 4); assert.equal(st.pops, 1);
  r = D.toss(st, bag, 7.9, true);
  assert.equal(r.ok, false); assert.equal(r.text, 'It’s still munching…'); assert.equal(bag.n, 4);
  assert.ok(D.toss(st, bag, 8, true).ok);
  r = D.toss(st, bag, 16, true);
  assert.ok(r.ok && r.bonded); assert.equal(st.friend, true); assert.equal(st.hearts, 1); assert.equal(bag.n, 2);
  r = D.toss(st, bag, 100, true);
  assert.equal(r.ok, false); assert.equal(r.text, ''); assert.equal(bag.n, 2);
});

test('pat: 60 s heart cooldown, cap 10, pops only on a heart', () => {
  assert.equal(D.pat(D.emptyState(), 0).ok, false);
  const st = friend({ patAt: -1e9 });
  assert.deepEqual(D.pat(st, 0), { ok: true, heart: true }); assert.equal(st.hearts, 2); assert.equal(st.pops, 1);
  assert.deepEqual(D.pat(st, 59), { ok: true, heart: false }); assert.equal(st.hearts, 2); assert.equal(st.pops, 1);
  for (let i = 1; i <= 20; i++) D.pat(st, i * 60);
  assert.equal(st.hearts, 10);
});

test('rename refuses empty names', () => {
  const st = friend();
  assert.equal(D.rename(st, '   ').ok, false); assert.equal(st.name, 'Nori');
  assert.ok(D.rename(st, 'Bubbles').ok); assert.equal(st.name, 'Bubbles');
});

test('call: needs a friend, 30 s cooldown, calling() lasts 20 s and names the caller', () => {
  assert.equal(D.call(D.emptyState(), 'host', 0).ok, false);
  const st = friend();
  assert.ok(D.call(st, 'guest', 100).ok);
  assert.equal(D.calling(st, 100), 'guest'); assert.equal(D.calling(st, 119.9), 'guest'); assert.equal(D.calling(st, 120), '');
  const r = D.call(st, 'host', 129);
  assert.equal(r.ok, false); assert.equal(r.text, 'Still echoing… try again soon');
  assert.ok(D.call(st, 'host', 130).ok); assert.equal(D.calling(st, 131), 'host');
});

test('modeAt: deterministic, beat 0 loops, ~20% point only with a point', () => {
  assert.equal(D.modeAt(7, 5, true), 'loop');
  assert.equal(D.modeAt(7, 500, true), D.modeAt(7, 500, true));
  let point = 0;
  for (let b = 1; b <= 1000; b++) {
    const m = D.modeAt(99, b * D.BEAT + 1, true), n = D.modeAt(99, b * D.BEAT + 1, false);
    assert.notEqual(n, 'point');
    if (m === 'point') point++;
    if (b % 4 === 3) assert.ok(n === 'show');
  }
  assert.ok(point > 150 && point < 250, String(point));
});

test('behaviour priority: call > nudge > escort > idle', () => {
  const st = friend({ esc: 'host', nudge: { tok: 'x', at: 0 } });
  D.call(st, 'guest', 10);
  assert.equal(D.behaviour(st, 11, true), 'call');
  assert.equal(D.behaviour(st, 40, true), 'nudge');
  st.nudge = null;
  assert.equal(D.behaviour(st, 40, true), 'escort');
  st.esc = '';
  assert.ok(['loop', 'show', 'point'].includes(D.behaviour(st, 40, true)));
});

test('pickEscort: in water, in range, keeps current, host first', () => {
  const c = { x: 0, z: 0, r: 3 };
  assert.equal(D.pickEscort([{ who: 'host', x: 2, z: 0, inWater: false }], c, ''), '');
  assert.equal(D.pickEscort([{ who: 'host', x: 30, z: 0, inWater: true }], c, ''), '');
  const both = [{ who: 'guest', x: 5, z: 0, inWater: true }, { who: 'host', x: 6, z: 0, inWater: true }];
  assert.equal(D.pickEscort(both, c, ''), 'host');
  assert.equal(D.pickEscort(both, c, 'guest'), 'guest');
  assert.equal(D.pickEscort([{ who: 'guest', x: 5, z: 0, inWater: true }], c, 'host'), 'guest');
  assert.equal(D.pickEscort([{ who: 'host', x: NaN, z: 0, inWater: true }], c, ''), '');
});

test('pickNudge: whitelist, distance band, players, nets, nearest, finite only', () => {
  const c = { x: 0, z: 0, r: 3 };
  const items = [
    { token: 'cache', type: 'cache', x: 9, z: 0 }, { token: 'bottle', type: 'bottle', x: 0, z: 9 }, { token: 'new', type: 'mystery', x: -9, z: 0 },
    { token: 'near', type: 'wood', x: 5, z: 0 }, { token: 'far', type: 'wood', x: 30, z: 0 }, { token: 'nan', type: 'wood', x: NaN, z: 9 },
    { token: 'b', type: 'plastic', x: 0, z: -15 }, { token: 'a', type: 'scrap', x: 0, z: -11 },
  ];
  assert.equal(D.pickNudge(items, c, [], []).token, 'a');
  assert.equal(D.pickNudge(items, c, [{ x: 0, z: -7 }], []).token, 'b');
  assert.equal(D.pickNudge(items, c, [null, { x: 0, z: -7 }], [{ x: 0, z: -16 }]), null);
  assert.equal(D.pickNudge(items, c, [], [], new Set(['a'])).token, 'b');
  assert.equal(D.pickNudge(items, { x: 0, z: 0, r: 9 }, [], []).token, 'b'); // band starts at r + 3 = 12
  assert.equal(D.pickNudge(null, c, [], []), null);
});

test('stepNudge moves at 0.6 m/s and stops inside r+3; nudgeAbort rules', () => {
  const c = { x: 0, z: 0, r: 3 }, it = { x: 0, z: -10 };
  assert.equal(D.stepNudge(it, c, 1), true);
  assert.ok(Math.abs(it.z + 9.4) < 1e-9 && Math.abs(it.x) < 1e-9);
  let n = 0; while (D.stepNudge(it, c, 1) && n < 100) n++;
  assert.ok(Math.hypot(it.x, it.z) >= 6 - 1e-9 && Math.hypot(it.x, it.z) <= 6.6, String(it.z));
  assert.equal(D.stepNudge({ x: 0, z: -5 }, c, 1), false);
  const st = friend({ nudge: { tok: 'a', at: 10 } }), far = { x: 0, z: -15 };
  assert.equal(D.nudgeAbort(st, far, 15, [], []), false);
  assert.equal(D.nudgeAbort(st, far, 22.1, [], []), true);
  assert.equal(D.nudgeAbort(st, null, 15, [], []), true);
  assert.equal(D.nudgeAbort(st, far, 15, [{ x: 0, z: -10 }], []), true);
  assert.equal(D.nudgeAbort(st, far, 15, [], [{ x: 1, z: -14 }]), true);
});

test('poses: deterministic, radius, follow side, point reach, no NaN', () => {
  const a = D.newPose(), b = D.newPose();
  D.loopPose(42, 33.3, 3, a); D.loopPose(42, 33.3, 3, b);
  assert.deepEqual(a, b);
  for (const ext of [0, 3, 11, NaN]) for (let t = 0; t < 200; t += 3.7) {
    D.loopPose(42, t, ext, a);
    const push = W.pushOut(Number.isFinite(ext) ? ext : 0, W.CIRCLER_MARGIN, 7);
    assert.ok(Math.hypot(a.x, a.z) >= 7 - 1.5 + push - 1e-9, `${ext} ${t}`);
    for (const k of ['x', 'y', 'z', 'heading', 'pitch', 'roll']) assert.ok(Number.isFinite(a[k]), k);
    D.showPose(42, t, ext, b);
    for (const k of ['x', 'y', 'z', 'heading', 'pitch', 'roll']) assert.ok(Number.isFinite(b[k]), 'show ' + k);
    assert.ok(b.z < 0, 'show stays off the bow');
  }
  for (const yaw of [0, 1, -2.5]) {
    D.followPose({ x: 3, z: 4 }, yaw, a);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    assert.ok(Math.abs((a.x - 3) * rx + (a.z - 4) * rz - D.ESC_SIDE) < 1e-9);
    assert.ok(Math.abs(Math.hypot(a.x - 3, a.z - 4) - Math.hypot(D.ESC_SIDE, D.ESC_AHEAD)) < 1e-9);
  }
  const centre = { x: 0, z: 0, r: 3 };
  D.pointPose(5, 6 + D.BEAT * 3, centre, { x: 0, z: -80 }, a, 3);
  assert.ok(Math.hypot(a.x, a.z) <= D.POINT_MAX + 1 && Math.hypot(a.x, a.z) >= D.POINT_MAX - 1, String(a.z));
  D.pointPose(5, 6, centre, { x: 0, z: -5 }, a, 3);
  assert.ok(Math.hypot(a.x, a.z + 5) <= 1);
  D.pointPose(5, 2, centre, { x: 0, z: 0 }, a, NaN);
  for (const k of ['x', 'y', 'z', 'heading']) assert.ok(Number.isFinite(a[k]), 'point ' + k);
  D.nudgePose({ x: 0, z: -10 }, centre, a, 3);
  assert.ok(Math.abs(a.z + 10.9) < 1e-9 && Math.abs(a.heading) < 1e-9);
});

test('nextNudgeAt lands 100..140 s ahead and is deterministic', () => {
  for (let k = 0; k < 200; k++) {
    const d = D.nextNudgeAt(77, 500, k) - 500;
    assert.ok(d >= 100 && d <= 140, String(d));
    assert.equal(D.nextNudgeAt(77, 500, k), D.nextNudgeAt(77, 500, k));
  }
});
