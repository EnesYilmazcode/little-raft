// Round-6 save fixes: lane saves on unload, New Game wipes the old run, adopting another tab's save,
// the bottom-left feed cap, and host checks for guest grill/station actions.
// Run: node --test tests/r6-save.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const T = await import(new URL('vendor/three.module.js', base));

const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear() } });
globalThis.window ??= {};

const FC = await import(new URL('fishing-cooking.js', base));
const H = await import(new URL('progression-hooks.js', base));
const O = await import(new URL('onboarding.js', base));
const PF = await import(new URL('pickup-feed.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));

function fcHost({ role = 'solo', tiles = [[0, 0], [1, 0], [0, 1]], bag = { wood: 20, scrap: 6 } } = {}) {
  const counts = { ...bag }, sent = [], notices = [];
  const scene = new T.Scene(), raft = new T.Group(), camera = new T.PerspectiveCamera(70, 1, 0.05, 200); scene.add(raft, camera);
  const bagApi = { count: k => counts[k] || 0, remove: (k, n) => ((counts[k] || 0) >= n ? ((counts[k] -= n), true) : false),
    add: (k, n) => ((counts[k] = (counts[k] || 0) + n), 0), emit: t => notices.push(t) };
  const h = {
    scene, raft, camera, ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) }, signal: new AbortController().signal,
    rodModel: new T.Group(), role: () => h._role, _role: role, netReady: () => role !== 'solo', send: o => sent.push(o), notice: t => notices.push(t), beep() {},
    selectedKind: () => 'hook', aim: () => ({ point: null }), rodTip: () => null, player: () => ({ x: 0, y: 0.3, z: 0, yaw: 0 }),
    hasTile: (x, z) => tiles.some(([a, b]) => a === x && b === z), decorAt: () => false, bagCount: k => counts[k] || 0,
    running: () => true, uiBlocked: () => false, busy: () => false, saveBlocked: () => !!h._blocked,
    action(a) { if (a.kind.startsWith('fc:')) h.api.applyAction(a, 'host', bagApi); return true; },
  };
  h.api = FC.createFishingCooking(T, h);
  return Object.assign(h, { counts, sent, notices, bagApi });
}
const step = (h, sec, dt = 0.1) => { for (let t = 0; t < sec; t += dt) h.api.update(dt); };
const saved = () => JSON.parse(mem.get(FC.FC_SAVE_KEY));
function litGrillWithFish(h) {
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  const g = [...h.api.grills.values()][0];
  h.action({ kind: 'fc:fuel', id: g.st.id }); h.action({ kind: 'fc:fuel', id: g.st.id });
  h.api.applyAction({ kind: 'fc:cook', id: g.st.id, fish: { species: 'herring', cm: 22 } }, 'host', h.bagApi);
  return g;
}

function progGame(world = { tiles: [[0, 0], [1, 0]], decor: [], items: [], collected: 1 }) {
  const bags = { host: new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 }), guest: new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 }) };
  const g = { world, bags, blocked: false };
  g.ctx = { T: null, role: () => 'solo', ready: () => false, running: () => false, world: () => g.world, bag: a => bags[a], localBag: () => bags.host,
    action() {}, emit() {}, notice() {}, pose: () => ({ x: 0, z: 0, yaw: 0 }), saveBlocked: () => g.blocked };
  return g;
}

// ---------------------------------------------------------------- S1 / S3 / S5: lane saves

test('S1: game.js save() also flushes the progression and fishing-cooking saves after its guards', () => {
  const g = src('game.js'), body = g.slice(g.indexOf('  function save() {'), g.indexOf('// ---------- Movement'));
  assert.match(body, /if \(role === 'guest' \|\| disposed \|\| saveBlocked\) return;/);
  assert.ok(body.indexOf('prog?.save()') > body.indexOf('saveBlocked) return'), 'after the guards');
  assert.match(body, /prog\?\.save\(\)/); assert.match(body, /fc\?\.save\(\)/);
  assert.match(g, /on\(window, 'beforeunload', \(\) => \{ save\(\);/);
  assert.match(g, /on\(window, 'pagehide', \(\) => \{ if \(running\) save\(\); \}\)/);
  assert.match(g, /saveBlocked:\(\) => saveBlocked\}\); \/\/ \[progression-hook\]/, 'prog sees the host save block');
  assert.match(g, /busy:[^\n]*saveBlocked:\(\) => saveBlocked\};/, 'fc sees the host save block');
});

test('S5: a burning grill keeps the fc autosave dirty, so cook and fuel progress survive a reload', () => {
  mem.clear();
  const h = fcHost(), g = litGrillWithFish(h);
  step(h, 3.2); // first autosave (the actions marked it dirty)
  const fuel0 = saved().grills[0].fuel, t0 = saved().grills[0].slots[0].t;
  step(h, 6.2); // two more autosave ticks with nothing but the fire changing
  const s = saved().grills[0];
  assert.ok(s.fuel < fuel0 - 5, `fuel saved while burning: ${fuel0} -> ${s.fuel}`);
  assert.ok(s.slots[0].t > t0 + 5, 'cook progress saved');
  assert.ok(Math.abs(s.fuel - g.st.fuel) < 3.5);
  h.api.dispose();
});

test('S3: fc and progression standalone saves respect the host save block (another tab owns the save)', () => {
  mem.clear();
  const h = fcHost();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 }); h.api.save();
  assert.equal(saved().grills.length, 1);
  h._blocked = true;
  h.action({ kind: 'fc:placeGrill', x: 1, z: 0 }); step(h, 3.2); h.api.save(); h.api.dispose();
  assert.equal(saved().grills.length, 1, 'blocked tab never overwrote the fc save');

  mem.clear();
  const p = progGame(), a = H.attachProgression(p.ctx);
  const before = mem.get(H.PROGRESSION_KEY);
  a.progression('host').learned.add('lantern'); p.blocked = true; a.save();
  assert.equal(mem.get(H.PROGRESSION_KEY), before, 'blocked: progression save skipped');
  p.blocked = false; a.save();
  assert.ok(JSON.parse(mem.get(H.PROGRESSION_KEY)).host, 'unblocked: saves again');
  a.dispose();
});

// ---------------------------------------------------------------- S1: adoptStoredSave reloads lanes

test('S1: fc.reload() and prog.reload() take on state another tab saved', () => {
  mem.clear();
  const h = fcHost();
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  // the other tab's newer save: a grill at 1,0 and a caught salmon
  mem.set(FC.FC_SAVE_KEY, JSON.stringify({ v: 1, journal: { species: { salmon: { count: 2, bestCm: 60, firstAt: 1 } } }, grills: [{ id: 'other', x: 1, z: 0, fuel: 10 }] }));
  h.api.reload();
  assert.deepEqual([...h.api.grills.values()].map(g => [g.st.x, g.st.z]), [[1, 0]]);
  assert.equal(h.api.journal.entry('salmon').count, 2);
  h.api.dispose();

  mem.clear();
  const p = progGame(), a = H.attachProgression(p.ctx);
  a.barrelLuck.misses.scrap = 4;
  mem.set(H.PROGRESSION_KEY, JSON.stringify({ v: 1, host: { learned: ['lantern'] }, guest: {}, barrelLuck: { misses: { rope: 2 } } }));
  const luck = a.barrelLuck;
  a.reload();
  assert.equal(a.barrelLuck, luck, 'same barrel-luck object game.js reads');
  assert.deepEqual(a.barrelLuck.misses, { rope: 2 });
  assert.ok(a.progression('host').isUnlocked('lantern'));
  a.dispose();
});

test('S1/V3: game.js adoptStoredSave reloads fc, progression and vitals from the adopted world', () => {
  const g = src('game.js'), body = g.slice(g.indexOf('function adoptStoredSave()'), g.indexOf('  function save() {'));
  assert.match(body, /loadRaft\(savedOwnRaft\(\)\)/);
  assert.match(body, /Object\.assign\(vitals, newVitals\(world\.vitals\)\); fainted = -1; eating = null;/);
  assert.match(body, /prog\?\.reload\(\)/); assert.match(body, /fc\?\.reload\(\)/);
});

// ---------------------------------------------------------------- S2: New Game

test('S2: onboarding New Game wipe clears progression and logbook-seen, empties grills and basket, keeps the journal', () => {
  const m = new Map([[O.SAVE_KEY, '{}'], [O.KEY, '{}'], [O.PROGRESSION_KEY, '{"host":{}}'], [O.LOGBOOK_SEEN_KEY, '3'], ['keep-me', '1'],
    [O.FC_KEY, JSON.stringify({ v: 1, journal: { species: { salmon: { count: 2, bestCm: 60, firstAt: 1 } }, dishes: { 'Grilled Salmon': 1 }, basket: [{ species: 'salmon', cm: 60, state: 'cooked' }] }, grills: [{ id: 'g', x: 0, z: 0 }] })]]);
  const st = { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), del: k => m.delete(k) };
  O.wipeRun(st);
  for (const k of [O.SAVE_KEY, O.KEY, O.PROGRESSION_KEY, O.LOGBOOK_SEEN_KEY]) assert.equal(m.has(k), false, k);
  assert.equal(m.get('keep-me'), '1');
  const fc = JSON.parse(m.get(O.FC_KEY));
  assert.deepEqual(fc.grills, []); assert.deepEqual(fc.journal.basket, []);
  assert.equal(fc.journal.species.salmon.count, 2, 'the fish collection outlives a run'); assert.equal(fc.journal.dishes['Grilled Salmon'], 1);
  assert.equal(O.PROGRESSION_KEY, H.PROGRESSION_KEY); assert.equal(O.FC_KEY, FC.FC_SAVE_KEY);
  assert.match(src('logbook-ui.js'), new RegExp(`SEEN_KEY = '${O.LOGBOOK_SEEN_KEY}'`));
  O.wipeRun({ get: () => '{junk', set: (k, v) => m.set(k, v), del() {} }); // junk fc save: still a clean one
  assert.deepEqual(JSON.parse(m.get(O.FC_KEY)).grills, []);
  assert.match(src('onboarding.js'), /const clear = \(\) => wipeRun\(store\);/);
});

test('S2: fc.reset() and prog.reset() drop the old run (grills, basket, research, stations, barrel luck)', () => {
  mem.clear();
  const h = fcHost(); litGrillWithFish(h);
  h.api.journal.recordCatch({ species: 'salmon', cm: 60, stars: 1 });
  h.api.reset(); h.api.save();
  assert.equal(h.api.grills.size, 0); assert.deepEqual(saved().grills, []); assert.deepEqual(saved().journal.basket, []);
  assert.equal(h.api.journal.entry('salmon').count, 1, 'journal kept');
  h.api.dispose();

  mem.clear();
  const p = progGame({ tiles: [[0, 0]], decor: [{ type: 'smelter', x: 0, z: 0 }], items: [], collected: 1 }), a = H.attachProgression(p.ctx);
  a.tick(0.016); p.bags.host.add('metalore', 3); a.apply({ kind: 'prog:insert', key: '0,0', item: 'metalore', n: 3 }, 'host');
  a.progression('host').learned.add('lantern'); a.barrelLuck.misses.rope = 5;
  p.world = { tiles: [[0, 0]], decor: [], items: [], collected: 0 }; // newGame: loadRaft(fresh world) then reset
  a.reset(); a.save();
  const s = JSON.parse(mem.get(H.PROGRESSION_KEY));
  assert.deepEqual(s.stations, {}); assert.deepEqual(s.barrelLuck.misses, {});
  assert.equal(a.progression('host').isUnlocked('lantern'), false);
  a.dispose();
});

test('S2/V3: game.js newGame resets lanes, vitals, faint and eating before its save', () => {
  const g = src('game.js'), body = g.slice(g.indexOf('function newGame()'), g.indexOf('const hasSave'));
  for (const s of ['Object.assign(vitals, newVitals()); fainted = -1; eating = null;', 'prog?.reset()', 'fc?.reset()', "localStorage.removeItem('little-raft-logbook-seen')"])
    assert.ok(body.includes(s) && body.indexOf(s) < body.indexOf('save(); start();'), s);
});

// ---------------------------------------------------------------- S4: one feed, capped

function fakeDoc() {
  const mk = tag => {
    const el = { tagName: tag.toUpperCase(), nodeType: 1, children: [], parent: null, attrs: {}, textContent: '',
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === body; },
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { c.remove?.(); c.parent = this; this.children.push(c); return c; },
      prepend(c) { c.remove?.(); c.parent = this; this.children.unshift(c); return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); },
      replaceChildren(...cs) { [...this.children].forEach(c => c.remove()); this.append(...cs); },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } },
      set className(v) { v.split(' ').forEach(c => this.classList.add(c)); },
    };
    return el;
  };
  const body = mk('body');
  return { body, createElement: mk, createElementNS: (_, t) => mk(t),
    getElementById(id) { const walk = e => (e.id === id ? e : e.children.map(walk).find(Boolean)); return walk(body) ?? null; } };
}
function fakeClock() {
  let t = 0, id = 0; const q = new Map();
  return { now: () => t, timer: (fn, ms) => { q.set(++id, { fn, at: t + ms }); return id; }, clear: i => q.delete(i),
    tick(ms) { t += ms; for (const [i, j] of [...q]) if (j.at <= t && q.delete(i)) j.fn(); } };
}

test('S4: hint row and fading rows count toward MAX_ROWS; the newest row stays', () => {
  const doc = fakeDoc(), c = fakeClock(), feed = PF.createFeed({ doc, ...c });
  feed.note('first');
  const host = doc.getElementById('pickupFeed');
  const hint = doc.createElement('div'); hint.className = 'pf-row pf-note pf-hint'; host.prepend(hint);
  for (let i = 0; i < 12; i++) feed.note('burst ' + i);
  assert.ok(host.children.length <= PF.MAX_ROWS, `on screen ${host.children.length}`);
  assert.equal(host.children[0], hint, 'hint stays on top');
  assert.equal(feed.rows.at(-1), 'burst 11');
  c.tick(PF.HOLD_MS + 10); // all fade
  for (let i = 0; i < 3; i++) feed.note('late ' + i);
  assert.ok(host.children.length <= PF.MAX_ROWS, `with fading rows: ${host.children.length}`);
  c.tick(PF.FADE_MS + 10); feed.clear();
  assert.equal(host.children.length, 1, 'only the hint (owned by game.js) is left');
});

test('S4: feed height is capped below the top-left toasts; fc toasts go to the feed', () => {
  const css = src('style.css'), g = src('game.js');
  assert.match(css, /#pickupFeed\{[^}]*--pf-max:calc\(100vh - 178px - var\(--coop-feed-h, 0px\) - 80px\);max-height:var\(--pf-max\);overflow:hidden;overflow:visible clip;justify-content:flex-end/);
  assert.match(css, /min-width:761px\)\{#pickupFeed\{bottom:calc\(232px[^}]*--pf-max:calc\(100vh - 232px/);
  assert.match(g, /#pickupFeed\[popover\]\{[^}]*overflow:visible clip;[^}]*max-height:var\(--pf-max, none\)/);
  assert.match(g, /#pickupFeed\.docked\{[^}]*max-height:none\}/);

  mem.clear();
  const got = [], prev = globalThis.window.raftPickupFeed;
  globalThis.window.raftPickupFeed = { note: (t, k) => got.push([t, k]) };
  const h = fcHost();
  window.raftFC.forceCatch('herring');
  assert.ok(got.some(([t]) => /New species! Herring/.test(t)), JSON.stringify(got));
  h.api.dispose(); globalThis.window.raftPickupFeed = prev;
});

// ---------------------------------------------------------------- S6: guest grill / station actions

test('S6: cooking on a grill that is gone hands the fish back with a notice', () => {
  mem.clear();
  const h = fcHost({ role: 'host' });
  h.api.applyAction({ kind: 'fc:cook', id: 'nope', fish: { species: 'herring', cm: 22 } }, 'guest', h.bagApi);
  assert.deepEqual(h.sent.at(-1), { type: 'fc', took: { species: 'herring', cm: 22, state: 'raw' } });
  assert.ok(h.notices.includes('That grill is gone'));
  h.api.applyAction({ kind: 'fc:cook', id: 'nope', fish: { species: 'herring', cm: 22 } }, 'host', h.bagApi);
  assert.equal(h.api.journal.basket.at(-1).species, 'herring', 'host: back in its own basket');
  h.api.dispose();
});

test('S6: host checks reach for guest fc:* and prog:* actions (refunding a refused cook)', () => {
  const g = src('game.js'), body = g.slice(g.indexOf('function laneActionTile(a)'), g.indexOf("if (prog?.apply(a, actor)) return;"));
  assert.match(body, /actor === 'guest' && other && [^\n]*a\.kind\.startsWith\('fc:'\) \|\| a\.kind\.startsWith\('prog:'\)/);
  assert.match(body, /!inReach\(other\.x, other\.z, t\.x, t\.z, BUILD_REACH \+ GUEST_REACH_SLACK\)\) \{ fc\?\.refund\?\.\(a, actor\); emit\(\{kind:'notice', text:BLOCK_TEXT\.reach\}, actor\); return; \}/);
  assert.match(body, /fc\?\.grills\?\.get\(a\.id\)/); assert.match(body, /String\(a\.key \?\? ''\)\.split\(','\)/);
});
