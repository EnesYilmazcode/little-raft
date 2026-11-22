// Trading post stall, Shell Wreath and Glass Float models (docs/specs/trader.md §5).
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

const WOOD = 0x7a5634, PLANK = 0xb98b55;

const THATCH = 0xc9a35c, THATCH_D = 0xa8843f, SHELL = 0xf7d9c4;

/**
 * Trading post stall: a small open wooden hut, ~2.2 m wide along x, 1.4 m deep, the counter on the +z side.
 * Origin on the sand at the centre of its footprint. One merged vertex-colour mesh (1 draw call).
 */
export function buildStall(T) {
  const { parts, add } = painter(T, 23);
  // floor planks and four corner posts
  add(new T.BoxGeometry(2.3, .08, 1.5), PLANK, 0, .04, 0, 0, 0, 0, .1);
  add(new T.BoxGeometry(2.24, .6, 1.44), 0x6a4a2c, 0, -.3, 0, 0, 0, 0, .08); // footing: sinks into the uphill sand
  for (const [x, z, h] of [[-1, .62, 2.05], [1, .62, 2.05], [-1, -.62, 2.35], [1, -.62, 2.35]]) add(new T.CylinderGeometry(.065, .075, h, 7), WOOD, x, h / 2, z, 0, 0, 0, .06);
  // counter: plank front, top board, a few shells on show
  for (let i = 0; i < 5; i++) add(new T.BoxGeometry(.4, .86, .05), i % 2 ? 0x9a6b3c : 0x8d5f36, -.84 + i * .42, .47, .72, 0, 0, (i - 2) * .012, .07);
  add(new T.BoxGeometry(2.3, .06, .5), 0xd9b27a, 0, .93, .62, 0, 0, 0, .05);
  for (const [x, c] of [[-.7, SHELL], [-.55, 0xfff0dc], [.5, 0xf2a98f], [.66, SHELL]]) add(new T.SphereGeometry(.055, 8, 6), c, x, .98, .66, 0, 0, 0, .04, [1, .5, 1.1]);
  // back wall of planks and a shelf with jars and a crate
  for (let i = 0; i < 6; i++) add(new T.BoxGeometry(.36, 2.2, .05), i % 2 ? 0x8a6238 : 0x7f5832, -.9 + i * .36, 1.12, -.66, 0, 0, 0, .07);
  add(new T.BoxGeometry(2.0, .05, .3), PLANK, 0, 1.35, -.5, 0, 0, 0, .06);
  add(new T.CylinderGeometry(.08, .08, .2, 10), 0x5fb4d9, -.5, 1.48, -.5, 0, 0, 0, .05);
  add(new T.CylinderGeometry(.07, .07, .16, 10), 0x3fa7a0, -.3, 1.46, -.5, 0, 0, 0, .05);
  add(new T.BoxGeometry(.32, .26, .26), 0xa87a45, .45, 1.5, -.5, 0, .2, 0, .08);
  // sloped roof: plank deck under a thatch layer, with a ragged leaf fringe at the front
  add(new T.BoxGeometry(2.7, .06, 1.9), WOOD, 0, 2.24, 0, -.16, 0, 0, .06);
  add(new T.BoxGeometry(2.8, .14, 2.0), THATCH, 0, 2.33, 0, -.16, 0, 0, .12);
  for (let i = 0; i < 9; i++) add(new T.BoxGeometry(.32, .22, .04), i % 2 ? THATCH_D : THATCH, -1.28 + i * .32, 2.08, 1.0, -.3, 0, (i % 3 - 1) * .1, .1);
  // hanging shell sign under the front eave: the post's icon, no text
  add(new T.BoxGeometry(.04, .3, .04), 0x8a6238, -.18, 1.92, .74, 0, 0, 0, .04);
  add(new T.BoxGeometry(.04, .3, .04), 0x8a6238, .18, 1.92, .74, 0, 0, 0, .04);
  add(new T.BoxGeometry(.56, .34, .05), PLANK, 0, 1.64, .76, 0, 0, 0, .08);
  add(new T.SphereGeometry(.11, 10, 8), SHELL, 0, 1.64, .8, 0, 0, 0, .04, [1.1, 1, .45]);
  for (let i = 0; i < 5; i++) add(new T.BoxGeometry(.018, .16, .01), 0xe8b39a, (i - 2) * .04, 1.66, .85, 0, 0, (i - 2) * .32, .03);
  // crates and a barrel beside the stall
  add(new T.BoxGeometry(.5, .45, .5), 0xa87a45, 1.45, .225, .3, 0, .25, 0, .08);
  add(new T.BoxGeometry(.38, .34, .38), 0xb98a52, 1.42, .62, .28, 0, -.2, 0, .08);
  add(new T.CylinderGeometry(.22, .22, .55, 12), 0x8d5f36, -1.42, .275, .25, 0, 0, 0, .06);
  add(new T.CylinderGeometry(.23, .23, .04, 12), 0x55606a, -1.42, .45, .25, 0, 0, 0, .03);
  add(new T.CylinderGeometry(.23, .23, .04, 12), 0x55606a, -1.42, .1, .25, 0, 0, 0, .03);
  const geo = mergeParts(T, parts);
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 }); mat.name = 'tradingPost';
  const group = new T.Group(); group.name = 'trading_post';
  const mesh = new T.Mesh(geo, mat); mesh.name = 'tradingPost'; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  group.visible = false;
  return {
    group,
    dispose() { group.removeFromParent(); geo.dispose(); mat.dispose(); },
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
