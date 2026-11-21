// Unit tests for dist/pipes.js (Water Tank + Water Pipe) and dist/pipes-model.js. See docs/specs/water-pipes.md section 11.
// Run: node --test tests/pipes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const P = await import(new URL('pipes.js', base));
const M = await import(new URL('pipes-model.js', base));
const R = await import(new URL('rain.js', base));
const W = await import(new URL('watering.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEMS, PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const { cleanPipes, buildNets, tickPipes, pipeAction, promptText, pipeLayout, newNetCache, netsFor, SOURCES, WATERABLE, TANK_CAP, MAX_PIPES, OLD_HOST, TEXT } = P;

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'scrap', count: 20 })));
const grid = (x0, x1, z0, z1) => { const t = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) t.push([x, z]); return t; };
const D = (type, x, z) => ({ type, x, z });
const mkWorld = (decor, extra = {}) => ({ tiles: grid(-3, 6, -3, 6), decor, garden: {}, collectors: {}, sprinklers: {}, purifiers: {}, ...extra });
const mkSt = (p = [], t = {}) => ({ v: 1, s: '', r: 0, g: 0, p: Object.fromEntries(p.map(k => [k, 1])), t: { ...t } });
const nets = (st, w, tables) => buildNets(st, w, tables).nets.map(n => ({ tanks: n.tanks, nodes: [...n.nodes].sort(), sources: n.sources, sinks: n.sinks }));
const tick = (st, w, n, c = newNetCache()) => { for (let i = 0; i < n; i++) tickPipes(st, w, 1, c); };

test('1 cleanPipes: junk gives defaults; bad keys, non-tiles, non-tank cups and w 0 dropped; w clamped; 400 pipe cap', () => {
  const def = { v: 1, s: '', r: 0, g: 0, p: {}, t: {} };
  for (const v of [undefined, null, [], 'x', 3, { p: [] }, { t: 'x' }]) assert.deepEqual(cleanPipes(v, [[0, 0]], [D('watertank', 0, 0)]), def);
  const tiles = [[0, 0], [1, 0], [2, 0]], decor = [D('watertank', 0, 0), D('watertank', 1, 0), D('palm', 2, 0)];
  const st = cleanPipes({ v: 1, s: 'abc', r: 7, g: 3, p: { '0,0': 1, '1,0': 1, '9,9': 1, 'a,b': 1, '01,0': 1, '0.5,0': 1, ['1'.repeat(20) + ',0']: 1 },
    t: { '0,0': 99, '1,0': 0, '2,0': 4, '5,5': 3, 'x': 2 } }, tiles, decor);
  assert.equal(st.s, 'abc'); assert.equal(st.r, 7); assert.equal(st.g, 3);
  assert.deepEqual(st.p, { '0,0': 1, '1,0': 1 });
  assert.deepEqual(st.t, { '0,0': TANK_CAP });
  const many = grid(0, 29, 0, 29), p = Object.fromEntries(many.map(([x, z]) => [x + ',' + z, 1]));
  assert.equal(Object.keys(cleanPipes({ p }, many, []).p).length, MAX_PIPES);
});

test('2 buildNets: chains, shared nets, diagonals, devices under / beside pipes, lone runs', () => {
  const w = mkWorld([D('watertank', 0, 0), D('watertank', 3, 0), D('palm', 1, 1), D('sprinkler', 2, 0), D('palm', 4, 1), D('palm', 0, -1), D('palm', 5, 5), D('rainbarrel', 6, 6)]);
  // tank 0,0 - 1,0 - (2,0 sprinkler with a pipe under it) - tank 3,0; palm 1,1 beside the pipe; palm 4,1 is diagonal to 3,0
  const st = mkSt(['1,0', '2,0', '4,4', '5,4']);
  assert.deepEqual(nets(st, w), [{ tanks: ['0,0', '3,0'], nodes: ['0,0', '1,0', '2,0', '3,0'], sources: [], sinks: ['0,-1', '1,1', '2,0'] }]);
  // palm 0,-1 is tank-adjacent with no pipe and joins; palm 5,5 sits next to a lone run (4,4-5,4, no tank): no net
  const diag = mkWorld([D('watertank', 0, 0), D('palm', 2, 1)]), st2 = mkSt(['1,1', '2,2']); // 1,1 is diagonal to the tank
  assert.deepEqual(nets(st2, diag), [{ tanks: ['0,0'], nodes: ['0,0'], sources: [], sinks: [] }]);
  assert.deepEqual(nets(mkSt(['4,4']), mkWorld([D('palm', 4, 5)])), []);
  // a device touching two nets goes to the first net in sorted order
  const two = mkWorld([D('watertank', 0, 0), D('watertank', 2, 0), D('palm', 1, 0)]);
  const n2 = nets(mkSt(), two); assert.equal(n2.length, 2); assert.deepEqual(n2[0].sinks, ['1,0']); assert.deepEqual(n2[1].sinks, []);
});

test('3 inflow: a barrel gives 1 cup per second; purifiers are not sources; tank stops at 12; least-full tank first', () => {
  const w = mkWorld([D('watertank', 0, 0), D('rainbarrel', 1, 0), D('purifier', 0, 1)], { collectors: { '1,0': { w: 3, f: 0 } }, purifiers: { '0,1': { t: 15, ready: 1 } } });
  const st = mkSt();
  tick(st, w, 1); assert.equal(st.t['0,0'], 1); assert.equal(w.collectors['1,0'].w, 2);
  tick(st, w, 1); assert.equal(st.t['0,0'], 2);
  assert.deepEqual(w.purifiers['0,1'], { t: 15, ready: 1 }, 'a ready purifier keeps its cup: purifiers do not feed tanks');
  assert.deepEqual(SOURCES.map(r => r.type), ['rainbarrel']);
  const full = mkWorld([D('watertank', 0, 0), D('rainbarrel', 1, 0)], { collectors: { '1,0': { w: 4, f: 0 } } }), sf = mkSt([], { '0,0': 11 });
  tick(sf, full, 5); assert.equal(sf.t['0,0'], 12); assert.equal(full.collectors['1,0'].w, 3, 'the barrel keeps the rest');
  const r = sf.r; tick(sf, full, 3); assert.equal(sf.r, r, 'a full tank and nothing to feed: no revision bump');
  const lf = mkWorld([D('watertank', 0, 0), D('watertank', 2, 0), D('rainbarrel', 1, 1)], { collectors: { '1,1': { w: 4, f: 0 } } }), sl = mkSt(['1,0'], { '0,0': 5, '2,0': 3 });
  tick(sl, lf, 1); assert.deepEqual(sl.t, { '0,0': 5, '2,0': 4 });
  tick(sl, lf, 1); assert.deepEqual(sl.t, { '0,0': 5, '2,0': 5 });
  tick(sl, lf, 1); assert.deepEqual(sl.t, { '0,0': 6, '2,0': 5 }, 'ties go to the lowest key');
});

test('4 outflow: dry palm watered keeping grow; ripe / wet palms untouched; palms before sprinklers; sprinkler cap; fullest tank', () => {
  const w = mkWorld([D('watertank', 0, 0), D('palm', 1, 0), D('palm', 0, 1), D('palm', -1, 0), D('sprinkler', 0, -1)],
    { garden: { '1,0': { water: 0, grow: 50 }, '0,1': { water: 0, grow: W.GROW_SECONDS }, '-1,0': { water: 1, grow: 10 } } });
  const st = mkSt([], { '0,0': 1 }), ripe = { ...w.garden['0,1'] }, wet = { ...w.garden['-1,0'] };
  tick(st, w, 1);
  assert.deepEqual(w.garden['1,0'], { water: 1, grow: 50 });
  assert.deepEqual(w.garden['0,1'], ripe); assert.deepEqual(w.garden['-1,0'], wet);
  assert.equal(w.sprinklers['0,-1'], undefined, 'the palm went first and the tank is now empty');
  assert.deepEqual(st.t, {});
  st.t['0,0'] = 12; tick(st, w, 1); assert.equal(w.sprinklers['0,-1'].w, 1, 'one cup per sink per second');
  tick(st, w, 5); assert.equal(w.sprinklers['0,-1'].w, R.SPRINKLER_CAP); assert.equal(st.t['0,0'], 12 - R.SPRINKLER_CAP);
  const f = mkWorld([D('watertank', 0, 0), D('watertank', 2, 0), D('palm', 1, 1)]), sf = mkSt(['1,0'], { '0,0': 3, '2,0': 5 });
  tick(sf, f, 1); assert.deepEqual(sf.t, { '0,0': 3, '2,0': 4 });
});

const total = (w, st) => Object.values(w.collectors).reduce((a, e) => a + e.w, 0) + Object.values(st.t).reduce((a, n) => a + n, 0)
  + Object.values(w.sprinklers).reduce((a, e) => a + e.w, 0) + Object.values(w.garden).filter(e => e.water === 1).length;

test('5 contention: a barrel next to an un-netted sprinkler keeps 1 cup; water is conserved with tickRain', () => {
  const w = mkWorld([D('rainbarrel', 1, 0), D('watertank', 2, 0), D('sprinkler', 0, 0), D('palm', -1, 1)], { collectors: { '1,0': { w: 3, f: 0 } } });
  const st = mkSt();
  tick(st, w, 5); assert.equal(w.collectors['1,0'].w, 1, 'one cup stays for the sprinkler'); assert.equal(st.t['2,0'], 2);
  const w2 = mkWorld([D('rainbarrel', 1, 0), D('watertank', 2, 0), D('sprinkler', 0, 0), D('palm', -1, 1), D('palm', -1, -1), D('palm', 3, 1)], { collectors: { '1,0': { w: 4, f: 0 } } });
  const s2 = mkSt(['3,0']), c = newNetCache(), t0 = total(w2, s2);
  for (let i = 0; i < 20; i++) {
    tickPipes(s2, w2, 1, c);
    // no rain and no dew so the sum is closed: give tickRain rain 0 but strip its dew by checking only the bound
    const f0 = w2.collectors['1,0']?.f ?? 0; R.tickRain(w2, 1, 0);
    for (const e of Object.values(w2.collectors)) assert.ok(e.w >= 0, 'never below 0');
    if (w2.collectors['1,0']) w2.collectors['1,0'].f = f0; // freeze dew so the total is exact
  }
  assert.equal(total(w2, s2), t0, 'barrel + tank + sprinkler + watered palms is conserved');
});

test('6 order independence: pipes-then-core and core-then-pipes (60 s and on to ripe) never re-water a ripe palm, collectors stay >= 0', () => {
  for (const order of ['pipes-first', 'core-first']) {
    const w = mkWorld([D('rainbarrel', 1, 0), D('watertank', 2, 0), D('palm', 3, 0), D('sprinkler', 2, 1), D('palm', 3, 2), D('palm', 1, 2)], { collectors: { '1,0': { w: 4, f: 0 } } });
    const st = mkSt(), c = newNetCache();
    let rewatered = 0;
    for (let i = 0; i < 120; i++) {
      const ripeBefore = Object.keys(w.garden).filter(k => W.plantStage(w.garden[k]) === 2);
      const core = () => { W.tick(w, 1); R.tickRain(w, 1, 1); };
      if (order === 'pipes-first') { tickPipes(st, w, 1, c); core(); } else { core(); tickPipes(st, w, 1, c); }
      for (const k of ripeBefore) if (w.garden[k]?.water === 1) rewatered++;
      for (const e of Object.values(w.collectors)) assert.ok(e.w >= 0);
    }
    assert.equal(rewatered, 0, order);
    assert.ok(Object.values(w.garden).some(e => W.plantStage(e) === 2), order + ': the palms do ripen');
  }
});

test('7 actions: lay / lift / pour / fill and their refusals', () => {
  const w = mkWorld([D('watertank', 0, 0)]), st = mkSt(), me = { x: 0, z: 0 };
  let bag = bagWith([{ kind: 'waterpipe', count: 2 }]);
  const g0 = st.g;
  assert.deepEqual(pipeAction(st, w, { kind: 'pipes.lay', x: 1, z: 0 }, bag, me), { ok: true });
  assert.equal(bag.count('waterpipe'), 1); assert.equal(st.g, g0 + 1); assert.deepEqual(st.p, { '1,0': 1 });
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 1, z: 0 }, bag, me).reason, 'haspipe');
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 1, z: 9 }, bag, { x: 2, z: 17 }).reason, 'notile');
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 3, z: 0 }, bag, me).reason, 'far');
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 0.5, z: 0 }, bag, me).ok, false);
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 0, z: 1 }, bagWith([]), me).reason, 'noitem');
  assert.equal(pipeAction(st, w, { kind: 'pipes.lay', x: 0, z: 1 }, bagWith([]), me).text, TEXT.noitem);
  // lift refunds; a full bag refuses and the pipe stays
  const full = fullBag(), snap = JSON.stringify(full.snapshot()), g1 = st.g;
  assert.equal(pipeAction(st, w, { kind: 'pipes.lift', x: 1, z: 0 }, full, me).reason, 'full');
  assert.equal(JSON.stringify(full.snapshot()), snap); assert.deepEqual(st.p, { '1,0': 1 }); assert.equal(st.g, g1);
  assert.equal(pipeAction(st, w, { kind: 'pipes.lift', x: 0, z: 1 }, bag, me).reason, 'nopipe');
  assert.deepEqual(pipeAction(st, w, { kind: 'pipes.lift', x: 1, z: 0 }, bag, me), { ok: true });
  assert.equal(bag.count('waterpipe'), 2); assert.deepEqual(st.p, {}); assert.equal(st.g, g1 + 1);
  // pour / fill swap the cups
  bag = bagWith([{ kind: 'freshcup', count: 1 }, { kind: 'cup', count: 1 }]);
  assert.deepEqual(pipeAction(st, w, { kind: 'pipes.pour', x: 0, z: 0 }, bag, me), { ok: true });
  assert.equal(st.t['0,0'], 1); assert.equal(bag.count('freshcup'), 0); assert.equal(bag.count('cup'), 2);
  assert.equal(pipeAction(st, w, { kind: 'pipes.pour', x: 0, z: 0 }, bag, me).reason, 'nocup');
  assert.equal(pipeAction(st, w, { kind: 'pipes.pour', x: 1, z: 0 }, bag, me).reason, 'notarget');
  assert.deepEqual(pipeAction(st, w, { kind: 'pipes.fill', x: 0, z: 0 }, bag, me), { ok: true, kind: 'loot', text: '+ 1 cup of fresh water' });
  assert.equal(st.t['0,0'], undefined); assert.equal(bag.count('freshcup'), 1);
  const s0 = JSON.stringify(bag.snapshot());
  assert.equal(pipeAction(st, w, { kind: 'pipes.fill', x: 0, z: 0 }, bag, me).reason, 'tankempty');
  st.t['0,0'] = TANK_CAP;
  assert.equal(pipeAction(st, w, { kind: 'pipes.pour', x: 0, z: 0 }, bag, me).reason, 'tankfull');
  assert.equal(JSON.stringify(bag.snapshot()), s0, 'refusals leave the bag as it was');
});

test('7b module: guest actions use the guest pose; unknown kinds fall through; serialize cached by r', () => {
  const emits = [], world = mkWorld([D('watertank', 0, 0)]);
  const ctx = { T: null, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: { x: 50, z: 50 }, emit: (e, to) => emits.push([e, to]), action: () => {} };
  const m = P.createPipes(ctx); m.load(undefined, 'save');
  const bag = bagWith([{ kind: 'waterpipe', count: 1 }]);
  assert.equal(m.action({ kind: 'storage.put' }, 'host', bag), false);
  assert.equal(m.action({ kind: 'pipes.lay', x: 1, z: 0 }, 'guest', bag), true);
  assert.deepEqual(emits.at(-1), [{ kind: 'notice', text: TEXT.far }, 'guest']); assert.equal(bag.count('waterpipe'), 1);
  assert.equal(m.action({ kind: 'pipes.lay', x: 1, z: 0 }, 'host', bag), true); assert.deepEqual(m.debug.state().p, { '1,0': 1 });
  const s1 = m.serialize(); assert.equal(m.serialize(), s1);
  m.action({ kind: 'pipes.lift', x: 1, z: 0 }, 'host', bag); assert.notEqual(m.serialize(), s1); assert.equal(bag.count('waterpipe'), 1);
  // old saves: undefined -> empty slice; a saved slice is cleaned against the current tiles and decor
  m.load({ v: 1, s: 'old', r: 2, g: 1, p: { '1,0': 1, '50,50': 1 }, t: { '0,0': 4, '1,0': 2 } }, 'save');
  assert.deepEqual(m.debug.state().p, { '1,0': 1 }); assert.deepEqual(m.debug.state().t, { '0,0': 4 });
});

test('8 WATERABLE: a test row makes a crate a sink with no other change', () => {
  const crateRow = { type: 'crate', wants: (w, k) => !w.crates?.[k], give: (w, k) => { (w.crates ??= {})[k] = 1; } };
  const tables = { sources: SOURCES, sinks: [...WATERABLE, crateRow] };
  const w = mkWorld([D('watertank', 0, 0), D('crate', 1, 0)]), st = mkSt([], { '0,0': 2 });
  assert.deepEqual(nets(st, w, tables)[0].sinks, ['1,0']);
  assert.deepEqual(nets(st, w)[0].sinks, [], 'not a sink without the row');
  tickPipes(st, w, 1, newNetCache(tables));
  assert.deepEqual(w.crates, { '1,0': 1 }); assert.equal(st.t['0,0'], 1);
});

test('9 prompts: every row of section 7, and OLD_HOST for a guest of an old host', () => {
  assert.equal(promptText({ held: 'waterpipe', tile: { deck: true, pipe: false }, left: 7 }), '<kbd>Click</kbd>Lay pipe (7 left) · Right click lifts');
  assert.equal(promptText({ held: 'waterpipe', tile: { deck: true, pipe: true }, left: 7 }), '<kbd>Right click</kbd>Lift pipe');
  assert.equal(promptText({ held: 'waterpipe', tile: { deck: false, pipe: false }, left: 7 }), 'Water pipe: point at the deck');
  assert.equal(promptText({ held: 'waterpipe', tile: null, left: 0 }), 'Water pipe: point at the deck');
  const tank = (w, feeding = 0) => ({ w, feeding });
  assert.equal(promptText({ held: 'freshcup', tank: tank(5) }), '<kbd>E</kbd>Pour in fresh water (5/12)');
  assert.equal(promptText({ held: 'freshcup', tank: tank(12) }), 'Water tank: full (12/12)');
  assert.equal(promptText({ held: 'cup', tank: tank(3) }), '<kbd>E</kbd>Fill cup (3/12)');
  assert.equal(promptText({ held: 'cup', tank: tank(0) }), 'Water tank: empty · pipe in a rain barrel');
  assert.equal(promptText({ held: 'saltcup', tank: tank(4) }), 'Water tank: 4/12 · fresh water only');
  assert.equal(promptText({ held: 'hook', tank: tank(4, 3) }), 'Water tank: 4/12 · feeding 3');
  assert.equal(promptText({ held: null, tank: tank(0, 0) }), 'Water tank: 0/12 · not piped to anything');
  assert.equal(promptText({ held: 'hook', tank: null }), null);
  // the module: held pipe over the deck, then a guest whose host has no pipes
  const world = mkWorld([D('watertank', 0, 0)]);
  const bag = bagWith([{ kind: 'waterpipe', count: 3 }]), notices = [], actions = [];
  const ctx = { T: null, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, localBag: () => bag, notice: s => notices.push(s), action: a => actions.push(a) };
  const m = P.createPipes(ctx); m.load(undefined, 'save');
  assert.equal(m.prompt({ point: { x: 2.2, y: 0, z: -.3 } }), '<kbd>Click</kbd>Lay pipe (3 left) · Right click lifts');
  assert.equal(m.prompt({ point: { x: 40, y: 0, z: 0 } }), 'Water pipe: point at the deck');
  assert.equal(m.use({ point: { x: 2, y: 0, z: 0 } }, 'waterpipe'), true); assert.deepEqual(actions.at(-1), { kind: 'pipes.lay', x: 1, z: 0 });
  assert.equal(m.use({ point: { x: 40, y: 0, z: 0 } }, 'waterpipe'), true); assert.equal(notices.at(-1), TEXT.notile);
  assert.equal(m.alt({ point: { x: 2, y: 0, z: 0 } }, 'waterpipe'), true); assert.equal(notices.at(-1), TEXT.nopipe);
  assert.equal(m.use({ point: { x: 2, y: 0, z: 0 } }, 'hammer'), false); assert.equal(m.alt({ point: { x: 2, y: 0, z: 0 } }, 'brush'), false);
  const g = P.createPipes({ ...ctx, role: 'guest' });
  g.load(undefined, 'net');
  assert.equal(g.prompt({ point: { x: 2, y: 0, z: 0 } }), OLD_HOST);
  assert.equal(g.use({ point: { x: 2, y: 0, z: 0 } }, 'waterpipe'), true); assert.equal(notices.at(-1), OLD_HOST);
  g.load({ v: 1, s: 'h', r: 1, g: 1, p: {}, t: {} }, 'net');
  assert.equal(g.prompt({ point: { x: 2, y: 0, z: 0 } }), '<kbd>Click</kbd>Lay pipe (3 left) · Right click lifts');
  const ref = g.debug.state(); g.load({ v: 1, s: 'h', r: 1, g: 1, p: { '1,0': 1 }, t: {} }, 'net');
  assert.deepEqual(g.debug.state(), ref, 'same r and s from the host: deduped');
  assert.equal(g.debug.fastForward(10), false, 'guests never tick');
});

test('10 pipeLayout: cap, straight, elbow, tee, cross and device arms; a water change keeps the layout', () => {
  // tank -1,0 -> elbow 0,0 -> 0,1 -> elbow 0,2 -> 1,2 -> cross 2,2 (cap 2,1 below it) -> tee 3,2 -> 4,2 -> palm 5,2; 2,3-3,3 close a loop
  const w = mkWorld([D('watertank', -1, 0), D('palm', 5, 2)]);
  const st = mkSt(['0,0', '0,1', '0,2', '1,2', '2,2', '2,1', '2,3', '3,3', '3,2', '4,2']);
  const N = buildNets(st, w), L = pipeLayout(st, w.decor, N);
  const kind = k => L.joints.find(j => j[0] + ',' + j[1] === k)?.[2];
  assert.equal(kind('0,0'), 'elbow'); // tank at -x and pipe at +z
  assert.equal(kind('0,1'), 'straight'); assert.equal(kind('0,2'), 'elbow'); assert.equal(kind('1,2'), 'straight');
  assert.equal(kind('2,2'), 'cross'); assert.equal(kind('2,1'), 'cap'); assert.equal(kind('3,2'), 'tee'); assert.equal(kind('3,3'), 'elbow');
  assert.equal(kind('4,2'), 'straight', 'the palm on the net counts as a neighbour');
  assert.equal(P.jointKind(1 | 2 | 4), 'tee'); assert.equal(P.jointKind(0), 'cap'); assert.equal(P.jointKind(2 | 8), 'straight');
  const stubs = L.arms.filter(a => a[3] === 1);
  assert.deepEqual(stubs.map(a => a.slice(0, 5)), [['-1', 0], ['5', 2]].map(([x, z], i) => [Number(x), z, i ? 2 : 0, 1, .62]));
  const json = JSON.stringify(L);
  st.t['-1,0'] = 6;
  const wet = pipeLayout(st, w.decor, N);
  assert.deepEqual(wet.joints.map(j => j.slice(0, 3)), L.joints.map(j => j.slice(0, 3)), 'same layout');
  assert.ok(wet.joints.every(j => j[3] === 1) && JSON.parse(json).joints.every(j => j[3] === 0), 'only the wet flag changes');
  const c = newNetCache(); const n1 = netsFor(c, st, w); st.t['-1,0'] = 2; assert.equal(netsFor(c, st, w), n1, 'water changes do not rebuild the nets');
  st.p['9,9'] = 1; st.g++; assert.notEqual(netsFor(c, st, w), n1, 'a g bump does');
});

test('11 models: craft_watertank fits its box; paintTank; InstancedMeshes keep their arrays', () => {
  const g = M.createWaterTank(T);
  assert.equal(g.name, 'craft_watertank'); assert.equal(g.userData.craftType, 'watertank');
  const box = new T.Box3().setFromObject(g), s = box.getSize(new T.Vector3());
  assert.ok(s.x <= .75 && s.z <= .75 && s.y <= 1.1, JSON.stringify(s));
  M.paintTank(g, 6); const lvl = g.getObjectByName('tankLevel');
  assert.equal(lvl.scale.y, .5); assert.equal(g.userData.sig, 6);
  M.paintTank(g, 0); assert.equal(lvl.scale.y, .001);
  const pm = M.createPipeMeshes(T);
  assert.equal(pm.joints.material, pm.arms.material); assert.equal(pm.joints.name, 'pipe_joints'); assert.equal(pm.arms.name, 'pipe_arms');
  assert.equal(pm.joints.frustumCulled, false);
  const ja = pm.joints.instanceMatrix.array, aa = pm.arms.instanceMatrix.array;
  const st = mkSt(['1,0', '2,0']), w = mkWorld([D('watertank', 0, 0)]);
  pm.write(pipeLayout(st, w.decor, buildNets(st, w)), .2); assert.equal(pm.joints.count, 2); assert.equal(pm.arms.count, 4);
  st.p['3,0'] = 1; pm.write(pipeLayout(st, w.decor, buildNets(st, w)), .2); assert.equal(pm.joints.count, 3);
  assert.equal(pm.joints.instanceMatrix.array, ja); assert.equal(pm.arms.instanceMatrix.array, aa);
  // the arm from 1,0 towards +x ends at the tile edge (x = 3 m)
  const m4 = new T.Matrix4(); pm.arms.getMatrixAt(0, m4); const e = new T.Vector3(1, 0, 0).applyMatrix4(m4);
  assert.ok(Math.abs(e.x - 3) < 1e-6 && Math.abs(e.z) < 1e-6, JSON.stringify(e));
  pm.arms.getMatrixAt(1, m4); e.set(1, 0, 0).applyMatrix4(m4); assert.ok(Math.abs(e.x - 1) < 1e-6, '-x arm ends at x = 1 m');
  pm.dispose();
  const mod = P.createPipes({ T, world: { tiles: [], decor: [] }, role: 'solo' });
  assert.equal(mod.decorModel('watertank').name, 'craft_watertank'); assert.equal(mod.decorModel('palm'), null);
});

test('12 items: waterpipe is not placeable, watertank is; 4 pipes craft from 1 scrap + 1 plastic', () => {
  assert.ok(!PLACEABLE_IDS.includes('waterpipe')); assert.ok(PLACEABLE_IDS.includes('watertank'));
  assert.equal(BLOCK_RADII.watertank, .35);
  assert.equal(ITEMS.pipes.id, 'pipes', 'the instrument keeps its id');
  const bag = bagWith([{ kind: 'scrap', count: 1 }, { kind: 'plastic', count: 1 }]);
  assert.ok(bag.craft('waterpipe').ok); assert.equal(bag.count('waterpipe'), 4); assert.equal(bag.count('scrap'), 0);
});
