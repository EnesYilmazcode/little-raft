// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background, read back and encoded off the main thread (toBlob) into a cached object URL.
// The game hands over its own renderer (setIconRenderer): icons are drawn into a small render target
// in idle time, never inside the game's render call, and read back asynchronously, so no second WebGL
// context exists. Without an injected renderer a small private one is created lazily and released once
// the queue drains. Models come from setModelProvider(fn) (fn(kind) -> Object3D | null, e.g. models.js
// getModel; never disposed here) and fall back to the game's own procedural models.
// Public API: getItemIcon(kind) (sync, data URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), warmIcons, onIconReady, setModelProvider, setIconRenderer.
import * as T from './vendor/three.module.js';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { getModel as getLibraryModel } from './models.js?build=v3-survival-ae77fa84ac2b';

const SIZE = 128;
// Item ids whose name differs from the models.js kind.
const MODEL_ALIAS = { fishingrod: 'rod' };
const RELEASE_MS = 60000; // long enough that the hotbar bake and the warm-all pass ~5 s later share one context

const cache = new Map();   // kind -> object/data URL ('' = failed, use the SVG)
const queued = new Set();  // background warm-up (warmIcons)
const urgent = new Set();  // asked for by a visible slot (iconURL): rendered before the warm-up
const encoding = new Map(); // kind -> token while its PNG encodes
const listeners = new Set();
const waiters = new Map(); // kind -> [resolve] for loadItemIcon
let provider = null;
let gl = null, scene = null, camera = null, failed = false, releaseTimer = 0, pumping = false;

// Per-kind display pose (radians) so long tools read diagonally like a hotbar icon.
const POSE = {
  hook: [0, 0.7, -0.2], hammer: [0, 0.5, -0.75], fishingrod: [0, 0.3, -0.8],
  plastic: [0, 0.4, 0.5], fish: [0, -0.4, 0.15], rope: [0.9, 0, 0.2],
  wood: [0, -0.35, 0.12], leaf: [0.5, 0.4, 0], scrap: [0.3, 0.4, 0],
  net: [0.55, 0.5, 0], bench: [0, 0.5, 0], crate: [0, 0.5, 0],
};
// models.js tools stand upright (grip at origin, working end +Y): tilt them onto the diagonal.
const PROVIDER_POSE = { hook: [0, 0.5, -0.75] };
// Per-kind framing for models.js items: pose, view direction, crop of the projected bounds
// ([x0, x1, y0, y1] as fractions) and exposure, so thin or dark items still read in a slot.
const FRAME = {
  hammer: { pose: [-0.75, 0, 0], view: [1, 0.3, 0.2], exp: 1.5 },           // head in profile
  lantern: { view: [0.35, 0.3, 1], crop: [0.5, 1, 0.48, 0.96], exp: 1.7 },  // the lamp, not the post
  fishingrod: { crop: [0, 0.7, 0, 0.7], exp: 1.5 },                          // grip, reel and float
  net: { view: [0.3, 0.45, 1], exp: 1.6 },
};

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
    default: return createCraft(T, kind);
  }
}

// ---------- renderer ----------
function ensureGL() {
  if (gl || failed) return !!gl;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    gl = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    gl.setPixelRatio(1);
    gl.setSize(SIZE, SIZE, false);
    gl.setClearColor(0x000000, 0);
    gl.toneMapping = T.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.15;
  } catch (e) { failed = true; gl = null; console.warn('item icons: no WebGL, using flat icons', e); return false; }
  ensureScene();
  return true;
}
function ensureScene() {
  if (scene) return;
  scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xfff3dc, 0x3b2a1a, 1.5));
  const key = new T.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 5, 4); scene.add(key);
  const rim = new T.DirectionalLight(0x9fd8ff, 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
  camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
}

function release() {
  releaseTimer = 0;
  if (!gl) return;
  try { gl.dispose(); gl.forceContextLoss(); } catch {}
  gl = null;
}

const _box = new T.Box3(), _sphere = new T.Sphere(), _v = new T.Vector3(), _dir = new T.Vector3(1, 0.85, 1.35).normalize();

function freeModel(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (!shared.has(x)) { x.map?.dispose(); x.dispose(); }
  });
}

/** Model for an icon: the provider, then the procedural fallback, then models.js for kinds the
 *  fallback lacks (cup, seed, water). own = true when the caller must free it. */
export function resolveIconModel(kind) {
  let model = null;
  if (provider) { try { model = provider(MODEL_ALIAS[kind] || kind) || provider(kind) || null; } catch (e) { console.warn('item icon provider failed', kind, e); } }
  if (model) return { model, own: false };
  try { model = buildFallbackModel(kind); } catch (e) { console.warn('item icon model failed', kind, e); }
  if (model) return { model, own: true };
  try { model = getLibraryModel(kind); } catch (e) { console.warn('item icon library model failed', kind, e); }
  return { model: model || null, own: false };   // getModel clones share cached geometry: never free
}

/** Pose and frame kind's model in the icon scene (camera fitted to it). null when there is nothing to draw. */
function stageKind(kind) {
  ensureScene();
  const { model, own } = resolveIconModel(kind);
  if (!model) return null;
  const pivot = new T.Group();
  pivot.add(model);
  const f = (!own && FRAME[kind]) || {};
  const p = f.pose || (own ? null : PROVIDER_POSE[kind]) || POSE[kind]; if (p) pivot.rotation.set(p[0], p[1], p[2]);
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) { if (own) freeModel(model); return null; }
  _box.getBoundingSphere(_sphere);
  pivot.position.sub(_sphere.center);
  _box.translate(_v.copy(_sphere.center).negate());
  // Orthographic 3/4 view framed tightly on the item's projected bounds, so long tools fill the slot.
  const r = _sphere.radius;
  if (f.view) camera.position.set(f.view[0], f.view[1], f.view[2]).normalize().multiplyScalar(r * 4);
  else camera.position.copy(_dir).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
  }
  if (f.crop) { const w = x1 - x0, h = y1 - y0, c = f.crop; x1 = x0 + w * c[1]; x0 += w * c[0]; y1 = y0 + h * c[3]; y0 += h * c[2]; }
  const half = Math.max(x1 - x0, y1 - y0) * 0.5 * 1.06, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.near = r; camera.far = r * 7;
  camera.updateProjectionMatrix();
  scene.add(pivot);
  return { pivot, model, own, exp: f.exp || 1.15 };
}
function unstage(job) { scene.remove(job.pivot); if (job.own) freeModel(job.model); }

// Private-renderer path (no renderer injected): synchronous draw and canvas copy.
function renderKind(kind) {
  if (!ensureGL()) return null;
  const job = stageKind(kind);
  if (!job) return null;
  let out = null;
  try {
    gl.toneMappingExposure = job.exp;
    gl.render(scene, camera);
    out = document.createElement('canvas'); out.width = out.height = SIZE;
    out.getContext('2d').drawImage(gl.domElement, 0, 0);       // GPU copy; the PNG encode happens later, async
  } catch (e) { out = null; console.warn('item icon render failed', kind, e); }
  unstage(job);
  return out;
}

// ---------- shared renderer (the game's own: one WebGL context for everything) ----------
// Drawn at 2x without MSAA (a multisampled target reads back empty in r170) and downscaled on a 2D canvas.
// isXRRenderTarget makes r170 apply tone mapping and the sRGB output transform to this target the same as
// to the screen; internalFormat RGBA8 keeps the storage linear, so that transform is not applied twice.
// Draws happen in idle slices, never inside the game's own render call; an item with materials not drawn
// here before is first compiled with compileAsync and drawn once that resolves (a later task), so shader
// linking overlaps the game's frames instead of stalling the draw. The readback is asynchronous; the target
// can be drawn again at once because GL orders the next draw after the pending copy.
const RT_SIZE = SIZE * 2;
let host = null, rt = null, big = null, hostLost = false, staged = null;
let warmed = new WeakSet();  // materials whose icon-scene programs are compiled
const pending = new Map();   // kind -> { token, urgent } drawn (or compiling) but not landed yet
const _clear = new T.Color();
const onHostLost = () => { hostLost = true; abortPending(); dropTarget(); };
const onHostRestored = () => { hostLost = false; warmed = new WeakSet(); schedule(); };
// The 'webglcontextlost' event arrives a task after the loss itself: ask the context too.
function hostIsLost() { if (hostLost) return true; try { return !!host?.getContext().isContextLost(); } catch { return false; } }
function dropTarget() { try { rt?.dispose(); } catch {} rt = null; }
// A lost context can leave compileAsync or a readback pending for good: forget those icons and queue them again.
function abortPending() {
  if (staged) { unstage(staged); staged = null; }
  for (const [kind, f] of pending) if (encoding.get(kind) === f.token) { encoding.delete(kind); (f.urgent ? urgent : queued).add(kind); }
  pending.clear();
}

/** Draw icons with the game's renderer instead of a private WebGL context. Call again after a remount; null detaches. */
export function setIconRenderer(renderer) {
  const next = renderer && typeof renderer.render === 'function' && typeof renderer.readRenderTargetPixelsAsync === 'function' ? renderer : null;
  if (next === host) return;
  const prev = host?.domElement;
  if (prev?.removeEventListener) { prev.removeEventListener('webglcontextlost', onHostLost); prev.removeEventListener('webglcontextrestored', onHostRestored); }
  abortPending(); dropTarget();
  host = next; hostLost = false; warmed = new WeakSet();
  if (!host) return;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  release();                                   // a private context from before the injection is not needed any more
  failed = false;
  const c = host.domElement;
  if (c?.addEventListener) { c.addEventListener('webglcontextlost', onHostLost); c.addEventListener('webglcontextrestored', onHostRestored); }
  try { hostLost = !!host.getContext().isContextLost(); } catch {}
  if (urgent.size || queued.size) schedule();
}

// Run fn with the renderer set up for an icon, then put back everything the game relies on (target, clear
// colour, tone mapping, exposure, and the draw counters: info.autoReset is off and the perf gate reads them).
function withIconState(r, exp, fn) {
  const target = r.getRenderTarget(), clear = r.getClearColor(_clear), alpha = r.getClearAlpha();
  const tm = r.toneMapping, te = r.toneMappingExposure, ri = r.info.render;
  const calls = ri.calls, tris = ri.triangles, pts = ri.points, lines = ri.lines;
  try {
    if (!rt) {
      rt = new T.WebGLRenderTarget(RT_SIZE, RT_SIZE, { samples: 0 });
      rt.texture.colorSpace = T.SRGBColorSpace; rt.texture.internalFormat = 'RGBA8'; rt.isXRRenderTarget = true;
    }
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0);
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = exp;
    return fn();
  } finally {
    r.toneMapping = tm; r.toneMappingExposure = te;
    r.setRenderTarget(target); r.setClearColor(clear, alpha);
    ri.calls = calls; ri.triangles = tris; ri.points = pts; ri.lines = lines;
  }
}

// Draw the staged item and start its readback; the icon lands (flip, downscale, encode) when the copy is done.
function drawShared(kind, token, job) {
  const r = host, pixels = new Uint8Array(RT_SIZE * RT_SIZE * 4);   // per icon: an aborted readback may still land in its buffer
  let read;
  try { read = withIconState(r, job.exp, () => { r.render(scene, camera); return r.readRenderTargetPixelsAsync(rt, 0, 0, RT_SIZE, RT_SIZE, pixels); }); }
  catch (e) { read = Promise.reject(e); }
  finally { unstage(job); }
  read.then(() => landShared(kind, token, pixels), e => {
    const f = pending.get(kind);
    if (!settle(kind, token)) return;
    if (hostIsLost()) { (f?.urgent ? urgent : queued).add(kind); return; }   // drawn again after the restore
    console.warn('item icon render failed', kind, e);
    finish(kind, '');
  });
}
function settle(kind, token) {   // true when this draw is still the current one for kind
  if (pending.get(kind)?.token === token) pending.delete(kind);
  if (encoding.get(kind) !== token) return false;   // aborted, or the provider swapped meanwhile: re-queued already
  encoding.delete(kind);
  return true;
}
function landShared(kind, token, px) {
  const f = pending.get(kind);
  if (!settle(kind, token)) return;
  if (hostIsLost()) { (f?.urgent ? urgent : queued).add(kind); return; }   // the copy may be blank
  // The target holds premultiplied colour (blended over a clear 0,0,0,0): ImageData wants it straight.
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a && a < 255) { const k = 255 / a; px[i - 3] = Math.min(255, px[i - 3] * k + 0.5); px[i - 2] = Math.min(255, px[i - 2] * k + 0.5); px[i - 1] = Math.min(255, px[i - 1] * k + 0.5); }
  }
  let out = null;
  try {
    if (!big) { big = document.createElement('canvas'); big.width = big.height = RT_SIZE; }
    big.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, 0, px.length), RT_SIZE, RT_SIZE), 0, 0);
    out = document.createElement('canvas'); out.width = out.height = SIZE;
    const c2 = out.getContext('2d');
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
    c2.setTransform(SIZE / RT_SIZE, 0, 0, -SIZE / RT_SIZE, 0, SIZE);   // GL rows run bottom-up
    c2.drawImage(big, 0, 0);
  } catch (e) { out = null; console.warn('item icon copy failed', kind, e); }
  encode(kind, out);
}

function pumpShared(deadline) {
  if (staged || hostIsLost()) return;           // compileAsync (or a context restore) schedules the next slice
  const t0 = performance.now();
  const idleMs = deadline && !deadline.didTimeout ? deadline.timeRemaining() - SLICE_MS : 0;
  const budget = Math.max(BUDGET_MS, idleMs);
  do {
    const q = urgent.size ? urgent : queued, it = q.values().next();
    if (it.done) break;
    const kind = it.value, wasUrgent = q === urgent;
    q.delete(kind);
    let job = null;
    try { job = stageKind(kind); } catch (e) { console.warn('item icon model failed', kind, e); }
    if (!job) { finish(kind, ''); continue; }   // flat sprite
    const token = {};
    encoding.set(kind, token); pending.set(kind, { token, urgent: wasUrgent });
    const mats = [];
    job.pivot.traverse(o => { if (o.material) for (const m of [].concat(o.material)) if (!warmed.has(m)) mats.push(m); });
    if (!mats.length) { drawShared(kind, token, job); continue; }
    staged = job;
    const r = host;
    let ready;
    try { ready = withIconState(r, job.exp, () => r.compileAsync(scene, camera)); } catch (e) { ready = Promise.resolve(); }   // the draw reports it
    ready.then(() => {
      if (staged !== job) return;               // aborted (context lost or renderer swapped)
      staged = null;
      for (const m of mats) warmed.add(m);
      if (pending.get(kind)?.token === token && encoding.get(kind) === token) drawShared(kind, token, job);
      else { unstage(job); settle(kind, token); }   // provider swapped meanwhile: re-queued already
      if (urgent.size || queued.size) schedule();
    });
    return;
  } while ((urgent.size || queued.size) && performance.now() - t0 < budget);
  if (urgent.size || queued.size) schedule();
}

const stale = new Map();    // kind -> blob URL replaced by setModelProvider, revoked once the new icon lands
function finish(kind, url) {
  cache.set(kind, url);
  const w = waiters.get(kind); if (w) { waiters.delete(kind); for (const r of w) r(url || null); }
  if (url) for (const fn of listeners) { try { fn(kind, url); } catch (e) { console.error(e); } }
  const old = stale.get(kind); if (old) { stale.delete(kind); URL.revokeObjectURL(old); }
}
function encode(kind, canvas) {
  if (!canvas) { finish(kind, ''); return; }
  if (typeof canvas.toBlob !== 'function') { let url = ''; try { url = canvas.toDataURL('image/png'); } catch {} finish(kind, url); return; }
  const token = {};
  encoding.set(kind, token);
  canvas.toBlob(blob => {
    if (encoding.get(kind) !== token) return;                    // provider swapped meanwhile: re-queued
    encoding.delete(kind);
    finish(kind, blob ? URL.createObjectURL(blob) : '');
  }, 'image/png');
}

// ---------- queue ----------
// Idle time only (the timeout is a late fallback for a page that never idles): no icon work lands in a busy frame.
// Warm-up starts on the title screen; a short timeout plus a ~5 ms drain per callback finishes it there even
// when the page never goes idle (busy render loop), instead of one icon per 1.5 s spilling into play.
const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 300 }) : cb => setTimeout(() => cb(null), 16);
const SLICE_MS = 8;   // leave this much of a real idle period unused
const BUDGET_MS = 5;  // drain budget for a timed-out callback (or no requestIdleCallback)

function pump(deadline) {
  pumping = false;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  if (host) { pumpShared(deadline); return; }
  const t0 = performance.now();
  // At least one icon per callback; more while the idle period (or the timed-out budget) has room.
  const idleMs = deadline && !deadline.didTimeout ? deadline.timeRemaining() - SLICE_MS : 0;
  const budget = Math.max(BUDGET_MS, idleMs);
  do {
    const q = urgent.size ? urgent : queued, it = q.values().next();
    if (it.done) break;
    const kind = it.value;
    q.delete(kind);
    encode(kind, renderKind(kind));
  } while ((urgent.size || queued.size) && performance.now() - t0 < budget);
  if (urgent.size || queued.size) schedule();
  else if (gl) releaseTimer = setTimeout(release, RELEASE_MS);
}
function schedule() { if (!pumping) { pumping = true; idle(pump); } }

function request(kind, now) {
  if (!kind) return null;
  const hit = cache.get(kind);
  if (hit !== undefined) return hit || null;
  if (failed || urgent.has(kind) || encoding.has(kind)) return null;
  if (now) { queued.delete(kind); urgent.add(kind); } else if (!queued.has(kind)) queued.add(kind); else return null;
  schedule();
  return null;
}
/** Cached icon URL for kind, or null while it renders (queued ahead of the warm-up; listeners fire when ready). */
export function iconURL(kind) { return request(kind, true); }
export const getItemIcon = iconURL;
/** Promise of the icon URL (null if it cannot be rendered, e.g. no WebGL). */
export function loadItemIcon(kind) {
  const url = iconURL(kind);
  if (url || !kind || cache.has(kind) || failed) return Promise.resolve(url);
  return new Promise(r => { let w = waiters.get(kind); if (!w) waiters.set(kind, w = []); w.push(r); });
}
/** Queue several kinds ahead of time (rendered in idle slices). */
export function warmIcons(kinds) { for (const k of kinds) request(k, false); }
/** Called with (kind, url) whenever an icon (re)renders. Returns an unsubscribe function. */
export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Drop everything this module instance holds: provider, queue, icons, GL context, fallback materials. Only for
 *  an instance nobody uses any more (game.js dispose: an old ?build= graph stays loaded after a live swap). */
export function resetItemIcons() {
  provider = null; queued.clear(); urgent.clear(); encoding.clear(); listeners.clear();
  for (const w of waiters.values()) for (const r of w) r(null);
  waiters.clear();
  for (const u of [...cache.values(), ...stale.values()]) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  cache.clear(); stale.clear();
  clearTimeout(releaseTimer); release();
  setIconRenderer(null); // drop the shared renderer's render target and context listeners (the next build injects it again)
  scene = camera = null;
  for (const m of mats.values()) m.dispose();
  mats.clear(); shared.clear();
}
/** Swap the model source (e.g. hands.js buildItemModel). Re-renders every icon seen so far. */
export function setModelProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  const kinds = [...cache.keys(), ...encoding.keys()];
  for (const [k, u] of cache) if (u.startsWith('blob:')) { if (stale.has(k)) URL.revokeObjectURL(stale.get(k)); stale.set(k, u); }
  cache.clear(); encoding.clear();
  warmIcons(kinds);
}
