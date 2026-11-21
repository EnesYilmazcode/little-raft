// CPU wave sampling checks: sample() must equal getHeight/getSlope exactly, and the flattened
// sampler must match the original object-based Gerstner mirror bit for bit.
// Run: node --test tests/ocean-sampler.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import { createOcean } from '../dist/ocean.js';

// Reference: the original object-based implementation (pre-flattening), kept verbatim in spirit.
const WAVES = [
  [1.0, 0.35, 0.10, 31.0, 0.50],
  [0.7, 0.90, 0.065, 19.0, 0.60],
  [-0.45, 1.0, 0.05, 12.5, 0.60],
  [0.95, -0.55, 0.04, 9.2, 0.50],
];
const pre = WAVES.map(([dx, dz, a, l, q]) => {
  const len = Math.hypot(dx, dz), k = (Math.PI * 2) / l;
  return { dx: dx / len, dz: dz / len, a, k, c: Math.sqrt(9.8 / k) * 0.6, q };
});
function displace(x, z, t, out) {
  let ox = 0, oy = 0, oz = 0;
  for (const w of pre) {
    const f = w.k * (w.dx * x + w.dz * z - w.c * t), co = Math.cos(f);
    ox += w.dx * w.q * w.a * co; oz += w.dz * w.q * w.a * co; oy += w.a * Math.sin(f);
  }
  out[0] = ox; out[1] = oy; out[2] = oz; return out;
}
const tmp = [0, 0, 0];
function refHeight(baseY, x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 2; i++) { displace(px, pz, t, tmp); px = x - tmp[0]; pz = z - tmp[2]; }
  displace(px, pz, t, tmp); return baseY + tmp[1];
}
const refSlope = (b, x, z, t, e = 0.6) => ({
  x: (refHeight(b, x + e, z, t) - refHeight(b, x - e, z, t)) / (2 * e),
  z: (refHeight(b, x, z + e, t) - refHeight(b, x, z - e, t)) / (2 * e),
});

let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const points = Array.from({ length: 400 }, () => [(rnd() - .5) * 200, (rnd() - .5) * 200, rnd() * 5000, .2 + rnd() * 3]);

test('getHeight/getSlope match the original object-based mirror bit for bit', () => {
  const o = createOcean(T); const b = o.mesh.position.y;
  for (const [x, z, t, e] of points) {
    assert.equal(o.getHeight(x, z, t), refHeight(b, x, z, t));
    assert.deepEqual(o.getSlope(x, z, t), refSlope(b, x, z, t));
    assert.deepEqual(o.getSlope(x, z, t, e), refSlope(b, x, z, t, e));
  }
});

test('sample() equals getHeight + getSlope and reuses out objects', () => {
  const o = createOcean(T); const out = { h: 0, sx: 0, sz: 0 }, so = { x: 0, z: 0 };
  for (const [x, z, t, e] of points) {
    o.update(t);
    assert.equal(o.sample(x, z, out), out);
    assert.equal(out.h, o.getHeight(x, z)); const s = o.getSlope(x, z);
    assert.equal(out.sx, s.x); assert.equal(out.sz, s.z);
    o.sample(x, z, out, t, e); const s2 = o.getSlope(x, z, t, e);
    assert.equal(out.h, o.getHeight(x, z, t)); assert.equal(out.sx, s2.x); assert.equal(out.sz, s2.z);
    assert.equal(o.getSlope(x, z, t, e, so), so); assert.equal(so.x, s2.x); assert.equal(so.z, s2.z);
  }
  const fresh = o.sample(1, 2); assert.deepEqual(Object.keys(fresh).sort(), ['h', 'sx', 'sz']);
});

test('sample() stays bit-identical to getHeight/getSlope with a sailing flow offset', () => {
  const o = createOcean(T); const out = { h: 0, sx: 0, sz: 0 };
  o.uniforms.uFlow.value.set(3.7, -1.3);
  for (const [x, z, t, e] of points) {
    o.sample(x, z, out, t, e); const s = o.getSlope(x, z, t, e);
    assert.equal(out.h, o.getHeight(x, z, t)); assert.equal(out.sx, s.x); assert.equal(out.sz, s.z);
  }
});
