// Low-poly wildlife models for dist/wildlife.js. Every builder returns ONE merged BufferGeometry with
// position, normal and color attributes, so all creatures share one vertex-coloured Lambert material.
// Conventions: nose points +z, up is +y. Built once at startup, never per frame.

function tri(T, pts) { // pts: flat [x,y,z, ...] list of triangles -> geometry with face normals
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

// One coloured piece. color is a hex number or fn(face, x, y, z) -> hex, evaluated on the untransformed
// geometry. place = [x, y, z, rx, ry, rz, sx, sy, sz] (Euler XYZ, then translate).
function part(T, geo, color, place) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new T.Color();
  for (let i = 0; i < n; i++) {
    c.setHex(typeof color === 'function' ? color(Math.floor(i / 3), pos.getX(i), pos.getY(i), pos.getZ(i)) : color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  if (place) {
    const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = place;
    const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
  }
  return g;
}

function merge(T, parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o); nor.set(p.attributes.normal.array, o); col.set(p.attributes.color.array, o);
    o += p.attributes.position.count * 3; p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const ball = (T, w = 8, h = 6) => new T.SphereGeometry(1, w, h);

// Gull body: origin at the feet, ~0.62 m long. White body and head, grey mantle, orange beak and legs.
export const GULL_SHOULDER = [0.1, 0.27, 0.05];
export function gullBodyGeometry(T) {
  const P = [];
  P.push(part(T, ball(T, 8, 4), 0xf6f6f1, [0, 0.22, 0, 0, 0, 0, 0.13, 0.12, 0.27]));
  P.push(part(T, ball(T, 5, 3), 0xa9b3bc, [0, 0.285, -0.04, 0, 0, 0, 0.1, 0.05, 0.2])); // grey mantle on the back
  P.push(part(T, ball(T, 6, 4), 0xffffff, [0, 0.34, 0.21, 0, 0, 0, 0.088, 0.085, 0.1]));
  P.push(part(T, new T.ConeGeometry(0.028, 0.13, 4, 1, true), 0xf39a24, [0, 0.33, 0.34, Math.PI / 2, 0, 0]));
  P.push(part(T, ball(T, 4, 2), 0xe0452b, [0, 0.318, 0.33, 0, 0, 0, 0.012, 0.012, 0.012])); // the little red beak spot
  for (const s of [-1, 1]) P.push(part(T, ball(T, 4, 2), 0x1b1d22, [s * 0.066, 0.36, 0.255, 0, 0, 0, 0.016, 0.018, 0.016]));
  P.push(part(T, new T.ConeGeometry(0.085, 0.2, 4), f => (f % 2 ? 0xe9ecee : 0xd9dee2), [0, 0.235, -0.31, -Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.35])); // tail
  let body = 0; for (const p of P) body += p.attributes.position.count;
  for (const s of [-1, 1]) { // legs last: the vertices after `body` get legW = 1, so the shader can tuck them in flight
    P.push(part(T, new T.CylinderGeometry(0.012, 0.012, 0.13, 3, 1, true), 0xf0a050, [s * 0.045, 0.065, 0.01]));
    P.push(part(T, new T.ConeGeometry(0.04, 0.07, 3), 0xf0a050, [s * 0.045, 0.006, 0.04, Math.PI / 2, 0, 0, 1, 1, 0.2])); // webbed foot
  }
  const g = merge(T, P), n = g.attributes.position.count, w = new Float32Array(n);
  for (let i = body; i < n; i++) w[i] = 1;
  g.setAttribute('legW', new T.BufferAttribute(w, 1));
  return g;
}
export const GULL_HIP = [0.13, 0.01]; // y, z of the leg pivot used by the tuck

// Gull wing: pivot at the shoulder, extends +x, leading edge toward +z. Grey with a black, white-spotted tip on
// top, and a pale underside as a second layer 8 mm below (DoubleSide, so this survives the mirrored left wing).
export function gullWingGeometry(T) {
  const grey = 0xa9b3bc, dark = 0x8d97a1, black = 0x23262b, white = 0xf2f2ee, pale = 0xe6eaec, paleTip = 0x4a4f55;
  const P = [];
  const r0 = [0, 0, 0.09], r1 = [0, 0, -0.1], m0 = [0.3, 0.035, 0.08], m1 = [0.3, 0.035, -0.13], t0 = [0.5, 0.02, 0.03], t1 = [0.5, 0.02, -0.12], tip = [0.68, 0, -0.1];
  const q = (a, b, c) => [...a, ...b, ...c];
  const dn = v => [v[0], v[1] - 0.008, v[2]];
  P.push(part(T, tri(T, [...q(r0, m0, r1), ...q(r1, m0, m1)]), grey));
  P.push(part(T, tri(T, [...q(m0, t0, m1), ...q(m1, t0, t1)]), dark));
  P.push(part(T, tri(T, q(t0, tip, t1)), black));
  P.push(part(T, tri(T, q([0.53, 0.022, -0.06], [0.6, 0.015, -0.085], [0.55, 0.02, -0.1])), white)); // mirror spot
  // The underside is only ever seen from below, where just the dim teal ground light reaches it. Vertex colours
  // are not clamped in the shader, so it gets a boosted, slightly warm colour that reads as a pale underwing.
  const boost = (g, k) => { const c = g.attributes.color.array; for (let i = 0; i < c.length; i += 3) { c[i] *= k[0]; c[i + 1] *= k[1]; c[i + 2] *= k[2]; } return g; };
  const UNDER = [3.0, 2.35, 2.25];
  P.push(boost(part(T, tri(T, [...q(dn(r0), dn(r1), dn(m0)), ...q(dn(r1), dn(m1), dn(m0)), ...q(dn(m0), dn(m1), dn(t0)), ...q(dn(m1), dn(t1), dn(t0))]), pale), UNDER));
  P.push(boost(part(T, tri(T, q(dn(t0), dn(t1), dn(tip))), paleTip), UNDER));
  return merge(T, P);
}

// Dolphin: ~2.4 m, centred, blue-grey back, pale belly, swept dorsal fin and flukes.
export function dolphinGeometry(T) {
  const back = 0x7097b3, belly = 0xe8eef0, fin = 0x5f86a2;
  const shade = (f, x, y) => (y > -0.25 ? back : belly);
  const P = [];
  P.push(part(T, ball(T, 14, 9), shade, [0, 0, 0, 0, 0, 0, 0.34, 0.33, 1.0]));
  P.push(part(T, new T.CylinderGeometry(0.28, 0.09, 0.75, 10), back, [0, 0.02, -1.15, Math.PI / 2 + 0.06, 0, 0])); // tail stock
  P.push(part(T, new T.CylinderGeometry(0.06, 0.11, 0.32, 8), 0xa9bcc8, [0, -0.07, 1.06, Math.PI / 2, 0, 0])); // rostrum
  P.push(part(T, ball(T, 8, 6), 0xa9bcc8, [0, -0.05, 1.2, 0, 0, 0, 0.065, 0.055, 0.06]));
  // dorsal fin: falcate, the leading edge sweeps back in a curve and the trailing edge is hooked (concave),
  // same blue-grey as the back so it never reads as a shark's straight dark fin. A wedge, thick at the base.
  const LE = [[0, 0.34], [0.1, 0.2], [0.19, 0.04], [0.25, -0.13], [0.28, -0.3]]; // [y, z] up the leading edge to the tip
  const TE = [[0, -0.16], [0.08, -0.15], [0.16, -0.17], [0.23, -0.22], [0.28, -0.3]]; // trailing edge, hooked back
  const F = [];
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const th = y => s * 0.04 * (1 - y / 0.3); // thinner toward the tip
    const a = LE[k], b = LE[k + 1], c = TE[k], d = TE[k + 1];
    F.push(th(a[0]), a[0], a[1], th(b[0]), b[0], b[1], th(c[0]), c[0], c[1]);
    F.push(th(c[0]), c[0], c[1], th(b[0]), b[0], b[1], th(d[0]), d[0], d[1]);
  }
  P.push(part(T, tri(T, F), back, [0, 0.27, -0.05]));
  // flukes
  for (const s of [-1, 1]) {
    P.push(part(T, tri(T, [0, 0, 0.1, s * 0.5, 0, -0.22, s * 0.12, 0, -0.12, 0, 0.03, 0.06, s * 0.5, 0, -0.22, 0, 0, -0.08]), fin, [0, 0.03, -1.5]));
  }
  for (const s of [-1, 1]) P.push(part(T, new T.BoxGeometry(0.34, 0.035, 0.15), fin, [s * 0.34, -0.17, 0.38, 0, s * -0.55, s * -0.45]));
  for (const s of [-1, 1]) P.push(part(T, ball(T, 6, 4), 0x16191d, [s * 0.235, 0.03, 0.78, 0, 0, 0, 0.035, 0.035, 0.035]));
  return merge(T, P);
}

// Sea turtle: ~1.3 m, faceted green shell with a patchwork of scutes, pale plastron, four flippers.
export function turtleGeometry(T) {
  const scute = [0x687f45, 0x56703c, 0x76895a, 0x4c6336]; // olive, a little less lime
  const skin = 0x98a477, P = [];
  P.push(part(T, new T.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), f => scute[(f * 7 + (f >> 2)) % 4], [0, 0.02, 0, 0, 0, 0, 0.5, 0.27, 0.64]));
  P.push(part(T, new T.CylinderGeometry(1, 0.94, 0.06, 12), 0x6b5b33, [0, 0, 0, 0, 0, 0, 0.53, 1, 0.67])); // rim
  P.push(part(T, new T.CylinderGeometry(0.94, 0.8, 0.09, 12), 0xdcc98d, [0, -0.07, 0, 0, 0, 0, 0.48, 1, 0.6])); // plastron
  P.push(part(T, new T.CylinderGeometry(0.08, 0.1, 0.24, 8), skin, [0, 0.05, 0.66, Math.PI / 2 - 0.5, 0, 0])); // neck, raised
  P.push(part(T, ball(T, 9, 7), skin, [0, 0.13, 0.82, 0, 0, 0, 0.13, 0.11, 0.16]));
  for (const s of [-1, 1]) P.push(part(T, ball(T, 6, 4), 0x16191d, [s * 0.1, 0.17, 0.89, 0, 0, 0, 0.024, 0.024, 0.024]));
  for (const s of [-1, 1]) {
    P.push(part(T, ball(T, 7, 4), skin, [s * 0.58, -0.04, 0.3, 0, s * 0.55, 0, 0.36, 0.035, 0.11])); // front flipper
    P.push(part(T, ball(T, 6, 4), skin, [s * 0.36, -0.05, -0.55, 0, s * -0.6, 0, 0.18, 0.03, 0.09])); // rear flipper
  }
  P.push(part(T, new T.ConeGeometry(0.05, 0.16, 5), skin, [0, -0.03, -0.72, -Math.PI / 2, 0, 0]));
  const g = merge(T, P); g.scale(TURTLE_SCALE, TURTLE_SCALE, TURTLE_SCALE); g.computeBoundingSphere(); return g; // ~1.3 m nose to tail
}
export const TURTLE_SCALE = 0.73; // the model is 1.78 m from head to tail before scaling

// Fish silhouette seen from above: lies flat in xz, nose +z, ~0.55 m with a notched tail (8 tris).
export function fishGeometry(T) {
  const nose = [0, 0, 0.3], l = [-0.1, 0, 0.04], r = [0.1, 0, 0.04], b = [0, 0, -0.17];
  const tl = [-0.11, 0, -0.3], tr = [0.11, 0, -0.3], notch = [0, 0, -0.24], bl = [-0.03, 0, -0.15], br = [0.03, 0, -0.15];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute([
    ...nose, ...l, ...r, ...l, ...b, ...r, ...l, ...bl, ...b, ...r, ...b, ...br,
    ...bl, ...tl, ...notch, ...br, ...notch, ...tr, ...bl, ...notch, ...b, ...b, ...notch, ...br,
  ], 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
