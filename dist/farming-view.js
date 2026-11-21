// Palm planter meshes: pot, dry/wet soil, and one plant model per growth stage.
// The group sits in the scene and copies the raft's transform each frame, so
// rebuildRaft() never disposes it. Geometry and materials are built once and shared.
//
// getModel(kind) hook: return an Object3D to replace a placeholder, or null to keep it.
// Kinds: 'planter', 'palm-0' (seedling), 'palm-1', 'palm-2', 'palm-3' (mature).
import { isPlot, MATURE, EMPTY, farmSignature } from './farming.js';

const DECK_Y = .22, POT_H = .5;

export function createFarmView(T, { getModel = null } = {}) {
  const group = new T.Group(); group.name = 'farm';
  const std = (color, roughness = .85, extra = {}) => new T.MeshStandardMaterial({ color, roughness, ...extra });
  const M = {
    pot: std('#db8764'), rim: std('#b86a4c'), dry: std('#c09a6b', 1), wet: std('#3f2a1c', .55), puddle: std('#2c1f16', .12, { transparent: true, opacity: .55 }),
    trunk: std('#ad8153'), leaf: std('#72ae59', .8, { side: T.DoubleSide }), leaf2: std('#519b55', .8, { side: T.DoubleSide }),
  };
  const G = {
    pot: new T.CylinderGeometry(.38, .28, POT_H, 10), rim: new T.TorusGeometry(.37, .035, 6, 14),
    soil: new T.CylinderGeometry(.34, .34, .04, 12), stem: new T.CylinderGeometry(.06, .1, 1, 6),
    leaf: new T.ConeGeometry(.28, 1.5, 4), puddle: new T.CircleGeometry(.16, 10),
  };
  const mesh = (g, m, parent, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

  // A palm of a given height and leaf count, leaves fanned from the top of the stem.
  function palmModel(height, leaves, leafScale) {
    const g = new T.Group(), stem = mesh(G.stem, M.trunk, g, 0, height / 2, 0); stem.scale.set(leafScale + .3, height, leafScale + .3);
    for (let i = 0; i < leaves; i++) {
      const a = i * Math.PI * 2 / leaves, l = mesh(G.leaf, i % 2 ? M.leaf2 : M.leaf, g);
      l.scale.set(leafScale, leafScale, leafScale * .35); // flattened cone: a frond, not a spike
      l.rotation.set(1.25 - (1 - leafScale) * .6, a, 0, 'YXZ'); // leans outward along its fan angle
      l.position.set(Math.sin(a) * .5 * leafScale, height + .05 * leafScale, Math.cos(a) * .5 * leafScale);
    }
    return g;
  }
  function planterModel() {
    const g = new T.Group(); mesh(G.pot, M.pot, g, 0, POT_H / 2, 0);
    const r = mesh(G.rim, M.rim, g, 0, POT_H, 0); r.rotation.x = Math.PI / 2; return g;
  }
  const defaults = {
    planter: planterModel,
    'palm-0': () => palmModel(.14, 3, .22),
    'palm-1': () => palmModel(.32, 4, .36),
    'palm-2': () => palmModel(.8, 6, .62),
    'palm-3': () => palmModel(1.6, 7, 1),
  };
  const templates = new Map();
  function model(kind) {
    if (!templates.has(kind)) {
      let o = null; try { o = getModel?.(kind) ?? null; } catch (e) { console.warn('farm model hook failed', kind, e); }
      templates.set(kind, o && o.isObject3D ? o : defaults[kind]());
    }
    return templates.get(kind).clone(); // clones share geometry and materials
  }

  const plots = new Map(); // "x,z" -> {root, soil, puddle, plant, stage, sway}
  let signature = null;
  function build(d) {
    const root = new T.Group(); root.position.set(d.x * 2, DECK_Y, d.z * 2);
    root.add(model('planter'));
    const soil = mesh(G.soil, M.dry, root, 0, POT_H - .01, 0); // top just above the pot's closed lid soil.receiveShadow = true;
    const puddle = mesh(G.puddle, M.puddle, root, .02, POT_H + .014, -.03); puddle.rotation.x = -Math.PI / 2; puddle.castShadow = false; puddle.visible = false;
    const p = { root, soil, puddle, plant: null, stage: null, sway: (d.x * 7 + d.z * 3) % 6 };
    group.add(root); return p;
  }
  function apply(p, farm) {
    const stage = farm ? farm.s : MATURE, wet = !!farm && farm.w > 0;
    p.soil.material = wet ? M.wet : M.dry; p.puddle.visible = wet;
    if (p.stage === stage) return;
    if (p.plant) p.root.remove(p.plant);
    p.plant = stage === EMPTY ? null : model('palm-' + stage);
    if (p.plant) { p.plant.position.y = POT_H; p.root.add(p.plant); }
    p.stage = stage;
  }

  // Call whenever decor may have changed; cheap when nothing did.
  function sync(decor) {
    const sig = farmSignature(decor); if (sig === signature) return false; signature = sig;
    const live = new Set();
    for (const d of decor) {
      if (!isPlot(d)) continue; const k = d.x + ',' + d.z; live.add(k);
      let p = plots.get(k); if (!p) { p = build(d); plots.set(k, p); }
      apply(p, d.farm);
    }
    for (const [k, p] of plots) if (!live.has(k)) { group.remove(p.root); plots.delete(k); }
    return true;
  }
  function update(t, raft) {
    if (raft) { group.position.copy(raft.position); group.quaternion.copy(raft.quaternion); }
    for (const p of plots.values()) if (p.plant) p.plant.rotation.z = Math.sin(t * 1.3 + p.sway) * (p.stage >= MATURE ? .02 : .05);
  }
  function dispose() {
    group.removeFromParent(); plots.clear(); templates.clear();
    for (const g of Object.values(G)) g.dispose(); for (const m of Object.values(M)) m.dispose();
  }
  // Planter the aim ray points at. point is the ray's hit on the deck plane; stepping back
  // along dir to soil height first lets players aim at the pot itself, not the deck behind it.
  const find = (decor, px, pz) => { const x = Math.round(px / 2), z = Math.round(pz / 2); return decor.find((d) => isPlot(d) && d.x === x && d.z === z) ?? null; };
  const plotAt = (decor, point, dir) => {
    if (!point) return null;
    if (dir && dir.y < -.05) { const k = POT_H / -dir.y, hit = find(decor, point.x - dir.x * k, point.z - dir.z * k); if (hit) return hit; }
    return find(decor, point.x, point.z);
  };
  return { group, sync, update, dispose, plotAt, stageOf: (x, z) => plots.get(x + ',' + z)?.stage ?? null };
}
