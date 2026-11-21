// Crate labels, Stash to nearby crates, Sort (docs/specs/crate-labels.md §7). Pure logic, no DOM.
// Run: node --test tests/crate-labels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { Bag, ITEM_INFO, SLOT_COUNT, HOTBAR_SIZE } = await import(new URL('inventory-state.js', base));
const SR = await import(new URL('storage-research.js', base));
const CL = await import(new URL('crate-labels.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const { applyStorageAction, stateFrom, sliceOf, sliceChars, cleanSlice, createStorage, CHEST_SLOTS, MAX_CHESTS, MAX_SLICE_CHARS } = SR;
const { cleanText, cleanLabel, cleanLabels, sortChest, stashTargets, planStash, stashableKinds, categoryOf, groupedKinds, seenKinds, LABEL_TEXT, STASH_R, LABEL_MAX } = CL;

const isKind = k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(ITEM_INFO, k);
const blankBag = () => ({ slots: new Array(SLOT_COUNT).fill(null) });
const chestOf = arr => { const c = new Array(CHEST_SLOTS).fill(null); arr.forEach((v, i) => { c[i] = v; }); return c; };
const emptyState = () => stateFrom({ v: 2, chests: {}, seen: [], learned: [], r: 0 }, 'save', null);
const envOf = (crates, pos) => ({ decorAt: (x, z) => crates.find(c => c.x === x && c.z === z) ? 'crate' : null, pos: () => pos, crates: () => crates.map(c => ({ type: 'crate', ...c })) });
const tally = (...arrs) => {
  const out = {};
  for (const a of arrs) for (const s of a) if (s) { const k = `${s.kind}|${s.durability ?? ''}|${s.id ?? ''}`; out[k] = (out[k] ?? 0) + s.count; }
  return out;
};
const allSlots = (st, bag) => [bag.slots, ...Object.values(st.chests)];
const clone = v => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- 1. conservation property
function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const STACKY = ['wood', 'plastic', 'rope', 'leaf', 'scrap', 'fish', 'cup'];
const TOOLS = ['hook', 'hammer', 'fishingrod'];
function randSlot(rnd) {
  if (rnd() < 0.35) return null;
  if (rnd() < 0.2) { const s = { kind: TOOLS[Math.floor(rnd() * TOOLS.length)], count: 1 }; if (rnd() < 0.7) s.durability = Math.floor(rnd() * 100); if (rnd() < 0.2) s.id = 'id' + Math.floor(rnd() * 1000); return s; }
  const kind = STACKY[Math.floor(rnd() * STACKY.length)];
  return { kind, count: 1 + Math.floor(rnd() * ITEM_INFO[kind].maxStack) };
}
test('stash conserves every item over 300 random cases (and a refusal changes nothing)', () => {
  const rnd = prng(1234);
  let oks = 0, refusals = 0;
  for (let n = 0; n < 300; n++) {
    const st = emptyState(), bag = blankBag();
    for (let i = 0; i < SLOT_COUNT; i++) bag.slots[i] = randSlot(rnd);
    const crates = [], count = 1 + Math.floor(rnd() * 5);
    while (crates.length < count) { const x = Math.floor(rnd() * 7) - 3, z = Math.floor(rnd() * 7) - 3; if (!crates.some(c => c.x === x && c.z === z)) crates.push({ x, z }); }
    for (const c of crates) {
      const key = c.x + ',' + c.z;
      if (rnd() < 0.6) { const ch = chestOf([]); for (let i = 0; i < CHEST_SLOTS; i++) ch[i] = randSlot(rnd); if (ch.some(Boolean)) st.chests[key] = ch; }
      if (rnd() < 0.4) st.labels[key] = rnd() < 0.7 ? { k: STACKY[Math.floor(rnd() * STACKY.length)] } : { t: 'Box' };
    }
    const pos = { x: (rnd() - 0.5) * 14, z: (rnd() - 0.5) * 14 };
    const before = tally(...allSlots(st, bag)), snapSt = clone(st), snapBag = clone(bag), hot = bag.slots.slice(0, HOTBAR_SIZE);
    const res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf(crates, pos));
    assert.deepEqual(tally(...allSlots(st, bag)), before, `case ${n}`);
    for (let i = 0; i < HOTBAR_SIZE; i++) assert.equal(bag.slots[i], hot[i], `hotbar ${i} case ${n}`);
    for (const k of Object.keys(st.chests)) assert.equal(st.chests[k].length, CHEST_SLOTS);
    if (res.ok) { oks++; assert.ok(res.moved > 0); assert.equal(st.r, snapSt.r + 1); }
    else { refusals++; assert.equal(res.reason, 'nothingNear'); assert.deepEqual(clone(st), snapSt); assert.deepEqual(clone(bag), snapBag); }
  }
  assert.ok(oks > 30 && refusals > 30, `both paths exercised (${oks} ok, ${refusals} refused)`);
});

// ---------------------------------------------------------------- 2. hotbar untouched
test('stash never touches the hotbar, even when a nearby crate holds the kind', () => {
  const st = emptyState(), bag = blankBag();
  st.chests['1,0'] = chestOf([{ kind: 'wood', count: 1 }]);
  for (let i = 0; i < HOTBAR_SIZE; i++) bag.slots[i] = { kind: 'wood', count: 5 };
  bag.slots[HOTBAR_SIZE] = { kind: 'wood', count: 4 };
  const hot = bag.slots.slice(0, HOTBAR_SIZE);
  const res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }], { x: 0, z: 0 }));
  assert.equal(res.ok, true); assert.equal(res.moved, 4);
  for (let i = 0; i < HOTBAR_SIZE; i++) { assert.equal(bag.slots[i], hot[i]); assert.equal(bag.slots[i].count, 5); }
  assert.equal(bag.slots[HOTBAR_SIZE], null);
  assert.equal(st.chests['1,0'][0].count, 5);
  // only hotbar matches: nothing to do
  const res2 = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }], { x: 0, z: 0 }));
  assert.deepEqual(res2, { ok: false, reason: 'nothingNear' });
});

// ---------------------------------------------------------------- 3. durability
test('a worn hook keeps its durability through stash, and sort never merges worn tools', () => {
  const st = emptyState(), bag = blankBag();
  st.chests['0,1'] = chestOf([{ kind: 'hook', count: 1, durability: 90 }]);
  bag.slots[HOTBAR_SIZE + 3] = { kind: 'hook', count: 1, durability: 40, id: 'h1' };
  const res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 0, z: 1 }], { x: 0, z: 0 }));
  assert.equal(res.ok, true);
  assert.deepEqual(st.chests['0,1'].filter(Boolean), [{ kind: 'hook', count: 1, durability: 90 }, { kind: 'hook', count: 1, durability: 40, id: 'h1' }]);
  assert.equal(bag.slots[HOTBAR_SIZE + 3], null);
  const two = chestOf([null, { kind: 'hook', count: 1, durability: 40 }, { kind: 'wood', count: 2 }, { kind: 'hook', count: 1, durability: 40 }]);
  const out = sortChest(two);
  assert.deepEqual(out.slots.filter(s => s?.kind === 'hook'), [{ kind: 'hook', count: 1, durability: 40 }, { kind: 'hook', count: 1, durability: 40 }]);
  assert.deepEqual(two[1], { kind: 'hook', count: 1, durability: 40 }, 'input untouched');
});

// ---------------------------------------------------------------- 4. range and labels
test('range, labels first, overflow and no match', () => {
  // 6.1 m away is ignored
  let st = emptyState(), bag = blankBag();
  st.chests['3,0'] = chestOf([{ kind: 'wood', count: 1 }]);
  bag.slots[HOTBAR_SIZE] = { kind: 'wood', count: 3 };
  let res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 3, z: 0 }], { x: -0.1, z: 0 }));
  assert.deepEqual(res, { ok: false, reason: 'nothingNear' });
  res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 3, z: 0 }], { x: 0.1, z: 0 }));
  assert.equal(res.ok, true);
  // an empty crate labelled wood receives wood, and wins over a nearer unlabelled crate holding wood
  st = emptyState(); bag = blankBag();
  st.labels['2,0'] = { k: 'wood' }; st.chests['1,0'] = chestOf([{ kind: 'wood', count: 1 }]);
  bag.slots[HOTBAR_SIZE] = { kind: 'wood', count: 3 };
  res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }, { x: 2, z: 0 }], { x: 0, z: 0 }));
  assert.deepEqual(res, { ok: true, moved: 3, crates: 1 });
  assert.deepEqual(st.chests['2,0'][0], { kind: 'wood', count: 3 });
  assert.equal(st.chests['1,0'][0].count, 1);
  // a full first target overflows into the next
  st = emptyState(); bag = blankBag();
  st.chests['1,0'] = chestOf(Array.from({ length: CHEST_SLOTS }, (_, i) => i === 0 ? { kind: 'wood', count: 18 } : { kind: 'leaf', count: 20 }));
  st.chests['0,1'] = chestOf([{ kind: 'wood', count: 1 }]);
  bag.slots[HOTBAR_SIZE + 5] = { kind: 'wood', count: 10 };
  res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }, { x: 0, z: 1 }], { x: 0.5, z: 0 }));
  assert.deepEqual(res, { ok: true, moved: 10, crates: 2 });
  assert.equal(st.chests['1,0'][0].count, 20); assert.equal(st.chests['0,1'][0].count, 9);
  // crate labelled but nothing lands in it: no empty chest is committed
  st = emptyState(); bag = blankBag();
  st.labels['1,0'] = { k: 'fish' }; st.chests['0,1'] = chestOf([{ kind: 'rope', count: 1 }]);
  bag.slots[HOTBAR_SIZE] = { kind: 'rope', count: 2 };
  res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }, { x: 0, z: 1 }], { x: 0, z: 0 }));
  assert.equal(res.ok, true); assert.ok(!('1,0' in st.chests));
  // no match, no pose
  res = applyStorageAction(emptyState(), { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }], { x: 0, z: 0 }));
  assert.equal(res.reason, 'nothingNear'); assert.equal(LABEL_TEXT.nothingNear, 'No crates nearby with matching items');
  res = applyStorageAction(emptyState(), { kind: 'storage.stash' }, 'guest', bag, envOf([{ x: 1, z: 0 }], null));
  assert.equal(res.reason, 'reach');
  res = applyStorageAction(emptyState(), { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }], { x: NaN, z: 0 }));
  assert.equal(res.reason, 'reach');
  assert.equal(STASH_R, 6);
  // the pure helpers agree
  const t = stashTargets([{ x: 1, z: 0 }, { x: 0, z: 4 }, { x: -1, z: 0 }], {}, {}, { x: 0, z: 0 });
  assert.deepEqual(t.map(e => e.key), ['-1,0', '1,0']);
  bag = blankBag(); bag.slots[HOTBAR_SIZE + 1] = { kind: 'rope', count: 3 }; bag.slots[1] = { kind: 'fish', count: 1 };
  assert.deepEqual([...stashableKinds(bag.slots, { '1,0': chestOf([{ kind: 'rope', count: 1 }]) }, t, {})], ['rope']);
  assert.equal(stashableKinds(bag.slots, { '1,0': chestOf(Array.from({ length: 12 }, () => ({ kind: 'rope', count: 20 }))) }, t, {}).size, 0, 'full crate: nothing to stash');
});

// ---------------------------------------------------------------- 5. atomic size
test('stash past MAX_SLICE_CHARS is refused with nothing changed; sliceChars matches sliceOf', () => {
  const st = emptyState(), bag = blankBag();
  st.legacy = true; st.labels['5,5'] = { t: 'Pad' };
  assert.equal(sliceChars(st, {}), JSON.stringify(sliceOf(st)).length);
  assert.equal(sliceChars(st, '9,9', null), JSON.stringify(sliceOf(st)).length, 'old (st,key,chest) form');
  st.chests['1,0'] = chestOf([{ kind: 'wood', count: 1 }]);
  st.chests['0,1'] = chestOf([{ kind: 'hook', count: 1, durability: 7 }]);
  assert.equal(sliceChars(st, {}), JSON.stringify(sliceOf(st)).length);
  for (let i = 0; JSON.stringify(sliceOf(st)).length < MAX_SLICE_CHARS - 20; i++) st.seen.push('pad' + i.toString(36).padStart(30, 'x'));
  for (let i = HOTBAR_SIZE; i < SLOT_COUNT; i += 2) bag.slots[i] = i % 4 ? { kind: 'wood', count: 1 } : { kind: 'hook', count: 1, durability: 50 };
  const snapSt = clone(st), snapBag = clone(bag);
  const res = applyStorageAction(st, { kind: 'storage.stash' }, 'host', bag, envOf([{ x: 1, z: 0 }, { x: 0, z: 1 }], { x: 0, z: 0 }));
  assert.deepEqual(res, { ok: false, reason: 'tooBig' });
  assert.deepEqual(clone(st), snapSt); assert.deepEqual(clone(bag), snapBag);
});

// ---------------------------------------------------------------- 6. sort
test('sort merges, orders by category then name, keeps empties last and is stable', () => {
  const chest = chestOf([{ kind: 'wood', count: 5 }, null, { kind: 'hammer', count: 1, durability: 10 }, { kind: 'fish', count: 3 },
    { kind: 'wood', count: 18 }, { kind: 'leaf', count: 2 }, null, { kind: 'hook', count: 1, id: 'a' }, { kind: 'hook', count: 1, id: 'b' }]);
  const res = sortChest(chest);
  assert.equal(res.changed, true); assert.equal(res.slots.length, CHEST_SLOTS);
  assert.deepEqual(tally(res.slots), tally(chest));
  const cats = res.slots.filter(Boolean).map(s => CL.CATEGORY_ORDER.indexOf(categoryOf(s.kind)));
  assert.deepEqual(cats, cats.slice().sort((a, b) => a - b), 'category order');
  const firstNull = res.slots.indexOf(null); assert.ok(res.slots.slice(firstNull).every(s => s === null), 'empties last');
  assert.deepEqual(res.slots.filter(s => s?.kind === 'wood'), [{ kind: 'wood', count: 20 }, { kind: 'wood', count: 3 }]);
  assert.deepEqual(res.slots.filter(s => s?.kind === 'hook').map(s => s.id), ['a', 'b'], 'stable for equal keys');
  assert.equal(categoryOf('hammer'), 'tool');
  // already sorted: no change, and the action does not bump r
  const again = sortChest(res.slots); assert.equal(again.changed, false);
  const st = emptyState(); st.chests['1,0'] = res.slots; const r = st.r;
  const env = envOf([{ x: 1, z: 0 }], { x: 2, z: 0 });
  assert.deepEqual(applyStorageAction(st, { kind: 'storage.sort', x: 1, z: 0 }, 'host', blankBag(), env), { ok: true, moved: 0 });
  assert.equal(st.r, r);
  st.chests['1,0'] = chest; assert.equal(applyStorageAction(st, { kind: 'storage.sort', x: 1, z: 0 }, 'host', blankBag(), env).ok, true);
  assert.equal(st.r, r + 1); assert.deepEqual(st.chests['1,0'], res.slots);
  assert.deepEqual(applyStorageAction(emptyState(), { kind: 'storage.sort', x: 1, z: 0 }, 'host', blankBag(), env), { ok: true, moved: 0 }, 'no chest');
  assert.equal(applyStorageAction(st, { kind: 'storage.sort', x: 1, z: 0 }, 'host', blankBag(), envOf([{ x: 1, z: 0 }], { x: 9, z: 0 })).reason, 'reach');
  // never merges durability / id slots or tools
  const worn = sortChest(chestOf([{ kind: 'wood', count: 2, durability: 3 }, { kind: 'wood', count: 2 }, { kind: 'rope', count: 1, id: 'x' }, { kind: 'rope', count: 1 }]));
  assert.equal(worn.slots.filter(Boolean).length, 4);
  // groupedKinds / seenKinds
  const g = groupedKinds(['wood', 'hook', 'fish', 'wood']);
  assert.deepEqual(g.map(e => e.category), CL.CATEGORY_ORDER.filter(c => g.some(e => e.category === c)));
  assert.equal(g.flatMap(e => e.kinds).length, 3);
  assert.deepEqual(seenKinds([{ kind: 'wood', count: 1 }, null], { '0,0': [{ kind: 'fish', count: 1 }] }, ['rope', 'bogus']), ['fish', 'rope', 'wood'].sort((a, b) => ITEM_INFO[a].name.localeCompare(ITEM_INFO[b].name)));
});

// ---------------------------------------------------------------- 7. label clean
test('label cleaning and the label action', () => {
  assert.equal(cleanText('a\u0007b​'), 'ab');
  assert.equal(cleanText('  a\n b '), 'a b');
  assert.equal([...cleanText('🐟'.repeat(20))].length, LABEL_MAX);
  assert.equal(cleanText('   \t '), '');
  assert.equal(cleanLabel({ t: '   ' }, isKind), null);
  assert.equal(cleanLabel({ k: 'nope' }, isKind), null);
  assert.deepEqual(cleanLabel({ k: 'fish', t: 'x' }, isKind), { k: 'fish' });
  assert.deepEqual(cleanLabel({ t: ' Ropes ' }, isKind), { t: 'Ropes' });
  assert.equal(cleanLabel('fish', isKind), null);
  const many = {}; for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) many[(i - 15) + ',' + (j - 15)] = { k: 'wood' };
  many['a,b'] = { k: 'wood' }; many['99,0'] = { k: 'wood' }; many['1,1'] = { k: 'bogus' };
  const cl = cleanLabels({ 'x,1': { k: 'wood' }, '26,0': { k: 'wood' }, '1,2': { t: 'ok' }, '-3,4': { k: 'fish' } }, isKind, 10);
  assert.deepEqual(cl, { '1,2': { t: 'ok' }, '-3,4': { k: 'fish' } });
  assert.equal(Object.keys(cleanLabels(many, isKind, MAX_CHESTS)).length, MAX_CHESTS);
  const st = emptyState(), env = envOf([{ x: 1, z: 0 }], { x: 2, z: 0 }), bag = blankBag();
  assert.deepEqual(applyStorageAction(st, { kind: 'storage.label', x: 1, z: 0, label: { t: '  ' } }, 'host', bag, env), { ok: false, reason: 'badLabel' });
  assert.deepEqual(applyStorageAction(st, { kind: 'storage.label', x: 1, z: 0, label: { k: 'ghost' } }, 'host', bag, env), { ok: false, reason: 'badLabel' });
  assert.equal(st.r, 0);
  assert.equal(applyStorageAction(st, { kind: 'storage.label', x: 1, z: 0, label: { k: 'fish' } }, 'host', bag, env).ok, true);
  assert.deepEqual(st.labels, { '1,0': { k: 'fish' } }); assert.equal(st.r, 1);
  assert.equal(applyStorageAction(st, { kind: 'storage.label', x: 1, z: 0, label: { k: 'fish' } }, 'host', bag, env).ok, true);
  assert.equal(st.r, 1, 'same label: no bump');
  assert.equal(applyStorageAction(st, { kind: 'storage.label', x: 1, z: 0, label: null }, 'host', bag, env).ok, true);
  assert.deepEqual(st.labels, {}); assert.equal(st.r, 2);
  assert.equal(applyStorageAction(st, { kind: 'storage.label', x: 2, z: 0, label: { t: 'x' } }, 'host', bag, env).reason, 'missing');
});

// ---------------------------------------------------------------- 8. save and drop
function makeCtx(world, role = 'host') {
  const emits = [], notes = [], bags = { host: new Bag(), guest: new Bag() };
  const ctx = { T: null, world, role, running: true, physics: { x: 0, z: 0 }, other: null, camera: { position: { x: 0, y: 0.65, z: 0 } }, raft: null,
    localBag: () => bags.host, actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice: t => notes.push(t), esc: s => String(s).replace(/</g, '&lt;'),
    rebuildRaft() {}, releaseLock() {}, requestLock() {}, uiOpen: () => false };
  ctx.action = a => mod.action(a, 'host', bags.host);
  const mod = createStorage(ctx);
  return { ctx, mod, emits, notes, bags };
}
const world = decor => ({ tiles: [[0, 0], [1, 0], [0, 1], [2, 0]], decor, ext: {} });
test('labels survive save round trips, drop off non-crate tiles, and go with dropTile', () => {
  const st = emptyState(); st.labels['1,0'] = { k: 'fish' }; st.labels['2,0'] = { t: 'Ropes' };
  const back = stateFrom(cleanSlice(JSON.parse(JSON.stringify(sliceOf(st)))), 'save', null);
  assert.deepEqual(back.labels, st.labels);
  assert.equal(sliceOf(st).v, 2);
  assert.ok(!('labels' in sliceOf(emptyState())), 'empty map omits the field');
  const w = world([{ type: 'crate', x: 1, z: 0 }, { type: 'bench', x: 2, z: 0 }]);
  const { mod, emits } = makeCtx(w);
  mod.load(sliceOf(st), 'save');
  assert.deepEqual(mod.debug.state().labels, { '1,0': { k: 'fish' } }, 'label on a bench tile dropped');
  const aim = { dir: { x: 1, y: 0, z: 0 } }; // camera at deck height looking +x at the crate on tile 1,0
  assert.equal(mod.prompt(aim), '<kbd>E</kbd>Open crate · Fish');
  mod.debug.label(1, 0, { t: '<b>' }); assert.equal(mod.prompt(aim), '<kbd>E</kbd>Open crate · &lt;b>', 'text through ctx.esc');
  mod.debug.label(1, 0, { k: 'fish' });
  const r = mod.debug.state().r;
  assert.equal(mod.dropTile(1, 0), true);
  assert.equal(mod.debug.state().r, r + 1); assert.ok(!('labels' in mod.debug.state()));
  assert.equal(mod.dropTile(1, 0), false);
  // stash through the module emits a notice to the actor
  mod.load({ v: 2, chests: { '1,0': [{ kind: 'wood', count: 1 }] }, seen: [], learned: [], r: 0 }, 'save');
  emits.length = 0;
  const b = new Bag(); b.slots[HOTBAR_SIZE] = { kind: 'wood', count: 2 };
  mod.action({ kind: 'storage.stash' }, 'host', b);
  assert.deepEqual(emits.map(e => e.e), [{ kind: 'notice', text: 'Stashed 2 items into 1 crate' }]);
  mod.action({ kind: 'storage.stash' }, 'host', b);
  assert.equal(emits[1].e.text, LABEL_TEXT.nothingNear);
  mod.dispose();
});

// ---------------------------------------------------------------- 9. old-host gating
test('a guest on a v1 host cannot label or stash; v2 can; v1 slices load with no labels', () => {
  const g = makeCtx(world([]), 'guest');
  g.mod.load({ v: 1, chests: {}, seen: [], learned: [], r: 1, s: 'x' }, 'net');
  assert.equal(g.mod.debug.state().labels, undefined);
  // the UI api is internal; canLabels is exposed through the F key path: an old host shows the notice
  let sent = 0; g.ctx.action = () => { sent++; };
  globalThis.dispatchEvent?.(new CustomEvent('little-raft-action', { detail: { id: 'stash' } }));
  if (globalThis.dispatchEvent) { assert.equal(sent, 0); assert.deepEqual(g.notes, [LABEL_TEXT.oldHost]); }
  g.mod.load({ v: 2, chests: {}, seen: [], learned: [], r: 2, s: 'x' }, 'net');
  globalThis.dispatchEvent?.(new CustomEvent('little-raft-action', { detail: { id: 'stash' } }));
  if (globalThis.dispatchEvent) assert.equal(sent, 1);
  g.mod.dispose();
  const old = stateFrom({ v: 1, chests: { '1,0': [{ kind: 'wood', count: 1 }] }, seen: [], learned: [], r: 1 }, 'save', null);
  assert.deepEqual(old.labels, {});
});
test('canLabels follows the host slice version', () => {
  const g = makeCtx(world([]), 'guest');
  const can = () => g.mod.debug.canLabels();
  g.mod.load({ v: 1, chests: {}, seen: [], learned: [], r: 1, s: 'x' }, 'net'); assert.equal(can(), false);
  g.mod.load({ v: 2, chests: {}, seen: [], learned: [], r: 2, s: 'x' }, 'net'); assert.equal(can(), true);
  const h = makeCtx(world([]), 'host'); h.mod.load(undefined, 'save'); assert.equal(h.mod.debug.canLabels(), true);
  g.mod.dispose(); h.mod.dispose();
});

// ---------------------------------------------------------------- 10. key binding
test('F is bound to stash by default with no conflicts', () => {
  const m = new ActionMap();
  assert.deepEqual(m.actionFor('KeyF'), ['stash']);
  assert.deepEqual(m.conflicts(), []);
  assert.deepEqual(m.bindingsFor('stash').pad, [null]);
});
