// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background with the game's renderer (setIconRenderer), then cached as a PNG object URL.
// Everything queued renders in one idle-time batch; the batch's render targets are freed once the queue drains. Models come from setModelProvider(fn) (fn(kind) -> Object3D | null,
// e.g. models.js getModel; never disposed here) and fall back to the game's own procedural models.
// Public API: getItemIcon(kind) (sync, URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), peekIcon (cache only), warmIcons, onIconReady, setModelProvider, setIconRenderer.
import * as T from './vendor/three.module.js';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';

const SIZE = 128;
// Item ids whose name differs from the models.js kind.
const MODEL_ALIAS = { fishingrod: 'rod' };
const RELEASE_MS = 15000; // keep the atlas targets through a burst of on-demand renders

const cache = new Map();   // kind -> data URL ('' = failed, use the SVG)
const queued = new Set();
const inflight = new Set(); // rendered, PNG still encoding
const stale = new Map();   // kind -> superseded object URL, revoked after its replacement lands
let generation = 0;        // bumps on setModelProvider so in-flight encodes of the old model are redone
const listeners = new Set();
const waiters = new Map(); // kind -> [resolve] for loadItemIcon
let provider = null;
let scene = null, camera = null, failed = false, releaseTimer = 0, pumping = false;

// Per-kind display pose (radians) so long tools read diagonally like a hotbar icon.
const POSE = {
  hook: [0, 0.7, -0.2], hammer: [0, 0.5, -0.75], fishingrod: [0, 0.3, -0.8],
  plastic: [0, 0.4, 0.5], fish: [0, -0.4, 0.15], rope: [0.9, 0, 0.2],
  wood: [0, -0.35, 0.12], leaf: [0.5, 0.4, 0], scrap: [0.3, 0.4, 0],
  net: [0.55, 0.5, 0], bench: [0, 0.5, 0], crate: [0, 0.5, 0],
};
// models.js tools stand upright (grip at origin, working end +Y): tilt them onto the diagonal.
const PROVIDER_POSE = { hook: [0, 0.5, -0.75] };

// ---------- fallback models ----------
const mats = new Map(), shared = new Set();
const mat = c => { let m = mats.get(c); if (!m) { mats.set(c, m = new T.MeshStandardMaterial({ color: c, roughness: 0.8 })); shared.add(m); } return m; };

function ropeModel() {
  const g = new T.Group(), a = mat('#c99a5c'), b = mat('#8f6a3c');
  for (let i = 0; i < 3; i++) {
    const t = new T.Mesh(new T.TorusGeometry(0.34 - i * 0.015, 0.055, 8, 28), i % 2 ? b : a);
    t.position.y = i * 0.09; t.rotation.x = Math.PI / 2; g.add(t);
  }
  const tail = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.4, 8), a);
  tail.position.set(0.38, 0.05, 0.12); tail.rotation.z = 1.2; g.add(tail);
  return g;
}
function woodModel() {
  const g = new T.Group();
  [[-0.13, 0, 0.04, '#bb8a53'], [0.13, 0, -0.05, '#ad7c4a'], [0.01, 0.1, 0.22, '#c69860']].forEach(([z, y, ry, c]) => {
    const p = new T.Mesh(new T.BoxGeometry(1.2, 0.09, 0.22), mat(c)); p.position.set(0, y, z); p.rotation.y = ry; g.add(p);
  });
  return g;
}
function fishModel() {
  const g = new T.Group(), skin = mat('#6f9fb4'), fin = mat('#4e7d92');
  const body = new T.Mesh(new T.SphereGeometry(0.5, 16, 12), skin); body.scale.set(1, 0.46, 0.26); g.add(body);
  const belly = new T.Mesh(new T.SphereGeometry(0.42, 14, 10), mat('#e8dfc4')); belly.scale.set(0.9, 0.3, 0.22); belly.position.y = -0.07; g.add(belly);
  const tail = new T.Mesh(new T.ConeGeometry(0.2, 0.3, 4), fin); tail.rotation.z = Math.PI / 2; tail.scale.z = 0.25; tail.position.x = -0.6; g.add(tail);
  const dorsal = new T.Mesh(new T.ConeGeometry(0.12, 0.2, 3), fin); dorsal.scale.z = 0.2; dorsal.position.set(0.02, 0.24, 0); g.add(dorsal);
  for (const z of [-0.12, 0.12]) { const eye = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), mat('#1b2328')); eye.position.set(0.34, 0.06, z); g.add(eye); }
  return g;
}

export function buildFallbackModel(kind) {
  switch (kind) {
    case 'hook': return createHook(T);
    case 'hammer': return createHammer(T);
    case 'fishingrod': return createFishingTool(T);
    case 'plastic': return createPlastic(T);
    case 'rope': return ropeModel();
    case 'fish': return fishModel();
    case 'wood': return woodModel();
    case 'leaf': case 'scrap': return createDebris(T, kind, mat, { seed: 7, tilt: 0 });
    default: return createCraft(T, kind, { fresh: true });
  }
}

// ---------- renderer ----------
// Icons draw with the game's own renderer (setIconRenderer), so there is no second WebGL context.
// A batch renders each queued kind into a multisampled half-float SIZE target, and a post pass applies
// the icon look (ACES filmic at EXPOSURE, then sRGB, straight alpha) into that kind's cell of an 8-bit
// atlas; a single readback of the atlas feeds a small 2D canvas per kind for async PNG encoding.
// Render targets and the post pass are freed RELEASE_MS after the queue drains.
const COLS = 8, EXPOSURE = 1.15;
let host = null, hdr = null, ldr = null, post = null;
const POST_FS = `
precision highp float;
uniform sampler2D map; uniform float exposure; varying vec2 vUv;
vec3 RRTAndODTFit( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
vec3 aces( vec3 color ) { // three.js ACESFilmicToneMapping
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= exposure / 0.6; color = ACESInputMat * color; color = RRTAndODTFit( color ); color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
void main() {
  vec4 c = texture2D( map, vUv );
  if ( c.a <= 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec3 rgb = aces( c.rgb / c.a ); // resolved MSAA edges are premultiplied by coverage
  rgb = mix( pow( rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), rgb * 12.92, vec3( lessThanEqual( rgb, vec3( 0.0031308 ) ) ) );
  gl_FragColor = vec4( rgb, clamp( c.a, 0.0, 1.0 ) );
}`;
function ensureGL() {
  if (failed) return false;
  if (!host) { if (typeof document === 'undefined') failed = true; return false; } // otherwise waits for setIconRenderer
  if (!scene) {
    scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xfff3dc, 0x3b2a1a, 1.5));
    const key = new T.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const rim = new T.DirectionalLight(0x9fd8ff, 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }
  if (!post) {
    const m = new T.ShaderMaterial({ uniforms: { map: { value: null }, exposure: { value: EXPOSURE } }, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }', fragmentShader: POST_FS });
    const q = new T.Mesh(new T.PlaneGeometry(2, 2), m); q.frustumCulled = false;
    post = { scene: new T.Scene().add(q), camera: new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat: m, geo: q.geometry };
  }
  return true;
}
function targets(W, H) {
  hdr ??= new T.WebGLRenderTarget(SIZE, SIZE, { type: T.HalfFloatType, samples: 4, colorSpace: T.LinearSRGBColorSpace });
  if (ldr && ldr.width === W && ldr.height === H) return;
  ldr?.dispose();
  ldr = new T.WebGLRenderTarget(W, H, { type: T.UnsignedByteType, depthBuffer: false });
}

function release() {
  releaseTimer = 0;
  hdr?.dispose(); ldr?.dispose(); hdr = ldr = null;
  if (post) { post.mat.dispose(); post.geo.dispose(); post = null; }
}

/** Use the game's WebGLRenderer for icon renders (null detaches it; queued icons wait for the next one). */
export function setIconRenderer(r) {
  const next = r && typeof r.render === 'function' ? r : null;
  if (next === host) return;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  release();
  host = next;
  if (host && queued.size) schedule();
}

const _box = new T.Box3(), _sphere = new T.Sphere(), _v = new T.Vector3(), _dir = new T.Vector3(1, 0.85, 1.35).normalize();

function freeModel(root) {
  root.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); // shared: cached model geometry the game also draws
    const m = o.material; if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (!shared.has(x) && !x.userData.shared) { x.map?.dispose(); x.dispose(); }
  });
}

// Draws kind into the current viewport. Returns false when there is nothing to show.
function renderKind(kind) {
  let model = null, own = false;
  if (provider) { try { model = provider(MODEL_ALIAS[kind] || kind) || provider(kind) || null; } catch (e) { console.warn('item icon provider failed', kind, e); } }
  if (!model) { try { model = buildFallbackModel(kind); own = true; } catch (e) { console.warn('item icon model failed', kind, e); } }
  if (!model) return false;
  const pivot = new T.Group();
  pivot.add(model);
  const p = (own ? null : PROVIDER_POSE[kind]) || POSE[kind]; if (p) pivot.rotation.set(p[0], p[1], p[2]);
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) { if (own) freeModel(model); return false; }
  _box.getBoundingSphere(_sphere);
  pivot.position.sub(_sphere.center);
  _box.translate(_v.copy(_sphere.center).negate());
  // Orthographic 3/4 view framed tightly on the item's projected bounds, so long tools fill the slot.
  const r = _sphere.radius;
  camera.position.copy(_dir).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) * 0.5 * 1.06, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.near = r; camera.far = r * 7;
  camera.updateProjectionMatrix();
  scene.add(pivot);
  let ok = true;
  try { host.render(scene, camera); } catch (e) { ok = false; console.warn('item icon render failed', kind, e); }
  scene.remove(pivot);
  if (own) freeModel(model);
  return ok;
}

// PNG object URL (a data URL where blobs are unavailable) for a finished cell canvas.
function encode(cv, done) {
  if (typeof cv.toBlob === 'function' && typeof URL?.createObjectURL === 'function') {
    try { cv.toBlob(b => done(b ? URL.createObjectURL(b) : ''), 'image/png'); return; } catch (e) { console.warn('item icon encode failed', e); }
  }
  let url = ''; try { url = cv.toDataURL('image/png'); } catch (e) { console.warn('item icon encode failed', e); }
  done(url);
}

const revoke = url => { if (url && url.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch {} } };
function finish(kind, url, gen) {
  inflight.delete(kind);
  if (gen !== generation) { revoke(url); iconURL(kind); return; } // model provider changed mid-encode: redo it
  cache.set(kind, url);
  const w = waiters.get(kind); if (w) { waiters.delete(kind); for (const r of w) r(url || null); }
  if (url) for (const fn of listeners) { try { fn(kind, url); } catch (e) { console.error(e); } }
  const old = stale.get(kind); if (old !== undefined) { stale.delete(kind); if (old !== url) revoke(old); } // listeners swapped it out
}

// Renders every kind in one batch, one atlas cell each, on the host renderer; its state is restored after.
function renderBatch(kinds) {
  const gen = generation;
  if (!ensureGL()) { for (const k of kinds) { inflight.delete(k); if (failed) finish(k, '', gen); else queued.add(k); } return; }
  const r = host, cols = Math.min(kinds.length, COLS), rows = Math.ceil(kinds.length / COLS), W = cols * SIZE, H = rows * SIZE;
  const info = r.info.render, saved = { rt: r.getRenderTarget(), color: r.getClearColor(new T.Color()), alpha: r.getClearAlpha(), auto: r.autoClear,
    frame: info.frame, calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines };
  let drawn = [], px = null;
  try {
    if (r.getContext().isContextLost()) throw new Error('context lost');
    targets(W, H);
    r.setClearColor(0x000000, 0); r.autoClear = false;
    ldr.scissorTest = false; ldr.viewport.set(0, 0, W, H); r.setRenderTarget(ldr); r.clear();
    post.mat.uniforms.map.value = hdr.texture;
    drawn = kinds.map((kind, i) => { // each kind: MSAA cell render, then the look pass into its atlas cell
      r.setRenderTarget(hdr); r.clear();
      if (!renderKind(kind)) return false;
      const x = (i % COLS) * SIZE, y = H - (Math.floor(i / COLS) + 1) * SIZE; // GL origin is bottom-left
      ldr.viewport.set(x, y, SIZE, SIZE); r.setRenderTarget(ldr); r.render(post.scene, post.camera);
      return true;
    });
    post.mat.uniforms.map.value = null;
    px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(ldr, 0, 0, W, H, px);
  } catch (e) { console.warn('item icons: render failed, using flat icons', e); px = null; }
  finally {
    r.setRenderTarget(saved.rt); r.setClearColor(saved.color, saved.alpha); r.autoClear = saved.auto;
    Object.assign(info, { frame: saved.frame, calls: saved.calls, triangles: saved.triangles, points: saved.points, lines: saved.lines }); // icons stay out of the game's stats
  }
  kinds.forEach((kind, i) => {
    if (!px || !drawn[i]) { finish(kind, '', gen); return; }
    let out = null;
    try {
      out = document.createElement('canvas'); out.width = out.height = SIZE;
      const g = out.getContext('2d'), img = g.createImageData(SIZE, SIZE), x0 = (i % COLS) * SIZE, row0 = Math.floor(i / COLS) * SIZE;
      for (let y = 0; y < SIZE; y++) { // readback rows run bottom-up
        const src = ((H - 1 - (row0 + y)) * W + x0) * 4;
        img.data.set(px.subarray(src, src + SIZE * 4), y * SIZE * 4);
      }
      g.putImageData(img, 0, 0);
    } catch (e) { console.warn('item icon copy failed', kind, e); out = null; }
    if (out) encode(out, url => finish(kind, url, gen)); else finish(kind, '', gen);
  });
}

// ---------- queue ----------
// A frame-time idle slot when there is one; the timeout keeps a machine that never idles (every frame over budget) from starving icons.
const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 2000 }) : cb => setTimeout(cb, 16);

function pump() {
  pumping = false;
  if (!queued.size) return;
  const kinds = [...queued];
  queued.clear();
  for (const k of kinds) inflight.add(k);
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  renderBatch(kinds);
  if (!host) return; // no renderer yet: setIconRenderer reschedules
  if (queued.size) schedule();
  else if (hdr || post) releaseTimer = setTimeout(release, RELEASE_MS);
}
function schedule() { if (!pumping) { pumping = true; idle(pump); } }

/** Cached icon URL for kind if it has already rendered; never queues a render. */
export function peekIcon(kind) { return (kind && cache.get(kind)) || null; }
/** Cached icon URL for kind, or null while it renders (it is queued; listeners fire when ready). */
export function iconURL(kind) {
  if (!kind) return null;
  const hit = cache.get(kind);
  if (hit !== undefined) return hit || null;
  if (failed) return null;
  if (!queued.has(kind) && !inflight.has(kind)) { queued.add(kind); schedule(); }
  return null;
}
export const getItemIcon = iconURL;
/** Promise of the icon URL (null if it cannot be rendered, e.g. no WebGL). */
export function loadItemIcon(kind) {
  const url = iconURL(kind);
  if (url || !kind || cache.has(kind) || failed) return Promise.resolve(url);
  return new Promise(r => { let w = waiters.get(kind); if (!w) waiters.set(kind, w = []); w.push(r); });
}
/** Queue several kinds ahead of time (they render together in the next idle slice). */
export function warmIcons(kinds) { for (const k of kinds) iconURL(k); }
/** Called with (kind, url) whenever an icon (re)renders. Returns an unsubscribe function. */
export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Swap the model source (e.g. hands.js buildItemModel). Re-renders every icon seen so far. */
export function setModelProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  generation++;
  const kinds = [...cache.keys()];
  for (const [k, url] of cache) if (url && !stale.has(k)) stale.set(k, url); // revoked once the new render replaces it
  cache.clear();
  warmIcons(kinds);
}
