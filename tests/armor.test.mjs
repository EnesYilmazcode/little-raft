import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../dist/vendor/three.module.js';
import { ITEMS } from '../dist/items.js';
import { RECIPES, Bag, ITEM_INFO } from '../dist/inventory-state.js';
import { ITEM_ICONS } from '../dist/item-svg.js';
import { ARMOR_ITEM, armorKey, cleanTileArmor, isArmoredAt, canFitArmor, fitArmor, armorSides, createArmorView } from '../dist/armor.js';
import { createSharkState, startAttack, forceAttack, removeTile, edgeTiles, step } from '../dist/shark.js';
import { attachSpearRepair } from '../dist/spear-repair-hooks.js';

const grid = (n) => { const t = []; for (let z = -1; z < n - 1; z++) for (let x = -1; x < n - 1; x++) t.push([x, z]); return t; };
const bagWith = (items) => { const b = new Bag({ slots: new Array(28).fill(null), selected: 0 }); for (const [k, n] of Object.entries(items)) b.add(k, n); return b; };
const gameSrc = readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');

test('Foundation Armor: Raft cost (1 metal ingot + 2 nails), research unlock like the other metal items, icon', () => {
  assert.equal(ARMOR_ITEM, 'armor');
  assert.equal(ITEMS.armor.name, 'Foundation Armor');
  assert.deepEqual({ ...RECIPES.armor.cost }, { metalingot: 1, nail: 2 });
  assert.equal(RECIPES.armor.output.count, 1);
  assert.deepEqual(ITEMS.armor.unlock, { type: 'research', items: ['metalingot', 'nail'] });
  assert.equal(ITEMS.armor.tool, false); assert.equal(ITEMS.armor.placeable, false);
  assert.ok(ITEM_INFO.armor && ITEM_ICONS.armor);
  const bag = bagWith({ metalingot: 1, nail: 2 });
  assert.equal(bag.craft('armor').ok, true); assert.equal(bag.count('armor'), 1); assert.equal(bag.count('metalingot'), 0);
});

test('fitArmor: one armor per existing, unarmored tile; host bag pays', () => {
  const w = { tiles: grid(2) };
  const bag = bagWith({ armor: 2 });
  assert.equal(canFitArmor(w, 5, 5), 'tile');
  assert.equal(canFitArmor(w, 0.5, 0), 'tile');
  assert.equal(canFitArmor(w, 0, 0), null);
  assert.deepEqual(fitArmor(w, 9, 9, bag), { ok: false, reason: 'tile' });
  assert.deepEqual(fitArmor(w, 0, 0, bag), { ok: true });
  assert.equal(w.tileArmor['0,0'], 1); assert.ok(isArmoredAt(w, 0, 0)); assert.equal(bag.count('armor'), 1);
  assert.deepEqual(fitArmor(w, 0, 0, bag), { ok: false, reason: 'armored' });
  assert.equal(bag.count('armor'), 1, 'refused fit costs nothing');
  assert.deepEqual(fitArmor(w, -1, 0, bagWith({})), { ok: false, reason: 'cost' });
  assert.equal(armorKey(-1, 2), '-1,2');
});

test('cleanTileArmor keeps truthy keys on existing tiles only', () => {
  const tiles = grid(2);
  assert.deepEqual(cleanTileArmor({ '0,0': 1, '-1,0': true, '7,7': 1, '0,-1': 0, junk: 'x' }, tiles), { '0,0': 1, '-1,0': 1 });
  for (const bad of [null, undefined, 3, 'x', ['0,0']]) assert.deepEqual(cleanTileArmor(bad, tiles), {});
  assert.deepEqual(cleanTileArmor({ '0,0': 1 }, null), {});
});

test('removing a tile removes its armor', () => {
  const w = { tiles: grid(2), decor: [], tileHp: {}, tileArmor: { '0,0': 1, '-1,-1': 1 }, pieces: [] };
  assert.ok(removeTile(w, 0, 0));
  assert.deepEqual(w.tileArmor, { '-1,-1': 1 });
});

test('shark skips its attack when every edge tile is armored', () => {
  const w = { tiles: grid(2), decor: [], tileHp: {}, pieces: [], tileArmor: {} };
  const bag = bagWith({ armor: 4 });
  for (const [x, z] of w.tiles) assert.ok(fitArmor(w, x, z, bag).ok);
  assert.equal(edgeTiles(w.tiles, w.tileArmor).length, 0);
  const s = createSharkState(null, () => 0.5);
  assert.equal(forceAttack(s, w, () => 0.5), false);
  assert.equal(s.state, 'circle'); assert.equal(s.hasTarget, false);
  // a full attack cycle bites nothing
  const env = { rnd: () => 0.5, players: [] };
  for (let t = 0; t < 30; t += 0.05) step(s, 0.05, w, env);
  assert.deepEqual(w.tileHp, {});
  // one bare edge tile is the only target
  delete w.tileArmor['0,0'];
  for (let k = 0; k < 10; k++) { const s2 = createSharkState(null); assert.ok(startAttack(s2, w, Math.random)); assert.deepEqual([s2.tx, s2.tz], [0, 0]); }
});

test('armorSides lists the open sides of armored tiles (reused output array)', () => {
  const out = [];
  assert.equal(armorSides(grid(2), { '0,0': 1 }, out), 2); // a corner of the 2x2: +x and +z are open
  assert.deepEqual(out, [0, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(armorSides(grid(3), { '0,0': 1 }, out), 0, 'the middle of a 3x3 has no open side');
  assert.equal(armorSides([[0, 0]], { '0,0': 1 }, out), 4);
  assert.equal(armorSides(grid(2), null, out), 0); assert.equal(out.length, 0);
});

test('armor view: one instanced mesh, no shadows, rebuilt only when the layout changes, follows the raft', () => {
  const scene = new T.Scene(), raft = new T.Group(); raft.position.set(1, 0.3, -2);
  const v = createArmorView(T, scene);
  const w = { tiles: grid(2), tileArmor: {} };
  v.update(w, raft);
  assert.equal(v.count, 0);
  const meshes = () => { const m = []; v.group.traverse(o => { if (o.isMesh) m.push(o); }); return m; };
  assert.equal(meshes().length, 1); assert.ok(meshes()[0].isInstancedMesh); assert.equal(meshes()[0].castShadow, false);
  w.tileArmor = { '0,0': 1, '-1,-1': 1 };
  v.update(w, raft);
  assert.equal(v.count, 4);
  assert.ok(v.group.position.equals(raft.position));
  const mesh = meshes()[0], ver = mesh.instanceMatrix.version;
  v.update(w, raft); v.update({ tiles: w.tiles.map(t => [...t]), tileArmor: { ...w.tileArmor } }, raft); // same layout, new objects (a guest's state message)
  assert.equal(mesh.instanceMatrix.version, ver, 'no rebuild without a change');
  w.tiles.push([1, 0]); v.update(w, raft); // a new neighbour covers one side of 0,0
  assert.equal(v.count, 3);
  for (let x = 0; x < 30; x++) w.tiles.push([x + 2, 5]);
  for (const [x, z] of w.tiles) w.tileArmor[x + ',' + z] = 1;
  v.update(w, raft); assert.ok(v.count > 16, 'grows past the first capacity');
  assert.equal(meshes().length, 1);
  v.dispose(); assert.equal(scene.children.length, 0);
});

test('fitArmor action through the spear-repair glue: host-authoritative, reach-checked, prompt', () => {
  const world = { tiles: grid(2), tileArmor: {} };
  const host = bagWith({ armor: 1 }), emits = [], actions = [];
  const ctx = { T, camera: () => null, raft: () => null, world: () => world, physics: () => ({ x: -1, z: -1 }), other: () => ({ x: 30, z: 30 }),
    localBag: () => host, role: () => 'solo', elapsed: () => 0, shark: () => null, action: a => actions.push(a), emit: (e, to) => emits.push([e, to]),
    notice: () => {}, play: () => {}, setSwing: () => {} };
  const g = attachSpearRepair(ctx);
  g.updateAim('armor', { point: { x: 0.2, z: -0.1 } });
  assert.deepEqual(g.aimedArmor(), { x: 0, z: 0 });
  assert.deepEqual(g.prompt({}), { key: 'LMB', label: 'Fit armor' });
  assert.ok(g.useArmor()); assert.deepEqual(actions.at(-1), { kind: 'fitArmor', x: 0, z: 0 });
  assert.ok(g.apply({ kind: 'fitArmor', x: 0, z: 0 }, 'guest', host)); // the guest stands far away: ignored
  assert.deepEqual(world.tileArmor, {});
  assert.ok(g.apply({ kind: 'fitArmor', x: 0, z: 0 }, 'host', host));
  assert.deepEqual(world.tileArmor, { '0,0': 1 }); assert.equal(host.count('armor'), 0);
  g.updateAim('armor', { point: { x: 0, z: 0 } });
  assert.equal(g.aimedArmor(), null, 'armored tiles are not offered again');
  assert.equal(g.prompt({}), null);
  assert.ok(g.apply({ kind: 'fitArmor', x: -1, z: 0 }, 'host', host));
  assert.match(emits.at(-1)[0].text, /Craft Foundation Armor/);
  g.updateAim('hammer', { point: { x: 0, z: 0 } }); assert.equal(g.aimedArmor(), null);
  g.dispose();
});

test('game.js: tileArmor is saved, cleaned, copied and sent to guests; new rafts are 2x2', () => {
  assert.match(gameSrc, /tileArmor:cleanTileArmor\(v\.tileArmor, tiles\)/, 'cleanWorld (saves + host snapshots)');
  assert.match(gameSrc, /tileArmor:cleanTileArmor\(w\.tileArmor, w\.tiles\)/, 'copyWorld');
  assert.match(gameSrc, /tileHp:world\.tileHp, tileArmor:world\.tileArmor/, 'hostState');
  assert.match(gameSrc, /tileHp:\{\}, tileArmor:\{\}/, 'newWorld');
  assert.match(gameSrc, /kind === 'armor' && spearRep\?\.useArmor\(\)/, 'LMB with armor');
  const m = gameSrc.match(/const STARTER_TILES = (\[.*?\]\]);/);
  assert.ok(m, 'STARTER_TILES');
  const tiles = JSON.parse(m[1]);
  assert.equal(tiles.length, 4);
  assert.ok(tiles.some(t => t[0] === 0 && t[1] === 0), 'tile 0,0 is the spawn fallback');
  const xs = new Set(tiles.map(t => t[0])), zs = new Set(tiles.map(t => t[1]));
  assert.equal(xs.size, 2); assert.equal(zs.size, 2);
  assert.match(gameSrc, /tiles:STARTER_TILES\.map/);
});
