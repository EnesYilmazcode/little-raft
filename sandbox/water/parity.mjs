// Physics parity: the lab ocean must return the same heights/slopes as the shipping dist/ocean.js, because the
// raft bob, player swim and dive checks, floating items, hook, bobbers, islands and wildlife all read
// getHeight / getSlope / sample. Checked with the sailing offset uFlow at rest and far out (sailing-world.js
// writes it every frame; it wraps at +-65536), and every call form game.js uses.
// Usage: node sandbox/water/parity.mjs
import * as T from '../../dist/vendor/three.module.js';
import { createOcean as oldOcean } from '../../dist/ocean.js';
import { createOcean as newOcean } from './water.js';

const a = oldOcean(T), b = newOcean(T);
for (const k of Object.keys(a)) if (!(k in b)) { console.log(JSON.stringify({ ok: false, missing: k })); process.exit(1); }
for (const k of Object.keys(a.uniforms)) if (!(k in b.uniforms)) { console.log(JSON.stringify({ ok: false, missingUniform: k })); process.exit(1); }
const FLOWS = [[0, 0], [3.7, -12.25], [-411.3, 977.9], [65535.5, -65530.1]];
let worst = 0, n = 0;
const oa = { x: 0, z: 0 }, ob = { x: 0, z: 0 }, sa = {}, sb = {};
const d = (p, q) => Math.abs(p - q);
for (const [fx, fz] of FLOWS) {
  a.uniforms.uFlow.value.set(fx, fz); b.uniforms.uFlow.value.set(fx, fz);
  for (let t = 0; t < 60; t += 1.7) {
    a.update(t); b.update(t);           // no camera: neither moves its mesh
    for (let x = -40; x <= 40; x += 3.3) for (let z = -40; z <= 40; z += 2.9) {
      const s1 = a.getSlope(x, z), s2 = b.getSlope(x, z);
      a.getSlope(x, z, t + 0.3, 2.2, oa); b.getSlope(x, z, t + 0.3, 2.2, ob);
      a.sample(x, z, sa); b.sample(x, z, sb);
      const s3 = a.sample(x, z, undefined, t - 0.4, 2.2), s4 = b.sample(x, z, undefined, t - 0.4, 2.2);
      worst = Math.max(worst, d(a.getHeight(x, z), b.getHeight(x, z)), d(s1.x, s2.x), d(s1.z, s2.z), d(oa.x, ob.x), d(oa.z, ob.z),
        d(sa.h, sb.h), d(sa.sx, sb.sx), d(sa.sz, sb.sz), d(s3.h, s4.h), d(s3.sx, s4.sx), d(s3.sz, s4.sz));
      n++;
    }
  }
}
a.uniforms.uFlow.value.set(0, 0); b.uniforms.uFlow.value.set(0, 0);
// setAmp must move the CPU side with the GPU uniform: runtime setAmp(2.6) == created with amp 2.6, and back to 1 == old.
const rough = newOcean(T, { amp: 2.6 });
let ampWorst = 0;
for (const t of [0, 7.3, 31]) {
  b.update(t); rough.update(t); a.update(t);
  for (let x = -20; x <= 20; x += 4.1) for (let z = -20; z <= 20; z += 3.7) {
    b.setAmp(2.6); ampWorst = Math.max(ampWorst, Math.abs(b.getHeight(x, z) - rough.getHeight(x, z)));
    b.setAmp(1); ampWorst = Math.max(ampWorst, Math.abs(b.getHeight(x, z) - a.getHeight(x, z)));
  }
}
const ok = worst === 0 && ampWorst === 0 && b.uniforms.uAmp.value === 1;
console.log(JSON.stringify({ samples: n, flows: FLOWS.length, worstDiff: worst, setAmpWorstDiff: ampWorst, ok }));
process.exit(ok ? 0 : 1);
