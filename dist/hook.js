// Held plastic grapple hook (first-person): pale-teal plastic hook lashed to a wooden stick. ES module.
// Usage: import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b'; const g = createHook(THREE);
import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
// Group is re-centered on its bounding box: ~0.75 wide (X), ~0.93 tall (Y), ~0.41 deep (Z); ~4.8k tris, 7 draw calls.
// Handle at bottom (-Y), curved hook with point at top (+Y), hook bend leans toward -Z (front).
export function createHook(T) {
  const root = new T.Group();
  root.name = 'scrapHook';
  const inner = new T.Group();
  root.add(inner);

  // ---------- materials ----------
  // Scrap-plastic grapple lashed to a driftwood stick: low metalness everywhere (there is no envMap,
  // so metal reads black), satin plastic in pale sea-glass teal / bleached white, warm wood and rope.
  const plastic = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.05, roughness: 0.5 });
  const teal = new T.MeshStandardMaterial({ color: 0x3fa7a0, metalness: 0.08, roughness: 0.45 });
  const tape = new T.MeshStandardMaterial({ color: 0xe9e2cf, metalness: 0.0, roughness: 0.7 });
  const tapeRed = new T.MeshStandardMaterial({ color: 0xd8643a, metalness: 0.0, roughness: 0.6 });
  const wood = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.85 });
  const rope = new T.MeshStandardMaterial({ color: 0xc9a66b, metalness: 0.0, roughness: 0.95 });
  const ropeDark = new T.MeshStandardMaterial({ color: 0x9c7a48, metalness: 0.0, roughness: 1.0 });

  const HX = 0.2; // handle axis X
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    inner.add(m);
    return m;
  };
  const up = new T.Vector3(0, 1, 0);
  const ring = (r, tube, mat, x, y, z, rx = Math.PI / 2, ry = 0, rz = 0, seg = 18) => {
    const m = add(new T.TorusGeometry(r, tube, 5, seg), mat, x, y, z);
    m.rotation.set(rx, ry, rz);
    return m;
  };

  // ---------- 1. chunky plastic hook (flattened strip, pale teal fading to sun-bleached white) ----------
  const pts = [
    [HX - 0.045, -0.12, 0.0],
    [HX - 0.045, 0.06, -0.01],
    [0.14, 0.24, -0.05],
    [0.04, 0.36, -0.12],
    [-0.1, 0.39, -0.2],
    [-0.25, 0.33, -0.26],
    [-0.34, 0.20, -0.28],
    [-0.33, 0.06, -0.25],
    [-0.24, 0.00, -0.2],
    [-0.15, 0.04, -0.16],
    [-0.11, 0.11, -0.13],
  ].map(p => new T.Vector3(p[0], p[1], p[2]));
  const curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
  const R = 0.034, TS = 40, RS = 8;
  const hookGeo = new T.TubeGeometry(curve, TS, R, RS, false);
  {
    // squash across the bend (normal) so it reads as a moulded strip, not a round rod; tint per vertex
    const pos = hookGeo.attributes.position, cols = [], c = new T.Color(), P = new T.Vector3(), v = new T.Vector3();
    const pale = new T.Color(0x86cbc0), white = new T.Color(0xeceee2), scuff = new T.Color(0x6f9c94), patch = new T.Color(0xf0c95a);
    for (let i = 0; i <= TS; i++) {
      const t = i / TS; curve.getPointAt(t, P);
      const N = hookGeo.normals[i];
      for (let j = 0; j <= RS; j++) {
        const k = i * (RS + 1) + j;
        v.fromBufferAttribute(pos, k).sub(P);
        const dn = v.dot(N);
        v.addScaledVector(N, -dn * 0.4);
        const taper = 1 - 0.25 * Math.max(0, (t - 0.7) / 0.3); // thinner toward the point
        v.multiplyScalar(taper);
        pos.setXYZ(k, P.x + v.x, P.y + v.y, P.z + v.z);
        c.copy(pale).lerp(white, Math.min(1, Math.max(0, (t - 0.15) * 1.6)) * 0.75);
        // a sun-faded yellow scrap patch spliced into the bend (taped at both ends below)
        if (t > 0.5 && t < 0.62) c.lerp(patch, 0.8);
        c.lerp(scuff, 0.25 * (0.5 + 0.5 * Math.sin(t * 47 + j * 1.7)) * (0.5 + 0.5 * Math.sin(t * 13)));
        cols.push(c.r, c.g, c.b);
      }
    }
    hookGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    hookGeo.computeVertexNormals();
  }
  add(hookGeo, plastic);

  // ---------- 2. teal plastic point (chunky, slightly blunt) ----------
  const endP = curve.getPoint(1);
  const endT = curve.getTangent(1).normalize();
  const tipLen = 0.085;
  const tip = add(new T.CylinderGeometry(0.006, R * 0.78, tipLen, 8), teal);
  tip.quaternion.setFromUnitVectors(up, endT);
  tip.position.copy(endP).addScaledVector(endT, tipLen / 2 - 0.004);

  // ---------- 3. barb (teal back-swept spur near the point) ----------
  const bendCenter = new T.Vector3(-0.18, 0.2, -0.2);
  const spur = (u, len, rad) => {
    const p = curve.getPoint(u), tg = curve.getTangent(u).normalize();
    const out = p.clone().sub(bendCenter);
    out.addScaledVector(tg, -out.dot(tg)).normalize();
    const dir = tg.clone().multiplyScalar(-0.7).addScaledVector(out, 0.72).normalize();
    const m = add(new T.CylinderGeometry(0.005, rad, len, 7), teal);
    m.quaternion.setFromUnitVectors(up, dir);
    m.position.copy(p).addScaledVector(out, R * 0.4).addScaledVector(dir, len / 2 - 0.012);
  };
  spur(0.95, 0.07, 0.016);

  // ---------- 4. second teal tine on the back of the crown (grapple look) ----------
  const tinePts = [[0.1, 0.3, -0.08], [0.14, 0.36, -0.1], [0.15, 0.415, -0.085], [0.13, 0.45, -0.06]].map(p => new T.Vector3(...p));
  const tineCurve = new T.CatmullRomCurve3(tinePts);
  add(new T.TubeGeometry(tineCurve, 8, 0.019, 7, false), teal);
  const tE = tineCurve.getPoint(1), tT = tineCurve.getTangent(1).normalize();
  const tTip = add(new T.CylinderGeometry(0.004, 0.02, 0.05, 7), teal);
  tTip.quaternion.setFromUnitVectors(up, tT);
  tTip.position.copy(tE).addScaledVector(tT, 0.022);
  // wrap of white tape where the tine joins the crown
  const tjP = curve.getPoint(0.2), tjT = curve.getTangent(0.2).normalize();
  for (const d of [-0.025, 0.0, 0.025]) {
    const m = add(new T.CylinderGeometry(R + 0.006, R + 0.006, 0.022, 10, 1, true), tape);
    m.quaternion.setFromUnitVectors(up, tjT);
    m.position.copy(tjP).addScaledVector(tjT, d);
  }

  for (const u of [0.5, 0.62]) {
    const m = add(new T.CylinderGeometry(R + 0.005, R + 0.005, 0.03, 10, 1, true), tape);
    m.quaternion.setFromUnitVectors(up, curve.getTangent(u).normalize());
    m.position.copy(curve.getPoint(u));
  }

  // ---------- 5. wooden stick handle (warm driftwood, irregular) ----------
  const handleTop = 0.03, handleBot = -0.39;
  const hLen = handleTop - handleBot;
  const hGeo = new T.CylinderGeometry(0.034, 0.042, hLen, 10, 12);
  {
    const pos = hGeo.attributes.position;
    const cols = [];
    const base = new T.Color(0xa87a4a), light = new T.Color(0xc89a62), dark = new T.Color(0x6e4a2a);
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ang = Math.atan2(z, x);
      const bump = 1 + 0.04 * Math.sin(ang * 5 + y * 30) + 0.02 * Math.sin(ang * 11 - y * 55);
      pos.setX(i, x * bump + 0.006 * Math.sin(y * 9));
      pos.setZ(i, z * bump);
      const grain = 0.5 + 0.5 * Math.sin(ang * 9 + Math.sin(y * 40) * 1.5);
      const sun = 0.5 + 0.5 * Math.sin(y * 17 + ang * 2);
      c.copy(base).lerp(dark, grain * 0.4).lerp(light, sun * 0.35);
      cols.push(c.r, c.g, c.b);
    }
    hGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    hGeo.computeVertexNormals();
  }
  add(hGeo, wood, HX, (handleTop + handleBot) / 2, 0);
  // rounded stick ends (flat vertex colour so they merge with the handle's vertex-coloured mesh)
  const tint = (geo, hex) => {
    const c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  };
  add(tint(new T.SphereGeometry(0.035, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x9e7348), wood, HX, handleTop, 0);
  add(tint(new T.SphereGeometry(0.042, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x7a5330), wood, HX, handleBot, 0);

  // ---------- 6. lashing: plastic shank tied alongside the stick ----------
  // rope bands around shank + stick (oval rings), a red tape band between
  for (const [y, mat] of [[-0.1, ropeDark], [-0.04, tapeRed], [0.0, ropeDark]]) {
    const m = ring(0.05, mat === tapeRed ? 0.012 : 0.009, mat, HX - 0.02, y, -0.003);
    m.scale.set(1.25, 0.82, mat === tapeRed ? 1.6 : 1);
  }
  for (const y of [-0.115, -0.085, -0.015, 0.015]) ring(0.05, 0.0065, rope, HX - 0.02, y, -0.003).scale.set(1.22, 0.8, 1);

  // ---------- 7. rope wrap (helix grip) ----------
  class Helix extends T.Curve {
    constructor(y0, y1, r, turns) { super(); this.y0 = y0; this.y1 = y1; this.r = r; this.turns = turns; }
    getPoint(t, out = new T.Vector3()) {
      const a = t * this.turns * Math.PI * 2;
      return out.set(HX + Math.cos(a) * this.r, this.y0 + (this.y1 - this.y0) * t, Math.sin(a) * this.r);
    }
  }
  const wrapTop = -0.17, wrapBot = -0.33;
  add(new T.TubeGeometry(new Helix(wrapBot, wrapTop, 0.046, 9), 140, 0.009, 5, false), rope);

  // ---------- 8. tied rope bands at wrap ends + knot ----------
  ring(0.047, 0.01, ropeDark, HX, wrapTop + 0.01, 0);
  ring(0.049, 0.01, ropeDark, HX, wrapBot - 0.01, 0);
  add(new T.SphereGeometry(0.017, 7, 5), ropeDark, HX + 0.05, wrapTop + 0.008, 0.0);

  // ---------- 9. dangling cord + spare coil ----------
  const cordCurve = new T.CatmullRomCurve3([
    new T.Vector3(HX + 0.055, wrapTop + 0.004, 0.0),
    new T.Vector3(HX + 0.08, wrapTop - 0.04, 0.01),
    new T.Vector3(HX + 0.1, wrapTop - 0.1, 0.02),
    new T.Vector3(HX + 0.12, -0.27, 0.025),
  ]);
  add(new T.TubeGeometry(cordCurve, 16, 0.007, 5, false), rope);
  const coil = ring(0.04, 0.011, rope, HX + 0.13, -0.305, 0.03, 0.25, Math.PI / 2 - 0.3, 0.15);
  coil.geometry = new T.TorusGeometry(0.04, 0.011, 5, 16);
  ring(0.014, 0.006, ropeDark, HX + 0.125, -0.268, 0.028, Math.PI / 2, 0, 0.2, 10);

  // Built as ~30 small parts, merged below into one mesh per material.

  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const center = box.getCenter(new T.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new T.Vector3());
  // Static parts never move relative to each other: one draw call per material (8), merged after the
  // re-center so the bounds/grip math above sees the original parts.
  mergeChildMeshes(T, inner);
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.orientation = 'handle -Y, hook point +Y, hook bend leans toward -Z (front), bend opens to -X';
  return root;
}
