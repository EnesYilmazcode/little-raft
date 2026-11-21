// Round-5 survival regressions: faint blocks input and ends the rod cast, eating uses the held slot, honeyfish is
// food, grilled dishes reach the bag, and only the pause menu freezes vitals.
// Run: node --test tests/r5-survival.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = (f) => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const T = await import(new URL('vendor/three.module.js', base));
const V = await import(new URL('vitals.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { createFishingCooking } = await import(new URL('fishing-cooking.js', base));
const game = src('game.js');

const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
globalThis.window ??= {};

function mount({ role = 'solo', bagFull = false } = {}) {
  const counts = { wood: 20, scrap: 6, fishingrod: 1 }, sent = [], notices = [];
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200);
  scene.add(raft, camera);
  const bagApi = {
    count: (k) => counts[k] || 0,
    remove: (k, n) => ((counts[k] || 0) >= n ? ((counts[k] -= n), true) : false),
    add: (k, n) => (h._full ? n : ((counts[k] = (counts[k] || 0) + n), 0)),
    emit: (t) => notices.push(t),
  };
  const h = {
    scene, raft, camera, ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) },
    signal: new AbortController().signal, rodModel: new T.Group(), role: () => role, netReady: () => role !== 'solo',
    send: (o) => sent.push(o), notice: (t) => notices.push(t), beep() {}, selectedKind: () => 'fishingrod',
    aim: () => ({ point: new T.Vector3(), dir: new T.Vector3(0, 0, -1) }), rodTip: () => new T.Vector3(0.3, 1.4, -0.4),
    player: () => ({ x: 0, y: 0.3, z: 0, yaw: 0 }), hasTile: (x, z) => x === 0 && z === 0, decorAt: () => false,
    bagCount: (k) => counts[k] || 0, running: () => true, uiBlocked: () => !!h._blocked, busy: () => false,
    action(a) { if (a.kind.startsWith('fc:')) h.api.applyAction(a, 'host', bagApi); return true; },
    _full: bagFull,
  };
  h.api = createFishingCooking(T, h);
  return Object.assign(h, { counts, sent, notices, bagApi });
}

// ---------- SURV-1: no input while passed out ----------
test('SURV-1: one inputBlocked() choke point covers faint; pointer lock still follows uiBlocked only', () => {
  assert.match(game, /const inputBlocked = \(\) => uiBlocked\(\) \|\| fainted >= 0;/);
  assert.match(game, /const uiBlocked = \(\) => dialogOpen\(\) \|\| !!survivalUI\?\.isOpen;/, 'uiBlocked (lock, resume hint) ignores faint');
  assert.match(game, /createControls\(\{canvas, isBlocked:\(\) => !running \|\| inputBlocked\(\)/, 'controls lane: use/interact/bag/repair');
  assert.match(game, /running:\(\) => running, uiBlocked:inputBlocked,/, 'fc host: rod canFish / grill / J / G');
  assert.match(game, /function interact\(\) \{\n\s+if \(!running \|\| inputBlocked\(\)/);
  assert.match(game, /function openInventory\(\) \{ if \(!running \|\| !survivalUI \|\| fainted >= 0\) return;/);
  assert.match(game, /function repair\(\) \{ if \(!running \|\| fainted >= 0\) return;/);
  assert.match(game, /function beginCharge\(at\) \{\n\s+if \(!running \|\| hook \|\| fishWait \|\| fainted >= 0/);
  assert.match(game, /if \(!c \|\| !running \|\| hook \|\| fainted >= 0/, 'releaseCharge');
  assert.match(game, /if \(fainted >= 0\) \{ if \(!isLocked\(\)\) down = \{[^}]*used:true\}; return; \}[^\n]*\n\s+if \(isLocked\(\)\) \{\n\s+if \(fc\?\.pointerDown\(\)\)/, 'canvas pointerdown');
  assert.match(game, /keyDecision\(\{inField:[^}]*blocked:inputBlocked\(\)\}\)/, 'legacy key path');
  // faint never touches the lock or the resume hint
  assert.match(game, /function refreshPointerUI[\s\S]{0,80}dialog = uiBlocked\(\);/);
  assert.match(game, /shouldRequestLock\(\{running, supported:lockSupported, blocked:uiBlocked\(\)\}\)/);
  const pass = game.slice(game.indexOf('function passOut()'), game.indexOf('function passOut()') + 260);
  assert.doesNotMatch(pass, /releaseLock|exitPointerLock/);
});

test('SURV-1: the fc lane refuses a rod press while the host reports input blocked', () => {
  mem.clear();
  const h = mount(); h._blocked = true;
  assert.equal(h.api.pointerDown(), false);
  assert.equal(globalThis.window.raftFC.session, null);
  h.api.dispose();
});

// ---------- SURV-2: rod session ends on faint ----------
test('SURV-2: fc.cancelSession drops a live rod cast and the held press', () => {
  mem.clear();
  const h = mount();
  assert.equal(h.api.pointerDown(), true);
  assert.ok(globalThis.window.raftFC.session, 'charging');
  h.api.cancelSession();
  assert.equal(globalThis.window.raftFC.session, null);
  assert.equal(h.api.pointerUp(), false, 'no stale held press fires a cast later');
  h.api.update(0.1);
  assert.equal(globalThis.window.raftFC.state.stage, 'idle');
  h.api.dispose();
  assert.match(game, /function passOut\(\) \{[\s\S]{0,200}fc\?\.cancelSession\?\.\(\);/);
});

// ---------- SURV-3: eat from the held slot ----------
test('SURV-3: Bag.takeAt/putAt act on one slot only, atomically', () => {
  const b = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  b.slots[0] = { kind: 'fish', count: 2 }; b.slots[5] = { kind: 'fish', count: 3 };
  assert.equal(b.takeAt(0, 1), true);
  assert.deepEqual([b.slots[0].count, b.slots[5].count], [1, 3], 'the held stack shrinks, not the last one');
  assert.equal(b.takeAt(0, 2), false); assert.equal(b.slots[0].count, 1);
  assert.equal(b.takeAt(0, 1), true); assert.equal(b.slots[0], null);
  assert.equal(b.takeAt(0, 1), false); assert.equal(b.takeAt(99, 1), false); assert.equal(b.takeAt(5, 0), false);
  assert.equal(b.putAt(0, 'cup', 1), true); assert.deepEqual(b.slots[0], { kind: 'cup', count: 1 });
  assert.equal(b.putAt(0, 'cup', 1), false, 'occupied slot');
  assert.equal(b.putAt(1, 'nope', 1), false);
  assert.doesNotThrow(() => new Bag(b.snapshot()), 'slots stay valid');
});

test('SURV-3: eat sends the held slot and the host decrements it (cup back into that hand)', () => {
  assert.match(game, /const \{item, slot\} = eating; eating = null; action\(\{kind:'eat', item, slot\}\);/);
  assert.match(game, /at = isInt\(a\.slot\) && s\.slots\[a\.slot\]\?\.kind === k \? a\.slot : -1;/);
  assert.match(game, /if \(!\(at >= 0 \? s\.takeAt\(at, 1\) : s\.remove\(k, 1\)\)\) return;/);
  assert.match(game, /if \(back && !\(at >= 0 && s\.putAt\(at, back, 1\)\) && s\.add\(back, 1\) > 0\)/);
  // the same rule, run on a Bag: hotbar slot 2 holds the drink, a later slot holds another
  const b = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 2 });
  b.slots[2] = { kind: 'freshcup', count: 1 }; b.slots[12] = { kind: 'freshcup', count: 2 };
  const at = 2; assert.ok(b.takeAt(at, 1)); assert.ok(b.putAt(at, 'cup', 1));
  assert.deepEqual(b.slots[2], { kind: 'cup', count: 1 }); assert.equal(b.slots[12].count, 2);
});

// ---------- SURV-4: honeyfish ----------
test('SURV-4: honey glazed fish is edible and its tip says so', () => {
  assert.ok(V.isEdible('honeyfish'));
  assert.deepEqual(V.FOOD.honeyfish, { food: 45, water: 5 });
  assert.equal(V.eatLabel('honeyfish'), 'Eat (+45 food, +5 water)');
  assert.match(src('items.js'), /item\('honeyfish'[\s\S]{0,200}tip: '[^']*\+45 food, \+5 water/);
});

// ---------- SURV-5: grilled dishes reach the bag ----------
test('SURV-5: taking a cooked dish adds cookedfish to the bag; burnt stays journal-only', () => {
  mem.clear();
  const h = mount();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  h.counts.fish = 1;
  h.action({ kind: 'fc:cook', id: g.st.id, fish: { species: 'pomfret', cm: 25 } });
  assert.equal(h.counts.fish, 0, 'cooking uses the bag fish of that catch');
  h.action({ kind: 'fc:cook', id: g.st.id, fish: { species: 'pomfret', cm: 26 } });
  assert.equal(h.counts.fish, 0, 'no bag fish: nothing else removed');
  g.st.slots[0].state = 'cooked'; g.st.slots[1].state = 'burnt';
  h.action({ kind: 'fc:take', id: g.st.id, slot: 0 });
  assert.equal(h.counts.cookedfish, 1);
  assert.equal(h.api.journal.basket.at(-1).state, 'cooked');
  h.action({ kind: 'fc:take', id: g.st.id, slot: 1 });
  assert.equal(h.counts.cookedfish, 1, 'burnt adds no food');
  assert.equal(h.api.journal.basket.at(-1).state, 'burnt');
  h.api.dispose();
});

test('SURV-5: a full bag refuses the take and leaves the dish on the grill', () => {
  mem.clear();
  const h = mount({ role: 'host' });
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  g.st.slots[0] = { species: 'pomfret', cm: 25, t: 30, state: 'cooked' };
  h._full = true;
  h.api.applyAction({ kind: 'fc:take', id: g.st.id, slot: 0 }, 'guest', h.bagApi);
  assert.equal(g.st.slots[0]?.state, 'cooked', 'still on the grill');
  assert.ok(h.notices.some((t) => /Bag full/.test(t)));
  assert.ok(!h.sent.some((m) => m.took), 'nothing handed to the guest');
  h._full = false;
  h.api.applyAction({ kind: 'fc:take', id: g.st.id, slot: 0 }, 'guest', h.bagApi);
  assert.equal(h.counts.cookedfish, 1, "the guest's bag (host-side) gets the dish");
  assert.equal(g.st.slots[0], null);
  h.api.dispose();
});

// ---------- SURV-6: only the pause menu freezes vitals; HP 0 always faints ----------
test('SURV-6: vitals freeze only for the solo pause menu and HP 0 faints before any early return', () => {
  const body = game.slice(game.indexOf('function updateVitals('), game.indexOf('function passOut()'));
  assert.doesNotMatch(body, /dialog && dialogOpen\(\)\) return/);
  const faint = body.indexOf('if (vitals.hp <= 0) { passOut(); return; }'), pause = body.indexOf("if (role === 'solo' && settingsController?.isOpen) return;");
  assert.ok(faint > 0 && pause > faint, 'faint check sits above the pause return');
  assert.ok(body.indexOf('tickVitals(vitals, dt, vitalsOpts);\n    if (vitals.hp <= 0) passOut();') > pause);
});
