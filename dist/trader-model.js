// Pim's Barge, Shell Wreath and Glass Float models (docs/specs/trader.md §5).
// Geometry and materials are built ONCE and shared; decor instance() returns a cheap Group of new Meshes.
// game.js rebuildRaft() disposes children it removes, so shared dispose() calls are no-ops here;
// the module's dispose() frees them for real. Decor origin = centre of the floor tile top (y = .22).

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

const WOOD = 0x7a5634, HULL = 0x6f4a2c, PLANK = 0xb98b55, TRIM = 0xe9d3a0;

/**
 * Pim's trading barge: ~4 m along x, 1.8 m across z, the counter on the +z side (facing the raft).
 * Origin at the waterline-ish deck base (the module sets y). 5 draw calls.
 */
export function buildBarge(T) {
  // (1) hull, deck, crates, mast, counter, posts: one merged vertex-colour mesh, the only shadow caster
  const { parts, add } = painter(T, 23);
  add(new T.BoxGeometry(3.2, .5, 1.8), HULL, 0, .05, 0, 0, 0, 0, .06);
  for (const s of [-1, 1]) add(new T.CylinderGeometry(.9, .9, .5, 14, 1, false, 0, Math.PI), HULL, s * 1.6, .05, 0, 0, s > 0 ? 0 : Math.PI, 0, .06, [.45, 1, 1]);
  add(new T.BoxGeometry(3.3, .07, 1.86), TRIM, 0, .3, 0, 0, 0, 0, .04);
  add(new T.BoxGeometry(3.1, .04, 1.62), PLANK, 0, .32, 0, 0, 0, 0, .1);
  for (let i = 0; i < 6; i++) add(new T.BoxGeometry(.02, .045, 1.6), 0x8a6238, -1.3 + i * .52, .325, 0, 0, 0, 0, .05);
  // cargo: crates and a barrel at the stern (-x) and along the back
  add(new T.BoxGeometry(.5, .45, .5), 0xa87a45, -1.25, .565, -.4, 0, .1, 0, .08);
  add(new T.BoxGeometry(.38, .34, .38), 0xb98a52, -1.2, .96, -.42, 0, -.25, 0, .08);
  add(new T.BoxGeometry(.44, .4, .44), 0x9c6e3d, -.65, .54, -.5, 0, .3, 0, .08);
  add(new T.CylinderGeometry(.2, .2, .5, 12), 0x8d5f36, -1.35, .59, .35, 0, 0, 0, .06);
  add(new T.CylinderGeometry(.21, .21, .04, 12), 0x55606a, -1.35, .75, .35, 0, 0, 0, .03);
  add(new T.CylinderGeometry(.21, .21, .04, 12), 0x55606a, -1.35, .43, .35, 0, 0, 0, .03);
  // mast at the bow (+x)
  add(new T.CylinderGeometry(.05, .06, 2.7, 8), WOOD, 1.15, 1.67, -.35, 0, 0, 0, .05);
  add(new T.CylinderGeometry(.025, .025, 1.2, 6), WOOD, 1.15, 2.55, -.35, 0, 0, Math.PI / 2, .05);
  // counter (stall) on the +z side, top at y .9
  add(new T.BoxGeometry(1.4, .54, .28), 0x9a6b3c, 0, .61, .68, 0, 0, 0, .07);
  add(new T.BoxGeometry(1.56, .05, .42), 0xd9b27a, 0, .9, .7, 0, 0, 0, .05);
  for (const [x, c] of [[-.45, 0xf7d9c4], [-.3, 0xfff0dc], [.42, 0xf2a98f]]) add(new T.SphereGeometry(.05, 8, 6), c, x, .94, .78, 0, 0, 0, .04, [1, .5, 1.1]);
  // awning posts
  for (const [x, z] of [[-.78, .86], [.78, .86], [-.78, -.05], [.78, -.05]]) add(new T.CylinderGeometry(.035, .035, 1.62, 6), WOOD, x, 1.13, z, 0, 0, 0, .05);
  // lantern bracket + frame on the front-right post
  add(new T.BoxGeometry(.24, .03, .03), 0x4a4f52, .9, 1.78, .86, 0, 0, 0, .03);
  add(new T.BoxGeometry(.13, .02, .13), 0x3e4245, 1.0, 1.57, .86, 0, 0, 0, .03);
  add(new T.ConeGeometry(.1, .08, 4), 0x3e4245, 1.0, 1.73, .86, 0, Math.PI / 4, 0, .03);
  const hullGeo = mergeParts(T, parts);
  const hullMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 }); hullMat.name = 'bargeHull';

  // (2) awning and sail cloth, DoubleSide
  const cloth = painter(T, 7);
  for (let i = 0; i < 6; i++) cloth.add(new T.PlaneGeometry(.29, 1.15), i % 2 ? 0xf7ecd5 : 0xe86b4f, -.725 + i * .29, 2.0, .4, -Math.PI / 2 + .22, 0, 0, .03);
  for (let i = 0; i < 6; i++) cloth.add(new T.PlaneGeometry(.29, .16), i % 2 ? 0xf7ecd5 : 0xe86b4f, -.725 + i * .29, 1.82, .99, 0, 0, 0, .03);
  cloth.add(new T.PlaneGeometry(1.0, 1.55), 0xf2e6c8, 1.15, 1.72, -.33, 0, 0, 0, .04);
  cloth.add(new T.PlaneGeometry(.94, .1), 0x3fa7a0, 1.15, 1.2, -.325, 0, 0, 0, .03);
  const clothGeo = mergeParts(T, cloth.parts);
  const clothMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: T.DoubleSide }); clothMat.name = 'bargeCloth';

  // (3) Pim the sea otter, origin at his feet, facing +z
  const otter = painter(T, 3);
  const FUR = 0x8b5e3c, PALE = 0xe2c49a, DARK = 0x2a1b12;
  otter.add(new T.SphereGeometry(.26, 14, 10), FUR, 0, .42, 0, 0, 0, 0, .05, [1, 1.55, .9]);
  otter.add(new T.SphereGeometry(.2, 12, 8), PALE, 0, .45, .09, 0, 0, 0, .04, [1, 1.5, .7]);
  otter.add(new T.SphereGeometry(.19, 14, 10), FUR, 0, .93, 0, 0, 0, 0, .05);
  otter.add(new T.SphereGeometry(.12, 12, 8), PALE, 0, .88, .13, 0, 0, 0, .03, [1.15, .8, .8]);
  otter.add(new T.SphereGeometry(.035, 8, 6), DARK, 0, .91, .23, 0, 0, 0, .02);
  for (const s of [-1, 1]) {
    otter.add(new T.SphereGeometry(.026, 8, 6), DARK, s * .075, .99, .16, 0, 0, 0, .02);
    otter.add(new T.SphereGeometry(.05, 8, 6), FUR, s * .15, 1.06, -.02, 0, 0, 0, .04, [1, 1, .6]);
    otter.add(new T.CapsuleGeometry(.05, .2, 4, 8), FUR, s * .2, .55, .2, -1.1, 0, s * .25, .05);
    otter.add(new T.SphereGeometry(.055, 8, 6), 0x6e4a2e, s * .2, .55, .32, 0, 0, 0, .04);
  }
  for (let i = 0; i < 4; i++) otter.add(new T.SphereGeometry(.012, 5, 4), 0xf5eadc, (i < 2 ? -1 : 1) * (.06 + (i % 2) * .02), .87 - (i % 2) * .015, .225, 0, 0, 0, 0);
  otter.add(new T.CylinderGeometry(.2, .22, .03, 16), 0xe2c072, 0, 1.08, 0, -.08, 0, 0, .08);
  otter.add(new T.CylinderGeometry(.1, .12, .09, 14), 0xd8b462, 0, 1.13, -.01, -.08, 0, 0, .08);
  otter.add(new T.CylinderGeometry(.122, .122, .025, 14), 0x3fa7a0, 0, 1.1, -.005, -.08, 0, 0, .03);
  otter.add(new T.CapsuleGeometry(.06, .28, 4, 8), FUR, 0, .14, -.24, .9, 0, 0, .05);
  const pimGeo = mergeParts(T, otter.parts);
  const pimMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 }); pimMat.name = 'pimFur';

  // (4) lantern glow
  const glowGeo = new T.SphereGeometry(.055, 12, 8); glowGeo.translate(1.0, 1.65, .86);
  const glowMat = new T.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffb050, emissiveIntensity: 2.0, roughness: 1 }); glowMat.name = 'lanternGlow';

  // (5) pennant: a triangle whose hinge is at the mast top, so rotation.y sways it
  const penGeo = new T.BufferGeometry();
  penGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([0, .09, 0, 0, -.09, 0, -.55, 0, 0]), 3));
  penGeo.computeVertexNormals();
  const penMat = new T.MeshStandardMaterial({ color: 0x3fa7a0, roughness: .9, side: T.DoubleSide }); penMat.name = 'bargePennant';

  const group = new T.Group(); group.name = 'trader_barge';
  const hull = new T.Mesh(hullGeo, hullMat); hull.name = 'bargeHull'; hull.castShadow = true; hull.receiveShadow = true;
  const clothMesh = new T.Mesh(clothGeo, clothMat); clothMesh.name = 'bargeCloth';
  const pim = new T.Mesh(pimGeo, pimMat); pim.name = 'pim'; pim.position.set(0, .34, .3);
  const glow = new T.Mesh(glowGeo, glowMat); glow.name = 'lanternGlow';
  const pennant = new T.Mesh(penGeo, penMat); pennant.name = 'bargePennant'; pennant.position.set(1.15, 2.95, -.35);
  group.add(hull, clothMesh, pim, glow, pennant);
  group.visible = false;
  const geos = [hullGeo, clothGeo, pimGeo, glowGeo, penGeo], mats = [hullMat, clothMat, pimMat, glowMat, penMat];
  return {
    group, pim, pennant, pimY: pim.position.y,
    dispose() { group.removeFromParent(); for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}

/** Shell Wreath: a rope ring set with shells on a little easel. 1 mesh. */
export function buildShellWreath(T) {
  const { parts, add } = painter(T, 13);
  add(new T.BoxGeometry(.22, .03, .16), WOOD, 0, .015, 0, 0, 0, 0, .05);
  add(new T.BoxGeometry(.035, .5, .035), WOOD, 0, .26, -.04, -.12, 0, 0, .05);
  add(new T.TorusGeometry(.15, .035, 8, 22), 0xc9a46a, 0, .43, .015, -.12, 0, 0, .12);
  const shells = [0xf7d9c4, 0xfff0dc, 0xf2a98f, 0xf7c9a8, 0xfff6e8, 0xe8b39a, 0xf9dcc8, 0xf2a98f];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, x = Math.cos(a) * .15, y = .43 + Math.sin(a) * .15 * Math.cos(.12), z = .015 + .045 - Math.sin(a) * .15 * Math.sin(.12);
    add(new T.SphereGeometry(.04, 8, 6), shells[i], x, y, z, -.12, 0, a, .04, [1, .8, .5]);
  }
  add(new T.SphereGeometry(.03, 8, 6), 0x3fa7a0, 0, .27, .05, 0, 0, 0, .03, [1.4, 1, .6]);
  const geo = mergeParts(T, parts);
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .8 }); mat.name = 'shellWreath';
  const free = shareable(T, [geo, mat]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'craft_shellwreath';
      const m = new T.Mesh(geo, mat); m.name = 'shellWreath'; m.castShadow = true;
      g.add(m); g.userData.craftType = 'shellwreath'; g.userData.height = .62;
      return g;
    },
    dispose: free,
  };
}

/** Glass Float: a blue glass ball in a rope net on a stand. 2 meshes. */
export function buildGlassFloat(T) {
  const { parts, add } = painter(T, 17);
  add(new T.CylinderGeometry(.17, .2, .06, 14), WOOD, 0, .03, 0, 0, 0, 0, .06);
  add(new T.TorusGeometry(.13, .02, 6, 18), 0x8a6238, 0, .1, 0, Math.PI / 2, 0, 0, .05);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; add(new T.CylinderGeometry(.014, .014, .09, 5), 0x8a6238, Math.cos(a) * .13, .07, Math.sin(a) * .13, 0, 0, 0, .04); }
  const NET = 0xd9c08c, R = .208, Y = .3;
  for (let i = 0; i < 4; i++) add(new T.TorusGeometry(R, .007, 4, 28), NET, 0, Y, 0, 0, i / 4 * Math.PI, 0, .05);
  for (const lat of [-.5, 0, .5]) add(new T.TorusGeometry(R * Math.cos(lat), .007, 4, 28), NET, 0, Y + R * Math.sin(lat), 0, Math.PI / 2, 0, 0, .05);
  const netGeo = mergeParts(T, parts);
  const netMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9 }); netMat.name = 'floatNet';
  const ballGeo = new T.SphereGeometry(.2, 20, 14); ballGeo.translate(0, Y, 0);
  const ballMat = new T.MeshStandardMaterial({ color: 0x5fb4d9, transparent: true, opacity: .85, emissive: 0x2a6f9a, emissiveIntensity: .4, roughness: .08, metalness: .1 }); ballMat.name = 'glassFloat';
  const free = shareable(T, [netGeo, netMat, ballGeo, ballMat]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'craft_glassfloat';
      const net = new T.Mesh(netGeo, netMat); net.name = 'floatNet'; net.castShadow = true;
      const ball = new T.Mesh(ballGeo, ballMat); ball.name = 'glassFloat';
      g.add(ball, net); g.userData.craftType = 'glassfloat'; g.userData.height = .52;
      return g;
    },
    dispose: free,
  };
}
