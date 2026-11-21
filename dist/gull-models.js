// Gull Perch model (see docs/specs/companion-gull.md section 6). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). The gull stands on the crossbar at PERCH_Y.
// Static parts are merged into one vertex-coloured mesh; three small find slots sit in the woven tray, hidden by default.

export const PERCH_Y = 1.12; // crossbar top, where the gull's feet go
export const TRAY = Object.freeze({ x: .16, y: .6, z: 0 }); // tray centre (local)
export const FIND_COLOR = Object.freeze({ wood: '#9c7649', plastic: '#4fb3d9', rope: '#d8c08a', seed: '#7a9a3a' });
const SLOTS = [[-.07, -.03], [.06, -.04], [0, .06]];

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    g.applyMatrix4(m4);
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

export function createPerch(T) {
  const g = new T.Group(); g.name = 'craft_perch';
  const parts = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(1, 1, 1);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  const lean = .04, topX = Math.sin(lean) * 1.1; // the post leans a little toward -x
  add(new T.CylinderGeometry(.22, .23, .05, 16), '#7a5a36', 0, .025, 0); // round base plate
  add(new T.CylinderGeometry(.04, .05, 1.1, 7), '#a88457', -topX / 2, .05 + .55, 0, 0, 0, lean); // driftwood post
  add(new T.CylinderGeometry(.03, .03, .36, 7), '#b89466', -topX, PERCH_Y - .03, 0, 0, 0, Math.PI / 2); // crossbar the gull stands on
  for (const sx of [-1, 1]) add(new T.SphereGeometry(.034, 6, 4), '#8e6c3e', -topX + sx * .18, PERCH_Y - .03, 0); // knotty bar ends
  // the tray arm and the woven tray
  add(new T.CylinderGeometry(.02, .02, .16, 6), '#8e6c3e', TRAY.x / 2, TRAY.y - .04, 0, 0, 0, Math.PI / 2);
  add(new T.CylinderGeometry(.16, .13, .06, 14, 1, true), '#c9a46a', TRAY.x, TRAY.y, TRAY.z); // open woven wall
  add(new T.CylinderGeometry(.13, .13, .012, 14), '#a8834f', TRAY.x, TRAY.y - .024, TRAY.z); // flat bottom disc
  add(new T.TorusGeometry(.158, .014, 5, 16), '#8e6c3e', TRAY.x, TRAY.y + .03, TRAY.z, Math.PI / 2, 0, 0); // darker rim
  for (let i = 0; i < 6; i++) { // weave stripes on the wall
    const a = i / 6 * Math.PI * 2;
    add(new T.BoxGeometry(.012, .055, .01), '#9c7a48', TRAY.x + Math.sin(a) * .147, TRAY.y, TRAY.z + Math.cos(a) * .147, 0, a, 0);
  }
  const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new T.Mesh(bake(T, parts), mat); body.name = 'perchBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const box = new T.BoxGeometry(.07, .04, .05), finds = [];
  SLOTS.forEach(([x, z], i) => {
    const m = new T.Mesh(box, new T.MeshLambertMaterial({ color: '#9c7649' })); m.name = 'find' + i;
    m.position.set(TRAY.x + x, TRAY.y - .002, TRAY.z + z); m.rotation.y = i * 1.3 + .4;
    m.visible = false; m.castShadow = true; g.add(m); finds.push(m);
  });
  g.userData.finds = finds; g.userData.sig = '';
  return g;
}

/** Show one slot per find, coloured by its kind. Cached on the joined list. */
export function paintPerch(g, finds) {
  const u = g?.userData; if (!u || !u.finds) return;
  const list = Array.isArray(finds) ? finds : [], sig = list.join();
  if (u.sig === sig) return;
  u.sig = sig;
  for (let i = 0; i < u.finds.length; i++) {
    const m = u.finds[i], k = list[i];
    m.visible = i < list.length && !!FIND_COLOR[k];
    if (m.visible) m.material.color.set(FIND_COLOR[k]);
  }
}
