// Held models for the bag kinds held-items.js has no mesh of its own for (own art, no assets). ES module.
// buildHeldModel(T, kind) -> { model, key, shared } | null
//   model:  a fresh Object3D (any scale; held-items.js fits it to the hand), lights / points / sprites / lines and
//           hidden helper meshes removed, so it never adds lights to the camera or skews its bounds.
//   key:    names the source mesh ('world:kiln', 'icon:stone', 'prop:meal_stew'); no two kinds share one.
//   shared: true when the builder caches geometry, materials or textures module-wide (never dispose them).
// Placed gear reuses its in-world model; ores, ingots and other icon-model kinds reuse the very model the 3D
// inventory icon is rendered from; everything else is a small low-poly prop drawn to match its inventory icon.
// HELD_SPEC[kind] = { size (max dim in metres), grip ([fx, fy, fz] fraction of the fitted size), hold (pose) }.
import { buildIconModel, ICON_MODEL_KINDS } from './icon-models.js?build=v3-survival-ae77fa84ac2b';
import { buildDecorPack } from './decor-pack-models.js?build=v3-survival-ae77fa84ac2b';
import { buildKiln, buildGlassLamp } from './kiln-model.js?build=v3-survival-ae77fa84ac2b';
import { stormMaterials, shardGeometry, buildRod, buildLamp, buildStormGlass } from './storm-model.js?build=v3-survival-ae77fa84ac2b';
import { vertexMaterial, eggGeometry, nestBoxModel, cushionModel, goatPenModel } from './animals-models.js?build=v3-survival-ae77fa84ac2b';
import { buildMotor, buildWheel } from './engine-models.js?build=v3-survival-ae77fa84ac2b';
import { buildBed } from './sleep-model.js?build=v3-survival-ae77fa84ac2b';
import { buildShellWreath, buildGlassFloat } from './trader-model.js?build=v3-survival-ae77fa84ac2b';
import { buildCookpot } from './cookpot-model.js?build=v3-survival-ae77fa84ac2b';
import { buildCourseModels } from './buoycourse-model.js?build=v3-survival-ae77fa84ac2b';
import { buildGameTable } from './gametable-model.js?build=v3-survival-ae77fa84ac2b';
import { buildFlagModel } from './flags-model.js?build=v3-survival-ae77fa84ac2b';
import { createCropPlot } from './crops-model.js?build=v3-survival-ae77fa84ac2b';
import { createPerch } from './gull-models.js?build=v3-survival-ae77fa84ac2b';
import { createJuicerModel } from './juicer-model.js?build=v3-survival-ae77fa84ac2b';
import { createTurbine, createBattery, createStringLights, createLampPost } from './power-model.js?build=v3-survival-ae77fa84ac2b';
import { createFishTrap } from './fish-trap-model.js?build=v3-survival-ae77fa84ac2b';
import { createShelf, createTrophyStand } from './display-model.js?build=v3-survival-ae77fa84ac2b';
import { createTaskBoard } from './tasks-model.js?build=v3-survival-ae77fa84ac2b';
import { buildFrameModel } from './camera-models.js?build=v3-survival-ae77fa84ac2b';
import { createMapTableModel } from './maptable-model.js?build=v3-survival-ae77fa84ac2b';
import { createRecyclerModel } from './recycler-model.js?build=v3-survival-ae77fa84ac2b';
import { createDriftboard } from './paddleboard-model.js?build=v3-survival-ae77fa84ac2b';

// ---------------------------------------------------------------- placed gear: the in-world model
const flat = (T) => (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.85 });
const WORLD = {
  pennant: (T) => buildDecorPack(T).instance('pennant'),
  fern: (T) => buildDecorPack(T).instance('fern'), chime: (T) => buildDecorPack(T).instance('chime'),
  hammock: (T) => buildDecorPack(T).instance('hammock'), pots: (T) => buildDecorPack(T).instance('pots'),
  sign: (T) => buildDecorPack(T).instance('sign'),
  kiln: (T) => buildKiln(T).instance(), glasslamp: (T) => buildGlassLamp(T).instance(),
  stormrod: (T) => buildRod(T, stormMaterials(T)).instance(), stormlamp: (T) => buildLamp(T, stormMaterials(T)).instance(),
  stormglass: (T) => buildStormGlass(T, stormMaterials(T)).instance(),
  nestbox: (T) => nestBoxModel(T), cushion: (T) => cushionModel(T), goatpen: (T) => goatPenModel(T),
  motor: (T) => buildMotor(T, flat(T)).instance(), wheel: (T) => buildWheel(T, flat(T)).instance(),
  bed: (T) => buildBed(T).instance(),
  shellwreath: (T) => buildShellWreath(T).instance(), glassfloat: (T) => buildGlassFloat(T).instance(),
  cookpot: (T) => buildCookpot(T).instance(),
  courseflag: (T) => buildCourseModels(T).flag(), scoreboard: (T) => buildCourseModels(T).scoreboard(),
  gametable: (T) => buildGameTable(T).instance(),
  cropplot: (T) => createCropPlot(T), perch: (T) => createPerch(T), juicer: (T) => createJuicerModel(T),
  turbine: (T) => createTurbine(T), battery: (T) => createBattery(T), stringlights: (T) => createStringLights(T), lamppost: (T) => createLampPost(T),
  fishtrap: (T) => createFishTrap(T), shelf: (T) => createShelf(T), trophystand: (T) => createTrophyStand(T),
  taskboard: (T) => createTaskBoard(T), photoframe: (T) => buildFrameModel(T), maptable: (T) => createMapTableModel(T),
  recycler: (T) => createRecyclerModel(T), driftboard: (T) => createDriftboard(T, flat(T)(0xc4a46c)),
};
// Builders that cache geometry, materials or textures module-wide: their meshes must never be disposed.
const SHARED = new Set(['maptable', 'recycler', 'driftboard', 'photoframe']);
// Icon-model kinds that are placed on the raft (the rest are hand items: ores, ingots, food, parts).
const ICON_PLACED = ['smelter', 'researchtable', 'grill', 'research', 'receiver', 'antenna', 'purifier', 'rainbarrel', 'sprinkler'];
export const HELD_PLACEABLE = Object.freeze([...Object.keys(WORLD).filter((k) => k !== 'driftboard'), 'rug', 'flagpole', ...ICON_PLACED]); // rug, flagpole: placed props

// ---------------------------------------------------------------- low-poly props (match the inventory icons)
function kit(T) {
  const g = new T.Group(), mats = new Map();
  const mat = (color, o = {}) => {
    const key = color + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...o }));
    return mats.get(key);
  };
  const add = (geo, m, p = [0, 0, 0], r = [0, 0, 0], s = null, parent = g) => {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(p[0], p[1], p[2]); mesh.rotation.set(r[0], r[1], r[2]);
    if (s) mesh.scale.set(s[0], s[1], s[2]);
    parent.add(mesh); return mesh;
  };
  const lathe = (pts, seg = 14) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), seg);
  return { g, mat, add, lathe };
}
const OUT = '#153e49'; // icon outline colour, used for dark trims

// Wooden pail with two teal hoops and a wire bail; milk fills it to the brim.
function pail(T, milk) {
  const { g, mat, add, lathe } = kit(T);
  const wood = mat('#b5824f', { flatShading: false });
  add(lathe([[0, 0], [0.085, 0], [0.1, 0.17], [0.092, 0.17], [0.078, 0.012], [0, 0.012]], 16), wood);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(new T.BoxGeometry(0.004, 0.168, 0.006), mat('#7a5230'), [Math.sin(a) * 0.093, 0.085, Math.cos(a) * 0.093], [0, a, Math.sin(a) * -0.05]); }
  for (const y of [0.045, 0.13]) add(new T.TorusGeometry(0.088 + y * 0.075, 0.006, 5, 22), mat('#54a6a4', { metalness: 0.3 }), [0, y, 0], [Math.PI / 2, 0, 0]);
  add(new T.TorusGeometry(0.1, 0.005, 5, 18, Math.PI), mat('#6d8496', { metalness: 0.5, roughness: 0.4 }), [0, 0.17, 0]);
  add(new T.CircleGeometry(0.09, 16), milk ? mat('#fbf8ef', { roughness: 0.35, flatShading: false }) : mat('#5e3d22'), [0, milk ? 0.158 : 0.02, 0], [-Math.PI / 2, 0, 0]);
  if (milk) add(new T.SphereGeometry(0.012, 8, 6), mat('#fbf8ef', { flatShading: false }), [0.096, 0.13, 0.03], [0, 0, 0], [0.8, 1.6, 0.8]);
  return g;
}

// Paint tin: cream can, coloured band and lid, a drip down the side.
function paintTin(T, color) {
  const { g, mat, add } = kit(T);
  const can = mat('#fff2cc', { metalness: 0.2, roughness: 0.5, flatShading: false }), paint = mat(color, { roughness: 0.35, flatShading: false });
  add(new T.CylinderGeometry(0.06, 0.06, 0.11, 18), can, [0, 0.055, 0]);
  add(new T.CylinderGeometry(0.0615, 0.0615, 0.04, 18, 1, true), paint, [0, 0.05, 0]);
  add(new T.CylinderGeometry(0.062, 0.062, 0.008, 18), mat('#c9c3b8', { metalness: 0.5, roughness: 0.4 }), [0, 0.112, 0]);
  add(new T.CylinderGeometry(0.048, 0.048, 0.004, 18), paint, [0, 0.117, 0]);
  add(new T.CapsuleGeometry(0.007, 0.03, 3, 6), paint, [0.04, 0.085, 0.044], [0, 0, 0]);
  return g;
}

// Driftwood bowl; with a meal, its filling and a few bits floating in it.
function bowl(T, fill = null, bits = [], extra = null) {
  const { g, mat, add, lathe } = kit(T);
  add(lathe([[0, 0], [0.035, 0], [0.04, 0.012], [0.09, 0.05], [0.1, 0.075], [0.092, 0.075], [0.08, 0.05], [0.03, 0.02], [0, 0.02]], 18), mat('#8a5a33', { flatShading: false }));
  add(new T.TorusGeometry(0.096, 0.005, 5, 22), mat('#a8743f'), [0, 0.075, 0], [Math.PI / 2, 0, 0]);
  if (fill) add(new T.CircleGeometry(0.088, 18), mat(fill, { roughness: 0.35, flatShading: false }), [0, 0.066, 0], [-Math.PI / 2, 0, 0]);
  bits.forEach(([c, x, z, s = 1], i) => add(new T.DodecahedronGeometry(0.012 * s, 0), mat(c), [x, 0.068, z], [i, i * 2, 0], [1, 0.6, 1]));
  if (extra) extra({ g, mat, add });
  return g;
}

// Tall tapered cup with a drink and a straw (Juicer drinks): the drink colour shows through a thin pale shell.
function drinkCup(T, drink, straw, cherry = null) {
  const { g, mat, add } = kit(T);
  add(new T.CylinderGeometry(0.048, 0.039, 0.115, 16), mat(drink, { roughness: 0.3, flatShading: false }), [0, 0.0575, 0]);
  add(new T.CylinderGeometry(0.05, 0.048, 0.018, 16, 1, true), mat('#eef6f4', { roughness: 0.3, flatShading: false }), [0, 0.124, 0]);
  add(new T.TorusGeometry(0.05, 0.003, 4, 18), mat('#ffffff'), [0, 0.133, 0], [Math.PI / 2, 0, 0]);
  add(new T.CircleGeometry(0.046, 16), mat(drink, { roughness: 0.15, flatShading: false }), [0, 0.118, 0], [-Math.PI / 2, 0, 0]);
  add(new T.BoxGeometry(0.008, 0.08, 0.003), mat('#ffffff', { roughness: 0.2 }), [-0.03, 0.06, 0.036], [0, -0.6, 0]); // glint
  add(new T.CylinderGeometry(0.004, 0.004, 0.16, 6), mat(straw), [0.016, 0.13, 0], [0, 0, -0.2]);
  if (cherry) add(new T.SphereGeometry(0.012, 8, 6), mat(cherry, { flatShading: false }), [-0.022, 0.135, 0.01]);
  return g;
}

// Shark steak: a thick pink slab with a grey skin edge and white fat lines; cooked = browned with grill marks.
function sharkSteak(T, cooked) {
  const { g, mat, add } = kit(T);
  const slab = new T.CylinderGeometry(0.07, 0.074, 0.04, 9); slab.scale(1.35, 1, 0.9);
  add(slab, mat(cooked ? '#b8653a' : '#e88a8a'), [0, 0.02, 0]);
  add(new T.CylinderGeometry(0.076, 0.076, 0.042, 9, 1, true, Math.PI * 0.7, Math.PI * 0.8), mat(cooked ? '#5b4a40' : '#6d8496', { side: T.DoubleSide, forceSinglePass: true }), [0, 0.02, 0], [0, 0, 0], [1.37, 1, 0.92]);
  for (const [x, z, r] of [[-0.02, 0.01, 0.3], [0.03, -0.015, -0.4]]) add(new T.BoxGeometry(0.06, 0.003, 0.006), mat(cooked ? '#e8c08a' : '#fbe9e4'), [x, 0.041, z], [0, r, 0]);
  if (cooked) for (let i = -1; i <= 1; i++) add(new T.BoxGeometry(0.01, 0.004, 0.1), mat('#4a2a18'), [i * 0.035, 0.042, 0], [0, 0.5, 0]);
  return g;
}

const PROPS = {
  flagpole: (T) => { // the raft's flagpole with the icon's golden flag and blue emblem (the world flag is painted per raft at runtime)
    const g = buildFlagModel(T).instance(), { mat, add } = kit(T);
    const cloth = new T.PlaneGeometry(1.1, 0.7, 6, 1), p = cloth.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.55) * 5) * 0.05);
    cloth.computeVertexNormals();
    add(cloth, mat('#f1c84d', { side: T.DoubleSide, forceSinglePass: true }), [0.6, 2.95, 0], [0, 0, 0], null, g);
    add(new T.CircleGeometry(0.17, 12), mat('#24456b', { side: T.DoubleSide, forceSinglePass: true }), [0.6, 2.95, 0.06], [0, 0, 0], [1.2, 1, 1], g);
    return g;
  },
  rug: (T) => { // the woven deck mat rolled up for carrying: green and tan bands, the spiral showing at each end
    const { g, mat, add } = kit(T);
    const Z = [0, 0, Math.PI / 2];
    add(new T.CylinderGeometry(0.05, 0.05, 0.3, 14), mat('#7fae5a'), [0, 0, 0], Z);
    for (const x of [-0.11, -0.04, 0.04, 0.11]) add(new T.CylinderGeometry(0.052, 0.052, 0.02, 14), mat('#c9a96b'), [x, 0, 0], Z);
    for (const s of [-1, 1]) [[0.05, '#6f9a4e'], [0.038, '#c9a96b'], [0.026, '#7fae5a'], [0.014, '#d8bb7c']].forEach(([r, c], i) =>
      add(new T.CircleGeometry(r, 14), mat(c), [s * (0.1505 + i * 0.0005), 0, 0], [0, s * Math.PI / 2, 0]));
    add(new T.BoxGeometry(0.28, 0.006, 0.07), mat('#6f9a4e'), [0, -0.047, 0.04], [0.25, 0, 0]);
    return g;
  },
  sinker: (T) => { // dark lead teardrop with a wire eye
    const { g, mat, add, lathe } = kit(T);
    add(lathe([[0, 0], [0.02, 0.006], [0.032, 0.03], [0.026, 0.06], [0.01, 0.085], [0, 0.09]], 10), mat('#5d666c', { metalness: 0.6, roughness: 0.45 }));
    add(new T.TorusGeometry(0.012, 0.003, 5, 12), mat('#c6d6e0', { metalness: 0.7, roughness: 0.3 }), [0, 0.1, 0]);
    return g;
  },
  stormshard: (T) => { // three ice-blue crystals on a little rock
    const { g, mat, add } = kit(T);
    const m = new T.MeshStandardMaterial({ color: 0x8fd0f5, vertexColors: true, flatShading: true, roughness: 0.25, emissive: 0x3fa8e8, emissiveIntensity: 0.45 });
    const geo = shardGeometry(T);
    add(geo, m, [0, 0.02, 0], [0, 0, 0.05], [1, 1.25, 1]);
    add(geo, m, [-0.05, 0.01, 0.01], [0, 1, 0.35], [0.7, 0.85, 0.7]);
    add(geo, m, [0.048, 0.008, -0.01], [0, 2, -0.3], [0.65, 0.75, 0.65]);
    add(new T.DodecahedronGeometry(0.05, 0), mat('#6f6a66'), [0, -0.012, 0], [0, 0, 0], [1.6, 0.45, 1]);
    return g;
  },
  puffegg: (T) => new T.Mesh(eggGeometry(T), vertexMaterial(T)),
  feather: (T) => { // cream vane on a quill, a gold tip
    const { g, mat, add } = kit(T);
    add(new T.CylinderGeometry(0.0025, 0.004, 0.2, 6), mat('#8a6a45'), [0, 0, 0]);
    const v = new T.SphereGeometry(0.03, 12, 8); v.scale(1, 2.6, 0.2);
    add(v, mat('#fff2cc', { side: T.DoubleSide }), [0.012, 0.025, 0], [0, 0, -0.08]);
    const t = new T.SphereGeometry(0.018, 10, 6); t.scale(1, 1.8, 0.2);
    add(t, mat('#ffbd66'), [0.017, 0.085, 0.002], [0, 0, -0.1]);
    for (let i = 0; i < 4; i++) add(new T.BoxGeometry(0.03, 0.002, 0.004), mat('#e8d6a8'), [0.016, -0.02 + i * 0.025, 0.007], [0, 0, 0.5]);
    return g;
  },
  metalhook: (T) => { // the icon's steel grapple (icon-models.js), with the shaft run down into the crown of the arms
    const { g, mat, add } = kit(T);
    const m = mat('#9fb1bf', { metalness: 0.7, roughness: 0.3, flatShading: false });
    add(new T.CylinderGeometry(0.05, 0.05, 1.22, 10), m, [0, -0.11, 0]);
    add(new T.TorusGeometry(0.12, 0.035, 8, 16), m, [0, 0.6, 0]);
    add(new T.TorusGeometry(0.32, 0.045, 8, 20, Math.PI), m, [0, -0.36, 0], [0, 0, Math.PI]);
    add(new T.ConeGeometry(0.08, 0.18, 6), m, [-0.32, -0.28, 0], [0, 0, 0.3]);
    add(new T.ConeGeometry(0.08, 0.18, 6), m, [0.32, -0.28, 0], [0, 0, -0.3]);
    add(new T.TorusGeometry(0.1, 0.03, 6, 12), mat('#c99a5c'), [0, 0.6, 0.12], [Math.PI / 2, 0, 0]);
    add(new T.CylinderGeometry(0.058, 0.058, 0.3, 10), mat('#5b4a40', { roughness: 0.85 }), [0, 0.3, 0]); // leather grip under the fist
    return g;
  },
  bucket: (T) => pail(T, false),
  milk: (T) => pail(T, true),
  paint_seafoam: (T) => paintTin(T, '#9fd3c1'), paint_coral: (T) => paintTin(T, '#e9a08c'),
  paint_sunshell: (T) => paintTin(T, '#f1d78d'), paint_lagoon: (T) => paintTin(T, '#86b3d6'), paint_pebble: (T) => paintTin(T, '#c9c3b8'),
  fins: (T) => { // a pair of teal flippers with ribs and heel straps
    const { g, mat, add } = kit(T);
    for (const s of [-1, 1]) {
      const f = new T.Group(); f.position.set(s * 0.04, 0, 0); f.rotation.z = s * 0.12; g.add(f);
      const blade = new T.CylinderGeometry(0.045, 0.02, 0.2, 10, 1); blade.scale(1, 1, 0.18);
      add(blade, mat('#2f8a8a'), [0, 0.03, 0], [0, 0, 0], null, f);
      for (const x of [-0.02, 0, 0.02]) add(new T.BoxGeometry(0.004, 0.17, 0.012), mat('#1f6a6a'), [x, 0.04, 0], [0, 0, x * 2], null, f);
      add(new T.TorusGeometry(0.022, 0.005, 5, 12), mat('#9fd6d0'), [0, -0.085, 0], [Math.PI / 2, 0, 0], null, f);
    }
    return g;
  },
  airjug: (T) => { // cream round jug, teal band, cork and a rope loop
    const { g, mat, add, lathe } = kit(T);
    add(lathe([[0, 0], [0.055, 0.005], [0.07, 0.05], [0.06, 0.1], [0.025, 0.125], [0.02, 0.14], [0, 0.14]], 16), mat('#fff2cc', { flatShading: false, roughness: 0.4 }));
    add(new T.TorusGeometry(0.067, 0.005, 5, 20), mat('#54a6a4'), [0, 0.06, 0], [Math.PI / 2, 0, 0]);
    add(new T.CylinderGeometry(0.018, 0.016, 0.03, 10), mat('#b5875a'), [0, 0.15, 0]);
    add(new T.TorusGeometry(0.028, 0.006, 5, 12), mat('#c99a5c'), [0.062, 0.1, 0], [0, 0, 0.4]);
    return g;
  },
  goggles: (T) => { // two teal lenses in dark rims, a bridge and strap ends
    const { g, mat, add } = kit(T);
    for (const x of [-0.04, 0.04]) {
      add(new T.TorusGeometry(0.03, 0.008, 6, 16), mat(OUT), [x, 0, 0]);
      add(new T.CircleGeometry(0.03, 16), mat('#54a6a4', { roughness: 0.1, metalness: 0.2 }), [x, 0, 0.002]);
      add(new T.CircleGeometry(0.01, 8), mat('#c6f0ee', { roughness: 0.1 }), [x - 0.01, 0.01, 0.004]);
    }
    add(new T.BoxGeometry(0.03, 0.008, 0.008), mat(OUT), [0, 0.006, 0]);
    for (const s of [-1, 1]) add(new T.BoxGeometry(0.03, 0.014, 0.006), mat('#a8743f'), [s * 0.083, 0.004, -0.008], [0, s * 0.5, 0]);
    return g;
  },
  scraper: (T) => { // flat grey blade on a dark handle
    const { g, mat, add } = kit(T);
    add(new T.CylinderGeometry(0.011, 0.013, 0.11, 8), mat(OUT), [0, 0, 0]);
    add(new T.CylinderGeometry(0.014, 0.014, 0.012, 8), mat('#9fb1bf', { metalness: 0.5 }), [0, 0.06, 0]);
    add(new T.BoxGeometry(0.05, 0.075, 0.005), mat('#9fb1bf', { metalness: 0.6, roughness: 0.35 }), [0, 0.1, 0]);
    add(new T.BoxGeometry(0.052, 0.008, 0.006), mat('#c6d6e0', { metalness: 0.7, roughness: 0.25 }), [0, 0.138, 0]);
    return g;
  },
  shell: (T) => { // peach scallop: a ribbed fan rising from a little hinge
    const { g, mat, add } = kit(T);
    const fan = new T.CircleGeometry(0.06, 16, Math.PI * 0.1, Math.PI * 0.8);
    add(fan, mat('#f6c9b0', { side: T.DoubleSide, forceSinglePass: true }), [0, 0, 0]);
    add(new T.CircleGeometry(0.058, 16, Math.PI * 0.1, Math.PI * 0.8), mat('#e9a08c', { side: T.DoubleSide, forceSinglePass: true }), [0, 0, -0.008]);
    for (let i = 0; i < 7; i++) { const a = Math.PI * (0.18 + i * 0.107); add(new T.BoxGeometry(0.05, 0.004, 0.006), mat('#e9a08c'), [Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.003], [0, 0, a]); }
    add(new T.BoxGeometry(0.034, 0.014, 0.012), mat('#e9a08c'), [0, 0.002, -0.002]);
    return g;
  },
  bowl: (T) => bowl(T),
  meal_chowder: (T) => bowl(T, '#f3e3c0', [['#e8792e', 0.03, 0.02], ['#e8792e', -0.03, -0.01], ['#fff8e6', 0, -0.035, 1.3]]),
  meal_omelette: (T) => bowl(T, null, [], ({ mat, add }) => {
    const o = new T.SphereGeometry(0.075, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2); o.scale(1, 0.55, 0.7);
    add(o, mat('#f7d24a', { flatShading: false }), [0, 0.05, 0]); add(new T.SphereGeometry(0.01, 6, 4), mat('#3f7a3a'), [0.02, 0.09, 0.01]); add(new T.SphereGeometry(0.008, 6, 4), mat('#d9483b'), [-0.025, 0.088, -0.01]);
  }),
  meal_broth: (T) => bowl(T, '#7fae7a', [['#2f6a3a', 0.035, 0.01, 1.4], ['#2f6a3a', -0.02, 0.03, 1.2], ['#2f6a3a', -0.01, -0.035]]),
  meal_fishbowl: (T) => bowl(T, '#d9b07a', [], ({ mat, add }) => {
    const f = new T.SphereGeometry(0.03, 10, 6); f.scale(1.6, 0.6, 0.7);
    add(f, mat('#c98a4a'), [0, 0.074, 0], [0, 0.4, 0]); add(new T.ConeGeometry(0.018, 0.03, 4), mat('#c98a4a'), [-0.055, 0.074, -0.022], [0, 0.4, Math.PI / 2], [1, 1, 0.4]);
    add(new T.BoxGeometry(0.004, 0.006, 0.03), mat('#3a2414'), [0, 0.09, 0], [0, 0.4, 0]);
  }),
  meal_custard: (T) => bowl(T, '#fbe7a8', [['#ffffff', 0.025, 0.02], ['#ffffff', -0.03, 0.01], ['#a8743f', 0, -0.03, 0.8]]),
  meal_stew: (T) => bowl(T, '#e8792e', [['#8a4a2a', 0.03, 0.02, 1.3], ['#8a4a2a', -0.035, -0.005, 1.2], ['#f2c14e', 0.005, -0.035], ['#3f7a3a', -0.01, 0.035]]),
  sharkmeat: (T) => sharkSteak(T, false),
  cookedsharkmeat: (T) => sharkSteak(T, true),
  sharkhead: (T) => { // grey shark head side-on like the icon: blunt snout, open jaw with a row of white teeth, eye, gills
    const { g, mat, add } = kit(T);
    const grey = mat('#6d8496'), belly = mat('#e8e6dc');
    const h = new T.SphereGeometry(0.08, 14, 10); h.scale(1.45, 0.62, 0.7);
    add(h, grey, [0, 0.03, 0]);
    const j = new T.SphereGeometry(0.07, 12, 8); j.scale(1.3, 0.4, 0.62);
    add(j, belly, [0.012, -0.02, 0]);
    add(new T.BoxGeometry(0.1, 0.016, 0.09), mat('#5a2a2a'), [0.04, 0.004, 0], [0, 0, -0.06]);                 // open mouth
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) add(new T.ConeGeometry(0.006, 0.016, 3), mat('#ffffff'), [0.012 + i * 0.016, 0.0, s * (0.03 - i * 0.003)], [Math.PI, 0, 0]);
    for (let i = 0; i < 5; i++) add(new T.ConeGeometry(0.005, 0.013, 3), mat('#ffffff'), [0.018 + i * 0.018, -0.008, 0.036 - i * 0.004]);
    for (const z of [-0.052, 0.052]) add(new T.SphereGeometry(0.009, 8, 6), mat('#111111', { flatShading: false }), [0.06, 0.05, z]);
    add(new T.ConeGeometry(0.035, 0.07, 4), mat('#5d7183'), [-0.04, 0.1, 0], [0, 0, 0.35], [1, 1, 0.3]);
    for (let i = 0; i < 3; i++) for (const z of [-0.055, 0.055]) add(new T.BoxGeometry(0.004, 0.04, 0.004), mat('#45566a'), [-0.035 - i * 0.014, 0.03, z]);
    return g;
  },
  berries: (T) => { // five red berries on a green stalk with a leaf
    const { g, mat, add } = kit(T);
    const berry = mat('#c8304a', { flatShading: false, roughness: 0.3 });
    [[0, 0, 0], [0.028, 0.005, 0.01], [-0.028, 0.004, 0.006], [0.012, 0.03, -0.004], [-0.014, 0.028, 0.012]].forEach((p) => add(new T.SphereGeometry(0.016, 10, 8), berry, p));
    add(new T.CylinderGeometry(0.002, 0.002, 0.04, 4), mat('#3f7a3a'), [0, 0.055, 0], [0, 0, 0.3]);
    const l = new T.SphereGeometry(0.016, 8, 4); l.scale(1.6, 0.25, 0.7);
    add(l, mat('#5fae3a'), [0.018, 0.07, 0], [0, 0, 0.4]);
    return g;
  },
  cookedbeet: (T) => { // dark red roasted beet with char stripes and steam-curled stalk stub
    const { g, mat, add } = kit(T);
    const b = new T.SphereGeometry(0.045, 12, 10); b.scale(1, 1.05, 1);
    add(b, mat('#7a1f35'), [0, 0, 0]);
    add(new T.ConeGeometry(0.025, 0.04, 8), mat('#7a1f35'), [0, -0.05, 0], [Math.PI, 0, 0]);
    for (let i = -1; i <= 1; i++) add(new T.BoxGeometry(0.007, 0.05, 0.006), mat('#3a0e18'), [i * 0.02, 0, 0.042 - Math.abs(i) * 0.008], [0, i * -0.45, 0.5]);
    add(new T.CylinderGeometry(0.006, 0.008, 0.02, 6), mat('#5a4a2a'), [0, 0.05, 0]);
    return g;
  },
  cookedpotato: (T) => { // baked potato split open, butter in the middle
    const { g, mat, add } = kit(T);
    const p = new T.SphereGeometry(0.05, 12, 8); p.scale(1.4, 0.75, 0.95);
    add(p, mat('#a8652f'), [0, 0, 0]);
    const o = new T.SphereGeometry(0.04, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); o.scale(1.3, 0.35, 0.55);
    add(o, mat('#f2c14e', { flatShading: false }), [0, 0.03, 0]);
    add(new T.BoxGeometry(0.018, 0.01, 0.018), mat('#fff2a8'), [0.005, 0.045, 0], [0, 0.6, 0]);
    return g;
  },
  berrycup: (T) => drinkCup(T, '#c8304a', '#ff7aa2'),
  coconutcup: (T) => drinkCup(T, '#f3ece0', '#54a6a4'),
  mixcup: (T) => drinkCup(T, '#e8875a', '#ffbd66', '#d9483b'),
  armor: (T) => { // riveted grey-blue deck plate with a bent lip
    const { g, mat, add } = kit(T);
    add(new T.BoxGeometry(0.16, 0.13, 0.01), mat('#9fb1bf', { metalness: 0.55, roughness: 0.4 }), [0, 0, 0]);
    add(new T.BoxGeometry(0.16, 0.022, 0.012), mat('#c6d6e0', { metalness: 0.6, roughness: 0.3 }), [0, 0.07, 0.008], [-0.5, 0, 0]);
    add(new T.BoxGeometry(0.006, 0.12, 0.012), mat('#6d8496', { metalness: 0.5 }), [0, -0.005, 0.004]);
    for (const x of [-0.06, 0.06]) for (const y of [-0.04, 0.03]) add(new T.SphereGeometry(0.008, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('#6d8496', { metalness: 0.6 }), [x, y, 0.005], [Math.PI / 2, 0, 0]);
    return g;
  },
};

// How each prop sits in the hand: max size (m), grip point (fraction of the fitted size), and the HOLD entry.
const CUP = { size: 0.12, grip: [0, -0.4, 0], hold: { hand: 'right', pose: 'grip', rx: 0.55, ry: 0.3 } };
const WATER = { size: 0.1, grip: [0, -0.4, 0], hold: { hand: 'right', pose: 'grip', rx: 0.6, ry: 0.3 } }; // icon-model cups: a wide brim, so a touch smaller
const BOWL = { size: 0.15, grip: [0, -0.8, 0], hold: { hand: 'right', pose: 'grip', rx: 0.25, ry: 0.3, arm: [-0.01, 0.03, 0] } };
const TIN = { size: 0.11, grip: [0, -0.36, 0], hold: { hand: 'right', pose: 'grip', rx: 0.5, ry: 0.4 } }; // tipped so the paint-coloured lid shows
const LUMP = (size) => ({ size, grip: [0, -0.62, 0], hold: { hand: 'right', pose: 'grip', rx: 0.2, ry: 0.4, arm: [0, 0.02, 0] } });
export const HELD_SPEC = Object.freeze({
  sinker: LUMP(0.08), stormshard: LUMP(0.11), puffegg: LUMP(0.08), cookedbeet: LUMP(0.1), cookedpotato: LUMP(0.11), berries: LUMP(0.09),
  sharkmeat: { size: 0.17, grip: [0.3, -0.2, 0], hold: { hand: 'right', pose: 'grip', rx: 1.2, ry: 0.3, arm: [-0.01, 0.04, 0] } },
  cookedsharkmeat: { size: 0.17, grip: [0.3, -0.2, 0], hold: { hand: 'right', pose: 'grip', rx: 1.2, ry: 0.3, arm: [-0.01, 0.04, 0] } },
  sharkhead: { size: 0.21, grip: [-0.3, -0.35, 0], hold: { hand: 'right', pose: 'grip', ry: 3.54, arm: [-0.02, 0.05, 0] } },
  feather: { size: 0.17, grip: [0, -0.42, 0], hold: { hand: 'right', pose: 'grip', rx: -0.3, rz: 0.4 } },
  bucket: { size: 0.16, grip: [0, -0.3, 0], hold: { hand: 'right', pose: 'grip', rx: 0.35, ry: 0.4, arm: [-0.01, 0.03, 0] } },
  milk: { size: 0.16, grip: [0, -0.3, 0], hold: { hand: 'right', pose: 'grip', rx: 0.35, ry: 0.4, arm: [-0.01, 0.03, 0] } },
  paint_seafoam: TIN, paint_coral: TIN, paint_sunshell: TIN, paint_lagoon: TIN, paint_pebble: TIN,
  fins: { size: 0.17, grip: [0, -0.4, 0], hold: { hand: 'right', pose: 'grip', rx: -0.7, ry: 0.5, rz: 0.4 } },
  airjug: { size: 0.13, grip: [0, -0.25, 0], hold: { hand: 'right', pose: 'grip', ry: 0.4 } },
  goggles: { size: 0.17, grip: [0.4, 0, 0], hold: { hand: 'right', pose: 'grip', ry: 0.4, arm: [-0.01, 0.05, 0] } },
  scraper: { size: 0.16, grip: [0, -0.3, 0], hold: { hand: 'right', pose: 'grip', rx: -0.4, rz: 0.3 } },
  shell: { size: 0.12, grip: [0, -0.62, 0], hold: { hand: 'right', pose: 'grip', rx: 0.2, ry: 0.4 } },
  bowl: BOWL, meal_chowder: BOWL, meal_omelette: BOWL, meal_broth: BOWL, meal_fishbowl: BOWL, meal_custard: BOWL, meal_stew: BOWL,
  berrycup: CUP, coconutcup: CUP, mixcup: CUP,
  armor: { size: 0.15, grip: [0.4, 0, 0], hold: { hand: 'right', pose: 'grip', ry: 0.4, arm: [-0.02, 0.04, 0] } },
  driftboard: { size: 0.3, grip: [0, -0.62, 0], hold: { hand: 'right', pose: 'grip', rx: 0.5, ry: 1.97, arm: [0, 0.02, 0] } },
  // icon-model hand items (ores, ingots, food, parts): grip low on the lump so it sits in the fist
  ...Object.fromEntries(ICON_MODEL_KINDS.filter((k) => !ICON_PLACED.includes(k)).map((k) => [k, LUMP(0.11)])),
  saltcup: WATER, freshcup: WATER,
  // the steel grapple of its icon, held like the hook: fist on the shaft below the ring, arms up and forward
  metalhook: { size: 0.22, grip: [0, 0.2, 0], hold: { hand: 'right', pose: 'grip', rx: Math.PI - 0.35, arm: [0.03, -0.025, 0] } },
  binoculars: { size: 0.13, grip: [0.3, 0, 0], hold: { hand: 'right', pose: 'grip', rx: -0.2, ry: 1.5 } },
  cookedfish: { size: 0.2, grip: [0.4, 0, 0], hold: { hand: 'right', pose: 'grip', rx: 0.1, ry: 0.35, rz: 0.25, arm: [-0.02, 0.06, 0] } },
  honeyfish: { size: 0.2, grip: [0.4, 0, 0], hold: { hand: 'right', pose: 'grip', rx: 0.1, ry: 0.35, rz: 0.25, arm: [-0.02, 0.06, 0] } },
});

export const HELD_MODEL_KINDS = Object.freeze([...Object.keys(WORLD), ...Object.keys(PROPS), ...ICON_MODEL_KINDS]);

// Lights, particles, sprites and lines never belong in a hand (a light would also recompile every material);
// hidden helpers (lit-state glows, unplaced shards) would only skew the fitted bounds.
function clean(root) {
  const drop = [];
  root.traverse((o) => { if (o !== root && (o.isLight || o.isPoints || o.isSprite || o.isLine || (o.isMesh && !o.visible))) drop.push(o); });
  for (const o of drop) o.removeFromParent();
  return root;
}

export function buildHeldModel(T, kind) {
  let model = null, key = null;
  if (WORLD[kind]) { model = WORLD[kind](T); key = 'world:' + kind; }
  else if (PROPS[kind]) { model = PROPS[kind](T); key = 'prop:' + kind; }
  else if (ICON_MODEL_KINDS.includes(kind)) { model = buildIconModel(T, kind); key = 'icon:' + kind; }
  if (!model?.isObject3D) return null;
  return { model: clean(model), key, shared: SHARED.has(kind) };
}
