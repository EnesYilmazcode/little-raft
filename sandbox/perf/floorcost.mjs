// CPU cost of raft rebuilds: createFloor per tile, a full rebuild, and one append to a 49-tile deck batch.
// node sandbox/perf/floorcost.mjs [lowpoly-props.js]   (default: sandbox/procedural-models/lowpoly-props.js if present)
// Uses process.cpuUsage, so it is fair on a loaded machine, but absolute numbers still inflate with load.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const T = await import(new URL('../../dist/vendor/three.module.js', import.meta.url));
const { createFloor: stockFloor } = await import(new URL('../../dist/deck.js', import.meta.url));
const { createStaticBatch } = await import(new URL('./merge.js', import.meta.url));
const lpPath = process.argv[2] ? resolve(process.argv[2]) : new URL('../procedural-models/lowpoly-props.js', import.meta.url).pathname;
const floors = [['stock deck.js', stockFloor]];
if (existsSync(lpPath)) floors.push(['procedural-models lowpoly-props.js', (await import(pathToFileURL(lpPath).href)).createFloor]);

const cache = new Map(), mat = c => cache.get(c) ?? cache.set(c, new T.MeshStandardMaterial({ color: c })).get(c);
const cpu = f => { const t0 = process.cpuUsage(); f(); const d = process.cpuUsage(t0); return (d.user + d.system) / 1000; };
const tile = (F, i) => { const g = F(T, i * 719, mat); g.position.set((i % 7) * 2, 0, Math.floor(i / 7) * 2); return g; };
const out = {};
for (const [name, F] of floors) {
  for (let i = 0; i < 3; i++) tile(F, i); // warm up
  const perTile = cpu(() => { for (let i = 0; i < 20; i++) tile(F, i); }) / 20;
  const batch = createStaticBatch(T, 'deck'), gs = [];
  for (let i = 0; i < 48; i++) gs.push(tile(F, i));
  const fullBake = cpu(() => batch.add(gs, gs.map((_, i) => 'k' + i)));
  let append = 0; const N = 8;
  for (let k = 0; k < N; k++) { const g = tile(F, 100 + k); append += cpu(() => batch.add([g], ['n' + k])); }
  const verts = batch.group.children.reduce((s, m) => s + m.geometry.drawRange.count, 0);
  out[name] = { createFloorMsPerTile: +perTile.toFixed(1), fullRebuild49Ms: Math.round(perTile * 49 + fullBake), batchAppendMs: +(append / N).toFixed(1), deckVertices56Tiles: verts, deckDrawCalls: batch.group.children.length };
}
console.log(JSON.stringify(out, null, 1));
