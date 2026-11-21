// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background by a small dedicated WebGL renderer, copied to a 2D canvas and encoded off the main
// thread (toBlob) into a cached object URL. The renderer is created lazily, works through the queue
// only in idle time (several icons per idle slice while the title screen is up), and is released once
// the queue drains. Models come from setModelProvider(fn) (fn(kind) -> Object3D | null, e.g. models.js
// getModel; never disposed here) and fall back to the game's own procedural models.
// Public API: getItemIcon(kind) (sync, data URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), warmIcons, onIconReady, setModelProvider, ICON_KINDS.
// createItemIcons() is a small facade over the same shared cache ({get, prime, has, dispose}).
// null always means "use the SVG sprite" (unknown kind, no WebGL, model failure).
import * as T from './vendor/three.module.js';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { getModel as getLibraryModel } from './models.js?build=v3-survival-ae77fa84ac2b';
import { createSignalModel } from './signal-models.js?build=v3-survival-ae77fa84ac2b';
import { fitIconFrame } from './craft-book.js?build=v3-survival-ae77fa84ac2b';

const SIZE = 128;
// Every bag item kind; warmIcons(ICON_KINDS) renders the full set ahead of the first bag open.
export const ICON_KINDS = Object.freeze(['wood', 'leaf', 'plastic', 'scrap', 'rope', 'fish', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
// Item ids whose name differs from the models.js kind.
const MODEL_ALIAS = { fishingrod: 'rod' };
const RELEASE_MS = 2500;

const cache = new Map();   // kind -> object/data URL ('' = failed, use the SVG)
const queued = new Set();
const encoding = new Map(); // kind -> token while its PNG encodes
const listeners = new Set();
const waiters = new Map(); // kind -> [resolve] for loadItemIcon
let provider = null;
let gl = null, scene = null, camera = null, rimLight = null, envTarget = null, failed = false, releaseTimer = 0, pumping = false;

// Per-kind display pose (radians). AXIS_ANGLE items are then rolled onto the diagonal automatically
// (fitIconFrame), so for them a pose only picks which side faces the camera.
const POSE = {
  hook: [0, 0.7, -0.2], hammer: [0, -0.93, 0], fishingrod: [0, 0.3, -0.8],
  plastic: [0, 0.4, 0.5], fish: [0, -0.4, 0.15], rope: [0.9, 0, 0.2],
  wood: [0, -0.35, 0.12], leaf: [0.5, 0.4, 0], scrap: [0.3, 0.4, 0], receiver: [0, -0.5, 0],
  net: [0.55, 0.5, 0], bench: [0, 0.5, 0], crate: [0, 0.5, 0],
};
// Thin, dark tools get a brighter exposure so they read on the dark slot tiles.
const EXPOSURE = { hammer: 1.75, fishingrod: 1.75, hook: 1.35 };
// models.js tools stand upright (grip at origin, working end +Y): tilt them onto the diagonal.
const PROVIDER_POSE = { hook: [0, 0.5, -0.75] };
// Thin tools are drawn thicker across their long axis so they still read at 40 px.
const THICK = { fishingrod: 2.1, hook: 1.25, hammer: 1.2, metalhook: 1.25 };
// Extra room around the silhouette (fraction of the half size); the halo needs a little.
const PAD = { fishingrod: 0.08, hook: 0.08, hammer: 0.08 };
const HALO = 'rgba(255,246,226,0.55)';
// Screen angle (radians) a kind's long axis is rolled to: handheld, long items lie on the
// lower-left -> upper-right diagonal, a fish swims level. Other kinds keep the plain 3/4 view.
const D45 = Math.PI / 4;
const AXIS_ANGLE = { hook: D45, hammer: D45, fishingrod: D45, metalhook: D45, wood: D45, fish: 0 };

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
    case 'receiver': return createSignalModel(T, 'receiver'); // no flat drawing exists for it
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
    gl.outputColorSpace = T.SRGBColorSpace;
    gl.toneMapping = T.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.1;
  } catch (e) { failed = true; gl = null; console.warn('item icons: no WebGL, using flat icons', e); return false; }
  if (!scene) {
    scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xfff4dc, 0x6a5a48, 1.5));
    const key = new T.DirectionalLight(0xfff0d8, 2.5); key.position.set(3, 5, 4); scene.add(key);
    rimLight = new T.DirectionalLight(0xd8f0ff, 3.2); scene.add(rimLight);
    const fill = new T.DirectionalLight(0xbfe6ff, 0.8); fill.position.set(-4, 2, 3); scene.add(fill);
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }
  // Soft studio environment (per context) so metal parts reflect something instead of rendering black.
  if (!envTarget) {
    try {
      const envScene = new T.Scene();
      const geo = new T.SphereGeometry(5, 24, 12), cols = [], pos = geo.attributes.position;
      const top = new T.Color(0xfff3dc), mid = new T.Color(0xb9c8cc), low = new T.Color(0x5a4636), c = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 5;
        if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(low, -y);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
      const envMat = new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide });
      envScene.add(new T.Mesh(geo, envMat));
      const pmrem = new T.PMREMGenerator(gl);
      envTarget = pmrem.fromScene(envScene, 0.04);
      scene.environment = envTarget.texture;
      scene.environmentIntensity = 0.6;
      pmrem.dispose(); geo.dispose(); envMat.dispose();
    } catch (e) { console.warn('item icon environment', e); }
  }
  return true;
}

function release() {
  releaseTimer = 0;
  if (!gl) return;
  if (envTarget) { try { envTarget.dispose(); } catch {} envTarget = null; if (scene) scene.environment = null; }
  try { gl.dispose(); gl.forceContextLoss(); } catch {}
  gl = null;
}

const _box = new T.Box3(), _sphere = new T.Sphere(), _v = new T.Vector3(), _dir = new T.Vector3(1, 0.85, 1.35).normalize();
const _m = new T.Matrix4();
const MAX_POINTS = 6000;

// Camera-space (x, y) of the model's vertices (strided past MAX_POINTS), for framing the icon on the
// real silhouette rather than the loose box of a diagonal tool. Instanced meshes use their box corners.
function silhouettePoints(root) {
  const meshes = [];
  let total = 0;
  root.traverse(o => { if (o.isMesh && o.visible !== false && o.geometry?.attributes?.position) { meshes.push(o); total += o.geometry.attributes.position.count; } });
  const stride = Math.max(1, Math.ceil(total / MAX_POINTS)), out = [];
  for (const o of meshes) {
    _m.multiplyMatrices(camera.matrixWorldInverse, o.matrixWorld);
    if (o.isInstancedMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox, im = new T.Matrix4();
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, im); im.premultiply(_m);
        for (let i = 0; i < 8; i++) { _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(im); out.push(_v.x, _v.y); }
      }
      continue;
    }
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) { _v.fromBufferAttribute(pos, i).applyMatrix4(_m); out.push(_v.x, _v.y); }
  }
  return out;
}

// The model in a wrapper group, plus the wrapper-local axis its bounding box is longest along.
// Thin tools read as hairlines at 40 px, so with k > 1 the wrapper draws them thicker across that axis.
function wrapModel(model, k = 1) {
  const wrap = new T.Group();
  wrap.add(model);
  wrap.updateMatrixWorld(true);
  _box.setFromObject(wrap, true);
  const axis = new T.Vector3(0, 1, 0);
  if (_box.isEmpty()) return { wrap, axis };
  const s = _box.getSize(_v), a = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
  axis.set(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0);
  if (k !== 1) wrap.scale.set(a === 'x' ? 1 : k, a === 'y' ? 1 : k, a === 'z' ? 1 : k);
  return { wrap, axis };
}

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

function renderKind(kind) {
  if (!ensureGL()) return null;
  const { model, own } = resolveIconModel(kind);
  if (!model) return null;
  const pivot = new T.Group();
  const { wrap, axis } = wrapModel(model, THICK[kind] || 1);
  pivot.add(wrap);
  const p = (own ? null : PROVIDER_POSE[kind]) || POSE[kind]; if (p) pivot.rotation.set(p[0], p[1], p[2]);
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) { if (own) freeModel(model); return null; }
  _box.getBoundingSphere(_sphere);
  pivot.position.sub(_sphere.center);
  pivot.updateMatrixWorld(true);
  // Orthographic 3/4 view, rolled so long tools lie on the diagonal, framed on the projected silhouette.
  const r = _sphere.radius;
  camera.position.copy(_dir).multiplyScalar(r * 4);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  // A handheld item's main axis is its model's long axis (a hammer's handle), as seen by the camera.
  axis.transformDirection(wrap.matrixWorld).transformDirection(camera.matrixWorldInverse);
  const want = AXIS_ANGLE[kind], roll = want != null && Math.hypot(axis.x, axis.y) > 0.2;
  const f = fitIconFrame(silhouettePoints(pivot), { pad: PAD[kind] ?? 0.12, long: roll ? 1.2 : Infinity, diag: roll ? want : undefined, axis: roll ? Math.atan2(axis.y, axis.x) : undefined })
    || { roll: 0, cx: 0, cy: 0, half: r };
  if (f.roll) {
    camera.rotateZ(-f.roll);
    camera.updateMatrixWorld(true);
  }
  camera.left = f.cx - f.half; camera.right = f.cx + f.half; camera.top = f.cy + f.half; camera.bottom = f.cy - f.half;
  camera.near = r; camera.far = r * 7;
  camera.updateProjectionMatrix();
  // Rim light from behind the item, opposite the camera, so dark edges separate from dark tiles.
  rimLight.position.copy(_dir).multiplyScalar(-4).add(_v.set(0, 3, 0));
  scene.add(pivot);
  gl.toneMappingExposure = EXPOSURE[kind] || 1.1;
  let out = null;
  try {
    gl.render(scene, camera);
    out = document.createElement('canvas'); out.width = out.height = SIZE;
    const c2 = out.getContext('2d');
    // Soft light halo around the silhouette (drawn under the item), then the item itself.
    c2.shadowColor = HALO; c2.shadowBlur = 5;
    c2.drawImage(gl.domElement, 0, 0);
    c2.shadowColor = 'transparent'; c2.shadowBlur = 0;
    c2.drawImage(gl.domElement, 0, 0);                          // GPU copy; the PNG encode happens later, async
  } catch (e) { out = null; console.warn('item icon render failed', kind, e); }
  scene.remove(pivot);
  if (own) freeModel(model);
  return out;
}

function finish(kind, url) {
  const old = cache.get(kind);
  if (!url && old) url = old;                        // a failed re-render keeps the icon it had
  else if (old && old !== url && old.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old), 5000); // after the DOM swapped
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
// Icons already made stay on screen until their re-render is ready, then swap once (no flash back to
// the flat sprite, no two different looks in a row).
export function setModelProvider(fn) {
  const next = typeof fn === 'function' ? fn : null;
  if (next === provider) return;
  provider = next;
  const kinds = [...cache.keys(), ...encoding.keys()];
  encoding.clear();
  for (const k of kinds) queued.add(k);
  if (queued.size && !failed) schedule();
}

/** Facade over the shared cache, e.g. for callers that want an object: get(kind) is sync (null while rendering). */
export function createItemIcons() {
  return {
    get: kind => iconURL(String(kind ?? '')),
    load: kind => loadItemIcon(String(kind ?? '')),
    prime: (kinds = ICON_KINDS) => warmIcons([...kinds]),
    has: kind => cache.has(String(kind ?? '')),
    onReady: onIconReady,
    dispose() {},
  };
}
export default createItemIcons;
