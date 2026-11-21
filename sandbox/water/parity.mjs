// Physics parity: the lab ocean must return the same heights/slopes as the shipping dist/ocean.js,
// because the raft bob, player swim check, floating items and hook surface all read getHeight/getSlope.
// Usage: node sandbox/water/parity.mjs
import * as T from '../../dist/vendor/three.module.js';
import { createOcean as oldOcean } from '../../dist/ocean.js';
import { createOcean as newOcean } from './water.js';

const a = oldOcean(T), b = newOcean(T);
let worst = 0, n = 0;
for (let t = 0; t < 60; t += 1.7) {
  a.update(t); b.update(t);           // no camera: neither moves its mesh
  for (let x = -40; x <= 40; x += 3.3) for (let z = -40; z <= 40; z += 2.9) {
    const s1 = a.getSlope(x, z), s2 = b.getSlope(x, z);
    worst = Math.max(worst, Math.abs(a.getHeight(x, z) - b.getHeight(x, z)), Math.abs(s1.x - s2.x), Math.abs(s1.z - s2.z));
    n++;
  }
}
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
const ok = worst < 1e-9 && ampWorst < 1e-9 && b.uniforms.uAmp.value === 1;
console.log(JSON.stringify({ samples: n, worstDiff: worst, setAmpWorstDiff: ampWorst, ok }));
process.exit(ok ? 0 : 1);
