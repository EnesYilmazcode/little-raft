// Unit tests for dist/fish-trap.js (fish trap) and dist/fish-trap-model.js.
// Run: node --test tests/fish-trap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const F = await import(new URL('fish-trap.js', base));
const M = await import(new URL('fish-trap-model.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII } = await import(new URL('items.js', base));
const { SPECIES, speciesById, starsFor } = await import(new URL('fish-species.js', base));
const { promptFromHtml } = await import(new URL('prompts.js', base));
const { BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const { cleanTrap, isEdgeTile, openSide, tickTraps, trapInfo, collect, nextRand, CATCH_SEC, BAIT_SEC, TRAP_MAX, BAIT_PER, OLD_HOST, DEFAULT_SEED } = F;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
const grid = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]); // 3x3 raft, centre 0,0
const trap = (x, z, rot) => (rot ? { type: 'fishtrap', x, z, rot } : { type: 'fishtrap', x, z });
const fresh = () => cleanTrap(undefined, []);
const ticks = (st, tiles, decor, n, dt = 1) => { let full = [], caught = []; for (let i = 0; i < n; i++) { const r = tickTraps(st, tiles, decor, dt); full = full.concat(r.full); caught = caught.concat(r.caught); } return { full, caught }; };

test('cleanTrap: junk gives defaults; bad keys, fish and values are dropped or clamped; non-trap tiles pruned', () => {
  for (const v of [undefined, null, [], 'x', 3, { t: [] }, { t: 'x' }]) assert.deepEqual(cleanTrap(v, [trap(1, 0)]), { v: 1, s: '', r: 0, seed: DEFAULT_SEED, t: {} });
  assert.equal(cleanTrap({ seed: -1 }, []).seed, DEFAULT_SEED);
  assert.equal(cleanTrap({ seed: 2 ** 32 }, []).seed, DEFAULT_SEED);
  assert.equal(cleanTrap({ seed: 1.5 }, []).seed, DEFAULT_SEED);
  assert.equal(cleanTrap({ seed: 12345 }, []).seed, 12345);
  const decor = [trap(1, 0), trap(-1, 0), trap(0, 0), trap(0, 1), trap(1, 1), { type: 'palm', x: 2, z: 2 }];
  const sal = speciesById('salmon');
  const st = cleanTrap({ v: 1, s: 'abc', r: 7, seed: 99, t: {
    '1,0': { f: [{ sp: 'salmon', cm: 999, st: 1 }, { sp: 'nope', cm: 20, st: 1 }, { sp: 'herring', cm: 3, st: 3 }, 'x'], w: 12.7, b: 9 },
    '-1,0': { f: [{ sp: 'pomfret', cm: 20 }, { sp: 'pomfret', cm: 21 }, { sp: 'pomfret', cm: 22 }, { sp: 'pomfret', cm: 23 }], w: 100, b: -3 },
    '0,0': { f: [], w: 5000, b: 2 }, // inner trap: kept
    '0,1': { f: [], w: 0, b: 0 },     // all empty: dropped
    '1,1': 'x', '2,2': { f: [], w: 3, b: 0 }, '9,9': { f: [], w: 3, b: 0 }, 'a,b': { w: 1 }, '01,0': { w: 1 },
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7); assert.equal(st.seed, 99);
  assert.deepEqual(Object.keys(st.t).sort(), ['-1,0', '0,0', '1,0']);
  assert.deepEqual(st.t['1,0'], { f: [{ sp: 'salmon', cm: sal.maxCm, st: 3 }, { sp: 'herring', cm: 15, st: 1 }], w: 12, b: BAIT_PER });
  assert.equal(st.t['-1,0'].f.length, 3); assert.equal(st.t['-1,0'].w, 0); assert.equal(st.t['-1,0'].b, 0);
  assert.equal(st.t['-1,0'].f[0].st, starsFor(speciesById('pomfret'), 20));
  assert.deepEqual(st.t['0,0'], { f: [], w: CATCH_SEC - 1, b: 2 });
});

test('isEdgeTile and openSide on a 3x3 raft', () => {
  const tiles = grid();
  assert.equal(isEdgeTile(tiles, 0, 0), false);
  for (const [x, z] of [[1, 1], [-1, -1], [1, 0], [0, -1], [-1, 1]]) assert.equal(isEdgeTile(tiles, x, z), true, `${x},${z}`);
  assert.equal(isEdgeTile(tiles, 5, 5), false, 'not a tile');
  assert.equal(openSide(tiles, 0, 0), null);
  assert.deepEqual(openSide(tiles, 1, 1, 0), [0, 1]);              // rot 0 faces +z, open
  assert.deepEqual(openSide(tiles, 1, 1, Math.PI / 2), [1, 0]);    // rot faces +x, open
  assert.deepEqual(openSide(tiles, 1, 0, 0), [1, 0]);              // +z is a tile: fall back in order
  assert.deepEqual(openSide(tiles, -1, 0, -Math.PI / 2), [-1, 0]); // faces -x, open
  assert.deepEqual(openSide(tiles, 0, -1, Math.PI), [0, -1]);
  assert.deepEqual(openSide(tiles, 0, -1, Math.PI / 4), [0, -1], 'a diagonal rot falls back');
});

test('tick: catch timing, bait, full at 3, non-edge idle, dt clamp', () => {
  const tiles = grid(), decor = [trap(1, 0)];
  let st = fresh();
  ticks(st, tiles, decor, CATCH_SEC - 1); assert.equal(trapInfo(st, tiles, decor, 1, 0).n, 0);
  assert.equal(trapInfo(st, tiles, decor, 1, 0).w, CATCH_SEC - 1);
  let r = ticks(st, tiles, decor, 1); assert.equal(trapInfo(st, tiles, decor, 1, 0).n, 1); assert.deepEqual(r.caught, ['1,0']);
  assert.ok(SPECIES.some(s => s.id === st.t['1,0'].f[0].sp));
  // baited
  st = fresh(); st.t['1,0'] = { f: [], w: 0, b: BAIT_PER };
  ticks(st, tiles, decor, BAIT_SEC - 1); assert.equal(st.t['1,0'].f.length, 0);
  ticks(st, tiles, decor, 1); assert.equal(st.t['1,0'].f.length, 1); assert.equal(st.t['1,0'].b, 4);
  // 5 baited catches, then 240 again
  st = fresh(); st.t['1,0'] = { f: [], w: 0, b: BAIT_PER };
  for (let i = 0; i < BAIT_PER; i++) { ticks(st, tiles, decor, BAIT_SEC); st.t['1,0'].f = []; }
  assert.equal(st.t['1,0'].b, 0); assert.equal(trapInfo(st, tiles, decor, 1, 0).need, CATCH_SEC);
  ticks(st, tiles, decor, BAIT_SEC); assert.equal(st.t['1,0'].f.length, 0);
  ticks(st, tiles, decor, CATCH_SEC - BAIT_SEC); assert.equal(st.t['1,0'].f.length, 1);
  // stops at 3
  st = fresh();
  r = ticks(st, tiles, decor, 60, 60);
  assert.equal(st.t['1,0'].f.length, TRAP_MAX); assert.equal(st.t['1,0'].w, 0);
  assert.deepEqual(r.full, ['1,0']);
  const rv = st.r; tickTraps(st, tiles, decor, 5); assert.equal(st.r, rv, 'a full trap does not bump the revision');
  // inner trap idles
  st = fresh(); const inner = [trap(0, 0)];
  st.t['0,0'] = { f: [], w: 7, b: 2 };
  const before = JSON.stringify(st.t);
  ticks(st, tiles, inner, 1000); assert.equal(JSON.stringify(st.t), before);
  // dt
  st = fresh();
  tickTraps(st, tiles, decor, .9); assert.deepEqual(st.t, {});
  tickTraps(st, tiles, decor, NaN); tickTraps(st, tiles, decor, -4); assert.deepEqual(st.t, {});
  tickTraps(st, tiles, decor, 1e6); assert.equal(st.t['1,0'].w, 60);
  // trap removed: pruned
  tickTraps(st, tiles, [], 0); assert.deepEqual(st.t, {});
});

test('determinism: same seed and sequence; serialize + clean + continue equals an uninterrupted run', () => {
  const tiles = grid(), mk = () => [trap(1, 0), trap(-1, 1), trap(0, -1), trap(0, 0)];
  const a = cleanTrap({ seed: 4242 }, mk()), b = cleanTrap({ seed: 4242 }, mk());
  const seq = [0.5, 1, 7.3, 60, 120, 3, 0, 59.99, 33];
  const drain = st => { for (const e of Object.values(st.t)) if (e.f.length >= TRAP_MAX) e.f.splice(0, 2); };
  for (let k = 0; k < 30; k++) for (const dt of seq) { tickTraps(a, tiles, mk(), dt); tickTraps(b, tiles, mk(), dt); drain(a); drain(b); }
  assert.deepEqual(a, b);
  let c = cleanTrap(JSON.parse(JSON.stringify(a)), mk());
  for (let k = 0; k < 30; k++) for (const dt of seq) { tickTraps(a, tiles, mk(), dt); tickTraps(c, tiles, mk(), dt); drain(a); drain(c); }
  assert.deepEqual(c, a);
  for (const e of Object.values(a.t)) for (const f of e.f) assert.ok(speciesById(f.sp), f.sp);
  const s1 = { seed: 1 }, s2 = { seed: 1 }; const x = [nextRand(s1), nextRand(s1)];
  assert.deepEqual(x, [nextRand(s2), nextRand(s2)]); assert.ok(x[0] >= 0 && x[0] < 1 && x[0] !== x[1]);
});

test('collect: all or nothing', () => {
  const decor = [trap(1, 0)];
  const st = fresh(); st.t['1,0'] = { f: [{ sp: 'pomfret', cm: 20, st: 1 }, { sp: 'tuna', cm: 100, st: 2 }], w: 40, b: 3 };
  const bag = bagWith([{ kind: 'wood', count: 1 }]);
  const r = collect(st, decor, '1,0', bag);
  assert.equal(r.ok, true); assert.equal(r.n, 2); assert.equal(r.text, '+ 2 fish from the trap');
  assert.deepEqual(r.fish, [{ species: 'pomfret', cm: 20, stars: 1 }, { species: 'tuna', cm: 100, stars: 2 }]);
  assert.equal(bag.count('fish'), 2);
  assert.deepEqual(st.t['1,0'], { f: [], w: 40, b: 3 });
  st.t['1,0'].f = [{ sp: 'pomfret', cm: 20, st: 1 }];
  const fb = fullBag(), snap = JSON.stringify(fb.snapshot());
  const no = collect(st, decor, '1,0', fb);
  assert.equal(no.reason, 'full'); assert.equal(no.text, 'Your bag is full');
  assert.equal(JSON.stringify(fb.snapshot()), snap); assert.equal(st.t['1,0'].f.length, 1);
  st.t['1,0'].f = [];
  assert.equal(collect(st, decor, '1,0', bag).reason, 'empty');
  assert.equal(collect(st, decor, '0,0', bag).reason, 'notarget');
  assert.equal(collect(st, decor, 'zz', bag).text, 'Nothing to collect');
});

// player at tile 1,0's rim; the trap there hangs out over +x (overhang point 3.15, 0)
const AIM = (() => { const v = [3.15 - 2, .05 - 1.7, 0], l = Math.hypot(...v); return { dir: { x: v[0] / l, y: v[1] / l, z: v[2] / l } }; })();
function modCtx(role = 'solo') {
  const world = { tiles: grid(), decor: [trap(1, 0)], fish: 4 };
  const emits = [], notices = [], actions = [];
  let bag = bagWith([]);
  const ctx = { T: null, world, role, running: true, physics: { x: 2, z: 0 }, other: { x: 50, z: 50 }, camera: { position: { x: 2, y: 1.7, z: 0 } }, raft: null, elapsed: 0,
    localBag: () => bag, emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions, setBag: b => { bag = b; } };
}

test('module: collect, bait, validation, placeBlock', () => {
  const { ctx, emits } = modCtx();
  const m = F.createFishTrap(ctx);
  assert.equal(m.name, 'fishtrap');
  m.load({ v: 1, s: 'x', r: 1, seed: 5, t: { '1,0': { f: [{ sp: 'pomfret', cm: 20, st: 1 }, { sp: 'herring', cm: 20, st: 1 }], w: 3, b: 0 } } }, 'save');
  const bag = bagWith([{ kind: 'seaweed', count: 2 }]), snap = JSON.stringify(bag.snapshot()), st0 = JSON.stringify(m.debug.state().t);
  assert.equal(m.action({ kind: 'fishtrap.collect', x: 1.5, z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'fishtrap.collect', x: '1', z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'fishtrap.collect', x: 1, z: 0 }, 'guest', bag), true); // guest far away
  assert.equal(m.action({ kind: 'fishtrap.bait', x: 1, z: 0 }, 'guest', bag), true);
  assert.equal(JSON.stringify(bag.snapshot()), snap); assert.equal(JSON.stringify(m.debug.state().t), st0);
  assert.equal(emits.length, 0);
  assert.equal(m.action({ kind: 'bees.harvest' }, 'host', bag), false);
  assert.equal(m.action({ kind: 'fishtrap.collect', x: 1, z: 0 }, 'host', bag), true);
  assert.equal(bag.count('fish'), 2); assert.equal(ctx.world.fish, 6);
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+ 2 fish from the trap', loot: { fish: 2 },
    trapFish: [{ species: 'pomfret', cm: 20, stars: 1 }, { species: 'herring', cm: 20, stars: 1 }] }, 'host']);
  // bait: guest close by, removes exactly one seaweed
  ctx.other = { x: 2, z: .5 };
  assert.equal(m.action({ kind: 'fishtrap.bait', x: 1, z: 0 }, 'guest', bag), true);
  assert.equal(bag.count('seaweed'), 1); assert.equal(m.debug.state().t['1,0'].b, BAIT_PER);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: 'Trap baited · 5 catches', sound: 'collect' }, 'guest']);
  m.action({ kind: 'fishtrap.bait', x: 1, z: 0 }, 'guest', bag);
  assert.equal(bag.count('seaweed'), 1); assert.equal(emits.at(-1)[0].text, 'The trap is already baited');
  const nb = bagWith([]); m.debug.state(); ctx.world.decor.push(trap(-1, 0)); ctx.physics = { x: -2, z: 0 };
  m.action({ kind: 'fishtrap.bait', x: -1, z: 0 }, 'host', nb);
  assert.equal(emits.at(-1)[0].text, 'You need seaweed for bait');
  m.action({ kind: 'fishtrap.collect', x: -1, z: 0 }, 'host', nb);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: 'No fish in the trap yet' }, 'host']);
  // placeBlock
  assert.equal(m.placeBlock('fishtrap', 0, 0), 'trapedge');
  assert.equal(m.placeBlock('fishtrap', 1, 1), null);
  assert.equal(m.placeBlock('palm', 0, 0), null);
  assert.ok(BLOCK_TEXT.trapedge);
  // serialize is cached by revision
  const s1 = m.serialize(); assert.equal(m.serialize(), s1);
  // a missing slice on 'save' gets a fresh seed
  m.load(undefined, 'save'); assert.deepEqual(m.debug.state().t, {});
});

test('module: prompts, interact and the OLD_HOST guard on a guest', () => {
  const g = modCtx('guest');
  const gm = F.createFishTrap(g.ctx);
  const data = { v: 1, s: 'host1', r: 5, seed: 1, t: { '1,0': { f: [{ sp: 'pomfret', cm: 20, st: 1 }], w: 0, b: 0 } } };
  gm.load(data, 'net');
  const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net'); gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Collect fish (1)');
  assert.deepEqual(promptFromHtml(gm.prompt(AIM)), { key: 'E', label: 'Collect fish (1)' });
  assert.equal(gm.interact(AIM), true);
  assert.deepEqual(g.actions.at(-1), { kind: 'fishtrap.collect', x: 1, z: 0 });
  gm.load({ ...data, r: 6, t: { '1,0': { f: [{ sp: 'pomfret', cm: 20, st: 1 }, { sp: 'pomfret', cm: 20, st: 1 }, { sp: 'pomfret', cm: 20, st: 1 }], w: 0, b: 0 } } }, 'net');
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Collect fish (3) · full');
  gm.load({ ...data, r: 7, t: { '1,0': { f: [], w: 120, b: 0 } } }, 'net');
  assert.equal(gm.prompt(AIM), 'Fish trap: waiting… 50% · seaweed makes good bait');
  assert.equal(promptFromHtml(gm.prompt(AIM)).muted, true);
  g.setBag(bagWith([{ kind: 'seaweed', count: 1 }]));
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Bait with seaweed');
  assert.deepEqual(promptFromHtml(gm.prompt(AIM)), { key: 'E', label: 'Bait with seaweed' });
  gm.interact(AIM); assert.deepEqual(g.actions.at(-1), { kind: 'fishtrap.bait', x: 1, z: 0 });
  gm.load({ ...data, r: 8, t: { '1,0': { f: [], w: 75, b: 3 } } }, 'net');
  assert.equal(gm.prompt(AIM), 'Fish trap (baited): waiting… 50%');
  const n0 = g.actions.length; gm.interact(AIM); assert.equal(g.actions.length, n0); assert.equal(g.notices.at(-1), 'No fish in the trap yet');
  // guests never tick
  gm.update(100); assert.deepEqual(gm.debug.state().t, { '1,0': { f: [], w: 75, b: 3 } });
  // old host
  gm.load(undefined, 'net'); gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(AIM), true);
  assert.equal(g.actions.length, sent, 'an old host never gets fishtrap.*');
  assert.equal(g.notices.at(-1), OLD_HOST);
  // looking away: no target
  assert.equal(gm.prompt({ dir: { x: -1, y: 0, z: 0 } }), null);
  assert.equal(gm.interact({ dir: { x: -1, y: 0, z: 0 } }), false);
});

test('module: host ticks at 1 Hz, full notice once; inner trap prompt', () => {
  const { ctx, emits } = modCtx();
  const m = F.createFishTrap(ctx); m.load(undefined, 'save');
  assert.equal(m.prompt(AIM), 'Fish trap: waiting… 0% · seaweed makes good bait');
  for (let i = 0; i < 120 * 60; i++) m.update(1 / 60);
  assert.equal(m.prompt(AIM), 'Fish trap: waiting… 50% · seaweed makes good bait');
  for (let i = 0; i < 3 * CATCH_SEC; i++) m.update(1);
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Collect fish (3) · full');
  assert.deepEqual(emits.map(e => e[0].text), ['A fish trap is full']);
  assert.equal(emits[0][1], 'all');
  // an inner trap (floor built around it later)
  ctx.world.tiles.push([2, 0], [2, 1], [2, -1]);
  ctx.world.tiles.splice(0); ctx.world.tiles.push(...Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2]));
  ctx.world.decor = [trap(0, 0)]; ctx.physics = { x: 0, z: 0 }; ctx.camera.position = { x: 0, y: 1.7, z: 1.5 };
  m.load(undefined, 'save');
  assert.equal(m.prompt({ dir: { x: 0, y: -1.65 / Math.hypot(1.65, 1.5), z: -1.5 / Math.hypot(1.65, 1.5) } }), F.NOT_EDGE);
});

const sizeOf = g => { g.updateMatrixWorld(true); return new T.Box3().setFromObject(g); };

test('model: parts, paint, bounds', () => {
  const g = M.createFishTrap(T);
  assert.equal(g.name, 'craft_fishtrap');
  const hang = g.getObjectByName('hang'), fish = g.getObjectByName('fish');
  assert.ok(hang && fish); assert.equal(fish.visible, false);
  M.paintTrap(g, true, 1.2, .5); assert.equal(fish.visible, true);
  M.paintTrap(g, false, 1.3, .5); assert.equal(fish.visible, false);
  M.paintTrap(g, false, 0, 0);
  const t0 = g.getObjectByName('tail0'), t1 = g.getObjectByName('tail1'), bait = g.getObjectByName('bait');
  assert.ok(t0 && t1 && bait); assert.equal(t0.visible || t1.visible || bait.visible, false);
  M.paintTrap(g, { n: 1, full: false, baited: false }, .4, .5);
  assert.deepEqual([t0.visible, t1.visible, fish.visible, bait.visible], [true, false, false, false], 'one fish: a tail pokes out');
  M.paintTrap(g, { n: 3, full: true, baited: true }, .5, .5);
  assert.deepEqual([t0.visible, t1.visible, fish.visible, bait.visible], [true, true, true, true], 'full + baited');
  M.paintTrap(g, { n: 0, full: false, baited: true }, .6, .5, false);
  assert.deepEqual([t0.visible, t1.visible, fish.visible, bait.visible], [false, false, false, true], 'baited, empty; cues update even when not moving');
  M.paintTrap(g, false, 0, 0);
  const basket = g.getObjectByName('basket'); g.updateMatrixWorld(true);
  const bb = new T.Box3().setFromObject(basket), c = bb.getCenter(new T.Vector3());
  assert.ok(bb.min.y < -.3, `basket bottom ${bb.min.y}`);
  assert.ok(c.z > 1, `basket centre z ${c.z}`);
  const s = sizeOf(g).getSize(new T.Vector3());
  assert.ok(s.x <= .7 && s.y <= 1.2 && s.z <= 1.6, `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  const m = F.createFishTrap({ T, world: { decor: [], tiles: [] }, role: 'solo' });
  assert.equal(m.decorModel('fishtrap').name, 'craft_fishtrap');
  assert.equal(m.decorModel('palm'), null);
});

test('items: fishtrap recipe, placeable, bag round trip', () => {
  const it = ITEMS.fishtrap; assert.ok(it); assert.ok(ITEM_INFO.fishtrap);
  assert.equal(it.placeable, true); assert.equal(BLOCK_RADII.fishtrap, .2);
  assert.deepEqual({ ...it.recipe.cost }, { wood: 3, rope: 3, leaf: 2 });
  const bag = bagWith([{ kind: 'wood', count: 3 }, { kind: 'rope', count: 3 }, { kind: 'leaf', count: 2 }]);
  assert.equal(bag.canCraft('fishtrap').ok, true); assert.ok(bag.craft('fishtrap')); assert.equal(bag.count('fishtrap'), 1);
  assert.equal(new Bag(bag.snapshot()).count('fishtrap'), 1);
});
