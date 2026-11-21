// Unit tests for dist/juicer.js (juicer and fruit smoothies) and dist/juicer-model.js.
// Run: node --test tests/juicer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const J = await import(new URL('juicer.js', base));
const M = await import(new URL('juicer-model.js', base));
const V = await import(new URL('vitals.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII, PLACEABLE_IDS, STATION_IDS } = await import(new URL('items.js', base));
const { MIXES, pickMix, blend, cleanJuicer, OLD_HOST, SPIN_SECONDS } = J;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const snap = b => JSON.stringify(b.snapshot());
const counter = o => k => o[k] ?? 0;
// camera at (0, 1.7, 3) looking at the juicer (y .5) on tile 0,0
const AIM = { dir: { x: 0, y: -1.2 / Math.hypot(1.2, 3), z: -3 / Math.hypot(1.2, 3) } };
const juicer = (x = 0, z = 0) => ({ type: 'juicer', x, z });

test('blend: each mix turns 1 freshcup and its fruit into 1 cup; failures change nothing', () => {
  for (const [id, mix] of Object.entries(MIXES)) {
    const slots = [{ kind: 'freshcup', count: 1 }];
    for (const [k, n] of Object.entries(mix.take)) slots.push({ kind: k, count: n });
    const bag = bagWith(slots);
    const r = blend(bag, id);
    assert.deepEqual(r, { ok: true, out: mix.out, text: '+ 1 ' + ITEMS[mix.out].name }, id);
    assert.equal(bag.count(mix.out), 1); assert.equal(bag.count('freshcup'), 0);
    assert.equal(bag.count('berries') + bag.count('coconut'), 0);
  }
  let bag = bagWith([{ kind: 'berries', count: 5 }]), before = snap(bag);
  assert.equal(blend(bag, 'berry').reason, 'nocup'); assert.equal(blend(bag, 'berry').text, 'You need a cup of fresh water'); assert.equal(snap(bag), before);
  bag = bagWith([{ kind: 'freshcup', count: 1 }, { kind: 'berries', count: 1 }]); before = snap(bag);
  assert.equal(blend(bag, 'berry').reason, 'nofruit'); assert.equal(blend(bag, 'mixed').reason, 'nofruit'); assert.equal(snap(bag), before);
  assert.equal(blend(bag, 'nope').reason, 'bad'); assert.equal(blend(bag, '__proto__').reason, 'bad'); assert.equal(blend(null, 'berry').reason, 'bad');
  const full = Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 }));
  full[0] = { kind: 'freshcup', count: 2 }; full[1] = { kind: 'berries', count: 3 };
  bag = bagWith(full); before = snap(bag);
  assert.deepEqual(blend(bag, 'berry'), { ok: false, reason: 'full', text: 'Your bag is full' });
  assert.equal(snap(bag), before);
});

test('pickMix table', () => {
  assert.equal(pickMix(counter({ freshcup: 1, berries: 1, coconut: 1 }), 'berries'), 'mixed');
  assert.equal(pickMix(counter({ freshcup: 1, berries: 3 }), 'berries'), 'berry');
  assert.equal(pickMix(counter({ freshcup: 1, berries: 3, coconut: 3 }), 'coconut'), 'coconut');
  assert.equal(pickMix(counter({ freshcup: 1, berries: 3, coconut: 1 }), 'coconut'), 'mixed');
  assert.equal(pickMix(counter({ berries: 3, coconut: 3 }), 'berries'), null);
  assert.equal(pickMix(counter({ freshcup: 1, berries: 1 }), 'berries'), null);
  assert.equal(pickMix(counter({ freshcup: 1, berries: 3, coconut: 3 }), 'freshcup'), 'mixed');
  assert.equal(pickMix(counter({ freshcup: 1, berries: 3 }), null), 'berry');
  assert.equal(pickMix(counter({ freshcup: 1, coconut: 2 }), 'hook'), 'coconut');
});

test('cleanJuicer: junk gives defaults; bad keys, mixes, floats and non-juicer tiles dropped', () => {
  for (const v of [undefined, null, [], 'x', 3, { j: [] }, { j: 'x' }]) assert.deepEqual(cleanJuicer(v, [juicer()]), { v: 1, s: '', r: 0, j: {} });
  const decor = [juicer(0, 0), juicer(1, 0), juicer(-2, 3), juicer(4, 4), juicer(5, 5), juicer(6, 6), { type: 'beehive', x: 2, z: 2 }];
  const st = cleanJuicer({ v: 1, s: 'abc', r: 7, j: {
    '0,0': { m: 'berry', n: 3 }, '1,0': { m: 'mixed', n: 9999 }, '-2,3': { m: 'coconut', n: 0 }, '4,4': { m: 'nope', n: 1 },
    '5,5': { m: 'berry', n: 1.5 }, '6,6': { m: '__proto__', n: 1 }, '2,2': { m: 'berry', n: 1 }, '9,9': { m: 'berry', n: 1 },
    'a,b': { m: 'berry', n: 1 }, '01,0': { m: 'berry', n: 1 }, '0,1': 'x',
  } }, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7);
  assert.deepEqual(st.j, { '0,0': { m: 'berry', n: 3 }, '1,0': { m: 'mixed', n: 9999 }, '-2,3': { m: 'coconut', n: 0 } });
  assert.deepEqual(cleanJuicer({ j: { '0,0': { m: 'berry', n: 10000 } } }, decor).j, {});
});

function modCtx(role = 'solo', bag = null) {
  const world = { decor: [juicer(0, 0), { type: 'palm', x: 1, z: 0 }], tiles: [[0, 0], [1, 0], [2, 0]] };
  const emits = [], notices = [], actions = [];
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, other: { x: 50, z: 50 }, camera: { position: { x: 0, y: 1.7, z: 3 } }, raft: null, elapsed: 0,
    localBag: () => bag, emit: (e, to) => emits.push([e, to]), notice: s => notices.push(s), action: a => actions.push(a) };
  return { ctx, emits, notices, actions };
}

test('module: action validation, blend count, net caching, OLD_HOST and spin', () => {
  const { ctx, emits } = modCtx();
  const m = J.createJuicer(ctx);
  assert.equal(m.name, 'juicer');
  m.load(undefined, 'save');
  const bag = bagWith([{ kind: 'freshcup', count: 3 }, { kind: 'berries', count: 6 }]), before = snap(bag);
  const r0 = m.debug.state().r;
  for (const a of [{ kind: 'juicer.blend', x: 0.5, z: 0, mix: 'berry' }, { kind: 'juicer.blend', x: '0', z: 0, mix: 'berry' },
    { kind: 'juicer.blend', x: 1, z: 0, mix: 'berry' }, { kind: 'juicer.blend', x: 0, z: 0, mix: 'nope' },
    { kind: 'juicer.blend', x: 0, z: 0, mix: '__proto__' }, { kind: 'juicer.blend', x: 0, z: 0, mix: 'constructor' }, { kind: 'juicer.zap', x: 0, z: 0 }]) {
    assert.equal(m.action(a, 'host', bag), true, JSON.stringify(a));
  }
  assert.equal(m.action({ kind: 'juicer.blend', x: 0, z: 0, mix: 'berry' }, 'guest', bag), true); // guest is far away
  assert.equal(snap(bag), before); assert.equal(m.debug.state().r, r0); assert.equal(emits.length, 0);
  assert.equal(m.action({ kind: 'bees.harvest' }, 'host', bag), false);
  m.update(0.016); // first look: no spin
  assert.deepEqual(m.debug.spinning(), {});
  assert.equal(m.action({ kind: 'juicer.blend', x: 0, z: 0, mix: 'berry' }, 'host', bag), true);
  assert.equal(bag.count('berrycup'), 1);
  assert.deepEqual(m.debug.state().j['0,0'], { m: 'berry', n: 1 });
  assert.deepEqual(emits.at(-1), [{ kind: 'loot', text: '+ 1 Berry Smoothie', loot: { berrycup: 1 } }, 'host']);
  m.update(0.1); assert.ok('0,0' in m.debug.spinning(), 'a changed n spins');
  for (let i = 0; i < 20; i++) m.update(0.1);
  assert.deepEqual(m.debug.spinning(), {}, 'the spin ends');
  ctx.other = { x: 1, z: 0 };
  assert.equal(m.action({ kind: 'juicer.blend', x: 0, z: 0, mix: 'mixed' }, 'guest', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: 'You need 2 fruit' }, 'guest']);
  const s1 = m.serialize(); assert.equal(m.serialize(), s1);
  // the host prunes an entry whose juicer is gone
  ctx.world.decor.splice(0, 1); m.update(1.1); assert.deepEqual(m.debug.state().j, {});

  // guest side
  const gb = bagWith([{ kind: 'freshcup', count: 1 }, { kind: 'coconut', count: 1 }, { kind: 'berries', count: 1 }]);
  const g = modCtx('guest', gb);
  const gm = J.createJuicer(g.ctx);
  const data = { v: 1, s: 'host1', r: 5, j: { '0,0': { m: 'coconut', n: 4 } } };
  gm.load(data, 'net'); gm.update(0.016);
  assert.deepEqual(gm.debug.spinning(), {}, 'a first-seen entry does not spin');
  const ref = gm.debug.state();
  gm.load(JSON.parse(JSON.stringify(data)), 'net'); gm.load(JSON.parse(JSON.stringify(data)), 'net');
  assert.deepEqual(gm.debug.state(), ref);
  gm.update(0.016); assert.deepEqual(gm.debug.spinning(), {});
  assert.equal(gm.prompt(AIM), '<kbd>E</kbd>Blend an island smoothie');
  assert.equal(gm.interact(AIM), true);
  assert.deepEqual(g.actions.at(-1), { kind: 'juicer.blend', x: 0, z: 0, mix: 'mixed' });
  gm.load({ ...data, r: 6, j: { '0,0': { m: 'mixed', n: 5 } } }, 'net'); gm.update(0.016);
  assert.ok('0,0' in gm.debug.spinning(), 'a synced n change spins on the guest');
  gm.load(undefined, 'net');
  assert.equal(gm.prompt(AIM), OLD_HOST);
  const sent = g.actions.length;
  assert.equal(gm.interact(AIM), true);
  assert.equal(g.actions.length, sent, 'an old host never gets juicer.blend');
  assert.equal(g.notices.at(-1), OLD_HOST);
});

test('module: prompts and hints follow the bag', () => {
  let bag = bagWith([]);
  const { ctx, notices, actions } = modCtx('solo');
  ctx.localBag = () => bag;
  const m = J.createJuicer(ctx); m.load(undefined, 'save');
  assert.equal(m.prompt(AIM), 'Juicer: needs a cup of fresh water and 2 fruit');
  assert.equal(m.interact(AIM), true); assert.equal(notices.at(-1), 'Juicer: needs a cup of fresh water and 2 fruit'); assert.equal(actions.length, 0);
  bag = bagWith([{ kind: 'freshcup', count: 1 }, { kind: 'berries', count: 1 }]);
  assert.equal(m.prompt(AIM), 'Juicer: needs 2 fruit (berries or coconut)');
  bag = bagWith([{ kind: 'freshcup', count: 1 }, { kind: 'berries', count: 2 }, { kind: 'coconut', count: 2 }], 1);
  assert.equal(m.prompt(AIM), '<kbd>E</kbd>Blend a berry smoothie');
  bag.select(2); assert.equal(m.prompt(AIM), '<kbd>E</kbd>Blend a coconut smoothie');
  ctx.physics = { x: 20, z: 0 }; assert.equal(m.prompt(AIM), null); assert.equal(m.interact(AIM), false);
});

test('drinking a smoothie hands the cup back', () => {
  const v = V.newVitals({ hp: 100, food: 10, water: 10 });
  const e = V.consume(v, 'mixcup');
  assert.equal(e.returns, 'cup'); assert.equal(v.food, 24); assert.equal(v.water, 48);
  for (const k of ['berrycup', 'coconutcup', 'mixcup']) assert.equal(V.FOOD[k].returns, 'cup');
});

test('model: parts, paint and size', () => {
  const g = M.createJuicerModel(T);
  assert.equal(g.name, 'craft_juicer');
  for (const n of ['crank', 'jar', 'fill', 'splash']) assert.ok(g.getObjectByName(n), n);
  assert.ok(g.getObjectByName('jar').userData.glass);
  M.paintJuicer(g, { m: 'berry', n: 1 }, .3);
  assert.equal(g.getObjectByName('fill').visible, true); assert.equal(g.getObjectByName('splash').visible, true);
  assert.equal(g.getObjectByName('fill').material.color.getHex(), J.JAR_COLOR.berry);
  assert.ok(g.getObjectByName('crank').rotation.x > 0);
  M.paintJuicer(g, { m: 'berry', n: 1 }, SPIN_SECONDS + .1);
  assert.equal(g.getObjectByName('splash').visible, false); assert.equal(g.getObjectByName('fill').visible, true);
  M.paintJuicer(g, { m: 'coconut', n: 2 }, 0);
  assert.equal(g.getObjectByName('fill').material.color.getHex(), J.JAR_COLOR.coconut);
  M.paintJuicer(g, null, 0);
  assert.equal(g.getObjectByName('fill').visible, false); assert.equal(g.getObjectByName('splash').visible, false);
  g.updateMatrixWorld(true);
  const s = new T.Box3().setFromObject(g).getSize(new T.Vector3());
  assert.ok(s.x <= 0.5 && s.y <= 0.8 && s.z <= 0.5, `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  const mod = J.createJuicer({ T, world: { decor: [] }, role: 'solo' });
  assert.equal(mod.decorModel('juicer').name, 'craft_juicer');
  assert.equal(mod.decorModel('beehive'), null);
});

test('items: juicer is placeable decor with its cost; bags accept the new kinds', () => {
  assert.equal(ITEMS.juicer.category, 'decor'); assert.equal(ITEMS.juicer.placeable, true);
  assert.ok(PLACEABLE_IDS.includes('juicer')); assert.ok(!STATION_IDS.includes('juicer'));
  assert.deepEqual({ ...ITEMS.juicer.recipe.cost }, { wood: 4, scrap: 2, rope: 1 });
  assert.equal(BLOCK_RADII.juicer, 0.3);
  const crafter = bagWith([{ kind: 'wood', count: 4 }, { kind: 'scrap', count: 2 }, { kind: 'rope', count: 1 }]);
  assert.ok(crafter.canCraft('juicer').ok); crafter.craft('juicer'); assert.equal(crafter.count('juicer'), 1); assert.equal(crafter.count('wood'), 0);
  for (const k of ['berrycup', 'coconutcup', 'mixcup']) assert.equal(ITEMS[k].stack ?? ITEMS[k].maxStack, 5, k);
  const kinds = ['berries', 'coconut', 'berrycup', 'coconutcup', 'mixcup', 'juicer'];
  const b = new Bag({ slots: Array.from({ length: SLOT_COUNT }, (_, i) => (i < kinds.length ? { kind: kinds[i], count: 1 } : null)), selected: 0 });
  for (const k of kinds) assert.equal(b.count(k), 1, k);
});
