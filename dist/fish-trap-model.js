// Fish Trap model (see docs/specs/fish-trap.md section 7). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). The open water is local +z:
// a post near the tile edge, an arm reaching out over the water and a woven basket hanging off its tip.
// Static parts are merged into one vertex-coloured mesh; the hanging basket is a second merged mesh.

export const OVERHANG = 1.15;
const PIVOT_Y = .48, PIVOT_Z = OVERHANG + .1;
// basket, relative to the pivot: 4 stacked bands from the bottom up, tapering r .17 (bottom) to .24 (top)
const BASKET_TOP = -.5, BAND_H = .085, BAND_GAP = .013;
const BANDS = [[.19, .17], [.215, .19], [.235, .215], [.24, .235]]; // [top, bottom] radius, bottom band first
export const BASKET_CENTRE_Y = BASKET_TOP - 2 * (BAND_H + BAND_GAP); // about -.70 from the pivot

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
  bk.add(new T.CylinderGeometry(.012, .012, .6, 5), '#d8c39a', 0, -.3, 0);         // rope down into the mouth
  bk.add(new T.TorusGeometry(.03, .008, 4, 8), '#d8c39a', 0, -.012, 0, 0, Math.PI / 2, 0); // rope loop round the arm tip
  for (let i = 0; i < BANDS.length; i++) {
    const [rt, rb] = BANDS[i], y = BASKET_TOP - (BANDS.length - i - .5) * (BAND_H + BAND_GAP);
    bk.add(new T.CylinderGeometry(rt, rb, BAND_H, 10, 1, true), i % 2 ? '#93683a' : '#b98a4e', 0, y, 0);
  }
  const bottomY = BASKET_TOP - BANDS.length * (BAND_H + BAND_GAP);
  bk.add(new T.CylinderGeometry(.17, .17, .02, 10), '#7a5530', 0, bottomY + .01, 0); // floor of the basket
  for (let i = 0; i < 8; i++) { // vertical ribs, leaning with the taper
    const a = i * Math.PI / 4, r = .212;
    bk.add(new T.BoxGeometry(.018, BASKET_TOP - bottomY + .02, .018), '#7a5530', Math.sin(a) * r, (BASKET_TOP + bottomY) / 2, Math.cos(a) * r, Math.cos(a) * .19, 0, -Math.sin(a) * .19);
  }
  bk.add(new T.CylinderGeometry(.2, .07, .12, 10, 1, true), '#a87a44', 0, BASKET_TOP - .06, 0); // funnel mouth
  bk.add(new T.TorusGeometry(.235, .02, 5, 14), '#7a5530', 0, BASKET_TOP, 0, Math.PI / 2, 0, 0); // rim
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
export function paintTrap(g, full, elapsed, phase = 0) {
  const u = g?.userData; if (!u || !u.hang) return;
  const h = u.hang;
  h.position.y = PIVOT_Y + .025 * Math.sin(elapsed * 1.4 + phase);
  h.rotation.x = .05 * Math.sin(elapsed * 1.1 + phase);
  h.rotation.z = .04 * Math.sin(elapsed * .9 + phase * 2);
  const f = full ? 1 : 0;
  if (u.sig !== f) { u.sig = f; u.fish.visible = !!full; }
  if (full) u.fish.rotation.y = .25 * Math.sin(elapsed * 5 + phase);
}
