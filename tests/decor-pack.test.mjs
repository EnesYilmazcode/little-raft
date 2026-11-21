// Smoke tests for the decoration pack models (geometry sharing, dispose guards, sign painter, animation).
// Run: node --test tests/decor-pack.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { PACK } = await import(new URL('signs-core.js', base));
const { createDecorPack } = await import(new URL('decor-pack.js', base));
const { paintSign } = await import(new URL('decor-pack-models.js', base));
const { ITEM_INFO, RECIPES } = await import(new URL('inventory-state.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));

const world = () => ({ tiles: [[0, 0], [1, 0]], decor: [], ext: {}, sailing: { windDir: 1, windStr: .6 } });
const makeMod = (w = world()) => { const ctx = { T, world: w, role: 'solo', physics: { x: 0, z: 0 }, other: null, elapsed: 0, emit() {}, action() {} }; return { ctx, mod: createDecorPack(ctx) }; };
const meshesOf = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o); }); return out; };

test('items, recipes and decor are registered', () => {
  for (const id of PACK) {
    assert.ok(ITEM_INFO[id], id); assert.ok(RECIPES[id], id); assert.ok(CONTENT_DECOR.includes(id), id);
    assert.equal(RECIPES[id].output.kind, id);
  }
  assert.equal(CONTENT_BLOCK_RADIUS.rug, undefined);
  assert.equal(CONTENT_BLOCK_RADIUS.hammock, .45);
});

test('every pack type builds a shared, coloured, dispose-proof model', () => {
  const { mod } = makeMod();
  for (const type of PACK) {
    const a = mod.decorModel(type, { x: 0, z: 0 }), b = mod.decorModel(type, { x: 1, z: 0 });
    assert.ok(a?.isGroup, type); assert.equal(a.name, 'decor_' + type); assert.equal(a.userData.decorType, type);
    const ma = meshesOf(a), mb = meshesOf(b);
    assert.ok(ma.length >= 1 && ma.length <= (type === 'sign' ? 3 : 2), `${type}: ${ma.length} meshes`);
    ma.forEach((m, i) => {
      assert.equal(m.geometry, mb[i].geometry, type + ' shares geometry');
      assert.equal(m.material, mb[i].material, type + ' shares material');
      if (m.name === 'text') return;
      assert.ok(m.geometry.attributes.position.count > 0, type);
      assert.ok(m.geometry.attributes.color, type + ' has colours');
      assert.ok(m.castShadow && m.receiveShadow);
      // footprint inside the tile
      m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox.clone().translate(m.position);
      assert.ok(Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) <= .9 + 1e-6, `${type} footprint ${JSON.stringify(bb)}`);
      m.geometry.dispose(); m.material.dispose();
      assert.ok(m.geometry.attributes.position, 'shared geometry survives dispose()');
    });
    if (['pennant', 'fern', 'chime'].includes(type)) assert.ok(a.userData.swing?.isMesh, type + ' swing');
    if (type === 'sign') assert.equal(a.userData.text.visible, false);
  }
  assert.deepEqual(mod.debug.models().built.sort(), [...PACK].sort());
  assert.equal(mod.decorModel('crate', { x: 0, z: 0 }), null);
  assert.equal(mod.decorModel('sign', null), null);
  assert.equal(mod.decorModel('sign', { x: .5, z: 0 }), null);
  assert.doesNotThrow(() => mod.dispose());
});

test('rotation follows the rot slice', () => {
  const w = world(); w.decor.push({ type: 'hammock', x: 1, z: 0 });
  const { mod } = makeMod(w);
  mod.load({ v: 1, r: 1, s: 'h', t: {}, rot: { '1,0': 3 } }, 'save');
  const g = mod.decorModel('hammock', w.decor[0]);
  assert.ok(Math.abs(g.rotation.y - 3 * Math.PI / 2) < 1e-9);
  mod.load({ v: 1, r: 2, s: 'h', t: {}, rot: { '1,0': 1 } }, 'save');
  assert.ok(Math.abs(g.rotation.y - Math.PI / 2) < 1e-9);
});

test('paintSign: one fillText per line, shrinks wide text', () => {
  const calls = [], fonts = [];
  const g = { fillRect() {}, set font(v) { fonts.push(v); this._f = v; }, get font() { return this._f; },
    measureText(s) { const px = +/(\d+)px/.exec(this._f)[1]; return { width: s.length * px * .9 }; },
    fillText(s, x, y) { calls.push([s, x, y]); } };
  paintSign(g, ['Hi', 'there'], 256, 128);
  assert.deepEqual(calls.map(c => c[0]), ['Hi', 'there']);
  assert.ok(fonts.at(-1).startsWith('600 30px'));
  assert.equal(g.textAlign, 'center'); assert.equal(g.textBaseline, 'middle');
  calls.length = 0; fonts.length = 0;
  paintSign(g, ['W'.repeat(18)], 256, 128);
  const px = +/(\d+)px/.exec(fonts.at(-1))[1];
  assert.ok(px < 30 && px >= 14, 'shrunk to ' + px);
  assert.equal(calls.length, 1);
});

test('update animates the pennant flag; the loop is allocation-free by structure', () => {
  const w = world(); w.decor.push({ type: 'pennant', x: 0, z: 0 }, { type: 'chime', x: 1, z: 0 });
  const { ctx, mod } = makeMod(w);
  const raft = new T.Group();
  for (const d of w.decor) raft.add(mod.decorModel(d.type, d));
  ctx.elapsed = 1; mod.update(.016);
  const a = mod.debug.anim().find(x => x.type === 'pennant').ry;
  ctx.elapsed = 1.3; mod.update(.016);
  const b = mod.debug.anim().find(x => x.type === 'pennant').ry;
  assert.notEqual(a, b);
  assert.ok(Math.abs(a - 1) < .6, 'flag yaw follows the wind');
  const src = readFileSync(fileURLToPath(new URL('decor-pack.js', base)), 'utf8');
  const body = src.slice(src.indexOf('function update()'), src.indexOf('if (dirty) rescan();'));
  assert.ok(body.length > 100);
  for (const re of [/\bnew\b/, /[=(,:]\s*\[/, /[=(,:]\s*\{/, /=>/, /\.\.\./]) assert.doesNotMatch(body, re, 'no allocations in update');
  assert.doesNotThrow(() => mod.dispose());
});
