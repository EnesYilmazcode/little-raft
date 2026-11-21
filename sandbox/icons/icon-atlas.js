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
// items: [{ kind, make: () => Object3D, pose: { yaw, pitch, roll }, dispose?(obj) }]

export const ICON_ATLAS_VERSION = 'ia3';
const DEG = Math.PI / 180;
const LS_PREFIX = 'littleRaft.icons.';

const RESOLVE_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel; uniform float exposure; uniform float ss;
uniform float outlinePx; uniform vec4 outline; uniform vec4 shadow; uniform vec3 shadowOff;
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
  // drop shadow: silhouette offset down-right, softened and grown by a 12-tap disc (cheap to compile)
  vec2 sc=vUv+vec2(-shadowOff.x,shadowOff.y)*texel*ss; float sh=A(sc)*2.;
  for(int i=0;i<12;i++){
    float a=6.2831853*(float(i)+.5)/12.; vec2 d=vec2(cos(a),sin(a))*texel*ss*(outlinePx+shadowOff.z);
    sh+=A(sc+d)+A(sc+d*.5);
  }
  sh=min(1.,sh/14.)*shadow.a;
  // composite back-to-front, premultiplied: shadow, outline, item
  vec4 o=vec4(shadow.rgb*sh,sh);
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

// One lighting rig for every icon: hemisphere fill, warm key from top-left-front, cool rim behind.
function makeStage(T, env) {
  const scene = new T.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.8;
  scene.add(new T.HemisphereLight(0xeaf6ff, 0x50422e, 1.2));
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
    n.geometry?.dispose();
    for (const m of [].concat(n.material || [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
  });
}

const nextFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

export function readIconCache(cacheKey) {
  if (!cacheKey) return null;
  try {
    const v = JSON.parse(localStorage.getItem(LS_PREFIX + ICON_ATLAS_VERSION + '.' + cacheKey) || 'null');
    return v && v.urls && typeof v.urls === 'object' ? v : null;
  } catch { return null; }
}
function writeIconCache(cacheKey, value) {
  if (!cacheKey) return false;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k); }
    localStorage.setItem(LS_PREFIX + ICON_ATLAS_VERSION + '.' + cacheKey, JSON.stringify(value));
    return true;
  } catch { return false; }
}

export async function bakeIconAtlas(T, renderer, items, {
  size = 96, ss = 2, pad = 1.1, cols = 0,
  outlinePx = 2.6, outline = [0.055, 0.15, 0.18, 0.95],   // navy #0e2630-ish, same family as icons.svg #153e49
  shadow = [0.0, 0.0, 0.0, 0.38], shadowOff = [2.2, 2.6, 1.3],
  exposure = 0.9, cacheKey = '', yieldEvery = 1, onTile = null,
} = {}) {
  const t0 = performance.now();
  const cached = readIconCache(cacheKey);
  if (cached) return { ...cached, fromCache: true, stats: { totalMs: performance.now() - t0, fromCache: true } };

  const n = items.length;
  cols = cols || Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols), W = cols * size, H = rows * size, S = size * ss;
  const env = makeEnv(T, renderer), stage = makeStage(T, env);
  const hi = new T.WebGLRenderTarget(S, S, { type: T.HalfFloatType, samples: 4 });
  const atlas = new T.WebGLRenderTarget(W, H, { depthBuffer: false });
  const quadMat = new T.ShaderMaterial({
    uniforms: {
      tSrc: { value: hi.texture }, texel: { value: new T.Vector2(1 / S, 1 / S) }, ss: { value: ss }, exposure: { value: exposure },
      outlinePx: { value: outlinePx }, outline: { value: new T.Vector4(...outline) },
      shadow: { value: new T.Vector4(...shadow) }, shadowOff: { value: new T.Vector3(...shadowOff) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: RESOLVE_FRAG, blending: T.NoBlending, depthTest: false, depthWrite: false,
  });
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), quadMat); quad.frustumCulled = false;
  const quadScene = new T.Scene(); quadScene.add(quad);
  const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const setupMs = performance.now() - t0;

  const info = renderer.info, prevAuto = info.autoReset;
  const acc = { calls: 0, triangles: 0 };
  const rects = {}, tiles = [];
  const prevColor = new T.Color();
  const save = () => {
    const s = { rt: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), shadow: renderer.shadowMap.enabled, autoClear: renderer.autoClear };
    renderer.autoClear = false;   // render() would otherwise clear the WHOLE atlas, not just the tile viewport
    renderer.getClearColor(prevColor); return s;
  };
  const restore = s => { renderer.setRenderTarget(s.rt); renderer.setClearColor(prevColor, s.alpha); renderer.shadowMap.enabled = s.shadow; renderer.autoClear = s.autoClear; info.autoReset = prevAuto; };

  // clear the whole atlas once
  { const s = save(); renderer.setClearColor(0, 0); atlas.viewport.set(0, 0, W, H); renderer.setRenderTarget(atlas); renderer.clear(); restore(s); }

  for (let i = 0; i < n; i++) {
    const it = items[i], ti = performance.now();
    const obj = it.make();
    if (!obj) continue;
    frame(T, stage, obj, it.pose || {}, pad);
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * size, yTop = row * size;
    const s = save();
    info.autoReset = false; info.reset();
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0, 0);
    renderer.setRenderTarget(hi); renderer.clear(); renderer.render(stage.scene, stage.camera);
    atlas.viewport.set(x, H - yTop - size, size, size);   // GL origin is bottom-left
    renderer.setRenderTarget(atlas); renderer.render(quadScene, quadCam);
    acc.calls += info.render.calls; acc.triangles += info.render.triangles;
    restore(s);
    stage.pivot.clear();
    (it.dispose || defaultDispose)(obj);
    rects[it.kind] = [x, yTop, size, size];
    tiles.push({ kind: it.kind, ms: +(performance.now() - ti).toFixed(1) });
    onTile?.(it.kind, i);
    if (yieldEvery && (i + 1) % yieldEvery === 0) await nextFrame();   // keep game frames flowing
  }
  const tDraw = performance.now();
  const pixels = new Uint8Array(W * H * 4);
  await renderer.readRenderTargetPixelsAsync(atlas, 0, 0, W, H, pixels);
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
  hi.dispose(); atlas.dispose(); quadMat.dispose(); quad.geometry.dispose(); env.dispose();
  const urlBytes = Object.values(urls).reduce((a, u) => a + u.length, 0);
  const result = {
    version: ICON_ATLAS_VERSION, size, urls,
    atlas: { url: atlasUrl, width: W, height: H, cols, size, rects },
  };
  const cachedOk = writeIconCache(cacheKey, { version: ICON_ATLAS_VERSION, size, urls });
  result.stats = {
    items: n, setupMs: +setupMs.toFixed(1), drawMs: +(tDraw - t0 - setupMs).toFixed(1), readbackMs: +(tRead - tDraw).toFixed(1),
    encodeMs: +(tEncode - tRead).toFixed(1), totalMs: +(performance.now() - t0).toFixed(1), tiles,
    bakeRender: acc, rendererMemoryAfter: memInfo,
    transientVRAMBytes: vram, atlasPx: [W, H], cpuPixelBytes: pixels.byteLength,
    dataUrlBytes: urlBytes, atlasDataUrlBytes: atlasUrl.length, cached: cachedOk,
  };
  return result;
}
