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
console.log(JSON.stringify({ samples: n, worstDiff: worst, ok: worst < 1e-9 }));
process.exit(worst < 1e-9 ? 0 : 1);
