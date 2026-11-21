// Biofuel Refiner and Fuel Tank models (docs/specs/biofuel.md §6).
// Geometry and materials are built ONCE and shared; instance() returns a cheap Group of new Meshes.
// game.js rebuildRaft() disposes children it removes, so shared dispose() calls are no-ops here;
// the module's dispose() frees them for real. Local origin = centre of the floor tile top.

function mergeParts(T, parts) {
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Collects vertex-coloured, transformed, non-indexed pieces for one merged geometry.
function painter(T, seed0) {
  const parts = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1), sc = new T.Vector3();
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.05, scale = null) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, scale ? sc.set(scale[0], scale[1], scale[2]) : one); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    for (let i = 0; i < n; i++) {
      const tone = 1 + (rnd() - .5) * jitter * 2;
      c.copy(base).multiplyScalar(tone);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  return { parts, add };
}

function shareable(T, list) {
  const noop = () => {};
  for (const x of list) x.dispose = noop;
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  return () => { for (const x of list) (x.isMaterial ? realMat : realGeo).call(x); };
}

const COPPER = 0xc77a45, WOOD = 0x9a7149;
export const BULB = Object.freeze({ x: .27, y: .55, z: 0, r: .14 }); // glass bulb on the side stand

/** Biofuel Refiner: copper still on a wooden plinth, a glass bulb with amber liquid, a tray of little jugs. */
export function buildRefiner(T) {
  const { parts, add } = painter(T, 23);
  add(new T.BoxGeometry(.8, .08, .6), WOOD, 0, .04, 0, 0, 0, 0, .1);                                       // plinth
  add(new T.CylinderGeometry(.22, .22, .35, 18), COPPER, -.12, .08 + .175, 0, 0, 0, 0, .06);               // pot
  add(new T.SphereGeometry(.22, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xd08850, -.12, .43, 0, 0, 0, 0, .05, [1, .55, 1]); // dome
  add(new T.CylinderGeometry(.035, .045, .06, 10), 0x8a5230, -.12, .57, 0, 0, 0, 0, .04);                   // cap knob
  add(new T.CylinderGeometry(.24, .24, .025, 18), 0xa8643a, -.12, .26, 0, 0, 0, 0, .04);                    // band
  // bent pipe: up from the dome, across, down into the bulb top
  add(new T.CylinderGeometry(.022, .022, .16, 8), COPPER, -.12, .66, 0, 0, 0, 0, .04);
  add(new T.CylinderGeometry(.022, .022, .4, 8), COPPER, .08, .74, 0, 0, 0, Math.PI / 2 - .2, .04);
  add(new T.CylinderGeometry(.022, .022, .1, 8), COPPER, BULB.x, BULB.y + BULB.r + .03, 0, 0, 0, 0, .04);
  // side stand: three thin legs and a ring under the bulb
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    add(new T.CylinderGeometry(.012, .012, .42, 6), 0x5a4a3a, BULB.x + Math.cos(a) * .09, .29, Math.sin(a) * .09, Math.sin(a) * .12, 0, -Math.cos(a) * .12, .03);
  }
  add(new T.TorusGeometry(.1, .012, 6, 16), 0x5a4a3a, BULB.x, BULB.y - BULB.r + .02, 0, Math.PI / 2, 0, 0, .03);
  // front tray plank for the finished jugs
  add(new T.BoxGeometry(.36, .02, .12), 0xb08a58, -.05, .09, .24, 0, 0, 0, .05);
  const baseGeo = mergeParts(T, parts);
  const baseMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .35 }); baseMat.name = 'bioRefinerBody';

  const bulbGeo = new T.SphereGeometry(BULB.r, 18, 12);
  const bulbMat = new T.MeshStandardMaterial({ color: 0xcfe8e4, transparent: true, opacity: .35, roughness: .08, depthWrite: false }); bulbMat.name = 'bioBulb';
  const liquidGeo = new T.SphereGeometry(BULB.r * .82, 14, 10);
  const liquidMat = new T.MeshStandardMaterial({ color: 0xd9a73a, emissive: 0x6a3d08, emissiveIntensity: .5, roughness: .3 }); liquidMat.name = 'bioLiquid';
  const bubbleGeo = new T.SphereGeometry(.015, 8, 6);
  const bubbleMat = new T.MeshStandardMaterial({ color: 0xfff1c4, transparent: true, opacity: .8, roughness: .2 }); bubbleMat.name = 'bioBubble';
  // one tray jug: small amber cylinder, dark shoulder and screw cap (one merged, vertex-coloured mesh); bottom at y -.06
  const jp = painter(T, 41);
  jp.add(new T.CylinderGeometry(.029, .031, .085, 12), 0xeab544, 0, -.0175, 0, 0, 0, 0, .05);  // body
  jp.add(new T.CylinderGeometry(.031, .031, .012, 12), 0xa8742a, 0, -.035, 0, 0, 0, 0, .03);   // label band
  jp.add(new T.CylinderGeometry(.017, .029, .018, 12), 0xd9a73a, 0, .034, 0, 0, 0, 0, .04);    // shoulder
  jp.add(new T.CylinderGeometry(.015, .015, .02, 10), 0x2f3336, 0, .053, 0, 0, 0, 0, .03);     // cap
  const jugGeo = mergeParts(T, jp.parts);
  const jugMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .45, metalness: .1 }); jugMat.name = 'bioJug';
  const free = shareable(T, [baseGeo, bulbGeo, liquidGeo, bubbleGeo, jugGeo, baseMat, bulbMat, liquidMat, bubbleMat, jugMat]);
  const mesh = (geo, mat, name, x, y, z) => { const m = new T.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.castShadow = false; return m; };

  return {
    instance() {
      const g = new T.Group(); g.name = 'bio_refiner';
      const base = mesh(baseGeo, baseMat, 'bioRefinerBody', 0, 0, 0); base.castShadow = true; base.receiveShadow = true;
      const liquid = mesh(liquidGeo, liquidMat, 'bioLiquid', BULB.x, BULB.y, BULB.z); liquid.scale.y = .15;
      const bulb = mesh(bulbGeo, bulbMat, 'bioBulb', BULB.x, BULB.y, BULB.z); bulb.renderOrder = 2;
      g.add(base, liquid, bulb);
      const bubbles = [], jugs = [];
      for (let i = 0; i < 3; i++) { const b = mesh(bubbleGeo, bubbleMat, 'bioBubble', BULB.x + (i - 1) * .04, BULB.y - .06, (i % 2 ? .03 : -.02)); b.visible = false; bubbles.push(b); g.add(b); }
      for (let i = 0; i < 4; i++) { const j = mesh(jugGeo, jugMat, 'bioJug', -.19 + i * .095, .16, .24); j.visible = false; jugs.push(j); }
      g.add(...jugs);
      g.userData.craftType = 'refiner'; g.userData.height = .8;
      g.userData.bio = { bulb, liquid, bubbles, jugs };
      return g;
    },
    dispose: free,
  };
}

export const LEVEL = Object.freeze({ y0: .2, h: .5, z: .305 });

/** Fuel Tank: a green drum with rims, a cap and a hose stub; an amber level shows in a window on the +z face. */
export function buildTank(T) {
  const { parts, add } = painter(T, 31);
  add(new T.CylinderGeometry(.3, .3, .75, 20), 0x5f8a6b, 0, .375, 0, 0, 0, 0, .05);                       // drum
  add(new T.CylinderGeometry(.315, .315, .04, 20), 0x41604a, 0, .12, 0, 0, 0, 0, .03);                     // low rim
  add(new T.CylinderGeometry(.315, .315, .04, 20), 0x41604a, 0, .64, 0, 0, 0, 0, .03);                     // high rim
  add(new T.CylinderGeometry(.27, .3, .03, 20), 0x4f7559, 0, .765, 0, 0, 0, 0, .03);                       // top
  add(new T.CylinderGeometry(.06, .06, .06, 12), 0x3a3f42, .12, .8, -.08, 0, 0, 0, .03);                   // cap
  add(new T.CylinderGeometry(.035, .035, .16, 8), 0x2f3336, -.3, .2, 0, 0, 0, Math.PI / 2, .04);          // hose stub
  add(new T.TorusGeometry(.04, .012, 6, 10), 0x3a3f42, -.38, .2, 0, 0, Math.PI / 2, 0, .03);               // hose ring
  add(new T.BoxGeometry(.11, .56, .02), 0x2f3a33, 0, LEVEL.y0 + LEVEL.h / 2, LEVEL.z - .012, 0, 0, 0, .03); // window frame
  const baseGeo = mergeParts(T, parts);
  const baseMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .25 }); baseMat.name = 'bioTankBody';
  const winGeo = new T.BoxGeometry(.07, LEVEL.h, .012);
  const winMat = new T.MeshStandardMaterial({ color: 0x1b2420, roughness: .3 }); winMat.name = 'bioTankWindow';
  const levelGeo = new T.BoxGeometry(.055, LEVEL.h, .012); levelGeo.translate(0, LEVEL.h / 2, 0); // bottom-anchored
  const levelMat = new T.MeshStandardMaterial({ color: 0xe0ac3c, emissive: 0x7a4a0a, emissiveIntensity: .6, roughness: .35 }); levelMat.name = 'bioTankLevel';
  const free = shareable(T, [baseGeo, winGeo, levelGeo, baseMat, winMat, levelMat]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'bio_tank';
      const base = new T.Mesh(baseGeo, baseMat); base.name = 'bioTankBody'; base.castShadow = true; base.receiveShadow = true;
      const win = new T.Mesh(winGeo, winMat); win.name = 'bioTankWindow'; win.position.set(0, LEVEL.y0 + LEVEL.h / 2, LEVEL.z);
      const level = new T.Mesh(levelGeo, levelMat); level.name = 'bioTankLevel'; level.position.set(0, LEVEL.y0, LEVEL.z + .004);
      level.scale.y = .001; level.visible = false;
      // the window sits inside the frame; merge it into the instance as one more mesh
      g.add(base, win, level);
      g.userData.craftType = 'fueltank'; g.userData.height = .82;
      g.userData.bio = { level, cap: base };
      return g;
    },
    dispose: free,
  };
}
