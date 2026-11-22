// Held items: every inventory kind shows its own first-person model. Fails when two different item ids
// build the same held mesh (same geometry, transforms and colours), or when a kind falls back to the
// generic cloth bundle. Uses the same model factory the game passes to createHands (models.js getModel).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const B = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const { ITEM_KINDS } = await import(new URL('inventory-state.js', base));
const { buildItemModel, holdFor } = await import(new URL('held-items.js' + B, base));
const { getModel } = await import(new URL('models.js' + B, base));
const { HELD_HOLD, HELD_MODEL_KINDS } = await import(new URL('held-models.js' + B, base));

// Deliberate exceptions: pairs of ids allowed to share one held model, each with the reason.
// None today: every id has its own model. Add [a, b, 'why'] here only for true aliases (one item, two ids).
const SAME_MODEL_OK = [];
const allowed = (a, b) => SAME_MODEL_OK.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// Geometry fingerprint: per mesh vertex count, a position checksum in item space and the material colours.
function fingerprint(root) {
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m = new T.Matrix4(), v = new T.Vector3(), parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 64));
    m.multiplyMatrices(inv, o.matrixWorld);
    let sum = 0;
    for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(m); sum += v.x * 3.1 + v.y * 5.7 + v.z * 7.3; }
    const cols = [].concat(o.material).map((x) => x.color?.getHexString() ?? '-').join('/');
    parts.push(`${p.count}:${sum.toFixed(4)}:${cols}`);
  });
  return parts.sort().join('|');
}
const factory = (k) => getModel(k);

test('every inventory kind has its own held model (no two ids share one)', () => {
  const seen = new Map(), clashes = [];
  for (const kind of ITEM_KINDS) {
    const m = buildItemModel(T, kind, factory);
    assert.ok(m?.isObject3D, kind);
    const f = fingerprint(m);
    assert.ok(f.length > 0, `${kind} has meshes`);
    const other = seen.get(f);
    if (other && !allowed(other, kind)) clashes.push(`${other} = ${kind}`);
    else seen.set(f, kind);
  }
  assert.deepEqual(clashes, [], 'item ids sharing one held mesh');
});

// Ids whose held meshes have the same shape (counts and positions) must differ in colour by a margin a player
// sees (paint pots, juice cups, ores, ingots), not by a colour jitter that only passes the fingerprint.
test('same-shape held models differ by a visible colour', () => {
  const parts = (root) => {
    root.updateMatrixWorld(true);
    return fingerprint(root).split('|').map((p) => { const i = p.lastIndexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; });
  };
  const rgb = (hex) => { const c = new T.Color('#' + hex).convertLinearToSRGB(); return [c.r, c.g, c.b].map((x) => x * 255); };
  const byShape = new Map(), weak = [];
  for (const kind of ITEM_KINDS) {
    const p = parts(buildItemModel(T, kind, factory)), shape = p.map(([g]) => g).join('|');
    for (const [other, q] of byShape.get(shape) || []) {
      let best = 0;
      p.forEach(([, a], i) => a.split('/').forEach((h, j) => {
        const b = q[i][1].split('/')[j];
        if (h !== '-' && b && b !== '-') best = Math.max(best, Math.hypot(...rgb(h).map((x, k) => x - rgb(b)[k])));
      }));
      if (best < 40 && !allowed(other, kind)) weak.push(`${other} ~ ${kind} (${best.toFixed(0)})`);
    }
    if (!byShape.has(shape)) byShape.set(shape, []);
    byShape.get(shape).push([kind, p]);
  }
  assert.deepEqual(weak, [], 'same-shape held models whose colours barely differ');
});

test('no inventory kind falls back to the generic bundle', () => {
  const shape = (m) => fingerprint(m).split('|').map((p) => p.replace(/:[^:]*:/, ':')).join('|'); // counts + colours, any scale
  const bundle = shape(buildItemModel(T, 'not-a-real-kind', factory));
  assert.deepEqual(ITEM_KINDS.filter((k) => shape(buildItemModel(T, k, factory)) === bundle), []);
});

test('held-models holds are sane and stay small', () => {
  for (const kind of HELD_MODEL_KINDS) {
    const h = holdFor(kind);
    assert.ok(['left', 'right'].includes(h.hand), kind);
    assert.ok(['grip', 'point', 'open', 'throw'].includes(h.pose), kind);
    const m = buildItemModel(T, kind, factory), s = m.userData.size;
    assert.ok(Math.max(s.x, s.y, s.z) <= (h.hand === 'left' ? 0.111 : 0.25), `${kind} fits the hand`);
    if (HELD_HOLD[kind]?.grip) assert.equal(HELD_HOLD[kind].grip.length, 3, kind);
  }
});
