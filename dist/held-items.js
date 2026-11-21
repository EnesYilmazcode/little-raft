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
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { buildInstrument } from './instrument-models.js?build=v3-survival-ae77fa84ac2b'; // [instruments]
import { createSpade, createFinder } from './treasure-models.js';

export const DECOR_KINDS = Object.freeze(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
// Items you aim at the raft to place: the free hand points at the spot while one of these is held.
export const PLACEABLE_KINDS = Object.freeze(['hammer', ...DECOR_KINDS, 'planter', 'seed', 'seeds']);
export const isPlaceable = (kind) => PLACEABLE_KINDS.includes(kind);
const TOOL_KINDS = ['hook', 'hammer', 'fishingrod'];
const HOOK_SCALE = 0.4;                     // compact: the held hook stays in the lower-right corner
// Right-hand kinds that still prefer the shared models.js mesh (so the held cup matches its icon and the world).
const FACTORY_FIRST = ['cup', 'water'];
// Seeds ride the left fist without pointing; game.js asks for 'point' only while a planter is aimed at.
const SEED_KINDS = ['seed', 'seeds'];

export const HOLD = Object.freeze({
  hook:       { hand: 'right', pose: 'grip' },
  hammer:     { hand: 'right', pose: 'grip', rx: 0, ry: Math.PI / 2, rz: 0.2 },
  fishingrod: { hand: 'right', pose: 'grip', rx: -0.15, rz: 0.6 },
  spade:      { hand: 'right', pose: 'grip', rx: 0.2, rz: 0.35 },
  finder:     { hand: 'right', pose: 'grip', rx: -1.1, rz: 0.25 },
  wood:       { hand: 'right', pose: 'grip', rx: 0.25, ry: 0.5, rz: 0.15 },
  leaf:       { hand: 'right', pose: 'grip', rx: -0.35, ry: 0.4, rz: 0.35 },
  scrap:      { hand: 'right', pose: 'grip', rx: 1.1, ry: 0.3, rz: -0.3 },
  plastic:    { hand: 'right', pose: 'grip', rx: 0.1, ry: 1.2, rz: 0.1 },
  rope:       { hand: 'right', pose: 'grip', ry: 0.4 },
  fish:       { hand: 'right', pose: 'grip', rx: 0.15, ry: -0.5, rz: 0.15 },
  cup:        { hand: 'right', pose: 'grip', ry: 0.3 },
  water:      { hand: 'right', pose: 'grip', ry: 0.3 },
  drum: { hand: 'left', pose: 'grip', rx: -0.7 }, pipes: { hand: 'right', pose: 'grip', rx: 0.2 }, bells: { hand: 'left', pose: 'grip', rx: -1.25 }, // [instruments]
  ...Object.fromEntries(PLACEABLE_KINDS.filter((k) => k !== 'hammer').map((k) => [k, { hand: 'left', pose: SEED_KINDS.includes(k) ? 'grip' : 'point' }])),
});
// Unknown kinds (other lanes may add items): carried on the left fist if placeable, else gripped.
export const holdFor = (kind) => HOLD[kind] || (isPlaceable(kind) ? HOLD.crate : { hand: 'right', pose: 'grip' });

const SIZE = { wood: 0.36, leaf: 0.42, scrap: 0.2, plastic: 0.19, rope: 0.15, fish: 0.3, sail: 0.22, palm: 0.2, lantern: 0.2, net: 0.2, bench: 0.16, crate: 0.13,
  planter: 0.2, seed: 0.12, seeds: 0.12, cup: 0.11, water: 0.11,
  drum: 0.24, pipes: 0.2, bells: 0.26 }; // [instruments]

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
  const rope = new T.MeshStandardMaterial({ color: 0xb89a64, roughness: 0.95 });
  const dark = new T.MeshStandardMaterial({ color: 0x8a6e44, roughness: 1 });
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
  if (factory && !TOOL_KINDS.includes(kind) && (left || !HOLD[kind] || FACTORY_FIRST.includes(kind))) {
    let m = null;
    try { m = factory(kind); } catch { m = null; }
    if (m?.isObject3D) {
      root = fit(T, m, SIZE[kind] || 0.16, (s) => new T.Vector3(0, left ? -s.y / 2 : -s.y * 0.2, 0));
      root.userData.shared = true;
    }
  }
  if (root) { /* factory model */ } else if (kind === 'hook') {
    const k = HOOK_SCALE, m = createHook(T); m.scale.setScalar(k);
    // handle axis sits at x=.2, y≈-.27 in createHook's inner group (inner is re-centred)
    const inner = m.children[0], gp = new T.Vector3(0.2, -0.272, 0).add(inner.position).multiplyScalar(k);
    root = new T.Group(); root.add(m);
    root.userData.size = { x: m.userData.size.x * k, y: m.userData.size.y * k, z: m.userData.size.z * k };
    root.userData.grip = [gp.x, gp.y, gp.z];
  } else if (kind === 'hammer' || kind === 'fishingrod') {
    const m = kind === 'hammer' ? createHammer(T) : createFishingTool(T), s = kind === 'hammer' ? 0.6 : 0.55;
    m.scale.setScalar(s);
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
    root = fit(T, buildRope(T), SIZE.rope, (s) => new T.Vector3(0, s.y * 0.3, 0));
  } else if (kind === 'fish') {
    const f = buildFish(T); f.rotation.z = Math.PI / 2;           // held by the tail, head down
    root = fit(T, f, SIZE.fish, (s) => new T.Vector3(0, s.y * 0.4, 0));
  } else if (DECOR_KINDS.includes(kind)) {
    const c = createCraft(T, kind);
    if (c) root = fit(T, c, SIZE[kind], (s) => new T.Vector3(0, -s.y / 2, 0)); // grip = base centre
  } else if (kind === 'cup' || kind === 'water') {
    root = fit(T, buildCup(T, kind === 'water'), SIZE[kind], () => new T.Vector3(0, 0, 0));
  } else if (kind === 'seed' || kind === 'seeds') {
    root = fit(T, buildSeeds(T), SIZE[kind], (s) => new T.Vector3(0, -s.y / 2, 0));
  } else if (kind === 'planter') {
    root = fit(T, createCraft(T, 'palm'), SIZE.planter, (s) => new T.Vector3(0, -s.y / 2, 0));
  }
  if (!root) { const ins = buildInstrument(T, kind), gf = ins?.userData.gripFrac; if (ins) root = fit(T, ins, SIZE[kind], gf ? (s) => new T.Vector3(gf[0] * s.x, gf[1] * s.y, gf[2] * s.z) : null); } // [instruments]
  if (!root) root = fit(T, buildBundle(T), 0.12, (s) => new T.Vector3(0, left ? -s.y / 2 : 0, 0));
  root.name = 'item_' + kind;
  root.userData.kind = kind;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
