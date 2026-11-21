// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background and encoded off the main thread (toBlob) into a cached object URL. There is no second
// WebGL context: the game calls renderIcons(renderer) right before its own render each frame, queued
// icons are drawn into a scissored corner of the main canvas (the game frame then covers it before
// the canvas is presented), read back with one drawImage per frame and un-matted from a pass over
// black and one over white. A few icons per frame within a small time budget; until a renderer is
// attached the queue simply waits. Models come from setModelProvider(fn) (fn(kind) -> Object3D | null, e.g. models.js
// getModel; never disposed here) and fall back to the game's own procedural models.
// Public API: getItemIcon(kind) (sync, data URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), warmIcons, onIconReady, setModelProvider, renderIcons.
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
const BUDGET_MS = 3;     // CPU time per frame for icon renders (at least one icon)
const EXPOSURE = 1.15;

const cache = new Map();   // kind -> object/data URL ('' = failed, use the SVG)
const queued = new Set();
const encoding = new Map(); // kind -> token while its PNG encodes
const listeners = new Set();
const waiters = new Map(); // kind -> [resolve] for loadItemIcon
let provider = null;
let scene = null, camera = null, strip = null;
const failed = typeof document === 'undefined';   // no DOM (node tests): flat icons only

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
    default: return createCraft(T, kind);
  }
}

// ---------- renderer ----------
function ensureScene() {
  if (scene) return;
  scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xfff3dc, 0x3b2a1a, 1.5));
  const key = new T.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 5, 4); scene.add(key);
  const rim = new T.DirectionalLight(0x9fd8ff, 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
  camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
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

/** Poses kind's model in the icon scene and frames the camera on it; null when there is nothing to draw. */
function stage(kind) {
  const { model, own } = resolveIconModel(kind);
  if (!model) return null;
  const pivot = new T.Group();
  pivot.add(model);
  const p = (own ? null : PROVIDER_POSE[kind]) || POSE[kind]; if (p) pivot.rotation.set(p[0], p[1], p[2]);
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) { if (own) freeModel(model); return null; }
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
  return { pivot, model, own };
}

const msaaOf = new WeakMap();
const _vp = new T.Vector4(), _sc = new T.Vector4(), _cc = new T.Color();

/** Draws queued icons into the bottom-left corner of renderer's default framebuffer and reads them
 *  back. Call it right before the game renders its full frame, in the same task: that frame covers
 *  the corner again before the canvas is presented. */
export function renderIcons(renderer, budgetMs = BUDGET_MS) {
  if (!queued.size || !renderer || failed) return;
  const canvas = renderer.domElement, W = canvas?.width | 0, H = canvas?.height | 0;
  let msaa = msaaOf.get(renderer);
  if (msaa === undefined) { try { msaa = !!renderer.getContext().getContextAttributes()?.antialias; } catch { msaa = false; } msaaOf.set(renderer, msaa); }
  // Without MSAA render at 2x and downscale, so icons stay smooth on dense screens too.
  let S = msaa ? SIZE : SIZE * 2;
  if (W < 2 * S || H < S) S = SIZE;
  if (W < 2 * S || H < S) return;                                 // canvas too small (yet): next frame
  ensureScene();
  const pr = renderer.getPixelRatio() || 1;
  const prevTarget = renderer.getRenderTarget(), prevScissorTest = renderer.getScissorTest(), prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping, prevExposure = renderer.toneMappingExposure, prevSpace = renderer.outputColorSpace;
  renderer.getViewport(_vp); renderer.getScissor(_sc); renderer.getClearColor(_cc);
  const jobs = [], t0 = performance.now();
  let x = 0;
  try {
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = EXPOSURE; renderer.outputColorSpace = T.SRGBColorSpace;
    while (queued.size && x + 2 * S <= W) {
      const kind = queued.values().next().value;
      queued.delete(kind);
      let st = null;
      try { st = stage(kind); } catch (e) { console.warn('item icon model failed', kind, e); }
      if (!st) { finish(kind, ''); continue; }                    // nothing to draw: costs no slot
      try {
        // The same view over black, then over white: their difference is the coverage (alpha).
        for (let i = 0; i < 2; i++) {
          const px = (x + i * S) / pr, sz = S / pr;
          renderer.setViewport(px, 0, sz, sz); renderer.setScissor(px, 0, sz, sz);
          renderer.setClearColor(i ? 0xffffff : 0x000000, 1);
          renderer.render(scene, camera);
        }
        jobs.push({ kind, x }); x += 2 * S;
      } catch (e) { console.warn('item icon render failed', kind, e); finish(kind, ''); }
      scene.remove(st.pivot);
      if (st.own) freeModel(st.model);
      if (performance.now() - t0 > budgetMs) break;
    }
  } finally {
    renderer.setClearColor(_cc, prevAlpha);
    renderer.toneMapping = prevTone; renderer.toneMappingExposure = prevExposure; renderer.outputColorSpace = prevSpace;
    renderer.setViewport(_vp); renderer.setScissor(_sc); renderer.setScissorTest(prevScissorTest);
    renderer.setRenderTarget(prevTarget);
  }
  if (!jobs.length) return;
  let data = null;
  try {
    // One read-back per frame for all icons drawn (the drawing buffer is intact within this task).
    if (!strip) strip = document.createElement('canvas');
    if (strip.width < x || strip.height < S) { strip.width = Math.max(strip.width, x); strip.height = Math.max(strip.height, S); }
    const sx = strip.getContext('2d', { willReadFrequently: true });
    sx.clearRect(0, 0, x, S);
    sx.drawImage(canvas, 0, H - S, x, S, 0, 0, x, S);
    data = sx.getImageData(0, 0, x, S).data;
  } catch (e) { console.warn('item icon read-back failed', e); }
  for (const j of jobs) encode(j.kind, data ? unmatte(data, x, j.x, S) : null);
}

// Black pass at x0, white pass at x0 + S: alpha = 1 - (white - black), colour = black / alpha.
function unmatte(src, stride, x0, S) {
  const img = new ImageData(S, S), out = img.data;
  for (let y = 0; y < S; y++) {
    let b = (y * stride + x0) * 4, w = b + S * 4, o = y * S * 4;
    for (let i = 0; i < S; i++, b += 4, w += 4, o += 4) {
      const a = 255 - ((src[w] - src[b]) + (src[w + 1] - src[b + 1]) + (src[w + 2] - src[b + 2])) / 3;
      if (a < 0.5) continue;                                        // transparent (already zero)
      const k = 255 / Math.min(255, a);
      out[o] = src[b] * k; out[o + 1] = src[b + 1] * k; out[o + 2] = src[b + 2] * k; out[o + 3] = a;
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d').putImageData(img, 0, 0);
  if (S === SIZE) return c;
  const d = document.createElement('canvas'); d.width = d.height = SIZE;
  const g = d.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, SIZE, SIZE);
  return d;
}

function finish(kind, url) {
  cache.set(kind, url);
  const w = waiters.get(kind); if (w) { waiters.delete(kind); for (const r of w) r(url || null); }
  if (url) for (const fn of listeners) { try { fn(kind, url); } catch (e) { console.error(e); } }
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
// Drained by renderIcons(renderer), which the game calls once per rendered frame.

/** Cached icon URL for kind, or null while it renders (it is queued; listeners fire when ready). */
export function iconURL(kind) {
  if (!kind) return null;
  const hit = cache.get(kind);
  if (hit !== undefined) return hit || null;
  if (failed) return null;
  if (!queued.has(kind) && !encoding.has(kind)) queued.add(kind);
  return null;
}
export const getItemIcon = iconURL;
/** Promise of the icon URL (null if it cannot be rendered, e.g. no DOM). */
export function loadItemIcon(kind) {
  const url = iconURL(kind);
  if (url || !kind || cache.has(kind) || failed) return Promise.resolve(url);
  return new Promise(r => { let w = waiters.get(kind); if (!w) waiters.set(kind, w = []); w.push(r); });
}
/** Queue several kinds ahead of time; first = true moves them to the front of the queue. */
export function warmIcons(kinds, first = false) {
  if (!first) { for (const k of kinds) iconURL(k); return; }
  const rest = [...queued]; queued.clear();
  for (const k of kinds) iconURL(k);
  for (const k of rest) queued.add(k);
}
/** Called with (kind, url) whenever an icon (re)renders. Returns an unsubscribe function. */
export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Swap the model source (e.g. hands.js buildItemModel). Re-renders every icon seen so far. */
export function setModelProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  const kinds = [...cache.keys(), ...encoding.keys()];
  cache.clear(); encoding.clear();
  warmIcons(kinds);
}
