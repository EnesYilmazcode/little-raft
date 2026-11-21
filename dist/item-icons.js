// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background by a small dedicated WebGL renderer, copied to a 2D canvas and encoded off the main
// thread (toBlob) into a cached object URL. The renderer is created lazily, works through the queue
// only in idle time (several icons per idle slice while the title screen is up), and is released once
// the queue drains. Models come from setModelProvider(fn) (fn(kind) -> Object3D | null, e.g. models.js
// getModel; never disposed here) and fall back to the game's own procedural models.
// Public API: getItemIcon(kind) (sync, data URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), warmIcons, onIconReady, setModelProvider.
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
const RELEASE_MS = 2500;

const cache = new Map();   // kind -> object/data URL ('' = failed, use the SVG)
const queued = new Set();
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
  if (!scene) {
    scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xfff3dc, 0x3b2a1a, 1.5));
    const key = new T.DirectionalLight(0xfff0d8, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const rim = new T.DirectionalLight(0x9fd8ff, 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }
  return true;
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

// Renders kind and returns a 2D canvas copy of the pixels (null when it cannot be drawn).
function renderKind(kind) {
  if (!ensureGL()) return null;
  let model = null, own = false;
  if (provider) { try { model = provider(MODEL_ALIAS[kind] || kind) || provider(kind) || null; } catch (e) { console.warn('item icon provider failed', kind, e); } }
  if (!model) { try { model = buildFallbackModel(kind); own = true; } catch (e) { console.warn('item icon model failed', kind, e); } }
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
  let out = null;
  try {
    gl.render(scene, camera);
    out = document.createElement('canvas'); out.width = out.height = SIZE;
    out.getContext('2d').drawImage(gl.domElement, 0, 0);       // GPU copy; the PNG encode happens later, async
  } catch (e) { out = null; console.warn('item icon render failed', kind, e); }
  scene.remove(pivot);
  if (own) freeModel(model);
  return out;
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
// Idle time only (the timeout is a late fallback for a page that never idles): no icon work lands in a busy frame.
const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 1500 }) : cb => setTimeout(() => cb(null), 16);
const SLICE_MS = 8;

function pump(deadline) {
  pumping = false;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  const t0 = performance.now();
  // At least one icon per callback; more while the slice has room (cheap once the shaders exist).
  do {
    const it = queued.values().next();
    if (it.done) break;
    const kind = it.value;
    queued.delete(kind);
    encode(kind, renderKind(kind));
  } while (queued.size && (deadline ? !deadline.didTimeout && deadline.timeRemaining() > SLICE_MS : performance.now() - t0 < 4));
  if (queued.size) schedule();
  else if (gl) releaseTimer = setTimeout(release, RELEASE_MS);
}
function schedule() { if (!pumping) { pumping = true; idle(pump); } }

/** Cached icon URL for kind, or null while it renders (it is queued; listeners fire when ready). */
export function iconURL(kind) {
  if (!kind) return null;
  const hit = cache.get(kind);
  if (hit !== undefined) return hit || null;
  if (failed) return null;
  if (!queued.has(kind) && !encoding.has(kind)) { queued.add(kind); schedule(); }
  return null;
}
export const getItemIcon = iconURL;
/** Promise of the icon URL (null if it cannot be rendered, e.g. no WebGL). */
export function loadItemIcon(kind) {
  const url = iconURL(kind);
  if (url || !kind || cache.has(kind) || failed) return Promise.resolve(url);
  return new Promise(r => { let w = waiters.get(kind); if (!w) waiters.set(kind, w = []); w.push(r); });
}
/** Queue several kinds ahead of time (rendered in idle slices). */
export function warmIcons(kinds) { for (const k of kinds) iconURL(k); }
/** Called with (kind, url) whenever an icon (re)renders. Returns an unsubscribe function. */
export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Swap the model source (e.g. hands.js buildItemModel). Re-renders every icon seen so far. */
export function setModelProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  const kinds = [...cache.keys(), ...encoding.keys()];
  cache.clear(); encoding.clear();
  warmIcons(kinds);
}
