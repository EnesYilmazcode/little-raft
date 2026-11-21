// Unit tests for dist/gull.js (companion gull and gull perch) and dist/gull-models.js.
// Run: node --test tests/gull.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const G = await import(new URL('gull.js', base));
const M = await import(new URL('gull-models.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, BLOCK_RADII, PLACEABLE_IDS } = await import(new URL('items.js', base));
const { cleanGull, firstPerch, target, visitPhase, modeAt, treat, pet, tickGull, collect, rename, gullPose, newPose, createGull,
  OLD_HOST, GULL_NAMES, LOOT, TRAY_MAX, MAX_TICK, VISIT, TREAT_CD, BOND_CD, MAX_HEARTS, BEAT } = G;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
const perch = (x = 0, z = 0) => ({ type: 'perch', x, z });
const fresh = (decor = [perch()]) => { const st = cleanGull(undefined, decor); st.seed = 12345; return st; };
const PERCHED = 30; // visitPhase(30) === 'perched'
const restT = st => { for (let b = 1; b < 1000; b++) if (modeAt(st.seed, b * BEAT) === 'rest' && modeAt(st.seed, b * BEAT - 2) === 'rest') return b * BEAT + 3; throw new Error('no rest beat'); };
const flyT = st => { for (let b = 1; b < 1000; b++) if (modeAt(st.seed, b * BEAT + 5) !== 'rest' && modeAt(st.seed, b * BEAT + 3) !== 'rest') return b * BEAT + 5; throw new Error('no flying beat'); };
const moveIn = (decor = [perch()]) => { const st = fresh(decor); st.moved = true; st.home = [0, 0]; st.name = 'Gully'; return st; };

test('cleanGull: junk gives defaults; values clamped and cleaned; home checked; rehome to firstPerch', () => {
  const d = cleanGull(undefined, []);
  for (const v of [undefined, null, [], 'x', 3]) assert.deepEqual(cleanGull(v, [perch()]), d);
  assert.equal(d.moved, false); assert.equal(d.home, null); assert.equal(d.seed, 0); assert.deepEqual(d.finds, []);
  const st = cleanGull({ r: 3.7, t: 12.345, seed: -5, pts: 9, treatAt: 4.56, moved: false, hearts: 99, fw: -3, n: 2.5, pops: -1,
    finds: ['wood', 'gold', 'rope', 'seed', 'plastic', 'wood'], name: '  <b>Sal\u0007ty</b>  ' }, [perch()]);
  assert.equal(st.r, 3); assert.equal(st.t, 12.3); assert.equal(st.seed, 0); assert.equal(st.pts, 2); assert.equal(st.treatAt, 4.6);
  assert.equal(st.hearts, MAX_HEARTS); assert.equal(st.fw, 0); assert.equal(st.n, 2); assert.equal(st.pops, 0);
  assert.deepEqual(st.finds, ['wood', 'rope', 'seed']); assert.equal(st.name, '<b>Salty</b>');
  // home on a non-perch tile is dropped, then a moved-in gull rehomes to the first perch (lowest x, then z)
  const decor = [{ type: 'crate', x: 0, z: 0 }, perch(2, 1), perch(-1, 3), perch(-1, -2)];
  assert.deepEqual(firstPerch(decor), [-1, -2]);
  const moved = cleanGull({ moved: true, home: [0, 0], seed: 7 }, decor);
  assert.deepEqual(moved.home, [-1, -2]); assert.ok(GULL_NAMES.includes(moved.name));
  assert.deepEqual(cleanGull({ moved: true, home: [2, 1] }, decor).home, [2, 1]);
  assert.equal(cleanGull({ moved: true, home: [0, 0], finds: ['wood'] }, []).home, null);
  assert.deepEqual(cleanGull({ moved: true, home: [0, 0], finds: ['wood'] }, []).finds, ['wood'], 'the tray survives a lost perch');
  assert.equal(cleanGull({ moved: false, home: [2, 1] }, decor).home, null);
  assert.deepEqual(target(cleanGull(undefined, decor), decor), [-1, -2]);
  assert.ok(JSON.stringify(cleanGull({ moved: true, home: [2, 1], name: 'Captain Salty', finds: ['wood', 'rope', 'seed'], seed: 4294967295, t: 1e8 }, decor)).length < 300);
});

test('visitPhase boundaries and modeAt mix', () => {
  assert.equal(visitPhase(19.9), 'away'); assert.equal(visitPhase(20), 'descend'); assert.equal(visitPhase(24), 'perched');
  assert.equal(visitPhase(65.9), 'perched'); assert.equal(visitPhase(66), 'leave'); assert.equal(visitPhase(70), 'away');
  assert.equal(visitPhase(VISIT + 30), 'perched'); assert.equal(visitPhase(-60), 'perched');
  assert.equal(modeAt(1, 0), 'rest'); assert.equal(modeAt(1, 9.9), 'rest');
  const c = { rest: 0, loop: 0, follow: 0 };
  for (let b = 1; b <= 1000; b++) { const m = modeAt(987654, b * BEAT + .5); assert.equal(m, modeAt(987654, b * BEAT + 9)); c[m]++; }
  assert.ok(Math.abs(c.rest - 600) <= 50, `rest ${c.rest}`); assert.ok(Math.abs(c.loop - 300) <= 50, `loop ${c.loop}`); assert.ok(Math.abs(c.follow - 100) <= 50, `follow ${c.follow}`);
});

test('treats before move-in: away, cooldown, notreat, 3 grilled fish or honeyfish + 1', () => {
  const decor = [perch()];
  let st = fresh(decor), bag = bagWith([{ kind: 'cookedfish', count: 5 }, { kind: 'honeyfish', count: 2 }, { kind: 'fish', count: 1 }]);
  st.t = 5;
  assert.equal(treat(st, 'cookedfish', bag, decor).reason, 'away'); assert.equal(bag.count('cookedfish'), 5);
  st.t = PERCHED;
  assert.equal(treat(st, 'fish', bag, decor).reason, 'notreat'); assert.equal(bag.count('fish'), 1);
  let r = treat(st, 'cookedfish', bag, decor); assert.ok(r.ok); assert.equal(st.pts, 1); assert.equal(bag.count('cookedfish'), 4); assert.equal(r.moved, false);
  st.t = PERCHED + 10; assert.equal(treat(st, 'cookedfish', bag, decor).reason, 'cooldown'); assert.equal(bag.count('cookedfish'), 4);
  st.t = VISIT + PERCHED; assert.ok(treat(st, 'cookedfish', bag, decor).ok); assert.equal(st.pts, 2);
  st.t = 2 * VISIT + PERCHED; r = treat(st, 'cookedfish', bag, decor);
  assert.ok(r.ok && r.moved); assert.equal(st.moved, true); assert.deepEqual(st.home, [0, 0]); assert.equal(st.pts, 0); assert.ok(GULL_NAMES.includes(st.name));
  assert.equal(bag.count('cookedfish'), 2);
  // slack: a guest a moment behind still lands it just after the gull starts to leave
  st = fresh(decor); st.t = 67; assert.ok(treat(st, 'honeyfish', bag, decor).ok); assert.equal(st.pts, 2);
  st.t = 67 + TREAT_CD; assert.equal(treat(st, 'honeyfish', bag, decor).reason, 'away');
  st.t = VISIT + PERCHED; r = treat(st, 'cookedfish', bag, decor); assert.ok(r.moved);
  st = fresh(decor); st.t = PERCHED; assert.equal(treat(st, 'cookedfish', bagWith([]), decor).reason, 'nofood');
});

test('after move-in: bond cooldown keeps the fish; pet bumps pops, hearts every 60 s, cap 10', () => {
  const st = moveIn(), bag = bagWith([{ kind: 'cookedfish', count: 3 }]);
  st.t = restT(st); st.bondAt = st.t - 10;
  const r = treat(st, 'cookedfish', bag); assert.equal(r.reason, 'cooldown'); assert.match(r.text, /^Gully is full/); assert.equal(bag.count('cookedfish'), 3);
  st.bondAt = st.t - BOND_CD; assert.ok(treat(st, 'cookedfish', bag).ok); assert.equal(st.hearts, 1); assert.equal(bag.count('cookedfish'), 2);
  const p0 = st.pops; let pr = pet(st); assert.ok(pr.ok); assert.equal(pr.gained, false); assert.equal(st.pops, p0 + 1); assert.equal(st.hearts, 1);
  st.bondAt = st.t - BOND_CD; pr = pet(st); assert.equal(pr.gained, true); assert.equal(st.hearts, 2);
  st.hearts = MAX_HEARTS; st.bondAt = st.t - BOND_CD; pr = pet(st); assert.equal(st.hearts, MAX_HEARTS); assert.equal(pr.gained, false);
  const fly = moveIn(); fly.t = flyT(fly); assert.equal(pet(fly).ok, false); assert.equal(fly.pops, 0);
  assert.equal(pet(fresh()).ok, false);
});

test('finds: 240 s per find (144 s at 10 hearts), cap 3 stops fw, dt clamp, LOOT kinds, deterministic', () => {
  const decor = [perch()];
  let st = moveIn(decor);
  for (let i = 0; i < 239; i++) tickGull(st, decor, 1);
  assert.equal(st.finds.length, 0); assert.equal(st.fw, 239);
  const r0 = st.r; assert.equal(tickGull(st, decor, 1).found.length, 1); assert.equal(st.finds.length, 1); assert.equal(st.fw, 0); assert.equal(st.r, r0 + 1);
  st = moveIn(decor); st.hearts = 10;
  for (let i = 0; i < 143; i++) tickGull(st, decor, 1); assert.equal(st.finds.length, 0);
  tickGull(st, decor, 1); assert.equal(st.finds.length, 1);
  st = moveIn(decor); tickGull(st, decor, 1e6); assert.equal(st.fw, MAX_TICK);
  for (let i = 0; i < 100; i++) tickGull(st, decor, 60);
  assert.equal(st.finds.length, TRAY_MAX); assert.equal(st.fw, 0);
  for (const k of st.finds) assert.ok(LOOT.some(l => l[0] === k));
  const a = moveIn(decor), b = moveIn(decor);
  for (let i = 0; i < 20; i++) { tickGull(a, decor, 60); tickGull(b, decor, 60); }
  assert.deepEqual(a.finds, b.finds);
  const none = fresh(decor); tickGull(none, decor, 60); assert.equal(none.fw, 0, 'no finds before move-in');
  const gone = moveIn(decor); tickGull(gone, [], 60); assert.equal(gone.fw, 0, 'no finds without the perch');
  // the mix over many finds roughly follows the weights
  const c = {}; const big = moveIn(decor);
  for (let i = 0; i < 2000; i++) { big.finds = []; big.fw = 239; tickGull(big, decor, 1); c[big.finds[0]] = (c[big.finds[0]] || 0) + 1; }
  assert.ok(c.wood > c.plastic && c.plastic > c.rope && c.rope > c.seed, JSON.stringify(c));
});

test('collect: all finds land and the tray empties; full bag changes nothing; empty tray', () => {
  const st = moveIn(); st.finds = ['wood', 'rope', 'wood'];
  const bag = bagWith([]);
  const r = collect(st, bag);
  assert.ok(r.ok); assert.equal(r.kind, 'loot'); assert.deepEqual(r.loot, { wood: 2, rope: 1 }); assert.equal(r.text, '+ 2 wood · 1 rope');
  assert.equal(bag.count('wood'), 2); assert.equal(bag.count('rope'), 1); assert.deepEqual(st.finds, []);
  assert.equal(collect(st, bag).reason, 'empty'); assert.equal(collect(st, bag).text, 'The tray is empty');
  st.finds = ['plastic', 'seed']; const fb = fullBag(), snap = JSON.stringify(fb.snapshot());
  const f = collect(st, fb); assert.equal(f.reason, 'full'); assert.equal(f.text, 'Your bag is full');
  assert.equal(JSON.stringify(fb.snapshot()), snap); assert.deepEqual(st.finds, ['plastic', 'seed']);
});

test('rename cleans the name and refuses empty', () => {
  const st = moveIn();
  assert.ok(rename(st, '  Sir​  Flaps  ').ok); assert.equal(st.name, 'Sir Flaps');
  assert.equal(rename(st, ' \u0007 ').ok, false); assert.equal(st.name, 'Sir Flaps');
});

// ------------------------------------------------------------------ module

function harness({ role = 'host', decor = [perch()], held = 'cookedfish', physics = { x: 0, y: 1.8, z: 2 }, other = null } = {}) {
  const emits = [], actions = [], notices = [];
  const bag = bagWith(held ? [{ kind: held, count: 5 }] : []);
  const ctx = {
    role, running: true, world: { tiles: [[0, 0], [1, 0], [0, 1]], decor }, physics, other,
    camera: { position: { x: 0, y: 1.7, z: 2.4 } },
    localBag: () => bag, emit: (e, to) => emits.push({ e, to }), action: a => actions.push(a), notice: s => notices.push(s),
  };
  const mod = createGull(ctx);
  return { ctx, mod, bag, emits, actions, notices };
}
// camera at (0, 1.7, 2.4) looking at the perch post centre (0, .7, 0)
const AIM = { dir: { x: 0, y: -1, z: -2.4 } };

test('module: action validation; name; old host; identical net data is a no-op; host and guest poses agree', () => {
  const h = harness();
  h.mod.load({ seed: 99, t: PERCHED }, 'save');
  const before = JSON.stringify(h.mod.debug.state());
  for (const a of [{ kind: 'gull.treat', x: .5, z: 0, food: 'cookedfish' }, { kind: 'gull.treat', x: 1, z: 0, food: 'cookedfish' }, { kind: 'gull.treat', x: 0, z: 0, food: 'fish' }, { kind: 'gull.dance' }])
    assert.equal(h.mod.action(a, 'host', h.bag), true);
  h.ctx.physics = { x: 20, y: 1.8, z: 0 };
  h.mod.action({ kind: 'gull.treat', x: 0, z: 0, food: 'cookedfish' }, 'host', h.bag);
  assert.equal(JSON.stringify(h.mod.debug.state()), before); assert.equal(h.bag.count('cookedfish'), 5);
  assert.equal(h.mod.action({ kind: 'other.thing' }, 'host', h.bag), false);
  h.ctx.physics = { x: 0, y: 1.8, z: 2 };
  h.mod.action({ kind: 'gull.treat', x: 0, z: 0, food: 'cookedfish' }, 'host', h.bag);
  assert.equal(h.mod.debug.state().pts, 1); assert.equal(h.bag.count('cookedfish'), 4);
  // guest out of reach
  h.ctx.other = { x: 30, z: 0 };
  h.mod.action({ kind: 'gull.pet', x: 0, z: 0 }, 'guest', h.bag); assert.equal(h.mod.debug.state().pops, 1);
  // naming needs a moved-in gull; cleaned; '' refused
  h.mod.action({ kind: 'gull.name', id: 'gull', name: 'Pip' }, 'host', h.bag); assert.equal(h.mod.debug.state().name, '');
  assert.ok(h.mod.debug.befriend());
  h.mod.action({ kind: 'gull.name', id: 'gull', name: '  Pip\u0007 ' }, 'host', h.bag); assert.equal(h.mod.debug.state().name, 'Pip');
  h.mod.action({ kind: 'gull.name', id: 'gull', name: '   ' }, 'host', h.bag); assert.equal(h.mod.debug.state().name, 'Pip');
  // serialize round trip
  const ser = JSON.parse(JSON.stringify(h.mod.serialize()));
  assert.equal(ser.name, 'Pip'); assert.equal(ser.moved, true); assert.ok(JSON.stringify(ser).length < 300);

  // old host: a new guest on a host without the slice
  const g0 = harness({ role: 'guest' });
  g0.mod.load(undefined, 'net');
  assert.equal(g0.mod.prompt(AIM), OLD_HOST);
  assert.equal(g0.mod.interact(AIM), true); assert.deepEqual(g0.actions, []); assert.equal(g0.notices[0], OLD_HOST);

  // identical net data twice is a no-op (a changed body with the same r is ignored)
  const g = harness({ role: 'guest' });
  g.mod.load(ser, 'net'); assert.equal(g.mod.debug.state().name, 'Pip');
  g.mod.load({ ...ser, name: 'Other' }, 'net'); assert.equal(g.mod.debug.state().name, 'Pip');
  g.mod.load({ ...ser, r: ser.r + 1, name: 'Other' }, 'net'); assert.equal(g.mod.debug.state().name, 'Other');
  assert.equal(g.mod.serialize(), undefined, 'guests never serialize');

  // poses: host t and guest clock after snap give the same pose
  const hostSt = cleanGull(ser, [perch()]), guestSt = g.mod.debug.state();
  const P = { x: 0, y: .22 + M.PERCH_Y, z: 0 };
  for (const dt of [0, 3.3, 17, 44.4]) {
    const a = gullPose(hostSt, P, ser.t + dt, null, newPose()), b = gullPose(guestSt, P, g.mod.debug.clock + dt, null, newPose());
    assert.deepEqual(a, b);
  }
  // a visiting gull is hidden between visits and on the perch while perched
  const v = cleanGull({ seed: 5 }, [perch()]);
  assert.equal(gullPose(v, P, 5, null, newPose()).vis, false);
  const pp = gullPose(v, P, PERCHED, null, newPose()); assert.equal(pp.vis, true); assert.ok(Math.abs(pp.y - P.y) < .1); assert.equal(pp.x, 0);
  const d0 = gullPose(v, P, 20, null, newPose()); assert.ok(Math.hypot(d0.x, d0.z) > 9);
  // a moved-in gull with no perch circles the raft
  const lost = cleanGull({ moved: true, seed: 5, name: 'A' }, []); const lp = gullPose(lost, null, 50, null, newPose());
  assert.ok(lp.vis && Math.abs(Math.hypot(lp.x, lp.z) - 6) < 1e-6 && lp.y > 4);
  // loop beats start and end on the perch
  const mv = cleanGull({ moved: true, home: [0, 0], seed: 5, name: 'A' }, [perch()]);
  for (let b = 1; b < 60; b++) if (modeAt(5, b * BEAT) === 'loop') {
    const s = gullPose(mv, P, b * BEAT, null, newPose()), m = gullPose(mv, P, b * BEAT + 5, null, newPose());
    assert.ok(Math.abs(s.x - P.x) < 1e-9 && Math.abs(s.z - P.z) < 1e-9); assert.ok(m.y > P.y + 2); break;
  }
});

test('prompt: offer fish while perched; names are escaped; host emits finds to all', () => {
  const h = harness();
  h.mod.load({ seed: 99, t: PERCHED }, 'save');
  assert.equal(h.mod.prompt(AIM), '<kbd>E</kbd>Offer fish (0/3)');
  assert.equal(h.mod.interact(AIM), true);
  assert.deepEqual(h.actions[0], { kind: 'gull.treat', x: 0, z: 0, food: 'cookedfish' });
  h.mod.load({ seed: 99, t: 5 }, 'save');
  assert.equal(h.mod.prompt(AIM), 'Perch · wait for a gull to visit');
  // escaped name, empty tray
  const n = harness({ held: null });
  n.mod.load({ seed: 99, t: 1, moved: true, home: [0, 0], name: '<b>' }, 'save');
  assert.equal(n.mod.prompt(AIM), '<kbd>E</kbd>Name &lt;b&gt; · finds 0/3');
  n.mod.load({ seed: 99, t: 1, moved: true, home: [0, 0], name: 'Pip', finds: ['wood'] }, 'save');
  assert.equal(n.mod.prompt(AIM), '<kbd>E</kbd>Collect finds (1)');
  // another perch
  const two = harness({ held: null, decor: [perch(-1, 0), perch(0, 0)] });
  two.mod.load({ seed: 99, t: PERCHED }, 'save');
  assert.equal(two.mod.prompt(AIM), 'Perch · the gull lives on another perch');
  // host find notice goes to everyone
  const f = harness();
  f.mod.load({ seed: 99, t: 0, moved: true, home: [0, 0], name: 'Pip', fw: 239 }, 'save');
  f.mod.update(1);
  assert.equal(f.emits.length, 1); assert.equal(f.emits[0].to, 'all'); assert.match(f.emits[0].e.text, /^Pip brought you /);
  assert.equal(f.mod.debug.state().finds.length, 1);
});

test('models: perch has three hidden find slots, fits its tile; paintPerch shows finds', () => {
  const g = M.createPerch(T);
  assert.equal(g.name, 'craft_perch');
  for (let i = 0; i < 3; i++) assert.ok(g.getObjectByName('find' + i));
  const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
  assert.ok(size.x <= .6 && size.z <= .6 && size.y <= 1.3, JSON.stringify(size));
  assert.ok(Math.abs(box.max.y - M.PERCH_Y) < .05);
  M.paintPerch(g, ['wood', 'rope']);
  assert.deepEqual([0, 1, 2].map(i => g.getObjectByName('find' + i).visible), [true, true, false]);
  assert.equal(g.getObjectByName('find1').material.color.getHexString(), 'd8c08a');
  M.paintPerch(g, []); assert.equal(g.getObjectByName('find0').visible, false);
  const mod = createGull({ T, role: 'host', world: { tiles: [], decor: [] } });
  assert.equal(mod.decorModel('perch').name, 'craft_perch'); assert.equal(mod.decorModel('crate'), null);
});

test('items: perch is a complete placeable decor with a radius', () => {
  const it = ITEMS.perch;
  assert.equal(it.category, 'decor'); assert.equal(it.placeable, true); assert.ok(PLACEABLE_IDS.includes('perch'));
  assert.deepEqual({ ...it.recipe.cost }, { wood: 3, rope: 2, leaf: 1 }); assert.equal(BLOCK_RADII.perch, .2);
});
