// First-person viewmodel layer for Little Raft (three r170, ES module). Drop-in target: dist/viewmodel.js.
//
// One render pass, no depth clear, no transparent-queue hack. Viewmodel meshes stay in the world scene (so they get
// the exact world lights, tone mapping and real sun shadows), but their material vertex shader:
//   1. projects with its own camera (own FOV, independent of the player's FOV setting), and
//   2. squashes clip-space depth into the front `depthRange` of the depth buffer, so the world can never clip them.
// The whole rig is scaled by `shrink` about the eye. Perspective is scale-invariant about the eye, so the picture
// is unchanged, but the hands' true world position sits inside the player's head: shadows sampled there are the
// shadows the player stands in, even with the face pressed against a wall.
//
// Usage:
//   const vm = createViewmodel(T, {camera, fov:62});
//   vm.add('hook', hookHands); vm.add('hammer', hammerHands); ...       // createHands() controllers
//   each frame, after the camera transform is set and before hands.update():
//   vm.update({dt, kind, yaw, pitch, walking, walkPhase, grounded, vy, charge, swing, motion});
//   vm.shown                     -> kind whose hands are drawn now (lags `kind` during an equip swap)
//   vm.anchor(obj, out)          -> world point that renders under obj's on-screen position (rope start)
//   vm.setAspect(a); vm.setFov(f)

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOutBack = (x) => { const c = 1.4, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Fixed-step damped spring (120 Hz semi-implicit Euler): same feel at 30 and 144 fps.
export class Spring3 {
  constructor(T, k = 120, c = 14) { this.k = k; this.c = c; this.x = new T.Vector3(); this.v = new T.Vector3(); this.target = new T.Vector3(); this.acc = 0; }
  impulse(x, y, z) { this.v.x += x; this.v.y += y; this.v.z += z; return this; }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); this.acc = 0; }
  update(dt) {
    const h = 1 / 120; this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= h) {
      this.acc -= h;
      this.v.x += (this.k * (this.target.x - this.x.x) - this.c * this.v.x) * h;
      this.v.y += (this.k * (this.target.y - this.x.y) - this.c * this.v.y) * h;
      this.v.z += (this.k * (this.target.z - this.x.z) - this.c * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
}

export function createViewmodel(T, { camera, fov = 70, shrink = 0.15, depthRange = 0.02, near = 0.01 } = {}) {
  const projCam = new T.PerspectiveCamera(fov, camera.aspect, near, 100);
  const uniforms = { vmProj: { value: projCam.projectionMatrix }, vmDepth: { value: depthRange } };
  const patched = new WeakSet();

  // Vertex patch: own projection + depth squash. Lighting (view-space normals, vViewPosition) is untouched.
  function patchMaterial(m) {
    if (!m || patched.has(m)) return; patched.add(m);
    const prevCompile = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      prevCompile?.call(m, sh, r);
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;\nuniform float vmDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tgl_Position = vmProj * mvPosition;\n\tgl_Position.z = mix(-gl_Position.w, gl_Position.z, vmDepth);');
    };
    m.customProgramCacheKey = () => 'vm|' + (prevKey ? prevKey.call(m) : '');
    m.needsUpdate = true;
  }
  function prepare(group) {
    group.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = !!o.isMesh; o.renderOrder = 0;
      for (const m of [].concat(o.material)) patchMaterial(m);
    });
  }

  // rig (camera child, scaled about the eye) > motion (springs, bob, breath) > equip (raise/lower) > hands.group
  const rig = new T.Group(); rig.name = 'viewmodelRig'; rig.scale.setScalar(shrink);
  const motionG = new T.Group(); const equipG = new T.Group();
  rig.add(motionG); motionG.add(equipG); camera.add(rig);
  const slots = new Map();

  function add(kind, hands) {
    prepare(hands.group);
    if (hands.group.parent) hands.group.parent.remove(hands.group);
    hands.group.visible = false; equipG.add(hands.group);
    slots.set(kind, hands);
    return hands;
  }

  const sway = new Spring3(T, 90, 12), bob = new Spring3(T, 160, 18), kick = new Spring3(T, 220, 16), land = new Spring3(T, 140, 13);
  const st = { shown: null, e: 0, prevYaw: null, prevPitch: 0, walkW: 0, chargeW: 0, prevSwing: 0, wasGrounded: true, t: 0, airW: 0 };

  function update(p = {}) {
    const dt = clamp(p.dt ?? 1 / 60, 0, 0.1); st.t += dt;
    const amp = clamp(p.motion ?? 0.35, 0, 1) / 0.35;  // the game's cameraMotion comfort slider (default .35 -> 1)
    const kind = slots.has(p.kind) ? p.kind : null;
    const k = (rate) => 1 - Math.exp(-rate * dt);

    // ---- equip state machine: lower the old tool, swap, raise the new one
    if (kind !== st.shown) {
      st.e = Math.max(0, st.e - dt / 0.16);
      if (st.e === 0) { st.shown = kind; sway.reset(); }
    } else if (kind) st.e = Math.min(1, st.e + dt / 0.30);
    for (const [kd, h] of slots) h.group.visible = kd === st.shown && st.shown !== null;
    const raising = kind === st.shown;
    const down = raising ? 1 - easeOutBack(st.e) : 1 - smooth(st.e);  // 0 = in hand, 1 = lowered out of view
    equipG.position.set(0.06 * down, -0.42 * down, 0.10 * down);
    equipG.rotation.set(-0.85 * down, 0.15 * down, 0.35 * down);

    // ---- look sway: hands lag the look, a little roll into turns
    const yaw = p.yaw ?? 0, pitch = p.pitch ?? 0;
    if (st.prevYaw === null) { st.prevYaw = yaw; st.prevPitch = pitch; }
    const inv = 1 / Math.max(dt, 1e-3);
    const yawRate = clamp(wrapPi(yaw - st.prevYaw) * inv, -8, 8), pitchRate = clamp((pitch - st.prevPitch) * inv, -8, 8);
    st.prevYaw = yaw; st.prevPitch = pitch;
    sway.target.set(clamp(yawRate * 0.010, -0.045, 0.045) * amp, clamp(-pitchRate * 0.010, -0.035, 0.035) * amp, 0);
    const s = sway.update(dt);

    // ---- walk bob: figure-eight, vertical in phase with the camera bob (game: sin(walkPhase))
    st.walkW += ((p.walking ? 1 : 0) - st.walkW) * k(6);
    const ph = p.walkPhase ?? st.t * 9;
    const w = st.walkW * amp;
    bob.target.set(Math.sin(ph * 0.5) * 0.014 * w, -(0.5 - 0.5 * Math.cos(ph)) * 0.014 * w, 0);
    const b = bob.update(dt);

    // ---- jump / land: lift slightly while airborne, dip on landing
    const grounded = p.grounded ?? true;
    st.airW += ((grounded ? 0 : 1) - st.airW) * k(5);
    if (grounded && !st.wasGrounded) land.impulse(0, clamp(p.vy ?? -3, -9, 0) * 0.06 * amp, 0);
    st.wasGrounded = grounded;
    const l = land.update(dt);

    // ---- use kick: rising edge of the game's swing timer
    const swing = p.swing ?? 0;
    if (swing > st.prevSwing + 0.3) kick.impulse(0, 0.5 * amp, 1.4 * amp);
    st.prevSwing = swing;
    const r = kick.update(dt);

    // ---- charge: brace (hands pull in, slight tension shake on top of hands.js windup)
    st.chargeW += ((p.charge ?? 0) - st.chargeW) * k(10);
    const c = st.chargeW, shake = smooth((c - 0.7) / 0.3) * 0.0016 * (Math.sin(st.t * 41) + Math.sin(st.t * 27.7));

    // ---- idle breathing (slow, 0.25 Hz), muted while walking
    const br = Math.sin(st.t * Math.PI * 2 * 0.25) * (1 - 0.7 * st.walkW) * amp;

    motionG.position.set(
      s.x + b.x + shake,
      s.y + b.y + l.y + 0.012 * st.airW * amp + 0.0030 * br + r.y * 0.02 - 0.012 * c + shake,
      r.z * 0.04 + 0.010 * c);
    motionG.rotation.set(
      s.y * 1.6 + r.y * 0.06 + 0.004 * br + l.y * 0.8,
      -s.x * 1.8,
      -s.x * 1.2 + b.x * 0.8);
    return { shown: st.shown, equip: st.e };
  }

  // World point that renders at obj's on-screen position, at obj's true (un-shrunk) distance from the eye.
  // Use for world-space effects that must start at the hand: rope start, hook launch origin, fishing line tip.
  const tmp = new T.Vector3(), eye = new T.Vector3(), camInv = new T.Matrix4();
  function anchor(obj, out = new T.Vector3()) {
    camera.updateMatrixWorld();
    obj.getWorldPosition(tmp);
    camInv.copy(camera.matrixWorld).invert(); tmp.applyMatrix4(camInv);       // camera space (shrunk)
    const depth = tmp.length() / shrink;
    tmp.applyMatrix4(projCam.projectionMatrix);                               // viewmodel NDC
    tmp.z = 0.5; tmp.applyMatrix4(camera.projectionMatrixInverse).normalize(); // world-camera view ray
    camera.getWorldPosition(eye);
    return out.copy(tmp).transformDirection(camera.matrixWorld).multiplyScalar(depth).add(eye);
  }

  function setAspect(a) { projCam.aspect = a; projCam.updateProjectionMatrix(); }
  function setFov(f) { if (projCam.fov !== f) { projCam.fov = f; projCam.updateProjectionMatrix(); } }
  return { rig, add, update, anchor, setAspect, setFov, prepare, projCam, get shown() { return st.shown; }, get equip() { return st.e; } };
}
