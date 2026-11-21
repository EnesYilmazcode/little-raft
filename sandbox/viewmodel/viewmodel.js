// First-person viewmodel layer for Little Raft (three r170, ES module). Drop-in target: dist/viewmodel.js.
//
// One render pass, no depth clear, no transparent-queue hack. Viewmodel meshes stay in the world scene (so they get
// the exact world lights, fog, tone mapping and real sun shadows), but their material vertex shader:
//   1. projects with its own camera (own FOV, independent of the player's FOV setting), and
//   2. squashes clip-space depth into the front `depthRange` of the depth buffer, so the world can never clip them.
// The whole rig is scaled by `shrink` about the eye. Perspective is scale-invariant about the eye, so the picture
// is unchanged, but the hands' true world position sits inside the player's head: shadows sampled there are the
// shadows the player stands in, even with the face pressed against a wall.
//
// It wraps the game's single hands controller (dist/hands.js createHands), which already owns the swap
// (lower/raise), look lag, walk bob and breathing. This layer adds only what hands.js lacks: a landing dip, a
// use kick (timed to the hammer's strike impact), and a charge brace that keeps the hook on screen.
//
// Usage:
//   const vm = createViewmodel(T, { camera, fov: 70 });
//   const hands = createHands(T, { modelFactory, prepare: vm.prepare });   // every mesh, incl. lazily built models
//   vm.attach(hands);                                                      // parents hands.group under the rig
//   each frame, before camera.updateMatrixWorld():
//   vm.update({ dt, held: hands.state.held, grounded, vy, charge, swing, motion });
//   vm.anchor(hands.ropeAnchor(), out)  -> world point that renders under the anchor's on-screen position
//   vm.setAspect(a); vm.setFov(f); vm.setFill(rim, lift)   // shade fill, 0,0 = off

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

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

export function createViewmodel(T, { camera, fov = 70, shrink = 0.15, depthRange = 0.02, near = 0.01, rim = 0.6, lift = 0.14, strikeKinds = ['hammer'] } = {}) {
  const projCam = new T.PerspectiveCamera(fov, camera.aspect, near, 100);
  const uniforms = { vmProj: { value: projCam.projectionMatrix }, vmDepth: { value: depthRange }, vmRim: { value: rim }, vmLift: { value: lift } };
  const own = new Map(), copies = new WeakSet();   // source material -> patched viewmodel copy

  // Vertex patch: own projection + depth squash. Lighting (view-space normals, vViewPosition) is untouched.
  // Held models from models.js share their materials with inventory icons (own renderer) and other users, so the
  // layer patches a private copy and never touches the source material.
  function patchMaterial(src) {
    if (!src) return src;
    if (own.has(src)) return own.get(src);
    if (copies.has(src)) return src;                           // already a viewmodel copy
    const m = src.clone(); own.set(src, m); copies.add(m);
    const prevCompile = src.onBeforeCompile, prevKey = src.customProgramCacheKey;
    const prevTag = prevCompile && prevCompile !== T.Material.prototype.onBeforeCompile ? prevCompile.toString() : '';
    m.onBeforeCompile = (sh, r) => {
      prevCompile?.call(m, sh, r);
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;\nuniform float vmDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tgl_Position = vmProj * mvPosition;\n\tgl_Position.z = mix(-gl_Position.w, gl_Position.z, vmDepth);');
      // Read-in-shade fill (lit materials only): a small ambient lift plus a soft view rim, both tinted by the base
      // colour, so a fist under a sail keeps its silhouette. Added after lighting, before tone mapping.
      if (sh.fragmentShader.includes('#include <normal_fragment_begin>') && sh.fragmentShader.includes('vViewPosition'))
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float vmRim;\nuniform float vmLift;')
          .replace('#include <opaque_fragment>', '{ float vmF = 1.0 - abs(dot(normal, normalize(vViewPosition)));\n\toutgoingLight += diffuseColor.rgb * (vmLift + vmRim * vmF * vmF * vmF); }\n#include <opaque_fragment>');
    };
    // The key must tell apart materials whose earlier patches differ: include the previous key AND the previous
    // onBeforeCompile source (three's default key is that source, which is now this wrapper for every copy).
    const prevKeyVal = prevKey && prevKey !== T.Material.prototype.customProgramCacheKey ? prevKey.call(src) : '';
    m.customProgramCacheKey = () => 'vm|' + prevKeyVal + '|' + prevTag;
    m.needsUpdate = true;
    return m;
  }
  // Per-mesh setup. Pass as createHands(T, { prepare: vm.prepare }) so lazily mounted held models get it too.
  function prepare(group) {
    group.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = !!o.isMesh; o.renderOrder = 0;
      o.material = Array.isArray(o.material) ? o.material.map(patchMaterial) : patchMaterial(o.material);
    });
  }

  // rig (camera child, scaled about the eye) > motion (land dip, use kick, charge brace) > hands.group
  const rig = new T.Group(); rig.name = 'viewmodelRig'; rig.scale.setScalar(shrink);
  const motionG = new T.Group(); motionG.name = 'viewmodelMotion';
  rig.add(motionG); camera.add(rig);
  function attach(hands) {
    const g = hands.group ?? hands;
    prepare(g);
    if (g.parent) g.parent.remove(g);
    motionG.add(g);
    return hands;
  }

  const kick = new Spring3(T, 220, 16), land = new Spring3(T, 140, 13);
  const st = { prevSwing: 0, hitAt: 0, wasGrounded: true, t: 0, airW: 0, airVy: 0, chargeW: 0 };

  function update(p = {}) {
    const dt = clamp(p.dt ?? 1 / 60, 0, 0.1); st.t += dt;
    const amp = clamp(p.motion ?? 0.35, 0, 1) / 0.35;  // the game's cameraMotion comfort slider (default .35 -> 1)
    const k = (rate) => 1 - Math.exp(-rate * dt);

    // ---- jump / land: lift slightly while airborne, dip on landing
    const grounded = p.grounded ?? true;
    st.airW += ((grounded ? 0 : 1) - st.airW) * k(5);
    if (!grounded) st.airVy = p.vy ?? -3;                  // physics zeroes vy on the landing frame, keep the last airborne value
    if (grounded && !st.wasGrounded) land.impulse(0, clamp(st.airVy, -9, 0) * 0.06 * amp, 0);
    st.wasGrounded = grounded;
    const l = land.update(dt);

    // ---- use kick: rising edge of the game's swing timer (1 = click use, .6 = pickup tap)
    const swing = p.swing ?? 0;
    if (swing > st.prevSwing + 0.3) {
      if (swing > 0.7 && strikeKinds.includes(p.held)) st.hitAt = st.t + Math.max(1e-3, (swing - 0.64) / 3); // swing -= dt*3, impact at p=.36
      else kick.impulse(0, 0.5 * amp * (swing > 0.7 ? 1 : 0.4), 1.4 * amp * (swing > 0.7 ? 1 : 0.4));
    }
    if (st.hitAt && st.t >= st.hitAt) { st.hitAt = 0; kick.impulse(0, -0.9 * amp, 0.5 * amp); }
    st.prevSwing = swing;
    const r = kick.update(dt);

    // ---- charge brace: slight tension shake on top of hands.js windup, and pull left/up a touch so the hook stays
    //      framed (hands.js winds the hook back and right by ~.1 at full charge)
    st.chargeW += ((p.held === 'hook' ? p.charge ?? 0 : 0) - st.chargeW) * k(10);
    const c = st.chargeW, shake = smooth((c - 0.7) / 0.3) * 0.0016 * (Math.sin(st.t * 41) + Math.sin(st.t * 27.7));

    motionG.position.set(shake - 0.05 * c, l.y + 0.012 * st.airW * amp + r.y * 0.02 + 0.02 * c + shake, r.z * 0.04);
    motionG.rotation.set(r.y * 0.06 + l.y * 0.8, 0, 0);
    return { kick: r.y, land: l.y, charge: c };
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

  function setAspect(a) { if (projCam.aspect !== a) { projCam.aspect = a; projCam.updateProjectionMatrix(); } }
  function setFill(r = rim, l = lift) { uniforms.vmRim.value = r; uniforms.vmLift.value = l; }
  function setFov(f) { if (projCam.fov !== f) { projCam.fov = f; projCam.updateProjectionMatrix(); } }
  function dispose() { rig.removeFromParent(); for (const m of own.values()) m.dispose(); own.clear(); }
  return { rig, attach, prepare, update, anchor, setAspect, setFov, setFill, dispose, projCam };
}
