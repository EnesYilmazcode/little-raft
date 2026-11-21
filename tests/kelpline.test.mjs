// Unit tests for dist/kelpline-core.js, dist/kelpline.js and dist/kelpline-model.js (Kelp Line, docs/specs/kelp.md).
// Run: node --test tests/kelpline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const K = await import(new URL('kelpline-core.js', base));
const Mod = await import(new URL('kelpline.js', base));
const M = await import(new URL('kelpline-model.js', base));
const { seaweedGeometry } = await import(new URL('seafloor.js', base));
const { Bag, SLOT_COUNT, ITEM_INFO } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII } = await import(new URL('items.js', base));
const { promptFromHtml } = await import(new URL('prompts.js', base));
const { BLOCK_TEXT } = await import(new URL('build-rules.js', base));
const book = await import(new URL('craft-book.js', base));
const { cleanKelp, tickKelp, kelpInfo, harvest, stageOf, yieldFor, LEAFY_AT, LUSH_AT, MAX_TICK, OLD_HOST, NOT_EDGE } = K;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
const grid = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]); // 3x3 raft, centre 0,0
const line = (x, z, rot) => (rot ? { type: 'kelpline', x, z, rot } : { type: 'kelpline', x, z });
const fresh = () => cleanKelp(undefined, []);
const DEF = { v: 1, s: '', r: 0, t: {} };
const run = (st, tiles, decor, sec, sunny = false) => { for (let i = 0; i < sec; i++) tickKelp(st, tiles, decor, 1, sunny); };

test('cleanKelp: junk gives defaults; bad keys and values dropped or clamped; no-decor tiles pruned; inner kept', () => {
  for (const v of [undefined, null, [], 'x', 3, { t: [] }, { t: 'x' }]) assert.deepEqual(cleanKelp(v, [line(1, 0)]), DEF);
  assert.equal(cleanKelp({ s: 'x'.repeat(33) }, []).s, '');
  assert.equal(cleanKelp({ r: -1 }, []).r, 0); assert.equal(cleanKelp({ r: 1.5 }, []).r, 0);
  const decor = [line(1, 0), line(-1, 0), line(0, 0), line(0, 1), line(1, 1), line(-1, -1), { type: 'palm', x: 1, z: -1 }];
  const st = cleanKelp({ v: 1, s: 'abc', r: 4, t: {
    '1,0': 100.7, '-1,0': 99999, '0,0': 300, '0,1': 0, '1,1': -5, '-1,-1': 'x', '1,-1': 50, '9,9': 50, 'a,b': 5, '01,0': 5,
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 4);
  assert.deepEqual(st.t, { '1,0': 100, '-1,0': LUSH_AT, '0,0': 300 });
  assert.deepEqual(cleanKelp({ t: { '1,0': NaN, '-1,0': Infinity } }, decor).t, {});
});

test('tick: stages at 60 s / 180 s, sunny 144 s, r bumps per stage, frozen inner line, dt clamp, determinism', () => {
  const tiles = grid(), decor = [line(1, 0)];
  let st = fresh();
  run(st, tiles, decor, 59); assert.equal(stageOf(st.t['1,0']), 0); assert.equal(st.r, 0, 'no bump within a stage');
  let r = tickKelp(st, tiles, decor, 1); assert.equal(stageOf(st.t['1,0']), 1); assert.equal(st.t['1,0'], LEAFY_AT); assert.deepEqual(r.ripe, []);
  run(st, tiles, decor, 119); assert.equal(stageOf(st.t['1,0']), 1);
  r = tickKelp(st, tiles, decor, 1); assert.equal(stageOf(st.t['1,0']), 2); assert.deepEqual(r.ripe, ['1,0']);
  assert.equal(st.r, 2, 'exactly two bumps over a full grow');
  for (let i = 0; i < 1e5 / 60; i++) tickKelp(st, tiles, decor, 60);
  assert.equal(st.t['1,0'], LUSH_AT); assert.equal(st.r, 2, 'a Lush line stays Lush, no more bumps');
  // sunny
  st = fresh(); run(st, tiles, decor, 143, true); assert.equal(stageOf(st.t['1,0']), 1);
  tickKelp(st, tiles, decor, 1, true); assert.equal(stageOf(st.t['1,0']), 2);
  // inner line: frozen, g kept
  st = fresh(); st.t['0,0'] = 300;
  run(st, tiles, [line(0, 0)], 500); assert.deepEqual(st.t, { '0,0': 300 }); assert.equal(st.r, 0);
  // dt
  st = fresh();
  tickKelp(st, tiles, decor, .9); assert.deepEqual(st.t, {});
  tickKelp(st, tiles, decor, NaN); tickKelp(st, tiles, decor, -3); assert.deepEqual(st.t, {});
  tickKelp(st, tiles, decor, 1e6); assert.equal(st.t['1,0'], MAX_TICK * K.GROW_PTS);
  // prune bumps r
  const r0 = st.r; tickKelp(st, tiles, [], 0); assert.deepEqual(st.t, {}); assert.equal(st.r, r0 + 1);
  // determinism in decor order
  const mk = () => [line(1, 0), line(-1, 1), line(0, -1), line(0, 0), line(1, 0)];
  const a = fresh(), b = fresh(), seq = [.5, 1, 7.3, 60, 3, 0, 59.99, 33];
  for (let k = 0; k < 10; k++) for (const dt of seq) { tickKelp(a, tiles, mk(), dt, k % 2 === 0); tickKelp(b, tiles, mk(), dt, k % 2 === 0); }
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.t), ['1,0', '-1,1', '0,-1']);
});

test('harvest: all or nothing; fish trap bonus at a diagonal neighbour only; blocked Lush still harvests', () => {
  const decor = [line(1, 0)], st = fresh();
  assert.equal(harvest(st, decor, '1,0', bagWith([])).reason, 'notripe');
  st.t['1,0'] = LEAFY_AT; assert.deepEqual(harvest(st, decor, '1,0', bagWith([])), { ok: false, reason: 'notripe', text: 'Still growing' });
  assert.deepEqual(harvest(st, decor, '0,0', bagWith([])), { ok: false, reason: 'notarget', text: 'Nothing to harvest' });
  assert.equal(harvest(st, decor, 'zz', bagWith([])).reason, 'notarget');
  st.t['1,0'] = LUSH_AT;
  const fb = fullBag(), snap = JSON.stringify(fb.snapshot());
  assert.deepEqual(harvest(st, decor, '1,0', fb), { ok: false, reason: 'full', text: 'Your bag is full' });
  assert.equal(JSON.stringify(fb.snapshot()), snap); assert.equal(st.t['1,0'], LUSH_AT);
  const bag = bagWith([{ kind: 'wood', count: 1 }]);
  assert.deepEqual(harvest(st, decor, '1,0', bag), { ok: true, n: 2, text: '+ 2 seaweed from the kelp line' });
  assert.equal(bag.count('seaweed'), 2); assert.equal('1,0' in st.t, false, 'back to Bare');
  // trap bonus
  const near = [line(1, 0), { type: 'fishtrap', x: 0, z: 1 }], far = [line(1, 0), { type: 'fishtrap', x: -1, z: 0 }];
  assert.equal(yieldFor(near, 1, 0), 3); assert.equal(yieldFor(far, 1, 0), 2);
  assert.equal(yieldFor([line(1, 0), { type: 'fishtrap', x: 1, z: 0 }], 1, 0), 2, 'not the same tile');
  st.t['1,0'] = LUSH_AT; const b3 = bagWith([]); assert.equal(harvest(st, near, '1,0', b3).n, 3); assert.equal(b3.count('seaweed'), 3);
  assert.equal(kelpInfo(st, grid(), near, 1, 0).bonus, true);
  // blocked (inner) Lush line
  st.t['0,0'] = LUSH_AT; const inner = [line(0, 0)];
  assert.equal(kelpInfo(st, grid(), inner, 0, 0).edge, false);
  assert.equal(harvest(st, inner, '0,0', bagWith([])).ok, true);
});

// player at tile 1,0's rim; the line there hangs out over +x (overhang point 3.2, 0)
const AIM = (() => { const v = [3.2 - 2, .05 - 1.7, 0], l = Math.hypot(...v); return { dir: { x: v[0] / l, y: v[1] / l, z: v[2] / l } }; })();
function modCtx(role = 'solo') {
  const world = { tiles: grid(), decor: [line(1, 0)] };
  const emits = [], notices = [], actions = [];
  const ctx = { T: null, world, role, running: true, physics: { x: 2, z: 0 }, other: { x: 50, z: 50 }, camera: { position: { x: 2, y: 1.7, z: 0 } }, raft: null, elapsed: 0,
    localBag: () => bagWith([]), emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions };
}

test('module: placeBlock, action validation, harvest emits, undecor hooks', () => {
  const { ctx, emits } = modCtx();
  const m = Mod.createKelpLine(ctx);
  assert.equal(m.name, 'kelpline');
  assert.equal(m.placeBlock('kelpline', 0, 0), 'kelpedge'); assert.ok(BLOCK_TEXT.kelpedge);
  assert.equal(m.placeBlock('kelpline', 1, 1), null); assert.equal(m.placeBlock('palm', 0, 0), null);
  m.load({ v: 1, s: 'x', r: 1, t: { '1,0': LUSH_AT } }, 'save');
  const bag = bagWith([]), snap = JSON.stringify(bag.snapshot()), st0 = JSON.stringify(m.debug.state());
  assert.equal(m.action({ kind: 'kelpline.harvest', x: 1.5, z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'kelpline.harvest', x: '1', z: 0 }, 'host', bag), true);
  assert.equal(m.action({ kind: 'kelpline.harvest', x: 1, z: 0 }, 'guest', bag), true, 'guest far away');
  assert.equal(m.action({ kind: 'kelpline.harvest', x: 0, z: 0 }, 'host', bag), true, 'no line');
  assert.equal(m.action({ kind: 'kelpline.nope', x: 1, z: 0 }, 'host', bag), true);
  assert.equal(JSON.stringify(bag.snapshot()), snap); assert.equal(JSON.stringify(m.debug.state()), st0); assert.equal(emits.length, 0);
  assert.equal(m.action({ kind: 'fishtrap.collect', x: 1, z: 0 }, 'host', bag), false);
  // undecor loot while Lush, without mutating
  assert.deepEqual(m.undecorLoot(line(1, 0)), [['seaweed', 2]]); assert.equal(JSON.stringify(m.debug.state()), st0);
  assert.deepEqual(m.undecorLoot({ type: 'palm', x: 1, z: 0 }), []);
  assert.equal(m.beforeUndecor(line(1, 0)), null);
  // guest close by harvests
  ctx.other = { x: 2.2, z: .3 };
  assert.equal(m.action({ kind: 'kelpline.harvest', x: 1, z: 0 }, 'guest', bag), true);
  assert.equal(bag.count('seaweed'), 2);
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+ 2 seaweed from the kelp line', loot: { seaweed: 2 } }, 'guest']);
  assert.deepEqual(m.undecorLoot(line(1, 0)), [], 'Bare: only the item comes back');
  m.action({ kind: 'kelpline.harvest', x: 1, z: 0 }, 'host', bag);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: 'Still growing' }, 'host']);
  m.debug.ripen('1,0'); m.action({ kind: 'kelpline.harvest', x: 1, z: 0 }, 'host', fullBag());
  assert.deepEqual(emits.at(-1), [{ kind: 'full', text: 'Your bag is full' }, 'host']);
  // afterUndecor
  const r = m.debug.state().r; m.afterUndecor(line(1, 0));
  assert.deepEqual(m.debug.state().t, {}); assert.equal(m.debug.state().r, r + 1);
  m.afterUndecor({ type: 'palm', x: 1, z: 0 }); assert.equal(m.debug.state().r, r + 1, 'other types ignored');
});

test('module: serialize carries growth while r stays; host 1 Hz tick; prompts', () => {
  const { ctx, emits, actions, notices } = modCtx();
  const m = Mod.createKelpLine(ctx); m.load(undefined, 'save');
  const r0 = m.serialize().r;
  assert.equal(m.prompt(AIM), 'Kelp line: Bare… 0%');
  assert.equal(promptFromHtml(m.prompt(AIM)).muted, true);
  m.update(1);
  const s1 = m.serialize(); assert.equal(s1.t['1,0'], K.GROW_PTS); assert.equal(s1.r, r0, 'growth within a stage does not bump r');
  assert.equal(m.serialize(), s1, 'cached until something changes');
  for (let i = 0; i < 60 * 30; i++) m.update(1 / 30);
  assert.equal(m.prompt(AIM), 'Kelp line: Leafy… 33%');
  assert.equal(m.interact(AIM), true); assert.equal(notices.at(-1), 'Still growing'); assert.equal(actions.length, 0);
  for (let i = 0; i < 130; i++) m.update(1);
  assert.deepEqual(emits.map(e => e[0].text), ['A kelp line is lush']); assert.equal(emits[0][1], 'all');
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Harvest seaweed (2)');
  assert.deepEqual(promptFromHtml(m.prompt(AIM)), { key: 'E', label: 'Harvest seaweed (2)' });
  m.interact(AIM); assert.deepEqual(actions.at(-1), { kind: 'kelpline.harvest', x: 1, z: 0 });
  // looking away
  assert.equal(m.prompt({ dir: { x: -1, y: 0, z: 0 } }), null); assert.equal(m.interact({ dir: { x: -1, y: 0, z: 0 } }), false);
  // sunshine from link(env) + daynight rain
  const dn = { name: 'daynight', rain: 0 };
  const m2 = Mod.createKelpLine(ctx, name => (name === 'daynight' ? dn : null)); m2.link({ night: () => 0, wind: () => .1 }); m2.load(undefined, 'save');
  m2.update(1); assert.equal(m2.debug.state().t['1,0'], K.SUN_PTS);
  dn.rain = .5; m2.update(1); assert.equal(m2.debug.state().t['1,0'], K.SUN_PTS + K.GROW_PTS);
  dn.rain = NaN; m2.update(1); assert.equal(m2.debug.state().t['1,0'], K.SUN_PTS + 2 * K.GROW_PTS);
  // a line closed in by floor
  ctx.world.tiles.splice(0); ctx.world.tiles.push(...Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2]));
  m.load({ v: 1, s: 'q', r: 1, t: { '1,0': 300 } }, 'save');
  assert.equal(m.prompt(AIM), null, 'no open side: aims at the tile centre, not the overhang');
  ctx.camera.position = { x: 2, y: 1.7, z: 1.5 }; ctx.physics = { x: 2, z: 1.5 };
  const v = [0, -1.65, -1.5], l = Math.hypot(...v), down = { dir: { x: 0, y: v[1] / l, z: v[2] / l } };
  assert.equal(m.prompt(down), NOT_EDGE);
  m.update(5); assert.equal(m.debug.state().t['1,0'], 300, 'frozen');
  m.debug.ripen('1,0'); assert.equal(m.prompt(down), '<kbd>E</kbd>Harvest seaweed (2)');
});

test('module: guest net load, OLD_HOST guard, guests never tick', () => {
  const g = modCtx('guest');
  const gm = Mod.createKelpLine(g.ctx);
  const data = { v: 1, s: 'host1', r: 5, t: { '1,0': 300 } };
  gm.load(data, 'net');
  const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net'); gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  assert.equal(gm.prompt(AIM), 'Kelp line: Leafy…', 'guests show the stage only');
  gm.update(100); assert.deepEqual(gm.debug.state().t, { '1,0': 300 });
  gm.load({ ...data, r: 6, t: { '1,0': LUSH_AT } }, 'net');
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Harvest seaweed (2)');
  gm.interact(AIM); assert.deepEqual(g.actions.at(-1), { kind: 'kelpline.harvest', x: 1, z: 0 });
  gm.load(undefined, 'net'); gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(AIM), true); assert.equal(g.actions.length, sent, 'an old host never gets kelpline.*');
  assert.equal(g.notices.at(-1), OLD_HOST);
});

const sizeOf = g => { g.updateMatrixWorld(true); return new T.Box3().setFromObject(g); };

test('model: floats, strands, tuft, paint, bounds; module decorModel', () => {
  const weed = seaweedGeometry(T);
  const g = M.createKelpLine(T, weed);
  assert.equal(g.name, 'craft_kelpline');
  const floats = g.getObjectByName('floats'), strands = g.getObjectByName('strands'), tuft = g.getObjectByName('tuft');
  assert.ok(floats && strands && tuft); assert.equal(floats.children.length, 3); assert.equal(strands.children.length, 3);
  assert.equal(tuft.visible, false);
  const s = sizeOf(g).getSize(new T.Vector3());
  assert.ok(s.x <= .6 && s.y <= 1.0 && s.z <= 2.2, `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  const c = new T.Box3().setFromObject(floats).getCenter(new T.Vector3()); assert.ok(c.z > 1, `floats centre z ${c.z}`);
  const len0 = strands.children[0].scale.y;
  M.paintKelp(g, 2, 1.2, .5); assert.equal(tuft.visible, true); assert.ok(strands.children[0].scale.y > len0);
  M.paintKelp(g, 1, 1.3, .5, false); assert.equal(tuft.visible, false); assert.equal(g.getObjectByName('sprig').visible, true, 'Leafy: a sprig above the water');
  M.paintKelp(g, 0, 1.3, .5, false); assert.equal(g.getObjectByName('sprig').visible, false);
  const y0 = floats.children[0].position.y; M.paintKelp(g, 1, 7, .5); assert.notEqual(floats.children[0].position.y, y0);
  assert.equal(strands.children[0].position.y, floats.children[0].position.y, 'strands follow their float');
  const m = Mod.createKelpLine({ T, world: { decor: [], tiles: [] }, role: 'solo' });
  const a = m.decorModel('kelpline'), b = m.decorModel('kelpline');
  assert.equal(a.name, 'craft_kelpline'); assert.equal(m.decorModel('palm'), null);
  assert.equal(a.getObjectByName('strand0').geometry, b.getObjectByName('strand0').geometry, 'one shared seaweed geometry');
  assert.equal(a.getObjectByName('strand0').geometry.userData.shared, true);
});

test('items: kelpline recipe, unlock, radius, book text, seaweed source', () => {
  const it = ITEMS.kelpline; assert.ok(it); assert.ok(ITEM_INFO.kelpline);
  assert.equal(it.placeable, true); assert.equal(BLOCK_RADII.kelpline, .2);
  assert.deepEqual({ ...it.recipe.cost }, { wood: 2, rope: 3, plastic: 1 });
  assert.deepEqual(it.unlock, { type: 'discover', items: ['seaweed'] });
  const bag = bagWith([{ kind: 'wood', count: 2 }, { kind: 'rope', count: 3 }, { kind: 'plastic', count: 1 }]);
  assert.equal(bag.canCraft('kelpline').ok, true); assert.ok(bag.craft('kelpline')); assert.equal(bag.count('kelpline'), 1);
  assert.deepEqual(book.ITEM_TEXT.kelpline, { desc: 'A float line with seaweed strands.', use: 'Place on an edge tile. Harvest lush seaweed with E.' });
  assert.equal(book.categoryOf('kelpline'), 'survival');
  assert.match(book.ITEM_TEXT.seaweed.use, /mulch for a crop plot/);
  const seaweed = book.sourceOf('seaweed', []); assert.match(seaweed.how, /Kelp Line/); assert.equal(seaweed.tag, 'barrels');
});
