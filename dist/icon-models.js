// Little Raft: 3D icon models for the progression and content items that have no procedural model
// of their own (ores, ingots, parts, stations, instruments, bees, signal and water gear).
// buildIconModel(T, kind) -> a fresh THREE.Group the caller owns and frees, or null for unknown kinds.
// Placed gear reuses the in-world models from their own modules; small materials are built here.
// Pure: no DOM and no renderer, so node tests can build every kind.
import { createSmelterModel, createResearchTableModel, createGrillModel } from './smelter-model.js';
import { buildResearchTable } from './storage-research-model.js';
import { createSignalModel } from './signal-models.js?build=v3-survival-ae77fa84ac2b';
import { createPurifier } from './purifier-model.js?build=v3-survival-ae77fa84ac2b';
import { createRainBarrel, createSprinkler } from './rain-model.js?build=v3-survival-ae77fa84ac2b';
import { createHive, createFlowerBox, createCandle } from './bees-model.js?build=v3-survival-ae77fa84ac2b';
import { buildInstrument } from './instrument-models.js?build=v3-survival-ae77fa84ac2b';

// Builds the in-world model for placed gear and held instruments.
const WORLD = {
  smelter: T => createSmelterModel(T),
  researchtable: T => createResearchTableModel(T),
  grill: T => createGrillModel(T),
  research: T => buildResearchTable(T).instance(), // a fresh kit per icon, so freeing the icon frees it
  receiver: T => createSignalModel(T, 'receiver'),
  antenna: T => createSignalModel(T, 'antenna'),
  purifier: T => createPurifier(T),
  rainbarrel: T => createRainBarrel(T),
  sprinkler: T => createSprinkler(T),
  beehive: T => createHive(T),
  flowerbox: T => createFlowerBox(T),
  candle: T => createCandle(T),
  drum: T => buildInstrument(T, 'drum'),
  pipes: T => buildInstrument(T, 'pipes'),
  bells: T => buildInstrument(T, 'bells'),
};

// Tiny kit: flat-shaded materials (fresh per model, so freeing the icon frees them) and a mesh helper.
function kit(T) {
  const g = new T.Group();
  const mats = new Map();
  const mat = (color, o = {}) => {
    const key = color + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...o }));
    return mats.get(key);
  };
  const add = (geo, m, p = [0, 0, 0], r = [0, 0, 0], s = null, parent = g) => {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(p[0], p[1], p[2]); mesh.rotation.set(r[0], r[1], r[2]);
    if (s) mesh.scale.set(s[0], s[1], s[2]);
    parent.add(mesh); return mesh;
  };
  return { g, mat, add };
}

// A lumpy rock with coloured flecks set into it.
function ore(T, base, flecks) {
  const { g, mat, add } = kit(T);
  add(new T.DodecahedronGeometry(0.42, 0), mat(base), [0, 0, 0], [0.3, 0.5, 0.1], [1.15, 0.8, 1]);
  const spots = [[0.3, 0.18, 0.2], [-0.12, 0.28, 0.25], [0.12, -0.05, 0.4], [-0.32, 0.05, 0.12], [0.05, 0.33, -0.12]];
  spots.forEach((p, i) => add(new T.OctahedronGeometry(0.1, 0), mat(flecks[i % flecks.length], { metalness: 0.4, roughness: 0.4 }), p, [i, i * 0.7, 0]));
  return g;
}
function stone(T) {
  const { g, mat, add } = kit(T);
  add(new T.DodecahedronGeometry(0.4, 1), mat('#8d949a'), [0, 0, 0], [0, 0.4, 0], [1.2, 0.6, 1]);
  add(new T.DodecahedronGeometry(0.24, 1), mat('#a3aaaf'), [0.3, 0.12, 0.28], [0.5, 0, 0], [1.1, 0.7, 1]);
  return g;
}
function sand(T) {
  const { g, mat, add } = kit(T);
  add(new T.ConeGeometry(0.55, 0.42, 14, 1), mat('#dcae55'), [0, 0.21, 0]);
  add(new T.ConeGeometry(0.3, 0.26, 10, 1), mat('#e9c06a'), [0.4, 0.13, 0.25]);
  return g;
}
function clay(T) {
  const { g, mat, add } = kit(T);
  add(new T.IcosahedronGeometry(0.4, 1), mat('#c4643c', { roughness: 0.9 }), [0, 0, 0], [0, 0, 0], [1.2, 0.7, 1]);
  add(new T.IcosahedronGeometry(0.2, 1), mat('#b2552f', { roughness: 0.9 }), [0.32, 0.18, 0.12], [0, 0, 0], [1, 0.8, 1]);
  return g;
}
function seaweed(T) {
  const { g, mat, add } = kit(T);
  const greens = ['#3f8f5a', '#2f7a4c', '#5aa66a'];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7, pts = [];
    for (let j = 0; j <= 6; j++) pts.push(new T.Vector3(Math.sin(j * 0.9 + a) * 0.12 + (i - 1.5) * 0.12, j * 0.16, Math.cos(j * 0.7 + a) * 0.08));
    add(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 16, 0.045, 5, false), mat(greens[i % 3]), [0, -0.45, 0], [0, 0, (i - 1.5) * 0.18]);
  }
  return g;
}
function flowerseed(T) {
  const { g, mat, add } = kit(T);
  [[0, 0, 0, 0], [0.26, 0, 0.12, 1.2], [-0.2, 0, 0.2, 2.3]].forEach(([x, y, z, r]) =>
    add(new T.SphereGeometry(0.14, 10, 8), mat('#7a5232'), [x, y, z], [0.4, r, 0.6], [1, 1.6, 1]));
  add(new T.ConeGeometry(0.08, 0.22, 6), mat('#6fbf4a'), [0, 0.26, 0], [0, 0, 0.3]);
  return g;
}
function honey(T) {
  const { g, mat, add } = kit(T);
  add(new T.CylinderGeometry(0.3, 0.32, 0.5, 16), mat('#e0a22a', { roughness: 0.3, metalness: 0.05 }), [0, 0.25, 0]);
  add(new T.CylinderGeometry(0.33, 0.33, 0.1, 16), mat('#c99a5c'), [0, 0.55, 0]);
  add(new T.CylinderGeometry(0.2, 0.2, 0.05, 12), mat('#f3d28a'), [0, 0.62, 0]);
  return g;
}
function wax(T) {
  const { g, mat, add } = kit(T);
  const cells = [[0, 0], [0.33, 0.19], [0.33, -0.19], [-0.33, 0.19], [-0.33, -0.19], [0, 0.38], [0, -0.38]];
  for (const [x, z] of cells) add(new T.CylinderGeometry(0.2, 0.2, 0.24, 6), mat('#f1d77a', { roughness: 0.55 }), [x, 0, z], [0, Math.PI / 6, 0]);
  return g;
}
function brick(T) {
  const { g, mat, add } = kit(T);
  add(new T.BoxGeometry(0.8, 0.26, 0.4), mat('#b5533c', { roughness: 0.95 }), [0, 0, 0]);
  add(new T.BoxGeometry(0.8, 0.26, 0.4), mat('#a9472f', { roughness: 0.95 }), [0.18, 0.28, 0.06], [0, 0.25, 0]);
  return g;
}
// Trapezoid bars, two stacked.
function ingot(T, color) {
  const { g, mat, add } = kit(T);
  const m = mat(color, { metalness: 0.65, roughness: 0.35 });
  const bar = () => { const geo = new T.CylinderGeometry(0.2, 0.28, 0.26, 4, 1); geo.rotateY(Math.PI / 4); geo.scale(2.2, 1, 1); return geo; };
  add(bar(), m, [0, 0, 0]);
  add(bar(), m, [0.08, 0.27, 0.06], [0, 0.35, 0]);
  return g;
}
function glass(T) {
  const { g, mat, add } = kit(T);
  add(new T.BoxGeometry(0.8, 0.8, 0.06), mat('#8fd3e6', { transparent: true, opacity: 0.8, roughness: 0.05, metalness: 0.1 }), [0, 0, 0], [0, 0.2, 0.1]);
  add(new T.BoxGeometry(0.06, 0.6, 0.07), mat('#ffffff', { transparent: true, opacity: 0.8 }), [-0.18, 0.02, 0.02], [0, 0.2, 0.55]);
  return g;
}
function bolt(T) {
  const { g, mat, add } = kit(T);
  const m = mat('#9aa3a8', { metalness: 0.6, roughness: 0.35 });
  const b = new T.Group(); g.add(b); b.rotation.set(0, 0, -0.7);
  add(new T.CylinderGeometry(0.2, 0.2, 0.14, 6), m, [0, 0.42, 0], [0, 0, 0], null, b);
  add(new T.CylinderGeometry(0.09, 0.09, 0.75, 10), m, [0, 0, 0], [0, 0, 0], null, b);
  for (let i = 0; i < 6; i++) add(new T.TorusGeometry(0.09, 0.018, 4, 12), m, [0, -0.3 + i * 0.07, 0], [Math.PI / 2, 0, 0], null, b);
  add(new T.CylinderGeometry(0.17, 0.17, 0.12, 6), mat('#7d878c', { metalness: 0.6, roughness: 0.4 }), [0.5, -0.2, 0.15]);
  return g;
}
function hinge(T) {
  const { g, mat, add } = kit(T);
  const m = mat('#8d969c', { metalness: 0.55, roughness: 0.4 });
  add(new T.BoxGeometry(0.36, 0.6, 0.04), m, [-0.2, 0, 0], [0, 0.35, 0]);
  add(new T.BoxGeometry(0.36, 0.6, 0.04), m, [0.2, 0, 0.02], [0, -0.35, 0]);
  add(new T.CylinderGeometry(0.06, 0.06, 0.66, 10), mat('#c6d6e0', { metalness: 0.7, roughness: 0.3 }), [0, 0, -0.06]);
  return g;
}
// Anchor-like metal grapple: shaft, top ring, curved arms with barbs.
function metalhook(T) {
  const { g, mat, add } = kit(T);
  const m = mat('#9fb1bf', { metalness: 0.7, roughness: 0.3 });
  add(new T.CylinderGeometry(0.05, 0.05, 0.9, 10), m, [0, 0.05, 0]);
  add(new T.TorusGeometry(0.12, 0.035, 8, 16), m, [0, 0.6, 0]);
  add(new T.TorusGeometry(0.32, 0.045, 8, 20, Math.PI), m, [0, -0.36, 0], [0, 0, Math.PI]);
  add(new T.ConeGeometry(0.08, 0.18, 6), m, [-0.32, -0.28, 0], [0, 0, 0.3]);
  add(new T.ConeGeometry(0.08, 0.18, 6), m, [0.32, -0.28, 0], [0, 0, -0.3]);
  add(new T.TorusGeometry(0.1, 0.03, 6, 12), mat('#c99a5c'), [0, 0.6, 0.12], [Math.PI / 2, 0, 0]);
  return g;
}
function binoculars(T) {
  const { g, mat, add } = kit(T);
  const body = mat('#d9773a', { metalness: 0.5, roughness: 0.35 }), dark = mat('#2c3438'), lens = mat('#9fd6f0', { roughness: 0.1, metalness: 0.2 });
  for (const x of [-0.2, 0.2]) {
    add(new T.CylinderGeometry(0.15, 0.17, 0.62, 14), body, [x, 0, 0], [Math.PI / 2, 0, 0]);
    add(new T.CylinderGeometry(0.18, 0.18, 0.12, 14), dark, [x, 0, 0.3], [Math.PI / 2, 0, 0]);
    add(new T.CircleGeometry(0.13, 14), lens, [x, 0, 0.365]);
  }
  add(new T.BoxGeometry(0.2, 0.08, 0.3), dark, [0, 0.08, -0.02]);
  return g;
}
function grilledFish(T, skin, glaze = null) {
  const { g, mat, add } = kit(T);
  add(new T.SphereGeometry(0.4, 14, 10), mat(skin), [0, 0, 0], [0, 0, 0], [1.2, 0.45, 0.3]);
  add(new T.ConeGeometry(0.2, 0.3, 4), mat(skin), [-0.56, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.4]);
  for (let i = 0; i < 3; i++) add(new T.BoxGeometry(0.04, 0.32, 0.26), mat('#3a2414'), [-0.18 + i * 0.18, 0.02, 0.02], [0, 0, 0.5]);
  if (glaze) add(new T.SphereGeometry(0.39, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(glaze, { roughness: 0.15, transparent: true, opacity: 0.75 }), [0, 0.02, 0], [0, 0, 0], [1.18, 0.46, 0.31]);
  add(new T.SphereGeometry(0.035, 8, 6), mat('#111111'), [0.32, 0.06, 0.1]);
  return g;
}
// A plastic cup with water in it (salty or fresh).
function cup(T, water, salt) {
  const { g, mat, add } = kit(T);
  add(new T.CylinderGeometry(0.28, 0.22, 0.6, 18, 1, true), mat('#9fd6d0', { side: T.DoubleSide, roughness: 0.5 }), [0, 0.3, 0]);
  add(new T.CircleGeometry(0.22, 18), mat('#54a6a4'), [0, 0.001, 0], [-Math.PI / 2, 0, 0]);
  add(new T.CircleGeometry(0.265, 18), mat(water, { roughness: 0.1 }), [0, 0.5, 0], [-Math.PI / 2, 0, 0]);
  if (salt) [[0.1, 0.05], [-0.08, 0.1], [0.02, -0.12]].forEach(([x, z]) => add(new T.OctahedronGeometry(0.03, 0), mat('#ffffff'), [x, 0.52, z]));
  return g;
}

const SMALL = {
  metalore: T => ore(T, '#6f6a66', ['#c6d6e0', '#9fb1bf']),
  copperore: T => ore(T, '#6a6058', ['#4fb08a', '#d9823e']),
  stone, sand, clay, seaweed, flowerseed, honey, wax, brick, glass, bolt, hinge, metalhook, binoculars,
  metalingot: T => ingot(T, '#a8b6c2'),
  copperingot: T => ingot(T, '#d07a45'),
  cookedfish: T => grilledFish(T, '#c98a4a'),
  honeyfish: T => grilledFish(T, '#d9952e', '#ffcf4a'),
  saltcup: T => cup(T, '#4f93b8', true),
  freshcup: T => cup(T, '#8fd8f2', false),
};

/** Kinds this module can build. */
export const ICON_MODEL_KINDS = Object.freeze([...Object.keys(WORLD), ...Object.keys(SMALL)]);

/** A fresh icon model for kind (caller owns it), or null. Effects that would blow up the framing
 *  (sprinkler spray points, glow sprites, lines) are removed. */
export function buildIconModel(T, kind) {
  const make = WORLD[kind] || SMALL[kind];
  if (!make) return null;
  let g = null;
  try { g = make(T); } catch (e) { console.warn('icon model failed', kind, e); return null; }
  if (!g) return null;
  const drop = [];
  g.traverse(o => { if (o.isPoints || o.isSprite || o.isLine) drop.push(o); });
  for (const o of drop) { o.removeFromParent(); o.geometry?.dispose?.(); }
  return g;
}
