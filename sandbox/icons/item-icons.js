// Little Raft item icons: each item kind is rendered ONCE as a lit 3/4 view on a transparent
// background by a small dedicated WebGL renderer, then cached as a PNG data URL.
// The renderer is created lazily, works through a queue in idle time, and is released once the
// queue drains. Model sources, first hit wins:
//   1. item-icon-models.js ICON_MODELS: icon-only stand-ins for kinds whose world model does not
//      read at 40 px (thick held tools, log pile, lantern without post, light net, nails, ...);
//   2. setModelProvider(fn) (fn(kind) -> Object3D | null, e.g. models.js getModel; never disposed here);
//   3. the game's own procedural builders (buildFallbackModel).
// A kind with no model, or whose render comes out blank, stays null and the UI keeps its SVG.
// Thin dark tools (ICON_MODELS look.rim) get a light cream rim so they read on the dark slots; that is
// a 2D-canvas pass (no extra GL program). Every other icon is encoded straight from the GL canvas: a
// dark navy outline was invisible on the navy slots and cost a second readback per icon.
// Public API: getItemIcon(kind) (sync, data URL or null while rendering / without WebGL),
// loadItemIcon(kind) (Promise of the same), warmIcons, onIconReady, setModelProvider.
import * as T from './vendor/three.module.js';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { ICON_MODELS } from './item-icon-models.js?build=v3-survival-ae77fa84ac2b';

const SIZE = 128;
const MARGIN = 7;              // px kept clear around the art for the rim
const RIM_PX = 3.5;
const RIM = 'rgba(246,230,196,0.85)';   // cream, reads on the navy slots
// A 128 px PNG with (almost) nothing drawn encodes to a few hundred bytes; the smallest real icon
// (thin nail) is several KB. Checking the URL length detects a blank render without a pixel readback.
const BLANK_URL_LEN = 1500;
const METAL_CAP = 0.35;        // no env map in the icon rig: capped metal still reads as metal, not black
// Item ids whose name differs from the models.js kind.
const MODEL_ALIAS = { fishingrod: 'rod' };
const RELEASE_MS = 2500;
const MAX_LOST = 2;            // context-loss retries per kind

const cache = new Map();   // kind -> data URL ('' = no icon, use the SVG)
const source = new Map();  // kind -> 'own' | 'provider' | 'fallback' | 'none'
const queued = new Set();
const listeners = new Set();
const waiters = new Map(); // kind -> [resolve] for loadItemIcon
const lost = new Map();    // kind -> context losses seen
let provider = null;
let gl = null, scene = null, camera = null, failed = false, releaseTimer = 0, pumping = false;
let out = null, tmp = null;

// Hot swap (live.js) loads a new build's copy of this module next to the old one. Only one copy runs
// the idle queue (one GL context at a time): the copy that claimed last (setModelProvider / iconURL)
// among those still in use, i.e. with listeners or waiters. A copy whose engine is gone has neither:
// the new engine's dispose() on a failed mount() drops the new copy's listeners, so the old copy owns
// the queue again; on a successful swap the old engine's dispose() drops the old copy's listeners.
// If no copy is in use, the last claimer owns it.
const REG_KEY = '__littleRaftItemIconsCopies';
const SELF = { seq: 0, live: () => listeners.size > 0 || waiters.size > 0 };
function registry() {
  try { return globalThis[REG_KEY] || (globalThis[REG_KEY] = { seq: 0, copies: [] }); } catch { return null; }
}
function claim() {
  const r = registry(); if (!r) return;
  SELF.seq = ++r.seq;
  if (!r.copies.includes(SELF)) r.copies.push(SELF);
}
function owner() {
  const r = registry(); if (!r) return null;
  let best = null, bestLive = null;
  for (const c of r.copies) {
    if (!best || c.seq > best.seq) best = c;
    if (c.live() && (!bestLive || c.seq > bestLive.seq)) bestLive = c;
  }
  return bestLive || best;
}
function superseded() { try { const o = owner(); return !!o && o !== SELF; } catch { return false; } }

// Per-kind display pose (radians) for provider / fallback models, so long tools read diagonally.
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
  for (const u of standIns) { try { u.dispose(); } catch {} }
  standIns = new Set(); unified = new WeakMap();
  if (!gl) return;
  try { gl.dispose(); gl.forceContextLoss(); } catch {}
  gl = null;
}

const _box = new T.Box3(), _sphere = new T.Sphere(), _v = new T.Vector3();
const DIR_3Q = new T.Vector3(1, 0.85, 1.35).normalize(), DIR_FRONT = new T.Vector3(0, 0, 1), DEG = Math.PI / 180;

function freeModel(root) {
  root.traverse(o => {
    if (!o.geometry?.userData?.shared) o.geometry?.dispose();
    const m = o.material; if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x && !shared.has(x) && !x.userData?.shared) { for (const v of Object.values(x)) if (v?.isTexture) v.dispose(); x.dispose(); }
  });
}

// Shader-compile budget: every distinct material flag set is its own GL program, compiled inside an
// idle slice on first use (the stall lands in whatever frame reads the canvas back). For the render
// only, each mesh gets a MeshStandardMaterial with the same uniforms (color, roughness, capped
// metalness, emissive, opacity) and almost one flag set: DoubleSide + vertexColors (models this module
// owns get a white color attribute where they lack one; models.js meshes all have colors), maps
// dropped (wood grain is invisible at 40 px), flatShading kept. That is 1-2 lit programs for all 34
// kinds. Provider / shared materials and geometry are never mutated. Stand-ins live until the
// renderer is released: disposing one per icon would drop its program (three frees a program with
// its last material) and the next icon would compile it again.
let unified = new WeakMap(), standIns = new Set();
function standIn(m, vc) {
  let byVc = unified.get(m); if (!byVc) unified.set(m, byVc = {});
  if (byVc[vc]) return byVc[vc];
  const u = new T.MeshStandardMaterial({
    color: m.color ? m.color.clone() : 0xffffff, roughness: m.roughness ?? 0.8,
    metalness: Math.min(m.metalness ?? 0, METAL_CAP),
    emissive: m.emissive ? m.emissive.clone() : 0, emissiveIntensity: m.emissiveIntensity ?? 1,
    transparent: !!m.transparent, opacity: m.opacity ?? 1, depthWrite: m.depthWrite !== false,
    flatShading: !!m.flatShading, side: T.DoubleSide, vertexColors: vc,
  });
  standIns.add(u);
  return byVc[vc] = u;
}
function unify(root, own) {
  const undo = [];
  const conv = (m, vc) => (!m || m.isShaderMaterial ? m : standIn(m, vc));
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const g = o.geometry;
    if (own && g?.attributes?.position && !g.attributes.color && !g.userData?.shared)
      g.setAttribute('color', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    const vc = !!g?.attributes?.color;
    undo.push([o, o.material]);
    o.material = Array.isArray(o.material) ? o.material.map(m => conv(m, vc)) : conv(o.material, vc);
  });
  return () => { for (const [o, m] of undo) o.material = m; };
}

function pickModel(kind) {
  const own = ICON_MODELS[kind];
  if (own) { try { const m = own.make(T); if (m) return { model: m, src: 'own', entry: own }; } catch (e) { console.warn('item icon model failed', kind, e); } }
  if (provider) {
    try { const m = provider(MODEL_ALIAS[kind] || kind) || provider(kind) || null; if (m) return { model: m, src: 'provider' }; }
    catch (e) { console.warn('item icon provider failed', kind, e); }
  }
  try { const m = buildFallbackModel(kind); if (m) return { model: m, src: 'fallback' }; } catch (e) { console.warn('item icon model failed', kind, e); }
  return null;
}

// Encodes the rendered icon (cream rim around the silhouette for thin dark tools). Returns null for a
// blank render (empty model, lost context): the UI keeps its SVG.
function compose(src, rim) {
  let url;
  if (!rim) url = src.toDataURL('image/png');
  else {
    if (!out) {
      out = document.createElement('canvas'); out.width = out.height = SIZE;
      tmp = document.createElement('canvas'); tmp.width = tmp.height = SIZE;
    }
    const o = out.getContext('2d'), t = tmp.getContext('2d');
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, SIZE, SIZE); t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'source-in'; t.fillStyle = RIM; t.fillRect(0, 0, SIZE, SIZE);
    o.clearRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 16; i++) {
      const ang = i * Math.PI / 8;
      o.drawImage(tmp, Math.cos(ang) * RIM_PX, Math.sin(ang) * RIM_PX);
      o.drawImage(tmp, Math.cos(ang) * RIM_PX * 0.5, Math.sin(ang) * RIM_PX * 0.5);
    }
    o.drawImage(src, 0, 0);
    url = out.toDataURL('image/png');
  }
  return url.length < BLANK_URL_LEN ? null : url;
}

// Renders one kind. Returns a data URL, '' (no icon: keep the SVG) or null (context lost: retry).
function renderKind(kind) {
  if (!ensureGL()) return '';
  const pick = pickModel(kind);
  if (!pick) { source.set(kind, 'none'); return ''; }
  const { model, src, entry } = pick, own = src !== 'provider';
  source.set(kind, src);
  const pivot = new T.Group();
  pivot.add(model);
  let dir = DIR_3Q;
  if (entry) {
    const p = entry.pose || {};
    pivot.rotation.set((p.pitch ?? 20) * DEG, (p.yaw ?? -35) * DEG, (p.roll ?? 0) * DEG, 'ZXY');
    dir = DIR_FRONT;
  } else {
    const p = (own ? null : PROVIDER_POSE[kind]) || POSE[kind]; if (p) pivot.rotation.set(p[0], p[1], p[2]);
  }
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) { if (own) freeModel(model); return ''; }
  _box.getBoundingSphere(_sphere);
  pivot.position.sub(_sphere.center);
  _box.translate(_v.copy(_sphere.center).negate());
  // Orthographic view framed tightly on the item's projected bounds, so long tools fill the slot.
  const r = _sphere.radius;
  camera.position.copy(dir).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).applyMatrix4(camera.matrixWorldInverse);
    x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) * 0.5 * 1.04 * SIZE / (SIZE - 2 * MARGIN), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
  camera.near = r; camera.far = r * 7;
  camera.updateProjectionMatrix();
  const undo = unify(pivot, own);
  scene.add(pivot);
  let url = '';
  try {
    gl.render(scene, camera);
    if (gl.getContext().isContextLost()) url = null;
    else url = compose(gl.domElement, !!entry?.look?.rim) || '';
  } catch (e) { console.warn('item icon render failed', kind, e); url = ''; }
  scene.remove(pivot);
  undo();
  if (own) freeModel(model);
  return url;
}

// ---------- queue ----------
const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 120 }) : cb => setTimeout(cb, 16);

function settle(kind, url) {
  const w = waiters.get(kind); if (w) { waiters.delete(kind); for (const r of w) r(url || null); }
}
function shutdown() {   // superseded by a newer copy of this module (hot swap)
  const kinds = [...queued]; queued.clear();
  for (const k of kinds) settle(k, null);
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  release();
}

function pump() {
  pumping = false;
  if (superseded()) { shutdown(); return; }
  const it = queued.values().next();
  if (it.done) return;
  const kind = it.value;
  queued.delete(kind);
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
  let url = renderKind(kind);
  if (url === null) {   // GL context lost mid-render: drop the context and retry the kind later
    release();
    const n = (lost.get(kind) || 0) + 1; lost.set(kind, n);
    if (n <= MAX_LOST) { queued.add(kind); schedule(); return; }
    url = '';
  }
  cache.set(kind, url);
  settle(kind, url);
  if (url) for (const fn of listeners) { try { fn(kind, url); } catch (e) { console.error(e); } }
  if (queued.size) schedule();
  else if (gl) releaseTimer = setTimeout(release, RELEASE_MS);
}
function schedule() { if (!pumping) { pumping = true; idle(pump); } }

/** Cached icon URL for kind, or null while it renders (it is queued; listeners fire when ready). */
export function iconURL(kind) {
  if (!kind) return null;
  const hit = cache.get(kind);
  if (hit !== undefined) return hit || null;
  if (failed || superseded()) return null;
  claim();
  if (!queued.has(kind)) { queued.add(kind); schedule(); }
  return null;
}
export const getItemIcon = iconURL;
/** Promise of the icon URL (null if it cannot be rendered, e.g. no WebGL). */
export function loadItemIcon(kind) {
  const url = iconURL(kind);
  if (url || !kind || cache.has(kind) || failed || !queued.has(kind)) return Promise.resolve(url);
  return new Promise(r => { let w = waiters.get(kind); if (!w) waiters.set(kind, w = []); w.push(r); });
}
/** Queue several kinds ahead of time (one render per idle slice). */
export function warmIcons(kinds) { for (const k of kinds) iconURL(k); }
/** Called with (kind, url) whenever an icon (re)renders. Returns an unsubscribe function. */
export function onIconReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Swap the model source (e.g. models.js getModel). Re-renders every icon seen so far that did not
 *  come from ICON_MODELS (those do not depend on the provider). */
export function setModelProvider(fn) {
  provider = typeof fn === 'function' ? fn : null;
  claim();
  const kinds = [...cache.keys()].filter(k => source.get(k) !== 'own');
  for (const k of kinds) { cache.delete(k); source.delete(k); }
  warmIcons(kinds);
}
