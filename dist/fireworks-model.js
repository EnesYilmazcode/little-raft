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

const TUBE = .035, STAND = .1; // tube radius; the tube sits on a stand this tall

// Rocket silhouette parts, origin at the deck top, ~.15 x .5 m.
function rocketParts(T, stand = true) {
  const m = new T.Matrix4(), parts = [];
  const leg = (a) => { // a thin wire leg from the deck out to the tube foot
    const g = new T.CylinderGeometry(.004, .004, .14, 4);
    const q = new T.Quaternion().setFromEuler(new T.Euler(0, a, .55, 'YXZ'));
    parts.push([g, '#5b4a3a', new T.Matrix4().compose(new T.Vector3(Math.cos(a) * .037, .06, -Math.sin(a) * .037), q, new T.Vector3(1, 1, 1))]);
  };
  if (stand) {
    for (let i = 0; i < 3; i++) leg(i * Math.PI * 2 / 3);
    parts.push([new T.CylinderGeometry(.02, .02, .006, 10), '#5b4a3a', m.clone().makeTranslation(0, STAND, 0)]); // stand ring
  }
  parts.push([new T.CylinderGeometry(TUBE, TUBE, .09, 12), '#e9a08c', m.clone().makeTranslation(0, STAND + .045, 0)]);
  parts.push([new T.CylinderGeometry(TUBE, TUBE, .09, 12), '#fff3cf', m.clone().makeTranslation(0, STAND + .135, 0)]);
  parts.push([new T.CylinderGeometry(TUBE + .002, TUBE + .002, .02, 12), '#e9a08c', m.clone().makeTranslation(0, STAND + .19, 0)]); // coral band
  parts.push([new T.ConeGeometry(TUBE + .006, .09, 12), '#f1d78d', m.clone().makeTranslation(0, STAND + .245, 0)]);
  // guide stick down the side, past the stand to the deck
  parts.push([new T.CylinderGeometry(.006, .006, .44, 5), '#9c7649', m.clone().makeTranslation(TUBE + .007, .22, 0)]);
  parts.push([new T.CylinderGeometry(.003, .003, .05, 4), '#2b2116', m.clone().makeRotationZ(.5).setPosition(-.012, STAND - .015, 0)]); // fuse
  return parts;
}

/** Decor model `craft_skyrocket` (lit, flat shaded, one merged mesh). */
export function createRocket(T) {
  const g = new T.Group(); g.name = 'craft_skyrocket';
  const mesh = new T.Mesh(bake(T, rocketParts(T)), new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .75 }));
  mesh.name = 'skyrocketBody'; mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** The rocket in flight: the same silhouette with an unlit material and a bright tip. One draw call. */
export function createFlight(T) {
  const parts = rocketParts(T, false); // the wire stand stays behind
  parts.push([new T.SphereGeometry(.03, 8, 6), '#fff2c0', new T.Matrix4().makeTranslation(0, STAND - .01, 0)]); // glowing tail end
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
attribute float aSlot, aKind;
varying vec3 vCol;
varying float vA;
const float FUSE = 1.6, RISE = 1.3, TAU = 6.2831853, DRAG = 1.4; // spec drag 2.5 gave ~3 m bursts; 1.4 gives ~5-6 m
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
    vec3 dir; float speed, grav = 1.;
    if (shape == 1) {
      float th = aRnd.x * TAU, sp = sh.z, tilt = .35 + .5 * fract(sp * .159);
      dir = vec3(cos(th), .12 * (aRnd.y - .5), sin(th));
      float ct = cos(tilt), st = sin(tilt), cs = cos(sp), ss = sin(sp);
      dir = vec3(dir.x, dir.y * ct - dir.z * st, dir.y * st + dir.z * ct);
      dir = vec3(dir.x * cs + dir.z * ss, dir.y, -dir.x * ss + dir.z * cs);
      speed = 8.;
    } else {
      float z = 2. * aRnd.x - 1., ph = aRnd.y * TAU, r = sqrt(max(0., 1. - z * z));
      dir = vec3(r * cos(ph), z, r * sin(ph));
      speed = shape == 2 ? 4. + aRnd.z : 7. + 2. * aRnd.z;
      if (shape == 2) grav = 3.;
    }
    p = pad + vec3(0., h + .05, 0.) + dir * speed * (1. - exp(-DRAG * ba)) / DRAG + vec3(0., -1.2 * grav * ba * ba, 0.);
    float k = 1. - ba / life;
    a = pow(k, 1.5) * (.75 + .25 * sin(ba * 23. + aRnd.w * 40.));
    vec3 col = ci >= 5 ? uColors[int(min(aRnd.z * 5., 4.))] : uColors[ci];
    if (shape == 2) col = mix(col, vec3(1., .81, .48), .6);
    vCol = mix(vec3(1., .97, .9), col, smoothstep(0., .15, ba)); // white-hot at the pop
    size = (shape == 2 ? .75 : .9) * (.8 + .4 * aRnd.w);
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
  vec3 c = mix(vCol, vec3(1.), .45 * m * m * m * m); // a hot little core
  gl_FragColor = vec4(c * a * 2.2, a);
}`;

/** One Points object with slots*(sparks+trail) vertices; returns {points, uniforms}. Attributes never re-upload. */
export function createSparkPool(T, { slots, sparks, trail }) {
  const per = sparks + trail, n = slots * per;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4), slot = new Float32Array(n), kind = new Float32Array(n);
  let s = 1;
  const lcg = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const j = i % per;
    slot[i] = Math.floor(i / per); kind[i] = j < sparks ? 0 : 1;
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = lcg();
    if (j >= sparks) rnd[i * 4] = ((j - sparks) + rnd[i * 4]) / trail; // even spacing along the rise tail
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new T.BufferAttribute(rnd, 4));
  geo.setAttribute('aSlot', new T.BufferAttribute(slot, 1));
  geo.setAttribute('aKind', new T.BufferAttribute(kind, 1));
  geo.boundingSphere = new T.Sphere(new T.Vector3(), 1e4);
  const uniforms = {
    uSlot: { value: Array.from({ length: slots }, () => new T.Vector4(0, 0, 0, -1)) },
    uShape: { value: Array.from({ length: slots }, () => new T.Vector4()) },
    uColors: { value: Array.from({ length: 5 }, () => new T.Vector3(1, 1, 1)) },
    uPx: { value: 500 }, uMaxPx: { value: 24 },
  };
  const mat = new T.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, defines: { S: slots },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false,
  });
  const points = new T.Points(geo, mat);
  points.name = 'fireworks-sparks'; points.frustumCulled = false; points.raycast = () => {}; points.renderOrder = 11;
  return { points, uniforms };
}
