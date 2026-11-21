// Display Shelf and Trophy Stand models (see docs/specs/display-shelf.md section 6).
// Given THREE, imports nothing. Local origin = centre of the floor tile top (game.js places decor at y = .22).
// Static parts are merged into one vertex-coloured mesh per model. Each slot has an empty anchor
// (`slot0..slot2`, a direct child) at the centre of its top surface; display.js hangs item clones under it.

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
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

function kit(T) {
  const parts = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { parts, add };
}

const bodyMat = T => new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0 });
const anchor = (T, g, i, x, y, z) => { const a = new T.Object3D(); a.name = 'slot' + i; a.position.set(x, y, z); g.add(a); return a; };

export const SHELF_SLOT_X = Object.freeze([-.42, 0, .42]);
export const SHELF_SLOT_Y = .66, STAND_SLOT_Y = .74;

// ------------------------------------------------------------------ display shelf (about 1.3 x 0.75 x 0.45)

export function createShelf(T) {
  const g = new T.Group(); g.name = 'craft_shelf';
  const { parts, add } = kit(T);
  const W = '#b4824b', D = '#906f48', L = '#c99560';
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.05, .75, .45), D, sx * .625, .375, 0);   // side boards
  add(new T.BoxGeometry(1.2, .08, .42), W, 0, .62, 0);                                       // top plank (top surface .66)
  add(new T.BoxGeometry(1.2, .06, .42), W, 0, .25, 0);                                       // lower plank
  add(new T.BoxGeometry(1.2, .3, .03), D, 0, .43, -.2);                                      // back board between the planks
  add(new T.BoxGeometry(1.2, .04, .03), L, 0, .68, .2);                                      // front rail lip
  add(new T.BoxGeometry(1.2, .05, .03), D, 0, .7, -.205);                                    // back rail
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.07, .04, .07), '#7d5c37', sx * .625, .77, 0); // little end caps
  // a few books and a jar on the lower plank so the shelf never looks bare
  add(new T.BoxGeometry(.06, .2, .16), '#6f9fb3', -.45, .38, -.05);
  add(new T.BoxGeometry(.05, .18, .16), '#d98a6a', -.39, .37, -.05);
  add(new T.BoxGeometry(.06, .19, .16), '#e5c46b', -.33, .375, -.05, 0, 0, -.12);
  add(new T.CylinderGeometry(.06, .06, .12, 10), '#9fd6d0', .38, .34, 0);
  const body = new T.Mesh(bake(T, parts), bodyMat(T)); body.name = 'shelfBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  SHELF_SLOT_X.forEach((x, i) => anchor(T, g, i, x, SHELF_SLOT_Y, 0));
  g.updateMatrixWorld(true);
  return g;
}

// ------------------------------------------------------------------ trophy stand (0.4 pedestal, 0.44 trim, 0.74 tall)

export function createTrophyStand(T) {
  const g = new T.Group(); g.name = 'craft_trophystand';
  const { parts, add } = kit(T);
  add(new T.BoxGeometry(.44, .08, .44), '#7d5c37', 0, .04, 0);      // plinth
  add(new T.BoxGeometry(.4, .58, .4), '#b4824b', 0, .37, 0);         // column (front face z .2)
  add(new T.BoxGeometry(.42, .03, .42), '#906f48', 0, .095, 0);      // base moulding
  add(new T.BoxGeometry(.44, .08, .44), '#6e4f33', 0, .70, 0);       // darker cap (top surface .74)
  const body = new T.Mesh(bake(T, parts), bodyMat(T)); body.name = 'standBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const brass = new T.MeshStandardMaterial({ color: '#c9a24a', roughness: .38, metalness: .55 });
  const plaque = new T.Mesh(new T.BoxGeometry(.22, .06, .01), brass); plaque.name = 'plaque'; plaque.position.set(0, .45, .205);
  g.add(plaque);
  const peg = new T.Mesh(new T.CylinderGeometry(.014, .014, .05, 8), brass); peg.name = 'peg'; peg.position.set(0, STAND_SLOT_Y + .025, 0);
  peg.visible = false; // shown while a trophy is mounted
  g.add(peg);
  anchor(T, g, 0, 0, STAND_SLOT_Y, 0);
  g.updateMatrixWorld(true);
  return g;
}
