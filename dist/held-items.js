// Held item models (procedural, own art). ES module.
// buildItemModel(T, kind, factory?) -> Group in "as held" metres, origin = centre of its bounds, with
//   userData.kind, userData.size {x,y,z}, userData.grip [x,y,z] (where a fist closes, root space),
//   userData.shared = true when the meshes came from `factory` (cached geometry: never dispose).
// factory(kind) -> Object3D|null is optional (e.g. (k) => getModel(k) from models.js); it is used for
// carried / placeable kinds and for kinds this file has no mesh for. Tools keep their own tuned models.
// Any other kind still gets something sensible: a generic bundle, so every hotbar slot shows in hand.
// holdFor(kind) says how the first-person hand carries it: hand 'right'|'left', default pose, and the
// rotation of the grip frame (fist grip axis = local Y).
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createBrush } from './brush-model.js?build=v3-survival-ae77fa84ac2b'; // content hook (paint)
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createSpear } from './spear-model.js?build=v3-survival-ae77fa84ac2b'; // [spear-repair]
import { createPaddle } from './paddle-model.js?build=v3-survival-ae77fa84ac2b'; // [paddle]
import { createAxe } from './axe-model.js?build=v3-survival-ae77fa84ac2b'; // [axe]
import { buildInstrument } from './instrument-models.js?build=v3-survival-ae77fa84ac2b'; // [instruments]
import { createSpade, createFinder } from './treasure-models.js?build=v3-survival-ae77fa84ac2b';
import { buildCameraModel } from './camera-models.js?build=v3-survival-ae77fa84ac2b'; // [camera]

export const DECOR_KINDS = Object.freeze(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
// Items you aim at the raft to place: the free hand points at the spot while one of these is held.
export const PLACEABLE_KINDS = Object.freeze(['hammer', ...DECOR_KINDS, 'planter', 'seed', 'seeds']);
export const isPlaceable = (kind) => PLACEABLE_KINDS.includes(kind);
const TOOL_KINDS = ['hook', 'hammer', 'fishingrod', 'brush', 'spear', 'metalspear', 'paddle', 'axe'];
const HOOK_SCALE = 0.4;                     // compact: the held hook stays in the lower-right corner
// Right-hand kinds that still prefer the shared models.js mesh (so the held cup matches its icon and the world).
const FACTORY_FIRST = ['cup', 'water'];
// Seeds ride the left fist without pointing; game.js asks for 'point' only while a planter is aimed at.
const SEED_KINDS = ['seed', 'seeds'];

export const HOLD = Object.freeze({
  // arm: [dx, dy, dz] camera-space nudge of the right arm at rest for this kind.
  hook:       { hand: 'right', pose: 'grip', arm: [0.03, -0.025, 0] },          // hook tip stays right of the screen centre
  hammer:     { hand: 'right', pose: 'grip', rx: 0, ry: Math.PI / 2, rz: 0.2, arm: [0.02, -0.06, 0], tilt: 0.55 }, // tilt: head leans forward
  fishingrod: { hand: 'right', pose: 'grip', rx: -0.15, rz: 0.6 },
  spade:      { hand: 'right', pose: 'grip', rx: 0.2, rz: 0.35 },
  finder:     { hand: 'right', pose: 'grip', rx: -1.1, rz: 0.25 },
  spear:      { hand: 'right', pose: 'grip', rx: -1.32, rz: 0.16 }, // [spear-repair] point forward, a ready jab
  metalspear: { hand: 'right', pose: 'grip', rx: -1.32, rz: 0.16 },
  paddle:     { hand: 'right', pose: 'grip', rx: -1.45, ry: 0, rz: 0.6, arm: [-0.02, 0.03, 0] }, // [paddle] blade reaches forward and down past the edge
  axe:        { hand: 'right', pose: 'grip', rx: 0, ry: Math.PI / 2, rz: 0.2, arm: [0.02, -0.05, 0], tilt: 0.5 }, // [axe] held like the hammer, blade leaning forward
  brush:      { hand: 'right', pose: 'grip', rx: -0.25, ry: 0.35, rz: 0.35 }, // content hook (paint)
  wood:       { hand: 'right', pose: 'grip', rx: 0.25, ry: 0.5, rz: 0.15 },
  leaf:       { hand: 'right', pose: 'grip', rx: -0.35, ry: 0.4, rz: 0.35 },
  scrap:      { hand: 'right', pose: 'grip', rx: 1.1, ry: 0.3, rz: -0.3 },
  plastic:    { hand: 'right', pose: 'grip', rx: 0.1, ry: 1.2, rz: 0.1 },
  rope:       { hand: 'right', pose: 'grip', ry: 0.4, arm: [-0.01, 0.05, 0] },     // coil hangs off the fist, in front of the palm
  fish:       { hand: 'right', pose: 'grip', rx: 0.1, ry: 0.35, rz: 0.25, arm: [-0.02, 0.06, 0] },      // by the tail, body across the view
  cup:        { hand: 'right', pose: 'grip', ry: 0.3 },
  water:      { hand: 'right', pose: 'grip', ry: 0.3 },
  drum: { hand: 'right', pose: 'grip', rx: 0.75 }, pipes: { hand: 'right', pose: 'grip', rx: 0.2 }, bells: { hand: 'right', pose: 'grip', rx: 1.2, rz: 0.1 }, // [instruments] right fist, clear of the hotbar
  camera: { hand: 'right', pose: 'grip', rx: 0.1, rz: -1 }, // [camera] lens faces forward; tilted up so the body clears the hotbar
  ...Object.fromEntries(PLACEABLE_KINDS.filter((k) => k !== 'hammer').map((k) => [k, { hand: 'left', pose: SEED_KINDS.includes(k) ? 'grip' : 'point' }])),
});
// Unknown kinds (other lanes may add items): carried on the left fist if placeable, else gripped.
export const holdFor = (kind) => HOLD[kind] || (isPlaceable(kind) ? HOLD.crate : { hand: 'right', pose: 'grip' });

// Left-fist (placeable) models are capped to a small carried size so they never fill the lower left.
export const HELD_LEFT_MAX = 0.11;
const SIZE = { wood: 0.36, leaf: 0.42, scrap: 0.2, plastic: 0.19, rope: 0.22, fish: 0.3, sail: 0.22, palm: 0.2, lantern: 0.2, net: 0.2, bench: 0.16, crate: 0.13,
  planter: 0.2, seed: 0.12, seeds: 0.12, cup: 0.11, water: 0.11,
  drum: 0.15, pipes: 0.2, bells: 0.2, // [instruments]
  camera: 0.13 }; // [camera]

function fit(T, model, maxDim, gripFn) {
  const root = new T.Group();
  root.add(model);
  model.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
  const s = maxDim ? maxDim / Math.max(size.x, size.y, size.z, 1e-6) : 1;
  model.scale.multiplyScalar(s);
  model.position.sub(box.getCenter(new T.Vector3()).multiplyScalar(s));
  size.multiplyScalar(s);
  const g = gripFn ? gripFn(size) : new T.Vector3();
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.grip = [g.x, g.y, g.z];
  return root;
}

// Small tiling surface textures (procedural DataTextures, built once per THREE instance and shared,
// never disposed): 'skin' mottle, 'weave' canvas cloth, 'rope' twisted fibres. Values are near white so
// they modulate a material's colour; the same texture doubles as a bump map.
const TEX = new WeakMap();
export function surfaceTextures(T) {
  if (TEX.has(T)) return TEX.get(T);
  const N = 64;
  const hash = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  // tiling value noise, `c` cells across the tile
  const noise = (u, v, c, s) => {
    const x = u * c, y = v * c, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const g = (i, j) => hash(((xi + i) % c + c) % c, ((yi + j) % c + c) % c, s);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (g(0, 0) * (1 - sx) + g(1, 0) * sx) * (1 - sy) + (g(0, 1) * (1 - sx) + g(1, 1) * sx) * sy;
  };
  const make = (fn) => {
    const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [r, g, b] = fn(x / N, y / N, x, y), i = (y * N + x) * 4;
      d[i] = Math.round(Math.min(1, r) * 255); d[i + 1] = Math.round(Math.min(1, g) * 255); d[i + 2] = Math.round(Math.min(1, b) * 255); d[i + 3] = 255;
    }
    const t = new T.DataTexture(d, N, N, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true;
    return t;
  };
  const skin = make((u, v) => {
    const m = 0.5 * noise(u, v, 4, 1) + 0.3 * noise(u, v, 8, 2) + 0.2 * noise(u, v, 32, 3);
    const k = 0.9 + 0.1 * m, red = 0.03 * (noise(u, v, 6, 4) - 0.5);     // faint blotchy redness
    return [k + red, k - red * 0.5, k - red * 0.3];
  });
  const weave = make((u, v, x, y) => {
    const P = 8, cx = Math.floor(x / P), cy = Math.floor(y / P), over = (cx + cy) % 2 === 0;
    const fu = (x % P + 0.5) / P, fv = (y % P + 0.5) / P;
    const warp = Math.sin(Math.PI * fu), weft = Math.sin(Math.PI * fv);   // round thread profiles
    const k = over ? 0.62 + 0.38 * warp * (0.75 + 0.25 * weft) : 0.62 + 0.38 * weft * (0.75 + 0.25 * warp);
    const n = 0.88 + 0.12 * noise(u, v, 16, 5) + 0.06 * (hash(x, y, 6) - 0.5);
    return [k * n, k * n, k * n];
  });
  const rope = make((u, v, x, y) => {
    const strand = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (u * 3 + v * 2));          // three twisted strands
    const fibre = noise(u * 0.25 + v * 0.75, u * 0.75 - v * 0.25 + 1, 32, 7);        // fine fibres along the twist
    const k = 0.55 + 0.32 * Math.pow(strand, 0.6) + 0.13 * fibre + 0.05 * (hash(x, y, 8) - 0.5);
    return [k, k, k];
  });
  skin.repeat.set(3, 2); weave.repeat.set(10, 12); rope.repeat.set(8, 1);
  const set = { skin, weave, rope };
  TEX.set(T, set);
  return set;
}
// Gives a held model's materials believable surfaces: rope gets twisted fibres, timber stays matte,
// metal gets a tighter, brighter finish. Only touches the model's own (unshared) materials.
function finishMaterials(T, root) {
  const tx = surfaceTextures(T), seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (seen.has(m) || !m.isMeshStandardMaterial) continue; seen.add(m);
      if (m.metalness >= 0.5) { m.metalness = 0.8; m.roughness = Math.min(m.roughness, 0.32); }
      else if (m.roughness >= 0.95) { m.map = tx.rope; m.bumpMap = tx.rope; m.bumpScale = 1.5; m.roughness = 1; }
      else if (m.roughness >= 0.8) { m.roughness = 0.9; }
      m.needsUpdate = true;
    }
  });
}

function matCache(T) {
  const c = new Map();
  return (color) => {
    let m = c.get(color);
    if (!m) { m = new T.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }); c.set(color, m); }
    return m;
  };
}

function buildRope(T) {
  const g = new T.Group();
  const tx = surfaceTextures(T).rope;
  const rope = new T.MeshStandardMaterial({ color: 0xc4a46c, roughness: 1, map: tx, bumpMap: tx, bumpScale: 1.5 });
  const dark = new T.MeshStandardMaterial({ color: 0x8a6e44, roughness: 1, map: tx, bumpMap: tx, bumpScale: 1.5 });
  for (let i = 0; i < 3; i++) {
    const m = new T.Mesh(new T.TorusGeometry(0.058 - i * 0.004, 0.009, 7, 30), rope);
    m.position.z = (i - 1) * 0.012; m.rotation.set(0.08 * i, 0.1 * (i - 1), i);
    g.add(m);
  }
  const bind = new T.Mesh(new T.TorusGeometry(0.018, 0.006, 6, 14), dark);
  bind.position.y = 0.058; bind.rotation.y = Math.PI / 2;
  g.add(bind);
  const tail = new T.CatmullRomCurve3([new T.Vector3(0.01, -0.055, 0), new T.Vector3(0.03, -0.09, 0.01), new T.Vector3(0.02, -0.12, 0.02)]);
  g.add(new T.Mesh(new T.TubeGeometry(tail, 10, 0.007, 6, false), rope));
  return g;
}

function buildFish(T) {
  const g = new T.Group();
  const body = new T.MeshStandardMaterial({ color: 0x6f9fb4, roughness: 0.45, metalness: 0.15 });
  const belly = new T.MeshStandardMaterial({ color: 0xdfe6d8, roughness: 0.5 });
  const fin = new T.MeshStandardMaterial({ color: 0x5c7f8c, roughness: 0.6, side: T.DoubleSide });
  const eye = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
  const s = new T.SphereGeometry(1, 14, 10);
  const b = new T.Mesh(s, body); b.scale.set(0.15, 0.05, 0.03); g.add(b);
  const u = new T.Mesh(s, belly); u.scale.set(0.12, 0.03, 0.026); u.position.y = -0.018; g.add(u);
  const tail = new T.Mesh(new T.ConeGeometry(0.05, 0.08, 3), fin);
  tail.rotation.z = -Math.PI / 2; tail.scale.z = 0.2; tail.position.x = 0.17; g.add(tail);
  const dorsal = new T.Mesh(new T.ConeGeometry(0.03, 0.05, 3), fin);
  dorsal.scale.z = 0.2; dorsal.position.set(0.01, 0.055, 0); dorsal.rotation.z = -0.4; g.add(dorsal);
  for (const z of [-0.026, 0.026]) { const e = new T.Mesh(s, eye); e.scale.setScalar(0.008); e.position.set(-0.11, 0.012, z); g.add(e); }
  return g;
}

function buildCup(T, full) {
  const g = new T.Group();
  const shell = new T.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.6 });
  const cup = new T.Mesh(new T.CylinderGeometry(0.045, 0.035, 0.1, 14, 1, true), new T.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.6, side: T.DoubleSide }));
  const base = new T.Mesh(new T.CircleGeometry(0.035, 14), shell); base.rotation.x = Math.PI / 2; base.position.y = -0.05;
  const rim = new T.Mesh(new T.TorusGeometry(0.045, 0.004, 5, 18), shell); rim.rotation.x = Math.PI / 2; rim.position.y = 0.05;
  g.add(cup, base, rim);
  if (full) {
    const w = new T.Mesh(new T.CircleGeometry(0.042, 14), new T.MeshStandardMaterial({ color: 0x5fb3c8, roughness: 0.15, metalness: 0.1 }));
    w.rotation.x = -Math.PI / 2; w.position.y = 0.035; g.add(w);
  }
  return g;
}

function buildSeeds(T) {
  const g = new T.Group(), m = new T.MeshStandardMaterial({ color: 0xb98d4f, roughness: 0.7 });
  const s = new T.SphereGeometry(1, 10, 8);
  [[0, 0, 0, 0.3], [0.02, 0.006, 0.012, 1.4], [-0.018, 0.004, 0.014, -0.8], [0.004, 0.014, -0.012, 2.2]].forEach(([x, y, z, r]) => {
    const e = new T.Mesh(s, m); e.scale.set(0.012, 0.02, 0.012); e.position.set(x, y, z); e.rotation.z = r; g.add(e);
  });
  return g;
}

// A small cloth bundle tied with rope: stands in for any kind without a model of its own.
function buildBundle(T) {
  const g = new T.Group();
  const cloth = new T.Mesh(new T.BoxGeometry(0.1, 0.08, 0.08), new T.MeshStandardMaterial({ color: 0xcdbb94, roughness: 0.95 }));
  const tie = new T.MeshStandardMaterial({ color: 0x8a6e44, roughness: 1 });
  const b1 = new T.Mesh(new T.BoxGeometry(0.104, 0.084, 0.012), tie), b2 = new T.Mesh(new T.BoxGeometry(0.012, 0.084, 0.084), tie);
  g.add(cloth, b1, b2);
  return g;
}

// Kind -> fresh model ('' / null -> null). Never null for a real kind: falls back to a bundle.
export function buildItemModel(T, kind, factory = null) {
  if (!kind) return null;
  let root = null;
  const left = holdFor(kind).hand === 'left';
  const dim = (k, d) => (left ? Math.min(SIZE[k] || d, HELD_LEFT_MAX) : SIZE[k] || d);
  if (factory && !TOOL_KINDS.includes(kind) && (left || !HOLD[kind] || FACTORY_FIRST.includes(kind))) {
    let m = null;
    try { m = factory(kind); } catch { m = null; }
    if (m?.isObject3D) {
      root = fit(T, m, dim(kind, 0.16), (s) => new T.Vector3(0, left ? -s.y / 2 : -s.y * 0.2, 0));
      root.userData.shared = true;
    }
  }
  if (root) { /* factory model */ } else if (kind === 'hook') {
    const k = HOOK_SCALE, m = createHook(T); m.scale.setScalar(k); finishMaterials(T, m);
    // handle axis sits at x=.2, y≈-.27 in createHook's inner group (inner is re-centred)
    const inner = m.children[0], gp = new T.Vector3(0.2, -0.272, 0).add(inner.position).multiplyScalar(k);
    root = new T.Group(); root.add(m);
    root.userData.size = { x: m.userData.size.x * k, y: m.userData.size.y * k, z: m.userData.size.z * k };
    root.userData.grip = [gp.x, gp.y, gp.z];
  } else if (kind === 'axe') { // [axe]
    const m = createAxe(T), s = 0.62;
    m.scale.setScalar(s);
    root = new T.Group(); root.add(m);
    const gp = m.userData.grip.clone().multiplyScalar(s), sz = m.userData.size;
    root.userData.size = { x: sz.x * s, y: sz.y * s, z: sz.z * s };
    root.userData.grip = [gp.x, gp.y, gp.z];
    root.userData.model = m;
  } else if (kind === 'hammer' || kind === 'fishingrod' || kind === 'brush' || kind === 'spear' || kind === 'metalspear' || kind === 'paddle') {
    const spear = kind === 'spear' || kind === 'metalspear'; // [spear-repair] spear-repair-hooks.js slides userData.model along +Y to jab
    const m = kind === 'hammer' ? createHammer(T) : kind === 'paddle' ? createPaddle(T) : kind === 'brush' ? createBrush(T) : spear ? createSpear(T, { metal: kind === 'metalspear' }) : createFishingTool(T), s = kind === 'fishingrod' ? 0.55 : kind === 'hammer' ? 0.42 : kind === 'paddle' ? 0.55 : spear ? 0.62 : 0.6; // compact hammer
    m.scale.setScalar(s); if (kind === 'hammer') finishMaterials(T, m);
    root = new T.Group(); root.add(m);
    const gp = m.userData.grip.clone().multiplyScalar(s), sz = m.userData.size || { x: 0.1, y: 0.8, z: 0.1 };
    root.userData.size = { x: sz.x * s, y: sz.y * s, z: sz.z * s };
    root.userData.grip = [gp.x, gp.y, gp.z];
    root.userData.model = m;                                     // rod: userData.float/leader/tipNode live here
  } else if (kind === 'spade' || kind === 'finder') {
    const m = kind === 'spade' ? createSpade(T) : createFinder(T), s = 0.55;
    m.scale.setScalar(s);
    root = new T.Group(); root.add(m);
    const gp = m.userData.grip.clone().multiplyScalar(s), sz = m.userData.size;
    root.userData.size = { x: sz.x * s, y: sz.y * s, z: sz.z * s };
    root.userData.grip = [gp.x, gp.y, gp.z];
    root.userData.model = m;
  } else if (kind === 'wood' || kind === 'leaf' || kind === 'scrap') {
    const d = createDebris(T, kind, matCache(T), { seed: 7 });
    const lie = new T.Group(); lie.add(d);
    if (kind !== 'scrap') lie.rotation.z = Math.PI / 2;          // long axis along Y so the fist closes round it
    root = fit(T, lie, SIZE[kind], (s) => new T.Vector3(0, -s.y * (kind === 'leaf' ? 0.42 : 0.25), 0));
  } else if (kind === 'plastic') {
    root = fit(T, createPlastic(T), SIZE.plastic, (s) => new T.Vector3(0, s.y * 0.2, 0));
  } else if (kind === 'rope') {
    root = fit(T, buildRope(T), SIZE.rope, (s) => new T.Vector3(s.x * 0.38, s.y * 0.1, 0));   // fist on the coil's right rim
  } else if (kind === 'fish') {
    root = fit(T, buildFish(T), SIZE.fish, (s) => new T.Vector3(s.x * 0.42, 0, 0));   // tail in the fist, head out to the left
  } else if (DECOR_KINDS.includes(kind)) {
    const c = createCraft(T, kind);
    if (c) root = fit(T, c, dim(kind), (s) => new T.Vector3(0, -s.y / 2, 0)); // grip = base centre
  } else if (kind === 'cup' || kind === 'water') {
    root = fit(T, buildCup(T, kind === 'water'), SIZE[kind], () => new T.Vector3(0, 0, 0));
  } else if (kind === 'seed' || kind === 'seeds') {
    root = fit(T, buildSeeds(T), dim(kind), (s) => new T.Vector3(0, -s.y / 2, 0));
  } else if (kind === 'planter') {
    root = fit(T, createCraft(T, 'palm'), dim('planter'), (s) => new T.Vector3(0, -s.y / 2, 0));
  }
  if (!root && kind === 'camera') { const cm = buildCameraModel(T), gf = cm.userData.gripFrac; root = fit(T, cm, SIZE.camera, (s) => new T.Vector3(gf[0] * s.x, gf[1] * s.y, gf[2] * s.z)); } // [camera]
  if (!root) { const ins = buildInstrument(T, kind), gf = ins?.userData.gripFrac; if (ins) root = fit(T, ins, SIZE[kind], gf ? (s) => new T.Vector3(gf[0] * s.x, gf[1] * s.y, gf[2] * s.z) : null); } // [instruments]
  if (!root) root = fit(T, buildBundle(T), left ? HELD_LEFT_MAX : 0.12, (s) => new T.Vector3(0, left ? -s.y / 2 : 0, 0));
  root.name = 'item_' + kind;
  root.userData.kind = kind;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
