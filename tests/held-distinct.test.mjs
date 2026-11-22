// Held items: every bag kind shows its own first-person model. Players saw the same generic bundle for most
// items; this fails if any kind falls back to it, or if two kinds end up with the same held mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const B = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const { ITEM_KINDS } = await import(new URL('inventory-state.js', base));
const { buildItemModel, holdFor } = await import(new URL('held-items.js' + B, base));
const { getModel } = await import(new URL('models.js' + B, base));
const { LOAD_RENAMES } = await import(new URL('items.js' + B, base));

// Kinds that may share a held mesh on purpose, each with its reason:
const SAME_ON_PURPOSE = [
  // The Glide Post and Glide Step are one zipline post built at two heights (3.4 m and 2.4 m, zipline.js POSTS),
  // exactly as on the raft and in their icons: same parts and colours, so only the fitted proportions differ.
  ['glidepost', 'glidestep'],
];
const allowed = (a, b) => SAME_ON_PURPOSE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// What the mesh looks like: geometry sizes plus material colours (two tins of different paint differ by colour).
function fingerprint(root) {
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const cols = [].concat(o.material).map((m) => m.color?.getHexString() ?? '-').join('/');
    parts.push(o.geometry.attributes.position.count + ':' + cols);
  });
  return parts.sort().join(' ');
}

// The game always hands the viewmodel models.js as its factory (game.js modelOf, display.js getModel); the
// junk, crops and coconut only have models there, so the test uses the same factory.
{
  const factory = (k) => getModel(k);
  test('every bag kind has its own held model', () => {
    const byKey = new Map(), byPrint = new Map();
    for (const kind of ITEM_KINDS) {
      const m = buildItemModel(T, kind, factory);
      const key = m.userData.heldKey;
      assert.ok(key, `${kind} has a heldKey`);
      assert.notEqual(key, 'bundle', `${kind} falls back to the generic cloth bundle`);
      let meshes = 0; m.traverse((o) => { if (o.isMesh) meshes++; });
      assert.ok(meshes > 0, `${kind} has meshes`);
      const s = m.userData.size;
      assert.ok(Math.max(s.x, s.y, s.z) < 1, `${kind} fits in a hand`);
      for (const [map, id] of [[byKey, key], [byPrint, fingerprint(m)]]) {
        const other = map.get(id);
        if (other && !allowed(other, kind)) assert.fail(`${kind} and ${other} show the same held mesh (${id.slice(0, 60)})`);
        map.set(id, kind);
      }
    }
  });
}

test('held models never carry lights, particles or sprites into the camera', () => {
  for (const kind of ITEM_KINDS) {
    buildItemModel(T, kind, (k) => getModel(k)).traverse((o) => {
      assert.ok(!o.isLight && !o.isPoints && !o.isSprite, `${kind}: ${o.type} ${o.name}`);
    });
  }
});

test('every bag kind has a hold pose for one hand', () => {
  for (const kind of ITEM_KINDS) assert.ok(['left', 'right'].includes(holdFor(kind).hand), kind);
  // renamed legacy kinds still resolve (old saves load them as their replacement)
  for (const k of Object.keys(LOAD_RENAMES)) assert.ok(buildItemModel(T, k), k);
});
