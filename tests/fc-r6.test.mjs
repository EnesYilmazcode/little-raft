// Round 6 fishing/cooking glue regressions: grilled fish reach the bag, full-bag catches are not journalled.
// Run: node --test tests/fc-r6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createFishingCooking, FC_SAVE_KEY, MAX_GRILLS } = await import(new URL('fishing-cooking.js', base));
const { COOK_TUNING, cookTime } = await import(new URL('cooking.js', base));

// fake browser bits: storage + a window object without DOM events (debug handle only)
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
globalThis.window ??= {};

function makeHost({ role = 'solo', tiles = [[0, 0], [1, 0], [0, 1]], decor = [], bag = { wood: 20, scrap: 6, fishingrod: 1 } } = {}) {
  const counts = { ...bag }, sent = [], notices = [], actions = [];
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200);
  scene.add(raft, camera);
  const bagApi = {
    count: (k) => counts[k] || 0,
    remove: (k, n) => ((counts[k] || 0) >= n ? ((counts[k] -= n), true) : false),
    add: (k, n) => ((counts[k] = (counts[k] || 0) + n), 0),
    emit: (t) => notices.push(t),
  };
  const h = {
    scene, raft, camera, ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) },
    signal: new AbortController().signal, rodModel: new T.Group(), role: () => h._role, _role: role,
    netReady: () => h._net, _net: role !== 'solo', send: (o) => sent.push(o), notice: (t) => notices.push(t), beep() {},
    selectedKind: () => h._kind, _kind: 'fishingrod',
    aim: () => ({ point: h._aim, dir: new T.Vector3(0, 0, -1) }), _aim: new T.Vector3(0, 0, 0),
    rodTip: () => new T.Vector3(0.3, 1.4, -0.4), player: () => ({ x: 0, y: 0.3, z: 0, yaw: 0 }),
    hasTile: (x, z) => tiles.some(([a, b]) => a === x && b === z), decorAt: (x, z) => decor.some(([a, b]) => a === x && b === z),
    bagCount: (k) => counts[k] || 0, running: () => true, uiBlocked: () => !!h._blocked, busy: () => false,
    action(a) {
      actions.push(a);
      if (h._role === 'guest') { sent.push({ type: 'action', a }); return true; }
      if (a.kind.startsWith('fc:')) h.api.applyAction(a, 'host', bagApi);
      return true;
    },
  };
  return Object.assign(h, { counts, sent, notices, actions, bagApi });
}
function mount(opts) { const h = makeHost(opts); h.api = createFishingCooking(T, h); return h; }
const step = (h, sec, dt = 0.1) => { for (let t = 0; t < sec; t += dt) h.api.update(dt); };


function grillWith(h, fish) {
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  g.st.slots[0] = { t: 999, ...fish };
  return g;
}

test('taking a cooked fish puts a grilled fish in the bag and keeps the journal record', () => {
  mem.clear();
  const h = mount();
  const g = grillWith(h, { species: 'herring', cm: 22, state: 'cooked' });
  h.action({ kind: 'fc:take', id: g.st.id, slot: 0 });
  assert.equal(h.counts.cookedfish, 1);
  assert.equal(g.st.slots[0], null);
  assert.equal(h.api.journal.dishes['Grilled Herring'], 1);
  h.api.dispose();
});

test('full grill-to-bag loop: one bag fish in, one grilled fish out', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  h.action({ kind: 'fc:fuel', id: g.st.id });
  h.api.journal.recordCatch({ species: 'herring', cm: 22, stars: 1 }); h.counts.fish = 1;
  step(h, 0.2); assert.equal(h.api.interact(), true);
  assert.equal(h.counts.fish, 0);
  step(h, cookTime({ cm: 22 }) + 1); step(h, 0.2);
  assert.equal(h.api.interact(), true);
  assert.equal(h.counts.cookedfish, 1);
  h.api.dispose();
});

test('a full bag keeps the cooked fish on the grill', () => {
  mem.clear();
  const h = mount();
  const g = grillWith(h, { species: 'herring', cm: 22, state: 'cooked' });
  h.bagApi.add = (k, n) => n; // nothing fits
  h.action({ kind: 'fc:take', id: g.st.id, slot: 0 });
  assert.equal(g.st.slots[0]?.state, 'cooked', 'still on the grill');
  assert.equal(h.api.journal.dishes['Grilled Herring'] ?? 0, 0);
  assert.ok(h.notices.some((t) => /full/i.test(t)));
  h.api.dispose();
});

test('burnt fish gives nothing edible', () => {
  mem.clear();
  const h = mount();
  const g = grillWith(h, { species: 'pomfret', cm: 25, state: 'burnt' });
  h.action({ kind: 'fc:take', id: g.st.id, slot: 0 });
  assert.equal(g.st.slots[0], null);
  assert.equal(h.counts.cookedfish ?? 0, 0);
  h.api.dispose();
});

test('host adds the grilled fish to the guest bag it was handed, and still sends took', () => {
  mem.clear();
  const h = mount({ role: 'host' });
  const g = grillWith(h, { species: 'pomfret', cm: 25, state: 'cooked' });
  const guest = {}, guestBag = { count: (k) => guest[k] || 0, remove: () => false, add: (k, n) => ((guest[k] = (guest[k] || 0) + n), 0), emit() {} };
  h.api.applyAction({ kind: 'fc:take', id: g.st.id, slot: 0 }, 'guest', guestBag);
  assert.equal(guest.cookedfish, 1);
  assert.equal(h.counts.cookedfish ?? 0, 0, 'host bag untouched');
  assert.deepEqual(h.sent.at(-1), { type: 'fc', took: { species: 'pomfret', cm: 25, state: 'cooked' } });
  h.api.dispose();
});

test('a rod catch with a full bag is not journalled or basketed', () => {
  mem.clear();
  const h = mount({ role: 'host' });
  h.bagFits = () => false;
  globalThis.window.raftFC.forceCatch('mackerel');
  assert.equal(h.api.journal.entry('mackerel')?.count ?? 0, 0);
  assert.equal(h.api.journal.basket.length, 0);
  assert.ok(h.actions.some((a) => a.kind === 'fish'), 'game still gets the catch so it can say the bag is full');
  assert.equal(h.camera.children.length, 0, 'no fish held up');
  h.bagFits = (k, n) => k === 'fish' && n === 1;
  globalThis.window.raftFC.forceCatch('mackerel');
  assert.equal(h.api.journal.entry('mackerel').count, 1);
  assert.equal(h.api.journal.basket.length, 1);
  h.api.dispose();
});

test('game.js wires bagFits to the local bag (guest mirror) and fc:take gets the actor bag', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../dist/game.js', import.meta.url), 'utf8');
  assert.match(src, /bagFits:\s*\(k, n = 1\) => new Bag\(localBag\(\)\.snapshot\(\)\)\.add\(k, n\) === 0/);
});
