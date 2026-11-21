// Unit tests for dist/display.js (display shelf and trophy stand) and dist/display-model.js.
// Run: node --test tests/display.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const D = await import(new URL('display.js', base));
const M = await import(new URL('display-model.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII, PLACEABLE_IDS } = await import(new URL('items.js', base));
const { speciesById } = await import(new URL('fish-species.js', base));
const { cleanDisplay, displayAt, put, take, mount, refundDisplay, SLOTS, OLD_HOST, TEXT, MAX_MODELS } = D;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
const shelf = (x = 0, z = 0, rot) => ({ type: 'shelf', x, z, ...(rot === undefined ? {} : { rot }) });
const stand = (x = 0, z = 0) => ({ type: 'trophystand', x, z });
const fresh = () => cleanDisplay(undefined);
const snapOf = (st, bag) => JSON.stringify([st, bag.snapshot()]);
const DEFAULTS = { v: 1, s: '', r: 0, d: {}, t: {} };

test('cleanDisplay: junk gives defaults; keys, slots, counts and trophies are validated; orphans kept', () => {
  for (const v of [undefined, null, [], 'x', 3, { d: [] }, { d: 'x', t: [] }]) assert.deepEqual(cleanDisplay(v), DEFAULTS);
  const st = cleanDisplay({ v: 1, s: 'abc', r: 7,
    d: { '3,-1': [{ kind: 'scrap', count: 5 }, null, { kind: 'hook', count: 1, durability: 64 }, { kind: 'wood', count: 1 }],
      '0,2': [{ kind: 'rope', count: 1 }], '9,9': [{ kind: 'nope', count: 1 }, 'x', { kind: 'wood', count: -1 }],
      '1,1': [null, null], 'a,b': [{ kind: 'wood', count: 1 }], '01,0': [{ kind: 'wood', count: 1 }], '1234,0': [{ kind: 'wood', count: 1 }],
      '-0,0': [{ kind: 'wood', count: 1 }], '5,5': { kind: 'wood' }, '7,7': [{ kind: 'fish', count: 3 }] },
    t: { '1,2': { species: 'pomfret', cm: 99 }, '1,3': { species: 'pomfret', cm: 20.04 }, '1,4': { species: 'shark', cm: 30 },
      '1,5': { species: 'tuna', cm: 'big' }, '0,2': { species: 'herring', cm: 20 }, 'x': { species: 'pomfret', cm: 20 } } });
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7);
  assert.deepEqual(st.d, {
    '3,-1': [{ kind: 'scrap', count: 1 }, null, { kind: 'hook', count: 1, durability: 64 }],
    '0,2': [{ kind: 'rope', count: 1 }],
    '7,7': [{ kind: 'fish', count: 1 }], // orphan (no decor anywhere): kept
  });
  assert.deepEqual(st.t, { '1,2': { species: 'pomfret', cm: speciesById('pomfret').maxCm }, '1,3': { species: 'pomfret', cm: 20 } }); // 0,2 has an item: trophy dropped
  // MAX_TILES cap
  const many = {}; for (let i = 0; i < 450; i++) many[i + ',0'] = [{ kind: 'wood', count: 1 }];
  assert.equal(Object.keys(cleanDisplay({ d: many }).d).length, D.MAX_TILES);
  // round trip is stable
  assert.deepEqual(cleanDisplay(JSON.parse(JSON.stringify(st))), st);
});

test('displayAt', () => {
  const decor = [shelf(0, 0), stand(1, 0), { type: 'crate', x: 2, z: 0 }];
  assert.equal(displayAt(decor, 0, 0), 'shelf'); assert.equal(displayAt(decor, 1, 0), 'trophystand');
  assert.equal(displayAt(decor, 2, 0), null); assert.equal(displayAt(null, 0, 0), null);
});

test('put: one from a stack, a whole tool slot, and every failure changes nothing', () => {
  const decor = [shelf(0, 0), stand(1, 0), { type: 'crate', x: 2, z: 0 }];
  const st = fresh();
  const bag = bagWith([{ kind: 'wood', count: 5 }, { kind: 'hammer', count: 1, durability: 37, id: 'h1' }]);
  const v0 = bag.version;
  let r = put(st, decor, { x: 0, z: 0, i: 1, from: 0, expect: { have: 'wood', slot: null } }, bag);
  assert.deepEqual(r, { ok: true, text: 'Plank on display' });
  assert.equal(bag.count('wood'), 4); assert.ok(bag.version > v0);
  assert.deepEqual(st.d['0,0'], [null, { kind: 'wood', count: 1 }]);
  r = put(st, decor, { x: 0, z: 0, i: 2, from: 1, expect: { have: 'hammer', slot: null } }, bag);
  assert.ok(r.ok); assert.equal(bag.slots[1], null);
  assert.deepEqual(st.d['0,0'][2], { kind: 'hammer', count: 1, durability: 37, id: 'h1' });
  const cases = [
    [{ x: 0, z: 0, i: 1, from: 0, expect: { have: 'wood', slot: null } }, 'busy'],
    [{ x: 0, z: 0, i: 0, from: 0, expect: { have: 'rope', slot: null } }, 'stale'],
    [{ x: 0, z: 0, i: 0, from: 0 }, 'stale'],
    [{ x: 0, z: 0, i: 0, from: 5, expect: { have: 'wood', slot: null } }, 'stale'],
    [{ x: 0, z: 0, i: 0, from: 1.5, expect: { have: 'wood', slot: null } }, 'bad'],
    [{ x: 0, z: 0, i: 3, from: 0, expect: { have: 'wood', slot: null } }, 'notarget'],
    [{ x: 1, z: 0, i: 1, from: 0, expect: { have: 'wood', slot: null } }, 'notarget'],
    [{ x: 2, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'notarget'],
    [{ x: 0.5, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'notarget'],
  ];
  for (const [a, reason] of cases) {
    const before = snapOf(st, bag);
    const res = put(st, decor, a, bag);
    assert.equal(res.ok, false); assert.equal(res.reason, reason, JSON.stringify(a)); assert.equal(res.text, TEXT[reason]);
    assert.equal(snapOf(st, bag), before);
  }
  // a stand with a trophy is busy
  st.t['1,0'] = { species: 'pomfret', cm: 20 };
  const before = snapOf(st, bag);
  assert.equal(put(st, decor, { x: 1, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, bag).reason, 'busy');
  assert.equal(snapOf(st, bag), before);
});

test('take: item back with durability; full bag keeps it on the shelf; stale expect', () => {
  const decor = [shelf(0, 0)];
  const st = fresh();
  const bag = bagWith([{ kind: 'hook', count: 1, durability: 64 }, { kind: 'wood', count: 3 }]);
  assert.ok(put(st, decor, { x: 0, z: 0, i: 0, from: 0, expect: { have: 'hook', slot: null } }, bag).ok);
  assert.ok(put(st, decor, { x: 0, z: 0, i: 1, from: 1, expect: { have: 'wood', slot: null } }, bag).ok);
  let before = snapOf(st, bag);
  assert.equal(take(st, decor, { x: 0, z: 0, i: 0, expect: { slot: 'wood' } }, bag).reason, 'stale');
  assert.equal(take(st, decor, { x: 0, z: 0, i: 2, expect: { slot: 'wood' } }, bag).reason, 'stale');
  assert.equal(take(st, decor, { x: 0, z: 0, i: 0 }, bag).reason, 'stale');
  assert.equal(snapOf(st, bag), before);
  const fb = fullBag(); before = snapOf(st, fb);
  const rf = take(st, decor, { x: 0, z: 0, i: 0, expect: { slot: 'hook' } }, fb);
  assert.deepEqual(rf, { ok: false, reason: 'full', text: TEXT.full });
  assert.equal(snapOf(st, fb), before);
  const r = take(st, decor, { x: 0, z: 0, i: 0, expect: { slot: 'hook' } }, bag);
  assert.deepEqual(r, { ok: true, text: '+1 Hook', loot: { hook: 1 } });
  const hook = bag.slots.find(s => s && s.kind === 'hook');
  assert.equal(hook.durability, 64);
  assert.ok(take(st, decor, { x: 0, z: 0, i: 1, expect: { slot: 'wood' } }, bag).ok);
  assert.equal(bag.count('wood'), 3);
  assert.equal(st.d['0,0'], undefined, 'an all-empty shelf drops its key');
});

test('mount and take down: cosmetic, clamped, never touches the bag', () => {
  const decor = [shelf(0, 0), stand(1, 0), stand(2, 0)];
  const st = fresh(), bag = bagWith([{ kind: 'fish', count: 2 }, { kind: 'wood', count: 1 }]);
  const bagSnap = JSON.stringify(bag.snapshot());
  const sp = speciesById('tuna');
  let r = mount(st, decor, { x: 1, z: 0, species: 'tuna', cm: 999, expect: { trophy: null } });
  assert.deepEqual(r, { ok: true, text: 'Tuna trophy mounted' });
  assert.deepEqual(st.t['1,0'], { species: 'tuna', cm: sp.maxCm });
  assert.ok(mount(st, decor, { x: 1, z: 0, species: 'pomfret', cm: 21.26, expect: { trophy: 'tuna' } }).ok); // swap
  assert.deepEqual(st.t['1,0'], { species: 'pomfret', cm: 21.3 });
  let before = JSON.stringify(st);
  assert.equal(mount(st, decor, { x: 1, z: 0, species: 'tuna', cm: 70, expect: { trophy: 'tuna' } }).reason, 'stale');
  assert.equal(mount(st, decor, { x: 1, z: 0, species: 'tuna', cm: 70, expect: { trophy: null } }).reason, 'stale');
  assert.equal(mount(st, decor, { x: 0, z: 0, species: 'tuna', cm: 70, expect: { trophy: null } }).reason, 'notarget');
  assert.equal(mount(st, decor, { x: 2, z: 0, species: 'shark', cm: 70, expect: { trophy: null } }).reason, 'bad');
  assert.equal(mount(st, decor, { x: 2, z: 0, species: 'tuna', cm: NaN, expect: { trophy: null } }).reason, 'bad');
  assert.equal(JSON.stringify(st), before);
  // a stand holding an item refuses a trophy
  assert.ok(put(st, decor, { x: 2, z: 0, i: 0, from: 1, expect: { have: 'wood', slot: null } }, bag).ok);
  before = JSON.stringify(st);
  assert.equal(mount(st, decor, { x: 2, z: 0, species: 'tuna', cm: 70, expect: { trophy: null } }).reason, 'busy');
  assert.equal(JSON.stringify(st), before);
  // take down
  const b2 = JSON.stringify(bag.snapshot());
  assert.equal(take(st, decor, { x: 1, z: 0, i: 0, expect: { trophy: 'tuna' } }, bag).reason, 'stale');
  r = take(st, decor, { x: 1, z: 0, i: 0, expect: { trophy: 'pomfret' } }, bag);
  assert.deepEqual(r, { ok: true, text: D.TROPHY_DOWN });
  assert.equal(st.t['1,0'], undefined);
  assert.equal(JSON.stringify(bag.snapshot()), b2, 'taking a trophy down refunds nothing');
  assert.notEqual(bagSnap, b2); // (only the put above changed the bag)
});

test('refundDisplay: everything fits or nothing changes', () => {
  const st = fresh();
  st.d['0,0'] = [{ kind: 'wood', count: 1 }, { kind: 'hammer', count: 1, durability: 50 }, { kind: 'rope', count: 1 }];
  st.t['0,0'] = { species: 'pomfret', cm: 20 };
  const fb = fullBag(), before = snapOf(st, fb);
  assert.deepEqual(refundDisplay(st, '0,0', fb), { ok: false, reason: 'full', text: TEXT.fill });
  assert.equal(snapOf(st, fb), before);
  // room for two of three: still nothing
  const almost = bagWith([...Array.from({ length: SLOT_COUNT - 2 }, () => ({ kind: 'scrap', count: 20 }))]);
  const b2 = snapOf(st, almost);
  assert.equal(refundDisplay(st, '0,0', almost).ok, false); assert.equal(snapOf(st, almost), b2);
  const bag = bagWith([]);
  const r = refundDisplay(st, '0,0', bag);
  assert.equal(r.ok, true); assert.deepEqual(r.loot, { wood: 1, hammer: 1, rope: 1 });
  assert.equal(bag.count('wood'), 1); assert.equal(bag.slots.find(s => s?.kind === 'hammer').durability, 50);
  assert.equal(st.d['0,0'], undefined); assert.equal(st.t['0,0'], undefined);
});

// ------------------------------------------------------------------ module

function modCtx(role = 'solo', withT = false) {
  const world = { decor: [shelf(0, 0), stand(1, 0)], tiles: [[0, 0], [1, 0], [2, 0]] };
  const emits = [], notices = [], actions = [];
  let localBag = bagWith([{ kind: 'wood', count: 3 }, { kind: 'fish', count: 1 }]);
  const ctx = { T: withT ? T : null, world, role, running: true, physics: { x: 0, z: 1 }, other: { x: 50, z: 50 }, camera: null, raft: null, elapsed: 0,
    localBag: () => localBag, setBag: b => { localBag = b; }, esc: s => String(s).replace(/</g, '&lt;'),
    emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a), rebuildRaft() {} };
  return { ctx, emits, notices, actions };
}

// A raft with real display models at the decor tiles (as game.js rebuildRaft places them), a camera and an aim at a point.
function scene(m, ctx) {
  const raft = new T.Group(); raft.position.set(3, 0.1, -2); raft.rotation.y = 0.3;
  for (const d of ctx.world.decor) { const g = m.decorModel(d.type); g.position.set(d.x * 2, .22, d.z * 2); g.rotation.y = d.rot || 0; raft.add(g); }
  raft.updateMatrixWorld(true);
  ctx.raft = raft;
  const cam = new T.PerspectiveCamera(70, 1, .05, 100); ctx.camera = cam;
  const aimAt = (p, ox = 0) => {
    const local = raft.worldToLocal(p.clone()), pose = raft.localToWorld(new T.Vector3(local.x + ox, 0, local.z + 1.4));
    cam.position.set(pose.x, 1.7, pose.z); ctx.physics = { x: pose.x, z: pose.z };
    return { dir: p.clone().sub(cam.position).normalize() };
  };
  const slotPoint = (g, j, dx = 0) => { const a = g.getObjectByName('slot' + j); const v = a.getWorldPosition(new T.Vector3()); v.y += .12; if (dx) v.add(new T.Vector3(dx, 0, 0).applyQuaternion(g.getWorldQuaternion(new T.Quaternion()))); return v; };
  return { raft, aimAt, slotPoint };
}

test('module: actions are claimed, validated for reach, and never duplicate items', () => {
  const { ctx, emits } = modCtx();
  const m = D.createDisplay(ctx);
  assert.equal(m.name, 'display');
  m.load(undefined, 'save');
  const bag = bagWith([{ kind: 'wood', count: 3 }]), snap = JSON.stringify(bag.snapshot()), st0 = JSON.stringify(m.debug.state().d);
  for (const k of ['display.put', 'display.take', 'display.mount', 'display.nope']) assert.equal(m.action({ kind: k }, 'host', bag), true, k);
  assert.equal(m.action({ kind: 'display.put', x: 0.5, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'host', bag), true);
  assert.equal(m.action({ kind: 'display.put', x: 0, z: 0, i: '0', from: 0, expect: { have: 'wood', slot: null } }, 'host', bag), true);
  assert.equal(m.action({ kind: 'display.put', x: 0, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'guest', bag), true); // guest far away
  assert.equal(JSON.stringify(bag.snapshot()), snap); assert.equal(JSON.stringify(m.debug.state().d), st0);
  assert.equal(m.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'host', bag), false);
  assert.equal(m.action({ kind: 'display.put', x: 0, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'host', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'build', text: 'Plank on display', sound: 'place' }, 'host']);
  assert.equal(bag.count('wood'), 2);
  // both players take the same slot: the second is stale and gets nothing
  ctx.other = { x: 0, z: 1 };
  const gb = bagWith([]);
  assert.equal(m.action({ kind: 'display.take', x: 0, z: 0, i: 0, expect: { slot: 'wood' } }, 'host', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+1 Plank', loot: { wood: 1 } }, 'host']);
  const r = m.debug.state().r;
  assert.equal(m.action({ kind: 'display.take', x: 0, z: 0, i: 0, expect: { slot: 'wood' } }, 'guest', gb), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: TEXT.stale }, 'guest']);
  assert.ok(m.debug.state().r > r, 'a stale click bumps r so the guest repaints');
  assert.equal(gb.count('wood'), 0); assert.equal(bag.count('wood'), 3);
  // mount + take down emit
  assert.equal(m.action({ kind: 'display.mount', x: 1, z: 0, species: 'herring', cm: 22, expect: { trophy: null } }, 'host', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'build', text: 'Herring trophy mounted', sound: 'place' }, 'host']);
  m.action({ kind: 'display.take', x: 1, z: 0, i: 0, expect: { trophy: 'herring' } }, 'host', bag);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: D.TROPHY_DOWN }, 'host']);
  // a full bag
  m.action({ kind: 'display.put', x: 0, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } }, 'host', bag);
  m.action({ kind: 'display.take', x: 0, z: 0, i: 0, expect: { slot: 'wood' } }, 'host', fullBag());
  assert.deepEqual(emits.at(-1), [{ kind: 'full', text: TEXT.full }, 'host']);
  // serialize is cached by revision
  const s1 = m.serialize(); assert.equal(m.serialize(), s1);
  m.action({ kind: 'display.take', x: 0, z: 0, i: 0, expect: { slot: 'wood' } }, 'host', bag);
  assert.notEqual(m.serialize(), s1);
});

test('module: net load caching, prompts, interact and the OLD_HOST guard', () => {
  const g = modCtx('guest', true);
  const gm = D.createDisplay(g.ctx);
  const { aimAt, slotPoint, raft } = scene(gm, g.ctx);
  const data = { v: 1, s: 'host1', r: 5, d: { '0,0': [null, { kind: 'hammer', count: 1, durability: 80 }] }, t: { '1,0': { species: 'pomfret', cm: 30 } } };
  gm.load(data, 'net');
  const ref = gm.debug.state(), ser = gm.serialize();
  gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.serialize(), ser, 'an unchanged host slice keeps the same state object');
  const sg = raft.children.find(c => c.name === 'craft_shelf'), tg = raft.children.find(c => c.name === 'craft_trophystand');
  let aim = aimAt(slotPoint(sg, 1));
  assert.equal(gm.prompt(aim), '<kbd>E</kbd>Take Hammer');
  assert.equal(gm.interact(aim), true);
  assert.deepEqual(g.actions.at(-1), { kind: 'display.take', x: 0, z: 0, i: 1, expect: { slot: 'hammer' } });
  aim = aimAt(slotPoint(sg, 0));
  assert.equal(gm.prompt(aim), '<kbd>E</kbd>Display Plank');
  gm.interact(aim);
  assert.deepEqual(g.actions.at(-1), { kind: 'display.put', x: 0, z: 0, i: 0, from: 0, expect: { have: 'wood', slot: null } });
  g.ctx.setBag(bagWith([]));
  assert.equal(gm.prompt(aim), 'Display shelf: hold an item to show it off');
  const n = g.actions.length; gm.interact(aim); assert.equal(g.actions.length, n); assert.equal(g.notices.at(-1), TEXT.empty);
  // trophy stand: journal-driven prompts
  const journal = { speciesSeen: () => ['pomfret', 'tuna'], entry: id => ({ count: 1, bestCm: id === 'tuna' ? 71.5 : 25, firstAt: 0 }) };
  globalThis.raftFC = { journal };
  try {
    aim = aimAt(slotPoint(tg, 0));
    assert.equal(gm.prompt(aim), '<kbd>E</kbd>Take down Pomfret trophy');
    g.ctx.setBag(bagWith([{ kind: 'fish', count: 1 }]));
    assert.equal(gm.prompt(aim), '<kbd>E</kbd>Swap trophy: Tuna');
    gm.interact(aim);
    assert.deepEqual(g.actions.at(-1), { kind: 'display.mount', x: 1, z: 0, species: 'tuna', cm: 71.5, expect: { trophy: 'pomfret' } });
    gm.load({ ...data, r: 6, t: {} }, 'net');
    assert.equal(gm.prompt(aim), '<kbd>E</kbd>Mount trophy: Pomfret · 25 cm');
    g.ctx.setBag(bagWith([{ kind: 'rope', count: 1 }]));
    assert.equal(gm.prompt(aim), '<kbd>E</kbd>Display Rope');
  } finally { delete globalThis.raftFC; }
  // old host
  gm.load(undefined, 'net');
  assert.equal(gm.prompt(aim), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(aim), true);
  assert.equal(g.actions.length, sent, 'an old host never gets display.*');
  assert.equal(g.notices.at(-1), OLD_HOST);
  gm.update(1);
  assert.ok(gm.debug.slots().every(s => s.items.every(k => k === null) && s.trophy === null), 'shelves are painted empty for an old host');
  // nothing aimed: E falls through
  assert.equal(gm.prompt({ dir: { x: 0, y: 1, z: 0 } }), null);
  assert.equal(gm.interact({ dir: { x: 0, y: 1, z: 0 } }), false);
});

test('aiming: rotated shelf on a moved raft picks each slot; 0.5 m to the side picks nothing', () => {
  const { ctx } = modCtx('solo', true);
  ctx.world.decor = [shelf(0, 0, 0.7), stand(2, 1)];
  const m = D.createDisplay(ctx);
  const { aimAt, slotPoint, raft } = scene(m, ctx);
  const sg = raft.children.find(c => c.name === 'craft_shelf');
  for (const j of [0, 1, 2]) {
    const t = m.debug.target(aimAt(slotPoint(sg, j)));
    assert.deepEqual(t, { x: 0, z: 0, i: j, type: 'shelf', key: '0,0' }, 'slot ' + j);
  }
  const side = aimAt(slotPoint(sg, 2, 0.5));
  assert.equal(m.debug.target(side), null);
  // out of reach
  const far = aimAt(slotPoint(sg, 1)); ctx.physics = { x: 50, z: 50 };
  assert.equal(m.debug.target(far), null);
});

// game.js disposeGeometry, copied: skips userData.shared geometry and materials
function disposeGeometry(o) { const materials = new Set(); o.traverse(c => { if (!c.geometry?.userData.shared) c.geometry?.dispose(); for (const mm of [].concat(c.material || [])) if (!mm.userData.shared) materials.add(mm); }); for (const mm of materials) { mm.map?.dispose(); mm.dispose(); } }

test('templates: clones share geometry, survive rebuild disposal, fish trophies are shared, budget holds', () => {
  const { ctx } = modCtx('solo', true);
  ctx.world.decor = [shelf(0, 0), shelf(1, 0), stand(2, 0)];
  const m = D.createDisplay(ctx);
  m.load({ d: { '0,0': [{ kind: 'wood', count: 1 }, { kind: 'wood', count: 1 }, { kind: 'hammer', count: 1 }] }, t: { '2,0': { species: 'salmon', cm: 60 } } }, 'save');
  const { raft } = scene(m, ctx);
  m.update(0.016);
  const items = [];
  raft.traverse(o => { if (o.name === 'display_item') items.push(o); });
  assert.equal(items.length, 3);
  const meshOf = o => { let r = null; o.traverse(c => { if (!r && c.isMesh) r = c; }); return r; };
  const [a, b] = items.filter(o => o.parent.name === 'slot0' || o.parent.name === 'slot1');
  assert.equal(meshOf(a).geometry, meshOf(b).geometry, 'two wood slots share one geometry');
  assert.equal(m.debug.templates(), 2);
  let disposed = 0;
  const geo = meshOf(a).geometry; geo.addEventListener('dispose', () => disposed++);
  const trophy = raft.getObjectByName('display_trophy');
  assert.ok(trophy, 'a trophy fish is mounted');
  trophy.traverse(c => { if (c.geometry) assert.equal(c.geometry.userData.shared, true); if (c.material) assert.equal(c.material.userData.shared, true); });
  const tg = raft.children.find(c => c.name === 'craft_trophystand');
  assert.equal(tg.getObjectByName('peg').visible, true);
  // rebuildRaft: dispose every child, add fresh models; paint re-attaches
  for (const c of [...raft.children]) { raft.remove(c); disposeGeometry(c); }
  assert.equal(disposed, 0, 'template geometry is never disposed by a rebuild');
  for (const d of ctx.world.decor) { const g = m.decorModel(d.type); g.position.set(d.x * 2, .22, d.z * 2); raft.add(g); }
  m.update(0.016);
  let again = 0; raft.traverse(o => { if (o.name === 'display_item') again++; });
  assert.equal(again, 3);
  assert.deepEqual(m.debug.slots().find(s => s.key === '2,0').trophy, 'salmon|60');
  // budget: 30 full shelves
  const { ctx: c2 } = modCtx('solo', true);
  c2.world.decor = Array.from({ length: 30 }, (_, i) => shelf(i % 6, Math.floor(i / 6)));
  const m2 = D.createDisplay(c2);
  const d = {}; for (const s of c2.world.decor) d[s.x + ',' + s.z] = [{ kind: 'wood', count: 1 }, { kind: 'rope', count: 1 }, { kind: 'scrap', count: 1 }];
  m2.load({ d }, 'save');
  const s2 = scene(m2, c2);
  m2.update(0.016);
  let n = 0; s2.raft.traverse(o => { if (o.name === 'display_item') n++; });
  assert.equal(n, MAX_MODELS);
  // no work when nothing changed
  const before = m2.debug.slots().map(s => s.items.join()).join('|');
  m2.update(0.016);
  assert.equal(m2.debug.slots().map(s => s.items.join()).join('|'), before);
  m.dispose(); m2.dispose();
});

const sizeOf = g => { g.updateMatrixWorld(true); return new T.Box3().setFromObject(g).getSize(new T.Vector3()); };

test('models: anchors, plaque, sizes', () => {
  const s = M.createShelf(T), t = M.createTrophyStand(T);
  assert.equal(s.name, 'craft_shelf'); assert.equal(t.name, 'craft_trophystand');
  for (const n of ['slot0', 'slot1', 'slot2']) assert.ok(s.children.some(c => c.name === n), n);
  for (const n of ['slot0', 'plaque', 'peg']) assert.ok(t.children.some(c => c.name === n), n);
  assert.deepEqual([0, 1, 2].map(i => s.getObjectByName('slot' + i).position.x), [-.42, 0, .42]);
  for (const g of [s, t]) {
    const z = sizeOf(g);
    assert.ok(z.x <= 1.4 && z.y <= 0.8 && z.z <= 0.5, `${g.name} ${z.x.toFixed(2)} x ${z.y.toFixed(2)} x ${z.z.toFixed(2)}`);
  }
  const m = D.createDisplay({ T, world: { decor: [] }, role: 'solo' });
  assert.equal(m.decorModel('shelf').name, 'craft_shelf');
  assert.equal(m.decorModel('trophystand').name, 'craft_trophystand');
  assert.equal(m.decorModel('palm'), null);
});

test('items: recipes, radii, placeable, the bag accepts both kinds', () => {
  const cases = { shelf: { wood: 4, nail: 2 }, trophystand: { wood: 3, scrap: 1 } };
  for (const [id, cost] of Object.entries(cases)) {
    assert.ok(ITEMS[id] && ITEM_INFO[id], id); assert.ok(ITEMS[id].tip.length > 10);
    assert.equal(ITEMS[id].placeable, true); assert.ok(PLACEABLE_IDS.includes(id));
    assert.deepEqual({ ...ITEMS[id].recipe.cost }, cost, id);
    const bag = bagWith(Object.entries(cost).map(([kind, count]) => ({ kind, count })));
    assert.equal(bag.canCraft(id).ok, true, id); assert.ok(bag.craft(id), id); assert.equal(bag.count(id), 1, id);
  }
  assert.equal(BLOCK_RADII.shelf, 0.45); assert.equal(BLOCK_RADII.trophystand, 0.25);
  assert.deepEqual(SLOTS, { shelf: 3, trophystand: 1 });
  const back = new Bag(bagWith([{ kind: 'shelf', count: 2 }, { kind: 'trophystand', count: 1 }]).snapshot());
  assert.equal(back.count('shelf'), 2); assert.equal(back.count('trophystand'), 1);
});

test('templates: every item fits the slot box, sits on the surface, and tall tools stand up', () => {
  const { ctx } = modCtx('solo', true);
  ctx.world.decor = [shelf(0, 0), shelf(1, 0), stand(2, 0)];
  const m = D.createDisplay(ctx);
  m.load({ d: { '0,0': [{ kind: 'hammer', count: 1, durability: 50 }, { kind: 'wood', count: 1 }, { kind: 'fishingrod', count: 1, durability: 20 }],
    '1,0': [{ kind: 'cup', count: 1 }, { kind: 'fish', count: 1 }, { kind: 'rope', count: 1 }], '2,0': [{ kind: 'hook', count: 1, durability: 9 }] } }, 'save');
  const raft = new T.Group();
  for (const d of ctx.world.decor) { const g = m.decorModel(d.type); g.position.set(d.x * 2, .22, d.z * 2); raft.add(g); }
  raft.updateMatrixWorld(true); ctx.raft = raft;
  m.update(0.016); raft.updateMatrixWorld(true);
  let n = 0;
  raft.traverse(o => {
    if (o.name !== 'display_item') return;
    n++;
    const lim = o.parent.parent.name === 'craft_trophystand' ? D.STAND_SIZE : D.SHELF_SIZE;
    const box = new T.Box3(), part = new T.Box3();
    o.traverseVisible(c => { if (!c.isMesh) return; if (c.isInstancedMesh) { c.computeBoundingBox(); part.copy(c.boundingBox); } else { c.geometry.computeBoundingBox(); part.copy(c.geometry.boundingBox); } box.union(part.applyMatrix4(c.matrixWorld)); });
    const size = box.getSize(new T.Vector3()), top = o.parent.getWorldPosition(new T.Vector3()).y;
    assert.ok(Math.max(size.x, size.y, size.z) <= lim + 1e-3, `${o.parent.userData.dispKind} fits ${lim}`);
    assert.ok(Math.abs(box.min.y - top) < 1e-3, `${o.parent.userData.dispKind} sits on the surface`);
    const kind = o.parent.userData.dispKind;
    if (kind === 'hammer' || kind === 'fishingrod') assert.ok(size.y > Math.max(size.x, size.z), `${kind} stands up`);
    if (kind === 'wood') assert.ok(size.y < Math.max(size.x, size.z), 'a plank lies down');
  });
  assert.equal(n, 7);
});
