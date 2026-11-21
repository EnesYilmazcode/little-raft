// Message in a bottle: small glass bottle with a cork and a rolled note inside.
// createBottle(T) -> THREE.Group named 'bottle' (~0.42 long along X, centred on origin). No textures.
// Two meshes: the see-through glass and one opaque vertex-coloured mesh for cork, note and twine. Every
// bottle is identical, so geometry and materials are built once per T and shared
// (geometry/material.userData.shared = true): never dispose them when one bottle is removed.

// Bake a flat colour (sRGB hex -> linear) into a color attribute.
function tint(T, g, hex) {
  const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}

// Merge position/normal[/color] of several geometries into one non-indexed geometry. Disposes inputs.
function merge(T, geos, withColor) {
  const parts = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = withColor ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (col) col.set(p.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c;
    p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const SHARED = new WeakMap();

function buildBottle(T) {
  const at = (g, y, rx = 0) => { if (rx) g.rotateX(rx); return g.translate(0, y, 0); };
  // Built along +Y (y -0.21..0.21), then laid along X by the mesh rotation.
  const prof = [
    [0.0, -0.21], [0.062, -0.21], [0.074, -0.2], [0.078, -0.18], [0.078, 0.02],
    [0.072, 0.05], [0.05, 0.085], [0.032, 0.105], [0.028, 0.12],
  ].map(([r, y]) => new T.Vector2(r, y));
  const glassGeo = merge(T, [
    new T.LatheGeometry(prof, 28),
    at(new T.CylinderGeometry(0.026, 0.028, 0.055, 20, 1, true), 0.1475),
    at(new T.TorusGeometry(0.027, 0.006, 8, 20), 0.175, Math.PI / 2),
  ], false);
  const solidGeo = merge(T, [
    tint(T, at(new T.CylinderGeometry(0.025, 0.021, 0.05, 16), 0.185), '#bb8a53'),   // cork
    tint(T, at(new T.CylinderGeometry(0.03, 0.03, 0.2, 16), -0.07), '#f3e6c4'),      // rolled note
    tint(T, at(new T.CylinderGeometry(0.0325, 0.0325, 0.014, 16), -0.07), '#c8995f'), // twine band
  ], true);
  const glassMat = new T.MeshStandardMaterial({ color: '#9fd6d0', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
  const solidMat = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0 });
  for (const x of [glassGeo, solidGeo, glassMat, solidMat]) x.userData.shared = true;
  return { glassGeo, solidGeo, glassMat, solidMat };
}

export function createBottle(T) {
  let b = SHARED.get(T);
  if (!b) SHARED.set(T, (b = buildBottle(T)));
  const root = new T.Group();
  root.name = 'bottle';
  const inner = new T.Group();
  const solid = new T.Mesh(b.solidGeo, b.solidMat);
  const glass = new T.Mesh(b.glassGeo, b.glassMat);
  glass.renderOrder = 2;
  inner.add(solid, glass);
  inner.rotation.z = -Math.PI / 2; // +Y -> +X
  root.add(inner);
  for (const m of [solid, glass]) { m.castShadow = false; m.receiveShadow = false; }
  return root;
}

export default createBottle;
