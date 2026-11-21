// Held item models (procedural, own art). ES module.
// buildItemModel(T, kind) -> Group in "as held" metres, origin = centre of its bounds, with
//   userData.kind, userData.size {x,y,z}, userData.grip [x,y,z] (where a fist closes, root space).
// Every call builds fresh geometry/materials: render it once (icons) or cache it (viewmodel).
// HOLD[kind] says how the first-person hand carries it: hand 'right'|'left', default pose, and the
// rotation/offset of the grip frame (fist grip axis = local Y).
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';

export const DECOR_KINDS = Object.freeze(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);

export const HOLD = Object.freeze({
  hook:       { hand: 'right', pose: 'grip' },
  hammer:     { hand: 'right', pose: 'grip', rx: 0, ry: Math.PI / 2, rz: 0.2 },
  fishingrod: { hand: 'right', pose: 'grip', rx: -0.15, rz: 0.6 },
  wood:       { hand: 'right', pose: 'grip', rx: 0.25, ry: 0.5, rz: 0.15 },
  leaf:       { hand: 'right', pose: 'grip', rx: -0.35, ry: 0.4, rz: 0.35 },
  scrap:      { hand: 'right', pose: 'grip', rx: 1.1, ry: 0.3, rz: -0.3 },
  plastic:    { hand: 'right', pose: 'grip', rx: 0.1, ry: 1.2, rz: 0.1 },
  rope:       { hand: 'right', pose: 'grip', ry: 0.4 },
  fish:       { hand: 'right', pose: 'grip', rx: 0.15, ry: -0.5, rz: 0.15 },
  ...Object.fromEntries(DECOR_KINDS.map((k) => [k, { hand: 'left', pose: 'point' }])),
});

const SIZE = { wood: 0.36, leaf: 0.42, scrap: 0.2, plastic: 0.19, rope: 0.15, fish: 0.3, sail: 0.22, palm: 0.2, lantern: 0.2, net: 0.2, bench: 0.16, crate: 0.13 };

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

// Kind -> fresh model. Unknown kinds return null.
export function buildItemModel(T, kind) {
  let root = null;
  if (kind === 'hook') {
    const m = createHook(T); m.scale.setScalar(0.55);
    // handle axis sits at x=.2, y≈-.27 in createHook's inner group (inner is re-centred)
    const inner = m.children[0], gp = new T.Vector3(0.2, -0.272, 0).add(inner.position).multiplyScalar(0.55);
    root = new T.Group(); root.add(m);
    root.userData.size = { x: m.userData.size.x * 0.55, y: m.userData.size.y * 0.55, z: m.userData.size.z * 0.55 };
    root.userData.grip = [gp.x, gp.y, gp.z];
  } else if (kind === 'hammer' || kind === 'fishingrod') {
    const m = kind === 'hammer' ? createHammer(T) : createFishingTool(T), s = kind === 'hammer' ? 0.6 : 0.55;
    m.scale.setScalar(s);
    root = new T.Group(); root.add(m);
    const gp = m.userData.grip.clone().multiplyScalar(s), sz = m.userData.size || { x: 0.1, y: 0.8, z: 0.1 };
    root.userData.size = { x: sz.x * s, y: sz.y * s, z: sz.z * s };
    root.userData.grip = [gp.x, gp.y, gp.z];
    root.userData.model = m;                                     // rod: userData.float/leader/tipNode live here
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
  }
  if (!root) return null;
  root.name = 'item_' + kind;
  root.userData.kind = kind;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
