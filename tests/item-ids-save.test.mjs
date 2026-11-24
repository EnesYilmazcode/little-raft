// Save and co-op safety for item ids: old saves, renamed and legacy ids, ids from a newer build and junk all load
// without a crash, map where an alias exists and drop otherwise. Also checks the Raft crafting tab data
// (items.js CRAFT_TABS / craftTabOf) covers every recipe.
// Run: node --test tests/item-ids-save.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const I = await import(new URL('items.js', base));
const { Bag, ITEM_INFO, RECIPES, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { Progression } = await import(new URL('progression.js', base));
const { cleanDecor } = await import(new URL('placement.js', base));
const SR = await import(new URL('storage-research.js', base));
const DB = await import(new URL('drop-box-core.js', base));
const DP = await import(new URL('decor-pickup.js', base));
const { HELD, LEGACY_HELD, heldIndex } = await import(new URL('coop.js', base));

const NEW_IDS = ['metalaxe', 'machete', 'headlamp']; // added for Raft parity (docs/loop/raft-item-parity.md)
// items pass 2: materials, titanium tier and cooking pot meals
const NEW_IDS_2 = ['titaniumore', 'titaniumingot', 'vinegoo', 'circuitboard', 'titaniumaxe', 'titaniumsword', 'meal_gardensoup', 'meal_hotpot', 'meal_sharkroast'];
const ALL_NEW = [...NEW_IDS, ...NEW_IDS_2];
const FUTURE = ['titaniumhook', 'emptybottle', 'canteen', 'wetbrick']; // ids a newer build might send
const JUNK = [42, null, undefined, '', '__proto__', 'constructor', 'toString', { kind: 'wood' }, ['wood']];

// The way game.js snapBag loads a bag: migrate, then Bag, then salvage.
const load = (s) => { let m = s; try { m = I.migrateSnapshot(s, ITEM_INFO) ?? s; } catch { /* keep raw */ } try { return new Bag(m); } catch { return Bag.salvage(m); } };
const slotsOf = (list) => { const s = new Array(SLOT_COUNT).fill(null); list.forEach((e, i) => { s[i] = e; }); return s; };
const kinds = (bag) => bag.slots.filter(Boolean).map((s) => s.kind);

test('new ids are real bag kinds, do not shadow aliases, and old saves simply lack them', () => {
  for (const id of ALL_NEW) {
    assert.ok(ITEM_INFO[id], id);
    assert.ok(!Object.hasOwn(I.LEGACY_ALIASES, id), `${id} is not an alias key`);
    assert.ok(!Object.values(I.LEGACY_ALIASES).includes(id) || I.isItem(id), `${id} alias target is an item`);
  }
  for (const [a, k] of Object.entries(I.LEGACY_ALIASES)) assert.ok(!ITEM_INFO[a], `alias ${a} -> ${k} shadows a bag kind`);
  const old = load({ slots: slotsOf([{ kind: 'hook', count: 1, durability: 80 }, { kind: 'wood', count: 12 }, { kind: 'axe', count: 1, durability: 50 }]), selected: 1 });
  assert.deepEqual(kinds(old), ['hook', 'wood', 'axe']);
  assert.equal(old.selectedIndex, 1);
});

test('bag snapshots: new, legacy, renamed, future and junk ids load without a crash', () => {
  const raw = [
    { kind: 'metalaxe', count: 1, durability: 40 }, { kind: 'machete', count: 1 }, { kind: 'headlamp', count: 1 },
    { kind: 'plank', count: 5 }, { kind: 'scraphook', count: 1, durability: 10 }, { kind: 'Metal_Axe', count: 1 },
    { kind: 'water', count: 2 }, ...FUTURE.map((kind) => ({ kind, count: 4 })), ...JUNK.map((kind) => ({ kind, count: 1 })),
    'junk', 7, null,
  ];
  const bag = load({ slots: slotsOf(raw), selected: 0 });
  const got = kinds(bag);
  assert.deepEqual(got, ['metalaxe', 'machete', 'headlamp', 'wood', 'metalhook', 'metalaxe', 'freshcup']);
  const m = bag.slots[0];
  assert.equal(m.durability, 40, 'tool durability kept');
  assert.equal(bag.slots[1].durability, 100, 'missing durability filled');
  assert.equal(load({ slots: slotsOf([{ kind: 'headlamp', count: 3 }]), selected: 0 }).count('headlamp'), 3, 'gear stacks to 1; extras take free slots');
  assert.ok(got.every((k) => ITEM_INFO[k]), 'only known kinds survive');
  // round trip
  assert.deepEqual(kinds(load(bag.snapshot())), got);
  // a wrong-length snapshot (an older or foreign build) still loads
  const short = load({ slots: [{ kind: 'machete', count: 1 }, { kind: 'titaniumhook', count: 1 }], selected: 0 });
  assert.deepEqual(kinds(short), ['machete']);
  for (const bad of [null, 'x', 5, [], { slots: 'no' }]) assert.doesNotThrow(() => load(bad), String(bad));
});

test('progression: unknown ids are dropped, new ids keep their research', () => {
  const p = new Progression({
    discovered: ['wood', 'metalaxe', 'titaniumhook', 'plank', 42, null],
    researched: ['metalingot', 'axe', 'metalspear', 'emptybottle', '__proto__'],
    learned: ['machete', 'canteen', 'constructor'],
    stations: ['grill', 'electricsmelter'],
  });
  const s = p.snapshot();
  assert.deepEqual(s.discovered, ['metalaxe', 'wood']);
  assert.deepEqual(s.researched, ['axe', 'metalingot', 'metalspear']);
  assert.ok(s.learned.includes('machete') && s.learned.includes('metalaxe'), 'research unlocks the new tools');
  assert.ok(!s.learned.includes('canteen') && !s.learned.includes('constructor'));
  assert.deepEqual(s.stations, ['grill']);
  for (const bad of [null, 'x', [], { discovered: 'wood' }]) assert.doesNotThrow(() => new Progression(bad));
});

test('placed decor: unknown types drop without touching the rest', () => {
  const types = ['crate', 'grill', 'bench'], hasTile = () => true, used = new Set();
  const out = [{ type: 'crate', x: 1, z: 0 }, { type: 'largecrate', x: 2, z: 0 }, { type: 'headlamp', x: 3, z: 0 }, { type: '__proto__', x: 4, z: 0 }, null]
    .map((d) => cleanDecor(d, types, hasTile, used));
  assert.equal(out[0]?.type, 'crate');
  assert.deepEqual(out.slice(1), [null, null, null, null]);
});

test('world.ext slices: chests, drop boxes and pickup loot keep known kinds and drop the rest', () => {
  const chest = [{ kind: 'machete', count: 1, durability: 30 }, { kind: 'headlamp', count: 1 }, { kind: 'titaniumhook', count: 2 }, { kind: 'plank', count: 3 }, { kind: '__proto__', count: 1 }, 'x'];
  const st = SR.cleanSlice({ chests: { '1,0': chest }, seen: ['metalaxe', 'emptybottle'], learned: ['headlamp', 'canteen'] });
  const c = st.chests['1,0'];
  assert.equal(c[0].kind, 'machete'); assert.equal(c[0].durability, 30);
  assert.equal(c[1].kind, 'headlamp');
  assert.deepEqual(c.slice(2).filter(Boolean), [], 'unknown kinds in a chest are dropped (no alias step there)');
  assert.ok(Array.isArray(st.seen) && Array.isArray(st.learned));
  const drops = DB.cleanSlice({ n: 3, boxes: [{ id: 1, x: 0, z: 0, items: [{ kind: 'metalaxe', count: 1, durability: 50 }, { kind: 'emptybottle', count: 2 }] }, { id: 2, x: 1, z: 1, items: [{ kind: 'wetbrick', count: 1 }] }] });
  assert.equal(drops.boxes.length, 1);
  assert.deepEqual(drops.boxes[0].items.map((s) => s.kind), ['metalaxe']);
  assert.deepEqual(DP.normLoot([['headlamp', 1], ['titaniumhook', 1], ['machete', 1], [null, 1], 'x']), [['headlamp', 1], ['machete', 1]]);
});

test('co-op: a guest that does not know a kind never crashes', () => {
  // Host snapshots go through the same load path; a kind this build lacks is dropped, the rest of the bag stays.
  const fromNewerHost = load({ slots: slotsOf([{ kind: 'titaniumhook', count: 1, durability: 90 }, { kind: 'rope', count: 4 }, { kind: 'machete', count: 1 }]), selected: 2 });
  assert.deepEqual(kinds(fromNewerHost), ['rope', 'machete']);
  // Counts-style stock (old hosts) ignores unknown kinds.
  const stock = Bag.fromCounts({ rope: 2, titaniumhook: 1, headlamp: 1, metalaxe: 1 }, { tools: ['hook', 'titaniumhook'] });
  assert.ok(stock.count('rope') === 2 && stock.count('headlamp') === 1 && stock.count('metalaxe') === 1);
  assert.equal(stock.count('titaniumhook'), 0);
  // Held kinds travel as an index into HELD. To an older peer the new tools travel as their role (axe, spear);
  // a peer whose hello says it knows them gets the real kind; unknown kinds travel as nothing.
  assert.equal(I.toolRole('metalaxe'), 'axe'); assert.equal(I.toolRole('machete'), 'spear');
  assert.ok(HELD.includes('axe') && HELD.includes('spear'));
  assert.equal(HELD[999] ?? null, null);
  assert.equal(heldIndex('headlamp', HELD.length), 0, 'unknown held kind is sent as nothing');
  assert.equal(heldIndex(null, HELD.length), 0);
});

test('co-op: new held kinds reach new peers as themselves and old peers as their role', () => {
  // HELD is append only: the first LEGACY_HELD entries are what older builds decode.
  const OLD = [null, 'hook', 'hammer', 'fishingrod', 'wood', 'leaf', 'scrap', 'plastic', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate',
    'drum', 'pipes', 'bells', 'spade', 'finder', 'spear', 'metalspear', 'glidehandle', 'spyglass', 'paddle', 'axe'];
  assert.equal(LEGACY_HELD, OLD.length);
  assert.deepEqual(HELD.slice(0, LEGACY_HELD), OLD);
  for (const k of ['metalaxe', 'titaniumaxe', 'machete', 'titaniumsword']) {
    const i = HELD.indexOf(k);
    assert.ok(i >= LEGACY_HELD, k);
    assert.equal(heldIndex(k, HELD.length), i, `${k} to a new peer`);
    const old = heldIndex(k); // no hello `held` field: an older peer
    assert.ok(old > 0 && old < LEGACY_HELD, `${k} to an old peer`);
    assert.equal(HELD[old], I.toolRole(k));
    assert.equal(OLD[old] ?? null, I.toolRole(k), 'what the old peer decodes');
  }
  assert.equal(HELD[heldIndex('metalhook')], 'hook');
  // an older peer decoding a newer index (should one arrive) gets nothing, never a throw
  assert.equal(OLD[HELD.length + 5] ?? null, null);
  for (const k of OLD) assert.equal(heldIndex(k), Math.max(0, OLD.indexOf(k)), `${k} unchanged on the wire`);
  for (const bad of [undefined, 1.5, 'x', {}, -1, 0]) assert.equal(heldIndex('metalaxe', bad), HELD.indexOf('axe'));
});

test('crafting tabs: every recipe and catalogue recipe has one of Raft’s 8 tabs', () => {
  assert.deepEqual([...I.CRAFT_TABS], ['food', 'other', 'tools', 'weapons', 'equipment', 'resources', 'navigation', 'decorations']);
  assert.ok(Object.isFrozen(I.CRAFT_TABS));
  const missing = [];
  for (const id of Object.keys(RECIPES)) if (!I.CRAFT_TABS.includes(I.craftTabOf(id))) missing.push(id);
  for (const id of I.ITEM_IDS) if (I.ITEMS[id].recipe && !I.CRAFT_TABS.includes(I.craftTabOf(id))) missing.push(id);
  assert.deepEqual(missing, []);
  for (const id of I.ITEM_IDS) assert.equal(I.ITEMS[id].tab, I.craftTabOf(id), `${id} tab field matches the helper`);
  assert.equal(I.craftTabOf('metalaxe'), 'tools'); assert.equal(I.craftTabOf('machete'), 'weapons');
  assert.equal(I.craftTabOf('headlamp'), 'equipment'); assert.equal(I.craftTabOf('sail'), 'navigation');
  for (const bad of ['wood', 'nope', '', '__proto__', 'constructor', null, undefined, 3, {}]) assert.equal(I.craftTabOf(bad), undefined, String(bad));
});

test('new items: hand recipes, unlocks and text are in place', () => {
  assert.deepEqual({ ...I.ITEMS.metalaxe.recipe.cost }, { wood: 4, metalingot: 3, rope: 2, bolt: 1 });
  assert.deepEqual({ ...I.ITEMS.machete.recipe.cost }, { metalingot: 3, bolt: 2, wood: 3, rope: 2 });
  assert.deepEqual({ ...RECIPES.headlamp.cost }, { battery: 1, rope: 2, scrap: 2 });
  assert.equal(I.SPEAR_DAMAGE.machete, 15);
  assert.ok(I.wearPerUse('metalaxe') < I.wearPerUse('axe'), 'metal axe outlasts the stone one');
  assert.ok(I.repairCost('metalaxe') && I.repairCost('machete'));
  for (const id of NEW_IDS) assert.ok(I.ITEM_TEXT_EXTRA[id]?.desc && I.ITEM_TEXT_EXTRA[id]?.use, id);
  assert.equal(I.LEGACY_ALIASES.metal_axe, 'metalaxe');
});

test('items pass 2: every new id loads, saves and round-trips; every source and text row is in place', async () => {
  const P = await import(new URL('cookpot-core.js', base));
  const TR = await import(new URL('trader-core.js', base));
  const TS = await import(new URL('treasure-rules.js', base));
  const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
  // a bag with one of each new kind survives a save and load unchanged, tools keep their durability
  const raw = NEW_IDS_2.map((kind) => ({ kind, count: 1, ...(I.ITEMS[kind]?.tool ? { durability: 55 } : {}) }));
  const bag = load({ slots: slotsOf(raw), selected: 0 });
  assert.deepEqual(kinds(bag), NEW_IDS_2);
  assert.deepEqual(kinds(load(JSON.parse(JSON.stringify(bag.snapshot())))), NEW_IDS_2);
  assert.equal(bag.slots[NEW_IDS_2.indexOf('titaniumaxe')].durability, 55);
  // progression keeps research on the new kinds; chests and drop boxes keep them
  const p = new Progression({ discovered: ['titaniumore'], researched: ['titaniumingot', 'metalaxe', 'machete', 'copperingot', 'vinegoo'], learned: [], stations: [] });
  for (const id of ['titaniumaxe', 'titaniumsword', 'circuitboard']) assert.ok(p.snapshot().learned.includes(id), `${id} learned`);
  const st = SR.cleanSlice({ chests: { '1,0': [{ kind: 'titaniumsword', count: 1, durability: 20 }, { kind: 'meal_hotpot', count: 3 }] } });
  assert.deepEqual(st.chests['1,0'].filter(Boolean).map((s) => s.kind), ['titaniumsword', 'meal_hotpot']);
  // each kind: text, an icon or sprite, a tab (crafted and station-made kinds), and a source hint unless hand crafted
  for (const id of NEW_IDS_2) {
    assert.ok(I.ITEM_TEXT_EXTRA[id]?.desc && I.ITEM_TEXT_EXTRA[id]?.use, `${id} text`);
    assert.ok(ITEM_ICONS[id] || ITEM_INFO[id].icon === 'icon-meal', `${id} icon`);
    if (id !== 'titaniumore') assert.ok(I.CRAFT_TABS.includes(I.craftTabOf(id)), `${id} tab`);
    const r = I.ITEMS[id]?.recipe;
    if (!r || r.station) assert.ok(I.ITEM_SOURCE_EXTRA[id]?.tag && I.ITEM_SOURCE_EXTRA[id]?.how, `${id} source`);
  }
  // recipes and stations
  assert.equal(I.stationRecipeFor('smelter', 'titaniumore')?.id, 'titaniumingot');
  assert.equal(I.stationRecipeFor('smelter', 'seaweed')?.id, 'vinegoo');
  assert.ok(I.fuelValue('seaweed') > 0, 'seaweed is still a fuel');
  assert.deepEqual({ ...RECIPES.circuitboard.cost }, { copperingot: 2, plastic: 5, vinegoo: 1 });
  assert.equal(I.toolRole('titaniumaxe'), 'axe'); assert.equal(I.toolRole('titaniumsword'), 'spear');
  assert.ok(I.wearPerUse('titaniumaxe') < I.wearPerUse('metalaxe'));
  assert.ok(I.SPEAR_DAMAGE.titaniumsword > I.SPEAR_DAMAGE.machete);
  assert.ok(I.repairCost('titaniumaxe') && I.repairCost('titaniumsword'));
  assert.equal(P.match(['potato', 'freshcup', 'beet']), 'meal_gardensoup');
  assert.equal(P.match(['fish', 'potato', 'beet']), 'meal_hotpot');
  assert.equal(P.match(['sharkmeat', 'beet', 'potato']), 'meal_sharkroast');
  for (const m of ['meal_gardensoup', 'meal_hotpot', 'meal_sharkroast']) assert.equal(P.MEALS[m].name, ITEM_INFO[m].name, m);
  // titanium ore sources: barrels, buried bundles and traders
  assert.ok(I.BARREL_LOOT.some((e) => e.kind === 'titaniumore' && e.pool === 'treasure'));
  assert.ok(TR.POOL.some((d) => d.get.titaniumore === 1));
  let dug = 0; for (let s = 0; s < 400 && !dug; s++) for (const [k] of TS.lootForSpot(s, 0, 'bundle')) if (k === 'titaniumore') dug++;
  assert.ok(dug > 0, 'buried bundles can hold titanium ore');
  // ids are not alias keys; in co-op the titanium tools travel as their role to older peers, so they see an axe or a spear
  for (const id of NEW_IDS_2) assert.ok(!Object.hasOwn(I.LEGACY_ALIASES, id), id);
  assert.equal(HELD[heldIndex('titaniumaxe')], 'axe'); assert.equal(HELD[heldIndex('titaniumsword')], 'spear');
});
