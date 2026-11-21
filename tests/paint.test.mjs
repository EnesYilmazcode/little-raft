// Unit tests for the paint + brush content module (pure logic, no DOM).
// Run: node --test tests/paint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag, RECIPES, ITEM_INFO, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const P = await import(new URL('paint.js', base));
const { PALETTE, PAINT_KINDS, pieceKeyOf, tileKeyOf, keyType, cleanPaint, prunePaint, nextColour, applyPaint, createPaint, mixHex } = P;

const tiles = () => Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]);
const wall = { t: 'wall', i: 1, j: 0, l: 0, r: 1 };
const bagWith = (counts) => { const b = new Bag(); for (const [k, n] of Object.entries(counts)) b.add(k, n); return b; };
const fullBag = () => bagWith({ brush: 1, paint_seafoam: 4, paint_coral: 4, paint_sunshell: 4, paint_lagoon: 4, paint_pebble: 4 });

function makeCtx(role = 'solo') {
  const emits = [], notices = [], sent = [], bags = { host: fullBag(), guest: fullBag() };
  const calls = { setTint: 0, retint: 0 };
  const building = { setTint() { calls.setTint++; }, retint() { calls.retint++; }, preview() {}, grid: { pick: () => null }, sync() {} };
  const world = { tiles: tiles(), pieces: [{ ...wall }, { t: 'floor', i: 0, j: 0, l: 1, r: 0 }], ext: {} };
  const ctx = { T, world, role, running: true, building, camera: null, raft: null, brush: null,
    localBag: () => bags.host, actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice: s => notices.push(s),
    action: a => sent.push(a), esc: s => String(s), uiOpen: () => false, deckY: () => .2, aim: () => null };
  const mod = createPaint(ctx);
  return { ctx, mod, emits, notices, sent, bags, calls, world };
}

// ---------------------------------------------------------------- keys
test('keys: piece and tile keys, regex edge cases', () => {
  assert.equal(pieceKeyOf({ t: 'wall', i: 1, j: 0, l: 0, r: 1 }), 'wall:1,0,0,1');
  assert.equal(tileKeyOf(-2, 3), '-2,3');
  assert.equal(keyType('wall:1,0,0,1'), 'piece');
  assert.equal(keyType('roof:-26,26,5,3'), 'piece');
  assert.equal(keyType('-2,3'), 'tile');
  for (const bad of ['foundation:0,0,0,0', 'wall:27,0,0,0', 'wall:0,0,6,0', 'wall:0,0,0,4', 'wall:1.5,0,0,0', '1.5,2', '__proto__', '__proto__:0,0,0,0', 'constructor:0,0,0,0', '', 5, null])
    assert.equal(keyType(bad), null, String(bad));
});

// ---------------------------------------------------------------- cleanPaint
test('cleanPaint: junk gives defaults with a null-prototype map', () => {
  for (const junk of [undefined, null, [], 'x', 7, { m: [] }, { m: 'no' }]) {
    const c = cleanPaint(junk);
    assert.equal(c.v, 1); assert.equal(c.rev, 0);
    assert.equal(Object.getPrototypeOf(c.m), null); assert.deepEqual(Object.keys(c.m), []);
  }
});

test('cleanPaint: drops bad values, caps at 1000, clamps rev, idempotent', () => {
  const m = { 'wall:1,0,0,1': 2, '0,0': 0, '1,0': 6, '-1,0': 1.5, '0,1': '2', 'bogus': 1, '1,1': 5 };
  const c = cleanPaint({ rev: 12, m });
  assert.deepEqual({ ...c.m }, { 'wall:1,0,0,1': 2, '1,1': 5 });
  assert.equal(c.rev, 12);
  assert.equal(cleanPaint({ rev: -4 }).rev, 0);
  assert.equal(cleanPaint({ rev: 3.7 }).rev, 3);
  assert.equal(cleanPaint({ rev: 1e12 }).rev, 1e9);
  const big = {}; for (let i = 0; i < 1001; i++) big[i + ',0'] = 1;
  const cb = cleanPaint({ m: big });
  assert.equal(Object.keys(cb.m).length, 1000); assert.ok(!('1000,0' in cb.m));
  const proto = JSON.parse('{"m":{"__proto__":1,"wall:0,0,0,0":1}}');
  assert.deepEqual(Object.keys(cleanPaint(proto).m), ['wall:0,0,0,0']);
  const once = cleanPaint({ rev: 9, m });
  assert.deepEqual(cleanPaint(once), once);
});

// ---------------------------------------------------------------- prunePaint
test('prunePaint: removes stale pieces and tiles, a door does not inherit a wall', () => {
  const s = cleanPaint({ m: { 'wall:1,0,0,1': 2, 'wall:0,0,0,0': 3, '0,0': 1, '5,5': 4 } });
  const pieces = [{ t: 'wall', i: 1, j: 0, l: 0, r: 1 }, { t: 'door', i: 0, j: 0, l: 0, r: 0 }];
  assert.equal(prunePaint(s, pieces, tiles()), 2);
  assert.deepEqual(Object.keys(s.m).sort(), ['0,0', 'wall:1,0,0,1']);
  assert.ok(!('door:0,0,0,0' in s.m));
  assert.equal(prunePaint(s, pieces, tiles()), 0);
});

// ---------------------------------------------------------------- action
test('action: charges one pot, refuses without brush or pots, Driftwood is free', () => {
  const { mod, emits, bags, world } = makeCtx();
  const k = pieceKeyOf(wall);
  assert.equal(mod.action({ kind: 'nope' }, 'host', bags.host), false);
  assert.equal(mod.action({ kind: 'paint', k, c: 2 }, 'host', bags.host), true);
  assert.equal(bags.host.count('paint_coral'), 3);
  assert.equal(mod.serialize().m[k], 2);
  assert.equal(mod.serialize().rev, 1);
  assert.equal(emits.at(-1).e.text, 'Painted Coral');
  // same colour: nothing charged, no rev bump
  mod.action({ kind: 'paint', k, c: 2 }, 'host', bags.host);
  assert.equal(bags.host.count('paint_coral'), 3); assert.equal(mod.serialize().rev, 1);
  assert.equal(emits.at(-1).e.text, 'Already Coral');
  // driftwood: free, deletes the entry, no refund
  mod.action({ kind: 'paint', k, c: 0 }, 'host', bags.host);
  assert.ok(!(k in mod.serialize().m)); assert.equal(bags.host.count('paint_coral'), 3); assert.equal(mod.serialize().rev, 2);
  mod.action({ kind: 'paint', k, c: 0 }, 'host', bags.host);
  assert.equal(emits.at(-1).e.text, 'Already Driftwood'); assert.equal(mod.serialize().rev, 2);
  // no brush
  const noBrush = bagWith({ paint_coral: 2 });
  mod.action({ kind: 'paint', k, c: 2 }, 'host', noBrush);
  assert.equal(emits.at(-1).e.text, 'Make a paint brush first'); assert.equal(noBrush.count('paint_coral'), 2);
  // no pot
  const noPot = bagWith({ brush: 1 });
  mod.action({ kind: 'paint', k, c: 4 }, 'host', noPot);
  assert.equal(emits.at(-1).e.text, 'Out of Lagoon paint'); assert.equal(mod.serialize().rev, 2);
  // silent refusals: missing target, bad colour
  const n = emits.length;
  mod.action({ kind: 'paint', k: 'wall:5,5,0,0', c: 1 }, 'host', bags.host);
  mod.action({ kind: 'paint', k: '9,9', c: 1 }, 'host', bags.host);
  mod.action({ kind: 'paint', k, c: 7 }, 'host', bags.host);
  mod.action({ kind: 'paint', k, c: 1.5 }, 'host', bags.host);
  assert.equal(emits.length, n); assert.equal(mod.serialize().rev, 2);
  // tiles paint too
  mod.action({ kind: 'paint', k: '-1,1', c: 5 }, 'host', bags.host);
  assert.equal(mod.serialize().m['-1,1'], 5);
  assert.ok(world.tiles.length === 9);
});

test('action: the guest actor bag is the one charged, notice goes to the guest', () => {
  const { mod, emits, bags } = makeCtx('host');
  mod.action({ kind: 'paint', k: '0,0', c: 1 }, 'guest', bags.guest);
  assert.equal(bags.guest.count('paint_seafoam'), 3); assert.equal(bags.host.count('paint_seafoam'), 4);
  assert.equal(emits.at(-1).to, 'guest');
});

test('applyPaint: the entry cap refuses before charging', () => {
  const s = cleanPaint({}); for (let i = 0; i < 1000; i++) s.m[i + ',0'] = 1;
  const b = fullBag(), w = { tiles: [[0, 5]], pieces: [] };
  assert.deepEqual(applyPaint(s, { kind: 'paint', k: '0,5', c: 1 }, b, w), { ok: false, text: 'That’s a lot of paint!' });
  assert.equal(b.count('paint_seafoam'), 4);
});

// ---------------------------------------------------------------- nextColour
test('nextColour: skips empty colours, wraps through 0, stays 0 with no pots', () => {
  const counts = { paint_seafoam: 0, paint_coral: 2, paint_sunshell: 0, paint_lagoon: 1, paint_pebble: 0 };
  assert.equal(nextColour(0, counts), 2);
  assert.equal(nextColour(2, counts), 4);
  assert.equal(nextColour(4, counts), 0);
  assert.equal(nextColour(0, {}), 0);
  assert.equal(nextColour(3, {}), 0);
});

test('use / alt: only for the brush; out of a colour switches colour', () => {
  const { mod, notices, sent, bags } = makeCtx();
  assert.equal(mod.use(null, 'hammer'), false);
  assert.equal(mod.alt(null, 'hammer'), false);
  assert.equal(mod.use(null, 'brush'), true);
  assert.equal(notices.at(-1), 'Point the brush at a wall, floor or deck');
  assert.equal(mod.alt(null, 'brush'), true);
  assert.equal(mod.debug.colour, 1);
  bags.host.remove('paint_seafoam', 4);
  mod.use(null, 'brush');
  assert.equal(mod.debug.colour, 2); assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------- load
test('load: net with the same rev does not re-tint; a new rev does; save prunes', () => {
  const { mod, calls, world } = makeCtx('guest');
  mod.load({ v: 1, rev: 3, m: { '0,0': 1 } }, 'net');
  assert.equal(calls.setTint, 1);
  mod.load({ v: 1, rev: 3, m: { '0,0': 1 } }, 'net');
  mod.load({ v: 1, rev: 3, m: { '0,0': 1 } }, 'net');
  assert.equal(calls.setTint + calls.retint, 1);
  mod.load({ v: 1, rev: 4, m: { '0,0': 2 } }, 'net');
  assert.equal(calls.retint, 1); assert.equal(mod.serialize().m['0,0'], 2);
  mod.load(undefined, 'net'); mod.load(undefined, 'net');
  assert.deepEqual(Object.keys(mod.serialize().m), []);
  assert.equal(calls.retint, 2);
  const h = makeCtx('solo');
  h.mod.load({ v: 1, rev: 5, m: { '0,0': 1, '7,7': 2, 'wall:1,0,0,1': 3, 'wall:0,0,0,0': 4 } }, 'save');
  assert.deepEqual(Object.keys(h.mod.serialize().m).sort(), ['0,0', 'wall:1,0,0,1']);
  assert.equal(h.mod.serialize().rev, 6);
  h.mod.load(undefined, 'save');
  assert.deepEqual(h.mod.serialize(), { v: 1, rev: 0, m: Object.create(null) });
  assert.ok(world);
});

test('update: the host prunes when pieces change', () => {
  const { mod, world } = makeCtx('solo');
  mod.load({ rev: 1, m: { 'wall:1,0,0,1': 2 } }, 'save');
  mod.update(0.016);
  assert.equal(mod.serialize().m['wall:1,0,0,1'], 2);
  world.pieces = world.pieces.filter(p => p.t !== 'wall');
  mod.update(0.016);
  assert.ok(!('wall:1,0,0,1' in mod.serialize().m)); assert.equal(mod.serialize().rev, 2);
});

test('serialize returns the live state; mixHex blends', () => {
  const { mod } = makeCtx();
  assert.equal(mod.serialize(), mod.serialize());
  assert.equal(mixHex('#000000', '#ffffff', .5), '#808080');
  assert.equal(mixHex('#bb8a53', '#9fd3c1', 0), '#bb8a53');
});

// ---------------------------------------------------------------- items, recipes, icons
test('recipes and items: pots make 4, brush is a 1-stack non-tool, icons exist', () => {
  const svg = readFileSync(fileURLToPath(new URL('icons.svg', base)), 'utf8');
  assert.equal(ITEM_INFO.brush.maxStack, 1); assert.equal(ITEM_INFO.brush.tool, false);
  assert.deepEqual({ ...RECIPES.brush.cost }, { wood: 2, rope: 1 });
  for (const k of PAINT_KINDS) {
    assert.equal(RECIPES[k]?.output.count, 4, k);
    assert.equal(ITEM_INFO[k].maxStack, 20);
    for (const c of Object.keys(RECIPES[k].cost)) assert.ok(ITEM_INFO[c], c);
  }
  for (const k of ['brush', ...PAINT_KINDS]) assert.ok(svg.includes(`id="${ITEM_INFO[k].icon}"`), ITEM_INFO[k].icon);
  assert.equal(PALETTE.length, 6); assert.equal(SLOT_COUNT > 0, true);
});

test('prompt provider yields to the pickup and waiting prompts; preview gets a Color', () => {
  let provided = null; const prev = globalThis.raftPrompts;
  globalThis.raftPrompts = { provide: o => { provided = o; return () => {}; } };
  try {
    const { mod, ctx, bags } = makeCtx();
    bags.host.select(bags.host.slots.findIndex(s => s?.kind === 'brush'));
    const shown = [];
    ctx.building.preview = (rec, c) => shown.push(c);
    ctx.building.grid.pick = () => ({ ...wall });
    ctx.camera = { position: new T.Vector3(0, 1.6, 0) };
    ctx.aim = () => ({ dir: new T.Vector3(1, 0, 0), point: null });
    mod.update(0.016);
    assert.ok(provided);
    assert.ok(provided.prompt({ state: { running: true } }));
    assert.equal(provided.prompt({ state: { pickup: { id: 1, type: 'wood' } } }), null);
    assert.equal(provided.prompt({ state: { role: 'guest', networkReady: false } }), null);
    assert.ok(shown.length > 0 && shown[0].isColor);
  } finally { globalThis.raftPrompts = prev; }
});
