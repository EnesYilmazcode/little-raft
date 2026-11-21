// Held scrap hook model (first-person). ES module.
// Usage: import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b'; const g = createHook(THREE);
// Group is re-centered on its bounding box: ~0.70 wide (X), ~0.84 tall (Y), ~0.40 deep (Z).
// Handle at bottom (-Y), curved hook with point at top (+Y), hook bend leans toward -Z (front).
export function createHook(T) {
  const root = new T.Group();
  root.name = 'scrapHook';
  const inner = new T.Group();
  root.add(inner);

  // ---------- materials ----------
  const steel = new T.MeshStandardMaterial({ color: 0x8ca8ac, metalness: 0.7, roughness: 0.3 });
  const darkSteel = new T.MeshStandardMaterial({ color: 0x5f7376, metalness: 0.75, roughness: 0.45 });
  const rivetMat = new T.MeshStandardMaterial({ color: 0xa9b8b4, metalness: 0.8, roughness: 0.35 });
  const wood = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.9 });
  const rope = new T.MeshStandardMaterial({ color: 0xb89a64, metalness: 0.0, roughness: 0.95 });
  const ropeDark = new T.MeshStandardMaterial({ color: 0x8f7447, metalness: 0.0, roughness: 1.0 });

  const HX = 0.2; // handle axis X
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    inner.add(m);
    return m;
  };

  // ---------- 1. curved steel hook ----------
  const pts = [
    [HX, -0.08, 0.0],
    [HX, 0.12, -0.01],
    [0.17, 0.27, -0.05],
    [0.06, 0.38, -0.12],
    [-0.1, 0.40, -0.2],
    [-0.25, 0.34, -0.26],
    [-0.34, 0.20, -0.28],
    [-0.33, 0.06, -0.25],
    [-0.24, 0.00, -0.2],
    [-0.15, 0.04, -0.16],
    [-0.11, 0.11, -0.13],
  ].map(p => new T.Vector3(p[0], p[1], p[2]));
  const curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
  const R = 0.022;
  add(new T.TubeGeometry(curve, 96, R, 12, false), steel);

  // ---------- 2. tapered point (aimed along curve end tangent) ----------
  const up = new T.Vector3(0, 1, 0);
  const endP = curve.getPoint(1);
  const endT = curve.getTangent(1).normalize();
  const tipLen = 0.075;
  const tip = add(new T.ConeGeometry(R, tipLen, 12), steel);
  tip.quaternion.setFromUnitVectors(up, endT);
  tip.position.copy(endP).addScaledVector(endT, tipLen / 2);

  // ---------- 3. barb (small back-swept spur near the point) ----------
  const barbP = curve.getPoint(0.97);
  const barbT = curve.getTangent(0.97).normalize();
  // outward = away from the hook bend center
  const bendCenter = new T.Vector3(-0.18, 0.2, -0.2);
  const outward = barbP.clone().sub(bendCenter);
  outward.addScaledVector(barbT, -outward.dot(barbT)).normalize();
  const barbDir = barbT.clone().multiplyScalar(-0.75).addScaledVector(outward, 0.66).normalize();
  const barbLen = 0.05;
  const barb = add(new T.ConeGeometry(0.011, barbLen, 8), steel);
  barb.quaternion.setFromUnitVectors(up, barbDir);
  barb.position.copy(barbP).addScaledVector(outward, R * 0.6).addScaledVector(barbDir, barbLen / 2 - 0.01);

  // ---------- 4. steel ferrule/collar where hook enters handle ----------
  const ferruleY = -0.09;
  add(new T.CylinderGeometry(0.05, 0.053, 0.075, 16), darkSteel, HX, ferruleY, 0);

  // ---------- 5-8. rivets on ferrule (4 around) ----------
  const rivetGeo = new T.SphereGeometry(0.011, 8, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(rivetGeo, rivetMat, HX + Math.cos(a) * 0.052, ferruleY + (i % 2 ? 0.015 : -0.015), Math.sin(a) * 0.052);
  }

  // ---------- 9. weathered wooden handle (vertex-colored, slightly irregular) ----------
  const handleTop = -0.125, handleBot = -0.39;
  const hLen = handleTop - handleBot;
  const hGeo = new T.CylinderGeometry(0.042, 0.046, hLen, 14, 10);
  {
    const pos = hGeo.attributes.position;
    const cols = [];
    const base = new T.Color(0x8a6a45), grey = new T.Color(0x9b9282), dark = new T.Color(0x5c4329);
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ang = Math.atan2(z, x);
      // gentle dents / uneven whittled surface
      const bump = 1 + 0.035 * Math.sin(ang * 5 + y * 30) + 0.02 * Math.sin(ang * 11 - y * 55);
      pos.setX(i, x * bump);
      pos.setZ(i, z * bump);
      // grain streaks + sun-greyed weathering
      const grain = 0.5 + 0.5 * Math.sin(ang * 9 + Math.sin(y * 40) * 1.5);
      const weather = 0.5 + 0.5 * Math.sin(y * 17 + ang * 2);
      c.copy(base).lerp(dark, grain * 0.45).lerp(grey, weather * 0.35);
      cols.push(c.r, c.g, c.b);
    }
    hGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    hGeo.computeVertexNormals();
  }
  add(hGeo, wood, HX, (handleTop + handleBot) / 2, 0);

  // ---------- 10. pommel end cap ----------
  add(new T.CylinderGeometry(0.044, 0.04, 0.025, 14), darkSteel, HX, handleBot - 0.0125, 0);

  // ---------- 11. rope wrap (helix grip) ----------
  class Helix extends T.Curve {
    constructor(y0, y1, r, turns) { super(); this.y0 = y0; this.y1 = y1; this.r = r; this.turns = turns; }
    getPoint(t, out = new T.Vector3()) {
      const a = t * this.turns * Math.PI * 2;
      return out.set(HX + Math.cos(a) * this.r, this.y0 + (this.y1 - this.y0) * t, Math.sin(a) * this.r);
    }
  }
  const wrapTop = -0.17, wrapBot = -0.33;
  add(new T.TubeGeometry(new Helix(wrapBot, wrapTop, 0.048, 9), 360, 0.0075, 6, false), rope);

  // ---------- 12-13. tied rope bands at wrap ends ----------
  const band = new T.TorusGeometry(0.05, 0.009, 6, 20);
  add(band, ropeDark, HX, wrapTop + 0.008, 0).rotation.x = Math.PI / 2;
  add(band, ropeDark, HX, wrapBot - 0.008, 0).rotation.x = Math.PI / 2;

  // ---------- 14. knot on top band ----------
  add(new T.SphereGeometry(0.016, 8, 6), ropeDark, HX + 0.052, wrapTop + 0.006, 0.0);

  // ---------- 15. dangling cord from knot ----------
  const cordCurve = new T.CatmullRomCurve3([
    new T.Vector3(HX + 0.055, wrapTop + 0.004, 0.0),
    new T.Vector3(HX + 0.08, wrapTop - 0.04, 0.01),
    new T.Vector3(HX + 0.1, wrapTop - 0.1, 0.02),
    new T.Vector3(HX + 0.12, -0.27, 0.025),
  ]);
  add(new T.TubeGeometry(cordCurve, 24, 0.006, 6, false), rope);

  // ---------- 16. small coil of spare cord hanging from it ----------
  const coil = add(new T.TorusGeometry(0.04, 0.01, 6, 20), rope, HX + 0.13, -0.305, 0.03);
  coil.rotation.set(0.25, Math.PI / 2 - 0.3, 0.15);
  // ---------- 17. wrap binding on the coil ----------
  const bind = add(new T.TorusGeometry(0.013, 0.006, 6, 12), ropeDark, HX + 0.125, -0.268, 0.028);
  bind.rotation.set(Math.PI / 2, 0, 0.2);

  // ---------- 18. small steel lashing collar on shank (scrap repair look) ----------
  const lash = add(new T.TorusGeometry(R + 0.006, 0.006, 6, 16), darkSteel, HX, 0.05, -0.006);
  lash.rotation.x = Math.PI / 2;

  // Meshes: hook, tip, barb, ferrule, 4 rivets, handle, pommel, wrap, 2 bands, knot, cord, coil, bind, lash = 19

  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const center = box.getCenter(new T.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new T.Vector3());
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.orientation = 'handle -Y, hook point +Y, hook bend leans toward -Z (front), bend opens to -X';
  return root;
}
