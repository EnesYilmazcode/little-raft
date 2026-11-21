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

// ------------------------------------------------------------------ the companion gull (its own, softer low-poly model)
// The wild gulls keep wildlife-models.js. Conventions match it: origin at the feet, nose +z, up +y; the wing pivots at
// the shoulder, extends +x, leading edge toward +z. Body vertices of the legs get legW = 1 for the tuck shader.
export const COMPANION_SHOULDER = [0.1, 0.27, 0.05];
export const COMPANION_HIP = [0.13, 0.01]; // y, z of the leg pivot used by the tuck

// One coloured piece: color is a hex or fn(cx, cy, cz) of the untransformed face centre (one flat colour per face).
// place = [x, y, z, rx, ry, rz, sx, sy, sz].
function piece(T, geo, color, place) {
  const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
  const p = g.attributes.position.array, n = p.length / 3, col = new Float32Array(n * 3), c = new T.Color();
  for (let f = 0; f < n; f += 3) {
    const i = f * 3;
    c.setHex(typeof color === 'function' ? color((p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3) : color);
    for (let k = 0; k < 3; k++) { col[i + k * 3] = c.r; col[i + k * 3 + 1] = c.g; col[i + k * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (place) {
    const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));
  }
  return g;
}
function join(T, parts) {
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); col.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; g.dispose(); }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const tris = (T, pts) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); g.computeVertexNormals(); return g; };

/** A round, cute seagull: white body and head, grey back saddle, yellow beak with a red spot, small dark eyes. */
export function companionBodyGeometry(T) {
  const white = 0xf7f7f3, grey = 0xaab4bd, P = [];
  const ball = (w, h) => new T.SphereGeometry(1, w, h);
  P.push(piece(T, ball(10, 7), (x, y, z) => (y > .42 && z < .55 ? grey : white), [0, .215, -.03, 0, 0, 0, .12, .11, .25])); // body, grey saddle on top
  P.push(piece(T, ball(10, 7), white, [0, .355, .2, 0, 0, 0, .092, .088, .095])); // a big round head
  P.push(piece(T, ball(8, 6), white, [0, .295, .12, 0, 0, 0, .085, .08, .095])); // neck: joins the head to the body from every side
  P.push(piece(T, new T.ConeGeometry(.026, .11, 5), 0xf5c518, [0, .338, .31, Math.PI / 2, 0, 0])); // yellow beak
  P.push(piece(T, ball(4, 3), 0xe0452b, [0, .327, .34, 0, 0, 0, .011, .01, .011])); // the red beak spot
  for (const s of [-1, 1]) {
    P.push(piece(T, ball(6, 4), 0x1b1d22, [s * .07, .375, .258, 0, 0, 0, .014, .016, .014])); // small eye
    P.push(piece(T, ball(4, 2), 0xffffff, [s * .079, .383, .266, 0, 0, 0, .005, .005, .005])); // eye glint
  }
  P.push(piece(T, new T.ConeGeometry(.08, .18, 4), (x, y) => (y < -.05 ? 0xd9dee2 : 0xeef0f1), [0, .235, -.31, -Math.PI / 2, Math.PI / 4, 0, 1, 1, .35])); // tail
  let body = 0; for (const g of P) body += g.attributes.position.count;
  for (const s of [-1, 1]) { // legs last: legW = 1 so the shader can tuck them in flight
    P.push(piece(T, new T.CylinderGeometry(.012, .012, .13, 3, 1, true), 0xf0a050, [s * .045, .065, .01]));
    P.push(piece(T, new T.ConeGeometry(.04, .07, 3), 0xf0a050, [s * .045, .006, .04, Math.PI / 2, 0, 0, 1, 1, .2])); // webbed foot
  }
  const g = join(T, P), n = g.attributes.position.count, w = new Float32Array(n);
  for (let i = body; i < n; i++) w[i] = 1;
  g.setAttribute('legW', new T.BufferAttribute(w, 1));
  return g;
}

/** A slim wing that tapers to a point: grey top, darker grey outer half, charcoal tip with a white mirror spot, pale underside. */
export function companionWingGeometry(T) {
  const grey = 0xaab4bd, dark = 0x939daa, tipC = 0x2c3036, white = 0xf2f2ee, pale = 0xe6eaec, paleTip = 0x50565d;
  const r0 = [0, 0, .05], r1 = [0, 0, -.06], m0 = [.26, .02, .04], m1 = [.26, .02, -.08], t0 = [.44, .012, .01], t1 = [.46, .012, -.07], tip = [.62, 0, -.07];
  const q = (a, b, c) => [...a, ...b, ...c], dn = v => [v[0], v[1] - .008, v[2]], P = [];
  P.push(piece(T, tris(T, [...q(r0, m0, r1), ...q(r1, m0, m1)]), grey));
  P.push(piece(T, tris(T, [...q(m0, t0, m1), ...q(m1, t0, t1)]), dark));
  P.push(piece(T, tris(T, q(t0, tip, t1)), tipC));
  P.push(piece(T, tris(T, q([.5, .009, -.035], [.55, .005, -.055], [.51, .009, -.06])), white)); // mirror spot
  // underside: only lit by the dim ground light, so its colours are boosted (as the wild gull's)
  const boost = g => { const c = g.attributes.color.array; for (let i = 0; i < c.length; i += 3) { c[i] *= 3; c[i + 1] *= 2.35; c[i + 2] *= 2.25; } return g; };
  P.push(boost(piece(T, tris(T, [...q(dn(r0), dn(r1), dn(m0)), ...q(dn(r1), dn(m1), dn(m0)), ...q(dn(m0), dn(m1), dn(t0)), ...q(dn(m1), dn(t1), dn(t0))]), pale)));
  P.push(boost(piece(T, tris(T, q(dn(t0), dn(t1), dn(tip))), paleTip)));
  return join(T, P);
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
