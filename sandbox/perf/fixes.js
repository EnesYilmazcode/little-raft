// Runtime prototypes of each perf fix, applied to the LIVE game scene from outside (no dist edits).
// Used by shoot.py to A/B each fix in isolation. The dist-ready versions are in merge.js / perf-ADOPT.md.
// P = window.__perf (probe.js): P.R = {renderer, scene, camera}, P.T = three namespace.
import { mergeMeshesByMaterial } from './merge.js';

const findGroups = (scene, test) => scene.children.filter(o => o.isGroup && test(o));
const isRaft = g => g.children.some(c => c.name === 'raft-floor');
const isItems = g => g.children.some(c => /^debris-|^plastic$/.test(c.name) || c.userData?.token);
const isCloud = g => g.children.length === 3 && g.children.every(c => c.isMesh && c.geometry.type === 'IcosahedronGeometry');
const isIsland = g => !isRaft(g) && !isItems(g) && g.children.some(c => c.isGroup) && g.children.some(c => c.geometry?.type === 'CylinderGeometry');

// 1. Floating items never cast a visible shadow: the ocean is a lights:false ShaderMaterial and does not
//    sample the shadow map, and items never sit on the deck. So their shadow-pass draws are pure cost.
export function itemsNoShadow(P) {
  const items = findGroups(P.R.scene, isItems)[0];
  const off = () => items?.traverse(o => { if (o.isMesh) o.castShadow = false; });
  off(); setInterval(off, 200); // respawned items arrive with castShadow=true; the adopt version sets it at creation
}

// 2. Fit the sun's shadow camera to the raft instead of a fixed 50 x 50 m box. Everything that can RECEIVE a
//    visible shadow (deck, decor, avatars on deck) is inside the raft bounds, so casters outside are skipped
//    by three's shadow-frustum culling, and the same 1024 map gets ~3x the texel density.
export function shadowFit(P, margin = 4) {
  const { scene } = P.R, T = P.T, raft = findGroups(scene, isRaft)[0];
  const sun = scene.children.find(o => o.isDirectionalLight);
  const box = new T.Box3().setFromObject(raft), c = box.getCenter(new T.Vector3());
  const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + margin;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.set(c.x, 0, c.z); sun.position.set(c.x - 15, 28, c.z + 12);
  if (!sun.target.parent) scene.add(sun.target);
  return r;
}

// 3. Shadow map re-rendered at a fixed rate instead of every frame (looks: deck shadows step at `hz`).
export function shadowCadence(P, hz = 10) {
  const r = P.R.renderer; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
  setInterval(() => { r.shadowMap.needsUpdate = true; }, 1000 / hz);
}

// 4. Static scenery (12 islands, 24 clouds): ~190 meshes that never move -> one mesh per material.
export function mergeScenery(P) {
  const { scene } = P.R, T = P.T;
  const groups = findGroups(scene, g => isCloud(g) || isIsland(g));
  const merged = mergeMeshesByMaterial(T, groups, { name: 'scenery' });
  for (const g of groups) scene.remove(g);
  for (const m of merged) scene.add(m);
  return { groups: groups.length, meshes: merged.length };
}

// 5. Raft deck tiles: every createFloor tile is 5-7 meshes (3 plank colours, logs, ends, lashings, nails).
//    Merge all tiles into one mesh per material (decor stays separate). Rebuilt whenever the raft changes.
export function mergeRaft(P) {
  const { T } = P, raft = findGroups(P.R.scene, isRaft)[0];
  const floors = raft.children.filter(c => c.name === 'raft-floor');
  const merged = mergeMeshesByMaterial(T, floors, { name: 'raft-deck', relativeTo: raft });
  for (const f of floors) raft.remove(f);
  for (const m of merged) raft.add(m);
  return { tiles: floors.length, meshes: merged.length };
}
