// Raft hook feel: 40-use plastic hook that breaks (no R repair), fixed rope per hook kind, pulled reel
// rhythm, a bold charge arc, Q drop as a floating bundle, and a thick tan rope.
// Run: node --test tests/hook-fidelity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { HookCast, HOOK_SPECS, hookSpec, reelPulse, WATER_Y } = await import(new URL('hook-physics.js', base));
const { ITEMS, wearPerUse } = await import(new URL('items.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const D = await import(new URL('drop-rules.js', base));
const { EVENTS } = await import(new URL('audio.js', base));
const { ACTIONS, DEFAULT_BINDINGS } = await import(new URL('input-map.js', base));
const src = f => readFile(new URL(f, base), 'utf8');
const game = await src('game.js');

test('durability: plastic hook lasts 40 hooked items, the metal hook 150', () => {
  assert.equal(ITEMS.hook.durability, 40);
  assert.equal(wearPerUse('hook'), 2.5);
  let d = 100, n = 0; while (d > 0) { d = Math.max(0, d - wearPerUse('hook')); n++; }
  assert.equal(n, 40);
  let m = 100, k = 0; while (m > 0) { m -= wearPerUse('metalhook'); if (m < 1e-6) m = 0; k++; }
  assert.equal(k, 150, 'float residue must not grant a 151st use');
  assert.deepEqual(ITEMS.hook.recipe.cost, { wood: 1, plastic: 2 });
});

test('wear is per hooked item (not per cast); at 0 the hook breaks and leaves the bag', () => {
  assert.doesNotMatch(game, /wornCasts/, 'no once-per-cast guard');
  assert.equal((game.match(/if \(typeof a\.cast === 'string' && a\.cast\) wearHook\(bag, a\.slot, actor\);/g) || []).length, 2, 'supply + bottle collects each wear');
  const fn = game.slice(game.indexOf('function wearHook('), game.indexOf('function applyAction('));
  assert.match(fn, /bag\.slots\[i\] = null/);
  assert.match(fn, /'Your hook broke!'/);
  assert.match(fn, /sound:'snap'/);
  assert.ok(EVENTS.includes('snap'), 'snap sound recipe');
  assert.match(fn, /canCraft\('hook'\)/, 'hints at the 1 wood + 2 plastic recipe when it cannot be re-crafted');
});

test('no R hook repair; R stays rotate (and the spade keeps its own repair)', () => {
  assert.doesNotMatch(game, /repairHookSlot/);
  assert.doesNotMatch(game, /a\.kind === 'repair'/);
  assert.doesNotMatch(game, /R to repair|R repairs/);
  const fn = game.slice(game.indexOf('function repair()'), game.indexOf('function pickBuildPiece('));
  assert.match(fn, /treasure\.repair/);
  assert.doesNotMatch(fn, /kind:'repair'/);
});

test('rope length is fixed per hook kind (wear never shortens it); metal reaches and reels further/faster', () => {
  assert.doesNotMatch(game, /16 \+ durability \* \.16/);
  assert.match(game, /maxRange:spec\.range, reelSpeed:spec\.reel/);
  assert.deepEqual({ ...HOOK_SPECS.hook }, { range: 20, reel: 4 });
  assert.deepEqual({ ...HOOK_SPECS.metalhook }, { range: 26, reel: 6 });
  assert.equal(hookSpec('nope'), HOOK_SPECS.hook);
  assert.equal(hookSpec('__proto__'), HOOK_SPECS.hook);
});

test('reel rhythm: speed pulses between 0.6x and 1x at 2 Hz, starting on a slow beat', () => {
  assert.equal(reelPulse(0), 0.6);
  assert.ok(Math.abs(reelPulse(0.25) - 1) < 1e-12);
  assert.ok(Math.abs(reelPulse(0.5) - 0.6) < 1e-12, 'period 0.5 s = 2 pulls a second');
  for (let t = 0; t < 2; t += 0.013) { const v = reelPulse(t); assert.ok(v >= 0.6 - 1e-12 && v <= 1 + 1e-12); }
  assert.equal(reelPulse(NaN), 0.6);
});

function reelTime(reelSpeed) {
  const h = new HookCast(T, { origin: { x: 0, y: WATER_Y, z: 0 }, direction: { x: 0, y: 0, z: -1 }, maxRange: 30, reelSpeed });
  h.position.set(0, WATER_Y, -12); h.base.set(0, WATER_Y, -12); h.stage = 'floating';
  const hand = { x: 0, y: 1.2, z: 0 }; let t = 0, ev = null; const steps = [];
  let prev = 12;
  while (t < 20 && !ev) { ev = h.update(1 / 60, { hand, items: [], reeling: true, time: t }); t += 1 / 60; const d = Math.hypot(h.position.x, h.position.z); steps.push(prev - d); prev = d; }
  return { t, ev, steps };
}

test('reel: about 4 m/s peak for plastic (6 for metal), in pulled steps', () => {
  const p = reelTime(HOOK_SPECS.hook.reel), m = reelTime(HOOK_SPECS.metalhook.reel);
  assert.equal(p.ev?.kind, 'returned'); assert.equal(m.ev?.kind, 'returned');
  // 11.3 m at a mean of ~0.855 x peak
  assert.ok(p.t > 3 && p.t < 3.8, `plastic reel took ${p.t.toFixed(2)} s`);
  assert.ok(m.t > 2 && m.t < 2.6, `metal reel took ${m.t.toFixed(2)} s`);
  const mid = p.steps.slice(5, 120), lo = Math.min(...mid) * 60, hi = Math.max(...mid) * 60;
  assert.ok(hi <= 4.01 && hi > 3.9, `peak ${hi}`);
  assert.ok(lo < 2.5 && lo > 2.3, `trough ${lo}`);
  const def = new HookCast(T, { origin: { x: 0, y: 2, z: 0 } });
  assert.equal(def.reelSpeed, 4);
});

test('charge feedback: one bold cream arc around the crosshair, ~7% H with a ~1% H band, filling clockwise from 12', async () => {
  const css = await src('graphics.css');
  const rule = css.slice(css.indexOf('#chargeMeter{'), css.indexOf('}', css.indexOf('#chargeMeter{')));
  assert.match(rule, /--d:max\(36px,7vh\)/);
  assert.match(rule, /--b:max\(4px,1vh\)/);
  assert.match(rule, /conic-gradient\(from 0deg,#f6e4c9 calc\(var\(--c,0\) \* 360deg\)/);
  const fn = game.slice(game.indexOf('const holdProgress'), game.indexOf('// Body classes, crosshair'));
  assert.match(fn, /charging \? chargeValue\(\)/, 'hook throw power');
  assert.match(fn, /eating \? clamp\(eating\.t \/ EAT_SECONDS/, 'reused for eating / drinking');
  assert.match(fn, /w !== chargeWidth/, 'DOM written only on change');
});

test('rope: thick weathered-tan tube from rope.js replaces the thin pale line', async () => {
  assert.match(game, /createRope\(T, \{segments:ROPE_SEGMENTS, radius:\.016\}\)/);
  assert.doesNotMatch(game, /LineBasicMaterial\(\{color:'#e9d39a'\}\)/);
  const rope = await src('rope.js');
  const [r, g, b] = rope.match(/const TAN_LIGHT = \[([^\]]+)\]/)[1].split(',').map(Number);
  assert.ok(r < 0.3 && g < r && b < g, 'dark mid-brown (linear) instead of pale cream');
  const { createRope } = await import(new URL('rope.js', base));
  const t = createRope(T, { segments: 16, radius: 0.018 });
  const pts = Array.from({ length: 17 }, (_, i) => new T.Vector3(i, 0.5, 0));
  t.update(pts, { tension: 1 }); assert.equal(t.mesh.visible, true); t.dispose();
});

test('Q drop: input binding, controls help and host action', () => {
  assert.ok(ACTIONS.some(a => a.id === 'drop'));
  assert.deepEqual(DEFAULT_BINDINGS.drop.keys, ['KeyQ']);
  assert.match(game, /<kbd>Q<\/kbd><span><b>Drop<\/b>/);
  const fn = game.slice(game.indexOf("if (a.kind === 'drop')"), game.indexOf("if (a.kind === 'emptyNet')"));
  assert.match(fn, /takeOne\(bag, a\.slot\)/);
  assert.match(fn, /type:'bundle'/);
  assert.match(fn, /MAX_DROPS/);
  assert.match(game, /isDrop \? \{\[it\.kind\]:it\.count\}/, 'a hooked/grabbed bundle gives back exactly its kind + count');
});

test('drop-rules: takeOne takes one, tools keep their wear, empty slots give null', () => {
  const bag = Bag.fromCounts({ wood: 5 }, { tools: ['hook'] });
  const hi = bag.slots.findIndex(s => s?.kind === 'hook'), wi = bag.slots.findIndex(s => s?.kind === 'wood');
  bag.slots[hi].durability = 37.5;
  assert.deepEqual(D.takeOne(bag, wi), { kind: 'wood', count: 1 });
  assert.equal(bag.count('wood'), 4);
  assert.deepEqual(D.takeOne(bag, hi), { kind: 'hook', count: 1, dur: 37.5 });
  assert.equal(bag.slots[hi], null);
  assert.equal(D.takeOne(bag, hi), null);
  assert.equal(D.takeOne(bag, -1), null);
  assert.equal(D.takeOne(bag, 1.5), null);
  // giving it back restores the tool's wear
  const back = new Bag(bag.snapshot());
  assert.equal(back.add('hook', 1, D.dropMeta({ kind: 'hook', count: 1, dur: 37.5 })), 0);
  assert.equal(back.slots.find(s => s?.kind === 'hook').durability, 37.5);
});

test('drop-rules: the bundle lands in open water past the deck edge, never on a tile', () => {
  const tiles = new Set(['0,0', '1,0', '0,1', '1,1']); // 2x2 start (2 m tiles centred on even metres)
  const onTile = (x, z) => tiles.has(`${Math.round(x / 2)},${Math.round(z / 2)}`);
  for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0], [0, 1], [0.7, -0.7], [0, 0]]) {
    const p = D.dropSpot(1, 1, dx, dz, onTile);
    assert.ok(!onTile(p.x, p.z), `on deck for ${dx},${dz}`);
    assert.ok(Math.hypot(p.x - 1, p.z - 1) < 6, 'close to the raft');
  }
  const front = D.dropSpot(1, 1, 0, -1, onTile);
  assert.ok(front.z < -1 - 0.5 && Math.abs(front.x - 1) < 1e-9, 'straight out in front');
  const swim = D.dropSpot(10, 10, 0, -1, onTile);
  assert.ok(Math.hypot(swim.x - 10, swim.z - 9.4) < 1.2, 'a swimmer drops it just ahead');
});

test('drop-rules: payload validation, ids and counts', () => {
  assert.deepEqual(D.cleanDrop({ kind: 'plastic', count: 1 }), { kind: 'plastic', count: 1 });
  assert.deepEqual(D.cleanDrop({ kind: 'hook', count: 1, dur: 140 }), { kind: 'hook', count: 1, dur: 100 });
  for (const bad of [null, {}, { kind: 'Wood', count: 1 }, { kind: 'wood', count: 0 }, { kind: 'wood', count: 1.5 }, { kind: '<x>', count: 1 }, { kind: 'wood', count: 100 }])
    assert.equal(D.cleanDrop(bad), null, JSON.stringify(bad));
  assert.equal(D.nextDropId([{ id: 3 }, { id: 29 }]), D.DROP_ID0);
  assert.equal(D.nextDropId([{ id: 3 }, { id: 1004 }]), 1005);
  assert.equal(D.dropCount([{ type: 'bundle' }, { type: 'wood' }, { type: 'bundle' }]), 2);
  assert.deepEqual(D.dropMeta({ kind: 'wood', count: 1 }), {});
});

test('soft-lock guard: grabbing debris by hand with E needs no hook', () => {
  const fn = game.slice(game.indexOf('function pickupFrom('), game.indexOf('// ---------- Watering'));
  assert.match(fn, /PICKUP_REACH/);
  assert.doesNotMatch(fn, /hook/i, 'hand pickup does not depend on owning a hook');
  const inter = game.slice(game.indexOf('function interact()'), game.indexOf('// Left click uses the selected bag item'));
  assert.match(inter, /action\(\{kind:'collect', id:target\.id, token:target\.token\}\)/, 'no cast: hand grabs never wear anything');
});
