// Integration tests for the fishing & cooking glue (dist/fishing-cooking.js) with real three and a fake host.
// Run: node --test tests/fc-glue.test.mjs
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

test('placing grills: costs, tiles only, max count', () => {
  mem.clear();
  const tiles = []; for (let i = 0; i < 8; i++) tiles.push([i, 0]);
  const h = mount({ tiles, decor: [[7, 0]], bag: { wood: 100, scrap: 100 } });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  assert.equal(h.api.grills.size, 1);
  assert.equal(h.counts.wood, 96); assert.equal(h.counts.scrap, 98);
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 }); // occupied
  h.action({ kind: 'fc:placeGrill', x: 5, z: 5 }); // no tile
  h.action({ kind: 'fc:placeGrill', x: 7, z: 0 }); // decor
  assert.equal(h.api.grills.size, 1);
  for (let i = 1; i < 7; i++) h.action({ kind: 'fc:placeGrill', x: i, z: 0 });
  assert.equal(h.api.grills.size, MAX_GRILLS);
  const g = [...h.api.grills.values()][0];
  h.raft.position.set(0, 0.3, 0); h.raft.rotation.set(0.05, 0, -0.04); h.api.update(0.016);
  assert.ok(g.model.parent.parent === h.scene, 'grill group lives in the scene, not under the raft');
  assert.deepEqual([g.model.position.x, g.model.position.y, g.model.position.z], [0, 0.22, 0]);
  h.scene.updateMatrixWorld(true);
  const pg = new T.Vector3(2, 0.22, 0), pr = pg.clone();
  g.model.parent.localToWorld(pg); h.raft.localToWorld(pr);
  assert.ok(pg.distanceTo(pr) < 1e-9, 'grill group follows the raft pose');
  h.api.dispose();
});

test('placing a grill without enough materials is atomic', () => {
  mem.clear();
  const h = mount({ bag: { wood: 4, scrap: 1 } });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  assert.equal(h.api.grills.size, 0);
  assert.equal(h.counts.wood, 4); assert.equal(h.counts.scrap, 1);
  assert.ok(h.notices.some((t) => /Need 4 wood and 2 scrap/.test(t)));
  h.api.dispose();
});

test('cook flow: fuel, cook, take -> journal dish', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  h.api.journal.recordCatch({ species: 'herring', cm: 22, stars: 1 }); h.counts.fish = 1; // the catch also gave a bag fish
  assert.equal(h.api.journal.basket.length, 1);
  step(h, 0.2);
  assert.match(h.api.prompt, /Add fuel/);
  assert.equal(h.api.interact(), true); // add wood
  assert.ok(g.st.lit); assert.equal(h.counts.wood, 15);
  step(h, 0.2);
  assert.match(h.api.prompt, /Grill Herring \(22\.0 cm\)/);
  assert.equal(h.api.interact(), true); // cook
  assert.equal(h.api.journal.basket.length, 0);
  assert.equal(g.st.slots[0].species, 'herring');
  assert.equal(h.counts.fish, 0, 'cooking uses up the bag fish too');
  assert.ok(g.fish[0], 'fish model on the grate');
  // invalid fish data is rejected
  h.api.applyAction({ kind: 'fc:cook', id: g.st.id, fish: { species: 'herring', cm: 999 } }, 'host', h.bagApi);
  h.api.applyAction({ kind: 'fc:cook', id: g.st.id, fish: { species: 'shark', cm: 20 } }, 'host', h.bagApi);
  assert.equal(g.st.slots[1], null);
  step(h, cookTime({ cm: 22 }) + 1, 0.1);
  assert.equal(g.st.slots[0].state, 'cooked');
  assert.equal(g.fish[0].userData.state, 'cooked');
  step(h, 0.2);
  assert.match(h.api.prompt, /Take Grilled Herring/);
  assert.equal(h.api.interact(), true);
  assert.equal(g.st.slots[0], null);
  assert.equal(h.api.journal.dishes['Grilled Herring'], 1);
  assert.equal(h.api.journal.basket[0].state, 'cooked');
  h.api.dispose();
});

test('save/load round trip through localStorage', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 1, z: 0 });
  h.api.journal.recordCatch({ species: 'salmon', cm: 60, stars: 2 });
  const g = [...h.api.grills.values()][0];
  h.action({ kind: 'fc:fuel', id: g.st.id });
  h.api.capture();
  const saved = JSON.parse(mem.get(FC_SAVE_KEY));
  assert.equal(saved.v, 1); assert.equal(saved.grills.length, 1);
  h.api.dispose();
  const h2 = mount();
  assert.equal(h2.api.grills.size, 1);
  const g2 = [...h2.api.grills.values()][0];
  assert.equal(g2.st.x, 1); assert.ok(Math.abs(g2.st.fuel - COOK_TUNING.fuelPerWood) < 1e-6);
  assert.equal(h2.api.journal.entry('salmon').count, 1);
  h2.api.dispose();
});

test('guest shows host grills from snapshots and keeps its own stashed', () => {
  mem.clear();
  const h = mount({ role: 'solo' });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  h._role = 'guest'; h.api.update(0.016);
  assert.equal(h.api.grills.size, 0, 'own grills stashed');
  const snap = { id: 'hostG1', x: 1, z: 0, fuel: 40, idle: 0, slots: [{ species: 'tuna', cm: 80, t: 5, state: 'raw' }, null] };
  h.api.onNet({ type: 'fc', grills: [snap] }, 'host');
  assert.equal(h.api.grills.size, 1);
  const g = h.api.grills.get('hostG1');
  assert.equal(g.st.slots[0].species, 'tuna'); assert.ok(g.fish[0]);
  h.api.onNet({ type: 'fc', grills: [{ ...snap, slots: [{ species: 'tuna', cm: 80, t: 70, state: 'cooked' }, null] }] }, 'host');
  assert.equal(h.api.grills.get('hostG1').fish[0].userData.state, 'cooked');
  // guest actions go to the host, they are not applied locally
  h.api.applyAction({ kind: 'fc:placeGrill', x: 0, z: 1 }, 'host', h.bagApi);
  assert.equal(h.api.grills.size, 1);
  h.api.onNet({ type: 'fc', took: { species: 'tuna', cm: 80, state: 'cooked' } }, 'host');
  assert.equal(h.api.journal.dishes['Grilled Tuna'], 1);
  h.api.onNet({ type: 'fc', grills: [] }, 'host');
  assert.equal(h.api.grills.size, 0);
  h.api.capture();
  assert.equal(JSON.parse(mem.get(FC_SAVE_KEY)).grills.length, 1, 'own grill still saved while a guest');
  h._role = 'solo'; h.api.update(0.016);
  assert.equal(h.api.grills.size, 1, 'own grills restored');
  h.api.dispose();
});

test('host broadcasts grills and returns guest take results', () => {
  mem.clear();
  const h = mount({ role: 'host' });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  h.api.update(0.016);
  const msg = h.sent.find((m) => m.type === 'fc' && Array.isArray(m.grills));
  assert.ok(msg && msg.grills.length === 1);
  const g = [...h.api.grills.values()][0];
  g.st.slots[0] = { species: 'pomfret', cm: 25, t: 999, state: 'burnt' };
  h.api.applyAction({ kind: 'fc:take', id: g.st.id, slot: 0 }, 'guest', h.bagApi);
  assert.deepEqual(h.sent.at(-1), { type: 'fc', took: { species: 'pomfret', cm: 25, state: 'burnt' } });
  assert.equal(h.api.journal.totalCaught, 0, 'host journal untouched by a guest take');
  h.api.dispose();
});

test('forceCatch records the journal and gives a bag fish', () => {
  mem.clear();
  const h = mount({ role: 'host' });
  assert.ok(globalThis.window.raftFC);
  globalThis.window.raftFC.forceCatch('mackerel');
  assert.equal(h.api.journal.entry('mackerel').count, 1);
  assert.ok(h.actions.some((a) => a.kind === 'fish'));
  assert.equal(h.api.journal.basket.length, 1);
  assert.ok(h.notices.some((t) => /Mackerel · 35\.0 cm ★★/.test(t)));
  assert.ok(h.sent.some((m) => m.catchFx && m.catchFx.species === 'mackerel'));
  assert.equal(h.camera.children.length, 1, 'fish held in view');
  step(h, 2.5);
  assert.equal(h.camera.children.length, 0);
  h.api.dispose();
  assert.equal(globalThis.window.raftFC, undefined);
});

test('caught-fish viewmodel expires on wall-clock time even when game dt crawls', () => {
  mem.clear();
  const h = mount({ role: 'host' }), realNow = performance.now.bind(performance); let skew = 0;
  performance.now = () => realNow() + skew;
  try {
    globalThis.window.raftFC.forceCatch('mackerel');
    assert.equal(h.camera.children.length, 1);
    step(h, 0.1, 0.05); assert.equal(h.camera.children.length, 1, 'still held after 0.1 s of game time');
    skew = 2300; step(h, 0.05, 0.05); // a slow-frame stretch: 2.3 s of wall time, almost no game time
    assert.equal(h.camera.children.length, 0);
  } finally { performance.now = realNow; h.api.dispose(); }
});

test('rod fishing: press/release casts, bite then reel to a catch', () => {
  mem.clear();
  const h = mount();
  assert.equal(h.api.pointerDown(), true);
  step(h, 0.5, 0.05);
  assert.equal(h.api.pointerUp(), true);
  const fc = globalThis.window.raftFC;
  assert.equal(fc.state.stage, 'flying');
  step(h, 0.2, 0.05);
  assert.equal(h.rodModel.userData.float, undefined); // fake rod has no float; just must not throw
  fc.forceBite('herring'); h.api.update(0.016);
  assert.equal(fc.state.stage, 'bite');
  assert.ok(h.notices.includes('Bite! Click!'));
  h.api.pointerDown(); // strike
  assert.equal(fc.state.stage, 'reeling'); assert.equal(h.api.rodReeling, true);
  // casual reel: hold, release when tension high
  let holding = true;
  for (let i = 0; i < 2000 && fc.state.stage === 'reeling'; i++) {
    const ten = fc.state.tension;
    if (holding && ten > 0.6) { h.api.pointerUp(); holding = false; } else if (!holding && ten < 0.3) { h.api.pointerDown(); holding = true; }
    h.api.update(1 / 30);
  }
  if (holding) h.api.pointerUp();
  assert.equal(h.api.journal.entry('herring')?.count, 1);
  h._kind = 'hammer'; h.api.update(0.016);
  assert.equal(h.api.pointerDown(), false, 'not holding the rod');
  h.api.dispose();
});

// ---------- adversarial review regressions ----------
test('raft rebuild never touches lane objects (game.js disposes every raft child)', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  h.api.update(0.016);
  assert.equal(h.raft.children.length, 0, 'nothing of ours under the raft');
  h.api.dispose();
  assert.equal(h.scene.getObjectByName('fcGrills'), undefined);
});

test('host grill snapshot arriving before the next frame after joining keeps own grills stashed', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const own = [...h.api.grills.keys()][0];
  h._role = 'guest'; // join clicked, no update() yet (background tab: no rAF)
  h.api.onNet({ type: 'fc', grills: [{ id: 'H1', x: 1, z: 0 }] }, 'host');
  assert.deepEqual([...h.api.grills.keys()], ['H1']);
  h.api.save();
  assert.deepEqual(JSON.parse(mem.get(FC_SAVE_KEY)).grills.map((g) => g.id), [own], 'own grill saved, not the host one');
  assert.deepEqual(h.api.capture().grills.map((g) => g.id), [own], 'capture() returns own grills while a guest');
  h._role = 'solo'; h.api.update(0.016);
  assert.deepEqual([...h.api.grills.keys()], [own]);
  h.api.dispose();
});

test('save before the first frame after joining does not wipe own grills', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  h._role = 'guest'; h.api.save();
  assert.equal(JSON.parse(mem.get(FC_SAVE_KEY)).grills.length, 1);
  h.api.dispose();
});

test('junk or orphaned saved grills are dropped (off-raft, decor, duplicates, non-objects)', () => {
  mem.clear();
  mem.set(FC_SAVE_KEY, JSON.stringify({ v: 1, grills: [{ id: 'a', x: 9, z: 9 }, 7, 'x', null, { id: 'b', x: 1e300, z: 0 },
    { id: 'c', x: 0, z: 0 }, { id: 'd', x: 0.2, z: 0 }, { id: 'e', x: 0, z: 1 }] }));
  const h = mount({ decor: [[0, 1]] });
  assert.deepEqual([...h.api.grills.keys()], ['c']);
  h.api.dispose();
});

test('taking a dish never destroys it: basket full of raw fish blocks the take', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  for (let i = 0; i < 40; i++) h.api.journal.addToBasket({ species: 'herring', cm: 20, state: 'raw' });
  g.st.slots[0] = { species: 'tuna', cm: 100, t: 70, state: 'cooked' };
  step(h, 0.2);
  assert.match(h.api.prompt, /Basket full/);
  h.api.interact();
  assert.equal(g.st.slots[0]?.species, 'tuna', 'dish stays on the grill');
  h.api.journal.basket[5].state = 'cooked'; step(h, 0.2); // now a dish can make room
  assert.match(h.api.prompt, /Take Grilled Tuna/);
  assert.equal(h.api.interact(), true);
  assert.equal(g.st.slots[0], null);
  assert.ok(h.api.journal.basket.some((b) => b.species === 'tuna'));
  h.api.dispose();
});

test('a dialog opening mid-reel releases the hold instead of snapping the line', () => {
  mem.clear();
  const h = mount();
  const fc = globalThis.window.raftFC;
  h.api.pointerDown(); step(h, 0.3, 0.05); h.api.pointerUp(); step(h, 0.1, 0.05);
  fc.forceBite('herring'); h.api.update(0.016);
  h.api.pointerDown();
  assert.equal(fc.state.stage, 'reeling');
  h._blocked = true; // journal / inventory dialog: the canvas never sees pointerup
  for (let i = 0; i < 300 && fc.state.stage === 'reeling'; i++) h.api.update(1 / 30);
  assert.equal(fc.state.stage, 'reeling'); assert.equal(fc.session.holding, false);
  assert.equal(h.api.pointerUp(), false);
  h._blocked = false;
  // and while charging a cast, a dialog cancels it rather than casting
  fc.session.cancel(); h.api.update(0.016);
  h.api.pointerDown(); h.api.update(0.1); h._blocked = true; h.api.update(0.016);
  assert.equal(fc.state.stage, 'idle');
  h.api.dispose();
});
