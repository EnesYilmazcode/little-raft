// Paddle tool: item/recipe, edge-tile rule, stroke cooldown, wear (250 strokes), host apply and the sail impulse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, wearPerUse, toolRole, TOOL_IDS } from '../dist/items.js';
import { PADDLE, isPaddle, canStroke, strokeAngle, onEdgeTile, wearPaddleSlot, strokeBlock, paddlePrompt, attachPaddle } from '../dist/paddle.js';
import { SAIL, defaultSailing, applySailAction, stepSailing } from '../dist/sailing-core.js';
import { categoryOf, ITEM_TEXT } from '../dist/craft-book.js';
import { ITEM_ICONS } from '../dist/item-svg.js';

const near = (a, b, eps = 1e-9, m) => assert.ok(Math.abs(a - b) <= eps, `${m || ''} ${a} != ${b}`);

test('paddle item: tool, 250 strokes, 4 wood + 2 rope + 2 plastic, in the Tools tab with text and icon', () => {
  const it = ITEMS.paddle;
  assert.ok(it && it.tool && TOOL_IDS.includes('paddle'));
  assert.equal(it.durability, 250);
  assert.deepEqual({ ...it.recipe.cost }, { wood: 4, rope: 2, plastic: 2 });
  assert.equal(it.recipe.station, null);
  near(wearPerUse('paddle'), 100 / 250);
  assert.equal(toolRole('paddle'), 'paddle'); assert.ok(isPaddle('paddle')); assert.ok(!isPaddle('hammer'));
  assert.equal(categoryOf('paddle'), 'tools');
  assert.ok(ITEM_TEXT.paddle?.desc && ITEM_TEXT.paddle?.use);
  assert.ok(ITEM_ICONS.paddle?.includes('<'));
});

test('cooldown 0.85 s, just over the sailing core', () => {
  assert.ok(PADDLE.COOLDOWN > SAIL.PADDLE_COOLDOWN && PADDLE.COOLDOWN < SAIL.PADDLE_COOLDOWN + 0.1);
  assert.ok(canStroke(0, -Infinity));
  assert.ok(!canStroke(10.84, 10)); assert.ok(canStroke(10.85, 10)); assert.ok(canStroke(11, 10));
  near(SAIL.PADDLE_CAP, 1.2); assert.ok(SAIL.PADDLE_CAP < SAIL.SAIL_SPEED, "a paddle stays weaker than one full sail");
});

test('wear: 250 strokes from new to broken', () => {
  const slot = { kind: 'paddle', count: 1, durability: 100 };
  let strokes = 0, w;
  do { w = wearPaddleSlot(slot); strokes++; } while (!w.broke && strokes < 1000);
  assert.equal(strokes, 250); assert.equal(slot.durability, 0);
  assert.equal(wearPaddleSlot({ kind: 'hammer', durability: 100 }), null);
  assert.equal(wearPaddleSlot(null), null);
  const fresh = { kind: 'paddle' }; wearPaddleSlot(fresh); near(fresh.durability, 100 - 100 / 250, 1e-9, 'missing durability = new');
});

test('edge tiles: any raft tile with an open side', () => {
  const tiles = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  assert.ok(!onEdgeTile(tiles, 0, 0), 'centre of a plus is enclosed');
  assert.ok(onEdgeTile(tiles, 2, 0)); assert.ok(onEdgeTile(tiles, 0.4, -2.6));
  assert.ok(!onEdgeTile(tiles, 4.5, 0), 'off the raft');
  assert.ok(onEdgeTile([[0, 0]], 0.3, 0.3), 'one tile is all edge');
  assert.ok(!onEdgeTile(tiles, NaN, 0)); assert.ok(!onEdgeTile(null, 0, 0));
});

test('prompt text', () => {
  const ok = { durability: 50, swimming: false, onEdge: true, anchored: false };
  assert.deepEqual({ ...paddlePrompt(ok) }, { key: 'LMB', label: 'Paddle' });
  assert.equal(paddlePrompt({ ...ok, onEdge: false }).label, 'Stand at the edge to paddle');
  assert.equal(paddlePrompt({ ...ok, swimming: true }).label, 'Stand at the edge to paddle');
  assert.equal(strokeBlock({ ...ok, anchored: true }), 'anchored');
  assert.equal(strokeBlock({ ...ok, durability: 0 }), 'worn');
});

test('stroke angle follows the camera look direction', () => {
  near(Math.sin(strokeAngle(0)), 0, 1e-12); near(Math.cos(strokeAngle(0)), -1, 1e-12, 'yaw 0 looks along -z');
  near(Math.sin(strokeAngle(Math.PI / 2)), -1, 1e-12, 'yaw +90 looks along -x');
  assert.ok(Number.isNaN(strokeAngle(NaN)));
});

function rig({ tiles = [[0, 0], [1, 0]], me = { x: 2, z: 0, swimming: false }, anchored = false } = {}) {
  const sail = defaultSailing(); sail.anchored = anchored;
  const sent = [], notices = [], emits = [];
  const bag = { selectedIndex: 0, version: 0, slots: [{ kind: 'paddle', count: 1, durability: 100 }, null] };
  let now = 0;
  const p = attachPaddle({
    localBag: () => bag, physics: () => me, other: () => null, tiles: () => tiles, yaw: () => 0, elapsed: () => now,
    anchored: () => sail.anchored, notice: (t) => notices.push(t), emit: (e) => emits.push(e), sound: () => {}, splash: () => {},
    action: (a) => { sent.push(a); p.apply(a, 'host', bag); }, // solo: the action goes straight to the host side
    sailReady: () => !sail.anchored && !(sail.paddleClock > 0), sailApply: (a) => applySailAction(sail, a),
  });
  return { p, sail, bag, sent, notices, emits, me, setNow: (t) => { now = t; } };
}

test('host apply: a stroke pushes the raft the way you face and wears the paddle once; cooldown blocks spam', () => {
  const r = rig();
  assert.equal(r.p.use(), true);
  assert.equal(r.sent.length, 1);
  assert.deepEqual(Object.keys(r.sent[0]).sort(), ['angle', 'kind', 'op', 'slot']);
  assert.equal(r.sent[0].kind, 'sail'); assert.equal(r.sent[0].op, 'paddle');
  near(r.sail.vz, -SAIL.PADDLE_IMPULSE, 1e-12, 'yaw 0 pushes toward -z');
  near(r.bag.slots[0].durability, 100 - 100 / 250);
  r.setNow(0.5); r.p.use(); assert.equal(r.sent.length, 1, 'client cooldown');
  r.setNow(0.85); stepSailing(r.sail, 0.1, { nSails: 0 }, { dwx: 0, dwz: 0, dgx: 0, dgz: 0 }); r.sail.paddleClock = 0.3;
  r.p.use(); assert.equal(r.sent.length, 2);
  near(r.bag.slots[0].durability, 100 - 100 / 250, 1e-9, 'core cooldown (another paddler): no impulse, no wear');
  assert.equal(r.p.stroke, 1);
  r.p.update(PADDLE.STROKE_TIME / 2); near(r.p.stroke, 0.5, 1e-9);
});

test('stroke blocked away from the edge, while anchored, or when worn; the paddle breaks at 0', () => {
  const inner = rig({ tiles: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], me: { x: 0, z: 0 } });
  inner.p.use(); assert.equal(inner.sent.length, 0); assert.deepEqual(inner.notices, ['Stand at the edge to paddle']);
  const anch = rig({ anchored: true });
  anch.p.use(); assert.equal(anch.sent.length, 0); assert.deepEqual(anch.notices, ['Raise the anchor to paddle']);
  const last = rig(); last.bag.slots[0].durability = 100 / 250;
  last.p.use(); assert.equal(last.bag.slots[0], null, 'broke'); assert.equal(last.emits.at(-1).text, 'Your paddle broke!');
  const guestAway = rig();
  guestAway.p.apply({ kind: 'sail', op: 'paddle', angle: 0, slot: 0 }, 'guest', guestAway.bag);
  assert.equal(guestAway.sail.vz, 0, 'a guest with no known position is ignored');
  assert.equal(guestAway.p.apply({ kind: 'sail', op: 'raise' }, 'host', guestAway.bag), false, 'other sail ops pass through');
});

test('co-op HELD appends paddle (23) and axe (24) after the zipline handle and spyglass', async () => {
  const { HELD } = await import('../dist/coop.js');
  assert.equal(HELD.indexOf('spear'), 19); assert.equal(HELD.indexOf('metalspear'), 20);
  assert.equal(HELD.indexOf('glidehandle'), 21); assert.equal(HELD.indexOf('spyglass'), 22); assert.equal(HELD.indexOf('paddle'), 23); assert.equal(HELD.indexOf('axe'), 24);
  const src = (await import('node:fs')).readFileSync(new URL('../dist/coop-avatar.js', import.meta.url), 'utf8');
  for (const k of ['paddle', 'axe']) { assert.match(src, new RegExp(`\\n    ${k}\\(g, K\\) \\{`)); assert.match(src, new RegExp(`${k}: [\\d.]+`)); }
});

// Player feedback: "the paddle just doesn't work, I don't even see any push". Before, a stroke added 0.25 m/s that
// eased out over TAU_DOWN: under 0.75 m of glide, slower than the 0.3 m/s current. Now one stroke must clearly move.
function glide(angle, seconds = 10, sail = defaultSailing()) {
  const o = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 }; let x = 0, z = 0;
  applySailAction(sail, { kind: 'sail', op: 'paddle', angle });
  for (let t = 0; t < seconds; t += 1 / 60) { stepSailing(sail, 1 / 60, { nSails: 0 }, o); x += o.dwx; z += o.dwz; }
  return { x, z, sail };
}

test('one stroke: a strong push the way you face (water-relative glide over 2.5 m, impulse over 3x the current)', () => {
  assert.ok(SAIL.PADDLE_IMPULSE >= 3 * Math.hypot(SAIL.CURRENT_X, SAIL.CURRENT_Z));
  const fwd = glide(strokeAngle(0)); // yaw 0 looks along -z
  assert.ok(fwd.z < -2.5, 'forward glide ' + fwd.z); near(fwd.x, 0, 1e-9);
  const left = glide(strokeAngle(Math.PI / 2)); // yaw +90 looks along -x
  assert.ok(left.x < -2.5, 'left glide ' + left.x); near(left.z, 0, 1e-9);
  const anchored = defaultSailing(); anchored.anchored = true;
  const held = glide(0, 5, anchored); assert.equal(held.x, 0); assert.equal(held.z, 0, 'an anchored raft does not move');
});

test('steady paddling builds up to the paddle cap, never past it', () => {
  const s = defaultSailing(), o = { dwx: 0, dwz: 0, dgx: 0, dgz: 0 }; let top = 0;
  for (let k = 0; k < 12; k++) {
    applySailAction(s, { kind: 'sail', op: 'paddle', angle: 0 });
    for (let i = 0; i < 51; i++) { stepSailing(s, 1 / 60, { nSails: 0 }, o); top = Math.max(top, Math.hypot(s.vx, s.vz)); }
  }
  assert.ok(top <= SAIL.PADDLE_CAP + 1e-9); assert.ok(top > 0.9 * SAIL.PADDLE_CAP, 'reaches the cap: ' + top);
});

test('a click during the cooldown is kept and strokes as soon as the cooldown ends', () => {
  const r = rig();
  r.p.use(); assert.equal(r.sent.length, 1);
  r.setNow(0.4); r.p.use(); assert.equal(r.sent.length, 1, 'still cooling');
  r.setNow(0.6); r.p.update(0.2); assert.equal(r.sent.length, 1);
  r.sail.paddleClock = 0; r.setNow(0.86); r.p.update(0.26); assert.equal(r.sent.length, 2, 'queued stroke fired');
  r.setNow(1.1); r.p.update(0.24); assert.equal(r.sent.length, 2, 'only once');
  r.setNow(1.2); r.p.use(); r.bag.selectedIndex = 1; r.setNow(4); r.p.update(1); assert.equal(r.sent.length, 2, 'a queued stroke is dropped when the paddle is put away');
});

test('co-op: a guest stroke from the raft edge pushes the shared raft and wears the guest paddle', () => {
  const r = rig(), guestBag = { selectedIndex: 0, version: 0, slots: [{ kind: 'paddle', count: 1, durability: 100 }] };
  const sail = defaultSailing();
  const p = attachPaddle({ localBag: () => r.bag, physics: () => r.me, other: () => ({ x: 0.5, z: 0.2, swimming: false }), tiles: () => [[0, 0], [1, 0]],
    yaw: () => 0, elapsed: () => 0, anchored: () => false, notice() {}, emit() {}, action() {},
    sailReady: () => !sail.anchored && !(sail.paddleClock > 0), sailApply: (a) => applySailAction(sail, a) });
  assert.equal(p.apply({ kind: 'sail', op: 'paddle', angle: strokeAngle(Math.PI / 2), slot: 0 }, 'guest', guestBag), true);
  near(sail.vx, -SAIL.PADDLE_IMPULSE, 1e-12, 'guest facing -x pushes toward -x'); near(guestBag.slots[0].durability, 100 - 100 / 250);
  assert.equal(r.bag.slots[0].durability, 100, 'the host paddle is untouched');
});
