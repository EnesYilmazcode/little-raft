// Unit tests for the Seaglass Canteen (docs/specs/canteen.md): dist/canteen.js rules, item/vitals rows, model.
// Run: node --test tests/canteen.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const C = await import(new URL('canteen.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
// items.js through the stamped specifier inventory-state.js uses, so migrateSnapshot sees the same registry.
const itemsSpec = readFileSync(new URL('inventory-state.js', base), 'utf8').match(/['"](\.\/items\.js[^'"]*)['"]/)[1];
const I = await import(new URL(itemsSpec, base));
const V = await import(new URL('vitals.js', base));
const { createCanteenModel } = await import(new URL('canteen-model.js', base));

const bagWith = (slots, selected = 0) => {
  const s = new Array(SLOT_COUNT).fill(null);
  slots.forEach((v, i) => { s[i] = v; });
  return new Bag({ slots: s, selected });
};
const can = (d) => ({ kind: 'canteen', count: 1, durability: d });
const fullBag = (first, second) => bagWith([first, second, ...Array.from({ length: SLOT_COUNT - 2 }, () => ({ kind: 'scrap', count: 20 }))]);
const mkWorld = (extra = {}) => ({ decor: [{ type: 'purifier', x: 1, z: 0 }, { type: 'rainbarrel', x: 2, z: 0 }, { type: 'bench', x: 0, z: 1 }], purifiers: {}, collectors: {}, ...extra });
const PU = '1,0', RB = '2,0';

test('fillAmount and sipsOf', () => {
  assert.equal(C.fillAmount(0), 25); assert.equal(C.fillAmount(75), 100); assert.equal(C.fillAmount(100), 100);
  assert.equal(C.fillAmount(NaN), 25); assert.equal(C.fillAmount(-5), 25); assert.equal(C.fillAmount(0, 4), 100);
  assert.equal(C.sipsOf(can(0)), 0); assert.equal(C.sipsOf(can(25)), 1); assert.equal(C.sipsOf(can(100)), 4);
  assert.equal(C.sipsOf({ kind: 'hammer', count: 1, durability: 100 }), 0); assert.equal(C.sipsOf(null), 0);
  assert.equal(C.sipsOf(can(49)), 2);
  assert.deepEqual([C.SIP, C.MAX, C.SIPS], [25, 100, 4]);
});

test('sipFrom: selected canteen, fallback canteen, empty and none', () => {
  const b = bagWith([null, can(100)], 1);
  const r = C.sipFrom(b);
  assert.deepEqual(r, { ok: true, index: 1 });
  assert.deepEqual(b.slots[1], can(75)); assert.equal(b.selectedIndex, 1);
  const e = bagWith([can(0), can(50)], 0), snap = JSON.stringify(e.snapshot());
  const re = C.sipFrom(e);
  assert.equal(re.ok, false); assert.equal(re.reason, 'empty'); assert.equal(re.text, C.EMPTY);
  assert.equal(JSON.stringify(e.snapshot()), snap);
  const f = bagWith([{ kind: 'cup', count: 1 }, can(0), can(50)], 0);
  assert.deepEqual(C.sipFrom(f), { ok: true, index: 2 }); assert.equal(f.slots[2].durability, 25); assert.equal(f.slots[1].durability, 0);
  assert.equal(C.sipFrom(bagWith([{ kind: 'cup', count: 1 }])).reason, 'none');
  const last = bagWith([can(25)]); assert.equal(C.sipFrom(last).ok, true); assert.deepEqual(last.slots[0], can(0)); // never removed
});

test('fillFrom purifier: one ready load = one sip', () => {
  const w = mkWorld({ purifiers: { [PU]: { t: 15, ready: 1 } } }), b = bagWith([can(25)]);
  const r = C.fillFrom(w, PU, b);
  assert.equal(r.ok, true); assert.equal(r.kind, 'loot'); assert.equal(r.text, '+ 1 sip (2/4)');
  assert.equal(b.slots[0].durability, 50); assert.equal(w.purifiers[PU], undefined);
  const again = C.fillFrom(w, PU, b); assert.equal(again.reason, 'notready'); assert.equal(again.text, 'Still purifying'); assert.equal(b.slots[0].durability, 50);
  const busy = mkWorld({ purifiers: { [PU]: { t: 3, ready: 0 } } });
  assert.equal(C.fillFrom(busy, PU, b).reason, 'notready'); assert.deepEqual(busy.purifiers[PU], { t: 3, ready: 0 });
  const ready = () => mkWorld({ purifiers: { [PU]: { t: 15, ready: 1 } } });
  const wf = ready(), rf = C.fillFrom(wf, PU, bagWith([can(100)]));
  assert.equal(rf.reason, 'full'); assert.equal(rf.text, 'Your canteen is full'); assert.ok(wf.purifiers[PU]);
  const wn = ready(), nb = bagWith([{ kind: 'cup', count: 1 }, can(0)], 0);
  assert.equal(C.fillFrom(wn, PU, nb).reason, 'nocanteen'); assert.ok(wn.purifiers[PU]); assert.equal(nb.slots[1].durability, 0);
  assert.equal(C.fillFrom(ready(), '0,1', bagWith([can(0)])).reason, 'notarget');
  assert.equal(C.fillFrom(ready(), '9,9', bagWith([can(0)])).reason, 'notarget');
});

test('fillFrom rain barrel: one cup of rain = one sip, no cups involved', () => {
  const w = mkWorld({ collectors: { [RB]: { w: 2, f: 0 } } }), b = bagWith([can(0)]);
  assert.equal(C.fillFrom(w, RB, b).ok, true); assert.equal(b.slots[0].durability, 25); assert.deepEqual(w.collectors[RB], { w: 1, f: 0 });
  assert.equal(C.fillFrom(w, RB, b).ok, true); assert.equal(b.slots[0].durability, 50); assert.equal(w.collectors[RB], undefined);
  const r = C.fillFrom(w, RB, b); assert.equal(r.reason, 'empty'); assert.equal(r.text, 'The rain barrel is empty'); assert.equal(b.slots[0].durability, 50);
  const part = mkWorld({ collectors: { [RB]: { w: 1, f: 40 } } }); C.fillFrom(part, RB, bagWith([can(0)])); assert.deepEqual(part.collectors[RB], { w: 0, f: 40 }); // rain progress kept
  assert.equal(b.count('cup') + b.count('freshcup') + b.count('saltcup'), 0);
});

test('pourCup: one fresh cup per drop, all or nothing', () => {
  const b = bagWith([{ kind: 'freshcup', count: 1 }, can(0)]);
  assert.equal(C.isPour(b, 0, 1), true);
  const r = C.pourCup(b, 0, 1);
  assert.equal(r.ok, true); assert.equal(r.text, 'Poured into the canteen (1/4)');
  assert.deepEqual(b.slots[0], { kind: 'cup', count: 1 }); assert.equal(b.slots[1].durability, 25);
  const m = bagWith([{ kind: 'freshcup', count: 3 }, can(50)]);
  assert.equal(C.pourCup(m, 0, 1, 3).ok, true);
  assert.equal(m.count('freshcup'), 2); assert.equal(m.count('cup'), 1); assert.equal(m.slots[1].durability, 75);
  const full = fullBag({ kind: 'freshcup', count: 3 }, can(0)), snap = JSON.stringify(full.snapshot());
  const rf = C.pourCup(full, 0, 1); assert.equal(rf.ok, false); assert.equal(rf.reason, 'full'); assert.equal(rf.text, 'No room for the empty cup');
  assert.equal(JSON.stringify(full.snapshot()), snap);
  assert.equal(C.isPour(bagWith([{ kind: 'freshcup', count: 1 }, can(100)]), 0, 1), false);
  const salt = bagWith([{ kind: 'saltcup', count: 1 }, can(0)]);
  assert.equal(C.isPour(salt, 0, 1), false); assert.equal(C.pourCup(salt, 0, 1).reason, 'notpour'); assert.equal(salt.count('saltcup'), 1);
  assert.equal(C.isPour(b, 1, 1), false); assert.equal(C.isPour(b, 'x', 1), false); assert.equal(C.isPour(b, 0, 99), false);
});

test('canteenTarget: fill prompt, busy prompt, null otherwise', () => {
  const d = { key: PU, type: 'purifier', x: 1, z: 0 }, bd = { key: RB, type: 'rainbarrel', x: 2, z: 0 };
  const ready = mkWorld({ purifiers: { [PU]: { t: 15, ready: 1 } }, collectors: { [RB]: { w: 1, f: 0 } } });
  const t = C.canteenTarget(ready, d, can(25));
  assert.equal(t.prompt, '<kbd>E</kbd>Fill canteen (1/4)'); assert.deepEqual(t.click, { kind: 'canteenFill', x: 1, z: 0 }); assert.deepEqual(t.e, t.click); assert.equal(t.why, null);
  assert.equal(C.canteenTarget(ready, d, can(25)), t); // reused while nothing changed (no per-frame allocation)
  assert.equal(C.canteenTarget(ready, bd, can(0)).prompt, '<kbd>E</kbd>Fill canteen (0/4)');
  const busy = C.canteenTarget(mkWorld({ purifiers: { [PU]: { t: 2, ready: 0 } } }), d, can(50));
  assert.equal(busy.prompt, 'Purifying… (canteen 2/4)'); assert.equal(busy.click, null); assert.equal(busy.e, null); assert.equal(busy.why, busy.prompt);
  assert.equal(C.canteenTarget(mkWorld(), d, can(0)), null);
  assert.equal(C.canteenTarget(ready, d, can(100)), null);
  assert.equal(C.canteenTarget(mkWorld(), bd, can(0)), null);
  assert.equal(C.canteenTarget(ready, d, { kind: 'cup', count: 1 }), null);
  assert.equal(C.canteenTarget(ready, { key: '0,1', type: 'bench', x: 0, z: 1 }, can(0)), null);
});

test('items / vitals rows: an empty, unrepairable tool that drinks', () => {
  const it = I.ITEMS.canteen;
  assert.equal(it.tool, true); assert.equal(it.stack, 1); assert.equal(it.startEmpty, true);
  assert.equal(I.wearPerUse('canteen'), 25); assert.equal(I.repairCost('canteen'), null);
  assert.equal(I.freshDurability('canteen'), 0); assert.equal(I.freshDurability('hammer'), 100);
  const b = bagWith([{ kind: 'glass', count: 1 }, { kind: 'rope', count: 1 }, { kind: 'plastic', count: 2 }]);
  assert.equal(b.craft('canteen').ok, true);
  const i = b.slots.findIndex(s => s?.kind === 'canteen');
  assert.ok(i >= 0); assert.equal(b.slots[i].durability, 0); assert.equal(b.count('glass') + b.count('rope') + b.count('plastic'), 0);
  const out = I.migrateSnapshot({ slots: [can(50)], selected: 0 });
  assert.equal(out.slots[0].kind, 'canteen'); assert.equal(out.slots[0].durability, 50);
  assert.equal(new Bag(out).slots[0].durability, 50);
  assert.equal(V.isEdible('canteen'), true); assert.equal(V.isDrink('canteen'), true);
  assert.equal(V.eatLabel('canteen'), 'Drink (+40 water)');
  assert.equal(V.FOOD.canteen.returns, undefined);
  assert.equal(V.FOOD.canteen.water, V.FOOD.freshcup.water); // 1 sip = 1 fresh cup
});

test('canteen.js never imports vitals.js; every import is build-stamped', () => {
  const src = readFileSync(new URL('canteen.js', base), 'utf8');
  assert.ok(![...src.matchAll(/from\s+'([^']+)'/g)].some(m => m[1].includes('vitals')));
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /\?build=v3-survival-ae77fa84ac2b$/);
});

test('canteen model: named held_canteen, small and low-poly', () => {
  const g = createCanteenModel(T);
  assert.equal(g.name, 'held_canteen');
  g.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(g).getSize(new T.Vector3());
  assert.ok(size.x <= 0.25 && size.y <= 0.25 && size.z <= 0.12, JSON.stringify(size));
  assert.ok(size.x > 0.1 && size.y > 0.15, JSON.stringify(size));
  let tris = 0, glass = false;
  g.traverse(o => { if (o.isMesh) { const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; tris += n / 3; if (o.material.userData.glass) glass = true; } });
  assert.ok(tris < 400, String(tris)); assert.ok(glass);
});
