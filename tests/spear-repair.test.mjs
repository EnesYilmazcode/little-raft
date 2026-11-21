import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, SPEAR_DAMAGE, wearPerUse, toolRole } from '../dist/items.js';
import { RECIPES, Bag } from '../dist/inventory-state.js';
import { ITEM_ICONS } from '../dist/item-svg.js';
import { isSpear, spearDamage, canThrust, thrust, wearSpearSlot, SPEAR_COOLDOWN, SPEAR_REACH } from '../dist/spear.js';
import { tileHpOf, damagedTile, repairTile, repairedHp, hpBarText, TILE_MAX_HP, REPAIR_HP, TILE_REPAIR_COST } from '../dist/repair.js';

const bagWith = (items) => {
  const b = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  for (const [k, n] of Object.entries(items)) b.add(k, n);
  return b;
};

test('spear recipes, unlocks, damage and durability follow the research numbers', () => {
  assert.deepEqual({ ...RECIPES.spear.cost }, { wood: 8, rope: 3 });
  assert.deepEqual({ ...RECIPES.metalspear.cost }, { wood: 6, rope: 2, metalingot: 2, bolt: 1 });
  assert.equal(ITEMS.spear.durability, 20);
  assert.equal(ITEMS.metalspear.durability, 40);
  assert.ok(ITEMS.spear.tool && ITEMS.metalspear.tool);
  assert.deepEqual(ITEMS.spear.unlock, { type: 'discover', items: ['rope'] });
  assert.deepEqual(ITEMS.metalspear.unlock, { type: 'research', items: ['metalingot', 'bolt'] });
  assert.equal(SPEAR_DAMAGE.spear, 5); assert.equal(SPEAR_DAMAGE.metalspear, 10);
  assert.equal(spearDamage('spear'), 5); assert.equal(spearDamage('metalspear'), 10); assert.equal(spearDamage('hook'), 0);
  assert.equal(toolRole('metalspear'), 'spear');
  assert.ok(isSpear('spear') && isSpear('metalspear') && !isSpear('hammer'));
  assert.ok(ITEM_ICONS.spear && ITEM_ICONS.metalspear && ITEM_ICONS.spear !== ITEM_ICONS.metalspear);
  assert.equal(SPEAR_COOLDOWN, 0.7); assert.equal(SPEAR_REACH, 2.8);
});

test('a crafted spear lands in the hotbar with full durability', () => {
  const b = bagWith({ wood: 8, rope: 3 });
  const r = b.craft('spear');
  assert.ok(r.ok);
  const i = b.slots.findIndex(s => s?.kind === 'spear');
  assert.ok(i >= 0 && i < 8, 'hotbar slot');
  assert.equal(b.slots[i].durability, 100);
});

test('spear wears only on a landed hit: 20 hits break the wooden one, 40 the metal one', () => {
  const slot = { kind: 'spear', count: 1, durability: 100 };
  let calls = 0;
  const miss = thrust(slot, () => { calls++; return false; });
  assert.equal(miss.hit, false); assert.equal(slot.durability, 100, 'miss: no wear');
  const hit = thrust(slot, (dmg) => { calls++; assert.equal(dmg, 5); return true; });
  assert.equal(hit.hit, true); assert.equal(slot.durability, 100, 'thrust itself never wears');
  assert.equal(calls, 2);
  assert.equal(thrust(slot, () => 'yes').hit, false, 'only === true counts');
  assert.equal(thrust(slot, undefined).hit, false, 'no shark: miss');
  let broke = 0;
  for (let i = 0; i < 20; i++) { const w = wearSpearSlot(slot); if (w.broke) broke++; }
  assert.equal(slot.durability, 0); assert.equal(broke, 1);
  assert.equal(thrust(slot, () => { throw new Error('must not call'); }).hit, false, 'worn out spear cannot thrust');
  const m = { kind: 'metalspear', count: 1, durability: 100 };
  for (let i = 0; i < 39; i++) assert.equal(wearSpearSlot(m).broke, false);
  assert.ok(m.durability > 0);
  assert.equal(wearSpearSlot(m).broke, true);
  assert.equal(wearPerUse('metalspear'), 2.5);
  assert.equal(wearSpearSlot({ kind: 'hook', count: 1, durability: 100 }), null);
  assert.equal(wearSpearSlot(null), null);
});

test('thrust cooldown is 0.7 s', () => {
  assert.ok(canThrust(0, -Infinity));
  assert.ok(!canThrust(10.5, 10));
  assert.ok(!canThrust(10.69, 10));
  assert.ok(canThrust(10.7, 10));
});

test('tile HP: missing key is full, junk is full, values clamp', () => {
  const w = { tiles: [[0, 0], [1, 0]], tileHp: { '1,0': 40, '0,0': 'x', '5,5': 10 } };
  assert.equal(tileHpOf(w, 0, 0), 100);
  assert.equal(tileHpOf(w, 1, 0), 40);
  assert.equal(tileHpOf({ tiles: [] }, 3, 3), 100);
  assert.equal(tileHpOf({ tileHp: { '0,0': -5 } }, 0, 0), 0);
  assert.equal(damagedTile(w, 0, 0), null, 'full HP is not damaged');
  assert.deepEqual(damagedTile(w, 1, 0), { x: 1, z: 0, hp: 40, pct: 40 });
  assert.equal(damagedTile(w, 5, 5), null, 'no tile there');
  assert.equal(damagedTile(w, 0.5, 0), null);
});

test('repair costs 1 plank, adds 50 HP and caps at 100', () => {
  assert.deepEqual({ ...TILE_REPAIR_COST }, { wood: 1 }); assert.equal(REPAIR_HP, 50); assert.equal(TILE_MAX_HP, 100);
  const w = { tiles: [[0, 0], [1, 0]], tileHp: { '1,0': 20 } };
  const bag = bagWith({ wood: 2, plastic: 3 });
  let r = repairTile(w, 1, 0, bag);
  assert.deepEqual(r, { ok: true, hp: 70 }); assert.equal(w.tileHp['1,0'], 70); assert.equal(bag.count('wood'), 1);
  r = repairTile(w, 1, 0, bag);
  assert.deepEqual(r, { ok: true, hp: 100 }); assert.equal(bag.count('wood'), 0);
  assert.ok(!('1,0' in w.tileHp), 'healed tile drops its key');
  w.tileHp['0,0'] = 10;
  assert.deepEqual(repairTile(w, 0, 0, bag), { ok: false, reason: 'cost' }, 'no plank');
  assert.equal(w.tileHp['0,0'], 10);
  assert.deepEqual(repairTile(w, 1, 0, bagWith({ wood: 5 })), { ok: false, reason: 'full' });
  assert.deepEqual(repairTile(w, 9, 9, bagWith({ wood: 5 })), { ok: false, reason: 'tile' });
  assert.equal(repairedHp(80), 100); assert.equal(repairedHp(0), 50);
  const fresh = { tiles: [[0, 0]] };
  assert.deepEqual(repairTile(fresh, 0, 0, bagWith({ wood: 1 })), { ok: false, reason: 'full' }, 'no tileHp map yet');
});

test('HP bar text shows 10 cells and the rounded percentage', () => {
  assert.equal(hpBarText(42.4), '\u25A0'.repeat(4) + '\u25A1'.repeat(6) + ' 42%');
  assert.equal(hpBarText(200), '\u25A0'.repeat(10) + ' 100%');
  assert.equal(hpBarText(NaN), '\u25A1'.repeat(10) + ' 0%');
});
