// Bake 3D item models into cached 2D icons, once. No deps beyond THREE (passed in as T).
//
// Approach A (recommended): reuse the game's renderer. Render the model into an MSAA HalfFloat
// render target at 2x size, then one resolve pass (2x2 downsample, ACES + sRGB to match the game,
// silhouette outline) into a small 8-bit target, read it back once and hand out an <img> URL.
// Render targets in r170 are always linear with no tone mapping, so the resolve pass does both.
//
// Approach B (for comparison): a second, tiny WebGLRenderer on its own canvas. Colors come out
// right for free, but it costs a second GL context and compiles every shader twice.
//
// const baker = createIconBaker(T, renderer, { size: 96 });
// const { url, ms } = await baker.bake('hammer', createHammer(T), { roll: -45 });
// img.src = url;   // cached; baker.get('hammer') returns the same entry later

const DEG = Math.PI / 180;

const RESOLVE_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 srcTexel; uniform float exposure;
uniform float outlinePx; uniform vec4 outline;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){ vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){
  const mat3 I=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
  const mat3 O=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
  c*=exposure/0.6; c=O*RRTAndODTFit(I*c); return clamp(c,0.,1.);
}
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(vec3(0.0031308),c)); }
void main(){
  vec2 t=srcTexel*0.5;
  vec4 c=0.25*(texture2D(tSrc,vUv+vec2(-t.x,-t.y))+texture2D(tSrc,vUv+vec2(t.x,-t.y))
              +texture2D(tSrc,vUv+vec2(-t.x,t.y))+texture2D(tSrc,vUv+vec2(t.x,t.y)));
  vec3 rgb=c.a>0.001?c.rgb/c.a:vec3(0.);          // cleared to transparent black => premultiplied
  rgb=toSRGB(aces(rgb));
  float ring=0.;                                     // dilated silhouette, two rings of 12 taps
  for(int i=0;i<12;i++){
    float a=6.2831853*float(i)/12.; vec2 d=vec2(cos(a),sin(a))*srcTexel*2.*outlinePx;
    ring=max(ring,max(texture2D(tSrc,vUv+d).a,texture2D(tSrc,vUv+d*0.5).a));
  }
  float oa=ring*outline.a;
  float A=c.a+oa*(1.-c.a);
  vec3 col=A>0.?(rgb*c.a+outline.rgb*oa*(1.-c.a))/A:vec3(0.);
  gl_FragColor=vec4(col,A);
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
  panel(4, 6, 5, 0xfff2d8, 5, 3);   // warm key softbox
  panel(-6, 2, -4, 0x9fd8ff, 3, 4); // cool rim
  const pm = new T.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.04).texture;
  pm.dispose(); s.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

// Shared lighting rig: hemisphere fill + warm key from top-left-front + cool rim from behind.
function makeStage(T, env) {
  const scene = new T.Scene();
  scene.environment = env;
  scene.add(new T.HemisphereLight(0xeaf6ff, 0x50422e, 1.1));
  const key = new T.DirectionalLight(0xfff1dc, 2.6); key.position.set(-2, 3, 4); scene.add(key);
  const rim = new T.DirectionalLight(0x9fdcff, 1.6); rim.position.set(3, 1, -4); scene.add(rim);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(0, 0, 10);
  const pivot = new T.Group(); scene.add(pivot);
  return { scene, camera, pivot };
}

// Pose the model (icon pose), center it and fit the ortho frustum to its view-space box.
function frame(T, stage, obj, pose, pad) {
  const { camera, pivot } = stage;
  pivot.clear(); pivot.rotation.set(0, 0, 0); pivot.position.set(0, 0, 0);
  pivot.add(obj);
  pivot.rotation.set((pose.pitch ?? 20) * DEG, (pose.yaw ?? -35) * DEG, (pose.roll ?? 0) * DEG, 'ZXY');
  pivot.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(pivot, true), c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
  pivot.position.sub(c); pivot.updateMatrixWorld(true);
  const h = Math.max(sz.x, sz.y) * 0.5 * pad;
  Object.assign(camera, { left: -h, right: h, top: h, bottom: -h, near: Math.max(0.01, 10 - sz.z), far: 10 + sz.z });
  camera.position.set(0, 0, 10); camera.updateProjectionMatrix();
}

export function disposeObject(o) {
  if (typeof o.userData?.dispose === 'function') { o.userData.dispose(); return; }
  o.traverse(n => {
    n.geometry?.dispose();
    for (const m of [].concat(n.material || [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
  });
}

export function createIconBaker(T, renderer, { size = 96, ss = 2, pad = 1.12, outlinePx = 1.5, outline = [0.05, 0.08, 0.1, 0.9] } = {}) {
  const env = makeEnv(T, renderer);
  const stage = makeStage(T, env);
  const S = size * ss;
  const hi = new T.WebGLRenderTarget(S, S, { type: T.HalfFloatType, samples: 4 });
  const lo = new T.WebGLRenderTarget(size, size, { depthBuffer: false });
  const quadMat = new T.ShaderMaterial({
    uniforms: { tSrc: { value: hi.texture }, srcTexel: { value: new T.Vector2(1 / S, 1 / S) }, exposure: { value: 1 },
      outlinePx: { value: outlinePx }, outline: { value: new T.Vector4(...outline) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: RESOLVE_FRAG, blending: T.NoBlending, depthTest: false, depthWrite: false,
  });
  const quadScene = new T.Scene(); quadScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), quadMat));
  const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cache = new Map();
  const prevColor = new T.Color();

  async function bake(kind, obj, pose = {}, { format = 'blob', exposure = 1, keep = false } = {}) {
    if (cache.has(kind)) return cache.get(kind);
    const t0 = performance.now();
    frame(T, stage, obj, pose, pad);
    quadMat.uniforms.exposure.value = exposure;
    // save the bits of renderer state we touch
    const prevRT = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha(), prevShadow = renderer.shadowMap.enabled;
    renderer.getClearColor(prevColor);
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(hi); renderer.clear(); renderer.render(stage.scene, stage.camera);
    renderer.setRenderTarget(lo); renderer.clear(); renderer.render(quadScene, quadCam);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevColor, prevAlpha); renderer.shadowMap.enabled = prevShadow;
    const tDraw = performance.now();
    await renderer.readRenderTargetPixelsAsync(lo, 0, 0, size, size, pixels); // PBO + fence, no hard stall
    const tRead = performance.now();
    // GL rows are bottom-up; flip into ImageData.
    const img = ctx.createImageData(size, size), row = size * 4;
    for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    let url;
    if (format === 'dataurl') url = canvas.toDataURL('image/png');
    else url = URL.createObjectURL(await new Promise(r => canvas.toBlob(r, 'image/png')));
    const bitmap = await createImageBitmap(img); // for drawing into canvases (2D HUD, atlas), no encode
    stage.pivot.clear();
    if (!keep) disposeObject(obj);
    const entry = { kind, url, bitmap, ms: { draw: tDraw - t0, read: tRead - tDraw, encode: performance.now() - tRead, total: performance.now() - t0 } };
    cache.set(kind, entry);
    return entry;
  }

  return {
    bake, get: k => cache.get(k), cache, size,
    dispose() {
      hi.dispose(); lo.dispose(); quadMat.dispose(); env.dispose();
      for (const e of cache.values()) { if (e.url.startsWith('blob:')) URL.revokeObjectURL(e.url); e.bitmap?.close(); }
      cache.clear();
    },
  };
}

// Approach B: dedicated small renderer. Same stage, colors handled by three, outline via 2D canvas.
export function createSideRendererBaker(T, { size = 96, pad = 1.12 } = {}) {
  const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  r.setPixelRatio(1); r.setSize(size * 2, size * 2, false);
  r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.setClearColor(0, 0);
  const env = makeEnv(T, r), stage = makeStage(T, env);
  const out = document.createElement('canvas'); out.width = out.height = size;
  const ctx = out.getContext('2d');
  const sil = document.createElement('canvas'); sil.width = sil.height = size;
  const sctx = sil.getContext('2d');
  async function bake(kind, obj, pose = {}) {
    const t0 = performance.now();
    frame(T, stage, obj, pose, pad);
    r.render(stage.scene, stage.camera);
    // must copy in the same task as render(), since preserveDrawingBuffer is false
    sctx.clearRect(0, 0, size, size); sctx.drawImage(r.domElement, 0, 0, size, size);
    const tDraw = performance.now();
    ctx.clearRect(0, 0, size, size);
    // 2D outline: stamp the tinted silhouette in 8 directions, then the item on top
    const tint = document.createElement('canvas'); tint.width = tint.height = size;
    const tc = tint.getContext('2d'); tc.drawImage(sil, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = 'rgba(13,20,26,.9)'; tc.fillRect(0, 0, size, size);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.drawImage(tint, Math.cos(a) * 1.5, Math.sin(a) * 1.5); }
    ctx.drawImage(sil, 0, 0);
    const url = URL.createObjectURL(await new Promise(res => out.toBlob(res, 'image/png')));
    stage.pivot.clear(); disposeObject(obj);
    return { kind, url, ms: { draw: tDraw - t0, total: performance.now() - t0 } };
  }
  return { bake, dispose() { env.dispose(); r.dispose(); r.forceContextLoss(); } };
}
