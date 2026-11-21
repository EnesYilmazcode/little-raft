// First-person viewmodel hands (original procedural meshes, no textures). ES module.
// Usage:
//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)
//   camera.add(hands.group);                       // camera must be in the scene
//   // or, with the viewmodel layer (viewmodel.js): own FOV, no wall clipping, real shadows, long sleeve
//   const vm = createViewmodel(THREE, { camera }); const hands = createHands(THREE, { modelFactory, prepare: vm.prepare }); vm.attach(hands);
//   options: prepare(obj) per-mesh setup hook (replaces the transparent-queue default), strikeKinds (default
//   ['hammer']): kinds whose click use is a cock-back + downward strike instead of the forward sweep
//   hands.setHeld(kind | null);                    // any item kind; swaps with a lower/raise animation
//   hands.setPose('idle' | 'point' | 'throw' | 'grip' | 'open'); // 'idle'/null = the held kind's default
//     'point': the free hand points its index at the crosshair (right hand when the item rides the left fist,
//     left hand when the right holds a tool such as the hammer). Blends in, no lower/raise.
//     'throw': forces the wind-up (full charge) pose.
//   hands.setModelFactory(fn | null);              // swap the model source later; rebuilds cached models
//   hands.update({ dt, time, charge, reeling, casting, walking, hasHookOut, motion, yaw, pitch });
//   hands.ropeAnchor().getWorldPosition(v);        // rope start: rod tip while the rod is held, else left hand
//   hands.itemModel('fishingrod')                  // the held model (rod userData: float, leader, tipNode)
//
// Camera space: origin at the eye, looking -Z, +Y up, +X right. The right fist grips near (0.38,-0.32,-0.80),
// the left near (-0.34,-0.35,-0.70). Each arm is posed ABSOLUTELY every frame from smoothed weights, so
// nothing accumulates or drifts. Held models are built lazily once per kind and cached.
import { buildItemModel, holdFor, isPlaceable, PLACEABLE_KINDS } from '../../dist/held-items.js?build=v3-survival-ae77fa84ac2b';
export { buildItemModel, isPlaceable, PLACEABLE_KINDS };
const POSES = ['point', 'throw', 'grip', 'open'];

export function createHands(T, { modelFactory = null, prepare = null, strikeKinds = ['hammer'] } = {}) {
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const DEG = Math.PI / 180;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOutBack = (x) => { const c = 1.6, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

  const root = new T.Group();
  root.name = 'fpHands';
  const lagRoot = new T.Group();                        // look-lag / sway pivot at the eye
  root.add(lagRoot);

  // ---------------- materials (own) ----------------
  const geos = [], mats = [];
  const mat = (color, roughness, extra = {}) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    mats.push(m); return m;
  };
  const skin = mat(0xc89068, 0.62, { emissive: 0x1c0e06 });
  const skinPalm = mat(0xc08562, 0.66, { emissive: 0x1a0c05 });
  const nail = mat(0xe0b294, 0.4, { emissive: 0x1c0e06 });
  const crease = mat(0x8e5a3c, 0.8);
  const sleeveMat = mat(0x52705e, 0.95);
  const cuffMat = mat(0x3e5648, 0.95);
  const ropeMat = mat(0xb89a64, 0.95);
  const ropeDarkMat = mat(0x8a6e44, 1.0);

  // Default: viewmodel meshes draw in the transparent queue after a camera depth-clear marker, never cast shadows
  // and are never culled. `prepare` (viewmodel.js vm.prepare) replaces this for every mesh, incl. lazily built models.
  const prep = prepare || ((o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; m.transparent = true; }
  }));
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
    const mesh = new T.Mesh(taperGeo(r0, r1, L, radial), m);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    parent.add(mesh); return mesh;
  };
  const sphereGeo = G(new T.SphereGeometry(1, 16, 12));
  const ellipsoid = (parent, m, p, rx, ry, rz, rotY = 0) => {
    const mesh = new T.Mesh(sphereGeo, m);
    mesh.position.copy(p); mesh.scale.set(rx, ry, rz); mesh.rotation.y = rotY;
    parent.add(mesh); return mesh;
  };

  // ---------------- hand (right-hand layout; mirrored for left) ----------------
  // Grip axis = local Y through origin, gripR = radius of the gripped object. Back of hand +X, palm -X,
  // wrist +Z, so straight fingers point -Z. Each finger and the thumb are built twice (curled round
  // the grip, and straight); a pose just toggles which one is visible.
  function buildHand(parent, gripR) {
    const k = (gripR + 0.010) / 0.042;
    const P = (aDeg, R, y) => V(R * Math.cos(aDeg * DEG), y, -R * Math.sin(aDeg * DEG));
    ellipsoid(parent, skin, V(0.016 * k, -0.004, 0.047 * k), 0.030 * k, 0.050, 0.040 * k, -0.22);
    ellipsoid(parent, skinPalm, V(-0.010 * k, 0.024, 0.050 * k), 0.020 * k, 0.022, 0.028 * k, 0.3);
    const defs = [
      { y: 0.029, r: 0.0098, a1: 72, a2: 150, len: 0.083, spread: 0.010 },  // index
      { y: 0.009, r: 0.0104, a1: 75, a2: 156, len: 0.090, spread: 0.003 },  // middle
      { y: -0.011, r: 0.0098, a1: 73, a2: 152, len: 0.085, spread: -0.004 }, // ring
      { y: -0.029, r: 0.0086, a1: 68, a2: 144, len: 0.068, spread: -0.012 }, // pinky
    ];
    const fingers = defs.map((f, i) => {
      const R = gripR + f.r * 1.02;
      const mcp = P(-12, R + 0.003, f.y);
      const curl = new T.Group(), ext = new T.Group(), tight = new T.Group();
      const pip = P(f.a1, R, f.y), tip = P(f.a2, R * 0.97, f.y + (i === 0 ? 0.001 : 0));
      seg(curl, skin, mcp, pip, f.r * 1.05, f.r * 0.96);
      seg(curl, skin, pip, tip, f.r * 0.96, f.r * 0.78);
      if (i < 3) {
        const c = P(f.a1 + 3, R + f.r * 0.9, f.y);
        seg(curl, crease, c.clone().setY(f.y - 0.0052), c.clone().setY(f.y + 0.0052), 0.0013, 0.0013, 6);
      }
      // tight curl into the palm (empty fist, used beside a pointing index)
      const r2 = 0.012 + f.r, k0 = P(-12, r2 + 0.012, f.y), k1 = P(70, r2, f.y), k2 = P(165, r2 * 0.9, f.y);
      seg(tight, skin, mcp, k0.lerp(k1, 0.5), f.r * 1.05, f.r);
      seg(tight, skin, k0, k1, f.r, f.r * 0.92);
      seg(tight, skin, k1, k2, f.r * 0.92, f.r * 0.78);
      // straight finger: slight natural curl toward the palm, small fan spread
      const e1 = mcp.clone().add(V(-0.010, f.spread * 0.6, -f.len * 0.52));
      const e2 = e1.clone().add(V(-0.012, f.spread * 0.4, -f.len * 0.46));
      seg(ext, skin, mcp, e1, f.r * 1.05, f.r * 0.95);
      seg(ext, skin, e1, e2, f.r * 0.95, f.r * 0.78);
      ellipsoid(ext, nail, e2.clone().add(V(0.0045, 0, 0.004)), 0.0035, f.r * 0.62, 0.008);
      seg(ext, crease, e1.clone().add(V(f.r * 0.85, -0.0052, 0)), e1.clone().add(V(f.r * 0.85, 0.0052, 0)), 0.0013, 0.0013, 6);
      parent.add(curl, ext, tight);
      return { curl, ext, tight };
    });
    const thumbCurl = new T.Group(), thumbExt = new T.Group(), thumbTuck = new T.Group();
    const t0 = V(0.0, 0.032, 0.055 * k), t1 = V(-0.036 * k, 0.047, 0.028 * k), t2 = V(-0.047 * k, 0.045, -0.008 * k);
    seg(thumbCurl, skin, t0, t1, 0.0135, 0.0118);
    seg(thumbCurl, skin, t1, t2, 0.0118, 0.0094);
    const u1 = V(-0.026 * k, 0.062, 0.030 * k), u2 = V(-0.040 * k, 0.083, 0.004 * k);
    seg(thumbExt, skin, t0, u1, 0.0135, 0.0118);
    seg(thumbExt, skin, u1, u2, 0.0118, 0.0094);
    const w1 = V(-0.024 * k, 0.030, 0.026 * k), w2 = V(-0.026 * k, 0.012, 0.004 * k);   // tucked over the curled middle finger
    seg(thumbTuck, skin, t0, w1, 0.0135, 0.0118);
    seg(thumbTuck, skin, w1, w2, 0.0118, 0.0094);
    parent.add(thumbCurl, thumbExt, thumbTuck);
    return { wristPt: V(0.018 * k, -0.006, 0.084 * k), fingers, thumbCurl, thumbExt, thumbTuck };
  }
  function setPose(H, pose) {
    H.fingers.forEach((f, i) => {
      const straight = pose === 'open' || (pose === 'point' && i === 0);
      f.ext.visible = straight; f.tight.visible = !straight && pose === 'point'; f.curl.visible = !straight && pose !== 'point';
    });
    H.thumbCurl.visible = pose === 'grip'; H.thumbExt.visible = pose === 'open'; H.thumbTuck.visible = pose === 'point';
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
    const H = buildHand(hand, gripR);
    const W = H.wristPt;
    wrist.position.copy(W); wrist.scale.setScalar(1.12); hand.position.copy(W).negate();   // hands a touch chunky, Raft-style

    const Fl = toLocal(F).normalize();
    const at = (s) => W.clone().addScaledVector(Fl, s);
    seg(frame, skin, at(0), at(0.24), 0.031, 0.042, 12);           // forearm
    seg(frame, cuffMat, at(0.19), at(0.225), 0.047, 0.050, 14);    // rolled cuff
    // sleeve: under the viewmodel layer (prepare) it runs back past the eye, so a swing never shows its open end;
    // the default path keeps the short one (a long sleeve would cross the world camera's near plane)
    seg(frame, sleeveMat, at(0.23), at(prepare ? 1.10 : 0.60), 0.051, prepare ? 0.066 : 0.070, 14);

    return { pose, frame, wrist, hand, H, qBase, toLocal, basePos: basePos.clone(), r, u, f };
  }

  const R = buildArm({ name: 'rightArm', basePos: V(0.38, -0.32, -0.80), u: V(0.27, 0.95, -0.15), F: V(0.35, -0.50, 1.0), gripR: 0.032, mirror: false });
  const L = buildArm({ name: 'leftArm', basePos: V(-0.34, -0.35, -0.70), u: V(0.85, 0.30, 0.10), F: V(-0.40, -0.50, 1.0), gripR: 0.028, mirror: true });
  lagRoot.add(R.pose, L.pose);
  // Pointing frames: hand half-prone, index aimed just below the crosshair. The left one is the mirror
  // image (x -> -x of the same grip axis / forearm direction; the arm frame itself is already mirrored).
  const pointFrame = (A, sx) => {
    const u = V(-0.65 * sx, 0.70, -0.20).normalize(), F = V(0.40 * sx, -0.42, 1.0).normalize();
    const f = F.clone().addScaledVector(u, -F.dot(u)).normalize(), r = V().crossVectors(u, f).normalize();
    A.qPoint = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r, u, f));
    A.pointPos = V(0.25 * sx, -0.25, -0.56);
  };
  pointFrame(R, 1); pointFrame(L, -1);

  // ---------------- held items (right fist; decorations ride on the left fist) ----------------
  const toolHolder = new T.Group(); toolHolder.name = 'toolHolder';
  R.hand.add(toolHolder);
  {
    const Dl = R.toLocal(V(-0.94, 0.0, -0.34).normalize());   // hook bend opens forward-left
    toolHolder.rotation.y = Math.atan2(Dl.z, -Dl.x);
  }

  // "up" frame on the left fist: X = grip axis, Y = away from gravity at rest
  const qLeftUp = new T.Quaternion();
  {
    const d = L.toLocal(V(0, -1, 0)), X = V(0, 1, 0);
    const Y = d.clone().addScaledVector(X, -d.dot(X)).negate().normalize();
    qLeftUp.setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, V().crossVectors(X, Y)));
  }
  const leftHolder = new T.Group(); leftHolder.name = 'leftHolder';
  leftHolder.quaternion.copy(qLeftUp); leftHolder.position.set(0, 0.006, 0);
  L.hand.add(leftHolder);

  let factory = modelFactory;
  const mounts = new Map();                                    // kind -> { pivot, model } (built once)
  function mountFor(kind) {
    if (mounts.has(kind)) return mounts.get(kind);
    let m = null;
    const item = buildItemModel(T, kind, factory);
    if (item) {
      const h = holdFor(kind);
      const pivot = new T.Group(); pivot.name = 'held_' + kind;
      pivot.rotation.set(h.rx || 0, h.ry || 0, h.rz || 0);
      const g = item.userData.grip;
      if (h.hand === 'left') item.position.set(-g[0], 0.03 - g[1], -g[2]);  // base sits on top of the fist
      else item.position.set(-g[0], -g[1], -g[2]);
      pivot.add(item); prep(pivot); pivot.visible = false;
      (h.hand === 'left' ? leftHolder : toolHolder).add(pivot);
      m = { pivot, item };
    }
    mounts.set(kind, m);
    return m;
  }

  // ---------------- rope coil + lead (left hand, hook only) ----------------
  const coil = new T.Group(); coil.name = 'ropeCoil';
  L.hand.add(coil);
  const COIL_R = 0.068;
  const spool = new T.Group(); spool.position.set(0, -COIL_R, 0); coil.add(spool);
  [[-0.014, 0.066, 0.10], [0.0, 0.070, -0.04], [0.014, 0.063, 0.07]].forEach(([z, rr, tilt]) => {
    const m = new T.Mesh(G(new T.TorusGeometry(rr, 0.0095, 6, 28)), ropeMat);
    m.position.set(0, COIL_R - rr, z); m.rotation.x = tilt; m.rotation.z = tilt * 2;
    spool.add(m);
  });
  const binding = new T.Mesh(G(new T.TorusGeometry(0.026, 0.006, 6, 18)), ropeDarkMat);
  binding.position.set(0, -COIL_R, 0); binding.rotation.y = Math.PI / 2;
  spool.add(binding);
  const fwdL = L.toLocal(V(0, 0, -1));
  const tipLocal = V(0, 0.072, 0).addScaledVector(fwdL, 0.022);
  const lead = new T.Mesh(G(new T.TubeGeometry(new T.CatmullRomCurve3([V(0, -0.02, 0), V(0, 0.03, 0), V(0, 0.058, 0).addScaledVector(fwdL, 0.006), tipLocal.clone()]), 16, 0.0085, 7, false)), ropeMat);
  L.hand.add(lead);
  const handTip = new T.Object3D(); handTip.name = 'handTip';
  handTip.position.copy(tipLocal);
  L.hand.add(handTip);
  prep(lagRoot);

  // ---------------- animation state (weights only; transforms are rebuilt every frame) ----------------
  // dip: 0 = arms up, 1 = lowered out of view. A swap lowers, switches model/pose at the bottom, raises.
  const st = { walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, strikeOn: false, spool: 0, t: 0,
    shown: null, target: null, poseOverride: null, ptR: 0, ptL: 0, lowering: false, dip: 1, down: 1, raise: 1, lagX: 0, lagY: 0, lastYaw: null, lastPitch: 0 };
  const qOff = new T.Quaternion(), eul = new T.Euler(0, 0, 0, 'XYZ'), qSwing = new T.Quaternion(), AX = V(1, 0, 0);
  const last = {};
  setPose(L.H, 'grip');

  // Resolved pose of the shown item ('point' | 'throw' | 'grip' | 'open') and which hand points.
  const poseOf = (kind) => st.poseOverride || (kind ? holdFor(kind).pose : 'grip');
  const usesLeft = (kind) => kind === 'hook' || holdFor(kind).hand === 'left';
  const handPoses = { R: '', L: '' };
  function applyFingers(pose) {
    const pointer = pose !== 'point' || !st.shown ? null : holdFor(st.shown).hand === 'left' ? 'R' : 'L';
    const r = pointer === 'R' ? 'point' : pose === 'open' ? 'open' : 'grip', l = pointer === 'L' ? 'point' : 'grip';
    if (handPoses.R !== r) setPose(R.H, handPoses.R = r);
    if (handPoses.L !== l) setPose(L.H, handPoses.L = l);
    return pointer;
  }
  function swapNow() {
    const prev = st.shown && mounts.get(st.shown);
    if (prev) prev.pivot.visible = false;
    st.shown = st.target;
    const next = st.shown && mountFor(st.shown);
    if (next) next.pivot.visible = st.shown !== 'hook' || st.outW < 0.5;
    R.pose.visible = st.shown !== null;
    st.raise = 0; st.lowering = false;
  }

  const qA = new T.Quaternion(), pA = V();
  function applyArm(A, px, py, pz, rx, ry, rz, wx, wy, wz, w = 0) {
    pA.lerpVectors(A.basePos, A.pointPos, w);
    A.pose.position.set(pA.x + px, pA.y + py, pA.z + pz);
    eul.set(rx, ry, rz); qOff.setFromEuler(eul);
    A.pose.quaternion.copy(qOff).multiply(qA.slerpQuaternions(A.qBase, A.qPoint, w));
    A.wrist.rotation.set(wx, wy, wz);
  }

  function update(params = {}) {
    const dt = Math.min(Math.max(params.dt ?? 1 / 60, 0), 0.1);
    st.t += dt;
    const t = params.time ?? st.t;
    const charge0 = clamp01(params.charge || 0);
    const casting = clamp01(params.casting || 0);
    const reeling = !!params.reeling, walking = !!params.walking;
    const amp = clamp01(params.motion ?? 0.35) / 0.35;
    const k = (rate) => 1 - Math.exp(-rate * dt);

    // ---- swap / pose change: ease down, switch while hidden, pop back up
    if (st.shown !== st.target) {
      if (!st.lowering) { st.lowering = true; st.dip = Math.sqrt(clamp01(st.down)); }
      st.dip = Math.min(1, st.dip + dt / 0.13);
      if (st.dip >= 1) swapNow();
    } else {
      // re-selected the item that was being lowered: raise it again from the current height (no pop, no stuck dip)
      if (st.lowering) { const d = st.dip * st.dip; let lo = 0, hi = 0.59; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (1 - easeOutBack(m) > d) lo = m; else hi = m; } st.raise = lo; st.lowering = false; }
      if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);
    }
    const down = st.down = st.shown === null ? 1 : st.lowering ? st.dip * st.dip : 1 - easeOutBack(st.raise);
    root.visible = st.shown !== null || st.target !== null;
    const pose = poseOf(st.shown), pointer = applyFingers(pose);
    const isHook = st.shown === 'hook', hasHookOut = isHook && !!params.hasHookOut;
    const charge = pose === 'throw' ? 1 : isHook ? charge0 : 0;
    // pointing blends in; a left hand that only shows up to point slides in from below
    st.ptR += ((pointer === 'R' ? 1 : 0) - st.ptR) * k(12);
    st.ptL += ((pointer === 'L' ? 1 : 0) - st.ptL) * k(12);
    const leftNeeded = usesLeft(st.shown), lIn = leftNeeded ? 1 : st.ptL;
    L.pose.visible = st.shown !== null && (leftNeeded || st.ptL > 0.02);
    coil.visible = lead.visible = isHook && pointer !== 'L';

    // ---- look lag: hands trail camera turns a little, then settle
    if (Number.isFinite(params.yaw) && Number.isFinite(params.pitch)) {
      if (st.lastYaw === null) { st.lastYaw = params.yaw; st.lastPitch = params.pitch; }
      let dy = params.yaw - st.lastYaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      const dp = params.pitch - st.lastPitch;
      st.lastYaw = params.yaw; st.lastPitch = params.pitch;
      const inv = dt > 0 ? 1 / dt : 0, cap = 0.07 * amp;
      const tx = Math.max(-cap, Math.min(cap, -dp * inv * 0.012)), ty = Math.max(-cap, Math.min(cap, -dy * inv * 0.012));
      st.lagX += (tx - st.lagX) * k(9); st.lagY += (ty - st.lagY) * k(9);
    }
    lagRoot.rotation.set(st.lagX, st.lagY, -st.lagY * 0.6);

    st.walkW += ((walking ? 1 : 0) - st.walkW) * k(5);
    st.reelW += ((reeling ? 1 : 0) - st.reelW) * k(9);
    st.outW += ((hasHookOut ? 1 : 0) - st.outW) * k(7);
    st.toolW = hasHookOut ? 0 : st.toolW + (1 - st.toolW) * k(8);
    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) {
      st.releaseCharge = Math.max(st.chargeS, charge, 0.35);
      st.strikeOn = casting >= 0.9;   // a click use (swing 1) strikes; a pickup tap (swing .6) keeps the light sweep
    }
    if (casting <= 0) st.strikeOn = false;
    st.lastCasting = casting;
    st.chargeS += (charge - st.chargeS) * k(charge > st.chargeS ? 22 : 14);

    // ---- cast / strike curve: p 0 (just released) -> 1 (done)
    const p = casting > 0 ? 1 - casting : 1;
    const chargeEff = casting > 0 ? st.releaseCharge * (1 - smooth(0, 0.16, p)) : st.chargeS;
    const forward = casting > 0 ? smooth(0, 0.2, p) * (1 - smooth(0.38, 1, p)) : 0;
    const recoil = casting > 0 ? Math.sin(Math.PI * clamp01((p - 0.5) / 0.5)) * 0.12 : 0;
    const STRIKE = st.strikeOn && strikeKinds.includes(st.shown);
    const a = STRIKE ? 0 : (forward - recoil) * (isHook ? 1 : 0.55);
    // strike curve (hammer): cock back 0-.2, hit .2-.36 (impact ~.36, ~120 ms after the click), rebound, recover .5-1
    const sUp = STRIKE ? smooth(0, 0.2, p) * (1 - smooth(0.2, 0.36, p)) : 0;
    const sHit = STRIKE ? smooth(0.2, 0.36, p) * (1 - smooth(0.5, 1, p)) : 0;
    const sReb = STRIKE ? Math.sin(Math.PI * clamp01((p - 0.36) / 0.22)) : 0;
    const ce = isHook || pose === 'throw' ? Math.sin(chargeEff * Math.PI / 2) : 0;
    const trem = smooth(0.75, 1, chargeEff) * (casting > 0 ? 0 : 1) * 0.0025 * (Math.sin(t * 37) + 0.6 * Math.sin(t * 23.3));

    // ---- idle + walk
    const br = Math.sin(t * Math.PI * 2 * 0.22);
    const brL = Math.sin(t * Math.PI * 2 * 0.22 + 0.6);
    const ph = t * Math.PI * 2 * 0.85;
    const wA = st.walkW * amp * (1 - 0.6 * ce);
    const bob = 0.5 - 0.5 * Math.cos(2 * ph);

    // ---- reel rhythm (left hand pull strokes)
    const q = ((t * 1.5) % 1 + 1) % 1;
    const pull = q < 0.58 ? smooth(0, 0.58, q) : 1 - smooth(0.58, 1, q);
    const rW = st.reelW, oW = st.outW, tw = st.toolW;
    const catchDip = hasHookOut ? 0 : (1 - tw);

    // ---- right arm
    const rpx = 0.10 * ce - 0.12 * a + 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.7) + 0.008 * oW - 0.008 * rW + trem
      + 0.02 * sUp - 0.03 * sHit;
    const rpy = -0.10 * ce + 0.07 * a - 0.012 * wA * bob + 0.0045 * amp * br - 0.022 * oW + 0.005 * rW * Math.sin(t * 9.42 + Math.PI) - 0.025 * catchDip + trem * 0.7 - 0.45 * down
      + 0.05 * sUp - 0.08 * sHit + 0.012 * sReb;
    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5) + 0.02 * sUp - 0.04 * sHit;
    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip - 0.5 * down + 0.20 * sUp - 0.35 * sHit + 0.10 * sReb;
    const rry = 0.25 * ce - 0.15 * a;
    const rrz = -0.40 * ce + 0.30 * a + 0.03 * wA * Math.sin(ph) + 0.25 * down;
    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85) + 0.30 * sUp - 1.40 * sHit;
    const rwz = -0.20 * ce + 0.15 * a + 0.03 * rW * Math.sin(t * 9.42 + 1.3);
    applyArm(R, rpx, rpy, rpz, rrx, rry, rrz, rwx, 0, rwz, smooth(0, 1, st.ptR));

    // ---- left arm
    const lpx = 0.02 * ce + 0.02 * a + 0.015 * pull * rW - 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.63 + 1);
    const lpy = 0.03 * ce + 0.02 * a + (0.010 - 0.035 * pull) * rW - 0.012 * wA * (0.5 - 0.5 * Math.cos(2 * ph + Math.PI)) + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn) - 0.010 * sHit;
    const lpz = -0.03 * ce - 0.06 * a + (0.09 * pull - 0.03) * rW;
    const lrx = -0.10 * ce + 0.30 * pull * rW + 0.008 * amp * brL - 0.4 * down;
    const lry = 0.08 * ce;
    const lrz = -0.15 * pull * rW - 0.03 * wA * Math.sin(ph) - 0.2 * down;
    applyArm(L, lpx, lpy, lpz, lrx, lry, lrz, 0.22 * pull * rW - 0.08 * ce, 0, -0.10 * ce + 0.12 * a, smooth(0, 1, st.ptL));

    // ---- coil: spool turns while reeling (in) / casting (out); pendulum swing about grip axis
    if (isHook) {
      st.spool = (st.spool + dt * (rW * 7.0 - casting * 12.0)) % (Math.PI * 2);
      spool.rotation.z = st.spool;
      const swing = 0.25 * pull * rW + 0.12 * wA * Math.sin(ph + Math.PI) + 0.10 * ce - 0.15 * a + 0.03 * amp * Math.sin(t * 1.3);
      coil.quaternion.copy(qLeftUp).multiply(qSwing.setFromAxisAngle(AX, swing));
      const hm = mounts.get('hook');
      if (hm) hm.pivot.visible = !hasHookOut;
    }
    toolHolder.scale.setScalar(hasHookOut ? 1 : 0.7 + 0.3 * easeOutBack(tw));  // little "catch" pop on return

    Object.assign(last, { held: st.shown, target: st.target, pose, pointHand: pointer, dip: down, lag: [st.lagX, st.lagY], charge: chargeEff, chargeEased: ce, throw: a, strike: sHit - sUp,
      pull: pull * rW, walkW: st.walkW, reelW: rW, hookOutW: oW, toolW: tw, spool: st.spool, models: mounts.size });
    return last;
  }

  function dispose() {
    if (root.parent) root.parent.remove(root);
    const extra = new Set();
    dropMounts();
    for (const x of [...geos, ...mats]) x.dispose();
    geos.length = 0; mats.length = 0;
  }
  // Frees every cached held model (factory models share cached geometry, so those are only detached).
  function dropMounts() {
    const extra = new Set();
    for (const m of mounts.values()) {
      if (!m) continue;
      m.pivot.removeFromParent();
      if (!m.item.userData.shared) m.item.traverse((o) => { if (o.isMesh) { extra.add(o.geometry); [].concat(o.material).forEach((x) => extra.add(x)); } });
    }
    for (const x of extra) x.dispose();
    mounts.clear();
  }

  update({ dt: 0, time: 0 });
  return {
    group: root, handTip, update, dispose, state: last,
    setHeld(kind) { st.target = kind ? String(kind) : null; },
    setPose(pose) { st.poseOverride = POSES.includes(pose) ? pose : null; },
    setModelFactory(fn) {
      factory = typeof fn === 'function' ? fn : null;
      const shown = st.shown; dropMounts();
      if (shown) { const m = mountFor(shown); if (m) m.pivot.visible = true; }
    },
    itemModel(kind) { const m = mountFor(kind); return m ? (m.item.userData.model || m.item) : null; },
    ropeAnchor() {
      if (st.shown === 'fishingrod') { const rod = mounts.get('fishingrod'); if (rod?.item.userData.model?.userData.tipNode) return rod.item.userData.model.userData.tipNode; }
      return handTip;
    },
    preload(kinds) { for (const k of kinds) mountFor(k); },
  };
}
