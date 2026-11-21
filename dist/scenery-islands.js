// Distant islands: grey-beige rock masses on a flat sand shelf, bent palms and bushes,
// a white foam ring at the shoreline and a pale turquoise shallow halo.
// Each island is built once and merged into three meshes (solid, foam, shallows) to keep
// draw calls low. Purely decorative: no physics or gameplay depends on it.
//
//   createIsland(T, {seed, radius}) -> THREE.Group (origin at sea level, centre of the island)

const ROCK = '#9a968c', ROCK_SHADE = '#7d786e', ROCK_DARK = '#6a665d', SAND = '#e3d2a0', SAND_WET = '#cdb987';
const TRUNK = '#8f6a45', TRUNK_RING = '#76583a', LEAF_A = '#4e8f3e', LEAF_B = '#6fa548', LEAF_DARK = '#3b7134', BUSH = '#4a8a3c';

// Deterministic per-island RNG and smooth 3D value noise.
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function hash(x, y, z, k) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(k, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise3(x, y, z, k) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t, c = (i, j, m) => hash(xi + i, yi + j, zi + m, k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
const fbm = (x, y, z, k) => noise3(x, y, z, k) * .6 + noise3(x * 2.1, y * 2.1, z * 2.1, k + 7) * .28 + noise3(x * 4.3, y * 4.3, z * 4.3, k + 13) * .12;

// Accumulates non-indexed triangles with per-vertex colours into one geometry.
function makeBuilder(T) {
  const pos = [], col = [], c = new T.Color(), v = new T.Vector3();
  return {
    add(geo, matrix, colorFn) {
      const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix);
        pos.push(v.x, v.y, v.z); colorFn(v, c, i); col.push(c.r, c.g, c.b);
      }
      if (g !== geo) g.dispose(); geo.dispose();
    },
    get count() { return pos.length / 3; },
    build() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.computeVertexNormals(); g.computeBoundingSphere(); return g;
    },
  };
}

// Periodic shoreline radius around the island.
function shoreFn(r, radius) {
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3], am = [.14 + r() * .08, .08 + r() * .05, .05];
  return a => radius * (1 + am[0] * Math.sin(2 * a + ph[0]) + am[1] * Math.sin(3 * a + ph[1]) + am[2] * Math.sin(5 * a + ph[2]));
}

let shared = null;
function materials(T) {
  if (shared) return shared;
  shared = {
    solid: new T.MeshStandardMaterial({vertexColors:true, flatShading:true, roughness:.95, metalness:0}),
    foam: new T.MeshBasicMaterial({color:'#ffffff', vertexColors:true, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}),
    shallow: new T.MeshBasicMaterial({vertexColors:true, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}),
  };
  return shared;
}

// Flat ring strip following the shoreline; alpha fades from inner to outer edge.
function ringGeometry(T, shore, inner, outer, y, rgbIn, aIn, rgbOut, aOut, wobble = 0, seed = 0) {
  const n = 96, pos = [], col = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, R = shore(a), wob = wobble * noise3(Math.cos(a) * 3, Math.sin(a) * 3, 0, seed);
    for (const [d, rgb, al] of [[inner, rgbIn, aIn], [outer + wob, rgbOut, aOut]]) { pos.push(Math.sin(a) * (R + d), y, Math.cos(a) * (R + d)); col.push(rgb.r, rgb.g, rgb.b, al); }
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

function addPalm(T, B, r, x, y, z, s) {
  const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), cTrunk = new T.Color(TRUNK), cRing = new T.Color(TRUNK_RING);
  const lean = .25 + r() * .35, dir = r() * Math.PI * 2, segs = 5, segH = 1.15 * s;
  let px = x, py = y, pz = z, tilt = 0;
  for (let i = 0; i < segs; i++) {
    tilt = lean * (i / segs) * 1.4 + lean * .3; // trunk curves more toward the top
    const dx = Math.sin(dir) * Math.sin(tilt) * segH, dz = Math.cos(dir) * Math.sin(tilt) * segH, dy = Math.cos(tilt) * segH;
    const rb = (.2 - i * .022) * s, rt = (.2 - (i + 1) * .022) * s;
    e.set(Math.cos(dir) * tilt, 0, -Math.sin(dir) * tilt, 'XYZ'); q.setFromEuler(e);
    m.compose(new T.Vector3(px + dx / 2, py + dy / 2, pz + dz / 2), q, new T.Vector3(1, 1, 1));
    B.add(new T.CylinderGeometry(rt, rb * 1.08, segH * 1.04, 6, 1, true), m, (v, c, k) => c.copy(k % 6 < 3 ? cTrunk : cRing));
    px += dx; py += dy; pz += dz;
  }
  // Fronds: long drooping blades fanning from the crown.
  const fronds = 7 + Math.floor(r() * 3), cA = new T.Color(LEAF_A), cB = new T.Color(LEAF_B), cD = new T.Color(LEAF_DARK);
  for (let f = 0; f < fronds; f++) {
    const a = f / fronds * Math.PI * 2 + r() * .4, len = (2.4 + r() * .8) * s, wid = .42 * s, droop = .5 + r() * .5, pts = 5;
    const pos = [];
    for (let i = 0; i < pts; i++) {
      const t0 = i / pts, t1 = (i + 1) / pts;
      const at = t => [t * len, (Math.sin(t * 2.2) * .45 - t * t * droop * 1.6) * s];
      const [r0, y0] = at(t0), [r1, y1] = at(t1), w0 = wid * Math.sin(Math.PI * Math.min(1, t0 * 1.1 + .08)), w1 = wid * Math.sin(Math.PI * Math.min(1, t1 * 1.1 + .08));
      // two triangles per section, a slight V-fold along the midrib
      pos.push(r0, y0 + .05 * s, 0, r1, y1 + .05 * s, 0, r0, y0 - .04 * s, w0, r1, y1 + .05 * s, 0, r1, y1 - .04 * s, w1, r0, y0 - .04 * s, w0);
      pos.push(r0, y0 + .05 * s, 0, r0, y0 - .04 * s, -w0, r1, y1 + .05 * s, 0, r1, y1 + .05 * s, 0, r0, y0 - .04 * s, -w0, r1, y1 - .04 * s, -w1);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    m.makeRotationY(a); m.setPosition(px, py, pz);
    const tone = f % 2 ? cA : cB;
    B.add(g, m, (v, c, k) => c.copy(tone).lerp(cD, (k % 6) / 10));
    // fronds are thin sheets: add a back face so they show from below
    const back = g.clone(), bp = back.attributes.position.array;
    for (let i = 0; i < bp.length; i += 9) for (let j = 0; j < 3; j++) { const t = bp[i + 3 + j]; bp[i + 3 + j] = bp[i + 6 + j]; bp[i + 6 + j] = t; }
    B.add(back, m, (v, c) => c.copy(cD));
  }
}

export function createIsland(T, {seed = 1, radius = 10} = {}) {
  const r = rng(seed), mats = materials(T), B = makeBuilder(T), group = new T.Group();
  const shore = shoreFn(r, radius), m = new T.Matrix4(), q = new T.Quaternion();
  const cSand = new T.Color(SAND), cWet = new T.Color(SAND_WET), cRock = new T.Color(ROCK), cShade = new T.Color(ROCK_SHADE), cDark = new T.Color(ROCK_DARK), cBush = new T.Color(BUSH), cHi = new T.Color(LEAF_B);
  const SHELF = .45; // sand shelf height above sea level

  // Sand shelf: flat top, sloping beach down below the waterline.
  {
    const n = 64, rings = [[0, SHELF], [.82, SHELF], [.94, SHELF * .55], [1, .05], [1.12, -.9]], pos = [], col = [], idx = [];
    pos.push(0, SHELF, 0); col.push(cSand.r, cSand.g, cSand.b);
    for (let j = 1; j < rings.length; j++) for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, R = shore(a) * rings[j][0], h = rings[j][1] + (j === 1 ? noise3(Math.cos(a) * 2, Math.sin(a) * 2, 1, seed) * .08 : 0);
      pos.push(Math.sin(a) * R, h, Math.cos(a) * R); const c = j >= 3 ? cWet : cSand; col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + (i + 1) % n);
    for (let j = 1; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
      const a = 1 + (j - 1) * n + i, b = 1 + (j - 1) * n + (i + 1) % n, c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    // toNonIndexed keeps triangle order, so vertex k of the result is idx[k]
    B.add(g, null, (v, c, k) => c.setRGB(col[idx[k] * 3], col[idx[k] * 3 + 1], col[idx[k] * 3 + 2]));
  }
  const sandCount = B.count;

  // Rock masses: 2-4 noise-displaced, flat-shaded lumps, the largest near the centre.
  const lumps = 2 + Math.floor(r() * 3), rockTops = [];
  for (let l = 0; l < lumps; l++) {
    const main = l === 0, a = r() * Math.PI * 2, d = main ? r() * radius * .2 : radius * (.3 + r() * .3);
    const R = radius * (main ? .42 + r() * .12 : .2 + r() * .13), H = R * (main ? 1.05 + r() * .6 : .8 + r() * .5);
    const cx = Math.sin(a) * d, cz = Math.cos(a) * d, k = seed * 31 + l, g = new T.IcosahedronGeometry(1, 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = 1 + .32 * fbm(x * 1.3, y * 1.3, z * 1.3, k);
      x *= f; y *= f; z *= f;
      y = y < 0 ? y * .25 : Math.pow(y, .85); // flattened base, rounded crown
      // blocky ledges: quantise height slightly for a stratified cliff look
      const step = .18; y = y + (Math.round(y / step) * step - y) * .45;
      p.setXYZ(i, cx + x * R, y * H - .35, cz + z * R);
    }
    B.add(g, null, (v, c) => c.copy(cShade)); // per-face tones are applied in the colour pass below
    rockTops.push({x:cx, z:cz, y:H * .95 - .35, R, H, k});
  }

  const built = B.build();
  // Rock colour pass: one tone per face, darker low down, lighter and noisier toward the crown.
  {
    const p = built.attributes.position, c = built.attributes.color, tmp = new T.Color();
    for (let i = sandCount; i < p.count; i += 3) {
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const n = noise3(cx * .6, cy * .6, cz * .6, seed + 5) * .5 + .5, h = Math.min(1, Math.max(0, cy / (radius * .7)));
      tmp.copy(cDark).lerp(cShade, Math.min(1, cy / 1.2 + .2)).lerp(cRock, h * .7 + n * .35);
      for (let j = 0; j < 3; j++) c.setXYZ(i + j, tmp.r, tmp.g, tmp.b);
    }
  }
  // Vegetation goes in a second builder so its colours aren't touched by the rock pass.
  const V = makeBuilder(T);
  const palms = 3 + Math.floor(r() * 4);
  for (let i = 0; i < palms; i++) {
    const a = r() * Math.PI * 2, R = shore(a) * (.45 + r() * .3), s = .9 + r() * .5;
    addPalm(T, V, r, Math.sin(a) * R, SHELF - .1, Math.cos(a) * R, s);
  }
  // A palm or two on top of rocks too.
  for (const t of rockTops.slice(0, 1 + Math.floor(r() * 2))) addPalm(T, V, r, t.x + (r() - .5) * t.R * .5, t.y - .3, t.z + (r() - .5) * t.R * .5, .8 + r() * .3);
  // Bush clusters: on the sand around rock bases and on rock crowns.
  const bushes = [];
  for (let i = 0; i < 5 + Math.floor(r() * 4); i++) { const a = r() * Math.PI * 2, R = shore(a) * (.3 + r() * .45); bushes.push([Math.sin(a) * R, SHELF - .05, Math.cos(a) * R, .7 + r() * .6]); }
  for (const t of rockTops) for (let i = 0; i < 3; i++) bushes.push([t.x + (r() - .5) * t.R * .6, t.y - .25 - r() * t.H * .15, t.z + (r() - .5) * t.R * .6, t.R * (.14 + r() * .08)]);
  for (const [x, y, z, s] of bushes) {
    const k = Math.floor(r() * 1000);
    for (let j = 0; j < 3; j++) {
      const g = new T.IcosahedronGeometry(1, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const f = 1 + .25 * noise3(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2, k + j); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); }
      const sc = s * (.6 + r() * .5);
      m.compose(new T.Vector3(x + (r() - .5) * s * 1.4, y + sc * .3, z + (r() - .5) * s * 1.4), q.identity(), new T.Vector3(sc * 1.25, sc * .75, sc * 1.25));
      const lo = y, span = sc * 1.2;
      V.add(g, m, (v, c) => c.copy(cBush).lerp(cHi, Math.min(1, Math.max(0, (v.y - lo) / span))));
    }
  }
  const veg = V.build();

  // Merge rock/sand and vegetation into one geometry.
  const merged = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = built.attributes[name].array, b = veg.attributes[name].array, out = new Float32Array(a.length + b.length);
    out.set(a); out.set(b, a.length); merged.setAttribute(name, new T.BufferAttribute(out, 3));
  }
  built.dispose(); veg.dispose(); merged.computeBoundingSphere();
  const solid = new T.Mesh(merged, mats.solid); solid.receiveShadow = false; solid.castShadow = false;

  const white = new T.Color('#ffffff'), turq = new T.Color('#6fd6c8'), turqOut = new T.Color('#3fa9a8');
  const foam = new T.Mesh(ringGeometry(T, shore, -.2, 2.2, .16, white, 1, white, 0, 1.2, seed), mats.foam); foam.renderOrder = 2;
  const shallow = new T.Mesh(ringGeometry(T, shore, .2, radius * .9, .08, turq, .75, turqOut, 0, radius * .25, seed + 3), mats.shallow); shallow.renderOrder = 1;
  group.add(shallow, foam, solid);
  return group;
}

export default createIsland;
