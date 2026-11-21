// Bake 3D item models into one icon atlas with the game's own renderer. No imports: THREE is
// passed in as T, so this file drops into dist/ unchanged.
//
// Per item: render the posed model into a small 2x MSAA HalfFloat target with a fixed studio
// rig, then one resolve pass writes the tile into an 8-bit atlas target. The resolve does the
// 2x2 downsample, ACES + sRGB (render targets are linear in r170), a dark silhouette outline
// and a soft drop shadow. After all tiles: ONE async readback, then per-kind PNG data URLs.
//
//   const res = await bakeIconAtlas(T, renderer, items, { size: 96, cacheKey: 'build-id' });
//   res.urls.hammer  -> 'data:image/png;base64,...'  (for <img src>)
//   res.atlas        -> { url, width, height, cols, size, rects: { hammer: [x, y, w, h] } }
//   res.stats        -> timings, renderer.info deltas, memory
//   null             -> opts.isCancelled() returned true (engine disposed / hot-swapped)
// items: [{ kind, make: () => Object3D, pose: { yaw, pitch, roll, pad?, look?: { outlinePx, rimPx, rim, exposure } }, dispose?(obj) }]

export const ICON_ATLAS_VERSION = 'ia4';
const DEG = Math.PI / 180;
const LS_PREFIX = 'littleRaft.icons.';

const RESOLVE_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel; uniform float exposure; uniform float ss;
uniform float outlinePx; uniform vec4 outline; uniform float rimPx; uniform vec4 rim; uniform vec4 shadow; uniform vec3 shadowOff;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){ vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){
  const mat3 I=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
  const mat3 O=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
  c*=exposure/0.6; c=O*RRTAndODTFit(I*c); return clamp(c,0.,1.);
}
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(vec3(0.0031308),c)); }
float A(vec2 uv){ return texture2D(tSrc,uv).a; }
// silhouette dilated by r output px (16 directions, 2 radii)
float ring(vec2 uv, float r){
  float m=0.;
  for(int i=0;i<16;i++){
    float a=6.2831853*float(i)/16.; vec2 d=vec2(cos(a),sin(a))*texel*ss*r;
    m=max(m,max(A(uv+d),A(uv+d*0.5)));
  }
  return m;
}
void main(){
  vec2 t=texel*0.5;
  vec4 c=0.25*(texture2D(tSrc,vUv+vec2(-t.x,-t.y))+texture2D(tSrc,vUv+vec2(t.x,-t.y))
              +texture2D(tSrc,vUv+vec2(-t.x,t.y))+texture2D(tSrc,vUv+vec2(t.x,t.y)));
  vec3 rgb=c.a>0.001?c.rgb/c.a:vec3(0.);           // cleared to transparent black => premultiplied
  rgb=toSRGB(aces(rgb));
  float oa=max(c.a,ring(vUv,outlinePx))*outline.a;    // outline layer (covers the item area too)
  // optional light rim just outside the navy outline: keeps thin dark tools readable on dark slots
  float ra=rimPx>0.?max(oa,ring(vUv,outlinePx+rimPx))*rim.a:0.;
  // drop shadow: silhouette offset down-right, softened and grown by a 12-tap disc (cheap to compile)
  vec2 sc=vUv+vec2(-shadowOff.x,shadowOff.y)*texel*ss; float sh=A(sc)*2.;
  for(int i=0;i<12;i++){
    float a=6.2831853*(float(i)+.5)/12.; vec2 d=vec2(cos(a),sin(a))*texel*ss*(outlinePx+shadowOff.z);
    sh+=A(sc+d)+A(sc+d*.5);
  }
  sh=min(1.,sh/14.)*shadow.a;
  // composite back-to-front, premultiplied: shadow, outline, item
  vec4 o=vec4(shadow.rgb*sh,sh);
  o=vec4(rim.rgb*ra,ra)+o*(1.-ra);
  o=vec4(outline.rgb*oa,oa)+o*(1.-oa);
  o=vec4(rgb*c.a,c.a)+o*(1.-c.a);
  gl_FragColor=vec4(o.a>0.?o.rgb/o.a:vec3(0.),o.a);
}`;

// Small studio environment so metal (hook, rivets) reads as metal instead of black.
function makeEnv(T, renderer) {
  const s = new T.Scene();
  const g = new T.SphereGeometry(10, 24, 12), col = [], p = g.attributes.position;
  const top = new T.Color(0xdff1ff), bot = new T.Color(0x3a4a52), tmp = new T.Color();
  for (let i = 0; i < p.count; i++) { tmp.copy(bot).lerp(top, p.getY(i) / 20 + .5); col.push(tmp.r, tmp.g, tmp.b); }
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  s.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
  const panel = (x, y, z, c, w, h) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(-4, 6, 5, 0xfff2d8, 5, 3);  // warm key softbox, top-left-front (matches the key light)
  panel(6, 2, -4, 0x9fd8ff, 3, 4);  // cool rim
  const pm = new T.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.04).texture;
  pm.dispose(); s.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

// Shader-compile budget: every distinct material flag set (map, vertexColors, side, envMap, ...)
// is its own GL program, and on the first bake each one compiles inside a game frame. unify()
// swaps each mesh's material, for the bake only, for a MeshStandardMaterial with ONE flag set
// (vertexColors + DoubleSide, map kept, bump/normal maps dropped: invisible at 96 px), so the
// whole bake needs 1-2 lit programs + the resolve. Same uniforms (color, roughness, emissive,
// opacity), so the look is unchanged. Originals are put back before the item's dispose().
function unify(T, obj, cache, metalCap) {
  const undo = [];
  const conv = m => {
    if (!m || m.isShaderMaterial) return m;
    let u = cache.get(m);
    if (!u) {
      u = new T.MeshStandardMaterial({
        color: m.color ? m.color.clone() : 0xffffff, roughness: m.roughness ?? 0.8,
        metalness: Math.min(m.metalness ?? 0, metalCap), map: m.map || null,
        emissive: m.emissive ? m.emissive.clone() : 0, emissiveIntensity: m.emissiveIntensity ?? 1,
        transparent: !!m.transparent, opacity: m.opacity ?? 1, depthWrite: m.depthWrite !== false,
        side: T.DoubleSide, vertexColors: true,
      });
      cache.set(m, u);
    }
    return u;
  };
  obj.traverse(n => {
    if (!n.isMesh || !n.material) return;
    const g = n.geometry;
    if (g && !g.attributes.color && g.attributes.position) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute('color', new T.BufferAttribute(c, 3));
    }
    undo.push([n, n.material]);
    n.material = Array.isArray(n.material) ? n.material.map(conv) : conv(n.material);
  });
  return () => { for (const [n, m] of undo) n.material = m; };
}

// One lighting rig for every icon: hemisphere fill, warm key from top-left-front, cool rim behind.
function makeStage(T, env) {
  const scene = new T.Scene();
  if (env) { scene.environment = env; scene.environmentIntensity = 0.8; }
  scene.add(new T.HemisphereLight(0xeaf6ff, 0x50422e, env ? 1.2 : 1.7));
  const key = new T.DirectionalLight(0xfff1dc, 2.6); key.position.set(-2, 3, 4); scene.add(key);
  const rim = new T.DirectionalLight(0xa8e0ff, 1.8); rim.position.set(3, 1.5, -4); scene.add(rim);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const pivot = new T.Group(); scene.add(pivot);
  return { scene, camera, pivot };
}

// Pose the model, center it and fit the ortho frustum to its view-space box (square, padded).
function frame(T, stage, obj, pose, pad) {
  const { camera, pivot } = stage;
  pivot.clear(); pivot.position.set(0, 0, 0);
  pivot.add(obj);
  pivot.rotation.set((pose.pitch ?? 20) * DEG, (pose.yaw ?? -35) * DEG, (pose.roll ?? 0) * DEG, 'ZXY');
  pivot.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(pivot, true), c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
  pivot.position.sub(c); pivot.updateMatrixWorld(true);
  const h = Math.max(sz.x, sz.y) * 0.5 * (pose.pad ?? pad);
  Object.assign(camera, { left: -h, right: h, top: h, bottom: -h, near: 10 - sz.z - 1, far: 10 + sz.z + 1 });
  camera.position.set(0, 0, 10); camera.updateProjectionMatrix();
}

function defaultDispose(o) {
  if (typeof o.userData?.dispose === 'function') { o.userData.dispose(); return; }
  o.traverse(n => {
    if (!n.geometry?.userData?.shared) n.geometry?.dispose();
    for (const m of [].concat(n.material || [])) {
      if (!m || m.userData?.shared) continue; // module-shared (e.g. lowpoly-props lp-*): not ours
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

const nextFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

const PNG_PREFIX = 'data:image/png;base64,';
const isPng = u => typeof u === 'string' && u.length > PNG_PREFIX.length + 16 && u.startsWith(PNG_PREFIX);
const iconKeys = () => {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) out.push(k); } } catch {}
  return out;
};

// kinds: when given, every one must be in the entry as a PNG data URL, else it is a miss (rebake).
export function readIconCache(cacheKey, kinds = null) {
  if (!cacheKey) return null;
  try {
    const v = JSON.parse(localStorage.getItem(LS_PREFIX + ICON_ATLAS_VERSION + '.' + cacheKey) || 'null');
    if (!v || !v.urls || typeof v.urls !== 'object' || Array.isArray(v.urls)) return null;
    const want = kinds || Object.keys(v.urls);
    if (!want.length || !want.every(k => isPng(v.urls[k]))) return null;
    const urls = {}; for (const k of want) urls[k] = v.urls[k];
    return { ...v, urls };
  } catch { return null; }
}
// staleKeys: the icon keys that existed when this bake started. Only those (other builds) are
// removed. A key that appeared DURING the bake was written by a newer engine (hot swap), so this
// bake is the orphan: it neither deletes that key nor writes its own.
function writeIconCache(cacheKey, value, staleKeys) {
  if (!cacheKey) return false;
  const own = LS_PREFIX + ICON_ATLAS_VERSION + '.' + cacheKey;
  try {
    if (iconKeys().some(k => k !== own && !staleKeys.includes(k))) return false;
    for (const k of staleKeys) if (k !== own) localStorage.removeItem(k);
    localStorage.setItem(own, JSON.stringify(value));
    return true;
  } catch { return false; }
}


// Returns null when isCancelled() turns true (engine disposed / hot-swapped): it is checked before
// the bake, between tiles and around the readback. Every path, including a throw from a model's
// make(), a render or the readback, restores the renderer state and disposes the targets, the
// resolve quad, the unified materials and every model built so far.
export async function bakeIconAtlas(T, renderer, items, {
  size = 96, ss = 2, pad = 1.1, cols = 0,
  outlinePx = 2.6, outline = [0.055, 0.15, 0.18, 0.95],   // navy #0e2630-ish, same family as icons.svg #153e49
  rimPx = 0, rim = [0.96, 0.89, 0.74, 0.8],               // light rim outside the outline, off by default (per item via pose.look.rimPx)
  shadow = [0.0, 0.0, 0.0, 0.38], shadowOff = [2.2, 2.6, 1.3],
  exposure = 0.9, cacheKey = '', yieldEvery = 1, onTile = null, precompile = false,
  env: useEnv = false, unify: useUnify = true, metalCap = 0.3, isCancelled = null,
} = {}) {
  const cancelled = () => { try { return !!(isCancelled && isCancelled()); } catch { return true; } };
  const t0 = performance.now();
  const cached = readIconCache(cacheKey, items.map(it => it.kind));
  if (cached) return { ...cached, fromCache: true, stats: { totalMs: performance.now() - t0, fromCache: true } };
  if (cancelled()) return null;
  const staleKeys = cacheKey ? iconKeys() : [];

  const n = items.length;
  cols = cols || Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols), W = cols * size, H = rows * size, S = size * ss;
  const info = renderer.info, prevAuto = info.autoReset;
  const prevColor = new T.Color();
  const save = () => {
    const s = { rt: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), shadow: renderer.shadowMap.enabled, autoClear: renderer.autoClear };
    renderer.getClearColor(prevColor);
    renderer.autoClear = false;   // render() would otherwise clear the WHOLE atlas, not just the tile viewport
    return s;
  };
  const restore = s => { renderer.setRenderTarget(s.rt); renderer.setClearColor(prevColor, s.alpha); renderer.shadowMap.enabled = s.shadow; renderer.autoClear = s.autoClear; info.autoReset = prevAuto; };

  const uCache = new Map();
  let env = null, hi = null, atlas = null, quadMat = null, quadGeo = null, built = null;
  const preUndo = [];
  const disposeItem = (i, obj) => { try { (items[i].dispose || defaultDispose)(obj); } catch (e) { console.warn('icon model dispose failed', items[i].kind, e); } };
  try {
    // PMREM env (5 extra programs: cube render + blur) only on request; with unify() the lights
    // alone carry metal because metalness is capped (metalCap) for the bake.
    env = useEnv ? makeEnv(T, renderer) : null;
    const stage = makeStage(T, env);
    const progBefore = new Set(renderer.info.programs || []), progNew = new Set();
    const seeProgs = () => { for (const p of renderer.info.programs || []) if (!progBefore.has(p)) progNew.add(p); };
    hi = new T.WebGLRenderTarget(S, S, { type: T.HalfFloatType, samples: 4 });
    atlas = new T.WebGLRenderTarget(W, H, { depthBuffer: false });
    const U = {
      tSrc: { value: hi.texture }, texel: { value: new T.Vector2(1 / S, 1 / S) }, ss: { value: ss }, exposure: { value: exposure },
      outlinePx: { value: outlinePx }, outline: { value: new T.Vector4(...outline) },
      rimPx: { value: rimPx }, rim: { value: new T.Vector4(...rim) },
      shadow: { value: new T.Vector4(...shadow) }, shadowOff: { value: new T.Vector3(...shadowOff) },
    };
    quadMat = new T.ShaderMaterial({
      uniforms: U,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: RESOLVE_FRAG, blending: T.NoBlending, depthTest: false, depthWrite: false,
    });
    quadGeo = new T.PlaneGeometry(2, 2);
    const quad = new T.Mesh(quadGeo, quadMat); quad.frustumCulled = false;
    const quadScene = new T.Scene(); quadScene.add(quad);
    const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Build every model up front and compile all their programs (plus the resolve quad) with
    // compileAsync, so shader compiles happen off the frame (KHR_parallel_shader_compile) instead of
    // inside the first tiles' draws. Off by default: on SwiftShader (no parallel compile) it turned
    // one 11 s hitch into one 17 s hitch. Worth enabling where KHR_parallel_shader_compile exists.
    if (precompile && renderer.compileAsync) {
      built = [];
      for (const it of items) built.push(it.make());
      built.forEach((o, i) => { if (!o) return; if (useUnify) preUndo[i] = unify(T, o, uCache, useEnv ? 1 : metalCap); stage.pivot.add(o); });
      try { await renderer.compileAsync(stage.scene, stage.camera); await renderer.compileAsync(quadScene, quadCam); } catch {}
      stage.pivot.clear();
      if (cancelled()) return null;
    }
    const setupMs = performance.now() - t0;

    const acc = { calls: 0, triangles: 0 };
    const rects = {}, tiles = [];

    // clear the whole atlas once
    { const s = save(); try { renderer.setClearColor(0, 0); atlas.viewport.set(0, 0, W, H); renderer.setRenderTarget(atlas); renderer.clear(); } finally { restore(s); } }

    for (let i = 0; i < n; i++) {
      if (cancelled()) return null;
      const it = items[i], ti = performance.now();
      const obj = built ? built[i] : it.make();
      if (!obj) continue;
      let undoUnify = null;
      try {
        undoUnify = built ? preUndo[i] : useUnify ? unify(T, obj, uCache, useEnv ? 1 : metalCap) : null;
        frame(T, stage, obj, it.pose || {}, pad);
        const look = (it.pose && it.pose.look) || {};
        U.outlinePx.value = look.outlinePx ?? outlinePx; U.rimPx.value = look.rimPx ?? rimPx;
        U.rim.value.set(...(look.rim || rim)); U.exposure.value = look.exposure ?? exposure;
        const col = i % cols, row = Math.floor(i / cols);
        const x = col * size, yTop = row * size;
        const s = save();
        try {
          info.autoReset = false; info.reset();
          renderer.shadowMap.enabled = false;
          renderer.setClearColor(0, 0);
          renderer.setRenderTarget(hi); renderer.clear(); renderer.render(stage.scene, stage.camera);
          atlas.viewport.set(x, H - yTop - size, size, size);   // GL origin is bottom-left
          renderer.setRenderTarget(atlas); renderer.render(quadScene, quadCam);
          acc.calls += info.render.calls; acc.triangles += info.render.triangles;
        } finally { restore(s); }
        seeProgs();
        rects[it.kind] = [x, yTop, size, size];
      } finally {
        stage.pivot.clear();
        try { undoUnify?.(); } catch {}
        disposeItem(i, obj);
        if (built) built[i] = null;
      }
      tiles.push({ kind: it.kind, ms: +(performance.now() - ti).toFixed(1) });
      onTile?.(it.kind, i);
      if (yieldEvery && (i + 1) % yieldEvery === 0) await nextFrame();   // keep game frames flowing
    }
    if (cancelled()) return null;
    const tDraw = performance.now();
    const pixels = new Uint8Array(W * H * 4);
    await renderer.readRenderTargetPixelsAsync(atlas, 0, 0, W, H, pixels);
    if (cancelled()) return null;
    const tRead = performance.now();
    const memInfo = { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null };

    // GL rows are bottom-up: flip into the atlas canvas.
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H), rowB = W * 4;
    for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * rowB, (H - y) * rowB), y * rowB);
    ctx.putImageData(img, 0, 0);
    const atlasUrl = canvas.toDataURL('image/png');
    const tile = document.createElement('canvas'); tile.width = tile.height = size;
    const tctx = tile.getContext('2d');
    const urls = {};
    for (const [kind, [x, y]] of Object.entries(rects)) {
      tctx.clearRect(0, 0, size, size); tctx.drawImage(canvas, x, y, size, size, 0, 0, size, size);
      urls[kind] = tile.toDataURL('image/png');
    }
    const tEncode = performance.now();

    const vram = { hiMSAA: S * S * 8 * 4, hiResolve: S * S * 8, atlas: W * H * 4, pmrem: null };
    seeProgs();
    const programsCompiled = progNew.size, programKeys = [...progNew].map(p => p.name || p.cacheKey?.slice(0, 24));
    const urlBytes = Object.values(urls).reduce((a, u) => a + u.length, 0);
    const result = {
      version: ICON_ATLAS_VERSION, size, urls,
      atlas: { url: atlasUrl, width: W, height: H, cols, size, rects },
    };
    if (cancelled()) return null;
    const cachedOk = writeIconCache(cacheKey, { version: ICON_ATLAS_VERSION, size, urls }, staleKeys);
    result.stats = {
      items: n, setupMs: +setupMs.toFixed(1), drawMs: +(tDraw - t0 - setupMs).toFixed(1), readbackMs: +(tRead - tDraw).toFixed(1),
      encodeMs: +(tEncode - tRead).toFixed(1), totalMs: +(performance.now() - t0).toFixed(1), tiles,
      bakeRender: acc, rendererMemoryAfter: memInfo, programsCompiled, programKeys, unify: useUnify, env: useEnv,
      transientVRAMBytes: vram, atlasPx: [W, H], cpuPixelBytes: pixels.byteLength,
      dataUrlBytes: urlBytes, atlasDataUrlBytes: atlasUrl.length, cached: cachedOk,
    };
    return result;
  } finally {
    info.autoReset = prevAuto;
    if (built) built.forEach((o, i) => { if (!o) return; try { preUndo[i]?.(); } catch {} disposeItem(i, o); });
    for (const r of [hi, atlas, quadMat, quadGeo, env]) { try { r?.dispose(); } catch {} }
    for (const m of uCache.values()) { try { m.dispose(); } catch {} }
  }
}
