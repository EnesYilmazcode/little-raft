// Unit tests for dist/fireworks.js (Sky Rockets) and dist/fireworks-model.js. See docs/specs/fireworks.md section 10.
// Run: node --test tests/fireworks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const F = await import(new URL('fireworks.js', base));
const M = await import(new URL('fireworks-model.js', base));
const { ITEMS, BLOCK_RADII, PLACEABLE_IDS } = await import(new URL('items.js', base));
const { evaluate, cleanProgress, ACHIEVEMENT_IDS } = await import(new URL('logbook.js', base));
const { EVENTS } = await import(new URL('audio.js', base));
const { cleanFw, fwRoll, shapeOf, heightOf, burstLife, cleanFwMsg, windowGate, hearGain, flashLevel, budgetFor, BUDGET, FUSE, RISE, createFireworks } = F;

// camera at (0, 1.7, 3) looking at the rocket on tile 0,0 (aim point deck .2 + .3)
const AIM = { dir: { x: 0, y: -1.2 / Math.hypot(1.2, 3), z: -3 / Math.hypot(1.2, 3) } };

function makeCtx(o = {}) {
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  const camera = new T.PerspectiveCamera(70, 1, 0.05, 200); camera.position.set(0, 1.7, 3); scene.add(camera);
  const hemi = new T.HemisphereLight('#bfe6ff', '#2f6f7a', 1); scene.add(hemi);
  const log = { emit: [], rebuild: 0, award: [], action: [], play: [] };
  const ctx = {
    T, scene, raft, camera, hemi, role: 'solo', running: true, options: { graphics: 'medium' },
    world: { decor: [{ type: 'skyrocket', x: 0, z: 0 }, { type: 'palm', x: 1, z: 0 }] },
    physics: { x: 0, y: 1.8, z: 1 }, other: { x: 40, y: 1.8, z: 40 },
    deckY: () => 0.2, rebuildRaft: () => { log.rebuild++; }, emit: (e, to) => log.emit.push([e, to]), award: ev => log.award.push(ev),
    action: a => log.action.push(a), play: (ev, s) => log.play.push([ev, s]), night: () => 0,
    ...o,
  };
  return { ctx, log, mod: createFireworks(ctx) };
}
const run = (mod, sec, step = 1 / 30) => { for (let t = 0; t < sec; t += step) mod.update(step); };

test('cleanFw: junk gives n 0, valid n kept, huge n clamped', () => {
  for (const v of [undefined, null, [], 'x', 3, { n: -1 }, { n: 1.5 }, { n: '7' }]) assert.deepEqual(cleanFw(v), { v: 1, n: 0 });
  assert.deepEqual(cleanFw({ v: 1, n: 42, junk: 1 }), { v: 1, n: 42 });
  assert.deepEqual(cleanFw({ n: 2 ** 40 }), { v: 1, n: 2 ** 31 - 1 });
});

test('fwRoll: deterministic, c 0..5, s uint32; all colours and shapes appear; heights 25..35', () => {
  assert.deepEqual(fwRoll(3, -2, 9), fwRoll(3, -2, 9));
  assert.notDeepEqual(fwRoll(3, -2, 9), fwRoll(3, -2, 10));
  const cs = new Set(), ss = new Set();
  for (let n = 0; n < 300; n++) {
    const { c, s } = fwRoll(2, 1, n);
    assert.ok(Number.isInteger(c) && c >= 0 && c <= 5);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
    cs.add(c); ss.add(shapeOf(s));
    const h = heightOf(s); assert.ok(h >= 25 && h <= 35, `height ${h}`);
  }
  assert.equal(cs.size, 6); assert.equal(ss.size, 3);
  assert.equal(burstLife(0), 2); assert.equal(burstLife(1), 2); assert.equal(burstLife(2), 3.2);
});

test('cleanFwMsg: validates x, z, c, s and ignores extra fields', () => {
  assert.deepEqual(cleanFwMsg({ kind: 'fw', x: 1, z: -2, c: 5, s: 4294967295, text: 'hi', sound: 'none' }), { x: 1, z: -2, c: 5, s: 4294967295 });
  for (const e of [null, undefined, 'fw', [], { x: 1.5, z: 0, c: 0, s: 1 }, { x: 0, z: '0', c: 0, s: 1 }, { x: 65, z: 0, c: 0, s: 1 },
    { x: 0, z: 0, c: 6, s: 1 }, { x: 0, z: 0, c: -1, s: 1 }, { x: 0, z: 0, c: 0, s: -1 }, { x: 0, z: 0, c: 0, s: 1.5 }, { x: 0, z: 0, c: 0, s: 2 ** 32 }]) {
    assert.equal(cleanFwMsg(e), null, JSON.stringify(e));
  }
});

test('windowGate, hearGain, flashLevel, budgetFor', () => {
  const g = windowGate(6);
  for (let i = 0; i < 6; i++) assert.equal(g(1000 + i * 10), true);
  assert.equal(g(1100), false);
  assert.equal(g(2001), true);
  assert.equal(hearGain(0), 1); assert.equal(hearGain(79), 0.2); assert.equal(hearGain(80), 0); assert.equal(hearGain(500), 0); assert.equal(hearGain(NaN), 0);
  assert.equal(flashLevel(-0.1), 0); assert.equal(flashLevel(1.1), 0);
  assert.ok(flashLevel(0.25) > 0.95); assert.ok(flashLevel(0.25) >= flashLevel(0.1) && flashLevel(0.25) >= flashLevel(0.5));
  assert.equal(budgetFor('low'), BUDGET.low); assert.equal(budgetFor('nope'), BUDGET.medium); assert.equal(budgetFor(undefined), BUDGET.medium);
});

test('items: skyrocket is a placeable decor 3-pack with radius .1', () => {
  const it = ITEMS.skyrocket;
  assert.equal(it.category, 'decor'); assert.equal(it.placeable, true); assert.equal(it.stack, 20);
  assert.deepEqual({ ...it.recipe.cost }, { plastic: 2, leaf: 1, scrap: 1 }); assert.equal(it.recipe.count, 3);
  assert.equal(BLOCK_RADII.skyrocket, 0.1); assert.ok(PLACEABLE_IDS.includes('skyrocket'));
});

test('host action: launches once, emits fw with no text to all, awards, bumps n; bad input does nothing', () => {
  const { ctx, log, mod } = makeCtx();
  assert.equal(mod.action({ kind: 'bees.harvest', x: 0, z: 0 }, 'host'), false);
  assert.equal(mod.action({ kind: 'fw.light', x: 0.5, z: 0 }, 'host'), true);
  assert.equal(mod.action({ kind: 'fw.light', x: 1, z: 0 }, 'host'), true); // a palm, not a rocket
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'guest'), true); // guest is far away
  assert.equal(log.emit.length, 0); assert.equal(ctx.world.decor.length, 2); assert.equal(log.rebuild, 0);
  const want = fwRoll(0, 0, 0);
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'host'), true);
  assert.deepEqual(ctx.world.decor, [{ type: 'palm', x: 1, z: 0 }]);
  assert.equal(log.rebuild, 1);
  assert.equal(log.emit.length, 1);
  const [e, to] = log.emit[0];
  assert.equal(to, 'all'); assert.equal(e.kind, 'fw'); assert.equal(e.sound, 'none'); assert.ok(!('text' in e));
  assert.equal(e.c, want.c); assert.equal(e.s, want.s);
  assert.deepEqual(mod.serialize(), { v: 1, n: 1 });
  assert.deepEqual(log.award, [{ kind: 'firework' }]);
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'host'), true); // second press
  assert.equal(log.emit.length, 1); assert.equal(log.rebuild, 1);
  mod.dispose();
});

test('interact/prompt: aims at the rocket, sends fw.light, night-aware prompt', () => {
  const { ctx, log, mod } = makeCtx();
  assert.match(mod.prompt(AIM), /best after dark/);
  ctx.night = () => 1;
  assert.equal(mod.prompt(AIM), '<kbd>E</kbd>Light the sky rocket');
  assert.equal(mod.interact(AIM), true);
  assert.deepEqual(log.action, [{ kind: 'fw.light', x: 0, z: 0 }]);
  assert.equal(mod.interact({ dir: { x: 1, y: 0, z: 0 } }), false);
  mod.dispose();
});

test('effect: valid fills a slot, junk is consumed silently, other kinds pass; slots recycle within budget', () => {
  for (const graphics of ['low', 'medium', 'high']) {
    const { mod } = makeCtx({ options: { graphics } });
    assert.equal(mod.effect({ kind: 'loot' }), false);
    assert.equal(mod.effect({ kind: 'fw', x: 'a', z: 0, c: 0, s: 1 }), true);
    assert.equal(mod.debug.slots().length, 0);
    assert.equal(mod.effect({ kind: 'fw', x: 0, z: 0, c: 1, s: 3 }), true);
    assert.equal(mod.debug.slots().length, 1);
    const max = budgetFor(graphics).slots;
    for (let i = 0; i < 5; i++) { mod.update(0.1); mod.effect({ kind: 'fw', x: i, z: 0, c: 2, s: 7 + i }); }
    assert.ok(mod.debug.slots().length <= max);
    assert.equal(mod.debug.slots().length, Math.min(max, 6));
    // the oldest (first) slot was recycled: no slot is older than 4 updates
    if (max < 6) assert.ok(mod.debug.slots().every(s => s.t < 0.45), JSON.stringify(mod.debug.slots()));
    mod.dispose();
  }
});

test('flight: sounds in order, slot frees after the burst', () => {
  const { log, mod } = makeCtx();
  mod.debug.launch(0, 0, 0);
  run(mod, FUSE + RISE + burstLife(0) + 0.5);
  const evs = log.play.map(p => p[0]);
  assert.deepEqual(evs, ['ui', 'whistle', 'pop', 'crackle']);
  assert.equal(mod.debug.slots().length, 0);
  const { log: l2, mod: m2 } = makeCtx();
  m2.debug.launch(0, 0, 1);
  run(m2, FUSE + RISE + 3);
  assert.deepEqual(l2.play.map(p => p[0]), ['ui', 'whistle', 'pop'], 'a ring does not crackle');
  m2.dispose(); mod.dispose();
});

test('model: pool sizes, baked attributes, no lights, rocket name', () => {
  for (const k of ['low', 'medium', 'high']) {
    const b = BUDGET[k], { points, uniforms } = M.createSparkPool(T, b);
    assert.equal(points.geometry.attributes.position.count, b.slots * (b.sparks + b.trail));
    assert.equal(points.frustumCulled, false);
    assert.equal(uniforms.uSlot.value.length, b.slots);
    points.geometry.dispose(); points.material.dispose();
  }
  assert.ok(BUDGET.high.slots * (BUDGET.high.sparks + BUDGET.high.trail) <= 736);
  const { ctx, mod } = makeCtx({ options: { graphics: 'high' } });
  const lights0 = []; ctx.scene.traverse(o => { if (o.isLight) lights0.push(o); });
  mod.debug.launch(0, 0, 2);
  const pts = ctx.scene.children.find(o => o.isPoints);
  const ver = Object.fromEntries(Object.entries(pts.geometry.attributes).map(([k, a]) => [k, a.version]));
  run(mod, 100 / 30);
  for (const [k, a] of Object.entries(pts.geometry.attributes)) assert.equal(a.version, ver[k], `${k} re-uploaded`);
  const lights = []; ctx.scene.traverse(o => { if (o.isLight) lights.push(o); });
  assert.equal(lights.length, lights0.length, 'no new lights');
  assert.ok(!ctx.raft.children.some(o => o.isPoints), 'pool is never in the raft');
  const r = M.createRocket(T); assert.equal(r.name, 'craft_skyrocket');
  assert.equal(mod.decorModel('skyrocket').name, 'craft_skyrocket'); assert.equal(mod.decorModel('palm'), null);
  mod.dispose();
  assert.ok(!ctx.scene.children.some(o => o.isPoints || o.name === 'fireworks-flight'), 'dispose removes everything');
});

test('flash: one peak per gap at night, hemi untouched by day', () => {
  const { ctx, mod } = makeCtx({ night: () => 1 });
  const step = dt => { ctx.hemi.intensity = 0.5; ctx.hemi.color.set('#bfe6ff'); mod.update(dt); };
  mod.debug.launch(0, 0, 0);
  for (let i = 0; i < 6; i++) step(1 / 30); // 0.2 s
  mod.debug.launch(1, 0, 0);
  let peak = 0, raised = 0;
  for (let i = 0; i < 150; i++) { step(1 / 30); if (ctx.hemi.intensity > 0.5) raised++; peak = Math.max(peak, ctx.hemi.intensity); }
  assert.equal(mod.debug.flash().peaks, 1);
  assert.ok(peak > 0.8 && peak <= 0.5 + 0.35 + 1e-9, `peak ${peak}`);
  assert.ok(raised > 0);
  mod.dispose();
  const day = makeCtx({ night: () => 0 });
  day.mod.debug.launch(0, 0, 0);
  day.ctx.hemi.intensity = 0.7;
  const col = day.ctx.hemi.color.clone();
  run(day.mod, 4);
  assert.equal(day.ctx.hemi.intensity, 0.7); assert.ok(day.ctx.hemi.color.equals(col));
  assert.equal(day.mod.debug.flash().peaks, 0);
  day.mod.dispose();
});

test('debug.launch freezes a burst at a given age', () => {
  const { mod } = makeCtx();
  mod.debug.launch(0, 0, 2, FUSE + RISE + 0.6);
  run(mod, 5);
  const [s] = mod.debug.slots();
  assert.equal(s.shape, 2); assert.equal(s.frozen, true); assert.ok(Math.abs(s.t - (FUSE + RISE + 0.6)) < 1e-9);
  mod.debug.unfreeze(); run(mod, 4);
  assert.equal(mod.debug.slots().length, 0);
  mod.dispose();
});

test('game.js: the content effect hook sits before the notice/sound fallthrough', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  const start = src.indexOf('function effect(e)');
  assert.ok(start > 0);
  const hook = src.indexOf('content?.effect?.(e)', start), note = src.indexOf('notice(e.text', start);
  assert.ok(hook > start && note > hook, 'hook before notice');
  assert.ok(src.indexOf('play(typeof e.sound', start) > hook, 'hook before play');
  assert.match(src, /night: \(\) => content\?\.night\?\.\(\) \?\? 0/);
});

test('logbook and audio: firework1 and the three new sounds', () => {
  const w = { tiles: [], decor: [], fish: 0, collected: 0, items: [], notes: [], achievements: [] };
  assert.ok(evaluate(w, [], { kind: 'firework' }).includes('firework1'));
  assert.ok(!evaluate(w, [], { kind: 'craft' }).includes('firework1'));
  assert.ok(ACHIEVEMENT_IDS.includes('firework1'));
  assert.ok(cleanProgress({ ...w, achievements: ['firework1', 'fish1'] }).achievements.includes('firework1'));
  for (const e of ['whistle', 'pop', 'crackle']) assert.ok(EVENTS.includes(e), e);
});

test('review: guest in reach launches; guest far or on a wrong tile does not', () => {
  const { ctx, log, mod } = makeCtx({ other: { x: 0.5, y: 1.8, z: 0.5 } });
  assert.equal(mod.action({ kind: 'fw.light', x: 1, z: 0 }, 'guest'), true); // a palm
  assert.equal(log.emit.length, 0);
  ctx.other = null;
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'guest'), true); // guest pose unknown
  assert.equal(log.emit.length, 0);
  ctx.other = { x: 0.5, y: 1.8, z: 0.5 };
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'guest'), true);
  assert.equal(mod.action({ kind: 'fw.light', x: 0, z: 0 }, 'host'), true); // both at once: once only
  assert.equal(log.emit.length, 1); assert.equal(ctx.world.decor.length, 1);
  assert.ok(!EVENTS.includes('none'), "'none' is not a sound, so old peers play nothing");
  mod.dispose();
});

test('review: a burst during a fading flash rises from the current level (no flicker to 0)', () => {
  const { ctx, mod } = makeCtx({ night: () => 1 });
  const step = () => { ctx.hemi.intensity = 0.5; mod.update(1 / 60); return ctx.hemi.intensity - 0.5; };
  mod.debug.launch(0, 0, 0);
  for (let i = 0; i < 36; i++) step(); // 0.6 s
  mod.debug.launch(1, 0, 0); // pops 0.6 s after the first peak, while that flash is still fading
  const fs = []; for (let i = 0; i < 60 * 5; i++) fs.push(step());
  const on = fs.findIndex(f => f > 0), off = fs.findIndex((f, i) => i > on && f <= 0);
  assert.ok(on >= 0 && off > on);
  assert.equal(mod.debug.flash().peaks, 2);
  assert.ok(fs.slice(off).every(f => f <= 0), 'the flash went dark and then lit again (flicker)');
  mod.dispose();
});

test('review: dispose after day/night restored hemi leaves its values alone', () => {
  const { ctx, mod } = makeCtx({ night: () => 1 });
  mod.debug.launch(0, 0, 0);
  for (let i = 0; i < 93; i++) { ctx.hemi.intensity = 0.5; ctx.hemi.color.set('#203050'); mod.update(1 / 30); } // ~0.2 s after the pop
  assert.ok(mod.debug.flash().owed > 0);
  ctx.hemi.intensity = 1; ctx.hemi.color.set('#bfe6ff'); // day/night disposes first and restores the start-up values
  const col = ctx.hemi.color.clone();
  mod.dispose();
  assert.equal(ctx.hemi.intensity, 1); assert.ok(ctx.hemi.color.equals(col));
  // when nothing rewrote it, dispose undoes exactly its own offset
  const b = makeCtx({ night: () => 1 });
  b.mod.debug.launch(0, 0, 0);
  for (let i = 0; i < 93; i++) { b.ctx.hemi.intensity = 0.5; b.ctx.hemi.color.set('#203050'); b.mod.update(1 / 30); }
  assert.ok(b.ctx.hemi.intensity > 0.5);
  b.mod.dispose();
  assert.ok(Math.abs(b.ctx.hemi.intensity - 0.5) < 1e-9); assert.equal(b.ctx.hemi.color.getHexString(), '203050');
});

test('review: game.js logbook totals come from ACHIEVEMENTS', () => {
  const src = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
  assert.match(src, /achievements:ACHIEVEMENTS\.length/);
  assert.match(src, /import \{[^}]*\bACHIEVEMENTS\b[^}]*\} from '\.\/logbook\.js/);
});
