// Anchor as a crafted, placed item (Raft: Throwable Anchor). Rules (dist/anchor-rules.js), placement
// (build-rules.js edge-only), catalogue (items.js), model (anchor-model.js) and the game/sailing wiring.
// Run: node --test tests/anchor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('anchor-rules.js', base));
const { decorBlock, BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const { RECIPES, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEM_TEXT, categoryOf } = await import(new URL('craft-book.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { createAnchorModel, poseAnchor, ANCHOR_MODEL } = await import(new URL('anchor-model.js', base));
const { cleanSailing } = await import(new URL('sailing-core.js', base));
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');

const grid3 = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `expected ${b} got ${a}`);

test('catalogue: Anchor = 2 wood + 4 rope + 4 stone, placeable build item with icon, tip and book text', () => {
  const it = ITEMS.anchor;
  assert.equal(it.name, 'Anchor'); assert.equal(it.category, 'build'); assert.equal(it.placeable, true); assert.equal(it.tool, false);
  assert.deepEqual({ ...it.recipe.cost }, { wood: 2, rope: 4, stone: 4 }); assert.equal(it.recipe.station, null);
  assert.deepEqual({ ...RECIPES.anchor.cost }, { wood: 2, rope: 4, stone: 4 });
  assert.equal(ITEM_INFO.anchor.name, 'Anchor');
  assert.ok(PLACEABLE_IDS.includes('anchor')); assert.ok(BLOCK_RADII.anchor > 0);
  assert.match(it.tip, /edge/); assert.ok(ITEM_TEXT.anchor?.use);
  assert.equal(categoryOf('anchor'), 'navigation');
  assert.ok(typeof ITEM_ICONS.anchor === 'string' && ITEM_ICONS.anchor.includes('<'));
});

test('isEdgeTile / anchorCount', () => {
  const tiles = grid3();
  assert.equal(R.isEdgeTile(tiles, 0, 0), false);
  assert.equal(R.isEdgeTile(tiles, 1, 0), true); assert.equal(R.isEdgeTile(tiles, -1, -1), true);
  assert.equal(R.isEdgeTile(tiles, 5, 5), false); assert.equal(R.isEdgeTile(null, 0, 0), false);
  assert.equal(R.anchorCount([{ type: 'anchor', x: 1, z: 0 }, { type: 'bed', x: 0, z: 0 }, { type: 'anchor', x: -1, z: 0 }]), 2);
  assert.equal(R.anchorCount(undefined), 0);
});

test('anchor requirement: dropping needs an anchor on the raft, raising never does', () => {
  const none = [{ type: 'sail', x: 0, z: 0 }], one = [{ type: 'anchor', x: 1, z: 0 }];
  assert.equal(R.anchorBlock(none, 'anchor', false), 'Build an anchor');
  assert.equal(R.anchorBlock(none, 'toggleAnchor', false), 'Build an anchor');
  assert.equal(R.anchorBlock(none, 'toggleAnchor', true), '');
  assert.equal(R.anchorBlock(none, 'unanchor', true), '');
  assert.equal(R.anchorBlock(none, 'raise', false), '');
  assert.equal(R.anchorBlock(one, 'anchor', false), '');
  assert.equal(R.anchorBlock(undefined, 'anchor', false), 'Build an anchor');
});

test('placement: only on an edge tile; the arm faces open water nearest the player rotation', () => {
  const tiles = grid3();
  assert.equal(decorBlock(tiles, [], 0, 0, 'anchor'), 'rim'); assert.equal(BLOCK_TEXT.rim, 'Place it at the raft edge');
  assert.equal(decorBlock(tiles, [], 1, 0, 'anchor'), null);
  assert.equal(decorBlock(tiles, [], 0, 0, 'bench'), null, 'other decor anywhere');
  assert.equal(decorBlock(tiles, [], 0, 0), null, 'old call shape unchanged');
  assert.equal(decorBlock(tiles, [{ type: 'crate', x: 1, z: 0 }], 1, 0, 'anchor'), 'occupied');
  near(R.outwardRot(tiles, 0, 1, 0), 0);               // +z open
  near(R.outwardRot(tiles, 1, 0, 0), Math.PI / 2);     // +x open
  near(R.outwardRot(tiles, -1, 0, 0), 3 * Math.PI / 2); // -x open
  near(R.outwardRot(tiles, 0, -1, 0), Math.PI);        // -z open
  near(R.outwardRot(tiles, 1, 1, Math.PI / 2), Math.PI / 2); // corner: +x and +z open, pref picks +x
  near(R.outwardRot(tiles, 1, 1, 0), 0);
  near(R.outwardRot(tiles, 0, 0, 1), 0); // nothing open
});

test('migration: an anchored old save gets one anchor on a free edge tile; others are left alone', () => {
  const w = { tiles: grid3(), decor: [{ type: 'bench', x: -1, z: 1 }], sailing: cleanSailing({ anchored: true }) };
  assert.equal(R.migrateAnchor(w), 'placed');
  const a = w.decor.filter(d => d.type === 'anchor');
  assert.equal(a.length, 1); assert.deepEqual([a[0].x, a[0].z], [0, 1], 'old post spot: far +z, leftmost free');
  assert.equal(a[0].rot, undefined, 'faces +z (rot 0)');
  assert.equal(w.sailing.anchored, true, 'still anchored');
  assert.equal(R.migrateAnchor(w), null, 'idempotent');
  const free = { tiles: grid3(), decor: [], sailing: cleanSailing({ anchored: false }) };
  assert.equal(R.migrateAnchor(free), null); assert.equal(free.decor.length, 0, 'not anchored: craft your own');
  assert.equal(R.migrateAnchor({ tiles: grid3(), decor: [] }), null, 'no sailing slice');
  assert.equal(R.migrateAnchor(null), null);
  // every edge tile taken: the free middle tile still gets it
  const ring = grid3().filter(([x, z]) => x || z).map(([x, z]) => ({ type: 'crate', x, z }));
  const mid = { tiles: grid3(), decor: ring.slice(), sailing: cleanSailing({ anchored: true }) };
  assert.equal(R.migrateAnchor(mid), 'placed'); assert.ok(mid.decor.some(d => d.type === 'anchor' && d.x === 0 && d.z === 0));
  // no free tile at all: into the host bag, raft raised
  const full = { tiles: [[0, 0]], decor: [{ type: 'crate', x: 0, z: 0 }], sailing: cleanSailing({ anchored: true }), hostInventory: { slots: [{ kind: 'wood', count: 1 }, null], selected: 0 } };
  assert.equal(R.migrateAnchor(full), 'bag');
  assert.deepEqual(full.hostInventory.slots[1], { kind: 'anchor', count: 1 }); assert.equal(full.sailing.anchored, false);
});

test('model: shared geometry, no shadows, rope and hook follow the drop amount', () => {
  const a = createAnchorModel(T), b = createAnchorModel(T);
  assert.equal(a.userData.craftType, 'anchor');
  assert.equal(a.children.length, 4);
  for (let i = 0; i < 4; i++) { assert.equal(a.children[i].geometry, b.children[i].geometry); assert.equal(a.children[i].castShadow, false); }
  for (const c of a.children) { assert.equal(c.geometry.userData.shared, true); assert.equal(c.material.userData.shared, true); }
  a.children[0].geometry.dispose(); a.children[0].material.dispose(); // rebuildRaft / ghost disposal is a no-op
  assert.ok(b.children[0].geometry.attributes.position.count > 0);
  const rope = a.getObjectByName('anchorRope'), hook = a.getObjectByName('anchorHook');
  poseAnchor(a, 0); near(rope.scale.y, ANCHOR_MODEL.ROPE_UP); near(hook.position.y, ANCHOR_MODEL.ARM_Y - ANCHOR_MODEL.ROPE_UP);
  poseAnchor(a, 1); near(rope.scale.y, ANCHOR_MODEL.ROPE_DOWN); assert.ok(hook.position.y < -2, 'hook under the waterline');
  assert.ok(ANCHOR_MODEL.ARM_Z > 1, 'rope hangs past the tile edge');
});

test('wiring: sailing refuses to anchor without one, raises when the last is gone; game migrates own saves only', () => {
  const sw = src('sailing-world.js'), g = src('game.js');
  assert.ok(sw.includes('anchorBlock(ctx.getWorld()?.decor, a.op, s.anchored)'));
  assert.ok(sw.includes('state.anchored && anchorCount(ctx.getWorld()?.decor) === 0) state.anchored = false'));
  assert.ok(!sw.includes('anchorPos'), 'the free anchor post is gone');
  assert.ok(g.includes("if (!fromNet) migrateAnchor(out);"));
  assert.ok(g.includes('cleanWorld(data.world, true, true)'), 'a guest never migrates the host world');
  assert.ok(g.includes("a.kind === 'sail' && a.op === 'takeAnchor'"));
  assert.ok(g.includes("d.type === 'anchor' ? createAnchorModel(T)"));
  assert.ok(src('live.js').includes("'anchor-model.js', 'anchor-rules.js'"));
});
