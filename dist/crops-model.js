// Small Crop Plot model and crop plant meshes (own low-poly art). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). The plot body is one
// merged vertex-coloured mesh (receives shadows, casts none). Plant stages share one geometry per
// (crop, stage) and one material across every plot; both are flagged userData.shared so rebuildRaft
// never disposes them.

export const SLOT_X = .55;   // slot spacing along the plot's local x
export const SOIL_Y = .27;   // soil surface above the deck

// Merge [geometry, hex, matrix] parts into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = []; let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    g.deleteAttribute('uv');
    if (m4) g.applyMatrix4(m4);
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
function parts(T) {
  const list = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') => {
    e.set(rx, ry, rz, order); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    list.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { list, add };
}
// Tiny deterministic jitter so the model is the same on every machine.
const jit = (i, k = 1) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); }; // 0..1

export function createCropPlot(T) {
  const g = new T.Group(); g.name = 'craft_cropplot';
  const { list, add } = parts(T);
  const W = 1.8, D = .68, H = .3, WALL = .07;
  // side boards: two planks high, front/back long, ends short; slightly different tones
  for (const sz of [-1, 1]) for (let r = 0; r < 2; r++) add(new T.BoxGeometry(W, H / 2 - .008, WALL), r ? '#9a6a3e' : '#8d5f36', 0, H / 4 + r * H / 2, sz * (D / 2 - WALL / 2));
  for (const sx of [-1, 1]) for (let r = 0; r < 2; r++) add(new T.BoxGeometry(WALL, H / 2 - .008, D - WALL * 2), r ? '#946540' : '#86592f', sx * (W / 2 - WALL / 2), H / 4 + r * H / 2, 0);
  // dark plank seams and corner posts
  for (const sz of [-1, 1]) add(new T.BoxGeometry(W - .02, .014, WALL + .006), '#5a3a20', 0, H / 2, sz * (D / 2 - WALL / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.BoxGeometry(.1, H + .05, .1), '#6b4728', sx * (W / 2 - .03), (H + .05) / 2, sz * (D / 2 - .03));
  // rim cap on the long sides
  for (const sz of [-1, 1]) add(new T.BoxGeometry(W - .12, .03, WALL + .03), '#a87447', 0, H + .015, sz * (D / 2 - WALL / 2));
  // soil fill with three slot dimples (dark hollow + raised ring) and a few clods
  add(new T.BoxGeometry(W - WALL * 2, SOIL_Y - .03, D - WALL * 2), '#3b291b', 0, .03 + (SOIL_Y - .03) / 2, 0);
  for (let i = 0; i < 3; i++) {
    const x = SLOT_X * (i - 1);
    add(new T.CylinderGeometry(.18, .15, .012, 12), '#21160d', x, SOIL_Y, 0);
    add(new T.TorusGeometry(.2, .028, 5, 14), '#4d3726', x, SOIL_Y, 0, Math.PI / 2);
  }
  for (let i = 0; i < 9; i++) {
    const x = (jit(i) - .5) * (W - .3), z = (jit(i, 2) > .5 ? .21 : -.21) + (jit(i, 3) - .5) * .04;
    add(new T.DodecahedronGeometry(.025 + jit(i, 4) * .015, 0), i % 2 ? '#4a3424' : '#2f2116', x, SOIL_Y, z, jit(i, 5) * 3, jit(i, 6) * 3, 0);
  }
  const body = new T.Mesh(bake(T, list), new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, flatShading: true }));
  body.name = 'cropPlotBody'; body.castShadow = false; body.receiveShadow = true;
  g.add(body);
  g.userData.craftType = 'cropplot';
  return g;
}

// ------------------------------------------------------------------ plants

// A leaf blade fanned out from the slot centre at yaw `a`, tilted up by `tilt`.
function leaf(T, add, a, len, wid, tilt, hex, y = 0) {
  const r = len * .5 * Math.cos(tilt);
  add(new T.IcosahedronGeometry(1, 0), hex, Math.sin(a) * r, y + len * .5 * Math.sin(tilt), Math.cos(a) * r, -tilt, a, 0, wid, .012, len * .5, 'YXZ');
}
function stem(T, add, a, len, tilt, hex) { // thin coloured leaf stalk
  const r = len * .5 * Math.sin(tilt);
  add(new T.CylinderGeometry(.008, .011, len, 4), hex, Math.sin(a) * r, len * .5 * Math.cos(tilt), Math.cos(a) * r, tilt, a, 0, 1, 1, 1, 'YXZ');
}
function sprout(T) {
  const { list, add } = parts(T);
  add(new T.CylinderGeometry(.009, .012, .07, 4), '#7cbf5a', 0, .035, 0);
  leaf(T, add, 0, .07, .03, .5, '#8bd46a', .06); leaf(T, add, Math.PI, .065, .028, .55, '#79c35c', .06);
  return bake(T, list);
}
function beet(T, ripe) {
  const { list, add } = parts(T), n = ripe ? 7 : 5, L = ripe ? .26 : .16;
  if (ripe) { // the red shoulder of the root shows above the soil
    add(new T.IcosahedronGeometry(.1, 1), '#8e1f3d', 0, .02, 0, 0, 0, 0, 1, .8, 1);
    add(new T.CylinderGeometry(.03, .05, .05, 7), '#a8324a', 0, .085, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n + (jit(i) - .5) * .5, tilt = .35 + (i % 2) * .25, s = L * (.85 + jit(i, 2) * .3);
    stem(T, add, a, s * .55, tilt + .3, '#b23a55');
    const r = s * .55 * Math.sin(tilt + .3), h = s * .55 * Math.cos(tilt + .3);
    add(new T.IcosahedronGeometry(1, 0), i % 2 ? '#3f8f4a' : '#4fa356', Math.sin(a) * (r + s * .32 * Math.cos(tilt)), h + s * .32 * Math.sin(tilt) + (ripe ? .06 : 0), Math.cos(a) * (r + s * .32 * Math.cos(tilt)), -tilt, a, 0, s * .28, .012, s * .38, 'YXZ');
  }
  return bake(T, list);
}
function potato(T, ripe) {
  const { list, add } = parts(T), n = ripe ? 9 : 6, L = ripe ? .19 : .13;
  if (ripe) for (let i = 0; i < 3; i++) { // knobbly tubers poking out of the soil
    const a = i * 2.2 + .4, r = .1 + i * .015;
    add(new T.IcosahedronGeometry(.055 + i * .008, 1), i === 1 ? '#a77c48' : '#b98d55', Math.sin(a) * r, .012, Math.cos(a) * r, i, i * 2, 0, 1.2, .75, 1);
  }
  add(new T.CylinderGeometry(.012, .018, ripe ? .2 : .12, 5), '#4c8a3c', 0, ripe ? .1 : .06, 0);
  for (let i = 0; i < n; i++) { // two layers of rounded leaves: a bush, not a fan
    const a = i * 2.4 + (jit(i, 7) - .5) * .6, up = i % 3, y = (ripe ? .07 : .04) + up * (ripe ? .055 : .03), s = L * (.8 + jit(i, 8) * .35);
    leaf(T, add, a, s, s * .42, .25 + up * .25, up === 2 ? '#64b052' : i % 2 ? '#4e9a46' : '#438a3e', y);
  }
  if (ripe) for (let i = 0; i < 4; i++) { const a = i * 1.7 + .3; add(new T.IcosahedronGeometry(.02, 0), i % 2 ? '#f3ecff' : '#d8c6f0', Math.sin(a) * .07, .24 + (i % 2) * .02, Math.cos(a) * .07); add(new T.IcosahedronGeometry(.008, 0), '#f2c94c', Math.sin(a) * .07, .255 + (i % 2) * .02, Math.cos(a) * .07); }
  return bake(T, list);
}

/** Shared plant geometries + materials for every plot. Keys: sprout, beet1, beet2, potato1, potato2. */
export function cropKit(T) {
  const geos = { sprout: sprout(T), beet1: beet(T, false), beet2: beet(T, true), potato1: potato(T, false), potato2: potato(T, true) };
  for (const g of Object.values(geos)) g.userData.shared = true;
  const plantMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: 0, flatShading: true, side: T.DoubleSide });
  const wetGeo = new T.CircleGeometry(.17, 12); wetGeo.rotateX(-Math.PI / 2); wetGeo.translate(0, .009, 0);
  const wetMat = new T.MeshStandardMaterial({ color: '#140c06', roughness: .15, metalness: 0, transparent: true, opacity: .55, depthWrite: false });
  wetGeo.userData.shared = true; plantMat.userData.shared = true; wetMat.userData.shared = true;
  return { geos, plantMat, wetGeo, wetMat };
}
