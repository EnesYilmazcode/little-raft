// Unit tests for dist/tasks-rules.js and the content module in dist/tasks.js (docs/specs/tasks.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const R = await import(new URL('tasks-rules.js', base));
const { createTasks } = await import(new URL('tasks.js', base));
const { createContent } = await import(new URL('content.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const { POOL, BY_ID, pick, cleanTasks, observeTasks, rollTasks, claimTasks, taskView, DAY_SECONDS, BONUS } = R;

const ALL = { net: true, rod: true, grill: true, hammer: true, palm: true, notesLeft: true };
const NEEDY = ['cook', 'water', 'harvest', 'net', 'bottle', 'fish', 'fish4', 'floor'];
const withIds = (ids, extra = {}) => ({ ...cleanTasks(undefined, null, 7), ids, prog: [0, 0, 0], ...extra });

test('pick: deterministic, 3 distinct known ids, varies by day, respects needs', () => {
  for (const seed of [1, 42, 0xdeadbeef]) {
    const a = pick(seed, 5, ALL), b = pick(seed, 5, ALL);
    assert.deepEqual(a, b); assert.equal(a.length, 3); assert.equal(new Set(a).size, 3);
    for (const id of a) assert.ok(BY_ID[id]);
    const days = new Set(); for (let d = 0; d < 20; d++) days.add(pick(seed, d, ALL).join());
    assert.ok(days.size > 5, 'days differ');
    for (let d = 0; d < 60; d++) {
      const p = pick(seed, d, {}); assert.equal(p.length, 3);
      for (const id of p) assert.ok(!NEEDY.includes(id), id);
      assert.equal(pick(seed, d, undefined).length, 3);
    }
  }
  assert.equal(new Set(POOL.map(t => t.id)).size, POOL.length);
});

test('observeTasks: counting rules, clamps, finishing index once, unpicked ignored', () => {
  const st = withIds(['planks', 'net', 'rope']);
  assert.deepEqual(observeTasks(st, { kind: 'collect', type: 'wood', loot: { wood: 4 } }), []);
  assert.equal(st.prog[0], 4); assert.equal(st.prog[1], 0, 'net needs the net flag');
  assert.deepEqual(observeTasks(st, { kind: 'collect', type: 'wood', loot: { wood: 4 }, net: true }), [0]);
  assert.equal(st.prog[0], 6, 'clamped'); assert.equal(st.prog[1], 1);
  assert.deepEqual(observeTasks(st, { kind: 'collect', loot: { wood: 4 } }), [], 'already done: no second finish');
  assert.deepEqual(observeTasks(st, { kind: 'craft', item: 'hook' }), []);
  assert.deepEqual(observeTasks(st, { kind: 'craft', item: 'rope' }), [2]);
  assert.deepEqual(observeTasks(st, { kind: 'fish' }), [], 'unpicked event');
  const b = withIds(['floor', 'decor', 'cook']);
  observeTasks(b, { kind: 'build', recipe: 'floor' }); assert.deepEqual(b.prog, [1, 0, 0]);
  assert.deepEqual(observeTasks(b, { kind: 'build', recipe: 'bench' }), [1]);
  assert.deepEqual(observeTasks(b, { kind: 'cook', item: 'fish' }), [2]);
  const c = withIds(['island', 'bottle', 'barrels']);
  assert.deepEqual(observeTasks(c, { kind: 'gather', loot: [['sand', 1]] }), [0]);
  assert.deepEqual(observeTasks(c, { kind: 'bottle' }), [1]);
  observeTasks(c, { kind: 'collect', type: 'barrel', loot: { scrap: 1 } }); assert.equal(c.prog[2], 1);
  assert.deepEqual(observeTasks(c, null), []); assert.deepEqual(observeTasks(c, { kind: 7 }), []);
});

test('completion: third finish bumps streak and best once', () => {
  const st = withIds(['rope', 'decor', 'island']);
  observeTasks(st, { kind: 'craft', item: 'rope' }); observeTasks(st, { kind: 'build', recipe: 'bench' });
  assert.equal(st.streak, 0);
  observeTasks(st, { kind: 'gather' });
  assert.equal(st.streak, 1); assert.equal(st.best, 1);
  observeTasks(st, { kind: 'gather' }); observeTasks(st, { kind: 'craft', item: 'rope' });
  assert.equal(st.streak, 1); assert.equal(st.best, 1);
});

test('rollTasks: streak rules, owed per missing bit, new ids from pick', () => {
  const done = () => { const st = withIds(['rope', 'decor', 'island'], { streak: 2, best: 4 }); observeTasks(st, { kind: 'craft', item: 'rope' }); observeTasks(st, { kind: 'build', recipe: 'x' }); observeTasks(st, { kind: 'gather' }); return st; };
  const a = done(); assert.equal(a.streak, 3);
  a.claimed[0] = 1; a.bonus = 3;
  assert.ok(rollTasks(a, 1, ALL));
  assert.equal(a.streak, 3); assert.equal(a.day, 1); assert.deepEqual(a.ids, pick(a.seed, 1, ALL));
  assert.deepEqual(a.prog, [0, 0, 0]); assert.deepEqual(a.claimed, [0, 0, 0]); assert.equal(a.bonus, 0);
  assert.deepEqual(a.owed[0], { plastic: 1, rope: 1 }, 'host missed decor + island');
  assert.deepEqual(a.owed[1], { leaf: 2, plastic: 1, rope: 1 }, 'guest missed all three, bonus taken');
  const b = done(); rollTasks(b, 2, ALL); assert.equal(b.streak, 0); assert.equal(b.best, 4); assert.equal(b.day, 2);
  assert.deepEqual(b.owed[0], { leaf: 2, plastic: 1, rope: 1 + BONUS.rope, wood: BONUS.wood });
  const c = withIds(['rope', 'decor', 'island'], { streak: 3, best: 5 }); observeTasks(c, { kind: 'gather' });
  rollTasks(c, 1, ALL); assert.equal(c.streak, 0); assert.equal(c.best, 5); assert.deepEqual(c.owed[0], { rope: 1 });
  assert.equal(rollTasks(c, 0, ALL), false); assert.equal(c.day, 1);
});

class FakeBag {
  constructor(snap) { this.slots = snap ? snap.map(s => (s ? { ...s } : null)) : Array(4).fill(null); this.version = 0; }
  snapshot() { return this.slots.map(s => (s ? { ...s } : null)); }
  add(k, n) { for (let i = 0; i < this.slots.length && n > 0; i++) { const s = this.slots[i]; if (!s) { this.slots[i] = { kind: k, count: n }; return 0; } if (s.kind === k) { s.count += n; return 0; } } return n; }
  count(k) { return this.slots.reduce((t, s) => t + (s && s.kind === k ? s.count : 0), 0); }
}
const adder = bag => b => { const s = new FakeBag(bag.snapshot()); for (const [k, c] of Object.entries(b)) if (s.add(k, c) > 0) return false; bag.slots = s.slots; return true; };

test('claimTasks: validation, per-bit claims, full bag, bonus, owed', () => {
  const st = withIds(['rope', 'decor', 'island']);
  const bag = new FakeBag();
  assert.equal(claimTasks(st, { i: 5 }, 'host', adder(bag)).reason, 'bad');
  assert.equal(claimTasks(st, { i: 'x' }, 'host', adder(bag)).reason, 'bad');
  assert.equal(claimTasks(st, { i: 0 }, 'host', adder(bag)).reason, 'notdone');
  observeTasks(st, { kind: 'craft', item: 'rope' });
  assert.ok(claimTasks(st, { i: 0 }, 'host', adder(bag)).ok); assert.equal(bag.count('leaf'), 2);
  assert.equal(claimTasks(st, { i: 0 }, 'host', adder(bag)).reason, 'claimed'); assert.equal(bag.count('leaf'), 2);
  const gb = new FakeBag();
  assert.ok(claimTasks(st, { i: 0 }, 'guest', adder(gb)).ok); assert.equal(st.claimed[0], 3);
  assert.equal(claimTasks(st, { i: 'bonus' }, 'host', adder(bag)).reason, 'notdone');
  observeTasks(st, { kind: 'build', recipe: 'x' }); observeTasks(st, { kind: 'gather' });
  const full = new FakeBag([{ kind: 'stone', count: 1 }, { kind: 'sand', count: 1 }, { kind: 'clay', count: 1 }, { kind: 'wood', count: 1 }]);
  const r = claimTasks(st, { i: 'bonus' }, 'host', adder(full)); // rope does not fit
  assert.equal(r.reason, 'full'); assert.equal(full.count('wood'), 1, 'nothing added'); assert.equal(st.bonus, 0);
  assert.ok(claimTasks(st, { i: 'bonus' }, 'host', adder(bag)).ok); assert.equal(st.bonus, 1);
  assert.equal(claimTasks(st, { i: 'owed' }, 'host', adder(bag)).reason, 'empty');
  st.owed[0] = { scrap: 3 };
  assert.deepEqual(claimTasks(st, { i: 'owed' }, 'host', adder(bag)).loot, { scrap: 3 }); assert.deepEqual(st.owed[0], {});
  const v = taskView(st, 2); assert.equal(v.rows[0].claimed, true); assert.equal(v.rows[1].canClaim, true); assert.equal(v.bonus.canClaim, true);
  assert.equal(v.rows[0].reward, '2 leaf'); assert.equal(v.day, 1);
});

test('cleanTasks: junk -> fresh, clamps, unknown ids re-pick, masks and owed sanitised', () => {
  for (const junk of [undefined, null, 3, 'x', [1]]) { const s = cleanTasks(junk, null, 9); assert.equal(s.v, 1); assert.equal(s.day, 0); assert.equal(s.seed, 9); assert.equal(s.ids.length, 3); }
  const s = cleanTasks({ seed: 5, day: 3.7, ids: ['planks', 'rope', 'island'], prog: [99, -2, 'a'], claimed: [7, 2, 1.5], bonus: 9, streak: 4, best: 2, playT: 1e9, owed: [{ wood: 500, bogus: 3, leaf: 0 }, 'x'] });
  assert.deepEqual(s.prog, [6, 0, 0]); assert.deepEqual(s.claimed, [3, 2, 1]); assert.equal(s.bonus, 3); assert.equal(s.day, 3);
  assert.equal(s.best, 4); assert.equal(s.playT, DAY_SECONDS); assert.deepEqual(s.owed, [{ wood: 99 }, {}]);
  const u = cleanTasks({ seed: 5, day: 2, ids: ['planks', 'nope', 'island'], prog: [3, 3, 3] }, {});
  assert.deepEqual(u.ids, pick(5, 2, {})); assert.deepEqual(u.prog, [0, 0, 0]);
  const d = cleanTasks({ seed: 5, ids: ['planks', 'planks', 'island'] }, {}); assert.equal(new Set(d.ids).size, 3);
  assert.ok(JSON.stringify(cleanTasks(undefined, ALL, 0xffffffff)).length < 400);
});

function fakeCtx(over = {}) {
  const emits = [];
  const host = new Bag(), guest = new Bag();
  const ctx = {
    T: null, role: 'host', running: true, world: { decor: [], notes: [], garden: {} }, emits,
    actorBag: a => (a === 'guest' ? guest : host), emit: (e, to) => emits.push([e, to]), action() {},
    dayIndex: () => null, ...over,
  };
  return ctx;
}

test('module clock: day deltas roll, backwards resyncs, null source uses playT', () => {
  let day = 3;
  const ctx = fakeCtx({ dayIndex: () => day });
  const m = createTasks(ctx); m.load(undefined, 'save');
  m.update(.1); assert.equal(m.debug.state().day, 0, 'first sample only syncs');
  m.update(.1); assert.equal(m.debug.state().day, 0);
  day = 4; m.update(.1); assert.equal(m.debug.state().day, 1);
  assert.equal(ctx.emits.filter(([e]) => e.text === 'A fresh day, fresh tasks!').length, 1);
  day = 0; m.update(.1); assert.equal(m.debug.state().day, 1, 'restore reset: no roll');
  day = 1; m.update(.1); assert.equal(m.debug.state().day, 2);
  day = 4; m.update(.1); assert.equal(m.debug.state().day, 5, 'skips several days at once');
  const c2 = fakeCtx(); const n = createTasks(c2); n.load(undefined, 'save');
  n.update(DAY_SECONDS - 1); assert.equal(n.debug.state().day, 0);
  n.update(3); assert.equal(n.debug.state().day, 1); assert.ok(Math.abs(n.debug.state().playT - 2) < 1e-6);
  c2.running = false; n.update(DAY_SECONDS * 2); assert.equal(n.debug.state().day, 1, 'paused: no play time');
});

test('module: observe, claim action, guests never mutate, net load no-op on same data', () => {
  const ctx = fakeCtx();
  const m = createTasks(ctx); m.load({ seed: 1, day: 0, ids: ['rope', 'decor', 'island'] }, 'save');
  m.observe({ kind: 'craft', item: 'rope' }, 'host');
  assert.equal(m.debug.state().prog[0], 1);
  assert.ok(ctx.emits.some(([e, to]) => e.text === 'Task done: Twist a rope' && to === 'all'));
  assert.equal(m.action({ kind: 'tasks.claim', i: 0 }, 'host', ctx.actorBag('host')), true);
  assert.equal(ctx.actorBag('host').count('leaf'), 2);
  assert.equal(m.action({ kind: 'other' }, 'host', ctx.actorBag('host')), false);
  m.observe({ kind: 'build', recipe: 'bench' }); m.observe({ kind: 'gather' });
  assert.ok(ctx.emits.some(([e]) => e.kind === 'achievement' && e.text === 'Crew tasks done! Streak 1'));
  const data = JSON.parse(JSON.stringify(m.serialize()));
  assert.equal(m.view().rows[0].claimed, true);

  const g = fakeCtx({ role: 'guest', dayIndex: () => 0 });
  const gm = createTasks(g); gm.load(data, 'net');
  const before = JSON.stringify(gm.debug.state());
  gm.observe({ kind: 'craft', item: 'rope' }); gm.update(DAY_SECONDS * 3);
  gm.action({ kind: 'tasks.claim', i: 1 }, 'guest', g.actorBag('guest'));
  assert.equal(JSON.stringify(gm.debug.state()), before);
  assert.equal(g.actorBag('guest').count('plastic'), 0);
  const v1 = gm.view(); gm.load(JSON.parse(JSON.stringify(data)), 'net'); assert.equal(gm.view(), v1, 'same data: cached view kept');
  assert.equal(v1.rows[0].claimed, false, 'guest sees its own bit'); assert.equal(v1.rows[0].canClaim, true);
  gm.load(undefined, 'net'); assert.equal(gm.view(), null, 'old host: tab hidden');
});

test('content registry: observe fans out and swallows a throwing module; day() and tasksView()', () => {
  const seen = [];
  const bad = () => ({ name: 'bad', observe() { throw new Error('boom'); } });
  const good = () => ({ name: 'good', observe(ev, actor) { seen.push([ev.kind, actor]); } });
  const dn = () => ({ name: 'daynight', get day() { return 4; } });
  const tk = () => ({ name: 'tasks', view: () => ({ ok: 1 }) });
  const errors = console.error; console.error = () => {};
  try {
    const c = createContent({}, [bad, good, dn, tk]);
    c.observe({ kind: 'fish' }, 'guest'); c.observe({ kind: 'fish' }, 'host');
    assert.deepEqual(seen, [['fish', 'guest'], ['fish', 'host']]);
    assert.equal(c.day(), 4); assert.deepEqual(c.tasksView(), { ok: 1 });
    assert.equal(createContent({}, []).day(), null); assert.equal(createContent({}, []).tasksView(), null);
  } finally { console.error = errors; }
});
