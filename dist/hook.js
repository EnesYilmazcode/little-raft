// Held scrap hook model (first-person). ES module.
// Usage: import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b'; const g = createHook(THREE);
import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
// A driftwood stick with a cut plastic-bottle sleeve as the grip and a blocky orange plastic claw head
// lashed on top with black strapping. Group is re-centred on its bounding box.
// Handle at bottom (-Y) on the axis x=.2, z=0 (grip centre y≈-.272 before re-centring), claw head at the
// top (+Y); the claws reach toward -X and curl down, like the old hook's bend.
export function createHook(T) {
  const root = new T.Group();
  root.name = 'scrapHook';
  const inner = new T.Group();
  root.add(inner);

  // ---------- materials (all matte plastic / wood, no metal) ----------
  const wood = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.9 });
  const sleeve = new T.MeshStandardMaterial({ color: 0xe8e6dc, vertexColors: true, metalness: 0, roughness: 0.62 });
  const orange = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.66 });
  const black = new T.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0, roughness: 0.8 });

  const HX = 0.2; // handle axis X
  const UP = new T.Vector3(0, 1, 0);
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    inner.add(m);
    return m;
  };
  const tint = (geo, fn) => {                        // per-vertex colour from position
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new T.Color();
    for (let i = 0; i < pos.count; i++) { fn(c, pos.getX(i), pos.getY(i), pos.getZ(i)); c.toArray(cols, i * 3); }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    return geo;
  };
  // Square-section tapered block from a to b (blocky moulded plastic look).
  const block = (mat, a, b, r0, r1, twist = Math.PI / 4) => {
    const d = b.clone().sub(a), L = d.length();
    const g = new T.CylinderGeometry(r1, r0, L, 4, 1);
    g.rotateY(twist);
    const m = add(g, mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return m;
  };

  // ---------- 1. wooden dowel shaft (slightly crooked, grain streaks) ----------
  const shaftBot = -0.43, shaftTop = 0.2, sLen = shaftTop - shaftBot;
  const shaftGeo = new T.CylinderGeometry(0.031, 0.034, sLen, 10, 12);
  {
    const pos = shaftGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ang = Math.atan2(z, x);
      const bump = 1 + 0.06 * Math.sin(ang * 3 + y * 21) + 0.03 * Math.sin(ang * 7 - y * 47);
      pos.setXYZ(i, x * bump + 0.006 * Math.sin(y * 6), y, z * bump);
    }
    shaftGeo.computeVertexNormals();
    const base = new T.Color(0x8c6e4a), dark = new T.Color(0x5e4630), pale = new T.Color(0xa58a66);
    tint(shaftGeo, (c, x, y, z) => {
      const ang = Math.atan2(z, x);
      const grain = 0.5 + 0.5 * Math.sin(ang * 8 + Math.sin(y * 37) * 1.6);
      c.copy(base).lerp(dark, grain * 0.4).lerp(pale, (0.5 + 0.5 * Math.sin(y * 13 + ang)) * 0.3);
    });
  }
  add(shaftGeo, wood, HX, (shaftTop + shaftBot) / 2, 0);

  // ---------- 2. cut plastic-bottle sleeve over the grip (the fist closes round this) ----------
  const prof = [
    [0.03, -0.392], [0.040, -0.389], [0.045, -0.379], [0.047, -0.36], [0.0455, -0.33], [0.0475, -0.30], [0.0455, -0.27],
    [0.0475, -0.24], [0.0455, -0.21], [0.047, -0.19], [0.043, -0.168], [0.037, -0.15], [0.034, -0.138], [0.034, -0.12], [0.031, -0.116],
  ].map(([r, y]) => new T.Vector2(r, y));
  const sGeo = new T.LatheGeometry(prof, 18);
  {
    const pos = sGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {                     // crumpled thin plastic: soft dents
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ang = Math.atan2(z, x);
      const dent = 1 + 0.035 * Math.sin(ang * 5 + y * 40) * Math.sin(y * 23 + 1.3) - 0.02 * Math.max(0, Math.cos(ang - 2.1)) * Math.sin(y * 31);
      pos.setX(i, x * dent); pos.setZ(i, z * dent);
    }
    sGeo.computeVertexNormals();
    const w = new T.Color(1, 1, 1), grime = new T.Color(0xc9c3ae);
    tint(sGeo, (c, x, y, z) => c.copy(w).lerp(grime, 0.25 + 0.25 * Math.sin(Math.atan2(z, x) * 3 + y * 19)));
  }
  add(sGeo, sleeve, HX, 0, 0);
  // black tape bands holding the sleeve on
  const tape = new T.TorusGeometry(0.035, 0.0075, 6, 18);
  add(tape, black, HX, -0.125, 0).rotation.x = Math.PI / 2;
  add(new T.TorusGeometry(0.042, 0.0085, 6, 18), black, HX, -0.392, 0).rotation.x = Math.PI / 2;

  // ---------- 3. black bracket + lashing under the head ----------
  for (const y of [0.085, 0.135]) {
    const t = add(new T.TorusGeometry(0.036, 0.012, 6, 16), black, HX, y, 0);
    t.rotation.set(Math.PI / 2, 0, 0); t.rotation.y = (y - 0.1) * 2;
  }
  add(new T.BoxGeometry(0.1, 0.045, 0.11), black, HX - 0.01, 0.18, 0);              // bracket plate under the head
  block(black, V(HX + 0.045, 0.09, 0), V(HX + 0.04, 0.2, 0), 0.012, 0.012);         // strap up the back

  // ---------- 4. orange plastic claw head ----------
  const or = new T.Color(0xd8642a), orDark = new T.Color(0xa9471c), orLight = new T.Color(0xe8834a);
  const headParts = [];
  const hub = add(new T.BoxGeometry(0.12, 0.08, 0.12), orange, HX - 0.01, 0.24, 0);
  headParts.push(hub);
  const cap = add(new T.BoxGeometry(0.085, 0.03, 0.09), orange, HX - 0.01, 0.29, 0);
  headParts.push(cap);
  // lashing strap over the hub
  add(new T.BoxGeometry(0.125, 0.03, 0.124), black, HX - 0.01, 0.222, 0);
  // three slim moulded tines fanned round -X: out from the head, down, then hooked back up (a J barb)
  const tineD = [[0.035, 0.245], [0.088, 0.252], [0.135, 0.228], [0.155, 0.172], [0.147, 0.124], [0.12, 0.103], [0.1, 0.122]];
  for (const [th, s] of [[-1.05, 0.9], [0, 1.0], [1.05, 0.9]]) {
    const dx = -Math.cos(th), dz = Math.sin(th);
    const curve = new T.CatmullRomCurve3(tineD.map(([d, y]) => V(HX - 0.01 + dx * d * s, y, dz * d * s)), false, 'centripetal');
    const TS = 12, RS = 5, g = new T.TubeGeometry(curve, TS, 1, RS, false);
    const pos = g.attributes.position, c = new T.Vector3(), v = new T.Vector3();
    for (let i = 0; i <= TS; i++) {                       // taper: thick root, sharp tip
      const u = i / TS, r = 0.0055 + 0.025 * Math.pow(1 - u, 1.3);
      curve.getPointAt(u, c);
      for (let j = 0; j <= RS; j++) {
        const k = i * (RS + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    headParts.push(add(g, orange));
  }
  // short back spur so the head reads as a grapple, not a hammer
  headParts.push(block(orange, V(HX + 0.03, 0.25, 0), V(HX + 0.09, 0.215, 0), 0.024, 0.012));
  // moulded-plastic tint: darker underside, lighter top, slight mottling
  for (const m of headParts) {
    m.updateMatrix();
    const mx = m.matrix;
    tint(m.geometry, (c, x, y, z) => {
      const w = V(x, y, z).applyMatrix4(mx);
      const t = Math.max(0, Math.min(1, (w.y - 0.08) / 0.22));
      c.copy(orDark).lerp(or, Math.min(1, t * 1.6)).lerp(orLight, Math.max(0, t - 0.75) * 1.6);
      c.multiplyScalar(0.95 + 0.06 * Math.sin(w.x * 60 + w.z * 45));
    });
  }

  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const center = box.getCenter(new T.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new T.Vector3());
  // Static parts: one draw call per material (4), merged after the re-centre so the bounds/grip math
  // above sees the original parts.
  mergeChildMeshes(T, inner);
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.orientation = 'handle -Y, claw head +Y, claws reach toward -X and curl down';
  return root;
}
