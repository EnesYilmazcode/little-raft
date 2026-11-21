// Procedural distant island for Little Raft: grey layered rock mass, grassy caps, palms,
// a sand beach ring and a white foam line at the shore. No assets.
// createIsland(T, seed) -> THREE.Group standing on the water plane (y = 0), ~40 m across.
// Everything solid is merged into one flat-shaded vertex-coloured mesh; the foam is a second
// mesh, so an island costs 2 draw calls. Static: no per-frame work. userData.dispose() frees it.

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function hash3(x, y, z, k) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z, k) { // trilinear value noise, 0..1
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
           L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (x, y, z, k) => noise3(x, y, z, k) * .6 + noise3(x * 2.1, y * 2.1, z * 2.1, k + 3) * .3 + noise3(x * 4.3, y * 4.3, z * 4.3, k + 7) * .1;

const SAND = '#e8d9a8', WET = '#cbbb8b', DEEP = '#9c9a76';
const ROCK = ['#8d8f86', '#a3a294', '#979a8e', '#85877e'], ROCK_WET = '#6c6f66';
const GRASS = ['#5e8f3e', '#6c9c44', '#527f36', '#77a64b'];
const TRUNK = ['#8f7454', '#a3875f'], FROND = ['#4f8f3a', '#64a446', '#3f7a30'];

export function createIsland(T, seed = 1) {
  const r = rng(seed * 9973 + 17), K = (seed % 97) + 1;
  const pos = [], col = [], c = new T.Color();
  const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();

  // Push one triangle with a single colour (crisp facets).
  function tri(a, b, cc, hex) {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
    c.set(hex); for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  }
  // Bake a (non-indexed) geometry with matrix m; colour(centroid, normal, faceIndex) -> hex.
  function bake(geo, m, colour) {
    const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      va.fromBufferAttribute(p, i).applyMatrix4(m); vb.fromBufferAttribute(p, i + 1).applyMatrix4(m); vc.fromBufferAttribute(p, i + 2).applyMatrix4(m);
      const n = e1.subVectors(vb, va).cross(e2.subVectors(vc, va)).normalize();
      const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3, cz = (va.z + vb.z + vc.z) / 3;
      tri(va, vb, vc, colour(cx, cy, cz, n, i / 3));
    }
    if (g !== geo) g.dispose(); geo.dispose();
  }
  const M = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));

  // ---------------------------------------------------------------- ground: grass plateau, sand ring, wet skirt
  const R0 = 17 + r() * 4, ph = [r() * 6.3, r() * 6.3, r() * 6.3];
  const shore = a => R0 * (1 + .12 * Math.sin(2 * a + ph[0]) + .08 * Math.sin(3 * a + ph[1]) + .05 * Math.sin(5 * a + ph[2]));
  const RINGS = [ // [fraction of shore radius, height, colour]
    [0, 1.45, 'g'], [.32, 1.4, 'g'], [.5, 1.25, 'g'], [.6, 1.05, 'g'], [.66, .9, SAND], [.82, .6, SAND], [.93, .32, SAND], [1, .1, WET], [1.14, -1.6, DEEP],
  ];
  const SEG = 44, ringPt = (k, j) => { const a = j / SEG * Math.PI * 2, R = shore(a) * RINGS[k][0], h = RINGS[k][1] + (k && k < 6 ? (fbm(Math.cos(a) * 3, Math.sin(a) * 3, k, K) - .5) * .35 : 0); return new T.Vector3(Math.sin(a) * R, h, Math.cos(a) * R); };
  const ground = (k, j) => { const col = RINGS[k + 1][2]; return col === 'g' ? GRASS[Math.floor(hash3(k, j, 1, K) * 4)] : col; };
  for (let k = 0; k < RINGS.length - 1; k++) for (let j = 0; j < SEG; j++) {
    const a0 = ringPt(k, j), a1 = ringPt(k, j + 1), b0 = ringPt(k + 1, j), b1 = ringPt(k + 1, j + 1), hex = ground(k, j);
    if (k === 0) tri(a0, b0, b1, hex);
    else { tri(a0, b0, b1, hex); tri(a0, b1, a1, hex); }
  }
  const groundY = (x, z) => { // approximate plateau height at (x, z)
    const a = Math.atan2(x, z), f = Math.hypot(x, z) / shore(a);
    for (let k = 0; k < RINGS.length - 1; k++) if (f <= RINGS[k + 1][0]) { const t = (f - RINGS[k][0]) / (RINGS[k + 1][0] - RINGS[k][0]); return RINGS[k][1] + (RINGS[k + 1][1] - RINGS[k][1]) * t; }
    return -1.6;
  };

  // ---------------------------------------------------------------- rocks: displaced, terraced, strata-coloured
  const rocks = [];
  const mainA = r() * Math.PI * 2, mainD = R0 * (.12 + r() * .12);
  rocks.push({x: Math.sin(mainA) * mainD, z: Math.cos(mainA) * mainD, w: R0 * .42, h: 8.5 + r() * 3, d: R0 * .34, y: -1.2, det: 4});
  rocks.push({x: Math.sin(mainA + .9) * (mainD + R0 * .3), z: Math.cos(mainA + .9) * (mainD + R0 * .3), w: R0 * .26, h: 5 + r() * 2, d: R0 * .22, y: -.8, det: 3});
  for (let i = 0; i < 4; i++) { // smaller boulders, some at the waterline
    const a = mainA + (i - 1.5) * .7 + (r() - .5) * .3, d = R0 * (.55 + r() * .45), s = 1.6 + r() * 2.4;
    rocks.push({x: Math.sin(a) * d, z: Math.cos(a) * d, w: s * 1.3, h: s, d: s, y: groundY(Math.sin(a) * d, Math.cos(a) * d) - s * .35, det: 2});
  }
  rocks.forEach((k, ri) => {
    const geo = new T.IcosahedronGeometry(1, k.det), p = geo.attributes.position, v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = fbm(v.x * 1.6 + ri * 5, v.y * 1.6, v.z * 1.6, K);
      v.multiplyScalar(.78 + n * .5);
      if (v.y < 0) v.y *= .55; // flatter base
      v.y = Math.max(v.y, -.6);
      // terraces: pull heights toward ledges so the mass reads as layered rock
      const sy = v.y * k.h, step = 1.15, ty = Math.round(sy / step) * step;
      v.y = (sy + (ty - sy) * .7) / k.h;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const tilt = (r() - .5) * .25;
    bake(geo, M(k.x, k.y, k.z, r() * 6.3, k.w, k.h, k.d, tilt, (r() - .5) * .2), (x, y, z, n, f) => {
      const grassy = n.y > .62 && y > 1.6;
      if (grassy) return GRASS[Math.floor(hash3(f, ri, 2, K) * 4)];
      if (y < .9) return ROCK_WET;
      const band = Math.floor((y + (noise3(x * .25, y * .2, z * .25, K) - .5) * 1.2) / 1.25);
      return ROCK[((band % 4) + 4) % 4];
    });
    k.top = k.y + k.h * .95;
  });

  // ---------------------------------------------------------------- vegetation: bushes on caps and plateau, palms
  const clearOfRock = (x, z, pad) => rocks.slice(0, 2).every(k => Math.hypot((x - k.x) / (k.w + pad), (z - k.z) / (k.d + pad)) > 1);
  for (let i = 0; i < 10; i++) {
    let x, z, y;
    if (i < 3) { const k = rocks[i % 2]; x = k.x + (r() - .5) * k.w * .7; z = k.z + (r() - .5) * k.d * .7; y = k.top - 1.4; }
    else { const a = r() * 6.3, d = R0 * (.2 + r() * .4); x = Math.sin(a) * d; z = Math.cos(a) * d; if (!clearOfRock(x, z, .5)) continue; y = groundY(x, z) - .2; }
    const s = 1 + r() * 1.3;
    bake(new T.IcosahedronGeometry(1, 1), M(x, y + s * .3, z, r() * 6, s * 1.3, s * .8, s * 1.2), (cx, cy, cz, n, f) => GRASS[Math.floor(hash3(f, i, 3, K) * 4)]);
  }
  const palms = 3 + Math.floor(r() * 3);
  for (let i = 0, tries = 0; i < palms && tries < 40; tries++) {
    const a = r() * 6.3, d = R0 * (.25 + r() * .45), x = Math.sin(a) * d, z = Math.cos(a) * d;
    if (!clearOfRock(x, z, 1.5)) continue;
    palm(x, groundY(x, z) - .1, z, 5.5 + r() * 3, a + (r() - .5) * .8, i++);
  }
  function palm(x, y, z, H, lean, idx) {
    const segs = 6, segH = H / segs, bend = .05 + r() * .05, dir = new T.Vector3(Math.sin(lean), 0, Math.cos(lean));
    const p = new T.Vector3(x, y, z), up = new T.Vector3(0, 1, 0), q = new T.Quaternion();
    for (let i = 0; i < segs; i++) {
      const tiltAng = bend * (i + 1), axis = new T.Vector3().crossVectors(up, dir).normalize();
      q.setFromAxisAngle(axis, tiltAng);
      const step = up.clone().applyQuaternion(q).multiplyScalar(segH), mid = p.clone().addScaledVector(step, .5);
      const rad = .32 - i * .03;
      const m = new T.Matrix4().compose(mid, q, new T.Vector3(1, 1, 1));
      bake(new T.CylinderGeometry(rad * .88, rad, segH * 1.04, 6, 1, true), m, () => TRUNK[i % 2]);
      p.add(step);
    }
    const fronds = 8;
    for (let f = 0; f < fronds; f++) {
      const ay = f / fronds * Math.PI * 2 + r() * .4, L = 3.2 + r() * 1.2, lift = .35 + r() * .25;
      const out = new T.Vector3(Math.sin(ay), 0, Math.cos(ay)), side = new T.Vector3(Math.cos(ay), 0, -Math.sin(ay));
      let prev = p.clone(), prevW = .05;
      for (let s = 1; s <= 5; s++) {
        const t = s / 5, w = Math.sin(t * Math.PI) * .75 + .05;
        const pt = p.clone().addScaledVector(out, L * t).add(new T.Vector3(0, L * (lift * t - (lift + .55) * t * t), 0));
        const ridgeA = prev, ridgeB = pt, drop = new T.Vector3(0, -.18, 0);
        const la = prev.clone().addScaledVector(side, prevW).add(drop), lb = pt.clone().addScaledVector(side, w).add(drop);
        const ra = prev.clone().addScaledVector(side, -prevW).add(drop), rb = pt.clone().addScaledVector(side, -w).add(drop);
        const hex = FROND[(f + s + idx) % 3];
        tri(ridgeA, la, lb, hex); tri(ridgeA, lb, ridgeB, hex); tri(ridgeA, ridgeB, rb, hex); tri(ridgeA, rb, ra, hex);
        prev = pt; prevW = w;
      }
    }
    for (let n = 0; n < 3; n++) bake(new T.IcosahedronGeometry(.22, 0), M(p.x + Math.sin(n * 2.1) * .25, p.y - .25, p.z + Math.cos(n * 2.1) * .25), () => '#6b4a2a');
  }

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const solidMat = new T.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .95, metalness: 0, side: T.DoubleSide});
  const solid = new T.Mesh(geo, solidMat); solid.name = 'island';

  // ---------------------------------------------------------------- foam line hugging the shore
  const fp = [], FS = 72;
  for (let j = 0; j < FS; j++) {
    const a0 = j / FS * Math.PI * 2, a1 = (j + 1) / FS * Math.PI * 2, s0 = shore(a0), s1 = shore(a1);
    const P = (a, R) => [Math.sin(a) * R, .16, Math.cos(a) * R];
    const i0 = P(a0, s0 * .985), o0 = P(a0, s0 * 1.04 + .5), i1 = P(a1, s1 * .985), o1 = P(a1, s1 * 1.04 + .5);
    fp.push(...i0, ...o0, ...o1, ...i0, ...o1, ...i1);
  }
  const fgeo = new T.BufferGeometry(); fgeo.setAttribute('position', new T.Float32BufferAttribute(fp, 3)); fgeo.computeBoundingSphere();
  const foamMat = new T.MeshBasicMaterial({color: '#f4f7f2', transparent: true, opacity: .85, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2});
  const foam = new T.Mesh(fgeo, foamMat); foam.name = 'island-foam'; foam.renderOrder = 1;

  const group = new T.Group(); group.name = 'island'; group.add(solid, foam);
  group.userData.dispose = () => { geo.dispose(); fgeo.dispose(); solidMat.dispose(); foamMat.dispose(); };
  return group;
}

export default createIsland;
