// Unit tests for dist/zipline.js (glide posts, lines, the ride) and dist/zipline-model.js (docs/specs/zipline.md section 11).
// Run: node --test tests/zipline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const Z = await import(new URL('zipline.js', base));
const M = await import(new URL('zipline-model.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const { HELD, poseFlags, readFlags } = await import(new URL('coop.js', base));
const { buildItemModel } = await import(new URL('held-items.js', base));
const { cleanZip, postAt, linesAt, canLink, lineBlocked, lineWorld, stepRide, riderPose, nearestOnLine, ropeCost, TEXT,
  POSTS, MIN_LEN, MAX_LEN, V_MIN, V_MAX, V_START, HANG, ENDPAD, HOP_VY, DROP_VY, OLD_HOST } = Z;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith([{ kind: 'glidehandle', count: 1 }, ...Array.from({ length: SLOT_COUNT - 1 }, () => ({ kind: 'scrap', count: 20 }))]);
const post = (x, z, type = 'glidepost') => ({ type, x, z });
const ln = (ay, by, len, extra = {}) => ({ ax: 0, ay, az: 0, bx: len, by, bz: 0, ...extra }); // horizontal len metres along x
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const run = (r, line, dt, inp = {}, max = 10000) => { let res = 'ride', n = 0; while (res === 'ride' && n++ < max) res = stepRide(r, line, dt, inp); return res; };
const L3 = l => Math.hypot(l.bx - l.ax, l.by - l.ay, l.bz - l.az);

// ------------------------------------------------------------------ 1. motion
test('stepRide: downhill speeds up from V_START and stays <= V_MAX; steep clamps at V_MAX', () => {
  const l = ln(3.4, 2.4, 6), r = { t: ENDPAD, v: V_START, dir: 1 };
  stepRide(r, l, .2, {}); assert.ok(r.v > V_START);
  let top = 0; while (stepRide(r, l, .05, {}) === 'ride') top = Math.max(top, r.v);
  assert.ok(top <= V_MAX);
  const steep = ln(10, 0, 12), s = { t: ENDPAD, v: V_START, dir: 1 };
  let maxV = 0; while (stepRide(s, steep, .05, {}) === 'ride') maxV = Math.max(maxV, s.v);
  assert.equal(maxV, V_MAX);
});

test('stepRide: flat holds V_MIN; uphill and braking never drop below V_MIN and still reach the end', () => {
  const flat = ln(3, 3, 8), r = { t: 2, v: .5, dir: 1 };
  stepRide(r, flat, .05, {}); assert.equal(r.v, V_MIN);
  const up = ln(2.4, 3.4, 6), u = { t: ENDPAD, v: V_START, dir: 1 };
  let minV = Infinity, res = 'ride', n = 0;
  while (res === 'ride' && n++ < 10000) { res = stepRide(u, up, .05, { forward: -1 }); minV = Math.min(minV, u.v); }
  assert.equal(res, 'end'); assert.ok(minV >= V_MIN);
  const b = { t: ENDPAD, v: V_START, dir: 1 }; stepRide(b, flat, .25, { forward: -5 }); assert.ok(b.v >= V_MIN);
});

test('stepRide: dt is clamped; end clamps t to the padded span in both directions; deterministic', () => {
  const l = ln(3.4, 2.4, 12), r = { t: 3, v: V_MAX, dir: 1 };
  stepRide(r, l, 1e6, {}); assert.ok(r.t - 3 <= .25 * V_MAX + 1e-9);
  const e = { t: ENDPAD, v: V_START, dir: 1 }; assert.equal(run(e, l, .05), 'end'); close(e.t, L3(l) - ENDPAD);
  const w = { t: L3(l) - ENDPAD, v: V_START, dir: -1 }; assert.equal(run(w, l, .05), 'end'); close(w.t, ENDPAD);
  const a = { t: 1, v: 2, dir: 1 }, b = { t: 1, v: 2, dir: 1 }, seq = [.016, .033, .25, 0, .1, 1, .05];
  for (let k = 0; k < 4; k++) for (const dt of seq) { stepRide(a, l, dt, { forward: .5 }); stepRide(b, l, dt, { forward: .5 }); }
  assert.deepEqual(a, b);
  assert.equal(stepRide({ t: 1, v: 2, dir: 1 }, l, NaN, {}), 'ride');
});

// ------------------------------------------------------------------ 2. riderPose
test('riderPose: eye HANG below the wheel point; velocity magnitude v along dir', () => {
  const l = ln(3.4, 2.4, 6), out = {};
  riderPose({ t: L3(l) / 2, v: 4, dir: 1 }, l, out);
  close(out.x, 3); close(out.y, 2.9 - HANG); close(out.z, 0);
  close(Math.hypot(out.vx, out.vy, out.vz), 4); assert.ok(out.vx > 0 && out.vy < 0);
  riderPose({ t: 1, v: 3, dir: -1 }, l, out); assert.ok(out.vx < 0 && out.vy > 0); close(Math.hypot(out.vx, out.vy, out.vz), 3);
});

// ------------------------------------------------------------------ 3. cleanZip
test('cleanZip: junk -> defaults; bad, self, short, long, over-full, duplicate and orphan lines dropped; canonical order', () => {
  const D = { v: 1, s: '', r: 0, l: [] };
  for (const v of [undefined, null, [], 'x', 3, { l: 'x' }]) assert.deepEqual(cleanZip(v, [post(0, 0)]), D);
  const decor = [post(0, 0), post(3, 0, 'glidestep'), post(0, 3), post(3, 3), post(1, 0), post(9, 0), post(-3, 0), { type: 'palm', x: 0, z: -3 }];
  const st = cleanZip({ v: 1, s: 'abc', r: 5, l: [
    [3, 0, 0, 0],          // reversed -> canonical [0,0,3,0]
    [0, 0, 3, 0],          // duplicate
    [0, 0, 0, 0],          // self
    [0, 0, 1, 0],          // short (2 m)
    [0, 0, 9, 0],          // long (18 m)
    [0, 0.5, 3, 3],        // float
    [0, 0, 0, -3],         // palm, not a post
    [0, 0, 5, 5],          // missing tile
    [0, 0, 0, 3],          // second line on 0,0
    [-3, 0, 0, 0],         // third line on 0,0 -> dropped
    [3, 3, 3, 0],          // ok
    'x', [1, 2, 3],
  ] }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 5);
  assert.deepEqual(st.l, [[0, 0, 3, 0], [0, 0, 0, 3], [3, 0, 3, 3]]);
  const pruned = cleanZip(st, decor.filter(d => !(d.x === 3 && d.z === 0)));
  assert.deepEqual(pruned.l, [[0, 0, 0, 3]]);
  assert.equal(postAt(decor, 3, 0), 'glidestep'); assert.equal(postAt(decor, 0, -3), null);
  assert.deepEqual(linesAt(st, 0, 0), [0, 1]); assert.deepEqual(linesAt(st, 3, 3), [2]);
});

// ------------------------------------------------------------------ 4. canLink / lineBlocked
test('canLink: every reason in order; walls and roofs block, foundations and walls beside the line do not; rope costs', () => {
  const decor = [post(0, 0), post(3, 0, 'glidestep'), post(1, 0), post(9, 0), post(0, 3), post(-3, 0), post(0, -3), { type: 'palm', x: 2, z: 0 }];
  const st = cleanZip(undefined, decor);
  assert.equal(canLink(st, decor, [], 0, 0, 0, 0).reason, 'same');
  assert.equal(canLink(st, decor, [], 0, 0, 2, 0).reason, 'post');
  assert.equal(canLink(st, decor, [], 0, 0, 1, 0).reason, 'short');
  assert.equal(canLink(st, decor, [], 0, 0, 9, 0).reason, 'long');
  const ok = canLink(st, decor, [], 0, 0, 3, 0); assert.deepEqual(ok, { ok: true, len: 6, cost: 2 });
  const full = { ...st, l: [[0, -3, 0, 0], [-3, 0, 0, 0]] };
  assert.equal(canLink(full, decor, [], 0, 0, 3, 0).reason, 'full');
  assert.equal(canLink(full, decor, [], 0, 0, 0, -3).linked, true, 'an existing pair is not an error');
  assert.equal(canLink(st, decor, [{ t: 'wall', i: 2, j: 0, l: 0, r: 1 }], 0, 0, 3, 0).reason, 'blocked');
  assert.equal(canLink(st, decor, [{ t: 'roof', i: 2, j: 0, l: 0, r: 0 }], 0, 0, 3, 0).reason, 'blocked');
  assert.equal(canLink(st, decor, [{ t: 'foundation', i: 1, j: 0, l: 0, r: 0 }, { t: 'floor', i: 1, j: 0, l: 0, r: 0 }], 0, 0, 3, 0).ok, true);
  assert.equal(canLink(st, decor, [{ t: 'wall', i: 1, j: 1, l: 0, r: 0 }, { t: 'wall', i: 2, j: 0, l: 0, r: 0 }], 0, 0, 3, 0).ok, true, 'walls beside the line');
  assert.equal(canLink(st, decor, [{ t: 'pillar', i: 1, j: 1, l: 0, r: 0 }], 0, 0, 3, 0).ok, true);
  assert.equal(lineBlocked([{ t: 'floor', i: 1, j: 0, l: 1, r: 0 }], { x: 0, y: 3.4, z: 0 }, { x: 6, y: 2.4, z: 0 }), true);
  assert.equal(lineBlocked([{ t: 'nope', i: 1, j: 0, l: 0 }, null, { t: 'constructor', i: 1, j: 0, l: 0 }], { x: 0, y: 3.4, z: 0 }, { x: 6, y: 2.4, z: 0 }), false);
  assert.deepEqual([4, 6, 16].map(ropeCost), [1, 2, 4]);
  assert.equal(MIN_LEN, 4); assert.equal(MAX_LEN, 16);
});

test('nearestOnLine: ray hitting the middle of a line, ray missing it', () => {
  const l = { ax: 0, ay: 3, az: 0, bx: 6, by: 3, bz: 0, l3: 6 };
  const n = nearestOnLine(l, 3, 1.6, 2, 0, 1.4, -2, {});
  close(n.s, 3, 1e-6); assert.ok(n.off < 1e-6); assert.ok(n.along > 2);
  const m = nearestOnLine(l, 3, 1.6, 2, 0, 0, 1, {}); assert.ok(m.off > 1);
});

// ------------------------------------------------------------------ module harness
function harness({ role = 'host', decor = [post(0, 0), post(3, 0, 'glidestep')], held = 'glidehandle', deck = .2, three = null } = {}) {
  const events = [], notices = [], sent = [];
  const h = { deck, held, events, notices, sent };
  h.ctx = {
    T: three, role, running: true, elapsed: 0, options: { cameraMotion: .35 },
    scene: three ? new three.Scene() : null,
    world: { decor, pieces: [], tiles: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]] },
    physics: { x: 5.2, y: 1.8, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, swimming: false, _prevJump: false, _jumpBuffer: 0 },
    other: { x: 30, y: 1.8, z: 30 },
    camera: { position: { x: 0, y: 1.8, z: 2 }, rotation: { z: 0 } },
    deckY: () => h.deck, heldKind: () => h.held, uiOpen: () => false,
    emit: (e, to) => events.push({ ...e, to }), notice: s => notices.push(s), esc: s => String(s), action: a => sent.push(a),
    localBag: () => h.bag, rebuildRaft: () => {},
  };
  h.m = Z.createZipline(h.ctx);
  h.m.load(undefined, 'save');
  return h;
}
const AIM_POST = { dir: (() => { const d = [0, 1.6 - 1.8, -2], l = Math.hypot(...d); return { x: d[0] / l, y: d[1] / l, z: d[2] / l }; })() }; // camera (0,1.8,2) -> post (0,0) mid-mast

// ------------------------------------------------------------------ 5. action
test('action zip.link: spends rope, relink refunds; rejects without handle, rope, reach or ints; full bag unlink changes nothing', () => {
  const h = harness();
  const bag = bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 3 }]);
  assert.equal(h.m.action({ kind: 'zip.link', ax: 0, az: 0, bx: 3, bz: 0 }, 'host', bag), true);
  assert.deepEqual(h.m.debug.state().l, [[0, 0, 3, 0]]); assert.equal(bag.count('rope'), 1);
  assert.equal(h.events.at(-1).kind, 'build');
  h.m.action({ kind: 'zip.link', ax: 0, az: 0, bx: 3, bz: 0 }, 'host', bag); // same pair again = unlink
  assert.deepEqual(h.m.debug.state().l, []); assert.equal(bag.count('rope'), 3);
  assert.deepEqual(h.events.at(-1).loot, { rope: 2 });
  const same = (b, a, actor = 'host') => { const s0 = JSON.stringify(h.m.debug.state()), b0 = JSON.stringify(b.snapshot()); assert.equal(h.m.action(a, actor, b), true); assert.equal(JSON.stringify(h.m.debug.state()), s0); assert.equal(JSON.stringify(b.snapshot()), b0); };
  const A = { kind: 'zip.link', ax: 0, az: 0, bx: 3, bz: 0 };
  same(bagWith([{ kind: 'rope', count: 9 }]), A); // no handle
  same(bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 1 }]), A); // too little rope
  assert.equal(h.events.at(-1).text, 'Needs 2 rope');
  same(bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 9 }]), A, 'guest'); // guest far away
  same(bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 9 }]), { ...A, bx: 3.5 });
  same(bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 9 }]), { ...A, bx: '3' });
  assert.equal(h.m.action({ kind: 'bees.harvest' }, 'host', bag), false);
  h.m.debug.link(0, 0, 3, 0);
  const fb = fullBag(); same(fb, A);
  assert.equal(h.events.at(-1).kind, 'full');
});

// ------------------------------------------------------------------ 6. serialize / load
test('serialize is cached by r; save roundtrip; net dedupe; old host prompt', () => {
  const h = harness(); h.m.debug.link(0, 0, 3, 0);
  const a = h.m.serialize(); assert.equal(h.m.serialize(), a);
  h.m.debug.link(0, 0, 0, 1); // not a post: no change
  assert.equal(h.m.serialize(), a);
  const g = harness(); g.m.load(a, 'save'); assert.deepEqual(g.m.debug.state().l, a.l);
  const n = harness({ role: 'guest' });
  n.m.load(a, 'net'); const s1 = n.m.debug.lines(); n.m.load(a, 'net'); assert.deepEqual(n.m.debug.lines(), s1);
  n.m.load(undefined, 'net');
  assert.equal(n.m.prompt(AIM_POST), null, 'physics is out of reach of the post');
  n.ctx.physics.x = 0; n.ctx.physics.z = 2;
  assert.equal(n.m.prompt(AIM_POST), OLD_HOST);
  assert.equal(n.m.interact(AIM_POST), true); assert.equal(n.notices.at(-1), OLD_HOST); assert.equal(n.sent.length, 0);
});

test('prompts and the two-press link flow (guest sends zip.link)', () => {
  const h = harness({ role: 'guest' }); h.m.load({ v: 1, s: 'h', r: 1, l: [] }, 'net');
  h.ctx.physics.x = 0; h.ctx.physics.z = 2; h.bag = bagWith([{ kind: 'glidehandle', count: 1 }, { kind: 'rope', count: 5 }]);
  assert.equal(h.m.prompt(AIM_POST), '<kbd>E</kbd>Start a glide line');
  h.held = 'hook'; assert.equal(h.m.prompt(AIM_POST), TEXT.nohandle); assert.equal(h.m.interact(AIM_POST), false); h.held = 'glidehandle';
  assert.equal(h.m.interact(AIM_POST), true); assert.equal(h.notices.at(-1), TEXT.next);
  assert.equal(h.m.prompt(AIM_POST), '<kbd>E</kbd>Cancel');
  h.m.interact(AIM_POST); assert.equal(h.notices.at(-1), TEXT.cancel);
  h.ctx.world.decor.push(post(0, 3));
  h.m.interact(AIM_POST);
  // walk to the far post and press E there
  h.ctx.physics.x = 0; h.ctx.physics.z = 7; h.ctx.camera.position.z = 8;
  assert.equal(h.m.prompt(AIM_POST), '<kbd>E</kbd>Link line here (2 rope)');
  h.m.interact(AIM_POST);
  assert.deepEqual(h.sent, [{ kind: 'zip.link', ax: 0, az: 0, bx: 0, bz: 3 }]);
});

// ------------------------------------------------------------------ 7. ride hook
test('ride hook: rides along the line, Space drops off, the end hops, the line bobs with the deck', () => {
  const h = harness(); h.m.debug.link(0, 0, 3, 0);
  const p = h.ctx.physics, line = h.m.debug.lines()[0].ln;
  assert.equal(h.m.ride(.1, p, { jump: false }), false, 'not riding yet');
  assert.equal(h.m.debug.ride(0, .5), true);
  assert.equal(h.m.ride(.1, p, { jump: false }), true);
  const u = p.x / 6; close(p.y, line.ay + (line.by - line.ay) * u - HANG, 1e-6); close(p.z, 0); assert.equal(p.vy, 0); assert.equal(p.grounded, false);
  assert.equal(h.m.riding(), true);
  // deck bob: same t (dt = 0), y follows the deck
  const y0 = p.y; h.deck += .3; assert.equal(h.m.ride(0, p, { jump: false }), true); close(p.y - y0, .3, 1e-9);
  // Space press edge lets go with the drop velocity
  assert.equal(h.m.ride(.016, p, { jump: true }), false); assert.equal(p.vy, DROP_VY); assert.equal(h.m.riding(), false); assert.ok(p.vx > 0);
  // ride to the end
  h.m.debug.ride(0, .1);
  let res = true, n = 0; while (res && n++ < 1000) res = h.m.ride(.05, p, { jump: false });
  assert.equal(res, false); assert.equal(p.vy, HOP_VY); assert.ok(p.x > 4);
  // a teleport, a vanished line or putting the handle away dismounts
  h.m.debug.ride(0, .2); h.m.ride(.016, p, {}); p.x += 5; assert.equal(h.m.ride(.016, p, {}), false);
  h.m.debug.ride(0, .2); h.m.ride(.016, p, {}); h.ctx.world.decor = h.ctx.world.decor.filter(d => d.x !== 3); h.m.update(.016);
  assert.equal(h.m.debug.state().l.length, 0, 'host prunes the orphan line');
  assert.equal(h.m.ride(.016, p, {}), false); assert.equal(h.m.riding(), false);
  assert.equal(h.m.debug.stop(), false);
});

test('mount from a post with E, then from the line; blocked lines refuse; swimming refuses', () => {
  const h = harness(); h.m.debug.link(0, 0, 3, 0);
  const p = h.ctx.physics; p.x = 0; p.z = 2;
  assert.equal(h.m.prompt(AIM_POST), '<kbd>E</kbd>Glide · <kbd>C</kbd>+<kbd>E</kbd>new line');
  h.ctx.world.pieces = [{ t: 'wall', i: 2, j: 0, l: 0, r: 1 }];
  assert.equal(h.m.interact(AIM_POST), true); assert.equal(h.m.riding(), false); assert.equal(h.notices.at(-1), TEXT.inway);
  h.ctx.world.pieces = [];
  p.swimming = true; h.m.interact(AIM_POST); assert.equal(h.m.riding(), false); p.swimming = false;
  h.m.ride(0, p, { crouch: true }); h.m.interact(AIM_POST); assert.equal(h.m.riding(), false, 'crouch + E starts a new line instead');
  assert.equal(h.notices.at(-1), TEXT.next); h.m.interact(AIM_POST); // cancel
  h.m.ride(0, p, { crouch: false }); h.m.interact(AIM_POST);
  assert.equal(h.m.riding(), true); assert.deepEqual({ ...h.m.debug.pose(), t: 0, v: 0 }, { riding: true, t: 0, v: 0, dir: 1, line: 0 });
  assert.equal(h.m.debug.pose().v, V_START); h.m.debug.stop();
  // from the line: stand under the middle, look up at it
  p.x = 3; p.z = 1; h.ctx.camera.position.x = 3; h.ctx.camera.position.z = 1;
  const up = { dir: (() => { const d = [-.3, 3.1 - 1.8, -1], l = Math.hypot(...d); return { x: d[0] / l, y: d[1] / l, z: d[2] / l }; })() };
  assert.equal(h.m.prompt(up), '<kbd>E</kbd>Hook on');
  assert.equal(h.m.interact(up), true); assert.equal(h.m.riding(), true); assert.equal(h.m.debug.pose().dir, -1);
});

// ------------------------------------------------------------------ 8. pose flag / HELD
test('coop: HELD keeps 0..16 and appends glidehandle at 17; riding is pose bit 8', () => {
  assert.deepEqual(HELD.slice(0, 17), [null, 'hook', 'hammer', 'fishingrod', 'wood', 'leaf', 'scrap', 'plastic', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'drum', 'pipes', 'bells']);
  assert.equal(HELD[17], 'glidehandle');
  const f = poseFlags({ swimming: false, grounded: false, reeling: false, riding: true });
  assert.equal(f & 8, 8); assert.equal(f & 7, 0);
  assert.deepEqual(readFlags(f), { swimming: false, grounded: false, reeling: false, riding: true });
  assert.deepEqual(readFlags(poseFlags({ swimming: true, grounded: true, reeling: true })), { swimming: true, grounded: true, reeling: true, riding: false });
  const old = g => ({ swimming: !!(g & 1), grounded: !!(g & 2), reeling: !!(g & 4) }); // an older peer's reader
  assert.deepEqual(old(poseFlags({ grounded: true, riding: true })), { swimming: false, grounded: true, reeling: false });
});

// ------------------------------------------------------------------ 9. models and items
const sizeOf = g => { g.updateMatrixWorld(true); const b = new T.Box3().setFromObject(g); return { s: b.getSize(new T.Vector3()), b }; };
test('models: posts, rope lines, handle; decorModel', () => {
  for (const [type, top] of Object.entries(POSTS)) {
    const g = M.createGlidePost(T, top, 'craft_' + type); assert.equal(g.name, 'craft_' + type);
    const { s, b } = sizeOf(g); assert.ok(Math.abs(b.max.y - top) < .1, `${type} ${b.max.y}`); assert.ok(s.x <= .6 && s.z <= .6);
    assert.equal(g.children.length, 1, 'one merged mesh');
  }
  const h = harness({ three: T }); h.m.debug.link(0, 0, 3, 0); h.ctx.world.decor.push(post(0, 3)); h.m.debug.link(0, 0, 0, 3);
  h.m.update(.016);
  const lines = h.ctx.scene.getObjectByName('glide_lines'); assert.ok(lines); assert.equal(lines.geometry.drawRange.count, 4);
  const arr = lines.geometry.attributes.position.array; close(arr[1], h.deck + POSTS.glidepost, 1e-6); close(arr[4], h.deck + POSTS.glidestep, 1e-6);
  h.deck = 1; h.m.update(.016); close(arr[1], 1 + POSTS.glidepost, 1e-6);
  assert.equal(h.m.decorModel('glidepost').name, 'craft_glidepost'); assert.equal(h.m.decorModel('glidestep').name, 'craft_glidestep'); assert.equal(h.m.decorModel('palm'), null);
  assert.equal(M.createRopeLines(T, 64).geometry.attributes.position.array.length, 64 * 6);
  const hm = buildItemModel(T, 'glidehandle'); assert.ok(hm.isGroup); assert.equal(hm.name, 'item_glidehandle');
  assert.ok(M.createHandle(T).isGroup);
  h.m.dispose(); assert.equal(h.ctx.scene.getObjectByName('glide_lines'), undefined);
});

test('items: recipes craft, BLOCK_RADII for every placeable, handle has no durability', () => {
  const cases = { glidepost: { wood: 6, rope: 3, nail: 2 }, glidestep: { wood: 4, rope: 2, nail: 1 }, glidehandle: { wood: 2, rope: 2, scrap: 2 } };
  for (const [id, cost] of Object.entries(cases)) {
    assert.ok(ITEMS[id] && ITEM_INFO[id], id); assert.ok(ITEMS[id].tip.length > 10);
    assert.deepEqual({ ...ITEMS[id].recipe.cost }, cost, id);
    const bag = bagWith(Object.entries(cost).map(([kind, count]) => ({ kind, count })));
    assert.equal(bag.canCraft(id).ok, true, id); assert.ok(bag.craft(id), id); assert.equal(bag.count(id), 1, id);
  }
  assert.equal(ITEMS.glidepost.placeable, true); assert.equal(ITEMS.glidestep.placeable, true);
  assert.equal(ITEMS.glidehandle.tool, false); assert.equal(ITEMS.glidehandle.stack, 1);
  for (const id of PLACEABLE_IDS) assert.ok(id in BLOCK_RADII, id);
});
