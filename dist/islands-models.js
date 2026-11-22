// Islands: cached geometries and materials (built once per game, shared by every island).
// Everything uses vertex colours so instance colours (setColorAt) can tint a node when it drains.
import { ISLAND, SHORE_U, shape, hash3, heightU } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const noise = (x, y, z) => hash3(Math.round(x * 997), Math.round(y * 991), Math.round(z * 983));

// Merge {position, normal, color, index?} geometries into one indexed BufferGeometry.
function merge(T, geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); col.set(g.attributes.color.array, ov * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi++] = g.index.array[i] + ov;
    else for (let i = 0; i < n; i++) idx[oi++] = i + ov;
    ov += n; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
function paint(T, g, fn) { // fn(x, y, z, colour) sets the colour of each vertex
  const p = g.attributes.position, c = new Float32Array(p.count * 3), tmp = new T.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), tmp); c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b; }
  g.setAttribute('color', new T.BufferAttribute(c, 3));
  return g;
}
function lumpy(T, g, amt, sx = 1, sy = 1, sz = 1) { // jitter by position hash so shared corners stay shared
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (noise(x, y, z) - 0.5) * 2 * amt;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}
function polar(T, rings, segs, fn) { // rings: radii list (first may be 0). fn(u, theta) -> [x, y, z]
  const pos = [], idx = [];
  const ringStart = [];
  for (let r = 0; r < rings.length; r++) {
    ringStart.push(pos.length / 3);
    const n = rings[r] === 0 ? 1 : segs;
    for (let s = 0; s < n; s++) { const th = s / segs * Math.PI * 2; pos.push(...fn(rings[r], th)); }
  }
  for (let r = 1; r < rings.length; r++) {
    const a = ringStart[r - 1], b = ringStart[r], inner = rings[r - 1] === 0;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (inner) idx.push(a, b + s1, b + s);
      else idx.push(a + s, a + s1, b + s1, a + s, b + s1, b + s);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Sand dome at unit radius (the mesh is scaled by R on x/z only; heights are metres).
function domeGeometry(T) {
  const rings = [0, .08, .16, .25, .34, .43, .51, .58, .64, .69, .73, .77, .8, .83, .86, .9, .95, 1.0, 1.07, ISLAND.RIM];
  const g = polar(T, rings, 56, (u, th) => {
    const k = u * shape(th);
    return [Math.cos(th) * k, heightU(u, th), Math.sin(th) * k];
  });
  g.computeVertexNormals();
  const dry = new T.Color('#f6e2b3'), warm = new T.Color('#efcf95'), wet = new T.Color('#bf9358'), deep = new T.Color('#9c7a4c'), tmp = new T.Color();
  return paint(T, g, (x, y, z, c) => {
    const u = Math.hypot(x, z), n = noise(x * 3, 0, z * 3);
    c.copy(dry).lerp(warm, smooth(.15, .7, u)).lerp(wet, smooth(SHORE_U - .12, SHORE_U - .01, u)).lerp(deep, smooth(SHORE_U + .02, 1.05, u));
    const b = 0.96 + n * 0.08; c.r *= b; c.g *= b; c.b *= b;
    if (u > SHORE_U - .16 && u < SHORE_U - .1) c.lerp(tmp.set('#d9bb86'), .35); // faint tide line
  });
}

// Palm: curved segmented trunk + crown of drooping fronds, one geometry in one frame. The spent
// variant has straw-yellow fronds drooped ~18 degrees further. Coconuts are their own mesh.
export const PALM_H = 3.5, PALM_BEND = 0.85;
function palmGeometry(T, spent = false) {
  const H = PALM_H, BEND = PALM_BEND, SEG = 16, RAD = 7, parts = [];
  { // trunk
    const pos = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG, cx = BEND * s * s, cy = H * s, r = (0.2 - 0.085 * s) * (i % 2 ? 0.9 : 1.04);
      for (let j = 0; j < RAD; j++) { const a = j / RAD * Math.PI * 2; pos.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r); }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j, b = i * RAD + (j + 1) % RAD, c = a + RAD, d = b + RAD;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const light = new T.Color(spent ? '#a89070' : '#b88a5a'), dark = new T.Color(spent ? '#806a50' : '#8a6440');
    parts.push(paint(T, g, (x, y, z, c) => { const band = Math.round(y / H * SEG) % 2; c.copy(band ? dark : light).lerp(dark, y / H * .25); }));
  }
  const top = new T.Vector3(BEND, H, 0);
  const stem = new T.Color(spent ? '#9c8a40' : '#4c8f3c'), mid = new T.Color(spent ? '#c9b25a' : '#6cb84c'), tip = new T.Color(spent ? '#dccb86' : '#acd96c');
  const sag = spent ? 0.32 : 0; // extra droop (radians) of a spent crown
  const frond = (phi, L, lift, droop, width) => {
    const N = 12, pos = [], cols = [], idx = [];
    const dx = Math.cos(phi), dz = Math.sin(phi), sx = -dz, sz = dx;
    for (let k = 0; k <= N; k++) {
      const t = k / N, w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + .04)), .7) * (k % 2 ? .6 : 1);
      // Rotate the frond's (along, up) profile down by sag about its base.
      const al = L * t, upv = lift * t - droop * t * t, cs = Math.cos(sag), sn = Math.sin(sag);
      const al2 = al * cs + upv * sn, up2 = upv * cs - al * sn;
      const px = top.x + dx * al2, py = top.y + up2, pz = top.z + dz * al2;
      const fold = w * 0.38;
      pos.push(px + sx * w, py - fold, pz + sz * w, px, py + 0.02, pz, px - sx * w, py - fold, pz - sz * w);
      const c = new T.Color().copy(stem).lerp(mid, smooth(0, .35, t)).lerp(tip, smooth(.55, 1, t));
      const e = new T.Color().copy(c).lerp(tip, .25);
      cols.push(e.r, e.g, e.b, c.r * .85, c.g * .85, c.b * .85, e.r, e.g, e.b);
    }
    for (let k = 0; k < N; k++) { const a = k * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // Underside: same vertices (normals still facing the sky) with reversed winding, so leaves seen
    // from below are lit like their tops instead of going dark as a DoubleSide back face would.
    const both = idx.slice(); for (let i = 0; i < idx.length; i += 3) both.push(idx[i], idx[i + 2], idx[i + 1]);
    g.setIndex(both); return g;
  };
  const F = 9;
  for (let i = 0; i < F; i++) {
    const phi = i / F * Math.PI * 2 + Math.sin(i * 2.3) * .25, L = 2.1 + (i % 3) * .25;
    parts.push(frond(phi, L, .7, 1.75 + (i % 2) * .3, .44));
  }
  for (let i = 0; i < 4; i++) parts.push(frond(i / 4 * Math.PI * 2 + .6, 1.2, 1.0, .9, .3)); // young upright fronds
  return merge(T, parts);
}
// Felled palm: a short ragged stump with a pale cut top and a couple of fallen frond stubs, in the palm's
// frame (shown instead of the palm once it has been chopped down).
function stumpGeometry(T) {
  const H = .42, R0 = .21, R1 = .17, parts = [];
  const side = new T.CylinderGeometry(R1, R0, H, 9, 2, true); side.translate(0, H / 2, 0);
  const sp = side.attributes.position;
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) > H - 1e-3) { const a = Math.atan2(sp.getZ(i), sp.getX(i)); sp.setY(i, H - .07 * (.5 + .5 * Math.sin(a * 3 + .4))); } // chopped, uneven rim
  side.deleteAttribute('uv'); side.computeVertexNormals();
  const bark = new T.Color('#8a6440'), barkLight = new T.Color('#b88a5a');
  parts.push(paint(T, side, (x, y, z, c) => { c.copy(Math.round(y / H * 4) % 2 ? bark : barkLight); }));
  const top = new T.CircleGeometry(R1 * .97, 9); top.rotateX(-Math.PI / 2);
  const tp = top.attributes.position;
  for (let i = 0; i < tp.count; i++) { const a = Math.atan2(tp.getZ(i), tp.getX(i)), r = Math.hypot(tp.getX(i), tp.getZ(i)) / R1; tp.setY(i, H - .07 * r * (.5 + .5 * Math.sin(a * 3 + .4)) - .01); }
  top.deleteAttribute('uv'); top.computeVertexNormals();
  const wood = new T.Color('#e8cf9a'), ring = new T.Color('#c9a66b');
  parts.push(paint(T, top, (x, y, z, c) => { const r = Math.hypot(x, z) / R1; c.copy(r > .55 && r < .75 ? ring : wood); }));
  for (let i = 0; i < 2; i++) { // two dry fronds lying in the sand
    // 3 rows (edge, midrib, edge) so the frond gets a dark rib and folded, lighter leaflet edges: a flat
    // single-tone plane read as a shadow smear on the sand.
    const N = 8, g = new T.PlaneGeometry(.9, .26, N, 2), gp = g.attributes.position, rib = [], along = [];
    for (let j = 0; j < gp.count; j++) {
      const col = j % (N + 1), row = Math.floor(j / (N + 1)), t = (gp.getX(j) + .45) / .9;
      gp.setY(j, gp.getY(j) * Math.sin(Math.PI * Math.min(1, t * .9 + .1)) * (col % 2 ? .55 : 1)); // leaf taper, ragged edge
      gp.setZ(j, row === 1 ? 0 : .035 * (1 - t)); // edges fold up off the rib
      rib.push(row === 1); along.push(t);
    }
    g.rotateX(-Math.PI / 2); g.translate(.62, .12, 0); g.rotateY(i * 2.4 + .7); // lifted clear of the sand (palms sit 0.1 m low)
    g.deleteAttribute('uv'); g.computeVertexNormals();
    const ribC = new T.Color('#5e4a22'), st = new T.Color('#a08c3e'), tip = new T.Color('#d8c06a');
    let k = 0;
    parts.push(paint(T, g, (x, y, z, c) => { const t = along[k], r = rib[k++]; if (r) c.copy(ribC).lerp(st, t * .5); else c.copy(st).lerp(tip, t); }));
  }
  return merge(T, parts);
}
// Coconut cluster under the crown, in the palm's frame (hidden once the palm is spent).
function nutsGeometry(T) {
  const parts = [], nut = new T.Color('#6b6233'), dark = new T.Color('#4f4626');
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + .3, g = new T.IcosahedronGeometry(.11, 1);
    g.translate(PALM_BEND + Math.cos(a) * .14, PALM_H - .14 - (i % 2) * .05, Math.sin(a) * .14);
    parts.push(paint(T, g, (x, y, z, c) => c.copy(nut).lerp(dark, smooth(PALM_H - .05, PALM_H - .3, y))));
  }
  return merge(T, parts);
}

// Round bush: three lumpy spheres and a few red berries.
function bushGeometry(T) {
  const parts = [], lo = new T.Color('#2f6a34'), hi = new T.Color('#6cae4a'), berry = new T.Color('#b3242a');
  const blob = (r, x, y, z) => {
    const g = lumpy(T, new T.IcosahedronGeometry(r, 1), .14); g.translate(x, y, z);
    return paint(T, g, (px, py, pz, c) => c.copy(lo).lerp(hi, smooth(-.05, .95, py)).multiplyScalar(.92 + noise(px, py, pz) * .16));
  };
  parts.push(blob(.55, 0, .42, 0), blob(.42, .45, .3, .15), blob(.4, -.32, .3, .34), blob(.36, -.1, .32, -.42));
  const spots = [[.3, .7, .3], [-.35, .55, .5], [.1, .9, -.2], [.65, .42, .1], [-.25, .78, -.3], [.0, .5, .58], [.45, .62, -.3]];
  for (const [x, y, z] of spots) { const g = new T.IcosahedronGeometry(.032, 1); g.translate(x * 1.04, y, z * 1.04); parts.push(paint(T, g, (a, b, c2, c) => c.copy(berry))); }
  return merge(T, parts);
}

function rockGeometry(T) {
  const g = lumpy(T, new T.DodecahedronGeometry(.5, 1), .16, 1, .8, 1);
  const a = new T.Color('#7d807e'), b = new T.Color('#a7a9a5'), moss = new T.Color('#6f7f5a');
  paint(T, g, (x, y, z, c) => { c.copy(a).lerp(b, smooth(-.3, .4, y) * (.6 + noise(x, y, z) * .4)); if (y < -.18) c.lerp(moss, .35); });
  g.translate(0, .22, 0);
  return merge(T, [g]);
}

// Soft mound of pale sand with a couple of shells.
function sandGeometry(T) {
  const rings = [0, .15, .3, .45, .6, .75, .9, 1];
  const g = polar(T, rings, 20, (u, th) => { const w = 1 + .08 * Math.sin(th * 3 + 1); return [Math.cos(th) * u * .8 * w, .26 * Math.pow(1 - u * u, 2) - .03, Math.sin(th) * u * .8 * w]; });
  const pale = new T.Color('#fbeac2'), edge = new T.Color('#f0d6a0');
  paint(T, g, (x, y, z, c) => c.copy(pale).lerp(edge, smooth(.3, .7, Math.hypot(x, z))).multiplyScalar(.97 + noise(x * 5, 0, z * 5) * .06));
  const parts = [g];
  const shells = [[.18, .1, '#f7d3c6'], [-.25, -.15, '#fbf4ea'], [.05, -.3, '#f3c2a9']];
  for (const [x, z, col] of shells) {
    const s = new T.IcosahedronGeometry(.07, 0); s.scale(1, .45, 1.3); s.rotateY(x * 7); s.translate(x, .26 * Math.pow(1 - (x * x + z * z) / .64, 2) - .01, z);
    const cc = new T.Color(col); parts.push(paint(T, s, (a, b, c2, c) => c.copy(cc)));
  }
  return merge(T, parts);
}

// Shallow lagoon ring drawn on top of the (opaque) ocean, displaced by the ocean's own wave shader.
function lagoonGeometry(T) {
  const rings = []; for (let i = 0; i <= 22; i++) rings.push(lerp(.55, 2.5, Math.pow(i / 22, 1.25)));
  return polar(T, rings, 64, (u, th) => [Math.cos(th) * u, 0, Math.sin(th) * u]);
}

const FALLBACK_VERT = /* glsl */`
varying vec3 vWorld; varying vec3 vNormalW; varying float vHeight;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vHeight = 0.0; vNormalW = vec3(0.0, 1.0, 0.0); gl_Position = projectionMatrix * viewMatrix * wp; }`;

const LAGOON_FRAG = /* glsl */`
uniform float uTime; uniform vec2 uCentre; uniform float uR; uniform float uRot; uniform float uShore;
uniform vec3 uSky; uniform vec3 uSunDir; uniform float uFadeNear; uniform float uFadeFar; uniform float uOpacity;
uniform vec3 uSand; uniform vec3 uTurq; uniform vec3 uTeal; uniform vec3 uFoam;
// Shared with the ocean (day/night retints them) and their day values: the lagoon dims with the sea.
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSunColor; uniform vec3 uShallow0; uniform vec3 uDeep0;
uniform vec3 uSeaFoam; uniform vec3 uSeaFoam0;
varying vec3 vWorld; varying vec3 vNormalW; varying float vHeight;
void main() {
  vec2 d = vWorld.xz - uCentre;
  float th = atan(d.y, d.x) - uRot;
  float u = length(d) / (uR * (1.0 + 0.05 * sin(3.0 * th + 0.7) + 0.035 * sin(5.0 * th + 2.1)));
  float t = clamp((u - uShore) / (2.4 - uShore), 0.0, 1.0);
  float h = clamp(vHeight / 0.2 * 0.5 + 0.5, 0.0, 1.0);
  vec3 kS = clamp(uShallow / max(uShallow0, vec3(1e-3)), 0.0, 1.5);
  vec3 kD = clamp(uDeep / max(uDeep0, vec3(1e-3)), 0.0, 1.5);
  vec3 kF = clamp(uSeaFoam / max(uSeaFoam0, vec3(1e-3)), 0.0, 1.5);
  // Sand under the water only gets darker (a luminance ratio), so it never turns orange or blue.
  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
  float kL = clamp(dot(uShallow, LUM) / max(dot(uShallow0, LUM), 1e-3), 0.0, 1.2);
  vec3 col = mix(uSand * kL, uTurq * kS, smoothstep(0.0, 0.16, t));
  col = mix(col, uTeal * kD, smoothstep(0.22, 0.75, t));
  col *= 0.92 + 0.16 * h;
  float alpha = (1.0 - smoothstep(0.08, 1.0, t)) * 0.9;
  // foam: a wobbling line at the shore and soft rings rolling in
  float f0 = uShore + 0.02 + 0.018 * sin(uTime * 1.3 + th * 4.0);
  float brk = smoothstep(0.25, 0.65, 0.5 + 0.5 * sin(th * 19.0 + uTime * 0.35 + 2.0 * sin(th * 5.0 - uTime * 0.2)));
  float foam = (1.0 - smoothstep(0.0, 0.012, abs(u - f0))) * (0.35 + 0.65 * brk);
  float roll = fract(uTime * 0.12 + sin(th * 3.0) * 0.04);
  float f1 = uShore + 0.32 * (1.0 - roll);
  foam += (1.0 - smoothstep(0.0, 0.012, abs(u - f1))) * 0.4 * roll * brk;
  col = mix(col, uFoam * kF, clamp(foam, 0.0, 0.85));
  alpha = max(alpha, clamp(foam, 0.0, 0.85) * (1.0 - t));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vNormalW);
  float spec = pow(max(dot(reflect(-V, n), normalize(uSunDir)), 0.0), 90.0);
  col += uSunColor * spec * 0.6;
  gl_FragColor = vec4(col, alpha * uOpacity);
  #include <tonemapping_fragment>
  float fade = smoothstep(uFadeNear, uFadeFar, length(cameraPosition.xz - vWorld.xz));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, fade);
  gl_FragColor.a *= 1.0 - fade; // gone where the ocean is plain far sea, so a far island shows no pale disc
  #include <colorspace_fragment>
}`;

export function createIslandModels(T, ocean) {
  const ou = ocean && ocean.uniforms ? ocean.uniforms : null;
  const shared = (name, fallback) => (ou && ou[name] ? ou[name] : { value: fallback });
  const day = (u) => ({ value: u.value.clone() }); // the ocean's day colour, captured at start
  const lagoonUniforms = {
    uTime: shared('uTime', 0), uSky: shared('uSky', new T.Color('#cbd2c0')), uSunDir: shared('uSunDir', new T.Vector3(-.4, .8, .35)),
    uFadeNear: shared('uFadeNear', 28), uFadeFar: shared('uFadeFar', 125),
    uCentre: { value: new T.Vector2() }, uR: { value: 7 }, uRot: { value: 0 }, uShore: { value: SHORE_U }, uOpacity: { value: 1 },
    uShallow: shared('uShallow', new T.Color('#1fa9a8')), uDeep: shared('uDeep', new T.Color('#0a4a5a')),
    uSunColor: shared('uSunColor', new T.Color('#fff3d6')), uSeaFoam: shared('uFoam', new T.Color('#eefbf8')),
    uSand: { value: new T.Color('#cfa86c') }, uTurq: { value: new T.Color('#5fd3c2') }, uTeal: { value: new T.Color('#2f9a9a') }, uFoam: { value: new T.Color('#f4fbf6') },
  };
  lagoonUniforms.uShallow0 = day(lagoonUniforms.uShallow); lagoonUniforms.uDeep0 = day(lagoonUniforms.uDeep);
  lagoonUniforms.uSeaFoam0 = day(lagoonUniforms.uSeaFoam);
  const vert = ocean && ocean.material && typeof ocean.material.vertexShader === 'string' ? ocean.material.vertexShader : FALLBACK_VERT;
  const geos = {
    dome: domeGeometry(T), palm: palmGeometry(T), palmSpent: stumpGeometry(T), nuts: nutsGeometry(T), bush: bushGeometry(T), rock: rockGeometry(T), sand: sandGeometry(T), lagoon: lagoonGeometry(T),
  };
  const mats = {
    dome: new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    palm: new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 }),
    palmSpent: new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: T.DoubleSide }), // felled stump (open fronds seen from both sides)
    nuts: new T.MeshStandardMaterial({ vertexColors: true, roughness: .7 }),
    // bush and rock are non-indexed polyhedra, so their vertex normals are already face normals (flat look) without
    // flatShading: dome, palm, nuts, bush, rock and sand share one lit program
    bush: new T.MeshStandardMaterial({ vertexColors: true, roughness: .9 }),
    rock: new T.MeshStandardMaterial({ vertexColors: true, roughness: .95 }),
    sand: new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    lagoon: new T.ShaderMaterial({ uniforms: lagoonUniforms, vertexShader: vert, fragmentShader: LAGOON_FRAG, transparent: true, depthWrite: false, fog: false, lights: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
  // Distance fog on the lit island parts ends just inside camera.far (fogClip, set by islands.js), so an
  // island drifting in from past the draw distance fades in from full fog instead of popping at the far
  // plane. In clear weather the scene fog ends at 260 m, past the 200 m camera far. Shared code, so the
  // lit materials still share programs.
  const fogClip = { value: ISLAND.VIEW };
  const clipFog = sh => {
    sh.uniforms.islandFogFar = fogClip;
    sh.fragmentShader = 'uniform float islandFogFar;\n' + sh.fragmentShader.replace('#include <fog_fragment>',
      T.ShaderChunk.fog_fragment.replace('smoothstep( fogNear, fogFar, vFogDepth )', 'smoothstep( fogNear, max( fogNear + 1.0, min( fogFar, islandFogFar * 0.97 ) ), vFogDepth )'));
  };
  for (const k in mats) if (k !== 'lagoon') mats[k].onBeforeCompile = clipFog;
  return {
    geos, mats, lagoonUniforms, fogClip,
    dispose() { for (const g of Object.values(geos)) g.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
}
