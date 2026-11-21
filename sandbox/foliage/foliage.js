// Little Raft - stylized low-poly foliage (palms, bushes, ferns, broadleaf plants, grass) with GPU wind.
// Drop-in for dist/: no imports, the caller passes the THREE namespace (same convention as crafts.js).
//
//   import { createFoliage } from './foliage.js?build=...';
//   const F = createFoliage(T);                       // one per scene; owns the shared wind uniforms
//   const palm = F.geometry('palm', { seed: 3 });     // BufferGeometry: position/normal/color, base at origin
//   const mesh = F.instanced('palm', palm, placements); // InstancedMesh, one draw call, sways + casts shadows
//   F.swayCraftPalm(createCraft(T, 'palm'));          // patch the existing raft palm decor in place
//   per frame: F.update(elapsedSeconds, camera);
//
// Wind is computed in the vertex shader of stock Lambert/Standard materials (onBeforeCompile), so lights, fog,
// shadows and instancing all keep working. Sway weights come from the object-space position (height above
// uBase, horizontal distance from uCrown), so ANY geometry can sway without extra vertex attributes - that is
// what lets the merged crafts.js palm use it unchanged. All foliage materials share one program per variant.

export const FOLIAGE_KINDS = Object.freeze(['palm', 'palmFar', 'palmCard', 'bush', 'fern', 'broadleaf', 'grass']);

const PARS = /* glsl */`
uniform float uTime, uWindStrength;
uniform vec2 uWindDir;
uniform vec3 uEye;
uniform float uBase, uHeight, uBend, uFlutter, uReach;
uniform vec3 uCrown;
uniform vec2 uFade;
`;

// Runs in object space right after <begin_vertex>. Order: flutter (leaf detail), main bend (whole plant leans
// downwind, length preserving so the trunk never stretches), distance fade (plant shrinks into the ground).
const BODY = /* glsl */`
#include <begin_vertex>
{
  vec3 fOrg = modelMatrix[3].xyz;
  mat3 fR = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    fOrg = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    fR = fR * mat3(instanceMatrix);
  #endif
  vec3 fW = transpose(fR) * vec3(uWindDir.x, 0.0, uWindDir.y);
  vec2 fWd = normalize(fW.xz + 1e-5);
  float fPh = dot(fOrg.xz, vec2(0.37, 0.21));
  float fT = uTime;
  float fGust = 0.62 + 0.38 * sin(fT * 0.47 + fPh * 0.3) * sin(fT * 0.19 + fPh * 0.11 + 1.3);
  float fS = uWindStrength * fGust;
  float fH = clamp((transformed.y - uBase) / uHeight, 0.0, 1.6);

  #ifdef FOL_TREE
    vec3 fRc = transformed - uCrown;
    float fWgt = clamp(length(fRc.xz) / uReach, 0.0, 1.0) * smoothstep(0.55, 0.85, fH);
  #else
    float fWgt = fH;
  #endif
  float fFl = sin(fT * 2.3 + fPh + fWgt * 3.1 + transformed.x * 1.7) * 0.6
            + sin(fT * 3.9 + fPh * 1.7 + transformed.z * 2.3) * 0.4;
  float fA = fWgt * fWgt * uFlutter * (0.25 + fS);
  transformed.y += fFl * fA * 0.11;
  transformed.xz += fWd * fA * (0.07 + 0.05 * fFl);

  vec3 fB = vec3(0.0, uBase, 0.0);
  vec3 fP = transformed - fB;
  float fL = length(fP);
  float fSw = 1.0 + 0.22 * sin(fT * 1.25 + fPh);
  fP.xz += fWd * (uBend * fS * fSw * fH * fH * uHeight);
  transformed = fB + normalize(fP + 1e-6) * fL;

  #ifdef FOL_FADE
    float fD = smoothstep(uFade.x, uFade.y, distance(uEye, fOrg));
    transformed *= 1.0 - fD;
  #endif
}
`;

const DEFAULT_PARAMS = {
  palm:      { base: 0,    height: 4.3, bend: 0.10, flutter: 1.0, reach: 1.6, crown: [0, 4.3, 0], fade: null, tree: true },
  palmFar:   { base: 0,    height: 4.3, bend: 0.10, flutter: 0.7, reach: 1.6, crown: [0, 4.3, 0], fade: null, tree: true },
  palmCard:  { base: 0,    height: 4.3, bend: 0.10, flutter: 1.0, reach: 1.6, crown: [0, 4.3, 0], fade: null, tree: true },
  bush:      { base: 0,    height: 0.9, bend: 0.12, flutter: 0.35, fade: [34, 46] },
  fern:      { base: 0,    height: 0.7, bend: 0.18, flutter: 0.9, fade: [24, 34] },
  broadleaf: { base: 0,    height: 1.0, bend: 0.16, flutter: 0.8, fade: [28, 40] },
  grass:     { base: 0,    height: 0.4, bend: 0.45, flutter: 0.9, fade: [13, 21] },
};

export function createFoliage(T, options = {}) {
  const wd = options.windDir || [1, 0.35];
  const wind = {
    uTime: { value: 0 },
    uWindDir: { value: new T.Vector2(wd[0], wd[1]).normalize() },
    uWindStrength: { value: options.strength ?? 0.4 },
    uEye: { value: new T.Vector3() },
  };
  const lambert = options.lambert ?? true;
  const owned = new Set(), lods = [];

  // Patch any built-in material (Lambert/Standard/Phong/Depth). params: see DEFAULT_PARAMS. Returns mat.
  function patch(mat, params = {}) {
    const p = Object.assign({ base: 0, height: 1, bend: 0.15, flutter: 0.6, reach: 1, crown: [0, 0, 0], fade: null, tree: false, twoSided: false }, params);
    const u = mat.userData.foliage = {
      uBase: { value: p.base }, uHeight: { value: p.height }, uBend: { value: p.bend }, uFlutter: { value: p.flutter },
      uReach: { value: p.reach }, uCrown: { value: new T.Vector3().fromArray(p.crown) },
      uFade: { value: new T.Vector2().fromArray(p.fade || [1e4, 1e4 + 1]) },
    };
    const defs = mat.defines = Object.assign({}, mat.defines);
    if (p.tree) defs.FOL_TREE = '';
    if (p.fade) defs.FOL_FADE = '';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, wind, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <begin_vertex>', BODY);
      // leaves: light both faces with the authored (up-biased) normal instead of flipping it for back faces,
      // so undersides and grass backs read as soft translucent green rather than black
      if (p.twoSided) shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif');
    };
    const key = 'foliage' + (p.tree ? 'T' : '') + (p.fade ? 'F' : '') + (p.twoSided ? '2' : '');
    mat.customProgramCacheKey = () => key;
    mat.needsUpdate = true;
    return mat;
  }

  // Shadow-pass twin that sways with the visible mesh (shares the per-material uniform objects).
  function depth(src) {
    const d = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: src.map || null, alphaTest: src.alphaTest || 0, side: src.side });
    const u = src.userData.foliage;
    d.defines = Object.assign({}, src.defines);
    d.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, wind, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <begin_vertex>', BODY);
    };
    const key = src.customProgramCacheKey();
    d.customProgramCacheKey = () => key + 'D';
    return d;
  }

  function material(kind, params = {}) {
    const base = { vertexColors: true, side: T.DoubleSide };
    if (kind === 'palmCard') Object.assign(base, { map: cardTexture(), alphaTest: 0.5 });
    const m = lambert ? new T.MeshLambertMaterial(base) : new T.MeshStandardMaterial(Object.assign(base, { roughness: 0.85 }));
    owned.add(m);
    return patch(m, Object.assign({ twoSided: true }, DEFAULT_PARAMS[kind] || {}, params));
  }

  let card = null;
  function cardTexture() { if (!card) { card = frondCardTexture(T); owned.add(card); } return card; }

  function geometry(kind, opts = {}) {
    const g = BUILDERS[kind](T, opts);
    owned.add(g);
    return g;
  }

  // placements: [{x, y, z, rot, scale, tint?}] -> InstancedMesh. Material params are read from geo.userData
  // (palm crown/height) so wind matches the generated shape.
  function instanced(kind, geo, placements, params = {}) {
    const gp = geo.userData.foliage || {};
    const mat = material(kind, Object.assign({}, gp, params));
    const mesh = new T.InstancedMesh(geo, mat, Math.max(1, placements.length));
    mesh.count = placements.length;
    const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), Y = new T.Vector3(0, 1, 0);
    const c = new T.Color();
    placements.forEach((pl, i) => {
      q.setFromAxisAngle(Y, pl.rot || 0);
      mesh.setMatrixAt(i, m4.compose(p.set(pl.x, pl.y || 0, pl.z), q, s.setScalar(pl.scale || 1)));
      mesh.setColorAt(i, c.setScalar(1).multiplyScalar(pl.tint ?? 1));
      if (pl.color) mesh.setColorAt(i, c.set(pl.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.customDepthMaterial = depth(mat);
    mesh.castShadow = kind !== 'grass';
    mesh.receiveShadow = true;
    mesh.name = 'foliage_' + kind;
    return mesh;
  }

  // Patch the merged meshes of crafts.js buildPalm (names: trunk, crown, coconuts, fronds, frondRibs) in place.
  // The pot, soil and base board stay rigid. Works on any group built by createCraft(T, 'palm').
  function swayCraftPalm(group) {
    const crown = group.getObjectByName('crown'), trunk = group.getObjectByName('trunk');
    if (!crown || !trunk) return group;
    crown.geometry.computeBoundingBox(); trunk.geometry.computeBoundingBox();
    const c = crown.geometry.boundingBox.getCenter(new T.Vector3());
    const base = trunk.geometry.boundingBox.min.y, height = c.y - base;
    const params = { base, height, bend: 0.12, flutter: 0.75, reach: 0.8, crown: [c.x, c.y, c.z], tree: true };
    for (const name of ['trunk', 'crown', 'coconuts', 'fronds', 'frondRibs']) {
      const m = group.getObjectByName(name);
      if (!m) continue;
      patch(m.material, params);
      m.customDepthMaterial = depth(m.material);
    }
    return group;
  }

  // Cheap whole-object LOD: object is visible only while the camera is within [min, max) of `center`.
  function lod(object, max, min = 0, center = null) {
    lods.push({ object, max, min, center: center || object.position });
    return object;
  }

  const _v = new T.Vector3();
  function update(time, camera) {
    wind.uTime.value = time;
    if (camera) {
      camera.getWorldPosition(wind.uEye.value);
      for (const l of lods) {
        const d = _v.copy(l.center).distanceTo(wind.uEye.value);
        l.object.visible = d >= l.min && d < l.max;
      }
    }
  }

  function dispose() { for (const o of owned) o.dispose(); owned.clear(); lods.length = 0; }

  return { wind, patch, depth, material, geometry, instanced, swayCraftPalm, lod, update, dispose, scatter };
}

// ------------------------------------------------------------------ deterministic helpers
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Poisson-ish dart throwing inside a disc. accept(x, z, r01) -> false to reject; heightAt(x, z) -> y.
export function scatter({ count, radius, seed = 1, minDist = 0, accept = null, heightAt = () => 0, avoid = [], scale = [0.8, 1.2] }) {
  const r = rng(seed), out = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (accept && !accept(x, z, d / radius, r)) continue;
    let ok = true;
    for (const o of out) if ((o.x - x) ** 2 + (o.z - z) ** 2 < minDist * minDist) { ok = false; break; }
    for (const o of avoid) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r || 1) ** 2) { ok = false; break; }
    if (!ok) continue;
    out.push({ x, y: heightAt(x, z), z, rot: r() * Math.PI * 2, scale: scale[0] + r() * (scale[1] - scale[0]), tint: 0.88 + r() * 0.24 });
  }
  return out;
}

// ------------------------------------------------------------------ geometry kit (non-indexed, flat low-poly)
function makeBuilder(T) {
  const pos = [], col = [], nrm = [], uv = [];
  const _a = new T.Vector3(), _b = new T.Vector3(), _n = new T.Vector3();
  let normalBias = null, useUv = false;
  const api = {
    // per-vertex normals: null -> flat face normal; vector -> blended up/outward (soft foliage look)
    tri(a, b, c, ca, cb = ca, cc = cb, uvs = null) {
      _a.subVectors(b, a); _b.subVectors(c, a); _n.crossVectors(_a, _b).normalize();
      for (const [v, k] of [[a, ca], [b, cb], [c, cc]]) {
        pos.push(v.x, v.y, v.z); col.push(k.r, k.g, k.b);
        if (normalBias) { const n = normalBias(v, _n); nrm.push(n.x, n.y, n.z); } else nrm.push(_n.x, _n.y, _n.z);
      }
      // non-card triangles sample the opaque white swatch in the card atlas corner
      if (uvs) { useUv = true; uv.push(...uvs); } else uv.push(0.03, 0.008, 0.03, 0.008, 0.03, 0.008);
    },
    quad(a, b, c, d, ca, cb = ca, cc = cb, cd = cc) { api.tri(a, b, c, ca, cb, cc); api.tri(a, c, d, ca, cc, cd); },
    setNormals(fn) { normalBias = fn; },
    build(userData = {}) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      if (useUv) g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      g.userData = userData;
      return g;
    },
  };
  return api;
}

const UPV = (T) => new T.Vector3(0, 1, 0);

// Pinnate frond (palm leaf / fern): parabolic rib from C along `ang`, peak above C, tip `drop` below C.
// detail: 2 = 4-tri folded leaflets, 1 = 2-tri leaflets (far LOD), 'card' = one textured V-ribbon.
function frond(T, B, C, ang, L, peak, drop, n, pal, detail, r, leafLen = 0.42) {
  const V = (x, y, z) => new T.Vector3(x, y, z), UP = UPV(T);
  const a = 2 * peak + 2 * Math.sqrt(peak * peak + peak * drop), b = a + drop;
  const dir = V(Math.cos(ang), 0, Math.sin(ang));
  const P = t => C.clone().addScaledVector(dir, L * t).add(V(0, a * t - b * t * t, 0));
  const rib = pal.rib;
  if (detail === 'card') {
    const segs = 8;
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, p = P(t);
      const tan = P(Math.min(1, t + 0.01)).sub(P(Math.max(0, t - 0.01))).normalize();
      const side = new T.Vector3().crossVectors(tan, UP).normalize();
      const w = L * 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.7) * (1 - 0.3 * t) + 0.02;
      const l = p.clone().addScaledVector(side, w).add(V(0, -w * 0.45, 0)), rr = p.clone().addScaledVector(side, -w).add(V(0, -w * 0.45, 0));
      const cur = { l, p, rr, t };
      if (prev) {
        const W = new T.Color(1, 1, 1);
        B.tri(prev.l, prev.p, cur.p, W, W, W, [0, prev.t, 0.5, prev.t, 0.5, t]);
        B.tri(prev.l, cur.p, cur.l, W, W, W, [0, prev.t, 0.5, t, 0, t]);
        B.tri(prev.p, prev.rr, cur.rr, W, W, W, [0.5, prev.t, 1, prev.t, 1, t]);
        B.tri(prev.p, cur.rr, cur.p, W, W, W, [0.5, prev.t, 1, t, 0.5, t]);
      }
      prev = cur;
    }
    return;
  }
  // rib: thin flat strip facing up
  const RS = detail === 2 ? 7 : 3;
  for (let k = 0; k < RS; k++) {
    const p0 = P(k / RS), p1 = P((k + 1) / RS);
    const s = new T.Vector3().crossVectors(p1.clone().sub(p0), UP).normalize().multiplyScalar(0.018 * (1 - 0.6 * k / RS));
    B.quad(p0.clone().add(s), p0.clone().sub(s), p1.clone().sub(s), p1.clone().add(s), rib);
  }
  const tone = 0.86 + r() * 0.26;
  const cb = pal.base.clone().multiplyScalar(tone), cm = pal.mid.clone().multiplyScalar(tone), ct = pal.tip.clone().lerp(cm, 0.3);
  for (let j = 1; j <= n; j++) {
    const t = 0.1 + 0.88 * j / n, p = P(t);
    const tan = P(Math.min(1, t + 0.01)).sub(P(t - 0.01)).normalize();
    const side = new T.Vector3().crossVectors(tan, UP).normalize();
    const nrm = new T.Vector3().crossVectors(side, tan).normalize();
    const ll = L * leafLen * (0.2 + 0.8 * Math.pow(Math.sin(Math.PI * Math.min(1, t - 0.02)), 0.6)) * (1 - 0.3 * t);
    const ao = 0.62 + 0.38 * Math.min(1, t * 1.6); // darker toward the crown: cheap depth for the canopy
    const cbt = cb.clone().multiplyScalar(ao), cmt = cm.clone().multiplyScalar(0.8 + 0.2 * ao);
    const lw = L * (0.028 + 0.02 * (1 - t)) * (detail === 1 ? 2.2 : 1);
    for (const sgn of [-1, 1]) {
      const dl = side.clone().multiplyScalar(sgn * 0.8).addScaledVector(tan, 0.5).addScaledVector(nrm, -(0.3 + 0.6 * t)).normalize();
      const wv = new T.Vector3().crossVectors(dl, nrm).normalize().multiplyScalar(lw);
      const tip = p.clone().addScaledVector(dl, ll); tip.y -= ll * 0.18 * t;
      const mid = p.clone().addScaledVector(dl, ll * 0.35);
      const mA = mid.clone().add(wv), mB = mid.clone().sub(wv);
      if (detail === 1) {
        B.tri(p, mA, tip, cbt, cmt, ct); B.tri(p, tip, mB, cbt, ct, cmt);
      } else {
        const mC = mid.clone().addScaledVector(nrm, lw * 0.5);
        B.tri(p, mA, mC, cbt, cmt, cmt); B.tri(mC, mA, tip, cmt, cmt, ct);
        B.tri(p, mC, mB, cbt, cmt, cmt); B.tri(mC, tip, mB, cmt, ct, cmt);
      }
    }
  }
}

function lowBlob(T, B, c, rad, sq, colA, colB, r, detail = 0) {
  const g = new T.IcosahedronGeometry(rad, detail);
  const p = g.attributes.position, v = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  // deterministic jitter keyed by quantised position so shared vertices stay welded
  const jit = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k), j = 0.82 + 0.3 * jit(x.toFixed(3), y.toFixed(3), z.toFixed(3));
      v[k].set(x * j, Math.max(y * j * sq, -rad * 0.25), z * j).add(c);
    }
    const f = r(), k = colA.clone().lerp(colB, f * 0.6 + 0.4 * Math.max(0, (v[0].y - c.y) / rad));
    B.tri(v[0], v[1], v[2], k);
  }
  g.dispose();
}

const BUILDERS = {
  palm(T, o = {}) { return palmGeo(T, o, 2); },
  palmFar(T, o = {}) { return palmGeo(T, o, 1); },
  palmCard(T, o = {}) { return palmGeo(T, o, 'card'); },

  // Tropical shrub: 3-5 squashed low-poly lumps + a few hibiscus-like flowers.
  bush(T, o = {}) {
    const r = rng(o.seed ?? 11), B = makeBuilder(T), V = (x, y, z) => new T.Vector3(x, y, z);
    const center = V(0, 0.35, 0);
    B.setNormals((v, n) => v.clone().sub(center).normalize().multiplyScalar(0.7).add(n.clone().multiplyScalar(0.3)).add(V(0, 0.35, 0)).normalize());
    const dark = new T.Color(o.dark || 0x2f6b2c), light = new T.Color(o.light || 0x6fae48);
    const lumps = o.lumps ?? 4, lumpsAt = [];
    for (let i = 0; i < lumps; i++) {
      const a = i * 2.4 + r(), d = i ? 0.25 + r() * 0.15 : 0, rad = (i ? 0.3 : 0.42) * (0.85 + r() * 0.3);
      const c = V(Math.cos(a) * d, rad * 0.75 + (i ? 0 : 0.1), Math.sin(a) * d);
      lumpsAt.push([c, rad]);
      lowBlob(T, B, c, rad, 0.85, dark, light, r, 1);
    }
    if (o.flowers !== false) {
      B.setNormals(null);
      const petal = new T.Color(o.flower || [0xe8506a, 0xf4a6c0, 0xf2c94c, 0xff7b54][Math.floor(r() * 4)]), eye = new T.Color(0xffd36b);
      const nfl = o.flowerCount ?? 7;
      for (let i = 0; i < nfl; i++) {
        const [c, rad] = lumpsAt[i % lumpsAt.length];
        const th = r() * Math.PI * 2, ph = 0.35 + r() * 0.8;
        const nn = V(Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph));
        const at = c.clone().addScaledVector(nn, rad * 1.02);
        const t1 = new T.Vector3().crossVectors(nn, V(0.3, 1, 0.1)).normalize(), t2 = new T.Vector3().crossVectors(nn, t1);
        const pr = 0.11, ctr = at.clone().addScaledVector(nn, 0.045);
        for (let k = 0; k < 5; k++) {
          const a0 = k / 5 * Math.PI * 2, a1 = a0 + 0.9;
          const p0 = at.clone().addScaledVector(t1, Math.cos(a0) * pr).addScaledVector(t2, Math.sin(a0) * pr).addScaledVector(nn, 0.03);
          const p1 = at.clone().addScaledVector(t1, Math.cos(a1) * pr).addScaledVector(t2, Math.sin(a1) * pr).addScaledVector(nn, 0.03);
          B.tri(ctr, p0, p1, eye, petal, petal);
        }
      }
    }
    return B.build({ foliage: { height: 0.9 } });
  },

  // Ground fern: rosette of short pinnate fronds.
  fern(T, o = {}) {
    const r = rng(o.seed ?? 23), B = makeBuilder(T), V = (x, y, z) => new T.Vector3(x, y, z);
    B.setNormals((v, n) => n.clone().multiplyScalar(0.4).add(V(0, 1, 0)).normalize());
    const pal = { base: new T.Color(0x2e5f25), mid: new T.Color(0x4f9139), tip: new T.Color(0x9cc456), rib: new T.Color(0x4a6e2a) };
    const n = o.fronds ?? 7;
    for (let f = 0; f < n; f++) {
      const ang = f * 2.39996 + r() * 0.4, L = 0.55 + r() * 0.25;
      frond(T, B, V(0, 0.02, 0), ang, L, 0.22 + r() * 0.1, 0.12 + r() * 0.06, 9, pal, 2, r, 0.4);
    }
    return B.build({ foliage: { height: 0.6 } });
  },

  // Elephant-ear / banana-like rosette: few big paddle leaves on stems. Strong silhouette, very cheap.
  broadleaf(T, o = {}) {
    const r = rng(o.seed ?? 31), B = makeBuilder(T), V = (x, y, z) => new T.Vector3(x, y, z), UP = V(0, 1, 0);
    B.setNormals((v, n) => n.clone().multiplyScalar(0.55).add(V(0, 0.8, 0)).normalize());
    const stem = new T.Color(0x5f8a35), dark = new T.Color(0x245e2a), mid = new T.Color(0x3f8f3a), tip = new T.Color(0x86c24f);
    const n = o.leaves ?? 6;
    for (let f = 0; f < n; f++) {
      const ang = f * 2.39996 + r() * 0.3, tilt = 0.5 + r() * 0.5, h = 0.45 + r() * 0.35;
      const dir = V(Math.cos(ang), 0, Math.sin(ang)), side = V(-Math.sin(ang), 0, Math.cos(ang));
      const top = dir.clone().multiplyScalar(0.12 + 0.12 * tilt).add(V(0, h, 0));
      const s = side.clone().multiplyScalar(0.015);
      B.quad(s.clone(), s.clone().negate(), top.clone().sub(s), top.clone().add(s), stem);
      // leaf blade: 5 segments along a drooping arc, folded at midrib
      const L = 0.55 + r() * 0.2, Wd = 0.2 + r() * 0.06, segs = 5;
      const P = t => top.clone().addScaledVector(dir, L * t).add(V(0, 0.12 * t - 0.42 * t * t * tilt, 0));
      let prev = null;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs, p = P(t), w = Wd * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.88)), 0.8) * (t < 0.15 ? 1.2 : 1);
        const tan = P(Math.min(1, t + 0.02)).sub(P(Math.max(0, t - 0.02))).normalize();
        const sd = new T.Vector3().crossVectors(tan, UP).normalize();
        const cur = { p, l: p.clone().addScaledVector(sd, w).add(V(0, w * 0.25, 0)), rr: p.clone().addScaledVector(sd, -w).add(V(0, w * 0.25, 0)), c: mid.clone().lerp(tip, t * 0.7) };
        if (prev) {
          B.quad(prev.p, prev.l, cur.l, cur.p, dark, prev.c, cur.c, dark.clone().lerp(cur.c, 0.4));
          B.quad(prev.p, cur.p, cur.rr, prev.rr, dark, dark.clone().lerp(cur.c, 0.4), cur.c, prev.c);
        }
        prev = cur;
      }
    }
    return B.build({ foliage: { height: 0.8 } });
  },

  // Grass tuft: n curved 3-tri blades, normals pointing up (soft, no dark backs).
  grass(T, o = {}) {
    const r = rng(o.seed ?? 5), B = makeBuilder(T), V = (x, y, z) => new T.Vector3(x, y, z), UP = V(0, 1, 0);
    B.setNormals(() => UP);
    const base = new T.Color(o.base || 0x4c7d30), tip = new T.Color(o.tip || 0xa8c95a);
    const n = o.blades ?? 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.6, d = 0.03 + r() * 0.07, h = (o.h ?? 0.26) * (0.7 + r() * 0.6), lean = 0.08 + r() * 0.14;
      const dir = V(Math.cos(a), 0, Math.sin(a)), side = V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.028 + r() * 0.012);
      const b0 = dir.clone().multiplyScalar(d), mid = b0.clone().addScaledVector(dir, lean * 0.4).add(V(0, h * 0.55, 0));
      const tp = b0.clone().addScaledVector(dir, lean * 1.3).add(V(0, h, 0));
      const cm = base.clone().lerp(tip, 0.5), ct = tip.clone().multiplyScalar(0.9 + r() * 0.2);
      B.quad(b0.clone().add(side), b0.clone().sub(side), mid.clone().addScaledVector(side, -0.7), mid.clone().addScaledVector(side, 0.7), base, base, cm, cm);
      B.tri(mid.clone().addScaledVector(side, 0.7), mid.clone().addScaledVector(side, -0.7), tp, cm, cm, ct);
    }
    return B.build({ foliage: { height: 0.4 } });
  },
};

// Island coconut palm, ~4.3 tall, ringed flared trunk, 10 fronds (2 dry), coconuts. detail 2/1/'card'.
function palmGeo(T, o, detail) {
  const r = rng(o.seed ?? 7), B = makeBuilder(T), V = (x, y, z) => new T.Vector3(x, y, z);
  const H = o.height ?? 4.3, lean = o.lean ?? 0.5;
  const curve = new T.CatmullRomCurve3([V(0, 0, 0), V(lean * 0.12, H * 0.3, 0), V(lean * 0.45, H * 0.65, 0.02), V(lean, H, 0.04)]);
  // trunk: stacked flared rings (leaf-scar silhouette)
  const NS = detail === 2 || detail === 'card' ? 14 : 5, RAD = detail === 1 ? 5 : 7;
  const barkA = new T.Color(0x9a7a52), barkB = new T.Color(0x7d6143), barkD = new T.Color(0x5a442e);
  for (let i = 0; i < NS; i++) {
    const t0 = i / NS, t1 = (i + 1) / NS;
    const p0 = curve.getPointAt(t0), p1 = curve.getPointAt(t1);
    const r0 = (0.19 - 0.08 * t0) * (i === 0 ? 1.35 : 0.9), r1 = (0.19 - 0.08 * t1) * 1.05;
    const cb = (i % 2 ? barkA : barkB).clone().lerp(barkD, 0.35), ct = i % 2 ? barkA : barkB;
    for (let k = 0; k < RAD; k++) {
      const a0 = (k / RAD) * Math.PI * 2 + i * 0.4, a1 = ((k + 1) / RAD) * Math.PI * 2 + i * 0.4;
      const q = (p, rr, a) => V(p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr);
      B.quad(q(p0, r0, a0), q(p1, r1, a0), q(p1, r1, a1), q(p0, r0, a1), cb, ct, ct, cb);
    }
  }
  const top = curve.getPointAt(1);
  // crown + coconuts
  lowBlob(T, B, top.clone().add(V(0, 0.02, 0)), 0.17, 0.8, new T.Color(0x5b4630), new T.Color(0x76603e), r);
  if (detail !== 1 || o.coconuts) {
    for (let k = 0; k < 3; k++) {
      const a = 0.5 + k * 2.1 + r() * 0.3;
      lowBlob(T, B, top.clone().add(V(Math.cos(a) * 0.14, -0.13, Math.sin(a) * 0.14)), 0.1, 1, new T.Color(0x7d7a34), new T.Color(0x9a9440), r);
    }
  }
  // fronds: soft up-biased normals so the canopy reads bright from below and from above
  B.setNormals((v, n) => n.clone().multiplyScalar(0.55).add(V(0, 0.7, 0)).normalize());
  const C = top.clone().add(V(0, 0.08, 0));
  const pal = { base: new T.Color(0x2d5e26), mid: new T.Color(0x4e9136), tip: new T.Color(0xa6c255), rib: new T.Color(0x7d8c44) };
  const dry = { base: new T.Color(0x8a7a3a), mid: new T.Color(0xb59a4a), tip: new T.Color(0xcdb46a), rib: new T.Color(0x8d7a45) };
  const NF = o.fronds ?? 10, NL = detail === 2 ? 22 : 7;
  for (let f = 0; f < NF; f++) {
    const ang = f * 2.39996 + (r() - 0.5) * 0.3;
    const tier = f % 3; // 0: high arching, 1: mid, 2: low drooping
    const L = (tier === 0 ? 1.5 : tier === 1 ? 1.75 : 1.65) * (0.9 + r() * 0.2) * H / 4.3;
    const peak = [0.45, 0.25, 0.08][tier] * H / 4.3, drop = [0.35, 0.8, 1.25][tier] * H / 4.3;
    const isDry = (o.dry ?? 2) > 0 && f >= NF - (o.dry ?? 2);
    frond(T, B, C, ang, L, peak, isDry ? drop * 1.6 : drop, NL, isDry ? dry : pal, detail, r);
  }
  return B.build({ foliage: { height: H, crown: [C.x, C.y, C.z], reach: 1.7 * H / 4.3 } });
}

// Canvas-drawn pinnate frond for the alpha-tested card variant (comparison only).
function frondCardTexture(T) {
  const W = 128, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.lineCap = 'round';
  x.fillStyle = '#fff'; x.fillRect(0, H - 10, 10, 10); // opaque swatch for trunk/coconut triangles
  for (let i = 0; i < 40; i++) {
    const v = 0.05 + i / 42, y = H * (1 - v);
    const len = W * 0.48 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.05)), 0.7) * (1 - 0.3 * v);
    for (const s of [-1, 1]) {
      const grd = x.createLinearGradient(W / 2, y, W / 2 + s * len, y - len * 0.5);
      grd.addColorStop(0, '#2d5e26'); grd.addColorStop(0.6, '#4e9136'); grd.addColorStop(1, '#a6c255');
      x.strokeStyle = grd; x.lineWidth = 7 - 3 * v;
      x.beginPath(); x.moveTo(W / 2, y);
      x.quadraticCurveTo(W / 2 + s * len * 0.55, y - len * 0.15, W / 2 + s * len, y - len * 0.6);
      x.stroke();
    }
  }
  x.strokeStyle = '#7d8c44'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(W / 2, H); x.lineTo(W / 2, 6); x.stroke();
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
