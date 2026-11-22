// Held items must never retune materials that placed world copies share: hands.js makes held materials
// transparent/NoBlending for the viewmodel pass, which on a module-cached world material would change every
// placed map table, recycler, smelter ... on the raft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const B = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const { ITEM_KINDS } = await import(new URL('inventory-state.js', base));
const { createHands } = await import(new URL('hands.js' + B, base));
const { getModel } = await import(new URL('models.js' + B, base));
const { buildHeldModel } = await import(new URL('held-models.js' + B, base));

const matsOf = (o) => { const s = new Set(); o?.traverse((c) => { if (c.isMesh) [].concat(c.material).forEach((m) => s.add(m)); }); return s; };
const snap = (m) => `${m.transparent}:${m.blending}:${m.depthWrite}:${m.depthTest}`;

test('mounting every held model leaves world-shared materials untouched', () => {
  // a world copy of each kind built before the hands mount theirs
  const world = new Map();
  for (const kind of ITEM_KINDS) for (const m of matsOf(buildHeldModel(T, kind)?.model)) world.set(m, [kind, snap(m)]);
  const hands = createHands(T, { modelFactory: (k) => getModel(k) });
  hands.preload(ITEM_KINDS);
  const changed = [...world].filter(([m, [, s]]) => snap(m) !== s).map(([, [k]]) => k);
  assert.deepEqual([...new Set(changed)], []);
  hands.dispose();
});
