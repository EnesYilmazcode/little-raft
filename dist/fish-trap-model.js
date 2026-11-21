// Fish Trap model (see docs/specs/fish-trap.md section 7). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). The open water is local +z:
// a post near the tile edge, an arm reaching out over the water and a woven basket hanging off its tip.
// Static parts are merged into one vertex-coloured mesh; the hanging basket is a second merged mesh.

export const OVERHANG = 1.15;
const PIVOT_Y = .48, PIVOT_Z = OVERHANG + .1;
// basket, relative to the pivot: a bellied creel woven as a checker of light and dark cells (ROWS x COLS),
// "over" cells standing a little proud of "under" cells, with thin dark gaps between the rows.
const BASKET_TOP = -.5, ROW_H = .08, ROW_GAP = .012, COLS = 12;
const PROFILE = [.15, .2, .235, .245, .238, .222]; // ring radii from the bottom up (ROWS + 1 rings)
const ROWS = PROFILE.length - 1, WEAVE = ['#d6a865', '#7c5430']; // two wood tones
const BASKET_BOTTOM = BASKET_TOP - ROWS * (ROW_H + ROW_GAP);
export const BASKET_CENTRE_Y = (BASKET_TOP + BASKET_BOTTOM) / 2; // about -.73 from the pivot

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
  const parts = [], q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(1, 1, 1);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { parts, add };
}

export function createFishTrap(T) {
  const g = new T.Group(); g.name = 'craft_fishtrap';
  // --- static: post and arm
  const st = kit(T);
  st.add(new T.BoxGeometry(.08, .5, .08), '#8a6640', 0, .25, .6);
  st.add(new T.BoxGeometry(.06, .06, .75), '#9c7649', 0, PIVOT_Y, .925);
  st.add(new T.BoxGeometry(.14, .03, .14), '#7a5530', 0, .015, .6); // little foot plate on the deck
  st.add(new T.BoxGeometry(.04, .14, .04), '#7a5530', 0, .4, .68, -.8, 0, 0); // brace
  const body = new T.Mesh(bake(T, st.parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true }));
  body.name = 'trapBody'; body.castShadow = true; body.receiveShadow = true; g.add(body);

  // --- the hanging basket
  const hang = new T.Group(); hang.name = 'hang'; hang.position.set(0, PIVOT_Y, PIVOT_Z); g.add(hang);
  const bk = kit(T);
  const ROPE = '#e6d3a3', RW = 2 * Math.PI / COLS;
  bk.add(new T.TorusGeometry(.046, .013, 4, 10), ROPE); // rope lashed round the arm tip (the arm runs along z)
  const KNOT_Y = BASKET_TOP + .2;
  bk.add(new T.CylinderGeometry(.016, .016, -.046 - KNOT_Y, 5), ROPE, 0, (KNOT_Y - .046) / 2, 0); // rope from the arm down to the bridle knot
  bk.add(new T.SphereGeometry(.03, 6, 4), ROPE, 0, KNOT_Y, 0);
  const up = new T.Vector3(0, 1, 0), dir = new T.Vector3(), mid = new T.Vector3(), rq = new T.Quaternion(), one = new T.Vector3(1, 1, 1);
  for (let i = 0; i < 3; i++) { // three bridle ropes from the knot to the rim
    const a = i * 2 * Math.PI / 3 + .5, rx = Math.sin(a) * PROFILE[ROWS], rz = Math.cos(a) * PROFILE[ROWS];
    dir.set(rx, BASKET_TOP - KNOT_Y, rz); const len = dir.length(); dir.normalize();
    mid.set(rx / 2, (BASKET_TOP + KNOT_Y) / 2, rz / 2); rq.setFromUnitVectors(up, dir);
    bk.parts.push([new T.CylinderGeometry(.01, .01, len, 4), ROPE, new T.Matrix4().compose(mid, rq, one)]);
  }
  for (let r = 0; r < ROWS; r++) { // the weave: a checker of cells, alternate tones, "over" cells proud
    const y = BASKET_BOTTOM + r * (ROW_H + ROW_GAP) + ROW_H / 2, rb = PROFILE[r], rt = PROFILE[r + 1];
    for (let c = 0; c < COLS; c++) {
      const over = (r + c) % 2 === 0, d = over ? .012 : 0;
      bk.add(new T.CylinderGeometry(rt + d, rb + d, ROW_H, 2, 1, true, c * RW, RW), WEAVE[over ? 0 : 1], 0, y, 0);
    }
  }
  bk.add(new T.CylinderGeometry(.13, .15, .02, 10), '#4a3420', 0, BASKET_BOTTOM + .01, 0); // dark floor: the inside reads deep through the mouth
  for (const [ry, rr] of [[BASKET_BOTTOM, PROFILE[0] + .01], [BASKET_TOP, PROFILE[ROWS] + .012]]) // dark binding hoops top and bottom
    bk.add(new T.TorusGeometry(rr, .018, 5, 16), '#5e3f22', 0, ry, 0, Math.PI / 2, 0, 0);
  for (let c = 0; c < COLS; c++) // funnel mouth: woven wedges sloping in to a small opening, alternate tones
    bk.add(new T.CylinderGeometry(PROFILE[ROWS] - .01, .075, .16, 2, 1, true, c * RW, RW), WEAVE[c % 2], 0, BASKET_TOP - .08, 0);
  bk.add(new T.TorusGeometry(.078, .012, 4, 10), '#5e3f22', 0, BASKET_TOP - .16, 0, Math.PI / 2, 0, 0); // lip of the funnel opening
  const basket = new T.Mesh(bake(T, bk.parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true, side: T.DoubleSide }));
  basket.name = 'basket'; basket.castShadow = true; hang.add(basket);

  // --- fish silhouette inside, shown when the trap is full
  const fish = new T.Group(); fish.name = 'fish'; fish.visible = false; fish.position.set(0, BASKET_CENTRE_Y + .02, 0);
  const fm = new T.MeshStandardMaterial({ color: '#24343d', transparent: true, opacity: .85, roughness: .5 });
  const fb = new T.Mesh(new T.SphereGeometry(1, 10, 6), fm); fb.scale.set(.17, .06, .05); fish.add(fb);
  const tail = new T.Mesh(new T.ConeGeometry(.05, .08, 4), fm); tail.position.set(-.2, 0, 0); tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, .3); fish.add(tail);
  const fin = new T.Mesh(new T.ConeGeometry(.025, .05, 3), fm); fin.position.set(.02, .065, 0); fin.scale.set(1, 1, .3); fish.add(fin);
  hang.add(fish);

  g.userData.hang = hang; g.userData.fish = fish; g.userData.sig = -1;
  return g;
}

/** Bob and sway the basket; the fish silhouette shows when full (cached). No allocation. */
export function paintTrap(g, full, elapsed, phase = 0, move = true) { // move=false: off-screen or far, only the fish visibility updates
  const u = g?.userData; if (!u || !u.hang) return;
  const f = full ? 1 : 0;
  if (u.sig !== f) { u.sig = f; u.fish.visible = !!full; }
  if (!move) return;
  const h = u.hang;
  h.position.y = PIVOT_Y + .025 * Math.sin(elapsed * 1.4 + phase);
  h.rotation.x = .05 * Math.sin(elapsed * 1.1 + phase);
  h.rotation.z = .04 * Math.sin(elapsed * .9 + phase * 2);
  if (full) u.fish.rotation.y = .25 * Math.sin(elapsed * 5 + phase);
}
