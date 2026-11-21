// Held bamboo fishing rod (first-person). Original procedural model, ES module, no textures.
// Usage: import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b'; const rod = createFishingTool(THREE);
//
// Model space (root at origin, rod axis on the Y axis, x = z = 0):
//   butt cap  y = -0.75 ... tip top y = +0.75  (rod length 1.5, long axis +Y)
//   wooden handle y -0.73..-0.40, brass ferrule, warm bamboo blank with nodes up to the tip.
//   Reel, guides and line sit on the +Z side of the blank (the side facing the player when the
//   tool is held in front of the camera with the tip leaning forward / up-left).
//   A short leader hangs from the tip to a red/cream float (root.userData.float).
//
// userData:
//   grip        Vector3  hand grip point on the handle (model space)
//   gripNode    Object3D same point as a child node (for getWorldPosition)
//   tip         Vector3  rod tip / line exit point
//   tipNode     Object3D same point as a child node
//   gripAxis    Vector3  unit rod axis (+Y, butt -> tip)
//   float       Group    float (hide while the line is cast out)
//   leader      Mesh     tip -> float line (hide while cast out)
//   rodLine     Mesh     reel -> guides -> tip line (always visible)
//   reelSpool   Mesh     spool (rotate .rotation.x to animate reeling; axis is model X)
//   size        {x,y,z}  approximate bounds
//   meshCount   number   (15: static brass / steel parts on the root are merged per material)
//   dispose()   frees all owned geometries and materials
import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

export function createFishingTool(T) {
  const root = new T.Group();
  root.name = 'fishingRod';

  const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const V2 = (x, y) => new T.Vector2(x, y);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const geos = [], mats = [];
  let meshCount = 0;
  const G = (g) => { geos.push(g); return g; };
  const M = (opts) => { const m = new T.MeshStandardMaterial({ metalness: 0, ...opts }); mats.push(m); return m; };
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => {
    const m = new T.Mesh(G(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
    parent.add(m); meshCount++;
    return m;
  };
  // per-vertex color pass: fn(x, y, z, angle, outColor)
  const colorize = (geo, fn) => {
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      fn(x, y, z, Math.atan2(z, x), c);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    return geo;
  };

  // ---------------- materials (owned by this tool) ----------------
  const bambooMat = M({ color: 0xffffff, vertexColors: true, roughness: 0.6 });
  const handleMat = M({ color: 0xffffff, vertexColors: true, roughness: 0.82 });
  const spoolMat = M({ color: 0xffffff, vertexColors: true, roughness: 0.78 });
  const threadMat = M({ color: 0x35211a, roughness: 0.9 });
  const brassMat = M({ color: 0xb08a4a, metalness: 0.7, roughness: 0.38 });
  const steelMat = M({ color: 0x9ba5a7, metalness: 0.8, roughness: 0.3 });
  const knobMat = M({ color: 0x6b4226, roughness: 0.7 });
  const lineMat = M({ color: 0xf0e8d4, roughness: 0.6 });
  const floatRedMat = M({ color: 0xc8352b, roughness: 0.42 });
  const floatCreamMat = M({ color: 0xf0e4c6, roughness: 0.5 });
  const pinMat = M({ color: 0x2b2420, roughness: 0.55 });

  // ---------------- dimensions ----------------
  const Y0 = -0.385, Y1 = 0.737;          // bamboo blank (bottom sits inside the ferrule)
  const R0 = 0.0175, R1 = 0.0055;          // blank radius at butt / tip
  const rAt = (y) => R0 + (R1 - R0) * clamp01((y - Y0) / (Y1 - Y0));
  const NODES = [-0.25, -0.05, 0.11, 0.25, 0.39, 0.52, 0.61, 0.70];
  const GUIDES = [-0.15, 0.19, 0.33, 0.46, 0.66];
  const RING_R = [0.015, 0.012, 0.010, 0.0085, 0.007];
  const STEM = [0.013, 0.011, 0.009, 0.008, 0.007];
  const RY = -0.30;                        // reel center height
  const CZ = 0.06;                         // reel spool axis offset (+Z)

  // ---------- 1. bamboo blank: lathe with swollen nodes, warm vertex colors ----------
  {
    const nodeBulge = (y) => {
      let b = 0;
      for (const n of NODES) { const d = (y - n) / 0.0032; b = Math.max(b, Math.exp(-d * d)); }
      return 1 + 0.14 * b;
    };
    const ys = [];
    for (let y = Y0; y < Y1; y += 0.015) ys.push(y);
    for (const n of NODES) for (const o of [-0.009, -0.0045, -0.0018, 0, 0.0018, 0.0045, 0.009]) ys.push(n + o);
    ys.push(Y1);
    ys.sort((a, b) => a - b);
    const pts = [V2(0, Y0)];
    let last = -1;
    for (const y of ys) { if (y - last < 0.0006) continue; last = y; pts.push(V2(rAt(y) * nodeBulge(y), y)); }
    pts.push(V2(0, Y1));
    const geo = new T.LatheGeometry(pts, 10);
    const base = new T.Color(0xd8ae62), gold = new T.Color(0xe6c47c), dark = new T.Color(0x7a5528), burn = new T.Color(0xa5763a);
    colorize(geo, (x, y, z, a, c) => {
      // section index -> slight tone shift per internode
      let sec = 0; for (const n of NODES) if (y > n) sec++;
      const tone = 0.5 + 0.5 * Math.sin(sec * 2.3 + 1.1);
      c.copy(base).lerp(gold, tone * 0.45 + 0.25 * clamp01((y - Y0) / (Y1 - Y0)));
      // fine lengthwise fibers
      const fiber = 0.5 + 0.5 * Math.sin(a * 13 + Math.sin(y * 23) * 2.0);
      c.lerp(burn, fiber * 0.16);
      // dark node rings with a short scorched fade beneath each node
      let nd = 1;
      for (const n of NODES) {
        const d = y - n;
        const ring = Math.exp(-(d / 0.0035) * (d / 0.0035));
        const fade = d < 0 && d > -0.03 ? (1 + d / 0.03) * 0.35 : 0;
        nd = Math.min(nd, 1 - Math.max(ring * 0.8, fade));
      }
      c.lerp(dark, 1 - nd);
    });
    add(geo, bambooMat);
  }

  // ---------- 2. wooden handle (lathe, carved grip rings, grain colors) ----------
  {
    const hb = -0.73, ht = -0.40;
    const pts = [V2(0, hb)];
    for (let i = 0; i <= 33; i++) {
      const y = hb + (ht - hb) * (i / 33), t = i / 33;
      let r = 0.0235 + 0.0035 * Math.sin(Math.PI * clamp01(t * 1.25)) - 0.003 * t;
      for (const g of [-0.69, -0.44]) { const d = (y - g) / 0.004; r -= 0.0022 * Math.exp(-d * d); }
      pts.push(V2(r, y));
    }
    pts.push(V2(0.019, ht), V2(0, ht));
    const geo = new T.LatheGeometry(pts, 14);
    const base = new T.Color(0x8a5a30), dk = new T.Color(0x553319), lt = new T.Color(0xa87444);
    colorize(geo, (x, y, z, a, c) => {
      const grain = 0.5 + 0.5 * Math.sin(a * 7 + Math.sin(y * 31) * 1.8 + y * 9);
      const ring = 0.5 + 0.5 * Math.sin(y * 210 + a * 2);
      c.copy(base).lerp(dk, grain * 0.4).lerp(lt, ring * 0.18);
      // hand-polished darker grip zone
      const gd = (y + 0.56) / 0.07;
      const gz = Math.exp(-gd * gd);
      c.lerp(dk, gz * 0.18);
    });
    add(geo, handleMat);
  }

  // ---------- 3. brass butt cap ----------
  add(new T.CylinderGeometry(0.0235, 0.022, 0.02, 14), brassMat, 0, -0.74, 0);
  // ---------- 4. brass ferrule between handle and blank ----------
  add(new T.CylinderGeometry(0.0205, 0.0215, 0.03, 14), brassMat, 0, -0.385, 0);
  // ---------- 5. tip top ----------
  add(new T.CylinderGeometry(0.0042, 0.0058, 0.016, 8), steelMat, 0, 0.741, 0);

  // ---------- 6. dark thread wraps (instanced: guides, ferrule, reel bands) ----------
  {
    const wraps = [];
    GUIDES.forEach((y, i) => wraps.push([y, rAt(y) + 0.0016, 0.022 - i * 0.002]));
    wraps.push([-0.36, rAt(-0.36) + 0.0016, 0.016]);
    wraps.push([RY - 0.032, 0.0265, 0.01]);   // reel bands over the reel foot
    wraps.push([RY + 0.032, 0.0265, 0.01]);
    const im = new T.InstancedMesh(G(new T.CylinderGeometry(1, 1, 1, 12)), threadMat, wraps.length);
    const o = new T.Object3D();
    wraps.forEach(([y, r, h], i) => { o.position.set(0, y, 0); o.scale.set(r, h, r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
    root.add(im); meshCount++;
  }

  // ---------- 7-8. line guides: steel rings + stems (instanced) ----------
  const guideCenters = [];
  {
    const n = GUIDES.length;
    const rings = new T.InstancedMesh(G(new T.TorusGeometry(1, 0.16, 6, 16)), steelMat, n);
    const stems = new T.InstancedMesh(G(new T.CylinderGeometry(1, 1, 1, 6)), steelMat, n);
    const o = new T.Object3D();
    GUIDES.forEach((y, i) => {
      const r = rAt(y), zc = r + STEM[i] + RING_R[i];
      guideCenters.push(V3(0, y, zc));
      o.position.set(0, y, zc); o.rotation.set(Math.PI / 2, 0, 0); o.scale.setScalar(RING_R[i]);
      o.updateMatrix(); rings.setMatrixAt(i, o.matrix);
      const z0 = r - 0.002, z1 = r + STEM[i] + 0.001;
      o.position.set(0, y, (z0 + z1) / 2); o.rotation.set(Math.PI / 2, 0, 0); o.scale.set(0.0018, z1 - z0, 0.0018);
      o.updateMatrix(); stems.setMatrixAt(i, o.matrix);
    });
    for (const im of [rings, stems]) {
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
      root.add(im); meshCount++;
    }
  }

  // ---------- 9. reel frame plate: foot + pillar + round side plate (one extrusion) ----------
  {
    const z0 = 0.017, z1 = 0.025, L = 0.04, w = 0.009, PR = 0.026;
    const c = Math.sqrt(PR * PR - w * w), a = Math.atan2(w, c);
    const s = new T.Shape();
    s.moveTo(z0, -L); s.lineTo(z1, -L); s.lineTo(z1, -w); s.lineTo(CZ - c, -w);
    s.absarc(CZ, 0, PR, -Math.PI + a, Math.PI - a, false);
    s.lineTo(z1, w); s.lineTo(z1, L); s.lineTo(z0, L); s.lineTo(z0, -L);
    const geo = new T.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: 14 });
    geo.translate(0, 0, -0.002);
    geo.rotateY(-Math.PI / 2);             // shape X -> model Z, extrusion -> model X
    add(geo, steelMat, -0.021, RY, 0);
  }

  // ---------- 10. wooden spool with wound line (lathe, axis along model X) ----------
  let spool;
  {
    const pts = [V2(0, -0.018), V2(0.032, -0.018), V2(0.032, -0.0145), V2(0.0241, -0.0132)];
    for (let i = 0; i <= 12; i++) {
      const y = -0.013 + 0.026 * (i / 12);
      pts.push(V2(0.024 + (i % 2 ? 0.0004 : 0), y));
    }
    pts.push(V2(0.0241, 0.0132), V2(0.032, 0.0145), V2(0.032, 0.018), V2(0, 0.018));
    const geo = new T.LatheGeometry(pts, 18);
    const wood = new T.Color(0x9a6638), woodDk = new T.Color(0x6a4222), line = new T.Color(0xe9e0c8);
    colorize(geo, (x, y, z, a, c) => {
      const rad = Math.hypot(x, z);
      if (Math.abs(y) < 0.01305 && rad < 0.0246) {
        c.copy(line).multiplyScalar(0.9 + 0.1 * Math.sin(y * 1500));
      } else {
        // flange faces: radial spoke-like grain, darker rim
        c.copy(wood).lerp(woodDk, 0.3 + 0.3 * Math.sin(a * 6) * (rad / 0.032) + (rad > 0.03 ? 0.25 : 0));
      }
    });
    geo.rotateZ(Math.PI / 2);              // lathe Y -> model X
    spool = add(geo, spoolMat, 0, RY, CZ);
    spool.name = 'reelSpool';
  }

  // ---------- 11-12. crank arm + wooden knob on the spool face ----------
  // children of the spool so they turn with it when reeling is animated
  {
    const arm = add(new T.BoxGeometry(0.004, 0.026, 0.006), steelMat, 0.0195, -0.012, 0, spool);
    arm.name = 'crankArm';
    const knob = add(new T.CylinderGeometry(0.0042, 0.0048, 0.016, 10), knobMat, 0.0295, -0.023, 0, spool);
    knob.rotation.z = Math.PI / 2;
  }

  // ---------- 13. line: spool -> guides -> tip ----------
  const tipPoint = V3(0, 0.749, 0);
  let rodLine;
  {
    const path = new T.CurvePath();
    const pts = [V3(0, RY + 0.0242, CZ), ...guideCenters, tipPoint];
    for (let i = 0; i < pts.length - 1; i++) path.add(new T.LineCurve3(pts[i], pts[i + 1]));
    rodLine = add(new T.TubeGeometry(path, 96, 0.0011, 4, false), lineMat);
    rodLine.name = 'rodLine';
  }

  // ---------- 14-17. leader + float (red top, cream belly, dark pin) ----------
  const FX = 0.055, FY = 0.40, FZ = 0.035, PIN_TOP = 0.0475;
  const float = new T.Group();
  float.name = 'float';
  float.position.set(FX, FY, FZ);
  root.add(float);
  add(new T.SphereGeometry(0.02, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), floatRedMat, 0, 0, 0, float);
  const belly = add(new T.SphereGeometry(0.02, 14, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), floatCreamMat, 0, 0, 0, float);
  belly.scale.y = 1.5;
  add(new T.CylinderGeometry(0.0022, 0.0016, 0.085, 6), pinMat, 0, 0.005, 0, float);

  let leader;
  {
    const end = V3(FX, FY + PIN_TOP, FZ);
    const curve = new T.QuadraticBezierCurve3(tipPoint.clone(), V3(FX * 0.9, 0.6, FZ * 0.9), end);
    leader = add(new T.TubeGeometry(curve, 24, 0.0011, 4, false), lineMat);
    leader.name = 'leader';
  }

  // ---------- merge static unnamed parts sharing a material (brass caps, steel tip top + reel plate) ----------
  for (const m of mergeChildMeshes(T, root, { skip: (c) => !!c.name })) G(m.geometry);
  meshCount = 0; root.traverse((o) => { if (o.isMesh) meshCount++; });

  // ---------- reference nodes ----------
  const grip = V3(0, -0.56, 0);
  const gripNode = new T.Object3D(); gripNode.name = 'grip'; gripNode.position.copy(grip); root.add(gripNode);
  const tipNode = new T.Object3D(); tipNode.name = 'rodTip'; tipNode.position.copy(tipPoint); root.add(tipNode);

  // Every part is rigid in the model; only the root, the float (game.js re-uses it as the bobber) and the
  // spool (animatable, see above) keep per-frame matrix updates.
  root.traverse((o) => { if (o !== root && o !== float && o !== spool) { o.updateMatrix(); o.matrixAutoUpdate = false; } });

  root.userData.grip = grip;
  root.userData.gripNode = gripNode;
  root.userData.gripAxis = V3(0, 1, 0);
  root.userData.tip = tipPoint.clone();
  root.userData.tipNode = tipNode;
  root.userData.float = float;
  root.userData.leader = leader;
  root.userData.rodLine = rodLine;
  root.userData.reelSpool = spool;
  root.userData.size = { x: 0.10, y: 1.5, z: 0.12 };
  root.userData.meshCount = meshCount;
  root.userData.orientation =
    'rod axis +Y (butt -Y, tip +Y), centered at origin; reel/guides/line on +Z side; float hangs +X/+Z below tip';
  root.userData.dispose = () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); };
  return root;
}
