// Friendly low-poly sailor avatar for Little Raft.
// createAvatar(T, color) -> THREE.Group
//   T     : the THREE namespace (import * as T from './vendor/three.module.js')
//   color : shirt / hat-band colour (any value accepted by THREE.Color)
// Feet rest at y = 0, head centred at y ~1.6, eyes at y ~1.65, facing +Z.
// All geometries and materials are created per avatar and owned by it;
// call group.userData.dispose() to free them.

export function createAvatar(T, color) {
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

  const shirtColor = new T.Color(color === undefined || color === null ? '#efae55' : color);
  const bandColor = shirtColor.clone().multiplyScalar(0.72);

  // ---- shared per-avatar materials ----
  const M = {
    skin: mat('#f2c29b', { roughness: 0.85 }),
    shirt: mat(shirtColor),
    stripe: mat('#fbf7ee'),
    shorts: mat('#2f4a6b'),
    shoe: mat('#5a3d2b'),
    eye: mat('#262a33', { roughness: 0.35 }),
    shine: mat('#ffffff', { roughness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.4 }),
    cheek: mat('#f39b93', { roughness: 0.9 }),
    smile: mat('#a8433a', { roughness: 0.6 }),
    hair: mat('#6b4226', { roughness: 0.9 }),
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
  const makeLeg = (side) => {
    const hip = new T.Group();
    hip.name = side < 0 ? 'leftLeg' : 'rightLeg';
    hip.position.set(0.1 * side, 0.8, 0);
    add(hip, shortLegGeo, M.shorts, 0, -0.125, 0);
    add(hip, legGeo, M.skin, 0, -0.47, 0);
    const shoe = add(hip, shoeGeo, M.shoe, 0, -0.755, 0.035);
    shoe.scale.set(1, 0.6, 1.5); // bottom lands exactly at y = 0
    root.add(hip);
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
    add(shoulder, handGeo, M.skin, 0, -0.5, 0.01);
    root.add(shoulder);
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

  // ---- straw sunhat ----
  const hat = new T.Group();
  hat.name = 'hat';
  hat.position.set(0, 0.115, -0.01);
  hat.rotation.x = -0.12;
  head.add(hat);
  add(hat, geo(new T.CylinderGeometry(0.34, 0.35, 0.025, 14)), M.straw, 0, 0, 0, 'brim');
  add(hat, geo(new T.CylinderGeometry(0.15, 0.18, 0.15, 12)), M.straw, 0, 0.085, 0, 'crown');
  add(hat, geo(new T.CylinderGeometry(0.183, 0.186, 0.045, 12)), M.band, 0, 0.04, 0, 'band');

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

  root.userData.parts = { head, leftArm, rightArm, leftLeg, rightLeg };
  root.userData.eyeHeight = 1.65;
  root.userData.dispose = () => {
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    geos.length = 0;
    mats.length = 0;
  };

  return root;
}
