// Runtime prototypes of perf fixes and diagnostics, applied to the LIVE game scene from outside (no dist edits).
// Used by shoot.py to A/B each one on the same frozen scene. Every function returns an undo list for undo(), so
// `shoot.py --multi` can measure them one after another in one page. The dist-ready versions are in
// sandbox/perf/adopt.patch / docs/tech/perf-ADOPT.md.
// P = window.__perf (probe.js): P.R = {renderer, scene, camera}, P.T = three namespace, P.raft, P.labels.

const top = (P, label) => P.R.scene.children.filter(o => (o.name || P.labels?.get(o)) === label);
export const undo = list => { for (const f of (list || []).reverse()) f(); };

// Bisection (diagnostic only, changes looks): hide one owner. The game may set .visible itself every frame
// (viewmodels), so visibility is pinned with an accessor and restored as a plain property.
export function hide(P, label) {
  const list = label === 'raft' ? [P.raft] : label === 'viewmodels' ? [...P.R.camera.children] : top(P, label);
  return list.map(o => {
    const was = o.visible;
    Object.defineProperty(o, 'visible', { get: () => false, set() {}, configurable: true });
    return () => Object.defineProperty(o, 'visible', { value: was, writable: true, configurable: true, enumerable: true });
  });
}
// Skip every render pass other than the main scene (diving's underwater overlay: underwater-fx.js render()).
export function hideExtraPass(P) {
  const r = P.R.renderer, orig = r.render;
  r.render = function (s, c) { if (s === P.R.scene) return orig.call(this, s, c); };
  return [() => { r.render = orig; }];
}

// Wood materials from dist/wood.js: colour map + bump map over the same canvas (an isotropic twin since 892db6d).
export const woodMaterials = P => {
  const s = new Set();
  P.R.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m.bumpMap && m.map && m.bumpMap.source === m.map.source) s.add(m); });
  return [...s];
};
// Drop the plank bump map altogether (main keeps it, sampled through an anisotropy-1 twin).
export function woodNoBump(P) {
  return woodMaterials(P).map(m => { const b = m.bumpMap; m.bumpMap = null; m.needsUpdate = true; return () => { m.bumpMap = b; m.needsUpdate = true; }; });
}

// Lantern pool lights (daynight.js): once a lantern exists they stay in the scene day and night (intensity 0 by
// day), so every lit material evaluates 2-4 point lights per pixel in daylight too. Take them out of the scene.
export function poolLightsOff(P) {
  const ls = []; P.R.scene.traverse(o => { if (o.isPointLight && o.name === 'daynight-lantern-light') ls.push(o); });
  return ls.map(l => { const p = l.parent; p.remove(l); return () => p.add(l); });
}

// Shadow map resolution (quality.js ladder: 1024 on the top levels, 512 lower down).
export function shadowMap(P, size) {
  const sun = P.R.scene.children.find(o => o.isDirectionalLight), was = sun.shadow.mapSize.x;
  const set = v => { sun.shadow.mapSize.set(v, v); sun.shadow.map?.dispose(); sun.shadow.map = null; };
  set(size); return [() => set(was)];
}

// Which meshes cast shadows, by owner (diagnostic).
export function shadowCasters(P) {
  const out = {};
  P.R.scene.traverse(o => { if (o.isMesh && o.castShadow && o.visible) { let p = o; while (p.parent && p.parent !== P.R.scene) p = p.parent; const k = p.name || P.labels?.get(p) || p.type; out[k] = (out[k] || 0) + 1; } });
  return out;
}
