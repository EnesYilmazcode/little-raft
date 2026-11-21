// Night light models (own art, pure THREE: every factory takes the THREE namespace, no other imports).
// Spec: docs/specs/nightlight.md.
//   createHandLantern(T) -> Group: a small tin hand lantern, ~0.28 m tall, origin = centre of its bounds.
//     userData.grip (Vector3, the top of the wire loop, root space), userData.size {x,y,z}.
//     Meshes: 'handLanternTin' (merged, vertex colours), 'handLanternGlass', 'handLanternGlow' (heldGlowMaterial).
//   heldGlowMaterial(T) -> the one shared glow material of every held lantern (nightlight.js scales it at night).
//   createFireflyJar(T) -> Group named 'craft_lantern' (so daynight.js lights it), userData.craftType 'fireflyjar'.
//     Meshes: 'jarCork', 'jarGlass', 'lanternGlow', 'jarBugs' (4 meshes, under 400 triangles).
//   createSwarm(T, n = 40) -> THREE.Points 'nightlight-swarm' (unlit, additive, opacity 0 until night).

// Merge geometries into one indexed geometry (position, normal, optional per-part colour).
function mergeParts(T, parts, colored) {
  let verts = 0, idx = 0;
  for (const p of parts) { verts += p.g.attributes.position.count; idx += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = colored ? new Float32Array(verts * 3) : null;
  const index = new Uint16Array(idx);
  const c = new T.Color();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.g, n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    if (col) { c.set(p.color); for (let i = 0; i < n; i++) { col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; } }
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) index[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < n; i++) index[io + i] = vo + i; io += n; }
    vo += n; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
const at = (g, x, y, z, rx = 0, ry = 0, rz = 0) => {
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
};

let glowT = null, glowMat = null;
export function heldGlowMaterial(T) {
  if (glowMat && glowT === T) return glowMat;
  glowT = T;
  glowMat = new T.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffb050', emissiveIntensity: 0.6, roughness: 1 });
  glowMat.name = 'handLanternGlow';
  return glowMat;
}

export function createHandLantern(T) {
  const TIN = '#6f6a5e', TIN_DARK = '#4b473f', WIRE = '#3d3a35';
  const tin = mergeParts(T, [
    { g: at(new T.CylinderGeometry(0.06, 0.065, 0.022, 10), 0, 0.011, 0), color: TIN_DARK },          // base
    { g: at(new T.CylinderGeometry(0.055, 0.06, 0.02, 10), 0, 0.172, 0), color: TIN_DARK },           // collar
    { g: at(new T.ConeGeometry(0.06, 0.05, 10), 0, 0.207, 0), color: TIN },                           // cap
    { g: at(new T.CylinderGeometry(0.012, 0.012, 0.02, 6), 0, 0.24, 0), color: TIN_DARK },            // chimney
    ...[0, 1, 2, 3].map(i => ({ g: at(new T.BoxGeometry(0.01, 0.15, 0.01), 0.042 * Math.cos(i * Math.PI / 2 + Math.PI / 4) * 1.41, 0.097,
      0.042 * Math.sin(i * Math.PI / 2 + Math.PI / 4) * 1.41), color: TIN })),                          // corner posts
    { g: at(new T.TorusGeometry(0.03, 0.004, 4, 12, Math.PI), 0, 0.25, 0), color: WIRE },            // wire loop (upper half)
  ], true);
  const tinMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 });
  const glassMat = new T.MeshStandardMaterial({ color: '#fff6dd', emissive: '#ffcf80', emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  const inner = new T.Group();
  const m1 = new T.Mesh(tin, tinMat); m1.name = 'handLanternTin';
  const m2 = new T.Mesh(at(new T.BoxGeometry(0.075, 0.14, 0.075), 0, 0.092, 0), glassMat); m2.name = 'handLanternGlass';
  const m3 = new T.Mesh(at(new T.SphereGeometry(0.026, 10, 8), 0, 0.09, 0), heldGlowMaterial(T)); m3.name = 'handLanternGlow';
  inner.add(m1, m2, m3);
  const root = new T.Group(); root.name = 'handLantern';
  root.add(inner);
  const box = new T.Box3().setFromObject(inner), c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
  inner.position.sub(c);
  root.userData.grip = new T.Vector3(0, 0.275, 0).sub(c);
  root.userData.size = { x: s.x, y: s.y, z: s.z };
  return root;
}

// Firefly Jar: daynight.js finds groups named 'craft_lantern', scales the 'lanternGlow' material by night and puts
// a pool light at that geometry's bounding-sphere centre. Glass and glow materials are per instance.
export function createFireflyJar(T) {
  const g = new T.Group(); g.name = 'craft_lantern';
  g.userData.craftType = 'fireflyjar'; g.userData.height = 0.26;
  const cork = mergeParts(T, [
    { g: at(new T.CylinderGeometry(0.058, 0.052, 0.04, 10), 0, 0.225, 0), color: '#b08455' },
    { g: at(new T.TorusGeometry(0.071, 0.006, 4, 12), 0, 0.2, 0, Math.PI / 2), color: '#d2b47a' },
  ], true);
  const corkM = new T.Mesh(cork, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); corkM.name = 'jarCork';
  const glassGeo = mergeParts(T, [
    { g: at(new T.CylinderGeometry(0.072, 0.07, 0.2, 14, 1, true), 0, 0.105, 0) },
    { g: at(new T.CircleGeometry(0.07, 14), 0, 0.006, 0, -Math.PI / 2) },
  ], false);
  const glass = new T.Mesh(glassGeo, new T.MeshStandardMaterial({ color: '#d8f2ee', emissive: '#c8f060', emissiveIntensity: 0.12, roughness: 0.1,
    transparent: true, opacity: 0.3, side: T.DoubleSide, forceSinglePass: true, depthWrite: false }));
  glass.name = 'jarGlass';
  const glow = new T.Mesh(at(new T.SphereGeometry(0.045, 8, 6), 0, 0.1, 0),
    new T.MeshStandardMaterial({ color: '#eaffb8', emissive: '#c8f060', emissiveIntensity: 0.9, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));
  glow.name = 'lanternGlow';
  // The night pool light sits at this bounding-sphere centre: lift it well above the jar (the candle lesson,
  // bees-model.js) so the deck around the jar glows instead of blowing out white. Radius still encloses the orb.
  glow.geometry.computeBoundingSphere(); glow.geometry.boundingSphere.center.set(0, 0.55, 0); glow.geometry.boundingSphere.radius = 0.5;
  const bugParts = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4, r = 0.025 + 0.02 * ((i * 37) % 5) / 4, y = 0.05 + 0.022 * i;
    bugParts.push({ g: at(new T.OctahedronGeometry(0.008, 0), Math.cos(a) * r, y, Math.sin(a) * r) });
  }
  const bugs = new T.Mesh(mergeParts(T, bugParts, false), new T.MeshStandardMaterial({ color: '#e8ff7a', emissive: '#e8ff7a', emissiveIntensity: 1.6, roughness: 1 }));
  bugs.name = 'jarBugs';
  corkM.castShadow = true;
  g.add(corkM, glass, glow, bugs);
  return g;
}

export function createSwarm(T, n = 40) {
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new T.PointsMaterial({ size: 0.09, color: '#d8ff6a', transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
  const p = new T.Points(geo, mat);
  p.name = 'nightlight-swarm'; p.frustumCulled = false;
  return p;
}
