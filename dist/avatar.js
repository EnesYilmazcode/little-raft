// Friendly low-poly sailor avatar for Little Raft.
// createAvatar(T, colorOrLook) -> THREE.Group
//   T           : the THREE namespace (import * as T from './vendor/three.module.js')
//   colorOrLook : a shirt / hat-band colour (string or anything THREE.Color accepts; rest default, straw hat), or a
//                 Look object {shirt, trousers, skin, hair, hat} of palette indices (dist/look.js, cleaned here).
//                 group.userData.look is the cleaned look (null on the colour path).
// Feet rest at y = 0, head centred at y ~1.6, eyes at y ~1.65, facing +Z.
// group.userData.setHeld(kind)  shows a small model of the held item in the right hand
//   (hook, hammer, fishingrod, wood, leaf, scrap, plastic, fish, decor kinds; anything else -> empty hand)
// group.userData.animate(dt, {speed, swimming, pitch})  walk / swim cycle, arm raised while holding.
// All geometries and materials are created per avatar and owned by it (held models lazily, once per kind);
// call group.userData.dispose() to free them.

import { cleanLook, lookColors } from './look.js?build=v3-survival-ae77fa84ac2b';

// Hat builders: each adds children to the rigid `hat` group on the head (origin 0.115 above the head centre,
// tipped back 0.12 rad). Own low-poly art, plain or flatShading materials only so bakeAvatar keeps ~8 draw calls.
const FLOWER_PETALS = ['#f59ab8', '#ffe27a', '#fdfaf2'];
const lit = (T, c, k) => { const o = new T.Color(c).multiplyScalar(k); o.r = Math.min(1, o.r); o.g = Math.min(1, o.g); o.b = Math.min(1, o.b); return o; };
const HAT_BUILD = {
  straw(T, hat, add, geo, M) { // today's sunhat, verbatim
    add(hat, geo(new T.CylinderGeometry(0.34, 0.35, 0.025, 14)), M.straw, 0, 0, 0, 'brim');
    add(hat, geo(new T.CylinderGeometry(0.15, 0.18, 0.15, 12)), M.straw, 0, 0.085, 0, 'crown');
    add(hat, geo(new T.CylinderGeometry(0.183, 0.186, 0.045, 12)), M.band, 0, 0.04, 0, 'band');
  },
  none() {},
  beanie(T, hat, add, geo, M, mat, C) {
    const knit = mat(lit(T, C.shirt, 0.8), { roughness: 0.98 });
    const dome = add(hat, geo(new T.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), knit, 0, -0.035, 0, 'crown');
    dome.scale.y = 0.85;
    const cuff = add(hat, geo(new T.TorusGeometry(0.198, 0.03, 6, 16)), knit, 0, -0.03, 0, 'band');
    cuff.rotation.x = Math.PI / 2;
    add(hat, geo(new T.SphereGeometry(0.045, 8, 6)), M.stripe, 0, 0.145, 0, 'pompom');
  },
  bucket(T, hat, add, geo, M, mat, C) {
    const cloth = mat(lit(T, C.trousers, 1.1), { roughness: 0.92 });
    add(hat, geo(new T.CylinderGeometry(0.17, 0.19, 0.12, 14)), cloth, 0, 0.02, 0, 'crown');
    add(hat, geo(new T.CylinderGeometry(0.2, 0.27, 0.05, 16)), cloth, 0, -0.045, 0, 'brim');
  },
  flower(T, hat, add, geo, M, mat) {
    const vine = mat('#5f9f4f', { roughness: 0.85 });
    const ring = add(hat, geo(new T.TorusGeometry(0.178, 0.018, 6, 16)), vine, 0, -0.02, 0, 'band');
    ring.rotation.x = Math.PI / 2;
    const petals = FLOWER_PETALS.map(c => mat(c, { roughness: 0.8 }));
    const bloom = geo(new T.SphereGeometry(0.034, 8, 6));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const f = add(hat, bloom, petals[i % 3], Math.sin(a) * 0.178, -0.012, Math.cos(a) * 0.178, 'flower');
      f.scale.set(1, 0.7, 1);
    }
  },
};

export function createAvatar(T, colorOrLook) {
  const color = colorOrLook;
  const isLook = !!colorOrLook && typeof colorOrLook === 'object' && !colorOrLook.isColor && !Array.isArray(colorOrLook);
  const look = isLook ? cleanLook(colorOrLook) : null;
  const C = look ? lookColors(look) : { shirt: color === undefined || color === null ? '#efae55' : color, trousers: '#2f4a6b', skin: '#f2c29b', hair: '#6b4226' };
  const root = new T.Group();
  root.name = 'avatar';

  const geos = [];
  const mats = [];
  const geo = (g) => { geos.push(g); return g; };
  const mat = (c, opts) => {
    const m = new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0 }, opts || {}));
    mats.push(m);
    return m;
  };

  const shirtColor = new T.Color(C.shirt);
  const bandColor = shirtColor.clone().multiplyScalar(0.72);

  // ---- shared per-avatar materials ----
  const M = {
    skin: mat(C.skin, { roughness: 0.85 }),
    shirt: mat(shirtColor),
    stripe: mat('#fbf7ee'),
    shorts: mat(C.trousers),
    shoe: mat('#5a3d2b'),
    eye: mat('#262a33', { roughness: 0.35 }),
    shine: mat('#ffffff', { roughness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.4 }),
    cheek: mat('#f39b93', { roughness: 0.9 }),
    smile: mat('#a8433a', { roughness: 0.6 }),
    hair: mat(C.hair, { roughness: 0.9 }),
    straw: mat('#ecc96f', { roughness: 0.95, flatShading: true }),
    band: mat(bandColor),
    pack: mat('#d9833f', { roughness: 0.85 }),
    packDark: mat('#a85f2a', { roughness: 0.85 }),
  };

  const add = (parent, geometry, material, x, y, z, name) => {
    const m = new T.Mesh(geometry, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    if (name) m.name = name;
    parent.add(m);
    return m;
  };

  // ---- torso ----
  const BODY_Z = 0.76; // flatten torso front-to-back
  const shirt = add(root, geo(new T.CylinderGeometry(0.2, 0.22, 0.45, 10)), M.shirt, 0, 1.15, 0, 'shirt');
  shirt.scale.z = BODY_Z;
  const stripe = add(root, geo(new T.CylinderGeometry(0.214, 0.216, 0.045, 10)), M.stripe, 0, 1.06, 0, 'stripe');
  stripe.scale.z = BODY_Z;
  const waist = add(root, geo(new T.CylinderGeometry(0.22, 0.23, 0.2, 10)), M.shorts, 0, 0.85, 0, 'shorts');
  waist.scale.z = BODY_Z + 0.02;
  add(root, geo(new T.CylinderGeometry(0.07, 0.08, 0.1, 8)), M.skin, 0, 1.4, 0, 'neck');

  // ---- legs (pivot at hip) ----
  const shortLegGeo = geo(new T.CylinderGeometry(0.1, 0.11, 0.25, 8));
  const legGeo = geo(new T.CylinderGeometry(0.065, 0.058, 0.5, 8));
  const shoeGeo = geo(new T.SphereGeometry(0.075, 10, 6));
  const KNEE = 0.3; // knee pivot, below the hip
  const makeLeg = (side) => {
    const hip = new T.Group();
    hip.name = side < 0 ? 'leftLeg' : 'rightLeg';
    hip.position.set(0.1 * side, 0.8, 0);
    add(hip, shortLegGeo, M.shorts, 0, -0.125, 0);
    const knee = new T.Group(); // shin + shoe pivot (co-op sitting bends it); rest pose matches the old straight leg
    knee.name = side < 0 ? 'leftKnee' : 'rightKnee';
    knee.position.set(0, -KNEE, 0); hip.add(knee);
    add(knee, legGeo, M.skin, 0, -0.47 + KNEE, 0);
    const shoe = add(knee, shoeGeo, M.shoe, 0, -0.755 + KNEE, 0.035);
    shoe.scale.set(1, 0.6, 1.5); // bottom lands exactly at y = 0
    root.add(hip);
    hip.userData.knee = knee;
    return hip;
  };
  // Avatar faces +Z, so its left side is +X.
  const leftLeg = makeLeg(1);
  const rightLeg = makeLeg(-1);

  // ---- arms (pivot at shoulder) ----
  const sleeveGeo = geo(new T.SphereGeometry(0.085, 10, 8));
  const armGeo = geo(new T.CylinderGeometry(0.052, 0.048, 0.42, 8));
  const handGeo = geo(new T.SphereGeometry(0.06, 10, 8));
  const makeArm = (side) => {
    const shoulder = new T.Group();
    shoulder.name = side > 0 ? 'leftArm' : 'rightArm';
    shoulder.position.set(0.25 * side, 1.33, 0);
    shoulder.rotation.z = 0.12 * side; // relaxed, slightly away from body
    const sleeve = add(shoulder, sleeveGeo, M.shirt, 0, -0.03, 0);
    sleeve.scale.set(1, 1.25, 1);
    add(shoulder, armGeo, M.skin, 0, -0.25, 0);
    const hand = add(shoulder, handGeo, M.skin, 0, -0.5, 0.01);
    root.add(shoulder);
    shoulder.userData.hand = hand;
    return shoulder;
  };
  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);

  // ---- head ----
  const R = 0.19;
  const head = new T.Group();
  head.name = 'head';
  head.position.set(0, 1.6, 0);
  root.add(head);
  add(head, geo(new T.SphereGeometry(R, 16, 12)), M.skin, 0, 0, 0, 'face');

  // hair cap tilted back so the forehead stays visible under the hat
  const hair = add(head, geo(new T.SphereGeometry(R * 1.04, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), M.hair, 0, 0.005, -0.005, 'hair');
  hair.rotation.x = -0.6;

  const earGeo = geo(new T.SphereGeometry(0.045, 8, 6));
  for (const s of [-1, 1]) {
    const ear = add(head, earGeo, M.skin, s * 0.185, -0.005, -0.01);
    ear.scale.set(0.55, 1, 0.8);
  }
  add(head, geo(new T.SphereGeometry(0.028, 8, 6)), M.skin, 0, 0.005, R - 0.002, 'nose');

  const eyeGeo = geo(new T.SphereGeometry(0.028, 10, 8));
  const shineGeo = geo(new T.SphereGeometry(0.009, 6, 4));
  const cheekGeo = geo(new T.SphereGeometry(0.032, 8, 6));
  for (const s of [-1, 1]) {
    const eye = add(head, eyeGeo, M.eye, s * 0.066, 0.05, 0.164);
    eye.scale.set(0.9, 1.15, 0.7);
    add(head, shineGeo, M.shine, s * 0.066 + 0.009, 0.062, 0.186);
    const cheek = add(head, cheekGeo, M.cheek, s * 0.112, -0.03, 0.148);
    cheek.scale.set(1, 0.7, 0.45);
    cheek.rotation.y = s * 0.6;
  }

  // smile: lower half of a torus, tipped to follow the face curve
  const smile = add(head, geo(new T.TorusGeometry(0.052, 0.011, 6, 12, Math.PI)), M.smile, 0, -0.035, 0.172, 'smile');
  smile.rotation.set(-0.35, 0, Math.PI);

  // ---- hat (straw sunhat by default; builders in HAT_BUILD) ----
  const hat = new T.Group();
  hat.name = 'hat';
  hat.position.set(0, 0.115, -0.01);
  hat.rotation.x = -0.12;
  head.add(hat);
  HAT_BUILD[look ? look.hat : 'straw'](T, hat, add, geo, M, mat, C);

  // ---- compact backpack ----
  const backZ = -(0.21 * BODY_Z);
  add(root, geo(new T.BoxGeometry(0.3, 0.32, 0.14)), M.pack, 0, 1.14, backZ - 0.07, 'backpack');
  add(root, geo(new T.BoxGeometry(0.31, 0.1, 0.15)), M.packDark, 0, 1.27, backZ - 0.072);
  add(root, geo(new T.BoxGeometry(0.18, 0.1, 0.035)), M.packDark, 0, 1.06, backZ - 0.155);
  const strapGeo = geo(new T.BoxGeometry(0.04, 0.34, 0.02));
  for (const s of [-1, 1]) {
    const strap = add(root, strapGeo, M.packDark, s * 0.1, 1.2, 0.158);
    strap.rotation.x = -0.05;
  }

  // ---- held item (third-person scale, built on first use, kept per kind) ----
  // Grip space: hand at origin, handle along +Z (a closed fist), so with the arm raised forward
  // tools point up and ahead of the avatar.
  const grip = new T.Group();
  grip.name = 'held';
  grip.position.set(0, -0.52, 0.03);
  grip.scale.setScalar(1.35);
  rightArm.add(grip);
  const H = {
    wood: mat('#b98a55', { roughness: 0.9 }), woodDark: mat('#8a6239', { roughness: 0.9 }),
    rope: mat('#d8c28a', { roughness: 1 }), metal: mat('#9aa4ab', { roughness: 0.4, metalness: 0.6 }),
    leaf: mat('#5f9f4f', { roughness: 0.8, side: T.DoubleSide }), plastic: mat('#e6eef2', { roughness: 0.5 }),
    fish: mat('#6fa3c7', { roughness: 0.5 }), cloth: mat('#f3ead6', { roughness: 0.9, side: T.DoubleSide }),
    lamp: mat('#ffd27a', { emissive: '#ffb347', emissiveIntensity: 0.8 }),
  };
  const box = (g, w, h, d, m, x, y, z) => add(g, geo(new T.BoxGeometry(w, h, d)), m, x, y, z);
  const rod = (g, r, len, m, x, y, z, rx = Math.PI / 2) => { const c = add(g, geo(new T.CylinderGeometry(r, r, len, 6)), m, x, y, z); c.rotation.x = rx; return c; };
  const BUILD = {
    hook(g) { // plank handle, rope wrap, three metal tines
      rod(g, 0.022, 0.42, H.wood, 0, 0, 0.12);
      rod(g, 0.026, 0.1, H.rope, 0, 0, 0);
      for (let i = -1; i <= 1; i++) { const t = box(g, 0.018, 0.018, 0.12, H.metal, i * 0.035, 0.03, 0.36); t.rotation.x = -0.5; }
    },
    hammer(g) {
      rod(g, 0.02, 0.36, H.wood, 0, 0, 0.1);
      box(g, 0.06, 0.07, 0.17, H.metal, 0, 0.05, 0.28).rotation.x = Math.PI / 2;
    },
    fishingrod(g) {
      rod(g, 0.022, 0.16, H.woodDark, 0, 0, 0);
      const r = rod(g, 0.009, 0.95, H.wood, 0, 0.2, 0.42); r.rotation.x = Math.PI / 2 - 0.45;
      rod(g, 0.035, 0.03, H.metal, 0.04, 0, 0.03, 0);
    },
    wood(g) { box(g, 0.11, 0.035, 0.42, H.wood, 0, 0.02, 0.1); },
    leaf(g) { const l = add(g, geo(new T.PlaneGeometry(0.16, 0.42)), H.leaf, 0, 0.02, 0.18); l.rotation.x = -1.2; },
    scrap(g) { box(g, 0.12, 0.08, 0.1, H.metal, 0, 0.03, 0.06).rotation.set(0.4, 0.3, 0.2); },
    plastic(g) { add(g, geo(new T.CylinderGeometry(0.06, 0.07, 0.17, 8)), H.plastic, 0, 0.07, 0.06); },
    fish(g) { const f = add(g, geo(new T.SphereGeometry(0.07, 8, 6)), H.fish, 0, 0, 0.12); f.scale.set(0.6, 1, 2.2); },
    sail(g) { rod(g, 0.012, 0.5, H.wood, 0, 0, 0.15); const c = add(g, geo(new T.PlaneGeometry(0.28, 0.24)), H.cloth, 0, 0.13, 0.24); c.rotation.y = Math.PI / 2; },
    lantern(g) { box(g, 0.08, 0.11, 0.08, H.lamp, 0, -0.07, 0.03); box(g, 0.1, 0.02, 0.1, H.woodDark, 0, -0.005, 0.03); },
    crate(g) { box(g, 0.2, 0.18, 0.2, H.wood, 0, 0.02, 0.1); },
  };
  BUILD.palm = BUILD.leaf; BUILD.net = BUILD.scrap; BUILD.bench = BUILD.crate;
  const heldModels = new Map();
  let heldKind = null;
  function setHeld(kind) {
    kind = Object.prototype.hasOwnProperty.call(BUILD, kind) ? kind : null;
    if (kind === heldKind) return;
    heldKind = kind;
    for (const [k, g] of heldModels) g.visible = k === kind;
    if (kind && !heldModels.has(kind)) { const g = new T.Group(); BUILD[kind](g); grip.add(g); heldModels.set(kind, g); }
  }

  // ---- animation: walk / swim cycle, eased so network jitter never pops ----
  let phase = 0, stride = 0, swim = 0, raise = 0;
  function animate(dt, { speed = 0, swimming = false, pitch = 0 } = {}) {
    if (!(dt > 0)) return;
    const k = Math.min(1, dt * 8);
    stride += (Math.min(1, speed / 3) - stride) * k;
    swim += ((swimming ? 1 : 0) - swim) * k;
    raise += ((heldKind ? 1 : 0) - raise) * k;
    phase += dt * (swimming ? 5 : 3 + speed * 2.4);
    const s = Math.sin(phase), legs = 0.65 * stride * (1 - swim);
    leftLeg.rotation.x = s * legs + Math.sin(phase * 1.3) * 0.35 * swim;
    rightLeg.rotation.x = -s * legs - Math.sin(phase * 1.3) * 0.35 * swim;
    // left arm swings; right arm swings when empty, holds the item forward otherwise
    const armSwing = -s * 0.5 * stride * (1 - swim), stroke = (Math.cos(phase) * 0.9 - 2.2) * swim;
    leftArm.rotation.x = armSwing + stroke;
    rightArm.rotation.x = (-armSwing * (1 - raise) + (-0.75 - Math.max(-0.6, Math.min(0.6, pitch)) * 0.6) * raise) * (1 - swim) + stroke;
    leftArm.rotation.z = 0.12 + 0.5 * swim * (1 + Math.sin(phase));
    rightArm.rotation.z = -0.12 - 0.5 * swim * (1 + Math.sin(phase));
    grip.visible = swim < 0.5;
    head.rotation.x = -Math.max(-0.6, Math.min(0.6, pitch)) * 0.5 * (1 - swim) - 0.6 * swim;
  }

  root.userData.parts = { head, leftArm, rightArm, leftLeg, rightLeg, leftKnee: leftLeg.userData.knee, rightKnee: rightLeg.userData.knee };
  root.userData.setHeld = setHeld;
  root.userData.animate = animate;
  root.userData.eyeHeight = 1.65;
  root.userData.look = look;
  root.userData.dispose = () => {
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    geos.length = 0;
    mats.length = 0;
  };

  return root;
}
