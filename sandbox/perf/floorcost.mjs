// CPU cost of raft rebuilds on the CURRENT dist: what game.js rebuildRaft() does on every build, decoration,
// world sync and hot swap (createRaftMesh over every tile, then every decoration model again), against the
// incremental deck in sandbox/perf/deck-cache.js (only new tiles are generated; the merge is redone).
// node sandbox/perf/floorcost.mjs [--dist DIR]
// Uses process.cpuUsage, so it is fair on a loaded machine, but absolute numbers still inflate with load.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const di = process.argv.indexOf('--dist');
const dist = pathToFileURL(resolve(di > 0 ? process.argv[di + 1] : new URL('../../dist', import.meta.url).pathname) + '/').href;
const T = await import(dist + 'vendor/three.module.js');
const { createRaftMesh } = await import(dist + 'deck.js');
const { createCraft } = await import(dist + 'crafts.js');
const { createDeckCache } = await import(new URL('./deck-cache.js', import.meta.url).href);

const cache = new Map(), mat = c => cache.get(c) ?? cache.set(c, new T.MeshStandardMaterial({ color: c })).get(c);
const cpu = f => { const t0 = process.cpuUsage(); const r = f(); const d = process.cpuUsage(t0); return [(d.user + d.system) / 1000, r]; };
const tilesOf = n => { const k = Math.round(Math.sqrt(n)), h = Math.floor(k / 2), out = []; for (let x = -h; x < k - h; x++) for (let z = -h; z < k - h; z++) out.push([x, z]); return out; };
const spec = ts => ts.map(([x, z]) => ({ index: x * 719 + z * 311, x: x * 2, z: z * 2 }));
const dispose = g => g.traverse(o => o.geometry?.dispose());
const sum = g => { let v = 0, s = 0; g.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position.array; v += p.length / 3; for (let i = 0; i < p.length; i++) s += p[i]; }); return [v, +s.toFixed(1)]; };
const DECOR = ['sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'crate', 'lantern', 'palm', 'bench', 'net', 'sail'];

for (let i = 0; i < 2; i++) dispose(createRaftMesh(T, spec(tilesOf(9)), mat)); // warm up the JIT
const out = {};
for (const n of [9, 25, 49]) {
  const ts = tilesOf(n);
  const [full, g] = cpu(() => createRaftMesh(T, spec(ts), mat)); const ref = sum(g); dispose(g);
  // incremental: deck already holds n-1 tiles, one more is placed
  const dc = createDeckCache(T, createRaftMesh, mat);
  dispose(dc.build(spec(ts.slice(0, -1))));
  const [inc, g2] = cpu(() => dc.build(spec(ts)));
  const same = JSON.stringify(sum(g2)) === JSON.stringify(ref); dispose(g2);
  const [deco, g3] = cpu(() => DECOR.map(k => createCraft(T, k)).filter(Boolean)); for (const d of g3) dispose(d);
  // a decoration placed: stock rebuilds the whole deck; the cache reuses it untouched
  const [decoOnly, g4] = cpu(() => dc.build(spec(ts))); const reused = g4 === dc.last;
  out[n + ' tiles'] = { stockRebuildDeckMs: Math.round(full), decor12Ms: Math.round(deco), incrementalOneTileMs: Math.round(inc), sameGeometry: same, unchangedTilesMs: +decoOnly.toFixed(1), deckReusedWhenTilesUnchanged: reused };
}
console.log(JSON.stringify(out, null, 1));
