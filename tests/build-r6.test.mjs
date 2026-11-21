// Regression tests for build round 6: decor-pack placement rotation, ghost vs host decor/grill block,
// ladder as a cell piece, gamepad Rotate with the hammer.
// Run: node --test tests/build-r6.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');

// ---- minimal DOM for building.js (build menu) ----
function fakeEl() {
  const cls = new Set(), store = { dataset: {}, style: {}, hidden: false, offsetWidth: 0, width: 0, height: 0 };
  const classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'classList') return classList;
      if (k === 'querySelectorAll') return () => Array.from({ length: 16 }, () => fakeEl());
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 100, height: 100 });
      if (typeof k === 'symbol' || k === 'then') return undefined;
      return () => fakeEl();
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
if (!globalThis.document) {
  const win = new EventTarget();
  globalThis.window ??= win;
  globalThis.addEventListener ??= win.addEventListener.bind(win);
  globalThis.removeEventListener ??= win.removeEventListener.bind(win);
  const doc = new EventTarget();
  Object.assign(doc, { pointerLockElement: null, visibilityState: 'visible', head: fakeEl(), body: fakeEl(),
    getElementById: () => null, createElement: () => fakeEl(), createElementNS: () => fakeEl() });
  globalThis.document = doc;
}

const T = await import(new URL('vendor/three.module.js', base));
const { createDecorPack } = await import(new URL('decor-pack.js', base));
const { createBuilding } = await import(new URL('building.js', base));
const { BuildGrid } = await import(new URL('building-pieces.js', base));
const { decorBlock, pieceBlock, BLOCK_TEXT } = await import(new URL('build-rules.js', base));

// ============================================================ 1: placed decor-pack rotation

function packRig(role = 'host') {
  const world = { tiles: [[0, 0], [1, 0]], decor: [], ext: {} };
  const ctx = { T, world, role, physics: { x: 0, z: 0 }, other: null, elapsed: 0, emit() {}, action: a => dp.action(a, 'host'), rebuildRaft() {} };
  const dp = createDecorPack(ctx);
  // game.js rebuildRaft: the model, then d.rot unless the model owns its facing
  const rebuild = () => world.decor.map(d => { const g = dp.decorModel(d.type, d); if (d.rot && !g.userData.ownRot) g.rotation.y = d.rot; return g; });
  return { world, dp, rebuild };
}

test('a decor-pack item placed with R keeps that turn after the rescan, E-turns and rebuilds', () => {
  const { world, dp, rebuild } = packRig();
  world.decor.push({ type: 'pennant', x: 1, z: 0, rot: 1.571 }); // one quarter turn; the player at (0,0) would face it to 3
  let [g] = rebuild();
  assert.ok(Math.abs(g.rotation.y - Math.PI / 2) < 1e-3);
  dp.update();
  assert.ok(Math.abs(g.rotation.y - Math.PI / 2) < 1e-3, 'no snap to face the player');
  assert.equal(dp.debug.state().rot['1,0'], 1, 'seeded from d.rot');
  dp.action({ kind: 'decor.turn', x: 1, z: 0 }, 'host');
  assert.equal(dp.debug.state().rot['1,0'], 2);
  [g] = rebuild(); dp.update();
  assert.ok(Math.abs(g.rotation.y - Math.PI) < 1e-3, 'rebuild keeps the E-turn');
  assert.equal(g.userData.ownRot, true);
  // the save keeps it
  const saved = JSON.parse(JSON.stringify(dp.serialize()));
  const b = packRig(); b.world.decor.push({ type: 'pennant', x: 1, z: 0, rot: 1.571 });
  b.dp.load(saved, 'save');
  const [g2] = b.rebuild(); b.dp.update();
  assert.ok(Math.abs(g2.rotation.y - Math.PI) < 1e-3, 'loaded save keeps the turn');
});

test('an unrotated decor-pack item still faces the nearest player', () => {
  const { world, dp, rebuild } = packRig();
  world.decor.push({ type: 'pennant', x: 1, z: 0 });
  rebuild(); dp.update();
  assert.equal(dp.debug.state().rot['1,0'], 3);
});

test('a guest model without host state yet uses the placement turn', () => {
  const { world, rebuild } = packRig('guest');
  world.decor.push({ type: 'pennant', x: 1, z: 0, rot: -Math.PI / 2 });
  const [g] = rebuild();
  assert.ok(Math.abs(g.rotation.y - 3 * Math.PI / 2) < 1e-3);
});

// ============================================================ 2: ghost honours the host's extra block

test('setPlaceExtra turns the stairs ghost red with the reason, and use() sends nothing', () => {
  const b = createBuilding(T, new T.Scene());
  b.sync({ tiles: [[0, 0], [1, 0], [2, 0]], pieces: [] });
  b.menu.setSelected('stairs');
  const raft = new T.Object3D(), cam = new T.Vector3(0, 1.6, 0), aim = { dir: new T.Vector3(2, -1.6, 0).normalize() };
  b.update(raft, aim, cam, true, null, 0, 0);
  const a = b.use();
  assert.ok(a && a.t === 'stairs', 'aims a free cell');
  const decor = [{ type: 'crate', x: a.i, z: a.j }];
  let seen = null;
  b.setPlaceExtra(p => { seen = p; const w = pieceBlock(decor, p); return w ? BLOCK_TEXT[w] : ''; });
  b.update(raft, aim, cam, true, null, 0, 0);
  assert.equal(seen.t, 'stairs');
  assert.equal(b.use(), null);
  b.setPlaceExtra(null);
  b.update(raft, aim, cam, true, null, 0, 0);
  assert.ok(b.use());
  b.dispose();
});

test('game.js wires the ghost block to the same host check (decor + grill)', () => {
  const g = src('game.js');
  assert.match(g, /building\.setPlaceExtra\(/);
  assert.match(g, /function pieceExtraBlock\(/);
});

// ============================================================ 3: ladder is a cell piece

test('ladder and decor cannot share a deck cell', () => {
  const tiles = [[0, 0], [1, 0]];
  const L = { t: 'ladder', i: 1, j: 0, l: 0, r: 0 };
  assert.equal(pieceBlock([{ type: 'crate', x: 1, z: 0 }], L), 'decor');
  const g = new BuildGrid(); g.setTiles(tiles); g.place(L);
  assert.equal(decorBlock(tiles, [], 1, 0, g.list), 'piece');
  assert.doesNotMatch(BLOCK_TEXT.piece, /stairs/i);
});

// ============================================================ 4: pad Rotate with the hammer

test('pad Rotate with the hammer turns the building piece instead of repairing the hook', () => {
  const g = src('game.js');
  const hook = g.match(/repair:back => \{[^\n]*/)?.[0] ?? '';
  assert.match(hook, /heldKind\(\) === 'hammer' && building\?\.key\('KeyR', true, true\)/);
});

test('a pick that changes the piece resets its rotation', () => {
  const b = createBuilding(T, new T.Scene());
  b.menu.setSelected('stairs');
  b.update(new T.Object3D(), null, new T.Vector3(), true, null, 0, 0);
  b.key('KeyR', true, true); b.key('KeyR', true, true);
  assert.equal(b.rotation, 2);
  b.menu.setSelected('roof');
  b.update(new T.Object3D(), null, new T.Vector3(), true, null, 0, 0);
  assert.equal(b.rotation, 0);
  b.dispose();
});
