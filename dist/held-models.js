// First-person held models for item kinds held-items.js has no tuned model for. ES module.
// buildHeldModel(T, kind) -> { model, shared } | null
//   model: a fresh Object3D in the item's own units (held-items.js fit() scales and centres it);
//   shared: true when its geometry or materials may be cached and used by world copies (never dispose or retune).
// HELD_HOLD[kind] = { hand, pose, rx, ry, rz, size, grip: [fx, fy, fz] (fraction of the fitted size) }.
// Placeables reuse their own world model (scaled down, on the left fist while the right hand points);
// small resources, food and gear reuse icon-models.js or get a simple low-poly model matching the icon.
// Everything is built once per kind (hands.js caches the held model), never per frame.
import { buildIconModel } from './icon-models.js?build=v3-survival-ae77fa84ac2b';
import { buildDecorPack } from './decor-pack-models.js?build=v3-survival-ae77fa84ac2b';
import { buildKiln, buildGlassLamp } from './kiln-model.js?build=v3-survival-ae77fa84ac2b';
import { stormMaterials, shardGeometry, buildRod, buildLamp, buildStormGlass } from './storm-model.js?build=v3-survival-ae77fa84ac2b';
import { nestBoxModel, cushionModel, goatPenModel } from './animals-models.js?build=v3-survival-ae77fa84ac2b';
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

// ---------------------------------------------------------------- world-model kits (built once per THREE)
const KITS = new WeakMap();
function kits(T) {
  let k = KITS.get(T);
  if (!k) {
    const memo = new Map(), once = (name, fn) => () => { if (!memo.has(name)) memo.set(name, fn()); return memo.get(name); };
    const flat = new Map(), mat = (c) => { if (!flat.has(c)) flat.set(c, new T.MeshStandardMaterial({ color: c, roughness: 0.85 })); return flat.get(c); };
    const storm = once('stormM', () => stormMaterials(T));
    k = {
      pack: once('pack', () => buildDecorPack(T)), kiln: once('kiln', () => buildKiln(T)), lamp: once('lamp', () => buildGlassLamp(T)),
      rod: once('rod', () => buildRod(T, storm())), slamp: once('slamp', () => buildLamp(T, storm())), sglass: once('sglass', () => buildStormGlass(T, storm())),
      motor: once('motor', () => buildMotor(T, mat)), wheel: once('wheel', () => buildWheel(T, mat)), bed: once('bed', () => buildBed(T)),
      wreath: once('wreath', () => buildShellWreath(T)), float: once('float', () => buildGlassFloat(T)), cookpot: once('cookpot', () => buildCookpot(T)),
      course: once('course', () => buildCourseModels(T)), table: once('table', () => buildGameTable(T)), flag: once('flag', () => buildFlagModel(T)),
      storm,
      flagCloth: once('flagCloth', () => new T.MeshStandardMaterial({ color: 0xf1c84d, roughness: 0.9, side: T.DoubleSide })),
      flagDot: once('flagDot', () => new T.CircleGeometry(0.16, 14)), flagDotMat: once('flagDotMat', () => new T.MeshStandardMaterial({ color: 0x24456b, roughness: 0.9, side: T.DoubleSide })),
    };
    KITS.set(T, k);
  }
  return k;
}
// kind -> (T, kits) -> Object3D sharing the kit's geometry and materials
const SHARED = {
  rug: (T, K) => K.pack().instance('rug'), pennant: (T, K) => K.pack().instance('pennant'), fern: (T, K) => K.pack().instance('fern'),
  chime: (T, K) => K.pack().instance('chime'), hammock: (T, K) => K.pack().instance('hammock'), pots: (T, K) => K.pack().instance('pots'),
  sign: (T, K) => K.pack().instance('sign'),
  kiln: (T, K) => K.kiln().instance(), glasslamp: (T, K) => K.lamp().instance(),
  stormrod: (T, K) => K.rod().instance(), stormlamp: (T, K) => K.slamp().instance(), stormglass: (T, K) => K.sglass().instance(),
  motor: (T, K) => K.motor().instance(), wheel: (T, K) => K.wheel().instance(), bed: (T, K) => K.bed().instance(),
  shellwreath: (T, K) => K.wreath().instance(), glassfloat: (T, K) => K.float().instance(), cookpot: (T, K) => K.cookpot().instance(),
  courseflag: (T, K) => K.course().flag(), scoreboard: (T, K) => K.course().scoreboard(),
  gametable: (T, K) => K.table().instance(),
  flagpole: (T, K) => { // flags.js dresses the cloth per tile; the held one wears the icon's yellow flag with a navy shell
    const g = K.flag().instance(), cloth = g.userData.cloth;
    if (cloth) { cloth.material = K.flagCloth(); const dot = new T.Mesh(K.flagDot(), K.flagDotMat()); dot.position.set(0.62, -0.3, 0.01); cloth.add(dot); }
    return g;
  },
};
// kind -> (T) -> a fresh world model the held copy owns
const OWN_WORLD = {
  nestbox: nestBoxModel, cushion: cushionModel, goatpen: goatPenModel, cropplot: createCropPlot, perch: createPerch,
  juicer: createJuicerModel, turbine: createTurbine, battery: createBattery, stringlights: createStringLights, lamppost: createLampPost,
  fishtrap: createFishTrap, shelf: createShelf, trophystand: createTrophyStand, taskboard: createTaskBoard, photoframe: buildFrameModel,
  maptable: createMapTableModel, recycler: createRecyclerModel,
};

// ---------------------------------------------------------------- small low-poly models (own art, matched to the icons)
function kit(T) {
  const g = new T.Group(), mats = new Map();
  const mat = (c, o = {}) => {
    const key = c + JSON.stringify(o);
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, ...o }));
    return mats.get(key);
  };
  const add = (geo, c, p = [0, 0, 0], r = [0, 0, 0], s = null, o) => {
    const m = new T.Mesh(geo, c?.isMaterial ? c : mat(c, o));
    m.position.set(p[0], p[1], p[2]); m.rotation.set(r[0], r[1], r[2]);
    if (s) m.scale.set(s[0], s[1], s[2]);
    g.add(m); return m;
  };
  return { g, mat, add };
}
const lathe = (T, pts, seg = 14) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), seg);
const smooth = { flatShading: false };

// A turned driftwood bowl; stew: tinted surface, bits: [[colour, x, z, r]] floating in it.
const BOWL = [[0, 0], [0.16, 0], [0.17, 0.02], [0.3, 0.1], [0.36, 0.22], [0.37, 0.24], [0.34, 0.24], [0.3, 0.13], [0.15, 0.05], [0, 0.05]];
function bowl(T, stew = null, bits = [], dome = 0) {
  const { g, add } = kit(T);
  add(lathe(T, BOWL, 16), '#a97d4c', [0, 0, 0], [0, 0, 0], null, smooth);
  add(new T.TorusGeometry(0.355, 0.016, 5, 20), '#8a6440', [0, 0.24, 0], [Math.PI / 2, 0, 0]);
  if (stew) add(new T.CylinderGeometry(0.33, 0.3, 0.03 + dome, 16), stew, [0, 0.19 + dome / 2, 0], [0, 0, 0], null, { roughness: 0.35, flatShading: false });
  else add(new T.CircleGeometry(0.29, 16), '#6e4b2c', [0, 0.135, 0], [-Math.PI / 2, 0, 0]);
  for (const [c, x, z, r, h = 1] of bits) add(new T.IcosahedronGeometry(r, 0), c, [x, 0.215 + dome, z], [x * 9, z * 7, 0], [1, h, 1]);
  return g;
}
// Wooden pail with two hoops and a rope bail; milk: filled with milk and a drip down the side.
function pail(T, milk) {
  const { g, add, mat } = kit(T);
  add(lathe(T, [[0, 0], [0.24, 0], [0.3, 0.5], [0.27, 0.5], [0.22, 0.04], [0, 0.04]], 12), '#bb8650');
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new T.BoxGeometry(0.012, 0.5, 0.02), '#8a5e34', [Math.sin(a) * 0.272, 0.25, Math.cos(a) * 0.272], [0.1 * Math.cos(a), a, -0.1 * Math.sin(a)]); }
  for (const [y, r] of [[0.1, 0.255], [0.4, 0.29]]) add(new T.TorusGeometry(r, 0.016, 5, 18), '#4e4a46', [0, y, 0], [Math.PI / 2, 0, 0], null, { metalness: 0.5, roughness: 0.4 });
  add(new T.TorusGeometry(0.29, 0.016, 5, 16, Math.PI), '#e7c48a', [0, 0.5, 0], [0, 0, 0]);
  add(new T.CircleGeometry(0.27, 16), milk ? '#fff6e2' : '#6b4526', [0, milk ? 0.46 : 0.08, 0], [-Math.PI / 2, 0, 0], null, milk ? { roughness: 0.3 } : {});
  if (milk) add(new T.CapsuleGeometry(0.018, 0.08, 3, 6), mat('#fff6e2', { roughness: 0.3 }), [0.29, 0.43, 0.04], [0, 0, 0.1]);
  return g;
}
// Paint pot: cream clay jar, paint band, wet top and a drip.
function paintPot(T, c) {
  const { g, add } = kit(T);
  add(lathe(T, [[0, 0], [0.26, 0], [0.29, 0.06], [0.29, 0.42], [0.25, 0.46], [0.26, 0.5], [0, 0.5]], 16), '#fff2cc', [0, 0, 0], [0, 0, 0], null, smooth);
  add(new T.CylinderGeometry(0.295, 0.295, 0.12, 16, 1, true), c, [0, 0.2, 0], [0, 0, 0], null, smooth);
  add(new T.CylinderGeometry(0.21, 0.21, 0.02, 16), c, [0, 0.505, 0], [0, 0, 0], null, { roughness: 0.2, flatShading: false });
  add(new T.CapsuleGeometry(0.03, 0.14, 3, 6), c, [-0.2, 0.38, 0.2], [0, 0, 0], null, { roughness: 0.2 });
  add(new T.CylinderGeometry(0.03, 0.03, 0.42, 6), '#bb8650', [0.06, 0.62, -0.04], [0.15, 0, -0.35]); // stirring stick
  return g;
}
// Glass cup of juice with a straw.
function juice(T, c, straw) {
  const { g, add } = kit(T);
  add(new T.CylinderGeometry(0.27, 0.22, 0.62, 16, 1, true), '#cfeef0', [0, 0.31, 0], [0, 0, 0], null, { side: T.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0.55, roughness: 0.1, flatShading: false });
  add(new T.CylinderGeometry(0.255, 0.215, 0.46, 16), c, [0, 0.24, 0], [0, 0, 0], null, { roughness: 0.3, flatShading: false });
  add(new T.TorusGeometry(0.27, 0.012, 4, 18), '#e6f6f4', [0, 0.62, 0], [Math.PI / 2, 0, 0]);
  add(new T.CylinderGeometry(0.022, 0.022, 0.62, 6), straw, [0.08, 0.6, 0], [0, 0, -0.22]);
  return g;
}
function berries(T) {
  const { g, add } = kit(T);
  const R = [[-0.14, 0.02, 0.05, 0.12], [0.12, 0.04, 0, 0.12], [0, -0.14, 0.04, 0.13], [0.16, -0.16, -0.04, 0.11], [-0.2, -0.18, -0.02, 0.1], [0.02, 0.0, -0.13, 0.11]];
  R.forEach(([x, y, z, r], i) => {
    add(new T.SphereGeometry(r, 10, 8), i % 2 ? '#c2335a' : '#b02a50', [x, y, z], [0, 0, 0], null, { roughness: 0.3, flatShading: false });
    add(new T.SphereGeometry(r * 0.28, 6, 4), '#ff9fb8', [x - r * 0.4, y + r * 0.45, z + r * 0.5], [0, 0, 0], null, { roughness: 0.2 });
  });
  add(new T.CylinderGeometry(0.012, 0.012, 0.22, 5), '#3f7a3a', [0, 0.2, 0], [0, 0, 0.3]);
  add(new T.SphereGeometry(0.12, 6, 4), '#5fae6b', [0.1, 0.26, 0], [0, 0, 0.4], [1.2, 0.25, 0.6]);
  return g;
}
function egg(T) {
  const { g, add, mat } = kit(T);
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, a = Math.PI * t; pts.push([Math.sin(a) * 0.2 * (1 - 0.18 * t), -Math.cos(a) * 0.27]); }
  add(lathe(T, pts, 16), '#fff2cc', [0, 0, 0], [0, 0, 0], null, { flatShading: false, roughness: 0.5 });
  const sp = mat('#bb8650', { flatShading: false });
  [[0.6, 0.05], [2.1, -0.08], [3.3, 0.12], [4.4, -0.02], [5.5, 0.08], [1.4, 0.16]].forEach(([a, y]) => {
    const r = 0.2 * Math.sqrt(1 - (y / 0.27) ** 2) * 0.98;
    add(new T.SphereGeometry(0.022, 6, 4), sp, [Math.sin(a) * r, y, Math.cos(a) * r], [0, a, 0], [1, 1, 0.35]);
  });
  return g;
}
function feather(T) {
  const { g, add } = kit(T);
  const s = new T.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(0.09, 0.15, 0.12, 0.45, 0.02, 0.8); s.bezierCurveTo(-0.07, 0.55, -0.1, 0.25, 0, 0);
  add(new T.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 8 }), '#fff2cc', [0, 0.12, -0.004], [0, 0, 0], null, { side: T.DoubleSide });
  for (let i = 0; i < 4; i++) add(new T.BoxGeometry(0.008, 0.1, 0.012), '#ffbd66', [0.025, 0.3 + i * 0.12, 0], [0, 0, -0.9]);
  add(new T.CylinderGeometry(0.007, 0.012, 0.92, 5), '#bb8650', [0.005, 0.46, 0], [0, 0, -0.02]);
  return g;
}
function shell(T) {
  const { g, add } = kit(T);
  const s = new T.Shape(), n = 7, a0 = Math.PI * 0.12, a1 = Math.PI * 0.88;
  s.moveTo(0, 0);
  for (let i = 0; i <= n * 4; i++) { const a = a0 + (a1 - a0) * i / (n * 4), r = 0.34 * (1 + 0.04 * Math.cos(i / 4 * Math.PI * 2)); s.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.lineTo(0, 0);
  add(new T.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.03, bevelSegments: 2 }), '#ffd9b8', [0, 0.04, -0.02], [0, 0, 0], null, { roughness: 0.45 });
  for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (i + 0.5) / n; add(new T.BoxGeometry(0.03, 0.27, 0.02), '#e08e74', [Math.cos(a) * 0.19, 0.04 + Math.sin(a) * 0.19, 0.055], [0, 0, a - Math.PI / 2]); }
  add(new T.ConeGeometry(0.09, 0.09, 4), '#f2a98f', [0, 0.0, 0.01], [0, Math.PI / 4, Math.PI], [1, 1, 0.45]);
  return g;
}
function fins(T) {
  const { g, add } = kit(T);
  const s = new T.Shape();
  s.moveTo(-0.08, 0); s.bezierCurveTo(-0.16, 0.3, -0.1, 0.6, 0.02, 0.8); s.bezierCurveTo(0.12, 0.62, 0.16, 0.3, 0.08, 0); s.lineTo(-0.08, 0);
  [['#2f8f8f', -0.13], ['#54a6a4', 0.13]].forEach(([c, x], i) => {
    add(new T.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 }), c, [x, 0, i * 0.06], [0, 0, 0]);
    add(new T.SphereGeometry(0.085, 8, 6), '#fff2cc', [x, 0.04, 0.03 + i * 0.06], [0, 0, 0], [1, 0.75, 0.55]);
    for (const dx of [-0.04, 0.04]) add(new T.BoxGeometry(0.008, 0.5, 0.01), '#1f6b6b', [x + dx, 0.38, 0.045 + i * 0.06]);
  });
  return g;
}
function airjug(T) {
  const { g, add } = kit(T);
  add(lathe(T, [[0, 0], [0.22, 0], [0.28, 0.08], [0.3, 0.26], [0.24, 0.44], [0.12, 0.52], [0.1, 0.56], [0, 0.56]], 16), '#fff2cc', [0, 0, 0], [0, 0, 0], null, { roughness: 0.4, flatShading: false });
  add(new T.CylinderGeometry(0.1, 0.09, 0.1, 10), '#bb8650', [0, 0.6, 0]);
  add(new T.TorusGeometry(0.12, 0.022, 5, 12, Math.PI * 1.2), '#e7b37a', [0.26, 0.32, 0], [0, 0, -1.2]);
  add(new T.TorusGeometry(0.29, 0.014, 4, 18), '#54a6a4', [0, 0.2, 0], [Math.PI / 2, 0, 0]);
  return g;
}
function goggles(T) {
  const { g, add } = kit(T);
  for (const x of [-0.2, 0.2]) {
    add(new T.TorusGeometry(0.15, 0.04, 6, 16), '#54a6a4', [x, 0, 0]);
    add(new T.CircleGeometry(0.14, 16), '#9fd6f0', [x, 0, 0.005], [0, 0, 0], null, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 });
  }
  add(new T.TorusGeometry(0.05, 0.02, 4, 8, Math.PI), '#153e49', [0, 0.04, 0]);
  add(new T.TorusGeometry(0.4, 0.022, 4, 20, Math.PI), '#bb8650', [0, 0, -0.02], [Math.PI / 2, 0, 0], [1, 0.6, 1]);
  return g;
}
function scraper(T) {
  const { g, add } = kit(T);
  add(new T.CylinderGeometry(0.045, 0.05, 0.55, 8), '#bb8650', [0, 0.28, 0]);
  add(new T.TorusGeometry(0.05, 0.012, 4, 10), '#8a5e34', [0, 0.06, 0], [Math.PI / 2, 0, 0]);
  const s = new T.Shape(); s.moveTo(-0.16, 0); s.lineTo(0.16, 0); s.lineTo(0.06, 0.2); s.lineTo(-0.06, 0.2); s.lineTo(-0.16, 0);
  add(new T.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), '#9aa6ad', [0, 0.02, -0.01], [Math.PI, 0, 0], null, { metalness: 0.6, roughness: 0.35 });
  add(new T.BoxGeometry(0.3, 0.015, 0.025), '#e3e9ec', [0, -0.175, 0], [0, 0, 0], null, { metalness: 0.7, roughness: 0.25 });
  return g;
}
function sinker(T) {
  const { g, add } = kit(T);
  add(lathe(T, [[0, 0], [0.06, 0.02], [0.13, 0.12], [0.14, 0.2], [0.1, 0.3], [0.04, 0.36], [0, 0.37]], 12), '#5f666b', [0, 0, 0], [0, 0, 0], null, { metalness: 0.55, roughness: 0.4, flatShading: false });
  add(new T.TorusGeometry(0.045, 0.012, 5, 10), '#c6d6e0', [0, 0.41, 0], [0, 0, 0], null, { metalness: 0.7, roughness: 0.3 });
  return g;
}
function stormshard(T) {
  const { g, add } = kit(T);
  add(shardGeometry(T), new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.25, emissive: 0x7fd8ff, emissiveIntensity: 0.6 }));
  add(new T.BoxGeometry(0.2, 0.02, 0.08), '#c9b27e', [0, -0.005, 0]);
  return g;
}
// Raw or seared shark steak: pink flesh with a grey skin side.
function steak(T, cooked) {
  const { g, add } = kit(T);
  const flesh = cooked ? '#b8693c' : '#d9767a', skin = cooked ? '#6d7880' : '#8a9ba6';
  add(new T.SphereGeometry(0.3, 16, 10), flesh, [0, 0, 0], [0, 0, 0], [1.25, 0.42, 0.9], { flatShading: false, roughness: 0.5 });
  add(new T.SphereGeometry(0.31, 16, 10, Math.PI * 0.55, Math.PI * 0.9), skin, [0, 0, 0], [0, 0, 0], [1.26, 0.44, 0.92], { flatShading: false, side: T.DoubleSide });
  if (cooked) for (let i = 0; i < 3; i++) add(new T.BoxGeometry(0.035, 0.03, 0.42), '#4a2410', [-0.15 + i * 0.15, 0.125, 0.02], [0, 0.5, 0]);
  else for (const r of [0.1, 0.17]) add(new T.TorusGeometry(r, 0.01, 3, 16, Math.PI), '#f0a3a0', [0.03, 0.12, 0.05], [-Math.PI / 2 + 0.25, 0, 0.3], [1.2, 1, 1]);
  return g;
}
function sharkhead(T) {
  const { g, add } = kit(T);
  add(new T.SphereGeometry(0.3, 14, 10), '#7f8f99', [0, 0.05, 0], [0, 0, 0], [1.4, 0.75, 0.85], smooth);
  add(new T.SphereGeometry(0.28, 14, 6), '#eef2f0', [-0.04, -0.06, 0], [0, 0, 0], [1.35, 0.4, 0.8], smooth);
  add(new T.ConeGeometry(0.1, 0.22, 3), '#6d7d87', [0.12, 0.33, 0], [0, 0, -0.35], [1, 1, 0.35]);
  for (let i = 0; i < 6; i++) { const a = -0.8 + i * 0.32; add(new T.ConeGeometry(0.022, 0.05, 3), '#ffffff', [-0.3 + Math.abs(a) * 0.12, -0.04, Math.sin(a) * 0.2], [Math.PI, 0, 0]); }
  for (const z of [-0.2, 0.2]) add(new T.SphereGeometry(0.035, 8, 6), '#153e49', [-0.16, 0.12, z]);
  return g;
}
function cookedbeet(T) {
  const { g, add } = kit(T);
  add(new T.SphereGeometry(0.28, 12, 10), '#7e2438', [0, 0, 0], [0, 0, 0], [1, 1.05, 1], { flatShading: false, roughness: 0.55 });
  add(new T.ConeGeometry(0.1, 0.24, 8), '#7e2438', [0, -0.32, 0], [Math.PI, 0, 0], null, smooth);
  for (let i = 0; i < 3; i++) add(new T.BoxGeometry(0.04, 0.5, 0.03), '#3a0e18', [-0.12 + i * 0.12, 0, 0.27], [0, 0, 0.45], [1, 0.9 - Math.abs(i - 1) * 0.15, 1]);
  add(new T.CylinderGeometry(0.03, 0.04, 0.08, 6), '#4a1a22', [0, 0.3, 0]);
  return g;
}
function cookedpotato(T) {
  const { g, add } = kit(T);
  const geo = new T.IcosahedronGeometry(0.3, 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = 1 + 0.06 * Math.sin(x * 30 + z * 12) * Math.cos(y * 22); p.setXYZ(i, x * 1.35 * d, y * 0.8 * d, z * d); }
  geo.computeVertexNormals();
  add(geo, '#b77a3a', [0, 0, 0], [0, 0, 0], null, { roughness: 0.75 });
  add(new T.SphereGeometry(0.22, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#fbe7a6', [0, 0.17, 0], [0, 0, 0], [1.3, 0.25, 0.6], smooth);
  add(new T.BoxGeometry(0.1, 0.04, 0.08), '#ffd35a', [0.02, 0.24, 0], [0.1, 0.4, 0], null, { roughness: 0.25 });
  return g;
}
function armor(T) {
  const { g, add } = kit(T);
  const m = { metalness: 0.35, roughness: 0.4, side: T.DoubleSide };
  add(new T.CylinderGeometry(0.4, 0.33, 0.6, 16, 1, true, -1.05, 2.1), '#b4c4d0', [0, 0, 0], [0, 0, 0], null, m);       // breastplate
  add(new T.CylinderGeometry(0.405, 0.405, 0.05, 16, 1, true, -1.05, 2.1), '#c6d6e0', [0, 0.29, 0], [0, 0, 0], null, m); // rolled top edge
  add(new T.CylinderGeometry(0.34, 0.34, 0.07, 16, 1, true, -1.05, 2.1), '#7a5232', [0, -0.27, 0.005]);                 // leather belt
  add(new T.BoxGeometry(0.03, 0.58, 0.03), '#6d8496', [0, 0, 0.375], [-0.11, 0, 0], null, m);                               // centre ridge
  for (const x of [-0.22, 0.22]) add(new T.BoxGeometry(0.07, 0.025, 0.34), '#7a5232', [x, 0.33, 0.14], [0.35, 0, 0]);       // shoulder straps
  for (const [a, y] of [[-0.75, 0.12], [-0.75, -0.12], [0.75, 0.12], [0.75, -0.12]]) add(new T.SphereGeometry(0.025, 6, 4), '#4e6372', [Math.sin(a) * 0.38, y, Math.cos(a) * 0.38]);
  return g;
}
function driftboard(T) {
  const { g, add } = kit(T);
  const s = new T.Shape();
  s.moveTo(0, -0.9); s.bezierCurveTo(0.2, -0.85, 0.22, 0.5, 0, 0.95); s.bezierCurveTo(-0.22, 0.5, -0.2, -0.85, 0, -0.9);
  add(new T.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 10 }), '#c49862', [0, 0, -0.025]);
  for (const y of [-0.35, 0.35]) add(new T.BoxGeometry(0.4, 0.07, 0.1), y < 0 ? '#2f8f8f' : '#54a6a4', [0, y, 0], [0, 0, 0], [0.92 - Math.abs(y) * 0.5, 1, 1]);
  add(new T.BoxGeometry(0.02, 1.5, 0.08), '#a37a48', [0, 0, 0]);
  return g;
}

// Headlamp: a teal strap loop, a slate lamp body and a warm lens (matches the icon).
function headlamp(T) {
  const { g, add } = kit(T);
  add(new T.TorusGeometry(0.3, 0.03, 5, 20), '#54a6a4', [0, 0, 0], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
  add(new T.BoxGeometry(0.22, 0.17, 0.1), '#4a5a6a', [0, 0, 0.24], [0, 0, 0], null, { roughness: 0.5 });
  add(new T.CylinderGeometry(0.065, 0.075, 0.04, 14), '#ffd27a', [0, 0, 0.3], [Math.PI / 2, 0, 0], null, { emissive: 0xffb84a, emissiveIntensity: 0.5, flatShading: false });
  add(new T.TorusGeometry(0.075, 0.012, 4, 14), '#c6d6e0', [0, 0, 0.32], [0, 0, 0], null, { metalness: 0.5, roughness: 0.35 });
  add(new T.BoxGeometry(0.05, 0.03, 0.06), '#2f8f8f', [0.12, 0.08, 0.22]); // switch
  return g;
}

/**
 * Held machete (first-person), shaped like createSpear/createAxe: grip along +Y, butt at -Y, blade up +Y with
 * its edge forward (-Z). userData.grip (Vector3, root space), userData.size {x,y,z}. Length ~0.7.
 * spear-repair-hooks.js slides it along +Y for the jab, like the spears.
 */
export function createMachete(T) {
  const { g, add, mat } = kit(T);
  g.name = 'machete';
  const steel = mat('#a9b8c4', { metalness: 0.55, roughness: 0.35 }), edge = mat('#e3e9ec', { metalness: 0.6, roughness: 0.25 });
  const s = new T.Shape(); // blade outline in (z, y): back straight, edge bellies forward and sweeps to the tip
  s.moveTo(0.02, 0); s.lineTo(0.02, 0.4); s.quadraticCurveTo(0.0, 0.5, -0.05, 0.52); s.quadraticCurveTo(-0.085, 0.3, -0.06, 0); s.lineTo(0.02, 0);
  const blade = add(new T.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 6 }), steel, [0.004, -0.05, 0], [0, -Math.PI / 2, 0]);
  blade.castShadow = false;
  add(new T.BoxGeometry(0.006, 0.44, 0.012), edge, [0, 0.17, -0.072], [-0.04, 0, 0]);             // bright edge
  add(new T.BoxGeometry(0.03, 0.025, 0.12), '#6d8496', [0, -0.06, -0.02], [0, 0, 0], null, { metalness: 0.5, roughness: 0.4 }); // guard
  add(new T.CylinderGeometry(0.019, 0.022, 0.17, 8), '#8a5e34', [0, -0.16, -0.02]);              // grip
  for (const y of [-0.12, -0.17, -0.22]) add(new T.TorusGeometry(0.022, 0.005, 4, 10), '#d9c38c', [0, y, -0.02], [Math.PI / 2, 0, 0]);
  add(new T.SphereGeometry(0.024, 8, 6), '#c6d6e0', [0, -0.255, -0.02], [0, 0, 0], null, { metalness: 0.5 }); // pommel
  g.userData.grip = new T.Vector3(0, -0.17, -0.02);
  g.userData.size = { x: 0.05, y: 0.73, z: 0.13 };
  return g;
}

/**
 * Held titanium sword (first-person), the same frame as createMachete: grip along +Y, blade up +Y with its edges
 * to the sides, userData.grip / userData.size. A straight double-edged blade with a fuller and a cross guard.
 */
export function createSword(T) {
  const { g, add, mat } = kit(T);
  g.name = 'titaniumSword';
  const steel = mat('#c3cbe0', { metalness: 0.55, roughness: 0.3 }), fuller = mat('#9aa3c0', { metalness: 0.5, roughness: 0.35 });
  const s = new T.Shape(); // blade outline in (z, y): straight sides, a short point
  s.moveTo(-0.032, 0); s.lineTo(-0.032, 0.44); s.lineTo(0, 0.52); s.lineTo(0.032, 0.44); s.lineTo(0.032, 0); s.lineTo(-0.032, 0);
  const blade = add(new T.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: false, curveSegments: 2 }), steel, [0.005, -0.05, 0], [0, -Math.PI / 2, 0]);
  blade.castShadow = false;
  add(new T.BoxGeometry(0.014, 0.38, 0.012), fuller, [0, 0.16, 0]);                                       // fuller down the middle
  add(new T.BoxGeometry(0.035, 0.028, 0.16), '#9aa3c0', [0, -0.06, 0], [0, 0, 0], null, { metalness: 0.5, roughness: 0.4 }); // cross guard
  add(new T.CylinderGeometry(0.018, 0.021, 0.15, 8), '#3b4a66', [0, -0.15, 0]);                          // navy grip
  for (const y of [-0.11, -0.15, -0.19]) add(new T.TorusGeometry(0.021, 0.005, 4, 10), '#b3a9d9', [0, y, 0], [Math.PI / 2, 0, 0]);
  add(new T.SphereGeometry(0.026, 8, 6), '#b3a9d9', [0, -0.24, 0], [0, 0, 0], null, { metalness: 0.5 }); // pommel
  g.userData.grip = new T.Vector3(0, -0.15, 0);
  g.userData.size = { x: 0.05, y: 0.73, z: 0.16 };
  return g;
}

const MEAL = { // matches cookpot-model.js STEW_TINT plus a few bits so each bowl reads differently
  meal_chowder: ['#f3e2b8', [['#fff6e0', -0.12, 0.06, 0.05], ['#e9c27a', 0.1, -0.08, 0.045], ['#fff6e0', 0.05, 0.14, 0.04]]],
  meal_omelette: ['#f5cf4a', [['#5f9a57', 0.1, 0.05, 0.03], ['#5f9a57', -0.08, -0.06, 0.025]], 0.05],
  meal_broth: ['#5f9a57', [['#2f6a3a', -0.1, 0.02, 0.07, 0.25], ['#2f6a3a', 0.12, -0.05, 0.06, 0.25], ['#fff2cc', 0.02, 0.12, 0.03]]],
  meal_fishbowl: ['#c77b3c', [['#f0c79a', -0.06, 0.03, 0.1, 0.45], ['#3a2414', 0.1, -0.08, 0.03]]],
  meal_custard: ['#f7e7a8', [['#a0612e', 0, 0, 0.035, 0.4]], 0.04],
  meal_stew: ['#b5542c', [['#f09a3e', -0.12, 0.06, 0.05], ['#fff2cc', 0.11, -0.04, 0.045], ['#5f9a57', 0.02, -0.13, 0.04], ['#8a4a2a', 0.04, 0.13, 0.05]]],
  meal_gardensoup: ['#d0623f', [['#8e1f3f', -0.1, 0.05, 0.06], ['#e9c27a', 0.1, -0.06, 0.055], ['#5f9a57', 0.03, 0.13, 0.03]]],
  meal_hotpot: ['#e2b765', [['#f0c79a', -0.08, 0.02, 0.09, 0.45], ['#8e1f3f', 0.12, 0.06, 0.045], ['#c9a067', 0.06, -0.12, 0.05]]],
  meal_sharkroast: ['#9a5a3e', [['#d97a7a', 0, 0, 0.12, 0.5], ['#8e1f3f', -0.14, -0.08, 0.045], ['#c9a067', 0.14, 0.09, 0.05]], 0.03],
};
const PAINT = { paint_seafoam: '#9fd3c1', paint_coral: '#e9a08c', paint_sunshell: '#f1d78d', paint_lagoon: '#86b3d6', paint_pebble: '#c9c3b8' };
const OWN = {
  bowl: (T) => bowl(T), bucket: (T) => pail(T, false), milk: (T) => pail(T, true),
  puffegg: egg, feather, shell, fins, airjug, goggles, scraper, headlamp, sinker, stormshard, berries, cookedbeet, cookedpotato, armor, driftboard, sharkhead,
  sharkmeat: (T) => steak(T, false), cookedsharkmeat: (T) => steak(T, true),
  berrycup: (T) => juice(T, '#c2335a', '#ff7aa2'), coconutcup: (T) => juice(T, '#f1e8d6', '#54a6a4'), mixcup: (T) => juice(T, '#e9835f', '#ffbd66'),
  ...Object.fromEntries(Object.entries(MEAL).map(([k, [c, bits, dome]]) => [k, (T) => bowl(T, c, bits, dome || 0)])),
  ...Object.fromEntries(Object.entries(PAINT).map(([k, c]) => [k, (T) => paintPot(T, c)])),
};

// ---------------------------------------------------------------- how each is held
const R = (size, grip, rx = 0, ry = 0, rz = 0, extra = {}) => ({ hand: 'right', pose: 'grip', size, grip, rx, ry, rz, ...extra });
// Small things sit on top of the fist (grip near their base) with the arm raised a little, so they show above the hotbar.
const UP = [-0.025, 0.07, 0];
const S = (size, rx, ry, rz, gy = -0.42, extra = {}) => R(size, [0, gy, 0], rx, ry, rz, { arm: UP, ...extra });
const PLACE = { hand: 'left', pose: 'point' };
const LUMP = S(0.09, 0.3, 0.6, 0.2, -0.3);                          // ores, stone, clay: a lump in the fist
const FOOD_BOWL = S(0.14, 0.35, 0, -0.05, -1.3);                    // bowl sits on the fist, rim tipped toward the eye
const CUP = S(0.11, 0.15, 0.3, 0, -0.35);
const POT = S(0.1, 0.2, 0.5, 0, -0.4);
export const HELD_HOLD = Object.freeze({
  // placeables: a small copy on the left fist, the right hand points where it goes
  ...Object.fromEntries(['rug', 'pennant', 'fern', 'chime', 'hammock', 'pots', 'sign', 'kiln', 'glasslamp', 'stormrod', 'stormlamp', 'stormglass',
    'motor', 'wheel', 'bed', 'shellwreath', 'glassfloat', 'cookpot', 'courseflag', 'scoreboard', 'gametable', 'flagpole', 'nestbox', 'cushion',
    'goatpen', 'cropplot', 'perch', 'juicer', 'turbine', 'battery', 'stringlights', 'lamppost', 'fishtrap', 'shelf', 'trophystand', 'taskboard',
    'photoframe', 'maptable', 'recycler', 'research', 'receiver', 'antenna', 'purifier', 'rainbarrel', 'sprinkler', 'smelter', 'researchtable', 'grill']
    .map((k) => [k, PLACE])),
  // wall pieces face their front (the side the icon shows) toward the eye; flat ones tip up so they are not seen edge-on
  ...Object.fromEntries(['taskboard', 'photoframe', 'scoreboard', 'shelf'].map((k) => [k, { ...PLACE, ry: Math.PI }])),
  rug: { ...PLACE, rx: -1.0, grip: [0, -0.5, -0.45] }, bed: { ...PLACE, rx: -0.9 },
  // resources
  stone: LUMP, clay: LUMP, metalore: LUMP, copperore: LUMP, titaniumore: LUMP,
  sand: S(0.1, 0.3, 0.4, 0.1, -0.45),
  brick: S(0.1, 0.3, 0.9, 0.2, -0.3), metalingot: S(0.1, 0.3, 0.9, 0.25, -0.3), copperingot: S(0.1, 0.3, 0.9, 0.25, -0.3), titaniumingot: S(0.1, 0.3, 0.9, 0.25, -0.3),
  vinegoo: S(0.09, 0.3, 0.4, 0.1, -0.3), circuitboard: S(0.12, 0.55, 0.4, 0.1, -0.3),
  glass: S(0.1, 0.1, 0.6, 0.15, -0.4), wax: S(0.09, 0.3, 0.4, 0.1), honey: S(0.1, 0.2, 0.4, 0),
  seaweed: S(0.15, -0.2, 0.4, 0.3, -0.4), flowerseed: S(0.08, 0.3, 0.4, 0.2, -0.3),
  bolt: S(0.08, 0.1, 0.4, 0.3, -0.3), hinge: S(0.08, 0.3, 0.5, 0.2, -0.35), sinker: S(0.07, 0.15, 0, 0.2, -0.45),
  feather: S(0.16, -0.25, 0.4, 0.35, -0.4), shell: S(0.1, 0.25, 0.5, 0.1, -0.5), stormshard: S(0.1, 0.1, 0.4, 0.1, -0.45),
  puffegg: S(0.07, 0.15, 0, 0.1, -0.45),
  // food and drink
  cookedfish: R(0.2, [0.36, 0, 0], 0.1, 0.35, 0.25, { arm: [-0.02, 0.06, 0] }), honeyfish: R(0.2, [0.36, 0, 0], 0.1, 0.35, 0.25, { arm: [-0.02, 0.06, 0] }),
  sharkmeat: S(0.13, 0.5, 0.4, 0.15, -1.2), cookedsharkmeat: S(0.13, 0.5, 0.4, 0.15, -1.2),
  sharkhead: R(0.18, [0.3, -0.2, 0], 0.2, 0.6, 0.1, { arm: UP }),
  berries: S(0.09, 0.2, 0.4, 0.1, -0.45), cookedbeet: S(0.09, 0.15, 0.4, 0.1, -0.4), cookedpotato: S(0.1, 0.3, 0.4, 0.1, -0.4),
  saltcup: CUP, freshcup: CUP, berrycup: CUP, coconutcup: CUP, mixcup: CUP,
  bowl: FOOD_BOWL, meal_chowder: FOOD_BOWL, meal_omelette: FOOD_BOWL, meal_broth: FOOD_BOWL, meal_fishbowl: FOOD_BOWL, meal_custard: FOOD_BOWL, meal_stew: FOOD_BOWL,
  meal_gardensoup: FOOD_BOWL, meal_hotpot: FOOD_BOWL, meal_sharkroast: FOOD_BOWL,
  bucket: S(0.13, 0.25, 0.3, 0, -0.45), milk: S(0.13, 0.35, 0.3, 0, -0.45),
  // gear and tools
  paint_seafoam: POT, paint_coral: POT, paint_sunshell: POT, paint_lagoon: POT, paint_pebble: POT,
  metalhook: R(0.2, [0, 0.3, 0], Math.PI - 0.35, 0, 0, { arm: [0.03, -0.025, 0] }),     // the hook's place; fist below the ring, grapple head up and forward
  binoculars: S(0.12, -1.2, 0, 0.2, 0),
  scraper: R(0.17, [0, 0.22, 0], 2.7, 0, 0.3, { arm: UP }),                            // fist on the handle, blade up and forward
  airjug: S(0.12, 0.15, 0.3, 0, -0.3), goggles: S(0.14, 0.2, 0.3, 0.1, -0.5), headlamp: S(0.13, 0.35, 0.4, 0.1, -0.5),
  fins: S(0.17, -0.2, 0.5, 0.3, -0.42),
  armor: S(0.14, 0.2, 0.3, 0.05, -0.45), driftboard: { hand: 'left', pose: 'grip', size: 0.2, grip: [0, -0.5, 0] },
});

/** Kinds this module can build. */
export const HELD_MODEL_KINDS = Object.freeze([...new Set([...Object.keys(SHARED), ...Object.keys(OWN_WORLD), ...Object.keys(OWN), ...Object.keys(HELD_HOLD)])]);

/** A fresh held model for kind, or null (held-items.js then falls back to its generic bundle). */
export function buildHeldModel(T, kind) {
  try {
    if (SHARED[kind]) { const m = SHARED[kind](T, kits(T)); if (m) return { model: m, shared: true }; }
    // World and icon models may keep module-cached materials (maptable, recycler, smelter, purifier ...): report them
    // shared so hands.js works on material copies and never retunes or disposes what placed copies still use.
    if (OWN[kind]) return { model: OWN[kind](T), shared: false };
    const m = OWN_WORLD[kind] ? OWN_WORLD[kind](T) : buildIconModel(T, kind);
    return m ? { model: m, shared: true } : null;
  } catch (e) {
    console.warn('held model failed', kind, e);
    return null;
  }
}
