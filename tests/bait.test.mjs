// Fishing bait (docs/specs/bait.md): items, the pure bait module, catch effects, journal, glue and the host hook.
// Run: node --test tests/bait.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { BAIT, BAIT_ORDER, BAIT_FLOOR, PREFS, isBait, baitWait, pickBait, nextPref, baitLabel } = await import(new URL('bait.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const { ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { rollCatch, speciesById } = await import(new URL('fish-species.js', base));
const { FishingSession } = await import(new URL('fishing-v2.js', base));
const { Journal } = await import(new URL('fish-journal.js', base));
const { createFishingCooking } = await import(new URL('fishing-cooking.js', base));

function seeded(seed = 12345) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bagOf = (o) => (k) => o[k] || 0;

test('bait items: materials with hand recipes, known to the bag and the recipe list, names match', () => {
  const want = {
    seaweedbait: [{ seaweed: 2 }, 3, ['seaweed', 'fishingrod']],
    chumbait: [{ fish: 1, seaweed: 1 }, 3, ['fish']],
    goldbait: [{ honey: 1, fish: 1, seaweed: 1 }, 2, ['honey', 'fish']],
  };
  assert.deepEqual([...BAIT_ORDER], Object.keys(want));
  for (const id of BAIT_ORDER) {
    const it = ITEMS[id], [cost, count, unlock] = want[id];
    assert.ok(it, id);
    assert.equal(it.category, 'material'); assert.equal(it.stack, 20); assert.equal(it.tool, false);
    assert.deepEqual(it.recipe, { cost, count, station: null });
    assert.deepEqual(it.unlock, { type: 'discover', items: unlock });
    assert.ok(!JSON.stringify(it).includes('puffegg'), `${id} has no puffegg`);
    assert.equal(it.placeholder, true); assert.equal(it.icon, `icon-${id}`);
    assert.equal(typeof it.tip, 'string');
    assert.ok(ITEM_INFO[id], `${id} ITEM_INFO`);
    assert.deepEqual(RECIPES[id]?.output, { kind: id, count }); assert.deepEqual(RECIPES[id].cost, cost);
    assert.equal(it.name, BAIT[id].name);
  }
  assert.deepEqual([...PREFS], ['auto', 'seaweedbait', 'chumbait', 'goldbait', 'none']);
  assert.ok(Object.isFrozen(BAIT) && Object.isFrozen(BAIT.goldbait.boost) && Object.isFrozen(BAIT_ORDER));
  assert.equal(isBait('goldbait'), true);
  for (const junk of ['fish', 'toString', '__proto__', '', null, 3, {}]) assert.equal(isBait(junk), false, String(junk));
});

test('baitWait: shorter with bait, floored at 1.5 s, never slower, junk ignored', () => {
  assert.equal(baitWait(6, null), 6);
  assert.equal(baitWait(6, 'goldbait'), 3);
  assert.equal(baitWait(2, 'goldbait'), BAIT_FLOOR);
  assert.equal(baitWait(1.2, 'chumbait'), 1.2);
  assert.equal(baitWait(6, 'fish'), 6); assert.equal(baitWait(6, 'nope'), 6); assert.equal(baitWait(6, undefined), 6);
  assert.ok(Math.abs(baitWait(6, 'seaweedbait') - 4.2) < 1e-9);
});

test('pickBait: auto takes the best owned, a tier pref wins while owned, none and empty -> null', () => {
  assert.equal(pickBait('auto', bagOf({ seaweedbait: 1, chumbait: 1, goldbait: 1 })), 'goldbait');
  assert.equal(pickBait('auto', bagOf({ seaweedbait: 1, chumbait: 1 })), 'chumbait');
  assert.equal(pickBait('auto', bagOf({ seaweedbait: 4 })), 'seaweedbait');
  assert.equal(pickBait('seaweedbait', bagOf({ seaweedbait: 1, goldbait: 1 })), 'seaweedbait');
  assert.equal(pickBait('seaweedbait', bagOf({ chumbait: 2 })), 'chumbait', 'ran out: best owned');
  assert.equal(pickBait('none', bagOf({ goldbait: 5 })), null);
  assert.equal(pickBait('auto', bagOf({})), null);
  assert.equal(pickBait('auto', () => { throw new Error('x'); }), null);
});

test('nextPref: cycles through owned tiers; a stale pref restarts at auto', () => {
  const c = bagOf({ chumbait: 2, goldbait: 1 });
  const seen = []; let p = 'auto';
  for (let i = 0; i < 4; i++) { p = nextPref(p, c); seen.push(p); }
  assert.deepEqual(seen, ['chumbait', 'goldbait', 'none', 'auto']);
  const empty = bagOf({});
  assert.equal(nextPref('auto', empty), 'none'); assert.equal(nextPref('none', empty), 'auto');
  assert.equal(nextPref('seaweedbait', c), 'auto', 'seaweed is no longer owned');
  assert.equal(nextPref('junk', c), 'auto');
});

test('baitLabel: chip text', () => {
  assert.deepEqual(baitLabel('auto', bagOf({ chumbait: 7 })), { text: '🪱 Fish Chum ×7', dim: false });
  assert.deepEqual(baitLabel('auto', bagOf({})), { text: 'No bait', dim: true });
  assert.deepEqual(baitLabel('none', bagOf({ goldbait: 3 })), { text: 'Bait off', dim: true });
  assert.deepEqual(baitLabel('seaweedbait', bagOf({ seaweedbait: 12, goldbait: 1 })), { text: '🪱 Seaweed Bait ×12', dim: false });
});

test('rollCatch: boost null is identical with 3 draws; shares match the spec table', () => {
  for (let i = 0; i < 200; i++) assert.deepEqual(rollCatch(seeded(i), { charge: 0.5, boost: null }), rollCatch(seeded(i), { charge: 0.5 }));
  for (const boost of [null, undefined, BAIT.goldbait.boost, { rare: 'x', legendary: -1 }]) {
    let n = 0; const r = seeded(3); rollCatch(() => (n++, r()), { charge: 0.5, boost }); assert.equal(n, 3);
  }
  // stratified sweep of the species draw: exact weight-derived shares within 1/N
  const share = (boost) => {
    const N = 20000, t = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (let i = 0; i < N; i++) { const seq = [(i + 0.5) / N, 0.5, 0.5]; let k = 0; t[speciesById(rollCatch(() => seq[k++], { charge: 0.5, boost }).species).rarity]++; }
    return { rarePlus: (t.rare + t.legendary) / N, legendary: t.legendary / N, uncommon: t.uncommon / N };
  };
  const table = { none: [0.161, 0.027], seaweedbait: [0.152, 0.025], chumbait: [0.235, 0.039], goldbait: [0.294, 0.068] };
  for (const [k, [rp, lg]] of Object.entries(table)) {
    const s = share(BAIT[k]?.boost ?? null);
    assert.ok(Math.abs(s.rarePlus - rp) <= 0.005, `${k} rare+ ${s.rarePlus}`);
    assert.ok(Math.abs(s.legendary - lg) <= 0.005, `${k} legendary ${s.legendary}`);
  }
  assert.ok(Math.abs(share(null).uncommon - 0.195) <= 0.005 && Math.abs(share(BAIT.seaweedbait.boost).uncommon - 0.24) <= 0.005);
});

function drive(seed, bait) {
  const s = new FishingSession({ rand: seeded(seed) }); if (bait !== undefined) s.setBait(bait);
  s.startCharge(); for (let i = 0; i < 11; i++) s.update(0.05); s.release();
  const events = []; let t = 0, firstWait = 0;
  for (let i = 0; i < 2000 && s.stage !== 'done'; i++) {
    const e = s.update(0.05); t += 0.05;
    if (e?.kind === 'landed') firstWait = s._wait;
    if (e) events.push(`${e.kind}@${t.toFixed(2)}`);
  }
  return { events, catch: s.catch, firstWait };
}

test('FishingSession: no bait keeps the pre-bait sequence; golden bait bites sooner but not under 1.5 s', () => {
  // recorded from the pre-bait fishing-v2.js with the same driver
  const before = {
    1: { events: ['landed@0.80', 'bite@6.90', 'missed@8.00', 'nibble@9.85', 'bite@10.65', 'escaped@11.75', 'done@12.45'], catch: { species: 'tilapia', cm: 39.5, stars: 3 } },
    42: { events: ['landed@0.80', 'nibble@5.35', 'bite@6.80', 'missed@7.90', 'nibble@9.95', 'bite@10.55', 'escaped@11.65', 'done@12.35'], catch: { species: 'mackerel', cm: 32, stars: 1 } },
  };
  for (const seed of [1, 42]) {
    for (const b of [undefined, null, 'junk']) {
      const r = drive(seed, b);
      assert.deepEqual({ events: r.events, catch: r.catch }, before[seed], `seed ${seed} bait ${b}`);
    }
  }
  const s = new FishingSession(); s.setBait('fish'); assert.equal(s.bait, null); s.setBait('chumbait'); assert.equal(s.bait, 'chumbait');
  for (let seed = 1; seed <= 30; seed++) {
    const plain = drive(seed), gold = drive(seed, 'goldbait');
    const bite = (r) => parseFloat(r.events.find((e) => e.startsWith('bite')).split('@')[1]);
    assert.ok(bite(gold) < bite(plain), `seed ${seed}`);
    assert.ok(gold.firstWait >= BAIT_FLOOR - 1e-9, `seed ${seed} wait ${gold.firstWait}`);
  }
});

test('Journal: recordBait counts, rejects junk, old saves load, empty is left out, round trip keeps counts', () => {
  const j = new Journal();
  assert.deepEqual(j.baited, {}); assert.equal(j.baitedTotal, 0);
  assert.equal('baited' in j.snapshot(), false);
  assert.deepEqual(Object.keys(j.snapshot()), ['species', 'dishes', 'basket']);
  assert.equal(j.recordBait('goldbait'), true); j.recordBait('goldbait'); j.recordBait('chumbait');
  for (const junk of ['fish', null, 'toString', 5]) assert.equal(j.recordBait(junk), false);
  assert.deepEqual(j.baited, { goldbait: 2, chumbait: 1 }); assert.equal(j.baitedTotal, 3);
  const back = new Journal(JSON.parse(JSON.stringify(j.snapshot())));
  assert.deepEqual(back.baited, { goldbait: 2, chumbait: 1 });
  assert.deepEqual(new Journal({ species: {}, dishes: {}, basket: [] }).baited, {});
  assert.deepEqual(new Journal({ baited: { goldbait: 2.7, fish: 4, chumbait: -1, seaweedbait: 'x', __proto__: 3 } }).baited, { goldbait: 2 });
  assert.deepEqual(new Journal({ baited: [1, 2] }).baited, {});
});

// ---------- glue (fake host, like fc-glue.test.mjs) ----------
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
globalThis.window ??= {};

function mount(bag) {
  const counts = { fishingrod: 1, ...bag }, notices = [], actions = [];
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200);
  scene.add(raft, camera);
  const h = {
    scene, raft, camera, ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) },
    signal: new AbortController().signal, rodModel: new T.Group(), role: () => 'solo', netReady: () => false, send() {},
    notice: (t) => notices.push(t), beep() {}, selectedKind: () => h._kind, _kind: 'fishingrod',
    aim: () => ({ point: new T.Vector3(), dir: new T.Vector3(0, 0, -1) }),
    rodTip: () => new T.Vector3(0.3, 1.4, -0.4), player: () => ({ x: 0, y: 0.3, z: 0, yaw: 0 }),
    hasTile: (x, z) => x === 0 && z === 0, decorAt: () => false,
    bagCount: (k) => counts[k] || 0, running: () => true, uiBlocked: () => false, busy: () => false,
    action(a) { actions.push(a); return true; },
  };
  h.api = createFishingCooking(T, h);
  return Object.assign(h, { counts, notices, actions });
}
const step = (h, sec, dt = 0.05) => { for (let t = 0; t < sec; t += dt) h.api.update(dt); };
const cast = (h) => { h.api.pointerDown(); step(h, 0.3); h.api.pointerUp(); };
function reel(h) {
  const fc = globalThis.window.raftFC;
  fc.forceBite('herring'); h.api.update(0.016);
  h.api.pointerDown(); assert.equal(fc.state.stage, 'reeling');
  let holding = true;
  for (let i = 0; i < 3000 && fc.state.stage === 'reeling'; i++) {
    const ten = fc.state.tension;
    if (holding && ten > 0.6) { h.api.pointerUp(); holding = false; } else if (!holding && ten < 0.3) { h.api.pointerDown(); holding = true; }
    h.api.update(1 / 30);
  }
  if (holding) h.api.pointerUp();
  return fc.state.stage;
}
const fishActions = (h) => h.actions.filter((a) => a.kind === 'fish');

test('glue: bait frozen at release is sent on the landed catch; bag changes mid-wait do not change it', () => {
  mem.clear();
  const h = mount({ chumbait: 2, seaweedbait: 5 });
  const fc = globalThis.window.raftFC;
  cast(h);
  assert.equal(fc.session.bait, 'chumbait');
  h.counts.chumbait = 0; h.counts.goldbait = 9; step(h, 1); // partner stashes the chum and drops gold mid-wait
  assert.equal(fc.session.bait, 'chumbait');
  assert.match(h.api.prompt, /^Waiting for a bite… · Fish Chum \(click early/);
  let stage = reel(h);
  for (let tries = 0; stage === 'escaped' && tries < 5; tries++) { step(h, 1); h.counts.chumbait = 2; cast(h); stage = reel(h); }
  assert.equal(stage, 'caught');
  const sent = fishActions(h);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { kind: 'fish', bait: sent[0].bait });
  assert.ok(isBait(sent[0].bait));
  assert.equal(h.api.journal.baitedTotal, 1);
  h.api.dispose();
});

test('glue: an unbaited catch sends exactly {kind:"fish"}; escape and cancel send nothing', () => {
  mem.clear();
  const h = mount({});
  const fc = globalThis.window.raftFC;
  cast(h); assert.equal(fc.session.bait, null);
  step(h, 1.2);
  assert.equal(h.api.prompt, 'Waiting for a bite… (click early and it’ll spook)');
  h.api.pointerDown(); h.api.pointerUp(); h.api.update(0.016); // early click: spooked
  assert.equal(fc.state.stage, 'escaped');
  step(h, 1);
  h.counts.goldbait = 3; cast(h); assert.equal(fc.session.bait, 'goldbait');
  fc.session.cancel(); step(h, 0.2);
  assert.deepEqual(fishActions(h), [], 'no catch, no fish action, no bait');
  h.counts.goldbait = 0;
  let stage = 'escaped';
  for (let tries = 0; stage !== 'caught' && tries < 6; tries++) { step(h, 1); cast(h); assert.equal(fc.session.bait, null); stage = reel(h); }
  assert.equal(stage, 'caught');
  assert.deepEqual(fishActions(h), [{ kind: 'fish' }]);
  assert.equal(JSON.stringify(fishActions(h)[0]), '{"kind":"fish"}');
  assert.equal(h.api.journal.baitedTotal, 0);
  h.api.dispose();
});

test('glue: alt() cycles the bait with notices, and needs the rod', () => {
  mem.clear();
  const h = mount({ chumbait: 7, goldbait: 1 });
  const fc = globalThis.window.raftFC;
  assert.equal(h.api.alt(), true); assert.equal(h.notices.at(-1), 'Bait: Fish Chum ×7');
  cast(h); assert.equal(fc.session.bait, 'chumbait');
  step(h, 0.3);
  assert.equal(h.api.alt(), true); assert.equal(h.notices.at(-1), 'Bait: Golden Bait ×1 (next cast)');
  assert.equal(fc.session.bait, 'chumbait', 'the line already out keeps its bait');
  assert.equal(h.api.alt(), true); assert.equal(h.notices.at(-1), 'Bait: off (next cast)');
  fc.session.cancel(); step(h, 0.2);
  assert.equal(h.api.alt(), true); assert.equal(h.notices.at(-1), 'Bait: Auto · Golden Bait ×1');
  h.counts.chumbait = 0; h.counts.goldbait = 0;
  h.api.alt(); assert.equal(h.notices.at(-1), 'Bait: off');
  h.api.alt(); assert.equal(h.notices.at(-1), 'Bait: Auto · none in your bag');
  h._kind = 'hammer'; const n = h.notices.length;
  assert.equal(h.api.alt(), false); assert.equal(h.notices.length, n);
  h.api.dispose();
});

test('host: game.js removes bait only after the fish fits, and only through isBait', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  assert.match(src, /import \{ isBait \} from '\.\/bait\.js\?build=[^']+';/);
  const at = src.indexOf("if (a.kind === 'fish') {");
  assert.ok(at > 0);
  const block = src.slice(at, src.indexOf('return; // [tasks] observe', at));
  const add = block.indexOf("if (bag.add('fish', 1) > 0) {"), rm = block.indexOf('bag.remove(a.bait, 1)');
  assert.ok(add > 0 && rm > add, 'bait removed after a successful add');
  assert.equal(block.match(/bag\.remove\(/g).length, 1);
  assert.match(block, /if \(isBait\(a\.bait\) && bag\.count\(a\.bait\) > 0\) bag\.remove\(a\.bait, 1\);/);
  assert.doesNotMatch(block, /wear|durability/);
});
