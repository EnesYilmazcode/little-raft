// Sky Rocket models and the shared spark pool (see docs/specs/fireworks.md section 5).
// Given THREE, imports nothing. Rocket origin = the deck top at the tile centre (game.js places decor at y = .22).
// The spark pool is ONE Points draw call: attributes are baked once, the CPU only writes small uniform arrays.

// Merge [geometry, hex, matrix?] parts into one non-indexed geometry with a colour attribute (like bees-model.js).
function bake(T, parts) {
  const geos = [];
  let n = 0;
  const c = new T.Color();
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    c.set(hex);
    const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
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

const TUBE = .05, STAND = .1; // tube radius (chunky so it reads at a few metres, MODEL-STYLE); the tube sits on a stand this tall
const TRAIL = 4; // burst sparks per streak (VS TRAIL)

// Rocket silhouette parts, origin at the deck top, ~.16 x .52 m.
function rocketParts(T, stand = true) {
  const m = new T.Matrix4(), parts = [];
  const leg = (a) => { // a wire leg from the deck out to the tube foot
    const g = new T.CylinderGeometry(.006, .006, .14, 4);
    const q = new T.Quaternion().setFromEuler(new T.Euler(0, a, .55, 'YXZ'));
    parts.push([g, '#5b4a3a', new T.Matrix4().compose(new T.Vector3(Math.cos(a) * .05, .06, -Math.sin(a) * .05), q, new T.Vector3(1, 1, 1))]);
  };
  if (stand) {
    for (let i = 0; i < 3; i++) leg(i * Math.PI * 2 / 3);
    parts.push([new T.CylinderGeometry(.03, .03, .008, 10), '#5b4a3a', m.clone().makeTranslation(0, STAND, 0)]); // stand ring
  }
  parts.push([new T.CylinderGeometry(TUBE, TUBE, .11, 12), '#e9a08c', m.clone().makeTranslation(0, STAND + .055, 0)]);
  parts.push([new T.CylinderGeometry(TUBE, TUBE, .11, 12), '#fff3cf', m.clone().makeTranslation(0, STAND + .165, 0)]);
  parts.push([new T.CylinderGeometry(TUBE + .003, TUBE + .003, .02, 12), '#e9a08c', m.clone().makeTranslation(0, STAND + .23, 0)]); // coral band
  parts.push([new T.ConeGeometry(TUBE + .008, .12, 12), '#f1d78d', m.clone().makeTranslation(0, STAND + .3, 0)]);
  // guide stick down the side, past the stand to the deck
  parts.push([new T.CylinderGeometry(.009, .009, .48, 5), '#9c7649', m.clone().makeTranslation(TUBE + .01, .24, 0)]);
  parts.push([new T.CylinderGeometry(.004, .004, .06, 4), '#2b2116', m.clone().makeRotationZ(.5).setPosition(-.016, STAND - .02, 0)]); // fuse
  return parts;
}

/** Decor model `craft_skyrocket` (lit, flat shaded, one merged mesh; a faint warm emissive so it can be found after dark, no light). */
export function createRocket(T) {
  const g = new T.Group(); g.name = 'craft_skyrocket';
  const mesh = new T.Mesh(bake(T, rocketParts(T)), new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .75, emissive: '#ff9a4a', emissiveIntensity: .14 }));
  mesh.name = 'skyrocketBody'; mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** The rocket in flight: the same silhouette with an unlit material and a bright tip. One draw call. */
export function createFlight(T) {
  const parts = rocketParts(T, false); // the wire stand stays behind
  parts.push([new T.SphereGeometry(.04, 8, 6), '#fff2c0', new T.Matrix4().makeTranslation(0, STAND - .01, 0)]); // glowing tail end
  const mesh = new T.Mesh(bake(T, parts), new T.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'fireworks-flight'; mesh.visible = false; mesh.frustumCulled = false; mesh.raycast = () => {};
  mesh.matrixAutoUpdate = true;
  return mesh;
}

const VS = /* glsl */`
uniform vec4 uSlot[S];
uniform vec4 uShape[S];
uniform vec3 uColors[5];
uniform float uPx, uMaxPx;
attribute vec4 aRnd;
attribute float aSlot, aKind, aTr;
varying vec3 vCol;
varying float vA;
const float FUSE = 1.6, RISE = 1.3, TAU = 6.2831853, DRAG = 1.4; // spec drag 2.5 gave ~3 m bursts; 1.4 gives ~5-6 m
const float TRAIL = 4.; // burst sparks come in groups of TRAIL sharing one path; aTr = 0, 1/TRAIL, ... along it
vec3 sat(vec3 c) { float l = dot(c, vec3(.299, .587, .114)); return clamp(l + (c - l) * 2.1, 0., 1.); } // the pastel palette reads as colour, not white
void hide() { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; vA = 0.; vCol = vec3(0.); }
void main() {
  int si = int(aSlot + .5);
  vec4 sl = uSlot[si], sh = uShape[si];
  float t = sl.w;
  if (t < 0.) { hide(); return; }
  vec3 pad = sl.xyz, p;
  float h = sh.y, size, a;
  int shape = int(sh.x + .5), ci = int(sh.w + .5);
  if (aKind > .5) {
    if (t < FUSE) { // fizzing fuse: tiny sparks spraying .1-.4 m from the foot
      float ph = fract(t * 2.2 + aRnd.x);
      vec3 d = normalize(vec3(aRnd.y - .5, .5 + aRnd.z, aRnd.w - .5));
      p = pad + vec3(0., .09, 0.) + d * (.1 + .3 * ph) - vec3(0., .5 * ph * ph, 0.);
      a = (1. - ph) * smoothstep(0., .15, t); size = .03;
      vCol = vec3(1., .82, .5);
    } else if (t < FUSE + RISE) { // rise: a fading tail behind the head
      float u = (t - FUSE) / RISE, lag = aRnd.x * .3, uu = max(u - lag, 0.);
      float y = h * (1. - (1. - uu) * (1. - uu));
      p = pad + vec3((aRnd.y - .5) * .12 * lag, y + .05, (aRnd.z - .5) * .12 * lag);
      a = (1. - aRnd.x) * (1. - aRnd.x) * step(lag, u); size = .3 * (1. - .6 * aRnd.x);
      vCol = vec3(1., .78, .45);
    } else { hide(); return; }
  } else {
    float ba = t - FUSE - RISE, life = shape == 2 ? 3.2 : 2.0;
    if (ba < 0. || ba > life) { hide(); return; }
    // willow: each group of TRAIL sparks draws one drooping streak (the tail runs up to .7 s behind the head);
    // sphere and ring spread the group out instead, so every spark keeps its own direction.
    float lag = shape == 2 ? aTr * .7 : 0., bt = max(ba - lag, 0.);
    vec4 r = shape == 2 ? aRnd : vec4(fract(aRnd.x + aTr * .618), fract(aRnd.y + aTr * .382), fract(aRnd.z + aTr * .7), aRnd.w);
    vec3 dir; float speed, drag = DRAG;
    if (shape == 1) {
      float th = r.x * TAU, sp = sh.z, tilt = .35 + .5 * fract(sp * .159);
      dir = vec3(cos(th), .12 * (r.y - .5), sin(th));
      float ct = cos(tilt), st = sin(tilt), cs = cos(sp), ss = sin(sp);
      dir = vec3(dir.x, dir.y * ct - dir.z * st, dir.y * st + dir.z * ct);
      dir = vec3(dir.x * cs + dir.z * ss, dir.y, -dir.x * ss + dir.z * cs);
      speed = 12.5;
    } else {
      float z = 2. * r.x - 1., ph = r.y * TAU, rr = sqrt(max(0., 1. - z * z));
      dir = vec3(rr * cos(ph), z, rr * sin(ph));
      speed = shape == 2 ? 7. + 1.5 * r.z : 11. + 3. * r.z;
      if (shape == 2) drag = 2.6; // willow: the push dies fast, then the sparks sink at a steady ~4.6 m/s
    }
    float ex = (1. - exp(-drag * bt)) / drag;
    p = pad + vec3(0., h + .05, 0.) + dir * speed * ex
      + vec3(0., shape == 2 ? -12. / drag * (bt - ex) : -1.2 * bt * bt, 0.); // willow: drag-limited fall, so the trails droop
    float k = 1. - ba / life;
    a = pow(k, shape == 2 ? .9 : 1.5) * (.75 + .25 * sin(ba * 23. + aRnd.w * 40.)) * (shape == 2 ? 1.2 - aTr * .55 : 1.) * step(lag, ba); // willow stays bright: dim gold on a blue sky reads grey
    vec3 col = sat(ci >= 5 ? uColors[int(min(r.z * 5., 4.))] : uColors[ci]);
    if (shape == 2) col = mix(col, vec3(1., .6, .12), .7);
    vCol = mix(vec3(1., .97, .9), col, smoothstep(0., .1, ba)); // white-hot at the pop
    size = (shape == 2 ? 1.1 - .4 * aTr : 1.35) * (.8 + .4 * aRnd.w);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * uPx / max(-mv.z, .05), 1., uMaxPx);
  vA = a;
}`;

const FS = /* glsl */`
varying vec3 vCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - .5;
  float d = length(q) * 2.;
  float m = 1. - smoothstep(0., 1., d);
  float a = m * vA;
  if (a < .004) discard;
  vec3 c = mix(vCol, vec3(1.), .25 * m * m * m * m); // a hot little core
  gl_FragColor = vec4(c * a * 1.7, a);
}`;

/** One Points object with slots*(sparks+trail) vertices; returns {points, uniforms}. Attributes never re-upload. */
export function createSparkPool(T, { slots, sparks, trail }) {
  const per = sparks + trail, n = slots * per;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4), slot = new Float32Array(n), kind = new Float32Array(n), tr = new Float32Array(n);
  let s = 1;
  const lcg = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const j = i % per;
    slot[i] = Math.floor(i / per); kind[i] = j < sparks ? 0 : 1;
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = lcg();
    if (j >= sparks) rnd[i * 4] = ((j - sparks) + rnd[i * 4]) / trail; // even spacing along the rise tail
    else if (j % TRAIL) { // burst sparks in groups of TRAIL share the path (x, y, z); the shader reads aTr
      for (let k = 0; k < 3; k++) rnd[i * 4 + k] = rnd[(i - 1) * 4 + k];
      tr[i] = (j % TRAIL) / TRAIL;
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new T.BufferAttribute(rnd, 4));
  geo.setAttribute('aSlot', new T.BufferAttribute(slot, 1));
  geo.setAttribute('aKind', new T.BufferAttribute(kind, 1));
  geo.setAttribute('aTr', new T.BufferAttribute(tr, 1));
  geo.boundingSphere = new T.Sphere(new T.Vector3(), 1e4);
  const uniforms = {
    uSlot: { value: Array.from({ length: slots }, () => new T.Vector4(0, 0, 0, -1)) },
    uShape: { value: Array.from({ length: slots }, () => new T.Vector4()) },
    uColors: { value: Array.from({ length: 5 }, () => new T.Vector3(1, 1, 1)) },
    uPx: { value: 500 }, uMaxPx: { value: 40 },
  };
  const mat = new T.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, defines: { S: slots },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false,
  });
  const points = new T.Points(geo, mat);
  points.name = 'fireworks-sparks'; points.frustumCulled = false; points.raycast = () => {}; points.renderOrder = 11;
  return { points, uniforms };
}
