// Item kind -> 3D model + icon pose, for baking inventory icons from the game's own models.
// Every kind in ITEM_INFO (dist/inventory-state.js) has an entry. Twelve use the existing dist
// builders; fish and rope have no world model yet, so two small procedural ones live here.
//
// makeIconItems(T, getMaterial) -> [{ kind, make: () => Object3D, pose, dispose(obj) }]
//   getMaterial(color) is the engine's shared material cache (game.js `mat`). Materials it hands
//   out are never disposed here; everything else a model creates is.
import { createHook } from '../../dist/hook.js';
import { createHammer } from '../../dist/hammer.js';
import { createFishingTool } from '../../dist/fishing-tool.js';
import { createPlastic } from '../../dist/plastic.js';
import { createCraft } from '../../dist/crafts.js';
import { createDebris } from '../../dist/debris.js';
import { bakeIconAtlas } from './icon-atlas.js';

// Engine entry point: bake every kind once, return { kind: dataURL }.
// build is the ?build= id; with a real build id the PNGs are cached in localStorage under it.
export async function bakeItemIcons(T, renderer, getMaterial, build = 'dev', kinds = null) {
  const items = makeIconItems(T, getMaterial).filter(it => !kinds || kinds.includes(it.kind));
  const res = await bakeIconAtlas(T, renderer, items, { cacheKey: build && build !== 'dev' ? build : '' });
  // data: URLs are what gets cached; hand the DOM short blob: URLs so innerHTML stays small.
  const out = {};
  for (const [k, u] of Object.entries(res.urls)) {
    try {
      const bin = atob(u.slice(u.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out[k] = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    } catch { out[k] = u; }
  }
  return out;
}

// Icon pose per kind (degrees, applied in ZXY order with the camera fixed on +Z).
// Long tools lie on the diagonal, handle bottom-left (Raft / Minecraft convention);
// placeables get a 3/4 view from slightly above; flat items are tipped up so their face reads.
export const ICON_POSES = {
  wood:       { yaw: 0,   pitch: 55,  roll: 35, pad: 1.04 },
  leaf:       { yaw: 90,   pitch: 75,  roll: 45 },
  plastic:    { yaw: -30, pitch: 15,  roll: -8 },
  scrap:      { yaw: -20, pitch: 55,  roll: 10 },
  rope:       { yaw: 0,   pitch: 55,  roll: 0 },
  fish:       { yaw: -15, pitch: 10,  roll: 35 },
  hook:       { yaw: -70, pitch: 10,  roll: -35, pad: 1.02 },
  hammer:     { yaw: -60, pitch: 15,  roll: -40, pad: 1.02 },
  fishingrod: { yaw: -20, pitch: 10,  roll: -45, pad: 1.0 },
  sail:       { yaw: -20, pitch: 12 },
  palm:       { yaw: -35, pitch: 20 },
  lantern:    { yaw: -30, pitch: 15 },
  net:        { yaw: -35, pitch: 50 },
  bench:      { yaw: -35, pitch: 25 },
  crate:      { yaw: -35, pitch: 25 },
};

// Braided rope coil: a thick tube wound three times, with a helical light/dark stripe in vertex
// colors (same tans as dist/rope.js) and a loose end.
function createRopeCoil(T) {
  const pts = [];
  const turns = 2.6, n = 120;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2;
    const r = 0.30 - 0.035 * Math.sin(t * Math.PI);
    pts.push(new T.Vector3(Math.cos(a) * r, (t - 0.5) * 0.16, Math.sin(a) * r * 0.92));
  }
  const last = pts[pts.length - 1];
  pts.push(new T.Vector3(last.x + 0.12, last.y - 0.02, last.z + 0.14), new T.Vector3(last.x + 0.22, last.y - 0.06, last.z + 0.32));
  const curve = new T.CatmullRomCurve3(pts);
  const tubular = 260, radial = 10;
  const geo = new T.TubeGeometry(curve, tubular, 0.055, radial, false);
  const light = new T.Color('#d9a76a'), dark = new T.Color('#6b4a2b'), c = new T.Color();   // icons.svg rope tans
  const col = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i <= tubular; i++) for (let j = 0; j <= radial; j++) {
    const k = i * (radial + 1) + j;
    const s = 0.5 + 0.5 * Math.sin(i * 1.6 + (j / radial) * Math.PI * 2 * 2);
    c.copy(dark).lerp(light, Math.pow(s, 0.6));
    col.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  const m = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  const g = new T.Group(); g.name = 'ropeCoil'; g.add(m);
  return g;
}

// Simple caught fish: ellipsoid body with a dark back / pale belly gradient, tail, fins, eye.
function createFishModel(T) {
  const g = new T.Group(); g.name = 'fish';
  const body = new T.SphereGeometry(0.5, 32, 18);
  const p = body.attributes.position, col = new Float32Array(p.count * 3);
  const back = new T.Color('#2f6f86'), belly = new T.Color('#e9e2c6'), mid = new T.Color('#5fa7b4'), c = new T.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const taper = x < 0 ? 1 - 0.55 * Math.pow(-x / 0.5, 1.6) : 1 - 0.15 * Math.pow(x / 0.5, 2);
    p.setXYZ(i, x * 1.0, y * 0.42 * taper, z * 0.2 * taper);
    const t = y / 0.5;
    if (t > 0) c.copy(mid).lerp(back, Math.min(1, t * 1.4)); else c.copy(mid).lerp(belly, Math.min(1, -t * 1.8));
    col.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new T.BufferAttribute(col, 3));
  body.computeVertexNormals();
  const skin = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
  g.add(new T.Mesh(body, skin));
  const finMat = new T.MeshStandardMaterial({ color: '#2c6377', roughness: 0.7, side: T.DoubleSide });
  const fin = (pts, z = 0) => {
    const s = new T.Shape(); s.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
    const geo = new T.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }); geo.translate(0, 0, z - 0.01);
    const m = new T.Mesh(geo, finMat); g.add(m); return m;
  };
  fin([-0.42, 0, -0.72, 0.22, -0.66, 0, -0.72, -0.22]);      // tail
  fin([-0.12, 0.17, 0.02, 0.33, 0.14, 0.2]);                // dorsal
  fin([-0.05, -0.17, 0.08, -0.27, 0.12, -0.16]);            // belly
  const eyeW = new T.MeshStandardMaterial({ color: '#f4f1e6', roughness: 0.3 });
  const eyeB = new T.MeshStandardMaterial({ color: '#10181c', roughness: 0.2 });
  for (const s of [1, -1]) {
    const e = new T.Mesh(new T.SphereGeometry(0.045, 12, 8), eyeW); e.position.set(0.3, 0.05, 0.075 * s); g.add(e);
    const pu = new T.Mesh(new T.SphereGeometry(0.026, 10, 8), eyeB); pu.position.set(0.315, 0.055, 0.1 * s); g.add(pu);
  }
  // gill line
  const gill = new T.Mesh(new T.TorusGeometry(0.15, 0.008, 4, 16, Math.PI * 0.7), eyeB);
  gill.position.set(0.24, -0.01, 0); gill.rotation.set(0, 0, Math.PI * 0.65); gill.scale.set(1, 1, 0.9);
  const gl = gill.clone(); gill.position.z = 0.085; gl.position.set(0.24, -0.01, -0.085); g.add(gill, gl);
  return g;
}

function disposeTree(o, keep) {
  o.traverse(n => {
    n.geometry?.dispose();
    for (const m of [].concat(n.material || [])) {
      if (keep.has(m)) continue;
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

export function makeIconItems(T, getMaterial) {
  const shared = new Set();
  const gm = c => { const m = getMaterial(c); shared.add(m); return m; };
  const builders = {
    wood: () => createDebris(T, 'wood', gm, { seed: 7 }),
    leaf: () => createDebris(T, 'leaf', gm, { seed: 3 }),
    scrap: () => createDebris(T, 'scrap', gm, { seed: 5 }),
    plastic: () => createPlastic(T),
    rope: () => createRopeCoil(T),
    fish: () => createFishModel(T),
    hook: () => createHook(T),
    hammer: () => createHammer(T),
    fishingrod: () => createFishingTool(T),
  };
  for (const k of ['sail', 'palm', 'lantern', 'net', 'bench', 'crate']) builders[k] = () => createCraft(T, k);
  return Object.keys(ICON_POSES).map(kind => ({
    kind, pose: ICON_POSES[kind], make: builders[kind],
    dispose: obj => disposeTree(obj, shared),
  }));
}
