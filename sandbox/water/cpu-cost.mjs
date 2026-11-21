// CPU cost of the water's JS side: SDF bake per raft size, floater pick, getHeight.
// Usage: node sandbox/water/cpu-cost.mjs
import * as T from '../../dist/vendor/three.module.js';
import { createOcean } from './water.js';

const o = createOcean(T);
for (const n of [7, 50, 400, 7, 50, 400]) {   // second pass = JIT-warm numbers
  const tiles = [], s = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) tiles.push([(i % s) - (s >> 1), Math.floor(i / s) - (s >> 1)]);
  o.setRaft(tiles);
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) o.setRaft(tiles);
  console.log(`setRaft(${n} tiles) ${((performance.now() - t0) / 5).toFixed(2)} ms`);
}
const fl = Array.from({ length: 30 }, (_, i) => [i, i * 2, 0.35]);
let t = performance.now();
for (let k = 0; k < 1000; k++) o.setFloaters(fl, 0, 0);
console.log(`setFloaters(30 circles, stamped into the map) ${((performance.now() - t) / 1000).toFixed(4)} ms`);
t = performance.now();
for (let k = 0; k < 100000; k++) o.getHeight(k % 50, k % 37);
console.log(`getHeight ${((performance.now() - t) * 10).toFixed(2)} ns/call`);
const meshes = Array.from({ length: 30 }, (_, i) => {
  const g = new T.Group(), m = new T.Mesh(new T.BoxGeometry(1 + (i % 3) * 0.4, 0.1, 0.3));
  g.add(m); g.position.set(i, 0, i * 2); g.rotation.set(0.05, i, 0.03); return g;
});
for (const m of meshes) o.footprint(m);   // first call measures and caches the bounding box
t = performance.now();
for (let k = 0; k < 1000; k++) { const l = []; for (const m of meshes) l.push(o.footprint(m)); o.setFloaters(l, 0, 0); }
console.log(`footprint x30 + setFloaters (capsules) ${((performance.now() - t) / 1000).toFixed(4)} ms`);
