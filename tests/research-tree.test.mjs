// The one research tree (dist/research-tree.js + progression.js + progression-hooks.js): Raft's start set,
// research that uses up one material, tier-1 Collection Net and Simple Bed, the old Tinker's Desk as an
// alias, retired (invented) recipes hidden but still loadable, and old saves keeping what they learned.
// Run: node --test tests/research-tree.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const RT = await import(new URL('research-tree.js', base));
const { Progression, canCraft, craft } = await import(new URL('progression.js', base));
const { Bag, RECIPES, ITEM_INFO, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, migrateSnapshot } = await import(new URL('items.js', base));
const H = await import(new URL('progression-hooks.js', base));
const { CATALOG, RETIRED_RECIPES } = RT;

const DEBRIS = new Set(['wood', 'leaf', 'plastic', 'scrap']);
// Raft 1.0 start set, in our ids (docs/loop/raft-progression.md, stage 0).
const RAFT_START = ['rope', 'hook', 'hammer', 'researchtable', 'spear', 'cup', 'purifier', 'grill', 'paddle', 'fishingrod', 'crate', 'nail'];

function fakeStorage() {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  return m;
}
// decor is placed after attach (a placed piece at attach time reads as an old pre-progression raft).
function fakeGame({ decor = [], pastLearned = null } = {}) {
  const world = { tiles: [[0, 0], [1, 0], [0, 1]], decor: [], items: [], collected: 0 };
  world.place = () => { world.decor.push(...decor); };
  const bags = { host: new Bag(), guest: new Bag() }, emits = [];
  const ctx = { T: null, role: () => 'solo', ready: () => false, running: () => false, world: () => world, bag: (a) => bags[a],
    localBag: () => bags.host, action() {}, emit: (e, to) => emits.push({ e, to }), notice() {}, pose: () => ({ x: 0, z: 0, yaw: 0 }), pastLearned: () => pastLearned };
  return { world, bags, emits, ctx };
}
const fill = (bag, counts) => { for (const [k, n] of Object.entries(counts)) assert.equal(bag.add(k, n), 0, k); };

test('fresh game: the Raft start set is known and craftable from floating debris alone', () => {
  const p = new Progression(null, { items: CATALOG });
  for (const id of RAFT_START) {
    assert.ok(RECIPES[id], `${id} is a hand recipe`);
    assert.equal(p.isUnlocked(id), true, `${id} is known from minute one`);
  }
  // Every start recipe costs debris or things made from debris (rope from leaves, nails from scrap).
  const made = new Set([...DEBRIS, 'rope', 'nail']);
  for (const id of RT.startRecipes()) for (const k of Object.keys(RECIPES[id].cost)) assert.ok(made.has(k) || id === 'shellwreath', `${id} needs ${k}`);
  // A bag of hooked debris crafts the survival kit: drink (cup + purifier), cook (grill), build (hammer), research (table).
  const bag = new Bag(); fill(bag, { wood: 40, leaf: 20, plastic: 12, scrap: 8 });
  for (const id of ['rope', 'rope', 'rope', 'rope', 'rope', 'cup', 'purifier', 'hammer', 'grill', 'researchtable']) {
    const r = craft(bag, id, p); assert.ok(r.ok, `${id}: ${r.reason}`);
  }
  assert.equal(canCraft(bag, 'net', p).locked, true, 'the net waits for research');
});

test('fresh game: locked recipes stay visible in the craft panel and say what to research', () => {
  fakeStorage();
  const g = fakeGame(), h = H.attachProgression(g.ctx);
  assert.equal(h.recipeGate('rope'), null);
  assert.deepEqual(h.recipeGate('net'), { locked: true, reason: 'Research Plank, Scrap and Nail at the Research Table' });
  assert.deepEqual(h.recipeGate('bed'), { locked: true, reason: 'Research Palm Leaf, Plank, Plastic and Nail at the Research Table' });
  let hidden = 0;
  for (const id of Object.keys(RECIPES)) {
    const gate = h.recipeGate(id);
    if (gate?.hidden) { hidden++; assert.ok(RT.isRetired(id), `${id} hidden but not retired`); }
    else if (gate) assert.ok(gate.locked && /\S/.test(gate.reason), id);
  }
  assert.equal(hidden, RETIRED_RECIPES.filter((id) => RECIPES[id]).length);
  h.dispose();
});

test('research: Collection Net and Simple Bed unlock from tier-1 debris research, each study uses up one', () => {
  fakeStorage();
  const g = fakeGame({ decor: [{ type: 'researchtable', x: 0, z: 0 }] }), h = H.attachProgression(g.ctx);
  g.world.place(); h.tick(0.6); // places the table, notes the bag
  fill(g.bags.host, { wood: 3, scrap: 1, nail: 3, leaf: 1, plastic: 1, fish: 1 });
  const study = (k) => h.apply({ kind: 'prog:research', item: k }, 'host');
  study('wood'); study('scrap');
  assert.equal(h.progression('host').isUnlocked('net'), false);
  study('nail');
  assert.equal(h.progression('host').isUnlocked('net'), true);
  assert.equal(h.recipeGate('net'), null);
  assert.deepEqual({ wood: g.bags.host.count('wood'), scrap: g.bags.host.count('scrap'), nail: g.bags.host.count('nail') }, { wood: 2, scrap: 0, nail: 2 });
  assert.ok(g.emits.some(({ e }) => /New recipe.*Collection Net/.test(e.text)));
  study('leaf'); study('plastic');
  assert.equal(h.progression('host').isUnlocked('bed'), true);
  assert.equal(h.apply({ kind: 'craft', recipe: 'bed' }, 'host'), false, 'the host lets the craft through');
  // research twice or something useless: nothing is used up
  study('wood');
  assert.equal(g.bags.host.count('wood'), 2);
  study('fish');
  assert.equal(g.bags.host.count('fish'), 1, 'fish teaches no blueprint: it is not used up for nothing');
  assert.ok(g.emits.some(({ e }) => /does not teach anything new/.test(e.text)));
  h.dispose();
});

test('research needs a placed table; the old Tinker’s Desk counts as one and loads as one', () => {
  fakeStorage();
  const none = fakeGame(), a = H.attachProgression(none.ctx);
  fill(none.bags.host, { wood: 1 });
  a.apply({ kind: 'prog:research', item: 'wood' }, 'host');
  assert.equal(none.bags.host.count('wood'), 1, 'no table: nothing happens');
  assert.equal(a.progression('host').researched.has('wood'), false);
  a.dispose();

  fakeStorage();
  const desk = fakeGame({ decor: [{ type: 'research', x: 0, z: 0 }] }), b = H.attachProgression(desk.ctx);
  desk.world.place(); b.tick(0.6);
  assert.ok(b.progression('host').stations.has('researchtable'), 'a placed desk is a Research Table');
  fill(desk.bags.host, { wood: 1 });
  b.apply({ kind: 'prog:research', item: 'wood' }, 'host');
  assert.ok(b.progression('host').researched.has('wood'));
  b.dispose();
  // desk items in a saved bag load as Research Tables; the desk recipe itself is retired
  const bag = new Bag(migrateSnapshot({ slots: [{ kind: 'research', count: 1 }], selected: 0 }, ITEM_INFO));
  assert.equal(bag.count('researchtable'), 1);
  assert.ok(RT.isRetired('research') && RT.isTable('research') && RT.isTable('researchtable'));
  assert.equal(ITEM_INFO.research.name, 'Research Table');
});

test('retired (invented) recipes are gone from crafting but their items still load and place', () => {
  const p = new Progression({ learned: ['camera', 'kiln', 'gametable'] }, { items: CATALOG });
  for (const id of RETIRED_RECIPES) {
    assert.ok(CATALOG[id], id);
    assert.equal(p.isUnlocked(id), false, `${id} never unlocks, even learned in an old save`);
    assert.ok(!p.nextGoals(999).includes(id) && !p.blueprints().some((b) => b.id === id), id);
  }
  // a save holding them still loads, unchanged
  const kinds = ['kiln', 'gametable', 'stormrod', 'chime', 'camera', 'spyglass', 'fishtrap', 'maptable'];
  const slots = new Array(SLOT_COUNT).fill(null); kinds.forEach((k, i) => { slots[i] = { kind: k, count: 1 }; });
  const bag = new Bag(migrateSnapshot({ slots, selected: 0 }, ITEM_INFO));
  for (const k of kinds) assert.equal(bag.count(k), 1, k);
  // the host refuses a stale craft from an old client
  fakeStorage();
  const g = fakeGame(), h = H.attachProgression(g.ctx);
  assert.equal(h.apply({ kind: 'craft', recipe: 'kiln' }, 'host'), true);
  assert.ok(g.emits.some(({ e }) => /no longer made/.test(e.text)));
  h.dispose();
});

test('content-items.js has one definition per recipe and the Raft counts for net and bed', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('content-items.js', base), 'utf8');
  const body = src.slice(src.indexOf('export const CONTENT_RECIPES'), src.indexOf('export const CONTENT_DECOR'));
  const ids = [...body.matchAll(/^\s+(\w+):\s/gm)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate recipe keys');
  assert.deepEqual({ ...RECIPES.net.cost }, { wood: 6, rope: 8, nail: 2 });
  assert.deepEqual({ ...RECIPES.bed.cost }, { leaf: 10, wood: 6, plastic: 4, nail: 3 });
  assert.deepEqual({ ...RECIPES.researchtable.cost }, { wood: 14, scrap: 2 });
  assert.deepEqual({ ...RECIPES.smelter.cost }, { wood: 4, brick: 6, scrap: 4, nail: 6 });
});

test('every research set names a material a player can hold, and every live recipe is reachable', () => {
  const have = new Set([...DEBRIS, 'sand', 'clay', 'stone', 'metalore', 'copperore', 'seaweed', 'flowerseed', 'feather', 'puffegg', 'shell', 'seed', 'fish', 'beet', 'potato', 'sharkmeat', 'berries', 'oldboot', 'tincan', 'seajar']);
  const researched = new Set(), stations = new Set();
  const live = Object.keys(RECIPES).filter((id) => !RT.isRetired(id));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of Object.keys(CATALOG)) {
      const e = CATALOG[id], u = e.unlock;
      if (u.type === 'research') for (const k of u.items) if (have.has(k) && !researched.has(k)) { researched.add(k); changed = true; }
      const open = u.type === 'start' || (u.type === 'research' && u.items.every((k) => researched.has(k))) || (u.type === 'station' && stations.has(u.station)) || (u.type === 'discover' && u.items.every((k) => have.has(k)));
      if (!open || !e.recipe || have.has(id)) continue;
      if (e.recipe.station && !stations.has(e.recipe.station)) continue;
      if (Object.keys(e.recipe.cost).every((k) => have.has(k))) {
        have.add(id); if (ITEMS[id]?.category === 'station') stations.add(id); changed = true;
        const out = RECIPES[id]?.output.kind; if (out) have.add(out);
      }
    }
  }
  assert.deepEqual(live.filter((id) => !have.has(id) && id !== 'paint_sunshell'), [], 'unreachable live recipes'); // palm seed is not dropped in play (as before)
});

test('old saves: recipes learned at the old desk stay learned; New Game resets research', () => {
  fakeStorage();
  const g = fakeGame({ pastLearned: ['motor', 'kiln', 'nope'] }), h = H.attachProgression(g.ctx);
  h.tick(0.6);
  assert.equal(h.progression('host').isUnlocked('motor'), true, 'desk-learned motor kept');
  assert.equal(h.progression('guest').isUnlocked('motor'), true);
  assert.equal(h.progression('host').isUnlocked('kiln'), false, 'retired stays retired');
  h.reset();
  assert.equal(h.progression('host').isUnlocked('motor'), false, 'a fresh raft starts a fresh tree');
  assert.equal(h.progression('host').isUnlocked('cup'), true);
  h.dispose();
});

test('guest mirror: the host snapshot is rebuilt only when it changes', () => {
  fakeStorage();
  const g = fakeGame();
  g.ctx.role = () => 'guest'; g.ctx.ready = () => true;
  const h = H.attachProgression(g.ctx);
  const snap = { discovered: [], researched: ['wood', 'scrap', 'nail'], learned: ['net'], stations: ['researchtable'] };
  h.effect({ kind: 'prog:sync', prog: snap, stations: {} });
  const first = h.progression();
  h.effect({ kind: 'prog:sync', prog: JSON.parse(JSON.stringify(snap)), stations: {} });
  assert.equal(h.progression(), first, 'same snapshot, same object (gate cache kept)');
  assert.equal(h.recipeGate('net'), null);
  h.dispose();
});

const SR = await import(new URL('storage-research.js', base));

test('New Game: a fresh raft resets research, and the reset is saved', async () => {
  const store = fakeStorage();
  const g = fakeGame({ decor: [{ type: 'researchtable', x: 0, z: 0 }] }), h = H.attachProgression(g.ctx);
  g.world.place(); h.tick(0.6);
  fill(g.bags.host, { wood: 1 });
  h.apply({ kind: 'prog:research', item: 'wood' }, 'host');
  h.save();
  assert.deepEqual(JSON.parse(store.get(H.PROGRESSION_KEY)).host.researched, ['wood']);
  h.reset();
  const saved = JSON.parse(store.get(H.PROGRESSION_KEY));
  assert.deepEqual(saved.host, { discovered: [], researched: [], learned: [], stations: [] });
  h.dispose();
  // game.js resets on both paths: the in-game New Game and a page that starts without a stored raft (title New Game reloads)
  const src = (await import('node:fs')).readFileSync(new URL('game.js', base), 'utf8');
  assert.match(src, /if \(freshSave && !X\?\.world\) prog\.reset\(\);/);
  assert.match(src, /function newGame\(\) \{[\s\S]{0,900}prog\?\.reset\(\)/);
});

test('old saves: only content recipes the old desk build offered are adopted, never items.js ones', () => {
  // the desk list may name items.js recipes (it was computed over every recipe): those stay with progression.js
  fakeStorage();
  const g = fakeGame({ pastLearned: ['net', 'smelter', 'sail', 'antenna', 'nestbox'] }), h = H.attachProgression(g.ctx);
  h.tick(0.6);
  const p = h.progression('host');
  for (const id of ['net', 'smelter', 'sail']) assert.equal(p.isUnlocked(id), false, `${id} (items.js) not adopted`);
  for (const id of ['antenna', 'nestbox']) assert.equal(p.isUnlocked(id), true, `${id} kept`);
  h.dispose();
  // what the storage slice reports
  const fresh = SR.pastOffered(undefined, SR.stateFrom(undefined, 'save', { tiles: [[0, 0]], decor: [], collected: 0, hostInventory: new Bag().snapshot() }));
  assert.deepEqual(fresh, [], 'a fresh world adopts nothing');
  const mine = SR.pastOffered({ v: 2, chests: {}, seen: [], learned: [] }, SR.stateFrom({ v: 2, chests: {}, seen: [], learned: [] }, 'save', null));
  assert.deepEqual(mine, [], 'a slice this build wrote adds no desk starters');
  const oldSlice = { v: 1, chests: {}, seen: ['wood'], learned: ['bowl'] };
  assert.deepEqual(SR.pastOffered(oldSlice, SR.stateFrom(oldSlice, 'save', null)), [...new Set(['bowl', ...SR.STARTER])].sort());
  // a grandfathered pre-desk save got every recipe from the old build: adoption keeps only the content ones
  const w = { tiles: [[0, 0]], decor: [{ type: 'crate', x: 0, z: 0 }], collected: 9 };
  const legacy = SR.pastOffered(undefined, SR.stateFrom(undefined, 'save', w));
  fakeStorage();
  const g2 = fakeGame({ pastLearned: legacy }), h2 = H.attachProgression(g2.ctx);
  h2.tick(0.6);
  const q = h2.progression('host');
  const adopted = [...q.learned].filter((id) => !Object.hasOwn(ITEMS, id));
  assert.ok(adopted.includes('motor') && adopted.includes('bed'), 'content recipes the old build offered');
  assert.equal([...q.learned].filter((id) => Object.hasOwn(ITEMS, id) && !['rope', 'hook', 'hammer'].includes(id)).length, 0, 'no items.js recipe adopted');
  h2.dispose();
});

test('research is host-checked: a placed table within reach of that player', () => {
  fakeStorage();
  const g = fakeGame({ decor: [{ type: 'researchtable', x: 3, z: 0 }] }), h = H.attachProgression(g.ctx);
  g.world.place(); h.tick(0.6);
  fill(g.bags.host, { wood: 2 });
  h.apply({ kind: 'prog:research', item: 'wood' }, 'host'); // table 6 m away
  assert.equal(g.bags.host.count('wood'), 2);
  assert.ok(g.emits.some(({ e }) => /Stand at/.test(e.text)));
  g.world.decor[0].x = 1; // 2 m: in reach
  h.apply({ kind: 'prog:research', item: 'wood' }, 'host');
  assert.equal(g.bags.host.count('wood'), 1);
  // the table is picked up: progression still remembers the station, but research is refused
  g.world.decor.length = 0;
  fill(g.bags.host, { scrap: 1 });
  h.apply({ kind: 'prog:research', item: 'scrap' }, 'host');
  assert.equal(g.bags.host.count('scrap'), 1);
  // a guest with no known pose is refused; with a pose in reach (plus slack) it works
  g.world.decor.push({ type: 'research', x: 1, z: 0 });
  fill(g.bags.guest, { scrap: 1 });
  let pose = null; g.ctx.actorPose = (a) => (a === 'guest' ? pose : { x: 0, z: 0, slack: 0 });
  h.apply({ kind: 'prog:research', item: 'scrap' }, 'guest');
  assert.equal(g.bags.guest.count('scrap'), 1);
  pose = { x: 6, z: 0, slack: 2 };
  h.apply({ kind: 'prog:research', item: 'scrap' }, 'guest');
  assert.equal(g.bags.guest.count('scrap'), 0);
  h.dispose();
});
