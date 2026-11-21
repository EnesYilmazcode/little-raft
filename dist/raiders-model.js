// Scarecrow model and the raider gull kit (own low-poly art). Given THREE; imports only the scenery gull geometry.
// Scarecrow: local origin = centre of the floor tile top (game.js places decor at y = .22). Four merged
// vertex-coloured meshes (body, left arm, right arm, head) so a pecked scarecrow can lose them one by one.
// Receives shadows, casts none.
import { gullBodyGeometry, gullWingGeometry, GULL_SHOULDER } from './wildlife-models.js?build=v3-survival-ae77fa84ac2b';

export const SCARECROW_TOP = 1.86; // where a raider lands: on top of the straw hat (above the tile top)
export { GULL_SHOULDER };

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
function partList(T) {
  const list = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    list.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { list, add };
}
const jit = (i, k = 1) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

const WOOD = '#8d5f36', WOOD_D = '#6b4728', COAT = '#4f9c9a', COAT_D = '#3d7f7e', PATCH = '#d9773a', STRAW = '#e0b45a', STRAW_D = '#c99a42', SACK = '#e6cf8f', HAT = '#b98a52', TWINE = '#7a5a2a', INK = '#2a2420';

// One arm: a plastic-coat sleeve along the crossbar with a straw tuft at the cuff. side = -1 left, +1 right.
function armParts(T, add, side) {
  add(new T.CylinderGeometry(.075, .095, .42, 6), side < 0 ? COAT : COAT_D, side * .36, 1.25, 0, 0, 0, Math.PI / 2);
  add(new T.CylinderGeometry(.1, .1, .05, 6), TWINE, side * .56, 1.25, 0, 0, 0, Math.PI / 2); // cuff tie
  for (let k = 0; k < 5; k++) { // straw sticking out of the cuff, fanned
    const a = (k - 2) * .32, len = .14 + jit(k, side + 3) * .06;
    add(new T.ConeGeometry(.022, len, 3), k % 2 ? STRAW : STRAW_D, side * (.6 + len / 2 * Math.cos(a)), 1.25 + len / 2 * Math.sin(a), (jit(k, 7) - .5) * .08, 0, 0, side * (Math.PI / 2) - a * side);
  }
  if (side > 0) add(new T.BoxGeometry(.12, .1, .02), PATCH, .38, 1.27, .085, 0, 0, .2); // a sewn-on patch
}
function headParts(T, add) {
  add(new T.SphereGeometry(.17, 8, 6), SACK, 0, 1.6, 0, 0, 0, 0, 1, 1.08, .95); // stuffed sack head
  add(new T.CylinderGeometry(.06, .08, .1, 6), TWINE, 0, 1.44, 0); // neck tie
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; add(new T.ConeGeometry(.02, .1, 3), STRAW, Math.sin(a) * .07, 1.39, Math.cos(a) * .07, Math.cos(a) * .6, 0, -Math.sin(a) * .6); } // straw below the tie
  for (const s of [-1, 1]) add(new T.BoxGeometry(.045, .045, .02), INK, s * .06, 1.64, .158, 0, 0, Math.PI / 4); // stitched cross eyes
  for (let k = 0; k < 4; k++) add(new T.BoxGeometry(.028, .012, .02), INK, -.06 + k * .04, 1.545 + (k % 2) * .012, .155, 0, 0, (k % 2 ? -1 : 1) * .5); // zigzag mouth
  add(new T.CylinderGeometry(.3, .32, .03, 10), HAT, 0, 1.73, 0, .06, 0, -.05); // straw hat brim
  add(new T.CylinderGeometry(.1, .15, .14, 8), HAT, 0, 1.8, 0, .06, 0, -.05); // crown
  add(new T.CylinderGeometry(.152, .152, .03, 8), PATCH, 0, 1.75, 0, .06, 0, -.05); // hat band
}

/** Scarecrow decor model: group 'craft_scarecrow' with meshes named body, armL, armR, head. */
export function createScarecrow(T) {
  const g = new T.Group(); g.name = 'craft_scarecrow';
  const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = (name, build) => { const { list, add } = partList(T); build(add); const m = new T.Mesh(bake(T, list), mat); m.name = name; m.castShadow = false; m.receiveShadow = true; g.add(m); return m; };
  mesh('body', (add) => {
    add(new T.BoxGeometry(.5, .06, .5), WOOD_D, 0, .03, 0); // foot plate nailed to the deck
    for (const [x, z] of [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]]) add(new T.CylinderGeometry(.018, .018, .02, 5), '#9fb1bf', x, .065, z);
    add(new T.CylinderGeometry(.045, .055, 1.5, 6), WOOD, 0, .75, 0); // pole
    add(new T.BoxGeometry(1.0, .07, .07), WOOD, 0, 1.25, 0); // crossbar
    add(new T.CylinderGeometry(.2, .27, .62, 7), COAT, 0, 1.02, 0); // plastic coat body
    add(new T.CylinderGeometry(.205, .205, .05, 7), TWINE, 0, .86, 0); // belt of twine
    add(new T.BoxGeometry(.14, .12, .02), PATCH, -.08, 1.08, .22, 0, 0, -.15);
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; add(new T.ConeGeometry(.025, .16, 3), k % 2 ? STRAW : STRAW_D, Math.sin(a) * .22, .66, Math.cos(a) * .22, Math.PI - Math.cos(a) * .35, 0, Math.sin(a) * .35); } // straw under the hem
  });
  mesh('armL', (add) => armParts(T, add, -1));
  mesh('armR', (add) => armParts(T, add, 1));
  mesh('head', (add) => headParts(T, add));
  return g;
}

/** Shared raider gull geometry (the scenery gull's) + one material. Legs stay standing (no tuck shader). */
export function raiderKit(T) {
  const body = gullBodyGeometry(T); body.deleteAttribute('legW');
  return { body, wing: gullWingGeometry(T), mat: new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: T.DoubleSide }) };
}
