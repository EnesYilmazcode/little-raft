// Fish Tank model (see docs/specs/aquarium.md section 6). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). About 0.9 x 0.7 x 0.5.
// The wooden frame, sand, plant and shell are merged into one vertex-coloured mesh. The glass panes and the water box
// use one transparent material shared by every tank (userData.shared) and draw after the fish (renderOrder 2).
// Direct children: `aim` (tank centre, for targeting) and `swim` (the fish parent; userData.box = half extents).

export const TANK_W = 0.9, TANK_D = 0.5, TANK_H = 0.7, BASE_H = 0.12;
export const SWIM_BOX = Object.freeze({ x: .33, y: .16, z: .15 }), SWIM_Y = .38;
export const BUBBLE_LOOP = 3;

let glassMat = null, waterMat = null, bubbleMat = null, bubbleGeo = null, glassT = null;

function shared(T) {
  if (glassT === T && glassMat) return;
  glassT = T;
  glassMat = new T.MeshStandardMaterial({ color: 0xdff4f8, transparent: true, opacity: .25, roughness: .05, depthWrite: false });
  glassMat.userData.shared = true; glassMat.name = 'aquarium:glass';
  waterMat = new T.MeshStandardMaterial({ color: 0x7fc4d4, transparent: true, opacity: .18, roughness: .2, depthWrite: false });
  waterMat.userData.shared = true; waterMat.name = 'aquarium:water';
  bubbleMat = new T.MeshStandardMaterial({ color: 0xf4fcff, transparent: true, opacity: .7, roughness: .1 });
  bubbleMat.userData.shared = true; bubbleMat.name = 'aquarium:bubble';
  bubbleGeo = new T.SphereGeometry(.012, 8, 6); bubbleGeo.userData.shared = true;
}

/** The module-level shared materials/geometry (tests and dispose). */
export function aquariumShared() { return { glassMat, waterMat, bubbleMat, bubbleGeo }; }
export function disposeAquariumShared() {
  for (const o of [glassMat, waterMat, bubbleMat, bubbleGeo]) o?.dispose();
  glassMat = waterMat = bubbleMat = bubbleGeo = glassT = null;
}

// Tiny local merge of [geometry, hex, matrix] into one non-indexed vertex-coloured geometry (as display-model.js).
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    if (g.attributes.normal === undefined) g.computeVertexNormals();
    const c = new T.Color(hex), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    geos.push(g); n += cnt;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export function createAquariumModel(T) {
  shared(T);
  const g = new T.Group(); g.name = 'craft_aquarium';
  const parts = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  const W = '#a8763f', D = '#8a6136', hw = TANK_W / 2, hd = TANK_D / 2;
  // base, corner posts, top rim
  add(new T.BoxGeometry(TANK_W, BASE_H, TANK_D), D, 0, BASE_H / 2, 0);
  add(new T.BoxGeometry(TANK_W + .02, .025, TANK_D + .02), W, 0, BASE_H - .0125, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.BoxGeometry(.04, TANK_H - BASE_H, .04), W, sx * (hw - .02), (TANK_H + BASE_H) / 2, sz * (hd - .02));
  for (const sz of [-1, 1]) add(new T.BoxGeometry(TANK_W, .035, .04), W, 0, TANK_H - .0175, sz * (hd - .02));
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.04, .035, TANK_D), W, sx * (hw - .02), TANK_H - .0175, 0);
  // sand slab, a few pebbles
  add(new T.BoxGeometry(TANK_W - .08, .05, TANK_D - .08), '#e8d3a0', 0, .145, 0);
  add(new T.SphereGeometry(.018, 6, 4), '#b9a98a', .1, .17, .08, 0, 0, 0, 1.3, .6, 1);
  add(new T.SphereGeometry(.014, 6, 4), '#9c8f7a', .15, .17, -.06, 0, 0, 0, 1.2, .6, 1);
  // a little plant: tapered blades from the back left
  const blades = [[-.29, -.08, .30, .1, 0], [-.26, -.1, .24, -.18, .4], [-.31, -.05, .2, .22, -.3], [-.24, -.06, .27, -.05, 1.2]];
  for (const [x, z, h, lean, yaw] of blades) add(new T.ConeGeometry(.018, h, 5), '#4f9e5a', x, .17 + h / 2 * Math.cos(lean), z, 0, yaw, lean);
  // a pink shell: a squashed cone lying on the sand
  add(new T.ConeGeometry(.035, .06, 7), '#f0b6a8', .24, .19, .05, 0, .6, Math.PI / 2, 1, 1, .6);
  add(new T.SphereGeometry(.03, 7, 5), '#f4c8bb', .215, .19, .05, 0, 0, 0, .8, .8, .6);
  const body = new T.Mesh(bake(T, parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: 0 }));
  body.name = 'aquariumBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // glass panes (front/back/left/right) and the water box: shared material, drawn after the fish
  const gh = TANK_H - BASE_H - .035, gy = BASE_H + gh / 2;
  const paneFB = new T.PlaneGeometry(TANK_W - .04, gh), paneLR = new T.PlaneGeometry(TANK_D - .04, gh);
  const panes = [[paneFB, 0, hd - .02, 0], [paneFB, 0, -(hd - .02), Math.PI], [paneLR, hw - .02, 0, Math.PI / 2], [paneLR, -(hw - .02), 0, -Math.PI / 2]];
  panes.forEach(([geo, x, z, ry], i) => {
    const m = new T.Mesh(geo, glassMat); m.name = 'glass' + i;
    m.position.set(x, gy, z); m.rotation.y = ry;
    m.renderOrder = 2; m.castShadow = false; m.receiveShadow = false;
    g.add(m);
  });
  const water = new T.Mesh(new T.BoxGeometry(TANK_W - .06, gh - .07, TANK_D - .06), waterMat);
  water.name = 'water'; water.position.set(0, BASE_H + .025 + (gh - .07) / 2, 0);
  water.renderOrder = 2; water.castShadow = false; water.receiveShadow = false;
  g.add(water);

  // bubbles rising from the plant
  for (let i = 0; i < 3; i++) {
    const b = new T.Mesh(bubbleGeo, bubbleMat); b.name = 'bubble' + i;
    b.position.set(-.27 + i * .015, .2 + i * .12, -.07); b.castShadow = false;
    b.userData.phase = i / 3;
    g.add(b);
  }

  const aim = new T.Object3D(); aim.name = 'aim'; aim.position.set(0, SWIM_Y, 0); g.add(aim);
  const swim = new T.Group(); swim.name = 'swim'; swim.position.set(0, SWIM_Y, 0);
  swim.userData.box = { x: SWIM_BOX.x, y: SWIM_BOX.y, z: SWIM_BOX.z };
  g.add(swim);
  g.updateMatrixWorld(true);
  return g;
}

/** Move the 3 bubbles of a tank group for time t (seconds). No allocation. */
export function bubbleTick(g, t) {
  const kids = g.children;
  for (let i = 0; i < kids.length; i++) {
    const b = kids[i]; if (b.name.length !== 7 || !b.name.startsWith('bubble')) continue;
    const f = ((t / BUBBLE_LOOP + b.userData.phase) % 1 + 1) % 1;
    b.position.y = .19 + f * .44;
    b.position.x = -.27 + Math.sin(t * 2 + b.userData.phase * 6) * .012;
    b.scale.setScalar(.7 + f * .6);
  }
}
