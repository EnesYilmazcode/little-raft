// Sandy Secrets (Seashell Finder, Little Spade, buried bundles): pure rules + a stub-ctx run.
// Run: node --test tests/treasure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('treasure-rules.js', base));
const L = await import(new URL('islands-layout.js', base));
const I = await import(new URL('islands.js' + BUILD, base)); // the instance treasure.js reads islandNow() from
const { createTreasure } = await import(new URL('treasure.js' + BUILD, base));
const { Bag, SLOT_COUNT, STACK_SIZE } = await import(new URL('inventory-state.js', base));
const { ITEMS, TOOL_IDS, wearPerUse, repairCost } = await import(new URL('items.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { ITEM_TEXT } = await import(new URL('craft-book.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { TREASURE, spotsFor, lootForSpot, beepInterval, closeness, warmth, clean, nearestSpot, applyDig, applyRepair } = R;
const { layoutFor, groundHeight, shape, ISLAND } = L;

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761 + 17) >>> 0);
const bagWith = (slots, selected = 0) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected }); };
const spade = (durability = 100) => ({ kind: 'spade', count: 1, durability });

// ---------------------------------------------------------------- spots

test('spotsFor: deterministic, frozen, cached, on dry sand clear of nodes', () => {
  assert.deepEqual(spotsFor(1234), spotsFor(1234));
  assert.equal(spotsFor(1234), spotsFor(1234), 'same frozen ref');
  assert.ok(Object.isFrozen(spotsFor(1234)) && Object.isFrozen(spotsFor(1234)[0]));
  const before = JSON.stringify(layoutFor(99)); spotsFor(99);
  assert.equal(JSON.stringify(layoutFor(99)), before, 'layoutFor untouched');
  let ones = 0, twos = 0;
  for (const seed of SEEDS) {
    const lay = layoutFor(seed), sp = spotsFor(seed);
    assert.ok(sp.length >= 1 && sp.length <= TREASURE.MAX_SPOTS, `seed ${seed}: ${sp.length} spots`);
    if (sp.length === 1) ones++; else twos++;
    sp.forEach((s, i) => {
      assert.equal(s.i, i);
      assert.ok(s.kind === 'bundle' || s.kind === 'keepsake');
      const r = Math.hypot(s.x, s.z), a = Math.atan2(s.z, s.x), u = r / (lay.R * shape(a - lay.rot));
      assert.ok(u <= TREASURE.U_MAX + 1e-9 && u >= TREASURE.U_MIN - 1e-9, `u ${u}`);
      assert.ok(s.y >= TREASURE.MIN_Y, 'dry');
      assert.ok(Math.abs(groundHeight(r, lay.R, a - lay.rot) - s.y) < 1e-9, 'y is the sand height');
      for (const n of lay.nodes) assert.ok(Math.hypot(n.x - s.x, n.z - s.z) >= TREASURE.NODE_GAP - 1e-9, 'clear of nodes');
      for (const o of sp) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= TREASURE.SPOT_GAP - 1e-9, 'spots apart');
    });
  }
  assert.ok(ones > 40 && twos > 40, `mix of 1 and 2 (${ones}/${twos})`);
});

test('lootForSpot: deterministic, existing items, keepsakes add an ingot', () => {
  for (const seed of SEEDS.slice(0, 50)) for (const i of [0, 1]) for (const kind of ['bundle', 'keepsake']) {
    const a = lootForSpot(seed, i, kind);
    assert.deepEqual(a, lootForSpot(seed, i, kind));
    assert.ok(a.length >= 1 && a.length <= 3);
    for (const [k, n] of a) { assert.ok(ITEMS[k], k); assert.ok(Number.isInteger(n) && n >= 1 && n <= 8); }
    const ingots = a.filter(([k]) => k === 'copperingot' || k === 'metalingot').length;
    assert.equal(ingots, kind === 'keepsake' ? 1 : 0);
  }
});

// ---------------------------------------------------------------- finder curve

test('beepInterval / closeness / warmth', () => {
  assert.equal(beepInterval(TREASURE.RANGE), Infinity);
  assert.equal(beepInterval(50), Infinity);
  assert.equal(beepInterval(NaN), Infinity);
  assert.equal(beepInterval(TREASURE.LOCK), 0);
  assert.equal(beepInterval(0.2), 0);
  let prev = 0;
  for (let d = 1.1; d <= 8.9; d += 0.1) {
    const iv = beepInterval(d);
    assert.ok(iv > prev, `rises at ${d}`); prev = iv;
    assert.ok(iv >= TREASURE.IV_MIN && iv <= TREASURE.IV_MAX);
  }
  for (const d of [-1, 0, 1, 3, 8.9, 9, 20, NaN]) { const c = closeness(d); assert.ok(c >= 0 && c <= 1, `closeness ${d}`); }
  assert.equal(closeness(TREASURE.LOCK), 1); assert.equal(closeness(TREASURE.RANGE), 0);
  assert.equal(warmth(null), 'Nothing buried nearby');
  assert.equal(warmth(12), 'Quiet sand…');
  assert.equal(warmth(7), 'Warm…');
  assert.equal(warmth(4), 'Warmer…');
  assert.equal(warmth(2), 'Very warm!');
  assert.equal(warmth(0.5), 'Right here! Dig with the spade');
});

// ---------------------------------------------------------------- dig / repair

function digWorld(seed = 1234) {
  const spots = spotsFor(seed), lay = layoutFor(seed);
  const groundAt = (x, z) => groundHeight(Math.hypot(x, z), lay.R, Math.atan2(z, x) - lay.rot); // island at the origin
  return { seed, cx: 0, cz: 0, clock: 10, cool: { host: 0, guest: 0 }, dug: spots.map(() => 0), spots, groundAt };
}
const at = (s, dx = 0) => ({ x: s.x + dx, z: s.z });
const toward = (s, d) => { const r = Math.hypot(s.x, s.z); return { x: s.x - s.x / r * d, z: s.z - s.z / r * d }; }; // inland: stays on sand

test('applyDig: ok path loots, flags, wears and cools down', () => {
  const st = digWorld(), s = st.spots[0], bag = bagWith([spade()]);
  const r = applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: 0 }, 'host', at(s, 0.5), bag);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.loot, lootForSpot(1234, 0, s.kind));
  for (const [k, n] of r.loot) assert.equal(bag.count(k), n);
  assert.equal(st.dug[0], 1);
  assert.ok(Math.abs(bag.slots[0].durability - (100 - 100 / 60)) < 1e-9);
  assert.equal(wearPerUse('spade'), 100 / 60);
  assert.equal(applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: 0 }, 'host', at(s), bag).reason, 'dug');
  st.dug[0] = 0;
  assert.equal(applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: 0 }, 'host', at(s), bag).reason, 'cooldown');
  st.clock += 1;
  assert.equal(applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: 0 }, 'host', at(s), bag).ok, true);
});

test('applyDig: every refusal reason, bag untouched', () => {
  const s0 = digWorld().spots[0];
  const dig = (a, { actor = 'host', pos = at(s0), bag = bagWith([spade()]), mod } = {}) => {
    const st = digWorld(); if (mod) mod(st);
    const snap = bag ? JSON.stringify(bag.snapshot()) : null;
    const r = applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: 0, ...a }, actor, pos, bag);
    if (!r.ok) { if (bag) assert.equal(JSON.stringify(bag.snapshot()), snap, `${r.reason}: bag unchanged`); if (r.reason !== 'dug') assert.ok(!st.dug.some(Boolean)); }
    return r.reason;
  };
  assert.equal(dig({ kind: 'islands.gather' }), 'kind');
  assert.equal(dig({}, { mod: st => { st.seed = null; } }), 'none');
  assert.equal(dig({ seed: 99 }), 'stale');
  for (const spot of [5, -2, 0.5, '0', null]) assert.equal(dig({ spot }), 'spot');
  assert.equal(dig({}, { mod: st => { st.dug[0] = 1; } }), 'dug');
  assert.equal(dig({}, { pos: toward(s0, 2.5) }), 'reach', 'host 2.0 m');
  assert.equal(dig({}, { pos: toward(s0, 2.5), actor: 'guest' }), undefined, 'guest 3.0 m');
  assert.equal(dig({}, { pos: toward(s0, 3.3), actor: 'guest' }), 'reach');
  assert.equal(dig({}, { pos: { x: 99, z: 0 } }), 'reach', 'off the sand');
  assert.equal(dig({}, { pos: { x: NaN, z: 0 } }), 'reach');
  assert.equal(dig({}, { mod: st => { st.groundAt = () => NaN; } }), 'reach', 'groundAt NaN');
  assert.equal(dig({}, { mod: st => { st.cool.host = 99; } }), 'cooldown');
  assert.equal(dig({}, { bag: null }), 'bag');
  assert.equal(dig({}, { bag: bagWith([{ kind: 'hook', count: 1, durability: 100 }, spade()]) }), 'tool');
  assert.equal(dig({}, { bag: bagWith([spade(0)]) }), 'worn');
  const full = bagWith([spade(), ...Array.from({ length: SLOT_COUNT - 1 }, () => ({ kind: 'plastic', count: STACK_SIZE }))]);
  assert.equal(dig({}, { bag: full }), 'full');
});

test('applyDig: an empty dig gives one sand', () => {
  const st = digWorld(), bag = bagWith([spade()]);
  const r = applyDig(st, { kind: 'treasure.dig', seed: 1234, spot: -1 }, 'host', { x: 0, z: 0 }, bag);
  assert.equal(r.ok, true);
  assert.deepEqual(r.loot, [['sand', 1]]);
  assert.equal(bag.count('sand'), 1);
  assert.ok(!st.dug.some(Boolean));
  assert.ok(bag.slots[0].durability < 100);
});

test('applyRepair: 2 planks + 1 scrap back to 100%, refuses when fine or short', () => {
  assert.deepEqual(repairCost('spade'), { wood: 2, scrap: 1 });
  const bag = bagWith([spade(10), { kind: 'wood', count: 3 }, { kind: 'scrap', count: 1 }]);
  assert.equal(applyRepair(bag).ok, true);
  assert.equal(bag.slots[0].durability, 100); assert.equal(bag.count('wood'), 1); assert.equal(bag.count('scrap'), 0);
  assert.equal(applyRepair(bag).reason, 'fine');
  bag.slots[0].durability = 5;
  assert.equal(applyRepair(bag).reason, 'cost');
  assert.equal(bag.count('wood'), 1, 'nothing spent');
  assert.equal(applyRepair(bagWith([{ kind: 'hook', count: 1, durability: 10 }])).reason, 'tool');
});

// ---------------------------------------------------------------- save

test('clean: junk in, valid fresh slice out', () => {
  const D = { v: 1, seed: null, dug: [] };
  for (const junk of [undefined, null, 5, 'x', [], { v: 2, seed: 1, dug: [1] }, { v: 1, seed: -1 }, { v: 1, seed: 1.5 }, { v: 1, seed: 2 ** 32 }, { v: 1, seed: '7' }])
    assert.deepEqual(clean(junk), D);
  assert.deepEqual(clean({ v: 1, seed: null, dug: [1, 1] }), D);
  const n = spotsFor(1234).length;
  const big = clean({ v: 1, seed: 1234, dug: [1, 1, 1, 1, 1] });
  assert.equal(big.dug.length, n); assert.ok(big.dug.length <= TREASURE.MAX_SPOTS);
  assert.deepEqual(clean({ v: 1, seed: 1234, dug: ['1', 2] }).dug, new Array(n).fill(0));
  const src = { v: 1, seed: 1234, dug: [1, 0] }, c = clean(src);
  assert.notEqual(c, src); assert.notEqual(c.dug, src.dug);
  c.dug[0] = 0; assert.equal(src.dug[0], 1);
});

// ---------------------------------------------------------------- items

test('items: finder never wears, spade is a repairable tool, both have art and text', () => {
  assert.equal(ITEMS.finder.stack, 1); assert.equal(ITEMS.finder.tool, false);
  assert.equal(ITEMS.finder.durability, undefined); assert.equal(wearPerUse('finder'), 0);
  assert.ok(!TOOL_IDS.includes('finder'));
  assert.equal(ITEMS.spade.tool, true); assert.equal(ITEMS.spade.durability, 60); assert.ok(TOOL_IDS.includes('spade'));
  assert.ok(repairCost('spade'));
  for (const k of ['finder', 'spade']) {
    assert.ok(ITEM_ICONS[k], `${k} icon`);
    assert.ok(ITEM_TEXT[k]?.desc && ITEM_TEXT[k]?.use, `${k} text`);
  }
  assert.ok(new Bag().add('spade', 1) === 0);
});

// ---------------------------------------------------------------- wiring + stub ctx

test('wiring: treasure.js imports the islands instance content.js uses, after islands', () => {
  const dist = fileURLToPath(base);
  const tre = readFileSync(resolve(dist, 'treasure.js'), 'utf8'), con = readFileSync(resolve(dist, 'content.js'), 'utf8');
  const tok = con.match(/'\.\/islands\.js(\?build=[^']+)'/)[1];
  assert.ok(tre.includes(`'./islands.js${tok}'`), 'same ?build= token');
  const feats = con.match(/const FEATURES = \[([^\]]+)\]/)[1].split(',').map(s => s.trim());
  assert.ok(feats.indexOf('createTreasure') > feats.indexOf('createIslands') && feats.indexOf('createIslands') >= 0);
});

function stubWorld(role = 'solo') {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [], plays = [];
  const bag = bagWith([spade(), { kind: 'finder', count: 1 }]);
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    world: { tiles: [[0, 0]] }, role, running: true, physics, other: null,
    localBag: () => bag, play: (e, s) => plays.push([e, s]),
    emit: (e, to) => emits.push({ e, to }),
    action: a => { (isl.action(a, 'host', bag) || tre.action(a, 'host', bag)); return true; },
  };
  const isl = I.createIslands(ctx), tre = createTreasure(ctx);
  return { ctx, isl, tre, bag, physics, emits, plays, dispose() { tre.dispose(); isl.dispose(); } };
}

test('stub ctx: islandNow, host seeding, dig, mounds, save round trip and clear', () => {
  const w = stubWorld();
  w.isl.debug.spawnNear(1234, 30); w.isl.update(0);
  assert.equal(I.islandNow().seed, 1234);
  w.tre.update(1 / 60);
  assert.equal(w.tre.debug.state().seed, 1234);
  assert.deepEqual(w.tre.debug.state().dug, spotsFor(1234).map(() => 0));
  assert.deepEqual(w.tre.serialize(), { v: 1, seed: 1234, dug: spotsFor(1234).map(() => 0) });
  // stand by spot 0 and listen with the finder
  const s = spotsFor(1234)[0];
  assert.equal(w.isl.debug.teleportAshore(s.x + 2.5, s.z), true);
  w.bag.select(1);
  for (let i = 0; i < 120; i++) { w.isl.afterMove(w.physics, 1 / 60); w.isl.update(1 / 60); w.tre.update(1 / 60); }
  assert.ok(w.plays.some(([e]) => e === 'detect'), 'finder ticks');
  assert.ok(w.tre.debug.state().d < 3, 'distance tracked');
  // dig with E
  w.bag.select(0);
  w.isl.debug.teleportAshore(s.x + 0.5, s.z); w.isl.update(0); w.tre.update(0);
  assert.equal(w.tre.prompt(null), '<kbd>E</kbd> Dig');
  assert.equal(w.tre.interact(null), true);
  assert.equal(w.tre.debug.state().dug[0], 1);
  assert.ok(w.emits.some(x => x.e.kind === 'loot' && x.e.loot), 'loot emitted');
  for (const [k, n] of lootForSpot(1234, 0, s.kind)) assert.ok(w.bag.count(k) >= n, k);
  const meshes = []; w.ctx.scene.getObjectByName('treasure').traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.ok(meshes.length <= 7, `${meshes.length} meshes`);
  assert.ok(meshes.some(o => o.name === 'treasureMound' && o.visible));
  // save round trip into a fresh module; net loads of the same data do nothing
  const saved = JSON.parse(JSON.stringify(w.tre.serialize()));
  const w2 = stubWorld(); w2.tre.load(saved, 'save');
  assert.deepEqual(w2.tre.debug.state().dug, saved.dug);
  w2.tre.load(undefined, 'save'); assert.equal(w2.tre.debug.state().seed, null);
  w2.dispose();
  assert.deepEqual(w.tre.debug.clear(), { seed: null, dug: [] });
  w.dispose();
  assert.equal(I.islandNow(), null, 'dispose clears the accessor');
});

test('stub ctx: guests send actions and only follow host state', () => {
  const g = stubWorld('guest');
  g.tre.load({ v: 1, seed: 1234, dug: [0, 0] }, 'net');
  g.tre.update(1 / 60);
  assert.equal(g.tre.debug.state().seed, 1234, 'guest never reseeds itself');
  assert.equal(g.tre.action({ kind: 'treasure.dig', seed: 1234, spot: 0 }, 'guest', g.bag), true);
  assert.equal(g.tre.debug.state().dug[0], 0);
  g.tre.load({ v: 1, seed: 1234, dug: [1, 0] }, 'net');
  assert.equal(g.tre.debug.state().dug[0], 1);
  g.dispose();
});

test('stub ctx: host digs for the guest at the guest pose, into the guest bag', () => {
  const w = stubWorld('host');
  w.isl.debug.spawnNear(1234, 30); w.isl.update(0); w.tre.update(1 / 60);
  const now = I.islandNow(), s = spotsFor(1234)[0], kind0 = s.kind;
  const gBag = bagWith([null, spade()], 1);
  const hostBefore = JSON.stringify(w.bag.snapshot());
  const dig = spot => w.tre.action({ kind: 'treasure.dig', seed: 1234, spot }, 'guest', gBag);
  // guest far away (host physics stands right on the spot: must not count)
  w.isl.debug.teleportAshore(s.x, s.z);
  w.ctx.other = { x: now.cx + s.x + 6, z: now.cz + s.z };
  assert.equal(dig(0), true);
  assert.equal(w.tre.debug.state().dug[0], 0, 'reach uses the guest pose, not the host');
  assert.deepEqual(w.emits.at(-1), { e: { kind: 'notice', text: 'Get a little closer' }, to: 'guest' });
  // within guest reach (2 m + 1 m slack) but beyond the host's 2 m
  w.ctx.other = { x: now.cx + s.x + 2.6, z: now.cz + s.z };
  assert.equal(dig(0), true);
  assert.equal(w.tre.debug.state().dug[0], 1);
  for (const [k, n] of lootForSpot(1234, 0, kind0)) assert.ok(gBag.count(k) >= n, `guest got ${k}`);
  assert.ok(gBag.slots[1].durability < 100, 'guest spade worn');
  assert.equal(JSON.stringify(w.bag.snapshot()), hostBefore, 'host bag untouched');
  assert.ok(w.emits.filter(x => x.e.kind === 'loot').every(x => x.to === 'guest'), 'loot rows go to the guest');
  // the same spot again (double E / host racing for it) is refused, nothing added
  const after = JSON.stringify(gBag.snapshot());
  assert.equal(dig(0), true);
  assert.equal(JSON.stringify(gBag.snapshot()), after);
  // a stale seed from the guest's old view is refused with a notice to the guest
  w.tre.action({ kind: 'treasure.dig', seed: 999, spot: 0 }, 'guest', gBag);
  assert.deepEqual(w.emits.at(-1), { e: { kind: 'notice', text: 'The island drifted off' }, to: 'guest' });
  // the guest sees the host's slice
  const g = stubWorld('guest'); g.tre.load(JSON.parse(JSON.stringify(w.tre.serialize())), 'net');
  assert.equal(g.tre.debug.state().dug[0], 1);
  g.dispose(); w.dispose();
});

test('finder bead glow follows setFinderGlow; dug holes are a dark sand', async () => {
  const M = await import(new URL('treasure-models.js', base));
  const f = M.createFinder(T), mat = f.userData.bead.material;
  M.setFinderGlow(2); assert.equal(mat.emissiveIntensity, 2);
  M.setFinderGlow(0.25); assert.equal(mat.emissiveIntensity, 0.25);
  M.setFinderGlow(0.6);
  const kit = M.createMoundKit(T), c = kit.mats.hole.color;
  assert.ok(c.r + c.g + c.b < 0.4, 'hole reads darker than the sand');
  kit.dispose();
});
