// Distant scenery islands: low grey-beige rock masses with green undergrowth on a sand shelf that
// slopes gently down under the water, bent palms and bushes around the rock bases, a broken white
// foam ring along an irregular shoreline and a pale turquoise shallows halo.
// Each island is merged into three meshes (solid, foam, shallows), so it costs three draw calls.
// Purely decorative: physics, sailing blockers and the seafloor use their own radii in game.js.
//
//   createIsland(T, {seed, radius}) -> THREE.Group (origin at sea level, centre of the island)

const ROCK = '#9a968c', ROCK_SHADE = '#7d786e', ROCK_DARK = '#67635a', SAND = '#e3d2a0', SAND_WET = '#cbb683', SAND_SUNK = '#8fbfa6';
const TRUNK = '#8f6a45', TRUNK_RING = '#76583a', LEAF_A = '#4e8f3e', LEAF_B = '#6fa548', LEAF_DARK = '#3b7134';
const BUSH = '#467f37', BUSH_HI = '#79ab4c', MOSS = '#5d8a40', MOSS_DARK = '#46703a';
const TOP = .55;  // sand height at the island centre (m above sea level)
const SAND_P = 2.4; // shelf profile exponent: height = TOP * (1 - u^P), u = distance / shoreline radius

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
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

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

// Irregular shoreline radius around the island: a few broad lobes plus small coves and points.
function shoreFn(r, radius, seed) {
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3], am = [.13 + r() * .07, .07 + r() * .05, .05, .03];
  return a => radius * (1 + am[0] * Math.sin(2 * a + ph[0]) + am[1] * Math.sin(3 * a + ph[1]) + am[2] * Math.sin(5 * a + ph[2])
    + am[3] * Math.sin(9 * a + ph[3]) + .05 * noise3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0, seed + 41));
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

// Flat band following the shoreline. stops: [[offset m from shore, Color, alpha]...] from inside out;
// each stop's offset wobbles by `wobble` m and its alpha by `patchy` (0..1) along the shore.
function bandGeometry(T, shore, stops, y, wobble, patchy, seed) {
  const n = 120, S = stops.length, pos = [], col = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), R = shore(a);
    for (let s = 0; s < S; s++) {
      const [d, rgb, al] = stops[s], w = s ? wobble * noise3(ca * 3, sa * 3, s, seed) : 0;
      const p = 1 - patchy * clamp01(.5 + noise3(ca * 7, sa * 7, s * 3, seed + 9));
      pos.push(sa * (R + d + w), y, ca * (R + d + w)); col.push(rgb.r, rgb.g, rgb.b, al * p);
    }
    if (i < n) for (let s = 0; s < S - 1; s++) { const k = i * S + s, k2 = k + S; idx.push(k, k + 1, k2, k + 1, k2 + 1, k2); }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

// Bent palm with a ringed trunk leaning along `dir` and a crown of drooping fronds.
function addPalm(T, B, r, x, y, z, s, dir) {
  const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), cTrunk = new T.Color(TRUNK), cRing = new T.Color(TRUNK_RING);
  const lean = .3 + r() * .3, segs = 5, segH = 1.05 * s;
  let px = x, py = y, pz = z;
  for (let i = 0; i < segs; i++) {
    const tilt = lean * (i / segs) * 1.4 + lean * .3; // trunk curves more toward the top
    const dx = Math.sin(dir) * Math.sin(tilt) * segH, dz = Math.cos(dir) * Math.sin(tilt) * segH, dy = Math.cos(tilt) * segH;
    const rb = (.19 - i * .021) * s, rt = (.19 - (i + 1) * .021) * s;
    e.set(Math.cos(dir) * tilt, 0, -Math.sin(dir) * tilt, 'XYZ'); q.setFromEuler(e);
    m.compose(new T.Vector3(px + dx / 2, py + dy / 2, pz + dz / 2), q, new T.Vector3(1, 1, 1));
    B.add(new T.CylinderGeometry(rt, rb * 1.08, segH * 1.04, 5, 1, true), m, (v, c, k) => c.copy(k % 6 < 3 ? cTrunk : cRing));
    px += dx; py += dy; pz += dz;
  }
  const fronds = 7 + Math.floor(r() * 2), cA = new T.Color(LEAF_A), cB = new T.Color(LEAF_B), cD = new T.Color(LEAF_DARK);
  for (let f = 0; f < fronds; f++) {
    const a = f / fronds * Math.PI * 2 + r() * .4, len = (2.2 + r() * .7) * s, wid = .4 * s, droop = .55 + r() * .5, pts = 4;
    const pos = [];
    for (let i = 0; i < pts; i++) {
      const t0 = i / pts, t1 = (i + 1) / pts;
      const at = t => [t * len, (Math.sin(t * 2.2) * .45 - t * t * droop * 1.6) * s];
      const [r0, y0] = at(t0), [r1, y1] = at(t1), w0 = wid * Math.sin(Math.PI * Math.min(1, t0 * 1.1 + .08)), w1 = wid * Math.sin(Math.PI * Math.min(1, t1 * 1.1 + .08));
      pos.push(r0, y0 + .05 * s, 0, r1, y1 + .05 * s, 0, r0, y0 - .04 * s, w0, r1, y1 + .05 * s, 0, r1, y1 - .04 * s, w1, r0, y0 - .04 * s, w0);
      pos.push(r0, y0 + .05 * s, 0, r0, y0 - .04 * s, -w0, r1, y1 + .05 * s, 0, r1, y1 + .05 * s, 0, r0, y0 - .04 * s, -w0, r1, y1 - .04 * s, -w1);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    m.makeRotationY(a); m.setPosition(px, py, pz);
    const tone = f % 2 ? cA : cB;
    const back = g.clone(), bp = back.attributes.position.array; // thin sheets: back faces so fronds show from below
    for (let i = 0; i < bp.length; i += 9) for (let j = 0; j < 3; j++) { const t = bp[i + 3 + j]; bp[i + 3 + j] = bp[i + 6 + j]; bp[i + 6 + j] = t; }
    B.add(g, m, (v, c, k) => c.copy(tone).lerp(cD, (k % 6) / 10));
    B.add(back, m, (v, c) => c.copy(cD));
  }
}

export function createIsland(T, {seed = 1, radius = 6} = {}) {
  const r = rng(seed), mats = materials(T), B = makeBuilder(T), group = new T.Group();
  const shore = shoreFn(r, radius, seed), m = new T.Matrix4(), q = new T.Quaternion();
  const cSand = new T.Color(SAND), cWet = new T.Color(SAND_WET), cSunk = new T.Color(SAND_SUNK), tmp = new T.Color();
  const sandY = (x, z) => { const u = Math.hypot(x, z) / shore(Math.atan2(x, z)); return TOP * (1 - Math.pow(u, SAND_P)); };

  // Sand shelf: a low dune that slopes evenly through the waterline (u = 1) and on down under the sea,
  // so the beach meets the water along a ragged, wave-cut line instead of a hard pancake rim.
  {
    const n = 56, rings = [.18, .36, .52, .66, .78, .87, .94, 1, 1.07, 1.16, 1.28, 1.45], pos = [], idx = [];
    pos.push(0, TOP, 0);
    for (const u of rings) for (let i = 0; i < n; i++) {
      const a = (i + (u * 7 % 1) * .5) / n * Math.PI * 2, R = shore(a) * u;
      const h = TOP * (1 - Math.pow(u, SAND_P)) + (u < .95 ? noise3(Math.sin(a) * R * .5, 0, Math.cos(a) * R * .5, seed + 3) * .07 : 0);
      pos.push(Math.sin(a) * R, h, Math.cos(a) * R);
    }
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + (i + 1) % n);
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
      const a = 1 + j * n + i, b = 1 + j * n + (i + 1) % n, c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    B.add(g, null, (v, c) => {
      const n2 = noise3(v.x * .7, 0, v.z * .7, seed + 17) * .04;
      c.copy(cSand).lerp(cWet, smooth(.16, .02, v.y)).lerp(cSunk, smooth(-.05, -.6, v.y)).multiplyScalar(1 + n2);
    });
  }
  const sandCount = B.count;

  // Rock masses: wide, low, noise-displaced lumps with stepped ledges, the largest a little off-centre.
  const lumps = 2 + Math.floor(r() * 2), rocks = [];
  for (let l = 0; l < lumps; l++) {
    const main = l === 0, a = r() * Math.PI * 2, d = main ? radius * (.08 + r() * .14) : radius * (.28 + r() * .2);
    const R = radius * (main ? .46 + r() * .1 : .24 + r() * .1), H = R * (main ? 1 + r() * .25 : .7 + r() * .3);
    const cx = Math.sin(a) * d, cz = Math.cos(a) * d, k = seed * 31 + l, g = new T.IcosahedronGeometry(1, 2), p = g.attributes.position;
    const sx = 1 + r() * .35, rot = r() * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = 1 + .34 * fbm(x * 1.3, y * 1.3, z * 1.3, k);
      x *= f * sx; y *= f; z *= f;
      y = y < 0 ? y * .3 : Math.pow(y, .8); // flattened base, broad shoulders
      const step = .2; y += (Math.round(y / step) * step - y) * .5; // stratified ledges
      const rx = x * cr - z * sr, rz = x * sr + z * cr;
      p.setXYZ(i, cx + rx * R, y * H + sandY(cx, cz) - .3, cz + rz * R);
    }
    B.add(g, null, c => c);
    rocks.push({x:cx, z:cz, R:R * (1 + (sx - 1) * .5), H});
  }

  const built = B.build();
  // Rock colour pass, one tone per face: dark at the base, lighter toward the crown, with moss and
  // undergrowth on gentle upward-facing ledges and in a ragged band around the foot of each rock.
  {
    const p = built.attributes.position, c = built.attributes.color, nrm = built.attributes.normal;
    const cRock = new T.Color(ROCK), cShade = new T.Color(ROCK_SHADE), cDark = new T.Color(ROCK_DARK), cMoss = new T.Color(MOSS), cMossD = new T.Color(MOSS_DARK);
    for (let i = sandCount; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const n = noise3(cx * .6, cy * .6, cz * .6, seed + 5) * .5 + .5, up = nrm.getY(i), above = cy - sandY(cx, cz);
      tmp.copy(cDark).lerp(cShade, clamp01(above / 1.1 + .25)).lerp(cRock, clamp01(above / (radius * .45)) * .7 + n * .3);
      const g = noise3(cx * 1.1, cy * 1.1, cz * 1.1, seed + 23);
      if ((up > .72 && g > .05) || (above < .45 && g > -.1) || (up > .45 && above < 1.1 && g > .2)) tmp.copy(g > .15 ? cMoss : cMossD).multiplyScalar(.92 + n * .16);
      for (let j = 0; j < 3; j++) c.setXYZ(i + j, tmp.r, tmp.g, tmp.b);
    }
  }

  // Vegetation in a second builder so the rock colour pass leaves it alone.
  const V = makeBuilder(T);
  const clearOfRocks = (x, z, pad) => rocks.every(o => Math.hypot(x - o.x, z - o.z) > o.R * pad);
  // Palms grow from the foot of the rocks and from open sand, leaning out toward the sea.
  for (const o of rocks.slice(0, 2)) {
    for (let i = 0, want = 1 + Math.floor(r() * 2); i < want; i++) {
      const a = r() * Math.PI * 2, x = o.x + Math.sin(a) * o.R * (.95 + r() * .15), z = o.z + Math.cos(a) * o.R * (.95 + r() * .15);
      if (Math.hypot(x, z) > shore(Math.atan2(x, z)) * .8) continue;
      addPalm(T, V, r, x, sandY(x, z) - .1, z, .7 + r() * .25, Math.atan2(x, z) + (r() - .5) * .8);
    }
  }
  for (let i = 0, want = 1 + Math.floor(r() * 3), tries = 0; i < want && tries < 12; tries++) {
    const a = r() * Math.PI * 2, R = shore(a) * (.45 + r() * .3), x = Math.sin(a) * R, z = Math.cos(a) * R;
    if (!clearOfRocks(x, z, 1.1)) continue;
    addPalm(T, V, r, x, sandY(x, z) - .1, z, .62 + r() * .25, a + (r() - .5) * .9); i++;
  }
  // Bushes: clumps hugging the rock bases, a few out on the sand.
  const bushes = [];
  for (const o of rocks) for (let i = 0, nb = 3 + Math.floor(r() * 3); i < nb; i++) {
    const a = r() * Math.PI * 2, x = o.x + Math.sin(a) * o.R * (.85 + r() * .2), z = o.z + Math.cos(a) * o.R * (.85 + r() * .2);
    if (Math.hypot(x, z) < shore(Math.atan2(x, z)) * .85) bushes.push([x, sandY(x, z) - .1, z, .5 + r() * .45]);
  }
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) { const a = r() * Math.PI * 2, R = shore(a) * (.35 + r() * .35), x = Math.sin(a) * R, z = Math.cos(a) * R; if (clearOfRocks(x, z, 1)) bushes.push([x, sandY(x, z) - .08, z, .4 + r() * .35]); }
  const cBush = new T.Color(BUSH), cHi = new T.Color(BUSH_HI);
  for (const [x, y, z, s] of bushes) {
    const k = Math.floor(r() * 1000);
    for (let j = 0; j < 2; j++) {
      const g = new T.IcosahedronGeometry(1, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const f = 1 + .25 * noise3(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2, k + j); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); }
      const sc = s * (.65 + r() * .45);
      m.compose(new T.Vector3(x + (r() - .5) * s * 1.3, y + sc * .25, z + (r() - .5) * s * 1.3), q.identity(), new T.Vector3(sc * 1.3, sc * .7, sc * 1.3));
      V.add(g, m, (v, c) => c.copy(cBush).lerp(cHi, clamp01((v.y - y) / (sc * 1.1))));
    }
  }
  const veg = V.build();

  // Merge sand/rock and vegetation into one geometry: one draw call for all solid parts.
  const merged = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = built.attributes[name].array, b = veg.attributes[name].array, out = new Float32Array(a.length + b.length);
    out.set(a); out.set(b, a.length); merged.setAttribute(name, new T.BufferAttribute(out, 3));
  }
  built.dispose(); veg.dispose(); merged.computeBoundingSphere();
  const solid = new T.Mesh(merged, mats.solid); solid.castShadow = false; solid.receiveShadow = false;

  const white = new T.Color('#ffffff'), turq = new T.Color('#74d8c9'), turqOut = new T.Color('#3fa9a8');
  // Foam: a broken white line hugging the waterline, fading seaward.
  const foam = new T.Mesh(bandGeometry(T, shore, [[-.35, white, 0], [.05, white, .95], [.6, white, .55], [1.6, white, 0]], .14, .45, .55, seed), mats.foam);
  // Shallows: pale turquoise over the submerged shelf, fading into the deep water.
  const shallow = new T.Mesh(bandGeometry(T, shore, [[-.2, turq, 0], [.5, turq, .75], [radius * .45, turq, .5], [radius * 1.05, turqOut, 0]], .07, radius * .2, 0, seed + 3), mats.shallow);
  foam.renderOrder = 2; shallow.renderOrder = 1;
  for (const o of [solid, foam, shallow]) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  group.add(shallow, foam, solid);
  return group;
}

export default createIsland;
