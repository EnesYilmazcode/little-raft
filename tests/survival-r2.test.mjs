// Round-2 farming regressions: empty planters dry out, farm rewards reach the pickup feed, clean notes.
// Run: node --test tests/survival-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const F = await import(new URL('farming.js', base));

test('SURV-2: an empty planter dries out like a grown palm', () => {
  const p = { s: F.EMPTY, g: 0, w: 80, h: 1 };
  let dried = false;
  for (let i = 0; i < 80; i++) dried = F.tickPlant(p, 1) || dried;
  assert.equal(p.w, 0);
  assert.equal(dried, true, 'drying is reported as a look change');
  assert.equal(F.isWet(p), false);
  assert.equal(F.farmSignature([{ type: 'palm', x: 0, z: 0, farm: p }]), '0,0:-1d;');
  assert.equal(F.tickPlant(p, 600), false, 'dry and empty stays put');
  assert.deepEqual(p, { s: F.EMPTY, g: 0, w: 0, h: 1 });
});

test('SURV-2: a seed planted in soil that dried gets no free growth', () => {
  const p = { s: F.EMPTY, g: 0, w: 80, h: 1 };
  F.tickPlant(p, 600);
  p.s = F.SEEDLING;
  F.tickPlant(p, 100);
  assert.equal(p.s, F.SEEDLING); assert.equal(p.g, 0);
});

const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const bagWith = (items) => { const s = new Array(SLOT_COUNT).fill(null); items.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };

test('SURV-3: harvest and cup-fill rewards are emitted as loot for the pickup feed', () => {
  const world = { decor: [{ type: 'palm', x: 0, z: 0, farm: { s: F.MATURE, g: 0, w: 0, h: 0 } }] };
  const harvest = F.farmEffect(F.applyFarmAction(world, bagWith([]), { kind: 'farm', op: 'harvest', x: 0, z: 0 }));
  assert.equal(harvest.kind, 'loot');
  assert.deepEqual(harvest.loot, { leaf: F.HARVEST.leaf, seed: F.HARVEST.seed });
  assert.equal('items' in harvest, false);
  for (const k of Object.keys(harvest.loot)) assert.ok(ITEM_INFO[k], `${k} has an icon entry`);
  const fill = F.farmEffect(F.applyFarmAction(world, bagWith([{ kind: 'cup', count: 1 }]), { kind: 'farm', op: 'fill' }));
  assert.deepEqual(fill.loot, { water: 1 });
  assert.equal(F.farmEffect({ ok: false, text: 'Not ready yet', effect: 'notice' }).loot, undefined);
  assert.equal(F.farmEffect({ ok: false, text: '' }), null);
});

test('SURV-4: a seed or water click with no planter in reach explains itself', () => {
  assert.match(F.useNote(null, 'seed'), /^Point at a palm planter/);
  assert.match(F.useNote(null, 'water'), /^Point at a palm planter/);
});

test('SURV-4: water on still-wet soil says so, in the prompt and the note', () => {
  const p = { s: F.SEEDLING, g: 10, w: F.WATER_SECONDS * .8, h: 0 };
  assert.equal(F.plotAction(p, 'water'), null);
  assert.match(F.promptFor(p, 'water'), /soil still wet$/);
  assert.match(F.useNote(p, 'water'), /soil still wet$/);
  assert.match(F.promptFor(p, 'seed'), /growing$/, 'other held items still read growing');
});

test('SURV-4: feed notes never carry the raw "E  " key prefix', () => {
  const mature = { s: F.MATURE, g: 0, w: 0, h: 0 };
  assert.ok(F.promptFor(mature, 'seed').startsWith('E  '), 'the crosshair prompt keeps its key marker');
  for (const kind of ['seed', 'water']) {
    const note = F.useNote(mature, kind);
    assert.equal(note, 'Press E to harvest the palm');
    assert.ok(!note.startsWith('E '));
  }
});

// ---------------------------------------------------------------- round 3
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const L = await import(new URL('islands-layout.js', base));
const CB = await import(new URL('craft-book.js', base));

test('SURV-1 r3: palm seeds no longer drop, the kind stays registered and the copy is honest', () => {
  for (let s = 0; s < 300; s++) for (const k of ['palm', 'bush']) for (let u = 0; u < 4; u++)
    assert.ok(!L.lootFor(k, s, 1, u).some(([x]) => x === 'seed'), `${k} ${s} ${u}`);
  assert.ok(ITEM_INFO.seed, 'old bags holding seeds still load');
  assert.doesNotMatch(CB.ITEM_SOURCE.seed.how, /barrel|harvest/i);
  assert.match(gameSrc, /kind === 'seed'\) \{ notice\('Planters grow from fresh water/);
  assert.doesNotMatch(gameSrc, /farmPlot/);
});

// Fishing & cooking with real three and a small fake host (see tests/fc-glue.test.mjs for the full one).
const T = await import(new URL('vendor/three.module.js', base));
const { createFishingCooking, FC_SAVE_KEY } = await import(new URL('fishing-cooking.js', base));
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
globalThis.window ??= {};
function fcMount({ tiles = [[0, 0], [1, 0], [2, 0]], running = true } = {}) {
  const counts = { wood: 50, scrap: 20 };
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200);
  scene.add(raft, camera);
  const bagApi = { count: (k) => counts[k] || 0, remove: (k, n) => ((counts[k] || 0) >= n ? ((counts[k] -= n), true) : false), add: (k, n) => ((counts[k] = (counts[k] || 0) + n), 0), emit() {} };
  const h = {
    scene, raft, camera, ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) },
    signal: new AbortController().signal, rodModel: new T.Group(), role: () => 'solo', netReady: () => false, send() {}, notice() {}, beep() {},
    selectedKind: () => 'wood', aim: () => ({ point: null, dir: new T.Vector3(0, 0, -1) }), rodTip: () => new T.Vector3(), player: () => ({ x: 0, y: 0.3, z: 0, yaw: 0 }),
    hasTile: (x, z) => tiles.some(([a, b]) => a === x && b === z), decorAt: () => false,
    bagCount: (k) => counts[k] || 0, running: () => h._running, _running: running, uiBlocked: () => false, busy: () => false,
    action(a) { if (a.kind.startsWith('fc:')) h.api.applyAction(a, 'host', bagApi); return true; },
  };
  h.api = createFishingCooking(T, h);
  return h;
}

test('SURV-2 r3: fc.reset clears every grill and rewrites the save; New game calls it', () => {
  mem.clear();
  const h = fcMount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 }); h.action({ kind: 'fc:placeGrill', x: 2, z: 0 });
  assert.equal(h.api.grills.size, 2);
  h.api.reset();
  assert.equal(h.api.grills.size, 0);
  assert.deepEqual(JSON.parse(mem.get(FC_SAVE_KEY)).grills, []);
  assert.ok(JSON.parse(mem.get(FC_SAVE_KEY)).journal, 'the journal is kept');
  h.api.dispose();
  const ng = gameSrc.slice(gameSrc.indexOf('function newGame()'), gameSrc.indexOf('const hasSave'));
  assert.match(ng, /fc\?\.reset\(\)/);
});

test('SURV-3 r3: the floor under a grill cannot be removed (client and host share floorRemoveWhy)', () => {
  const fn = gameSrc.slice(gameSrc.indexOf('function floorRemoveWhy('), gameSrc.indexOf('function removePiece('));
  assert.match(fn, /fc\?\.hasGrill\(tx, tz\)\) return 'decor'/);
  const h = fcMount(); h.action({ kind: 'fc:placeGrill', x: 2, z: 0 });
  assert.equal(h.api.hasGrill(2, 0), true); assert.equal(h.api.hasGrill(1, 0), false);
  h.api.dispose();
});
