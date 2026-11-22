// First-person viewmodel hands (original procedural meshes and tiny generated textures, no image files). ES module.
// Usage:
//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)
//   camera.add(hands.group);                       // camera must be in the scene
//   hands.setHeld(kind | null);                    // any item kind; swaps with a lower/raise animation
//   hands.setPose('idle' | 'point' | 'throw' | 'grip' | 'open'); // 'idle'/null = the held kind's default
//     'point': the free hand points its index at the crosshair (right hand when the item rides the left fist,
//     left hand when the right holds a tool such as the hammer). Blends in, no lower/raise.
//     'throw': forces the wind-up (full charge) pose.
//   hands.setModelFactory(fn | null);              // swap the model source later; rebuilds cached models
//   hands.update({ dt, time, charge, reeling, casting, walking, hasHookOut, motion, yaw, pitch, fov, paddle });
//     paddle: 1 -> 0 over one paddle stroke (dist/paddle.js): the right arm reaches forward and down, then pulls back.
//   hands.ropeAnchor().getWorldPosition(v);        // rope start: rod tip, right fist while the hook is out, else left hand
//   hands.itemModel('fishingrod')                  // the held model (rod userData: float, leader, tipNode)
//
// Camera space: origin at the eye, looking -Z, +Y up, +X right, framed for a fixed 60 degree vertical FOV
// (pass update({ fov }) = the world camera's FOV; the group's x/y scale undoes it). The right fist grips near
// (0.40,-0.35,-0.74), the left near (-0.37,-0.36,-0.74): both stay out of the middle of the screen.
// While the hook is out the right fist closes on the line (ropeAnchor() moves there) and reeling pulls hand over hand. Each arm is posed ABSOLUTELY every frame from smoothed weights, so
// nothing accumulates or drifts. Held models are built once per kind and cached (preload() builds them ahead,
// so the first switch to an item does no mesh work); static parts are merged to keep draw calls low.
import { buildItemModel, holdFor, isPlaceable, PLACEABLE_KINDS, surfaceTextures } from './held-items.js?build=v3-survival-ae77fa84ac2b';
export { buildItemModel, isPlaceable, PLACEABLE_KINDS };
const POSES = ['point', 'throw', 'grip', 'open'];

// Merges meshes (all below `owner`) into one indexed geometry in owner space, keeping the attributes every
// part has. tint(mesh) -> Color bakes a per-vertex colour, so parts with different flat materials can
// share one vertex-coloured material (one draw call).
function mergeGeometry(T, owner, meshes, tint = null) {
  owner.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(owner.matrixWorld).invert(), M = new T.Matrix4();
  const size = (n) => meshes[0].geometry.attributes[n]?.itemSize;
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => (n === 'color' && tint) || size(n) && meshes.every((m) => m.geometry.attributes[n]?.itemSize === size(n)));
  let verts = 0, idx = 0;
  const parts = meshes.map((m) => {
    const g = m.geometry.clone();
    M.multiplyMatrices(inv, m.matrixWorld); g.applyMatrix4(M);
    const n = g.attributes.position.count, index = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
    if (M.determinant() < 0) for (let i = 0; i + 2 < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    if (tint) { const c = tint(m), a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); }
    const part = { g, index, base: verts }; verts += n; idx += index.length; return part;
  });
  const out = new T.BufferGeometry();
  for (const n of names) {
    const k = n === 'color' && tint ? 3 : size(n), arr = new Float32Array(verts * k);
    for (const { g, base } of parts) { const a = g.attributes[n]; for (let i = 0; i < a.count; i++) for (let j = 0; j < k; j++) arr[(base + i) * k + j] = a.getComponent(i, j); }
    out.setAttribute(n, new T.BufferAttribute(arr, k));
  }
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(idx);
  let o = 0;
  for (const { g, index: ix, base } of parts) { for (const i of ix) index[o++] = i + base; g.dispose(); }
  out.setIndex(new T.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

// Static held model: meshes sharing a material are merged into one (fewer draw calls). Returns the new geometries.
function mergeByMaterial(T, root) {
  const buckets = new Map(), made = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences || o.children.length) return;
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
    const a = o.geometry.attributes, key = o.material.uuid + ':' + ['normal', 'uv', 'color'].filter((n) => a[n]).join();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const mesh = new T.Mesh(mergeGeometry(T, root, list), list[0].material);
    mesh.name = 'merged';
    for (const m of list) m.removeFromParent();
    root.add(mesh); made.push(mesh.geometry);
  }
  return made;
}

const smoothK = (rate, dt) => 1 - Math.exp(-rate * dt); // frame-rate independent smoothing (no per-frame closure)
export function createHands(T, { modelFactory = null } = {}) {
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const DEG = Math.PI / 180;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOutBack = (x) => { const c = 1.6, u = x - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

  const VM_TAN = Math.tan(30 * DEG);                    // viewmodel vertical FOV 60 degrees
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
  // Skin: pinkish sun-tanned, faintly mottled. The scene lights reach the viewmodel from wherever the sun
  // happens to be, so a fixed view-space key term (upper left, toward the eye) adds a soft light-to-shadow
  // fall-off across forearms and round each finger instead of the flat, evenly lit wax look.
  const tx = surfaceTextures(T);
  // Skin also gets a warm under-skin glow where light turns to shadow, and a faint sky rim on edges seen side-on.
  const keyShade = (m, skinLit = false) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float vmKey = clamp(dot(normal, normalize(vec3(-0.45, 0.75, 0.5))) * 0.5 + 0.5, 0.0, 1.0);
        float vmK = vmKey * vmKey * (3.0 - 2.0 * vmKey);
        vec3 vmShade = vec3(mix(0.42, 1.1, vmK));` + (skinLit ? `
        vmShade *= mix(vec3(1.0), vec3(1.14, 0.9, 0.8), clamp(vmK * (1.0 - vmK) * 4.0, 0.0, 1.0) * 0.8);
        vmShade += vec3(0.1, 0.1, 0.12) * pow(1.0 - clamp(normal.z, 0.0, 1.0), 3.0);` : '') + `
        diffuseColor.rgb *= vmShade;`);
    };
    m.customProgramCacheKey = () => (skinLit ? 'vmKeyShadeSkin' : 'vmKeyShade');
    return m;
  };
  const skin = keyShade(mat(0xc89068, 0.6, { emissive: 0x1c0e06, map: tx.skin }));
  const skinPalm = keyShade(mat(0xc08562, 0.64, { emissive: 0x1c0e06, map: tx.skin }));
  const skinTip = keyShade(mat(0xcc8e6c, 0.6, { emissive: 0x1c0e06, map: tx.skin })); // finger ends a touch pinker: fingers read as fingers
  const nail = keyShade(mat(0xd8a48c, 0.38, { emissive: 0x120806 }));
  const crease = mat(0x8e5a3c, 0.8);
  const sleeveMat = keyShade(mat(0x5a7462, 1.0, { map: tx.weave, bumpMap: tx.weave, bumpScale: 1.2 }));
  const cuffMat = keyShade(mat(0x465c4e, 1.0, { map: tx.weave, bumpMap: tx.weave, bumpScale: 1.2 }));
  const ropeMat = mat(0xc4a46c, 1.0, { map: tx.rope, bumpMap: tx.rope, bumpScale: 1.5 });
  const ropeDarkMat = mat(0x8a6e44, 1.0, { map: tx.rope, bumpMap: tx.rope, bumpScale: 1.5 });
  // Baked parts: one vertex-coloured material per surface type (the flat ones above only supply the colours;
  // the baked ones carry the surface textures and the key shade).
  // [look] skin and cloth bake their colour RELATIVE to a base (vertex colour = part / base) and the shared material
  // carries the base, so setLook() recolours every baked hand and sleeve by setting one material colour.
  const BODY_SKIN = new T.Color('#f2c29b');           // avatar.js default skin (dist/look.js PALETTE.skin[0])
  const toneOf = (m) => { const c = m.color.clone(); return new T.Color(c.r / BODY_SKIN.r, c.g / BODY_SKIN.g, c.b / BODY_SKIN.b); };
  const skinTones = [skin, skinPalm, skinTip, nail, crease].map((m) => [m, toneOf(m)]);
  const SLEEVE_BASE = sleeveMat.color.clone();
  const skinV = keyShade(mat(0xffffff, 0.58, { emissive: 0x160805, vertexColors: true, map: tx.skin, bumpMap: tx.skinBump, bumpScale: 0.35 }), true); skinV.color.copy(BODY_SKIN);
  const clothV = keyShade(mat(0xffffff, 1.0, { vertexColors: true, map: tx.weave, bumpMap: tx.weave, bumpScale: 1.2 })); clothV.color.copy(SLEEVE_BASE);
  const ropeV = mat(0xffffff, 1.0, { vertexColors: true, map: tx.rope, bumpMap: tx.rope, bumpScale: 1.5 });
  const tint = (m) => m.material.color;
  const relTo = (base) => (m) => { const c = m.material.color; return new T.Color(c.r / base.r, c.g / base.g, c.b / base.b); };
  const TINT_FOR = new Map([[skinV, relTo(BODY_SKIN)], [clothV, relTo(SLEEVE_BASE)]]);
  const meshesOf = (...objs) => { const out = []; for (const o of objs) o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };
  const bake = (owner, objs, material) => {
    const mesh = new T.Mesh(G(mergeGeometry(T, owner, meshesOf(...objs), TINT_FOR.get(material) ?? tint)), material);
    owner.add(mesh); return mesh;
  };

  // Viewmodel meshes draw in the transparent queue after the camera's depth-clear marker (see game.js),
  // never cast shadows and are never culled. Solid ones skip blending (opaque cost, transparent-queue order).
  const prep = (o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) {
      if (!m.transparent && m.opacity >= 1) m.blending = T.NoBlending;
      m.depthTest = true; m.depthWrite = true; m.transparent = true;
    }
  });
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

  // Fingernail on a finger segment a -> b (b = fingertip): a flat ellipsoid on the side facing `out` (a point the
  // nail faces away from, e.g. the grip axis), set back from the tip. r = finger radius at the tip, w = nail width scale.
  const nailBasis = new T.Matrix4();
  const nailAt = (parent, a, b, from, r, w) => {
    const z = b.clone().sub(a).normalize(), c = b.clone().addScaledVector(z, -r * 1.05);
    const x = c.clone().sub(from); x.addScaledVector(z, -x.dot(z)).normalize();
    const y = V().crossVectors(z, x);
    const mesh = new T.Mesh(sphereGeo, nail);
    mesh.quaternion.setFromRotationMatrix(nailBasis.makeBasis(x, y, z));
    mesh.position.copy(c).addScaledVector(x, r * 0.78);
    mesh.scale.set(r * 0.3, w * 0.55, r * 1.1);
    parent.add(mesh); return mesh;
  };

  // ---------------- hand (right-hand layout; mirrored for left) ----------------
  // Grip axis = local Y through origin, gripR = radius of the gripped object. Back of hand +X, palm -X,
  // wrist +Z, so straight fingers point -Z. Each finger and the thumb are built twice (curled round
  // the grip, and straight); a pose just toggles which one is visible.
  function buildHand(parent, gripR) {
    const k = (gripR + 0.010) / 0.042;
    const P = (aDeg, R, y) => V(R * Math.cos(aDeg * DEG), y, -R * Math.sin(aDeg * DEG));
    const palm = [
      ellipsoid(parent, skin, V(0.016 * k, -0.004, 0.047 * k), 0.028 * k, 0.050, 0.040 * k, -0.22),
      seg(parent, skin, V(0.018 * k, -0.007, 0.086 * k), V(0.012 * k, -0.005, 0.058 * k), 0.027, 0.023), // wrist: palm runs smoothly into the forearm
      ellipsoid(parent, skinPalm, V(-0.002 * k, 0.022, 0.054 * k), 0.015 * k, 0.019, 0.026 * k, 0.3),   // thenar: kept flat so the thumb root does not balloon
    ];
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
      const pip = P(f.a1 + 12, R, f.y), tip = P(f.a2 + 36, R * 0.97, f.y + (i === 0 ? 0.001 : 0));
      // slightly slimmer than the finger spacing, so a thin shadow line separates the fingers
      seg(curl, skin, mcp, pip, f.r * 0.97, f.r * 0.90);
      seg(curl, skinTip, pip, tip, f.r * 0.90, f.r * 0.74);
      nailAt(curl, pip, tip, V(0, tip.y, 0), f.r * 0.74, f.r);       // nail on the outside of the curled fingertip
      if (i < 3) {
        const c = P(f.a1 + 15, R + f.r * 0.8, f.y);
        seg(curl, crease, c.clone().setY(f.y - 0.0052), c.clone().setY(f.y + 0.0052), 0.0013, 0.0013, 6);
      }
      // tight curl into the palm (empty fist, used beside a pointing index)
      const r2 = 0.012 + f.r, k0 = P(-12, r2 + 0.012, f.y), k1 = P(70, r2, f.y), k2 = P(165, r2 * 0.9, f.y);
      seg(tight, skin, mcp, k0.lerp(k1, 0.5), f.r * 1.05, f.r);
      seg(tight, skin, k0, k1, f.r, f.r * 0.92);
      seg(tight, skinTip, k1, k2, f.r * 0.92, f.r * 0.78);
      nailAt(tight, k1, k2, V(0, k2.y, 0), f.r * 0.78, f.r);
      // straight finger: slight natural curl toward the palm, small fan spread
      const e1 = mcp.clone().add(V(-0.010, f.spread * 0.6, -f.len * 0.52));
      const e2 = e1.clone().add(V(-0.012, f.spread * 0.4, -f.len * 0.46));
      seg(ext, skin, mcp, e1, f.r * 1.05, f.r * 0.95);
      seg(ext, skinTip, e1, e2, f.r * 0.95, f.r * 0.78);
      ellipsoid(ext, nail, e2.clone().add(V(0.0045, 0, 0.004)), 0.0035, f.r * 0.62, 0.008);
      seg(ext, crease, e1.clone().add(V(f.r * 0.85, -0.0052, 0)), e1.clone().add(V(f.r * 0.85, 0.0052, 0)), 0.0013, 0.0013, 6);
      parent.add(curl, ext, tight);
      return { curl, ext, tight };
    });
    const thumbCurl = new T.Group(), thumbExt = new T.Group(), thumbTuck = new T.Group();
    const t0 = V(0.0, 0.032, 0.055 * k);
    // grip thumb: lies snug along the grip, wrapping over the index finger rather than bulging off it
    const Rt = gripR + 0.0088;
    const tA = P(238, Rt + 0.004, 0.034), tB = P(200, Rt, 0.040), tC = P(162, Rt * 0.98, 0.042);
    seg(thumbCurl, skin, t0, tA, 0.0128, 0.0108);
    seg(thumbCurl, skin, tA, tB, 0.0104, 0.0094);
    seg(thumbCurl, skinTip, tB, tC, 0.0094, 0.0078);
    nailAt(thumbCurl, tB, tC, V(0, tC.y, 0), 0.0078, 0.0105);
    const u1 = V(-0.026 * k, 0.062, 0.030 * k), u2 = V(-0.040 * k, 0.083, 0.004 * k);
    seg(thumbExt, skin, t0, u1, 0.0135, 0.0118);
    seg(thumbExt, skinTip, u1, u2, 0.0118, 0.0094);
    const w1 = V(-0.024 * k, 0.030, 0.026 * k), w2 = V(-0.026 * k, 0.012, 0.004 * k);   // tucked over the curled middle finger
    seg(thumbTuck, skin, t0, w1, 0.0135, 0.0118);
    seg(thumbTuck, skinTip, w1, w2, 0.0118, 0.0094);
    parent.add(thumbCurl, thumbExt, thumbTuck);
    // Each pose is baked into one mesh (palm + its finger and thumb variants): one draw call per hand.
    const poses = {
      grip: [fingers.map((f) => f.curl), thumbCurl],
      open: [fingers.map((f) => f.ext), thumbExt],
      point: [fingers.map((f, i) => (i === 0 ? f.ext : f.tight)), thumbTuck],
      fist: [fingers.map((f) => f.tight), thumbTuck],                       // rope grip: closed round a thin line
    };
    const parts = [...parent.children];
    for (const p in poses) poses[p] = bake(parent, [...palm, ...poses[p][0], poses[p][1]], skinV);
    for (const o of parts) o.removeFromParent();
    return { wristPt: V(0.018 * k, -0.006, 0.084 * k), poses };
  }
  function setPose(H, pose) {
    for (const p in H.poses) H.poses[p].visible = p === pose;
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
    const forearm = seg(frame, skin, at(-0.006), at(0.24), 0.027, 0.042, 12); // slimmer at the wrist, tucked into the hand
    const cuff = seg(frame, cuffMat, at(0.19), at(0.225), 0.047, 0.050, 14);    // rolled cuff
    const sleeve = seg(frame, sleeveMat, at(0.23), at(0.60), 0.051, 0.070, 14); // sleeve (runs off-screen)
    const fa = bake(frame, [forearm], skinV); bake(frame, [cuff, sleeve], clothV);
    {   // soft forearm shading: darker toward the elbow and on the underside (baked into vertex colours)
      const pos = fa.geometry.attributes.position, col = fa.geometry.attributes.color, d = V();
      const down = toLocal(V(0, -1, 0)); down.addScaledVector(Fl, -down.dot(Fl)).normalize();
      for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).sub(W);
        const s = clamp01(d.dot(Fl) / 0.24), under = clamp01(d.addScaledVector(Fl, -d.dot(Fl)).normalize().dot(down));
        const m = (1 - 0.20 * s) * (1 - 0.16 * under);
        col.setXYZ(i, col.getX(i) * m, col.getY(i) * m * 0.98, col.getZ(i) * m * 0.98);
      }
    }
    for (const o of [forearm, cuff, sleeve]) o.removeFromParent();

    return { pose, frame, wrist, hand, H, qBase, toLocal, basePos: basePos.clone(), r, u, f };
  }

  const R = buildArm({ name: 'rightArm', basePos: V(0.40, -0.35, -0.74), u: V(0.27, 0.95, -0.15), F: V(0.35, -0.50, 1.0), gripR: 0.025, mirror: false });
  const L = buildArm({ name: 'leftArm', basePos: V(-0.37, -0.36, -0.74), u: V(0.85, 0.30, 0.10), F: V(-0.40, -0.50, 1.0), gripR: 0.028, mirror: true });
  lagRoot.add(R.pose, L.pose);
  // Pointing frames: hand half-prone, index aimed just below the crosshair. The left one is the mirror
  // image (x -> -x of the same grip axis / forearm direction; the arm frame itself is already mirrored).
  const pointFrame = (A, sx) => {
    const u = V(-0.85 * sx, 0.45, -0.10).normalize(), F = V(0.80 * sx, -0.50, 0.55).normalize();
    const f = F.clone().addScaledVector(u, -F.dot(u)).normalize(), r = V().crossVectors(u, f).normalize();
    A.qPoint = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r, u, f));
    A.pointPos = V(0.25 * sx, -0.25, -0.62);
  };
  pointFrame(R, 1); pointFrame(L, -1);
  // Left rope grip while reeling: the left fist closes on the line just ahead of the right one (hand over hand).
  {
    const u = V(-0.30, 0.25, -1.0).normalize(), F = V(-0.45, -0.75, 0.55).normalize();
    const f = F.clone().addScaledVector(u, -F.dot(u)).normalize(), r = V().crossVectors(u, f).normalize();
    L.qRope = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r, u, f));
    L.ropePos = V(0.28, -0.235, -0.85);
  }

  // ---------------- held items (right fist; decorations ride on the left fist) ----------------
  const toolHolder = new T.Group(); toolHolder.name = 'toolHolder';
  R.hand.add(toolHolder);
  {
    const Dl = R.toLocal(V(-0.6, 0.0, -0.8).normalize());     // hook bend opens forward, a little left
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
      // Own resources of a shared (factory) model: merged geometry and material copies, so prep() never
      // changes the materials world copies of the same cached model use.
      const own = kind === 'fishingrod' ? [] : mergeByMaterial(T, item);   // the rod keeps its animated parts
      if (item.userData.shared) {
        const copies = new Map();
        item.traverse((o) => {
          if (!o.isMesh) return;
          const one = (x) => { if (!copies.has(x)) { const c = x.clone(); copies.set(x, c); own.push(c); } return copies.get(x); };
          o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        });
      }
      pivot.add(item); prep(pivot); pivot.visible = false;
      (h.hand === 'left' ? leftHolder : toolHolder).add(pivot);
      m = { pivot, item, own, qBase: pivot.quaternion.clone(), rope: null };
      const hg = kind === 'glidehandle' && item.getObjectByName('glidehandle');
      if (hg) { // [zipline] a short strap from the wheel up to the line, shown while riding (own geometry + material)
        const rope = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, 1.1, 6).translate(0, 0.25 + 0.55, 0), ropeMat.clone());
        rope.name = 'rideStrap'; rope.visible = false; hg.add(rope); prep(rope); m.rope = rope;
      }
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
  { const parts = [...spool.children]; bake(spool, parts, ropeV); for (const o of parts) o.removeFromParent(); }
  const fwdL = L.toLocal(V(0, 0, -1));
  const tipLocal = V(0, 0.072, 0).addScaledVector(fwdL, 0.022);
  const lead = new T.Mesh(G(new T.TubeGeometry(new T.CatmullRomCurve3([V(0, -0.02, 0), V(0, 0.03, 0), V(0, 0.058, 0).addScaledVector(fwdL, 0.006), tipLocal.clone()]), 16, 0.0085, 7, false)), ropeMat);
  L.hand.add(lead);
  const handTip = new T.Object3D(); handTip.name = 'handTip';
  handTip.position.copy(tipLocal);
  L.hand.add(handTip);
  const ropeTip = new T.Object3D(); ropeTip.name = 'ropeTip';     // where the line leaves the right rope-grip fist
  ropeTip.position.set(0, 0.045, 0);
  R.hand.add(ropeTip);
  prep(lagRoot);

  // ---------------- animation state (weights only; transforms are rebuilt every frame) ----------------
  // dip: 0 = arms up, 1 = lowered out of view. A swap lowers, switches model/pose at the bottom, raises.
  const REEL_HZ = 2.5;
  const st = { hookOut: false, leftW: 0, walkW: 0, reelW: 0, rideW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, spool: 0, t: 0,
    shown: null, target: null, poseOverride: null, pendingPose: null, ptR: 0, ptL: 0, lowering: false, dip: 1, down: 1, raise: 1, lagX: 0, lagY: 0, lastYaw: null, lastPitch: 0 };
  const qOff = new T.Quaternion(), eul = new T.Euler(0, 0, 0, 'XYZ'), qSwing = new T.Quaternion(), AX = V(1, 0, 0);
  const last = { lag: [0, 0] };
  setPose(L.H, 'grip');

  // Resolved pose of the shown item ('point' | 'throw' | 'grip' | 'open') and which hand points.
  const poseOf = (kind) => st.poseOverride || (kind ? holdFor(kind).pose : 'grip');
  const handPoses = { R: '', L: '' };
  function applyFingers(pose, ropeGrip, leftRope) {
    const pointer = pose !== 'point' || !st.shown ? null : holdFor(st.shown).hand === 'left' ? 'R' : 'L';
    const r = pointer === 'R' ? 'point' : ropeGrip ? 'fist' : pose === 'open' ? 'open' : 'grip', l = pointer === 'L' ? 'point' : leftRope ? 'fist' : 'grip';
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
    st.poseOverride = st.pendingPose;  // the new item comes up in its own pose
    st.raise = 0; st.lowering = false;
  }

  const qA = new T.Quaternion(), pA = V();
  const qB = new T.Quaternion();
  const qRideA = new T.Quaternion(), qRideB = new T.Quaternion(), vRideUp = V(), vRideStem = V(), Y_UP = V(0, 1, 0), RIDE_UP = V(0, 1, -0.2).normalize(); // [zipline]
  function applyArm(A, px, py, pz, rx, ry, rz, wx, wy, wz, w = 0, wRope = 0) {
    pA.lerpVectors(A.basePos, A.pointPos, w);
    qB.slerpQuaternions(A.qBase, A.qPoint, w);
    if (wRope > 0) { pA.lerp(A.ropePos, wRope); qB.slerp(A.qRope, wRope); }
    A.pose.position.set(pA.x + px, pA.y + py, pA.z + pz);
    eul.set(rx, ry, rz); qOff.setFromEuler(eul);
    A.pose.quaternion.copy(qOff).multiply(qB);
    A.wrist.rotation.set(wx, wy, wz);
  }

  function update(params = {}) {
    const dt = Math.min(Math.max(params.dt ?? 1 / 60, 0), 0.1);
    st.t += dt;
    const t = params.time ?? st.t;
    const charge0 = clamp01(params.charge || 0);
    const casting = clamp01(params.casting || 0);
    const pq = clamp01(params.paddle || 0) > 0 ? 1 - clamp01(params.paddle) : 1; // paddle stroke phase 0 -> 1
    const pDip = Math.sin(Math.PI * pq), pSweep = pDip * (2 * pq - 1);       // dip in, then sweep back (-z = forward)
    const reeling = !!params.reeling, walking = !!params.walking;
    const amp = clamp01(params.motion ?? 0.35) / 0.35;

    // ---- swap / pose change: ease down, switch while hidden, pop back up
    if (st.shown !== st.target) {
      if (!st.lowering) { st.lowering = true; st.dip = Math.sqrt(clamp01(st.down)); }
      st.dip = Math.min(1, st.dip + dt / 0.13);
      if (st.dip >= 1) swapNow();
    } else if (st.lowering) {  // swap cancelled (switched back mid-lower): ease back up from where the arms stopped
      st.dip = Math.max(0, st.dip - dt / 0.13);
      if (st.dip <= 0) { st.lowering = false; st.raise = 1; }
    } else if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);
    if (st.shown === st.target) st.poseOverride = st.pendingPose;  // a pose for the next item waits for its swap
    const down = st.down = st.shown === null ? 1 : st.lowering ? st.dip * st.dip : 1 - easeOutBack(st.raise);
    root.visible = st.shown !== null || st.target !== null;
    // Own fixed 60 degree projection: undo the world camera's FOV in camera-space x/y (depth untouched), so
    // the FOV setting never resizes the hands and they frame the same on every setting.
    if (Number.isFinite(params.fov) && params.fov > 0) { const s = Math.tan(params.fov * DEG / 2) / VM_TAN; root.scale.set(s, s, 1); }
    const isHook = st.shown === 'hook', hasHookOut = st.hookOut = isHook && !!params.hasHookOut;
    const leftRope = hasHookOut && st.reelW > 0.35;              // both fists on the line while reeling
    const pose = poseOf(st.shown), pointer = applyFingers(pose, hasHookOut, leftRope);
    const charge = pose === 'throw' ? 1 : isHook ? charge0 : 0;
    // pointing blends in; a left hand that only shows up to point slides in from below
    st.ptR += ((pointer === 'R' ? 1 : 0) - st.ptR) * smoothK(12, dt);
    st.ptL += ((pointer === 'L' ? 1 : 0) - st.ptL) * smoothK(12, dt);
    // The left hand (rope coil) only rises while the hook is busy: winding up, casting, out or reeling.
    // Idle it stays tucked below the frame, so one right hand shows and nothing sits over the hotbar.
    const leftBusy = !!st.shown && (holdFor(st.shown).hand === 'left' ||
      (isHook && (charge0 > 0.02 || casting > 0 || hasHookOut || reeling)));
    st.leftW += ((leftBusy ? 1 : 0) - st.leftW) * smoothK(leftBusy ? 14 : 4, dt);
    const lIn = Math.max(st.leftW, st.ptL);
    L.pose.visible = st.shown !== null && lIn > 0.02;
    const rightIdle = !!st.shown && holdFor(st.shown).hand === 'left', rIn = rightIdle ? st.ptR : 1;   // empty right hand stays down
    R.pose.visible = st.shown !== null && (!rightIdle || st.ptR > 0.02);
    coil.visible = lead.visible = isHook && pointer !== 'L' && !leftRope;

    // ---- look lag: hands trail camera turns a little, then settle
    if (Number.isFinite(params.yaw) && Number.isFinite(params.pitch)) {
      if (st.lastYaw === null) { st.lastYaw = params.yaw; st.lastPitch = params.pitch; }
      let dy = params.yaw - st.lastYaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      const dp = params.pitch - st.lastPitch;
      st.lastYaw = params.yaw; st.lastPitch = params.pitch;
      const inv = dt > 0 ? 1 / dt : 0, cap = 0.07 * amp;
      const tx = Math.max(-cap, Math.min(cap, -dp * inv * 0.012)), ty = Math.max(-cap, Math.min(cap, -dy * inv * 0.012));
      st.lagX += (tx - st.lagX) * smoothK(9, dt); st.lagY += (ty - st.lagY) * smoothK(9, dt);
    }
    lagRoot.rotation.set(st.lagX, st.lagY, -st.lagY * 0.6);

    st.walkW += ((walking ? 1 : 0) - st.walkW) * smoothK(5, dt);
    st.reelW += ((reeling ? 1 : 0) - st.reelW) * smoothK(9, dt);
    st.rideW += ((params.riding ? 1 : 0) - st.rideW) * smoothK(8, dt); // [zipline] fist up on the glide line
    st.outW += ((hasHookOut ? 1 : 0) - st.outW) * smoothK(7, dt);
    st.toolW = hasHookOut ? 0 : st.toolW + (1 - st.toolW) * smoothK(8, dt);
    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) st.releaseCharge = Math.max(st.chargeS, charge, 0.35);
    st.lastCasting = casting;
    st.chargeS += (charge - st.chargeS) * smoothK(charge > st.chargeS ? 22 : 14, dt);

    // ---- cast / strike curve: p 0 (just released) -> 1 (done)
    const p = casting > 0 ? 1 - casting : 1;
    const chargeEff = casting > 0 ? st.releaseCharge * (1 - smooth(0, 0.16, p)) : st.chargeS;
    const forward = casting > 0 ? smooth(0, 0.2, p) * (1 - smooth(0.38, 1, p)) : 0;
    const recoil = casting > 0 ? Math.sin(Math.PI * clamp01((p - 0.5) / 0.5)) * 0.12 : 0;
    const a = (forward - recoil) * (isHook ? 1 : 0.55);
    const ce = isHook || pose === 'throw' ? Math.sin(chargeEff * Math.PI / 2) : 0;
    const trem = smooth(0.75, 1, chargeEff) * (casting > 0 ? 0 : 1) * 0.0025 * (Math.sin(t * 37) + 0.6 * Math.sin(t * 23.3));

    // ---- idle + walk
    const br = Math.sin(t * Math.PI * 2 * 0.22);
    const brL = Math.sin(t * Math.PI * 2 * 0.22 + 0.6);
    const ph = t * Math.PI * 2 * 0.85;
    const wA = st.walkW * amp * (1 - 0.6 * ce);
    const bob = 0.5 - 0.5 * Math.cos(2 * ph);

    // ---- reel rhythm: hand over hand, one pull stroke every 0.4 s (2.5 Hz), the hands half a cycle apart.
    // stroke 0 = reached forward, 1 = pulled in to the body.
    const stroke = (q) => { q = ((q % 1) + 1) % 1; return q < 0.5 ? smooth(0, 0.5, q) : 1 - smooth(0.5, 1, q); };
    const pullR = stroke(t * REEL_HZ / 2), pull = stroke(t * REEL_HZ / 2 + 0.5);
    const rW = st.reelW, oW = st.outW, tw = st.toolW, zW = st.rideW;
    const catchDip = hasHookOut ? 0 : (1 - tw);
    const hold = st.shown ? holdFor(st.shown) : {}, nW = (1 - oW) * (1 - st.ptR), arm = hold.arm || [0, 0, 0];

    // ---- right arm
    // hook out: the fist closes on the line and comes in toward the middle; reeling pulls it back and down
    const rpx = 0.03 * ce - 0.10 * a + 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.7) - 0.03 * oW + (0.03 * pullR - 0.015) * rW + trem;
    const rpy = 0.06 * a - 0.012 * wA * bob + 0.0045 * amp * br + 0.035 * oW + (0.015 - 0.045 * pullR) * rW - 0.025 * catchDip + trem * 0.7 - 0.45 * down - 0.45 * (1 - rIn);
    const rpz = 0.04 * ce - 0.20 * a - 0.04 * oW + (0.10 * pullR - 0.05) * rW;
    const rrx = 0.35 * ce - 0.65 * a + 0.010 * amp * br - 0.15 * oW + 0.30 * pullR * rW + 0.12 * catchDip - 0.5 * down;
    const rry = 0.20 * ce - 0.15 * a;
    const rrz = -0.20 * ce + 0.25 * a + 0.03 * wA * Math.sin(ph) + 0.15 * pullR * rW + 0.25 * down;
    const rwx = 0.30 * ce - 0.45 * a - 0.10 * oW + 0.22 * pullR * rW - (hold.tilt || 0) * nW;
    const rwz = -0.15 * ce + 0.12 * a;
    applyArm(R, rpx + arm[0] * nW - 0.04 * pDip - 0.10 * zW, rpy + arm[1] * nW - 0.035 * pDip + 0.44 * zW, rpz + arm[2] * nW + 0.09 * pSweep - 0.06 * zW, rrx - 0.12 * pDip + 0.75 * zW, rry, rrz + 0.12 * pDip, rwx + 0.22 * pSweep, 0, rwz, smooth(0, 1, st.ptR)); // [paddle] dip + sweep; [zipline] zW raises the fist
    // [zipline] on the line the handle swings round so its wheel stem points up at the rope (and the strap shows)
    const gh = st.shown === 'glidehandle' ? mounts.get('glidehandle') : null;
    if (gh) {
      if (zW > 0.01) {
        toolHolder.updateWorldMatrix(true, false);
        root.getWorldQuaternion(qRideA).invert().multiply(toolHolder.getWorldQuaternion(qRideB)).invert(); // eye space -> holder space
        vRideUp.copy(RIDE_UP).applyQuaternion(qRideA);
        vRideStem.copy(Y_UP).applyQuaternion(gh.qBase);
        qRideB.setFromUnitVectors(vRideStem, vRideUp).multiply(gh.qBase);
        gh.pivot.quaternion.slerpQuaternions(gh.qBase, qRideB, smooth(0, 1, zW));
      } else gh.pivot.quaternion.copy(gh.qBase);
      if (gh.rope) gh.rope.visible = zW > 0.6;
    }

    // ---- left arm
    const lw = rW * oW;                                          // left fist on the line, reaching and pulling in turn
    const lpx = 0.02 * ce + 0.02 * a + (0.015 * pull + 0.03 * oW) * rW * (1 - lw) - 0.010 * wA * Math.sin(ph) + 0.002 * amp * Math.sin(t * 0.63 + 1);
    const lpy = 0.03 * ce + 0.02 * a + (0.010 - 0.035 * pull) * rW * (1 - lw) - 0.012 * wA * (0.5 - 0.5 * Math.cos(2 * ph + Math.PI)) + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn);
    const lpz = -0.03 * ce - 0.06 * a + (0.09 * pull - 0.03) * rW * (1 - lw);
    const lrx = -0.10 * ce + 0.30 * pull * rW + 0.008 * amp * brL - 0.4 * down;
    const lry = 0.08 * ce;
    const lrz = -0.15 * pull * rW - 0.03 * wA * Math.sin(ph) - 0.2 * down;
    applyArm(L, lpx + lw * 0.03 * pull, lpy - lw * 0.04 * pull, lpz + lw * 0.08 * pull, lrx - lw * 0.25 * pull, lry, lrz + lw * 0.10 * pull,
      0.22 * pull * rW * (1 - lw) - 0.08 * ce, 0, -0.10 * ce + 0.12 * a, smooth(0, 1, st.ptL), lw);

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

    last.lag[0] = st.lagX; last.lag[1] = st.lagY;
    last.held = st.shown; last.target = st.target; last.pose = pose; last.pointHand = pointer; last.dip = down; // written in place: no per-frame object
    last.charge = chargeEff; last.chargeEased = ce; last.throw = a;
    last.pull = pull * rW; last.pullR = pullR * rW; last.rightHand = handPoses.R; last.leftHand = handPoses.L; last.ropeW = rW * oW;
    last.walkW = st.walkW; last.reelW = rW; last.hookOutW = oW; last.toolW = tw; last.spool = st.spool; last.models = mounts.size;
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
      else m.own.forEach((x) => extra.add(x));
    }
    for (const x of extra) x.dispose();
    mounts.clear();
  }

  update({ dt: 0, time: 0 });
  return {
    group: root, handTip, update, dispose, state: last,
    setHeld(kind) { st.target = kind ? String(kind) : null; },
    setPose(pose) { st.pendingPose = POSES.includes(pose) ? pose : null; },
    setModelFactory(fn) {
      factory = typeof fn === 'function' ? fn : null;
      const shown = st.shown; dropMounts();
      if (shown) { const m = mountFor(shown); if (m) m.pivot.visible = true; }
    },
    itemModel(kind) { const m = mountFor(kind); return m ? (m.item.userData.model || m.item) : null; },
    ropeAnchor() {
      if (st.shown === 'fishingrod') { const rod = mounts.get('fishingrod'); if (rod?.item.userData.model?.userData.tipNode) return rod.item.userData.model.userData.tipNode; }
      return st.hookOut ? ropeTip : handTip;                    // line runs out of the right fist while the hook is out
    },
    preload(kinds) { for (const k of kinds) mountFor(k); },
    setLook(colors) {
      const { skin: skinHex, shirt } = colors && typeof colors === 'object' ? colors : {};
      // The viewmodel skin keeps its own darker, warmer shading: each skin material is the chosen tone scaled per
      // channel by (old hard-coded colour / default body skin), so the default tone gives exactly the old colours.
      if (typeof skinHex === 'string') for (const [m, c] of skinTones) m.color.set(skinHex).multiply(c);
      if (typeof shirt === 'string') { sleeveMat.color.set(shirt); cuffMat.color.set(shirt).multiplyScalar(0.75); }
      if (typeof skinHex === 'string') skinV.color.set(skinHex);   // baked hands (vertex colours are relative to BODY_SKIN)
      if (typeof shirt === 'string') clothV.color.set(shirt);      // baked sleeve + cuff (relative to the default sleeve)
    },
  };
}
