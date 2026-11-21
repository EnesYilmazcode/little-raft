// Little Raft - foliage.js as the vegetation provider for dist/islands.js (copy to dist/ unchanged).
// No imports: islands.js passes T, the game's createFoliage() instance F, its own models and the palm shape.
//
//   const fol = ctx.foliage ? foliageIslands(T, ctx.foliage, models, {palmH: PALM_H, palmBend: PALM_BEND, preset: () => ctx.options?.graphics}) : null;
//   const veg = [...meshes, ...extra, ...(fol ? fol.meshes : [])];   fol?.attach(veg, group);
//   in relayout(): fol?.relayout(layout, localGround);
//
// Contracts kept with islands.js:
// - The gatherable meshes (island-palm, island-palmSpent, island-nuts, island-bush) are still built by islands.js
//   from models.geos / models.mats, with the same instance counts, matrices and instance colours. Only the
//   geometry and material objects are swapped, so writeNode/paintNode, the gather bounce and spent swap work as is.
// - The palm trunk follows islands.js's own spine (x = PALM_BEND * s^2, y = PALM_H * s, frame +x), so the pick
//   capsule, the coconut pick sphere at (PALM_BEND, PALM_H - .17) and SOLID_R trunk collision still sit on it.
// - Decor (ferns, broadleaf plants, grass tufts) is cosmetic: no pick, no collision, walk-through, deterministic
//   from the island seed, and scaled with the other vegetation while the island rises or sinks.

const DENSITY = { low: 0.4, medium: 0.75, high: 1 };
const CAP = { fern: 12, broadleaf: 9, grass: 90, beach: 50 };

export function foliageIslands(T, F, models, { palmH = 3.5, palmBend = 0.85, preset = () => 'medium' } = {}) {
  const points = [];
  for (let i = 0; i <= 6; i++) { const s = i / 6; points.push([palmBend * s * s, palmH * s, 0]); }
  const geo = {
    palm: F.geometry('palm', { seed: 7, height: palmH, points, coconuts: false, frondScale: 1.3 }),
    palmSpent: F.geometry('palm', { seed: 7, height: palmH, points, coconuts: false, frondScale: 1.25, dry: 99 }),
    nuts: F.geometry('coconuts', { top: [palmBend, palmH, 0], size: 1.3, dark: 0x4f4626, light: 0x7a6a34 }), // ripe brown, as in islands-models
    bush: F.geometry('bush', { seed: 11, flower: 0xc8343a, flowerCount: 5 }), // red blooms keep islands-models' red-berry gather cue
  };
  geo.bush.scale(1.15, 1.15, 1.15); geo.bush.computeBoundingSphere();
  const palmParams = geo.palm.userData.foliage;
  const mat = {
    palm: F.material('palm', palmParams),
    palmSpent: F.material('palm', geo.palmSpent.userData.foliage),
    nuts: F.material('palm', palmParams), // same sway params as the crown so the nuts ride with it
    bush: F.material('bush', { height: 1.0 }),
  };
  for (const k of Object.keys(geo)) {
    models.geos[k]?.dispose(); models.mats[k]?.dispose();
    models.geos[k] = geo[k]; models.mats[k] = mat[k];
    F.depth(mat[k]); // shadow twin, stored on mat.userData.foliageDepth and disposed with mat
  }

  // Decor kit (shared geometries) and one InstancedMesh per kind, sized for the busiest island.
  const kit = {
    fern: F.geometry('fern', { seed: 23 }),
    broadleaf: F.geometry('broadleaf', { seed: 31 }),
    grass: F.geometry('grass', { seed: 5, blades: 8, width: 1.5, spread: 1.7 }),
    beach: F.geometry('grass', { seed: 6, blades: 5, width: 1.5, spread: 1.7, h: 0.34, base: 0x8a9550, tip: 0xe0d79a }),
  };
  const dummy = n => Array.from({ length: n }, () => ({ x: 0, z: 0 }));
  const meshes = [], byKind = {};
  for (const k of Object.keys(kit)) {
    const m = F.instanced(k === 'beach' ? 'grass' : k, kit[k], dummy(CAP[k]));
    m.name = 'island-decor-' + k; m.count = 0;
    models.geos['decor_' + k] = kit[k]; models.mats['decor_' + k] = m.material; // models.dispose() frees them
    meshes.push(m); byKind[k] = m;
  }

  const m4 = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), Y = new T.Vector3(0, 1, 0), c = new T.Color();
  function fill(m, list) {
    const n = Math.min(list.length, m.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const pl = list[i];
      q.setFromAxisAngle(Y, pl.rot);
      m.setMatrixAt(i, m4.compose(p.set(pl.x, pl.y, pl.z), q, s.setScalar(pl.scale)));
      m.setColorAt(i, c.setScalar(pl.tint));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  return {
    meshes,
    // Give islands.js's own vegetation meshes their swaying shadow twins; register whole-kind LOD for decor.
    attach(veg, group) {
      for (const m of veg) { const d = m.material?.userData?.foliageDepth; if (d) m.customDepthMaterial = d; }
      if (group) { F.lod(byKind.grass, 34, 0, group.position); F.lod(byKind.beach, 34, 0, group.position); F.lod(byKind.fern, 44, 0, group.position); F.lod(byKind.broadleaf, 50, 0, group.position); }
    },
    // Rebuild decor for a new island layout. ground(x, z) = sand height above the island origin (NaN off the rim).
    relayout(layout, ground) {
      for (const m of meshes) m.count = 0;
      if (!layout) return;
      const D = DENSITY[preset()] ?? DENSITY.medium;
      const shadows = preset() === 'high';
      byKind.fern.castShadow = byKind.broadleaf.castShadow = shadows;
      const R = layout.R, seed = (layout.seed ^ 0x5f0e1a) >>> 0;
      const heightAt = (x, z) => { const g = ground(x, z); return g === g ? g : -9; };
      const dry = (x, z) => heightAt(x, z) > 0.42;
      const avoid = layout.nodes.map(n => ({ x: n.x, z: n.z, r: n.kind === 'palm' ? 0.35 : n.kind === 'bush' ? 0.75 : 0.55 }));
      const palms = layout.nodes.filter(n => n.kind === 'palm');
      // undergrowth: a little oasis round each palm base, ferns and elephant ears in the trunk's shade
      const nearPalm = (x, z, lo, hi) => palms.some(pm => { const d = Math.hypot(x - pm.x, z - pm.z); return d > lo && d < hi; });
      const ferns = F.scatter({ count: Math.round(CAP.fern * D), radius: R * 0.8, seed: seed + 1, minDist: 0.7, avoid, heightAt, scale: [0.8, 1.25],
        accept: (x, z) => dry(x, z) && nearPalm(x, z, 0.5, 2.0) });
      const broad = F.scatter({ count: Math.round(CAP.broadleaf * D), radius: R * 0.8, seed: seed + 2, minDist: 1.0, avoid: avoid.concat(ferns.map(f => ({ x: f.x, z: f.z, r: 0.5 }))), heightAt, scale: [0.8, 1.3],
        accept: (x, z) => dry(x, z) && nearPalm(x, z, 0.7, 2.4) });
      const grass = F.scatter({ count: Math.round(CAP.grass * D), radius: R * 0.8, seed: seed + 3, minDist: 0.28, avoid, heightAt, scale: [0.7, 1.3],
        accept: (x, z) => dry(x, z) && nearPalm(x, z, 0.25, 2.8) });
      const beach = F.scatter({ count: Math.round(CAP.beach * D), radius: R * 0.85, seed: seed + 4, minDist: 0.6, avoid, heightAt, scale: [0.55, 1.0],
        accept: (x, z, u, rn) => dry(x, z) && !nearPalm(x, z, 0, 2.6) && rn() < 0.6 });
      for (const l of [ferns, broad, grass, beach]) for (const pl of l) pl.y -= 0.03;
      fill(byKind.fern, ferns); fill(byKind.broadleaf, broad); fill(byKind.grass, grass); fill(byKind.beach, beach);
    },
  };
}
