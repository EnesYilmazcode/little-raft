// Little Raft item icons: renders each item's real Three.js model once to a small offscreen canvas
// and caches the PNG data URL. One short-lived WebGL context per batch; it is released right after.
// Usage: const icons = createItemIcons(THREE); icons.get('hammer') -> 'data:image/png;...' | null.
// null (unknown kind, no WebGL, model failure) means the caller should fall back to an SVG icon.
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';

const DECOR = new Set(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
export const ICON_KINDS = Object.freeze(['wood', 'leaf', 'plastic', 'scrap', 'rope', 'fish', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate']);

// Small procedural stand-ins for items that have no world model of their own.
function ropeCoil(T) {
  const g = new T.Group();
  const m = new T.MeshStandardMaterial({ color: 0xb58a55, roughness: 0.95 });
  const dark = new T.MeshStandardMaterial({ color: 0x8a6640, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const t = new T.Mesh(new T.TorusGeometry(0.34 - i * 0.012, 0.055, 10, 40), i % 2 ? dark : m);
    t.rotation.x = Math.PI / 2; t.position.y = i * 0.09; g.add(t);
  }
  const tail = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([
    new T.Vector3(0.33, 0.27, 0), new T.Vector3(0.45, 0.2, 0.15), new T.Vector3(0.5, 0.02, 0.32)]), 16, 0.05, 8), m);
  g.add(tail);
  return g;
}
function fishModel(T) {
  const g = new T.Group();
  const body = new T.MeshStandardMaterial({ color: 0x6aa6b4, roughness: 0.45, metalness: 0.2 });
  const belly = new T.MeshStandardMaterial({ color: 0xe8e0c4, roughness: 0.6 });
  const fin = new T.MeshStandardMaterial({ color: 0x3f7b8c, roughness: 0.6, side: T.DoubleSide });
  const b = new T.Mesh(new T.SphereGeometry(0.3, 24, 16), body); b.scale.set(1.6, 0.85, 0.5); g.add(b);
  const u = new T.Mesh(new T.SphereGeometry(0.28, 24, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), belly); u.scale.set(1.55, 0.8, 0.48); g.add(u);
  const tail = new T.Mesh(new T.ConeGeometry(0.22, 0.32, 3), fin); tail.rotation.z = Math.PI / 2; tail.scale.z = 0.25; tail.position.x = -0.58; g.add(tail);
  const top = new T.Mesh(new T.ConeGeometry(0.12, 0.22, 3), fin); top.scale.z = 0.2; top.position.set(0.02, 0.27, 0); g.add(top);
  const eye = new T.Mesh(new T.SphereGeometry(0.04, 10, 8), new T.MeshStandardMaterial({ color: 0x14232a, roughness: 0.2 }));
  eye.position.set(0.33, 0.06, 0.13); g.add(eye);
  return g;
}

function buildModel(T, kind, mat) {
  if (DECOR.has(kind)) return createCraft(T, kind);
  if (kind === 'hook') return createHook(T);
  if (kind === 'hammer') { const g = createHammer(T); g.rotation.z = -0.6; return g; }
  if (kind === 'fishingrod') { const g = createFishingTool(T); g.rotation.z = -0.75; return g; }
  if (kind === 'plastic') return createPlastic(T);
  if (kind === 'wood' || kind === 'leaf' || kind === 'scrap') return createDebris(T, kind, mat, { seed: 11 });
  if (kind === 'rope') return ropeCoil(T);
  if (kind === 'fish') return fishModel(T);
  return null;
}

// Per-kind view tweaks: [yaw, pitch] of the camera direction.
const VIEW = { net: [0.6, 0.95], wood: [0.7, 0.75], leaf: [0.5, 0.9], scrap: [0.6, 0.7], rope: [0.4, 0.65], fish: [0.0, 0.15], hook: [-0.35, 0.15], hammer: [1.2, 0.2], fishingrod: [0.6, 0.1] };

function disposeTree(o) {
  const mats = new Set();
  o.traverse(c => {
    try { c.geometry?.dispose(); } catch {}
    for (const m of [].concat(c.material || [])) mats.add(m);
  });
  for (const m of mats) { try { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); } catch {} }
}

export function createItemIcons(T, { size = 96 } = {}) {
  const cache = new Map(); // kind -> dataURL | null
  let failed = false;

  function renderBatch(kinds) {
    const todo = kinds.filter(k => !cache.has(k));
    if (!todo.length) return;
    if (failed || typeof document === 'undefined') { for (const k of todo) cache.set(k, null); return; }
    let renderer = null, envTarget = null;
    const shared = new Map();
    const mat = color => { if (!shared.has(color)) shared.set(color, new T.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 })); return shared.get(color); };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.5;
      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xfff4dc, 0x6a5a48, 2.4));
      const key = new T.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
      const rim = new T.DirectionalLight(0xbfe6ff, 1.4); rim.position.set(-4, 2, -3); scene.add(rim);
      // Soft studio environment so metal parts reflect something instead of rendering black.
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
        const pmrem = new T.PMREMGenerator(renderer);
        envTarget = pmrem.fromScene(envScene, 0.04);
        scene.environment = envTarget.texture;
        scene.environmentIntensity = 0.9;
        pmrem.dispose(); geo.dispose(); envMat.dispose();
      } catch (e) { console.warn('icon environment', e); }
      const cam = new T.PerspectiveCamera(28, 1, 0.01, 100);
      const box = new T.Box3(), sphere = new T.Sphere(), dir = new T.Vector3();
      for (const kind of todo) {
        let model = null, url = null;
        try {
          model = buildModel(T, kind, mat);
          if (model) {
            const holder = new T.Group(); holder.add(model); scene.add(holder);
            holder.updateMatrixWorld(true);
            box.setFromObject(holder); box.getBoundingSphere(sphere);
            const [yaw, pitch] = VIEW[kind] || [0.65, 0.42];
            dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
            const dist = sphere.radius / Math.sin((cam.fov * Math.PI / 180) / 2) * 0.92;
            cam.position.copy(sphere.center).addScaledVector(dir, dist);
            cam.near = Math.max(0.01, dist - sphere.radius * 2); cam.far = dist + sphere.radius * 2;
            cam.updateProjectionMatrix(); cam.lookAt(sphere.center);
            renderer.render(scene, cam);
            url = canvas.toDataURL('image/png');
            scene.remove(holder);
          }
        } catch (e) { console.warn('item icon failed', kind, e); url = null; }
        if (model) disposeTree(model);
        cache.set(kind, url);
      }
    } catch (e) {
      console.warn('item icons unavailable', e);
      failed = true;
      for (const k of todo) if (!cache.has(k)) cache.set(k, null);
    } finally {
      for (const m of shared.values()) m.dispose();
      if (envTarget) envTarget.dispose();
      if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch {} }
    }
  }

  return {
    get(kind) { const k = String(kind ?? ''); if (!cache.has(k)) renderBatch(ICON_KINDS.includes(k) ? ICON_KINDS : [k]); return cache.get(k) ?? null; },
    prime(kinds = ICON_KINDS) { renderBatch([...kinds]); },
    has(kind) { return cache.has(String(kind)); },
    dispose() { cache.clear(); },
  };
}

export default createItemIcons;
