// Spyglass (docs/specs/spyglass.md): pure zoom/ease/pick/label rules, catalogue, held model, module smoke.
// Run: node --test tests/spyglass.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const S = await import(new URL('spyglass.js' + BUILD, base));
const { islandName } = await import(new URL('maptable.js' + BUILD, base));
const { createSpyglassModel } = await import(new URL('spyglass-model.js' + BUILD, base));
const { ITEMS, TOOL_IDS } = await import(new URL('items.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { ITEM_TEXT, categoryOf } = await import(new URL('craft-book.js', base));
const { HOLD } = await import(new URL('held-items.js', base));
const { SPY, ITEM_LABEL, zoomFor, easeStep, zoomAt, angleTo, pick, labelText, createSpyglass } = S;

const rad = d => d * Math.PI / 180;
// An item d metres away at `deg` degrees right of straight ahead (-Z), on the sea plane (y 0).
const at = (token, type, deg, d) => ({ token, type, x: Math.sin(rad(deg)) * d, z: -Math.cos(rad(deg)) * d });
const out = () => ({ key: null, kind: null, seed: 0, d: 0 });
const look = (items, isl = null, prev = null, o = out()) => pick(0, 0, 0, 0, 0, -1, items, isl, 0, prev, o);

test('zoomFor: spyglass and binoculars zoom, nothing else does', () => {
  assert.equal(zoomFor('spyglass'), 3);
  assert.equal(zoomFor('binoculars'), 4.5);
  for (const k of ['hammer', null, undefined, '__proto__', 'toString', 'constructor', 42]) assert.equal(zoomFor(k), 0, String(k));
});

test('easeStep: 0 -> 1 in EASE_S, clamped, eases back, bad dt leaves t alone', () => {
  assert.equal(SPY.EASE_S, 0.18);
  let t = 0;
  for (let i = 0; i < 8; i++) { t = easeStep(t, 0.02, true); assert.ok(t > 0 && t < 1, `step ${i}: ${t}`); }
  t = easeStep(t, 0.02, true);
  assert.ok(Math.abs(t - 1) < 1e-9, `9 steps of 0.02 reach 1 (${t})`);
  assert.equal(easeStep(1, 0.5, true), 1, 'clamped at 1');
  for (let i = 0; i < 9; i++) t = easeStep(t, 0.02, false);
  assert.ok(t < 1e-9, `eases back to 0 (${t})`);
  assert.equal(easeStep(0, 1, false), 0, 'clamped at 0');
  assert.equal(easeStep(0.4, NaN, true), 0.4);
  assert.equal(easeStep(0.4, -1, true), 0.4);
});

test('zoomAt: smoothstep from 1 to Z, monotonic, Z <= 1 is 1', () => {
  for (const Z of [3, 4.5]) {
    assert.equal(zoomAt(0, Z), 1);
    assert.equal(zoomAt(1, Z), Z);
    assert.ok(Math.abs(zoomAt(0.5, Z) - (1 + (Z - 1) / 2)) < 1e-12);
    let prev = 0;
    for (let i = 0; i <= 50; i++) { const z = zoomAt(i / 50, Z); assert.ok(z >= prev, `monotonic at ${i}`); prev = z; }
  }
  for (const Z of [1, 0.5, 0, NaN]) assert.equal(zoomAt(0.7, Z), 1);
});

test('angleTo: parallel, perpendicular, opposite, zero vector', () => {
  assert.ok(angleTo(0, 0, -1, 0, 0, -50) < 1e-9);
  assert.ok(Math.abs(angleTo(0, 0, -1, 3, 0, 0) - 90) < 1e-9);
  assert.ok(Math.abs(angleTo(0, 0, -1, 0, 0, 7) - 180) < 1e-9);
  assert.equal(angleTo(0, 0, -1, 0, 0, 0), 180);
});

test('pick: cone, range, angle beats distance, islands, bias, stickiness, no allocation', () => {
  assert.equal(look([at('a', 'barrel', 1.5, 50)]).key, 'a', 'barrel at 1.5 deg wins');
  assert.equal(look([at('a', 'barrel', 3, 50)]), null, 'barrel at 3 deg is outside the cone');
  assert.equal(look([at('far', 'barrel', 1.8, 20), at('near', 'bottle', 1, 100)]).key, 'near', 'smaller angle beats closer');
  assert.equal(look([at('a', 'barrel', 0, 250)]), null, 'past ITEM_RANGE');
  assert.equal(look([at('a', 'barrel', 0, 0.5)]), null, 'under 1 m');
  assert.equal(look([at('a', 'mystery', 0, 30)]), null, 'unknown type skipped');
  assert.equal(look([{ token: 'p', type: '__proto__', x: 0, z: -30 }]), null, 'prototype keys skipped');
  const r = look([at('b', 'barrel', 0, 85)]);
  assert.deepEqual({ ...r }, { key: 'b', kind: 'barrel', seed: 0, d: 85 });

  const isl = { seed: 7, cx: 0, gy: 0, cz: -300, R: 40 };
  const ri = look([], isl);
  assert.equal(ri.key, 'isl:7'); assert.equal(ri.kind, 'island'); assert.equal(ri.seed, 7);
  assert.ok(Math.abs(ri.d - 260) < 1e-9, 'distance to the shore');
  assert.equal(look([at('c', 'barrel', 0.5, 150)], isl).key, 'c', 'debris in front of the island wins (bias)');
  assert.equal(look([], { seed: 7, cx: 0, gy: 0, cz: -30, R: 40 }), null, 'player inside the island radius');
  assert.equal(look([], { seed: 7, cx: 0, gy: 0, cz: -1500, R: 40 }), null, 'past ISLAND_RANGE');
  // an island off to the side still counts while its disc reaches the cone
  const side = { seed: 9, cx: Math.sin(rad(8)) * 300, gy: 0, cz: -Math.cos(rad(8)) * 300, R: 40 };
  assert.equal(look([], side)?.key, 'isl:9', 'wide island disc');
  assert.equal(look(null, isl).key, 'isl:7', 'items missing -> islands only');
  assert.equal(look([at('a', 'barrel', 0, 30)], null).key, 'a', 'no island -> items only');

  // stickiness
  const keep = [at('a', 'barrel', 1.4, 60), at('b', 'barrel', 0.9, 60)];
  assert.equal(look(keep, null, null).key, 'b', 'no previous: best wins');
  assert.equal(look(keep, null, 'a').key, 'a', 'rival better by 0.5 deg: keep previous');
  assert.equal(look([at('a', 'barrel', 1.4, 60), at('b', 'barrel', 0.4, 60)], null, 'a').key, 'b', 'rival better by 1 deg: switch');
  assert.equal(look([at('a', 'barrel', 2.5, 60)], null, 'a').key, 'a', 'previous still inside cone + sticky');
  assert.equal(look([at('a', 'barrel', 2.9, 60)], null, 'a'), null, 'previous past cone + sticky');
  assert.equal(look([], isl, 'isl:7').key, 'isl:7');

  // same out object every time, no new keys
  const o = out(), items = [at('a', 'barrel', 1, 50), at('b', 'wood', 0.2, 70), at('c', 'cache', 1.9, 90)];
  for (let i = 0; i < 1000; i++) assert.equal(pick(0, 0, 0, 0, 0, -1, items, isl, 0, i % 2 ? 'a' : null, o), o);
  assert.deepEqual(Object.keys(o).sort(), ['d', 'key', 'kind', 'seed']);
});

test('labelText: items in metres, islands by name and distText', () => {
  assert.equal(labelText({ key: 1, kind: 'barrel', seed: 0, d: 85.2 }), 'Barrel · 85 m');
  assert.equal(labelText({ key: 1, kind: 'cache', seed: 0, d: 60 }), 'Signal cache · 60 m');
  assert.equal(labelText({ key: 'isl:7', kind: 'island', seed: 7, d: 1200 }), islandName(7) + ' · 1.2 km');
  assert.equal(labelText(null), '');
  for (const k of Object.keys(ITEM_LABEL)) assert.match(labelText({ kind: k, d: 3 }), /^[A-Z][^·]+ · 3 m$/);
});

test('catalogue: spyglass item, icon, craft-book text, hold, co-op HELD index 21', async () => {
  const it = ITEMS.spyglass;
  assert.ok(it, 'item exists');
  assert.equal(it.stack, 1);
  assert.equal(it.durability, undefined);
  assert.ok(!it.tool && !TOOL_IDS.includes('spyglass'));
  assert.equal(it.recipe.station, null);
  for (const k of Object.keys(it.recipe.cost)) assert.ok(ITEMS[k], `recipe kind ${k}`);
  assert.ok(!('glass' in it.recipe.cost), 'no smelter glass');
  assert.equal(it.unlock.type, 'discover');
  assert.ok(ITEM_ICONS.spyglass && /viewBox|<g/.test(ITEM_ICONS.spyglass));
  assert.ok(ITEM_TEXT.spyglass?.desc && ITEM_TEXT.spyglass?.use);
  assert.equal(categoryOf('spyglass'), 'tools');
  assert.equal(HOLD.spyglass.hand, 'right');
  const { HELD } = await import(new URL('coop.js', base));
  assert.equal(HELD.indexOf('spyglass'), 21);
  assert.equal(HELD.length, 22);
});

test('held model: 2 meshes, grip at origin, ~0.34 m along +Y, under 900 triangles', () => {
  const g = createSpyglassModel(T);
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 2);
  let tris = 0; for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  assert.ok(tris <= 900, `${tris} tris`);
  assert.equal(g.userData.kind, 'spyglass');
  assert.ok(g.userData.grip.isVector3 && g.userData.grip.length() === 0);
  const s = g.userData.size;
  assert.ok(s.y > 0.3 && s.y < 0.38, `length ${s.y}`);
  assert.ok(s.x < 0.08 && s.z < 0.08);
  assert.equal(g.userData.height, s.y);
  for (const m of meshes) assert.ok(m.material.vertexColors && m.geometry.attributes.color);
});

function fakeCtx(kind = 'hammer') {
  const slots = new Array(28).fill(null); slots[0] = { kind, count: 1 }; slots[3] = { kind: 'spyglass', count: 1 };
  const bag = { slots, selectedIndex: 0 }, actions = [];
  let ui = false;
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.6, 0);
  const ctx = {
    T, camera, running: true, physics: { swimming: false }, ocean: { mesh: { position: { y: -0.24 } } },
    world: { items: [at('b1', 'barrel', 0, 40)] }, localBag: () => bag, uiOpen: () => ui,
    action: a => { actions.push(a); if (a.kind === 'selectSlot') bag.selectedIndex = a.index; },
  };
  return { ctx, bag, actions, setUi: v => { ui = v; } };
}

test('module: zoom gate, debug force/snap, menus snap to 1, nothing saved', () => {
  const f = fakeCtx('hammer');
  const m = createSpyglass(f.ctx);
  assert.equal(m.name, 'spyglass');
  assert.equal(m.serialize, undefined); assert.equal(m.load, undefined); assert.equal(m.action, undefined);
  assert.equal(m.zoom(), 1, 'hammer in hand');
  m.update(1 / 60); assert.equal(m.zoom(), 1);
  assert.equal(m.prompt(null), null, 'no prompt for a hammer');
  m.debug.force('spyglass', { snap: true });
  assert.equal(m.zoom(), 3);
  assert.equal(m.debug.t(), 1);
  f.setUi(true);
  assert.equal(m.zoom(), 1, 'menu open: 1 at once');
  m.update(1 / 60); assert.equal(m.debug.t(), 0, 'update snaps t out');
  f.setUi(false);
  m.debug.force(null);
  // equip selects the spyglass slot; with no aim held it stays at 1 and shows the hold prompt
  assert.equal(m.debug.equip(), 3);
  assert.deepEqual(f.actions.at(-1), { kind: 'selectSlot', index: 3 });
  m.update(1 / 60);
  assert.equal(m.zoom(), 1);
  assert.match(m.prompt(null), /^<kbd>RMB<\/kbd>Hold to look$/);
  m.debug.force('binoculars', { snap: true }); assert.equal(m.zoom(), 4.5);
  m.update(1 / 60); assert.equal(m.zoom(), 4.5);
  assert.equal(m.prompt(null), null, 'no prompt while zoomed');
  f.ctx.running = false; assert.equal(m.zoom(), 1, 'title screen');
  f.ctx.running = true; f.ctx.physics.swimming = true; assert.equal(m.zoom(), 1, 'swimming');
  f.ctx.physics.swimming = false; f.ctx.camera.position.y = -1; assert.equal(m.zoom(), 1, 'diving');
  f.ctx.camera.position.y = 1.6;
  m.debug.force(null);
  for (let i = 0; i < 20; i++) m.update(0.02);
  assert.equal(m.zoom(), 1, 'eased out after release');
  assert.equal(globalThis.raftSpyglass.zoomed, false);
  m.dispose();
  assert.equal(globalThis.raftSpyglass, undefined);
});

test('zoomed crosshair CSS targets the current graphics.css dot, not the old ring markup', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('spyglass.js', base), 'utf8');
  assert.ok(!/#crosshair i\b|#crosshair:before/.test(src), 'old style.css selectors removed');
  const rule = /body\.lr-spy #crosshair\{([^}]*)\}/.exec(src);
  assert.ok(rule, 'body.lr-spy #crosshair rule present');
  assert.match(rule[1], /background:[^;]*!important/, 'beats graphics.css #crosshair background !important');
  assert.match(rule[1], /box-shadow:[^;]*rgba\(8,22,36,\.9\)/, 'dark outline so the dot reads on bright sky');
});
