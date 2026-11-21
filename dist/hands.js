// First-person viewmodel hands (original procedural meshes, no textures). ES module.
// Usage:
//   import { createHands } from './hands.js?build=v3-survival-ae77fa84ac2b';
//   const hands = createHands(THREE, createHook(THREE));
//   camera.add(hands.group);              // camera must be in the scene
//   hands.update({ dt, time, charge, reeling, casting, walking, hasHookOut, motion });
//   hands.handTip.getWorldPosition(v);    // rope anchor (left hand / coil; the left arm is parked off-screen
//                                         // until the hook is out or reeling, the anchor keeps working)
//
// Static parts under each animated node (frame, hand, spool) are merged into one vertex-colored mesh
// per material after building, so the viewmodel costs ~8 draw calls of its own.
//
// Coordinate convention: group sits at the camera origin, camera looks down -Z, +Y up, +X right.
// Right fist grips the hook's lower handle near (0.38,-0.32,-0.80); left fist holds a rope coil
// near (-0.34,-0.35,-0.70). Each arm is posed ABSOLUTELY every frame (base + offsets computed from
// time / charge / casting and exponentially smoothed weights), so nothing accumulates or drifts.

import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

export function createHands(T, hookModel) {
  const TOOL_SCALE = 0.55;             // createHook() model (~.72 x .84 x .38) -> ~.40 x .46 x .21
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const DEG = Math.PI / 180;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOutBack = (x) => { const c = 1.6, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

  const root = new T.Group();
  root.name = 'fpHands';
  root.userData.orientation =
    'Attach to camera (origin, looking -Z, +Y up). Right fist grips hook lower handle at ~(.38,-.32,-.80); ' +
    'left fist holds rope coil at ~(-.34,-.35,-.70). Arm frames: local X = back of hand, Y = grip axis ' +
    '(thumb side), Z = toward wrist/forearm. Left arm geometry is the right arm mirrored (scale.x = -1).';

  // ---------------- materials (own) ----------------
  const geos = [], mats = [];
  const mat = (color, roughness, extra = {}) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    mats.push(m); return m;
  };
  const skin = mat(0xc89068, 0.62, { emissive: 0x1c0e06 });
  const skinPalm = mat(0xc08562, 0.66, { emissive: 0x1a0c05 });
  const crease = mat(0x8e5a3c, 0.8);
  const sleeveMat = mat(0x52705e, 0.95);
  const cuffMat = mat(0x3e5648, 0.95);
  const ropeMat = mat(0xb89a64, 0.95);
  const ropeDarkMat = mat(0x8a6e44, 1.0);
  // merge targets: white vertex-colored materials that take each part's color from its build material
  const skinV = mat(0xffffff, 0.62, { emissive: 0x1c0e06, vertexColors: true });
  const clothV = mat(0xffffff, 0.95, { vertexColors: true });
  const ropeV = mat(0xffffff, 0.95, { vertexColors: true });
  const mergeInto = new Map([[skin, skinV], [skinPalm, skinV], [crease, skinV], [sleeveMat, clothV], [cuffMat, clothV], [ropeMat, ropeV], [ropeDarkMat, ropeV]]);

  const finish = (m) => { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; return m; };
  const G = (g) => { geos.push(g); return g; };

  // Tapered capsule along +Y, cap centers at -L/2 (radius r0) and +L/2 (radius r1).
  const taperGeo = (r0, r1, L, radial = 10, cap = 4) => {
    const pts = [];
    for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / cap); pts.push(new T.Vector2(Math.max(1e-5, r0 * Math.cos(a)), -L / 2 + r0 * Math.sin(a))); }
    for (let i = 0; i <= cap; i++) { const a = (Math.PI / 2) * (i / cap); pts.push(new T.Vector2(Math.max(1e-5, r1 * Math.cos(a)), L / 2 + r1 * Math.sin(a))); }
    return G(new T.LatheGeometry(pts, radial));
  };
  const seg = (parent, m, a, b, r0, r1, radial) => {
    const d = b.clone().sub(a); const L = d.length();
    const mesh = finish(new T.Mesh(taperGeo(r0, r1, L, radial), m));
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    parent.add(mesh); return mesh;
  };
  const sphereGeo = G(new T.SphereGeometry(1, 16, 12));
  const ellipsoid = (parent, m, p, rx, ry, rz, rotY = 0) => {
    const mesh = finish(new T.Mesh(sphereGeo, m));
    mesh.position.copy(p); mesh.scale.set(rx, ry, rz); mesh.rotation.y = rotY;
    parent.add(mesh); return mesh;
  };

  // Tube with a per-point radius along a polyline (smooth normals, uv so it merges with the lathe parts).
  const tubeGeo = (pts, radii, radial = 10) => {
    const n = pts.length, pos = [], uv = [], idx = [];
    const t = V(), nrm = V(), bin = V(), ref = V(0, 1, 0);
    for (let i = 0; i < n; i++) {
      t.copy(pts[Math.min(i + 1, n - 1)]).sub(pts[Math.max(i - 1, 0)]).normalize();
      nrm.crossVectors(ref, t); if (nrm.lengthSq() < 1e-8) nrm.set(1, 0, 0); nrm.normalize();
      bin.crossVectors(t, nrm).normalize();
      for (let k = 0; k <= radial; k++) {
        const th = (k / radial) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        pos.push(pts[i].x + (nrm.x * c + bin.x * sn) * radii[i], pts[i].y + (nrm.y * c + bin.y * sn) * radii[i], pts[i].z + (nrm.z * c + bin.z * sn) * radii[i]);
        uv.push(k / radial, i / (n - 1));
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return G(g);
  };
  const tube = (parent, m, pts, radii, radial) => {
    parent.add(finish(new T.Mesh(tubeGeo(pts, radii, radial), m)));
    ellipsoid(parent, m, pts[0], radii[0], radii[0], radii[0]);                       // round both ends
    const e = pts.length - 1; ellipsoid(parent, m, pts[e], radii[e], radii[e], radii[e]);
  };

  // ---------------- fist (right-hand layout; mirrored for left) ----------------
  // Grip axis = local Y through origin, gripR = radius of the gripped object.
  // Angles a go round the grip: 0 = +X (back of hand side), 90 = -Z (front), 180 = -X, 270 = +Z (wrist side).
  // Each finger is one smooth curled tube that hugs the grip from its knuckle (a ~0) round the front to a tip
  // tucked in at the rear-left (a ~205), where the thumb-ball pad meets it; the palm closes the rear-right, and
  // the thumb comes up off the pad and lies across the index finger. So the grip is enclosed all the way round.
  // Returns the wrist point.
  function buildFist(parent, gripR) {
    const k = (gripR + 0.010) / 0.042;           // scale of palm/thumb placement to grip size
    const P = (aDeg, R, y) => V(R * Math.cos(aDeg * DEG), y, -R * Math.sin(aDeg * DEG));
    // palm / back of hand (rear-right) + thumb-ball pad (rear-left, where the fingertips tuck in)
    ellipsoid(parent, skin, V(0.020 * k, -0.002, 0.040 * k), 0.028 * k, 0.050, 0.036 * k, -0.35);
    // thumb-ball pad: lies over the near face of the grip and hides the tucked fingertips
    const pad = (a, R, y, rt, ry, rr) => ellipsoid(parent, skinPalm, P(a, R, y), rt, ry, rr, (a + 90) * DEG);
    pad(250, gripR + 0.014, -0.012, 0.024 * k, 0.040, 0.016 * k);
    pad(226, gripR + 0.019, 0.004, 0.022 * k, 0.034, 0.013 * k);
    const fingers = [
      { y: 0.028, r: 0.0106, a0: 4, a1: 214 },   // index (lies under the thumb)
      { y: 0.007, r: 0.0112, a0: -2, a1: 228 },  // middle
      { y: -0.014, r: 0.0106, a0: -8, a1: 226 }, // ring
      { y: -0.033, r: 0.0094, a0: -16, a1: 218 },// pinky
    ];
    const N = 18;
    fingers.forEach((f, i) => {
      const pts = [], radii = [];
      for (let j = 0; j <= N; j++) {
        const t = j / N, a = f.a0 + (f.a1 - f.a0) * t;
        const bump = 1 + 0.10 * Math.exp(-(((t - 0.40) / 0.05) ** 2)) + 0.07 * Math.exp(-(((t - 0.72) / 0.045) ** 2)); // PIP / DIP knuckles
        const r = f.r * (1.06 - 0.22 * t) * bump;
        const R = gripR + f.r * 0.92 + 0.004 * (1 - smooth(0, 0.25, t)) - 0.0015 * smooth(0.8, 1, t); // knuckle clears, tip presses in
        pts.push(P(a, R, f.y + 0.002 * Math.sin(t * Math.PI) * (i === 0 ? 1 : -0.5)));
        radii.push(r);
      }
      tube(parent, skin, pts, radii, 10);
      ellipsoid(parent, skin, P(f.a0 - 4, gripR + f.r * 1.15, f.y), f.r * 1.2, f.r * 1.05, f.r * 1.1);  // MCP knuckle
    });
    // thumb: rises off the pad at the rear-left, lies across the top of the curled index, tip at the front-left
    {
      const pts = [], radii = [];
      const key = [[268, gripR + 0.018, -0.004, 0.0150], [245, gripR + 0.024, 0.022, 0.0138], [212, gripR + 0.026, 0.034, 0.0126], [182, gripR + 0.024, 0.034, 0.0114], [160, gripR + 0.019, 0.029, 0.0100]];
      const curve = new T.CatmullRomCurve3(key.map(([a, R, y]) => P(a, R, y)));
      for (let j = 0; j <= 14; j++) {
        const t = j / 14; pts.push(curve.getPoint(t));
        const s = t * (key.length - 1), i0 = Math.min(key.length - 2, Math.floor(s));
        radii.push(key[i0][3] + (key[i0 + 1][3] - key[i0][3]) * (s - i0));
      }
      tube(parent, skin, pts, radii, 10);
    }
    return V(0.020 * k, -0.006, 0.080 * k);
  }

  // ---------------- arm builder ----------------
  // u = grip axis (camera space), F = forearm direction wrist->elbow (camera space).
  function buildArm({ name, basePos, u, F, gripR, mirror }) {
    u = u.clone().normalize(); F = F.clone().normalize();
    const f = F.clone().addScaledVector(u, -F.dot(u)).normalize();
    const r = V().crossVectors(u, f).normalize();
    const qBase = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r, u, f));
    const toLocal = (v) => V(v.dot(r) * (mirror ? -1 : 1), v.dot(u), v.dot(f));

    const pose = new T.Group(); pose.name = name;
    const frame = new T.Group(); frame.scale.x = mirror ? -1 : 1;
    pose.add(frame);
    const wrist = new T.Group();
    const hand = new T.Group();
    frame.add(wrist); wrist.add(hand);
    const W = buildFist(hand, gripR);
    wrist.position.copy(W); hand.position.copy(W).negate();

    const Fl = toLocal(F).normalize();
    const at = (s) => W.clone().addScaledVector(Fl, s);
    seg(frame, skin, at(0), at(0.27), 0.026, 0.036, 12);           // forearm
    seg(frame, cuffMat, at(0.20), at(0.235), 0.041, 0.043, 14);    // rolled cuff
    seg(frame, sleeveMat, at(0.24), at(0.56), 0.044, 0.060, 14);   // sleeve (runs off-screen)

    return { pose, frame, wrist, hand, qBase, toLocal, basePos: basePos.clone(), u, f, r };
  }

  // A tool may say how big it wants to be in hand (userData.viewScale) and how thick its grip is (userData.gripRadius,
  // model units); the right fist is then built to that exact radius so the fingers sit on the grip surface.
  const ud = (hookModel && hookModel.userData) || {};
  const viewScale = TOOL_SCALE * (ud.viewScale || 1);
  const gripRight = ud.gripRadius ? ud.gripRadius * viewScale : 0.032;
  const R = buildArm({ name: 'rightArm', basePos: V(0.38, -0.32, -0.80), u: V(0.27, 0.95, -0.15), F: V(0.35, -0.50, 1.0), gripR: gripRight, mirror: false });
  const L = buildArm({ name: 'leftArm', basePos: V(-0.34, -0.35, -0.70), u: V(0.85, 0.30, 0.10), F: V(-0.40, -0.50, 1.0), gripR: 0.028, mirror: true });
  root.add(R.pose, L.pose);

  // ---------------- tool (supplied hook) ----------------
  const toolHolder = new T.Group(); toolHolder.name = 'toolHolder';
  R.hand.add(toolHolder);
  {
    const D = V(-0.94, 0.0, -0.34).normalize();                // hook bend opens forward-left
    const Dl = R.toLocal(D);
    toolHolder.rotation.y = Math.atan2(Dl.z, -Dl.x);
  }
  // handle axis in model space: x=.2, z=0 in createHook's inner group (inner is re-centered)
  const handleLocal = V(0.19, -0.272, 0.11);
  const inner = hookModel && hookModel.children && hookModel.children[0];
  if (inner && hookModel.userData && hookModel.userData.size) handleLocal.set(0.2 + inner.position.x, -0.27 + inner.position.y, inner.position.z);
  const toolOffset = handleLocal.clone().multiplyScalar(-viewScale);
  const savedFlags = [];
  if (hookModel) {
    toolHolder.add(hookModel);
    hookModel.traverse((o) => { if (o.isMesh) { savedFlags.push([o, o.castShadow, o.frustumCulled]); o.castShadow = false; o.frustumCulled = false; } });
  }

  // ---------------- rope coil + lead (left hand) ----------------
  const coil = new T.Group(); coil.name = 'ropeCoil';
  L.hand.add(coil);
  const qCoilBase = new T.Quaternion();
  {
    const d = L.toLocal(V(0, -1, 0));
    const X = V(0, 1, 0);
    const Y = d.clone().addScaledVector(X, -d.dot(X)).negate().normalize(); // "up" perpendicular to grip axis
    const Z = V().crossVectors(X, Y);
    qCoilBase.setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z));
  }
  const COIL_R = 0.068;
  const spool = new T.Group(); spool.position.set(0, -COIL_R, 0); coil.add(spool);
  [[-0.014, 0.066, 0.10], [0.0, 0.070, -0.04], [0.014, 0.063, 0.07]].forEach(([z, rr, tilt]) => {
    const m = finish(new T.Mesh(G(new T.TorusGeometry(rr, 0.0095, 6, 28)), ropeMat));
    m.position.set(0, COIL_R - rr, z); m.rotation.x = tilt; m.rotation.z = tilt * 2;
    spool.add(m);
  });
  const binding = finish(new T.Mesh(G(new T.TorusGeometry(0.026, 0.006, 6, 18)), ropeDarkMat));
  binding.position.set(0, -COIL_R, 0); binding.rotation.y = Math.PI / 2; // wraps the bundle, orbits as spool turns
  spool.add(binding);
  const fwdL = L.toLocal(V(0, 0, -1));
  const tipLocal = V(0, 0.072, 0).addScaledVector(fwdL, 0.022);
  {
    const curve = new T.CatmullRomCurve3([V(0, -0.02, 0), V(0, 0.03, 0), V(0, 0.058, 0).addScaledVector(fwdL, 0.006), tipLocal.clone()]);
    L.hand.add(finish(new T.Mesh(G(new T.TubeGeometry(curve, 16, 0.0085, 7, false)), ropeMat)));
  }
  const handTip = new T.Object3D(); handTip.name = 'handTip';
  handTip.position.copy(tipLocal);
  L.hand.add(handTip);

  // ---------------- merge static parts under each animated node ----------------
  for (const node of [R.frame, R.hand, L.frame, L.hand, spool]) {
    for (const m of mergeChildMeshes(T, node, { material: (c) => mergeInto.get(c.material), colorize: true })) geos.push(m.geometry);
  }
  let meshCount = 0;
  root.traverse((o) => { if (o.isMesh) meshCount++; });
  if (hookModel) hookModel.traverse((o) => { if (o.isMesh) meshCount--; });
  root.userData.meshCount = meshCount;   // own meshes after merging (8)
  root.userData.toolScale = TOOL_SCALE;

  // ---------------- animation state (weights only; transforms are rebuilt every frame) ----------------
  const st = { walkW: 0, reelW: 0, outW: 0, leftW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, spool: 0, t: 0 };
  const qOff = new T.Quaternion(), eul = new T.Euler(0, 0, 0, 'XYZ'), qSwing = new T.Quaternion(), AX = V(1, 0, 0);
  // returned every frame; written in place so update() allocates nothing
  const last = { leftShown: 0, charge: 0, chargeEased: 0, throw: 0, pull: 0, walkW: 0, reelW: 0, hookOutW: 0, toolW: 1, spool: 0,
    rightOffset: { pos: [0, 0, 0], rot: [0, 0, 0], wrist: [0, 0, 0] },
    leftOffset: { pos: [0, 0, 0], rot: [0, 0, 0] } };
  const set3 = (a, x, y, z) => { a[0] = x; a[1] = y; a[2] = z; };
  const NO_PARAMS = {};
  let kdt = 0;
  const k = (rate) => 1 - Math.exp(-rate * kdt);              // frame-rate independent smoothing

  function applyArm(A, px, py, pz, rx, ry, rz, wx, wy, wz) {
    A.pose.position.set(A.basePos.x + px, A.basePos.y + py, A.basePos.z + pz);
    eul.set(rx, ry, rz); qOff.setFromEuler(eul);
    A.pose.quaternion.copy(qOff).multiply(A.qBase);           // camera-space offset * base frame
    A.wrist.rotation.set(wx, wy, wz);
  }

  function update(params = NO_PARAMS) {
    const dt = Math.min(Math.max(params.dt ?? 1 / 60, 0), 0.1);
    st.t += dt;
    const t = params.time ?? st.t;
    const charge = clamp01(params.charge || 0);
    const casting = clamp01(params.casting || 0);
    const reeling = !!params.reeling, walking = !!params.walking, hasHookOut = !!params.hasHookOut;
    const amp = clamp01(params.motion ?? 0.35) / 0.35;
    kdt = dt;

    st.walkW += ((walking ? 1 : 0) - st.walkW) * k(5);
    st.reelW += ((reeling ? 1 : 0) - st.reelW) * k(9);
    st.outW += ((hasHookOut ? 1 : 0) - st.outW) * k(7);
    st.leftW += ((hasHookOut || reeling ? 1 : 0) - st.leftW) * k(6);   // left arm only comes up to handle the rope
    st.toolW = hasHookOut ? 0 : st.toolW + (1 - st.toolW) * k(8);
    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) st.releaseCharge = Math.max(st.chargeS, charge, 0.35);
    st.lastCasting = casting;
    st.chargeS += (charge - st.chargeS) * k(charge > st.chargeS ? 22 : 14);

    // ---- cast curve: p 0 (just released) -> 1 (done)
    const p = casting > 0 ? 1 - casting : 1;
    const chargeEff = casting > 0 ? st.releaseCharge * (1 - smooth(0, 0.16, p)) : st.chargeS;
    const forward = casting > 0 ? smooth(0, 0.2, p) * (1 - smooth(0.38, 1, p)) : 0;
    const recoil = casting > 0 ? Math.sin(Math.PI * clamp01((p - 0.5) / 0.5)) * 0.12 : 0;
    const a = forward - recoil;                                // throw sweep (+1 = full forward)
    const ce = Math.sin(chargeEff * Math.PI / 2);              // eased windup
    const trem = smooth(0.75, 1, chargeEff) * (casting > 0 ? 0 : 1) * 0.0025 * (Math.sin(t * 37) + 0.6 * Math.sin(t * 23.3));

    // ---- idle + walk
    const br = Math.sin(t * Math.PI * 2 * 0.22);
    const brL = Math.sin(t * Math.PI * 2 * 0.22 + 0.6);
    const ph = t * Math.PI * 2 * 0.85;                          // stride cycle (two steps)
    const wA = st.walkW * amp * (1 - 0.6 * ce);
    const bob = 0.5 - 0.5 * Math.cos(2 * ph);

    // ---- reel rhythm (left hand pull strokes)
    const q = ((t * 1.5) % 1 + 1) % 1;
    const pull = q < 0.58 ? smooth(0, 0.58, q) : 1 - smooth(0.58, 1, q);   // slow pull back, quick reach
    const rW = st.reelW;
    const oW = st.outW;
    const tw = st.toolW;
    const catchDip = hasHookOut ? 0 : (1 - tw);

    // ---- right arm
    const rpx = 0.10 * ce - 0.12 * a + 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.7) + 0.008 * oW - 0.008 * rW + trem;
    const rpy = -0.10 * ce + 0.07 * a - 0.012 * wA * bob + 0.0045 * amp * br - 0.022 * oW + 0.005 * rW * Math.sin(t * 9.42 + Math.PI) - 0.025 * catchDip + trem * 0.7;
    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5);
    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip;
    const rry = 0.25 * ce - 0.15 * a;
    const rrz = -0.40 * ce + 0.30 * a + 0.03 * wA * Math.sin(ph);
    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85);
    const rwz = -0.20 * ce + 0.15 * a + 0.03 * rW * Math.sin(t * 9.42 + 1.3);
    applyArm(R, rpx, rpy, rpz, rrx, rry, rrz, rwx, 0, rwz);

    // ---- left arm
    const lpx = 0.02 * ce + 0.02 * a + 0.015 * pull * rW - 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.63 + 1);
    const lpy = 0.03 * ce + 0.02 * a + (0.010 - 0.035 * pull) * rW - 0.012 * wA * (0.5 - 0.5 * Math.cos(2 * ph + Math.PI)) + 0.004 * amp * brL;
    const lpz = -0.03 * ce - 0.06 * a + (0.09 * pull - 0.03) * rW;
    const lrx = -0.10 * ce + 0.30 * pull * rW + 0.008 * amp * brL;
    const lry = 0.08 * ce;
    const lrz = -0.15 * pull * rW - 0.03 * wA * Math.sin(ph);
    const hideL = 1 - smooth(0, 1, st.leftW);                   // 1 = parked below the bottom-left edge
    applyArm(L, lpx - 0.10 * hideL, lpy - 0.38 * hideL, lpz + 0.05 * hideL, lrx + 0.5 * hideL, lry, lrz, 0.22 * pull * rW - 0.08 * ce, 0, -0.10 * ce + 0.12 * a);
    L.pose.visible = hideL < 0.98;

    // ---- coil: spool turns while reeling (in) / casting (out); pendulum swing about grip axis
    st.spool = (st.spool + dt * (rW * 7.0 - casting * 12.0)) % (Math.PI * 2);
    spool.rotation.z = st.spool;
    const swing = 0.25 * pull * rW + 0.12 * wA * Math.sin(ph + Math.PI) + 0.10 * ce - 0.15 * a + 0.03 * amp * Math.sin(t * 1.3);
    coil.quaternion.copy(qCoilBase).multiply(qSwing.setFromAxisAngle(AX, swing));

    // ---- tool visibility / pose (absolute)
    if (hookModel) {
      hookModel.visible = !hasHookOut;
      hookModel.position.copy(toolOffset);
      hookModel.quaternion.identity();
      hookModel.scale.setScalar(viewScale);
    }
    toolHolder.scale.setScalar(hasHookOut ? 1 : 0.7 + 0.3 * easeOutBack(tw));  // little "catch" pop on return

    last.charge = chargeEff; last.chargeEased = ce; last.throw = a; last.pull = pull * rW; last.walkW = st.walkW;
    last.reelW = rW; last.hookOutW = oW; last.leftShown = 1 - hideL; last.toolW = tw; last.spool = st.spool;
    set3(last.rightOffset.pos, rpx, rpy, rpz); set3(last.rightOffset.rot, rrx, rry, rrz); set3(last.rightOffset.wrist, rwx, 0, rwz);
    set3(last.leftOffset.pos, lpx, lpy, lpz); set3(last.leftOffset.rot, lrx, lry, lrz);
    return last;
  }

  function dispose() {
    if (hookModel) {
      for (const [o, cs, fc] of savedFlags) { o.castShadow = cs; o.frustumCulled = fc; }
      if (hookModel.parent === toolHolder) toolHolder.remove(hookModel);
    }
    if (root.parent) root.parent.remove(root);
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    geos.length = 0; mats.length = 0;
  }

  update({ dt: 0, time: 0 });
  return { group: root, handTip, tool: hookModel, update, dispose };
}
