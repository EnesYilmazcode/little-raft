// Sandbox stand-in for a future dist/islands.js: seeded sand island + foliage scatter using foliage.js.
// Shows how an island module consumes createFoliage: shared geometries (built once), one InstancedMesh per
// plant kind per island, whole-kind LOD by island distance, per-instance shrink fade in the shader.
import { scatter, rng } from './foliage.js';

// Built once per scene and shared by every island.
export function createFoliageKit(T, F, { leaves = 'geo' } = {}) {
  const palmKind = leaves === 'card' ? 'palmCard' : 'palm';
  return {
    palmKind,
    palm: [F.geometry(palmKind, { seed: 7, lean: 0.55 }), F.geometry(palmKind, { seed: 19, lean: 0.9, height: 4.8, dry: 1 })],
    palmFar: [F.geometry('palmFar', { seed: 7, lean: 0.55 }), F.geometry('palmFar', { seed: 19, lean: 0.9, height: 4.8, dry: 1 })],
    bush: [F.geometry('bush', { seed: 11 }), F.geometry('bush', { seed: 12, lumps: 3, dark: 0x356f2a, light: 0x86b84f, flower: 0xf2c94c }), F.geometry('bush', { seed: 13, flowers: false, lumps: 5 })],
    fern: F.geometry('fern', { seed: 23 }),
    broadleaf: F.geometry('broadleaf', { seed: 31 }),
    grass: F.geometry('grass', { seed: 5 }),
    beachGrass: F.geometry('grass', { seed: 6, blades: 7, h: 0.34, base: 0x8a9550, tip: 0xe0d79a }),
  };
}

export const DENSITY = { sparse: 0.35, normal: 1, dense: 2 };

export function buildIsland(T, F, kit, { seed = 1, radius = 7, top = 0.9, density = 1, x = 0, z = 0, plants = true } = {}) {
  const r = rng(seed), g = new T.Group();
  g.position.set(x, 0, z);
  g.name = 'island_' + seed;
  const s1 = r() * 6.28, s2 = r() * 6.28;
  const edge = a => radius * (1 + 0.12 * Math.sin(3 * a + s1) + 0.07 * Math.sin(5 * a + s2));
  const rr = (px, pz) => Math.hypot(px, pz) / edge(Math.atan2(pz, px));
  const heightAt = (px, pz) => {
    const q = rr(px, pz);
    if (q < 1) return (top + 0.3) * Math.pow(1 - q * q, 0.75) - 0.3 + 0.05 * Math.sin(px * 1.3 + s1) * Math.sin(pz * 1.1) * (1 - q);
    return -0.3 - (q - 1) * 3.5;
  };
  const grassy = (px, pz) => rr(px, pz) < 0.62 + 0.08 * Math.sin(Math.atan2(pz, px) * 4 + s2);

  // ground: polar grid, flat shaded, vertex coloured (wet sand / dry sand / grass)
  {
    const RINGS = 16, SEG = 56, pos = [], col = [];
    const wet = new T.Color(0xc7ae7a), sand = new T.Color(0xf0dcaa), grass = new T.Color(0x6f9c45), grass2 = new T.Color(0x86ab4e), edgeC = new T.Color(0xc4c07c);
    const pt = (i, j) => {
      const a = (j / SEG) * Math.PI * 2, q = Math.pow(i / RINGS, 0.85) * 1.35, d = edge(a) * q;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      return [px, heightAt(px, pz), pz];
    };
    const c = new T.Color();
    const face = (A, B, C) => {
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
      const n = Math.sin(cx * 3.1 + cz * 1.7) * Math.sin(cz * 2.3 - cx) * 0.5 + 0.5;
      if (cy < 0.02) c.copy(wet).lerp(sand, Math.max(0, (cy + 0.25) / 0.27) * 0.5);
      else if (grassy(cx, cz)) c.copy(grass).lerp(grass2, n);
      else if (grassy(cx * 0.88, cz * 0.88)) c.copy(edgeC).lerp(sand, n * 0.5);
      else c.copy(sand).multiplyScalar(0.96 + 0.06 * n);
      for (const v of [A, B, C]) { pos.push(...v); col.push(c.r, c.g, c.b); }
    };
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (i === 0) face(a, cc, b); else { face(a, cc, b); face(a, d, cc); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true; ground.name = 'islandGround';
    g.add(ground);
  }

  // rocks (static, merged)
  {
    const pos = [], col = [];
    const rocks = scatter({ count: Math.round(3 + 3 * density), radius: radius * 1.05, seed: seed * 7 + 1, minDist: 1.2, accept: (px, pz) => rr(px, pz) > 0.75 && rr(px, pz) < 1.05, heightAt });
    for (const k of rocks) {
      const geo = new T.DodecahedronGeometry(0.28 * k.scale, 0);
      geo.scale(1.3, 0.7, 1); geo.rotateY(k.rot); geo.translate(k.x, k.y + 0.05, k.z);
      const c = new T.Color(0x8b8a80).multiplyScalar(k.tint);
      pos.push(...geo.attributes.position.array);
      for (let i = 0; i < geo.attributes.position.count; i++) col.push(c.r, c.g, c.b);
      geo.dispose();
    }
    if (pos.length) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
  }

  if (!plants) { g.userData = { heightAt, radius, palms: [{ x: 0, z: 0 }], counts: {} }; return g; }
  const center = g.position;
  const add = (mesh, maxD) => { g.add(mesh); if (maxD) F.lod(mesh, maxD, 0, center); return mesh; };
  const D = density;

  // palms: lean outward toward the sea, near/far LOD pairs
  const palms = scatter({ count: Math.max(1, Math.round(6 * D)), radius, seed: seed * 3 + 2, minDist: 2.2, accept: (px, pz) => rr(px, pz) < 0.78 && rr(px, pz) > 0.15, heightAt, scale: [0.85, 1.15] });
  palms.forEach(p => { p.rot = Math.atan2(-p.z, p.x) + (r() - 0.5) * 0.8; p.y -= 0.05; p.tint = 0.92 + r() * 0.16; });
  const LOD_PALM = 42 + radius;
  kit.palm.forEach((geo, v) => {
    const set = palms.filter((_, i) => i % kit.palm.length === v);
    if (!set.length) return;
    add(F.instanced(kit.palmKind, geo, set), LOD_PALM);
    const far = F.instanced('palmFar', kit.palmFar[v], set);
    g.add(far); F.lod(far, 1e9, LOD_PALM, center);
  });
  const avoid = palms.map(p => ({ x: p.x, z: p.z, r: 0.45 }));

  const inGrass = (px, pz) => grassy(px, pz);
  const bushes = scatter({ count: Math.round(12 * D), radius, seed: seed * 5 + 3, minDist: 1.1, accept: inGrass, heightAt, avoid, scale: [0.75, 1.3] });
  kit.bush.forEach((geo, v) => {
    const set = bushes.filter((_, i) => i % kit.bush.length === v);
    if (set.length) add(F.instanced('bush', geo, set), 46 + radius);
  });
  const ferns = scatter({ count: Math.round(16 * D), radius, seed: seed * 11 + 4, minDist: 0.7, accept: (px, pz) => rr(px, pz) < 0.62, heightAt, avoid, scale: [0.8, 1.3] });
  if (ferns.length) add(F.instanced('fern', kit.fern, ferns), 34 + radius);
  const broad = scatter({ count: Math.round(9 * D), radius, seed: seed * 13 + 5, minDist: 1.0, accept: inGrass, heightAt, avoid, scale: [0.8, 1.4] });
  if (broad.length) add(F.instanced('broadleaf', kit.broadleaf, broad), 40 + radius);
  const grass = scatter({ count: Math.round(520 * D), radius, seed: seed * 17 + 6, minDist: 0.16, accept: (px, pz, q, rn) => grassy(px, pz) || (rr(px, pz) < 0.92 && rn() < 0.06), heightAt, scale: [0.7, 1.4] });
  const beach = grass.filter(p => !grassy(p.x, p.z)), lawn = grass.filter(p => grassy(p.x, p.z));
  if (lawn.length) add(F.instanced('grass', kit.grass, lawn), 21 + radius);
  if (beach.length) add(F.instanced('grass', kit.beachGrass, beach), 21 + radius);

  g.userData = { heightAt, radius, palms, counts: { palms: palms.length, bushes: bushes.length, ferns: ferns.length, broadleaf: broad.length, grass: grass.length } };
  return g;
}
