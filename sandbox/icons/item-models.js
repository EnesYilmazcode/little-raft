// Item kind -> 3D model + icon pose, for baking inventory icons from the game's own models.
// Every kind in ITEM_INFO (dist/inventory-state.js) has an entry. 8 kinds use dist builders
// unchanged (hammer, plastic, leaf debris, palm/bench/crate crafts... see makeIconItems), the sail
// is the craft model squashed; fish and rope have no world model yet, so two small procedural
// ones live here, plus icon-only variants for kinds whose world model does not read at 40 px.
//
// makeIconItems(T, getMaterial) -> [{ kind, make: () => Object3D, pose, dispose(obj) }]
//   getMaterial(color) is the engine's shared material cache (game.js `mat`). Materials it hands
//   out are never disposed here; everything else a model creates is.
import { createHammer } from '../../dist/hammer.js';
import { createPlastic } from '../../dist/plastic.js';
import { createCraft } from '../../dist/crafts.js';
import { createDebris } from '../../dist/debris.js';
import { bakeIconAtlas } from './icon-atlas.js';

// Engine entry point: bake every kind once (or read the per-build localStorage cache) and return
// { kind: blobURL } for the DOM. The cache holds PNG data: URLs; the DOM gets short blob: URLs so
// innerHTML stays small. The caller owns the blob URLs (survival-ui setItemIcons revokes them when
// they are replaced and when the UI is destroyed).
// build is the ?build= id; with a real build id the PNGs are cached in localStorage under it.
// isCancelled() is polled between tiles; once it is true the bake stops, writes nothing to the
// cache, creates no blob URLs and resolves to null (game.js passes () => disposed).
export async function bakeItemIcons(T, renderer, getMaterial, build = 'dev', kinds = null, isCancelled = null) {
  const items = makeIconItems(T, getMaterial).filter(it => !kinds || kinds.includes(it.kind));
  const res = await bakeIconAtlas(T, renderer, items, { cacheKey: build && build !== 'dev' ? build : '', isCancelled });
  if (!res || (isCancelled && isCancelled())) return null;
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
  wood:       { yaw: -22, pitch: 18,  roll: 0,  pad: 1.06 },
  leaf:       { yaw: 90,   pitch: 75,  roll: 45 },
  plastic:    { yaw: -30, pitch: 15,  roll: -8 },
  scrap:      { yaw: -15, pitch: 35,  roll: 8,  pad: 1.04 },
  rope:       { yaw: 0,   pitch: 55,  roll: 0 },
  fish:       { yaw: -15, pitch: 10,  roll: 35 },
  hook:       { yaw: -15, pitch: 8,   roll: -22, pad: 1.03 },
  hammer:     { yaw: -60, pitch: 15,  roll: -40, pad: 1.02 },
  fishingrod: { yaw: 0,   pitch: 0,   roll: -45, pad: 1.03 },
  sail:       { yaw: -40, pitch: 10,  roll: -18, pad: 1.0 },
  palm:       { yaw: -35, pitch: 20 },
  lantern:    { yaw: -35, pitch: 14,  roll: -10, pad: 1.04 },
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

// ---------------------------------------------------------------------------------------------
// Icon-only model variants. The world models are built to be held at arm's length or seen at
// 5 m; at 40 px a 1.5 m rod is a hairline and a flat sheet reads as paper. These keep each
// item's colors and parts but exaggerate the silhouette. Mostly vertex-colored
// MeshStandardMaterial, so they share one program with the baker's unify() pass.
const vcol = (T, geo, fn) => {
  const p = geo.attributes.position, a = new Float32Array(p.count * 3), c = new T.Color(), v = new T.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, c, i); a.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new T.BufferAttribute(a, 3));
  return geo;
};
const stdv = (T, o = {}) => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...o });
const hash = (x, y = 0) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
const vnoise = (x, y) => {   // smooth 2D value noise, 0..1
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
};
function addMesh(T, g, geo, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; }

// Short, thick bamboo rod with a big side reel and a red/white bobber on a hanging line.
// Built along +Y; ICON_POSES.fishingrod rolls it onto the diagonal. The line is laid out so it
// hangs straight down on screen after the -45 degree roll (model "down" is (+x, -y) / sqrt 2).
function createRodIcon(T) {
  const g = new T.Group(); g.name = 'rodIcon';
  const bamboo = new T.Color('#d2a95c'), node = new T.Color('#8a6530'), cork = new T.Color('#8a5a34'), wrap = new T.Color('#3d2a1a');
  const y0 = -0.55, y1 = 0.62, L = y1 - y0;
  const blank = new T.CylinderGeometry(0.03, 0.05, L, 12, 24); blank.translate(0, (y0 + y1) / 2, 0);
  vcol(T, blank, (v, c) => { const t = (v.y - y0) / L, k = (t * 5.2) % 1; c.copy(bamboo).lerp(node, k < 0.06 ? 0.85 : 0.12 * Math.sin(v.x * 80)); });
  addMesh(T, g, blank, stdv(T, { roughness: 0.6 }));
  const handle = new T.CylinderGeometry(0.068, 0.062, 0.36, 14, 8); handle.translate(0, -0.72, 0);
  vcol(T, handle, (v, c) => { const t = v.y + 0.72; c.copy(cork).lerp(wrap, Math.abs(t) > 0.15 || Math.abs(t) < 0.02 ? 0.8 : 0.1 * hash(v.x * 9, v.y * 31)); });
  addMesh(T, g, handle, stdv(T, { roughness: 0.9 }));
  const brass = new T.MeshStandardMaterial({ color: '#c99a3c', roughness: 0.35, metalness: 0.7 });
  addMesh(T, g, new T.CylinderGeometry(0.07, 0.072, 0.05, 14), brass, 0, -0.92, 0);
  addMesh(T, g, new T.CylinderGeometry(0.05, 0.05, 0.05, 12), brass, 0, -0.53, 0);
  // reel: disc facing the camera, on the +x side of the handle top
  const steel = new T.MeshStandardMaterial({ color: '#56636a', roughness: 0.4, metalness: 0.6 });
  const spool = new T.CylinderGeometry(0.13, 0.13, 0.06, 24); spool.rotateX(Math.PI / 2);
  addMesh(T, g, spool, steel, 0.15, -0.66, 0.04);
  const lineSpool = new T.CylinderGeometry(0.1, 0.1, 0.065, 24); lineSpool.rotateX(Math.PI / 2);
  addMesh(T, g, lineSpool, new T.MeshStandardMaterial({ color: '#eee6cf', roughness: 0.8 }), 0.15, -0.66, 0.045);
  const hub = new T.CylinderGeometry(0.035, 0.035, 0.08, 12); hub.rotateX(Math.PI / 2); addMesh(T, g, hub, brass, 0.15, -0.66, 0.07);
  addMesh(T, g, new T.BoxGeometry(0.13, 0.03, 0.025), brass, 0.2, -0.64, 0.11).rotation.z = 0.3;
  const knob = new T.CylinderGeometry(0.025, 0.025, 0.06, 10); knob.rotateX(Math.PI / 2);
  addMesh(T, g, knob, new T.MeshStandardMaterial({ color: '#2b2520', roughness: 0.7 }), 0.26, -0.62, 0.14);
  addMesh(T, g, new T.BoxGeometry(0.1, 0.05, 0.03), steel, 0.07, -0.66, 0);
  // guides
  for (const y of [-0.2, 0.15, 0.45]) { const r = new T.TorusGeometry(0.03, 0.009, 6, 12); r.rotateY(Math.PI / 2); addMesh(T, g, r, steel, 0.05, y, 0); }
  // line: tip -> bobber (hangs down on screen) and a tight run from the reel along the rod
  const lineMat = new T.MeshStandardMaterial({ color: '#f4f0e2', roughness: 0.6, emissive: '#3a3a36' });
  const D = new T.Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0), tip = new T.Vector3(0, y1 + 0.02, 0);
  const bob = tip.clone().addScaledVector(D, 0.5).add(new T.Vector3(0, 0, 0.05));
  const sag = tip.clone().addScaledVector(D, 0.25).add(new T.Vector3(0.03, 0.03, 0.02));
  addMesh(T, g, new T.TubeGeometry(new T.CatmullRomCurve3([tip, sag, bob]), 16, 0.011, 5, false), lineMat);
  addMesh(T, g, new T.TubeGeometry(new T.LineCurve3(new T.Vector3(0.15, -0.56, 0.03), new T.Vector3(0.04, y1, 0.0)), 1, 0.008, 4, false), lineMat);
  const bobG = new T.SphereGeometry(0.085, 18, 12);
  vcol(T, bobG, (v, c) => c.set(v.y > 0.012 ? '#d8392b' : v.y > -0.012 ? '#2b2b2b' : '#f3eee0'));
  const bm = addMesh(T, g, bobG, stdv(T, { roughness: 0.4 }), bob.x + 0.05, bob.y - 0.05, bob.z);
  bm.rotation.z = Math.PI / 4;   // band stays horizontal on screen after the -45 roll
  return g;
}

// Classic J fish hook: straight shank, eye at the top with a rope tied through, round bend,
// point rising on the right with a barb.
function createJHook(T) {
  const g = new T.Group(); g.name = 'jHook';
  const steel = new T.MeshStandardMaterial({ color: '#a9bcc0', roughness: 0.28, metalness: 0.75 });
  const V = (x, y) => new T.Vector3(x, y, 0);
  const curve = new T.CatmullRomCurve3([V(0, 0.42), V(0, 0.15), V(0, -0.08), V(0.04, -0.26), V(0.17, -0.36), V(0.31, -0.31), V(0.39, -0.17), V(0.4, 0.02)], false, 'centripetal');
  const R = 0.055;
  addMesh(T, g, new T.TubeGeometry(curve, 64, R, 12, false), steel);
  const endP = curve.getPoint(1), endT = curve.getTangent(1).normalize(), up = new T.Vector3(0, 1, 0);
  const tip = addMesh(T, g, new T.ConeGeometry(R, 0.14, 12), steel);
  tip.quaternion.setFromUnitVectors(up, endT); tip.position.copy(endP).addScaledVector(endT, 0.07);
  const barb = addMesh(T, g, new T.ConeGeometry(0.03, 0.13, 8), steel);
  barb.quaternion.setFromUnitVectors(up, new T.Vector3(0.55, -1, 0).normalize());
  barb.position.set(endP.x - 0.06, endP.y + 0.03, 0);
  addMesh(T, g, new T.TorusGeometry(0.085, 0.04, 10, 24), steel, 0, 0.52, 0);
  // rope: through the eye, a knot, two loose ends curling up and left
  const tan = new T.Color('#d9a76a'), dark = new T.Color('#6b4a2b');
  const ropeTube = (pts, r) => {
    const geo = new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(([x, y, z = 0]) => new T.Vector3(x, y, z))), 48, r, 8, false);
    const radial = 9;
    return vcol(T, geo, (v, c, i) => { const k = Math.floor(i / radial), j = i % radial; c.copy(dark).lerp(tan, Math.pow(0.5 + 0.5 * Math.sin(k * 1.3 + j / 8 * Math.PI * 4), 0.6)); });
  };
  const rm = stdv(T, { roughness: 0.95 });
  addMesh(T, g, ropeTube([[-0.02, 0.6, 0.06], [0.0, 0.5, 0.07], [0.04, 0.44, 0.0], [0.0, 0.46, -0.06], [-0.07, 0.56, -0.02], [-0.12, 0.63, 0.04]], 0.042), rm);
  addMesh(T, g, ropeTube([[-0.12, 0.63, 0.04], [-0.2, 0.72, 0.03], [-0.22, 0.86, 0.0], [-0.13, 0.95, -0.01], [-0.02, 0.98, 0.0]], 0.042), rm);
  addMesh(T, g, ropeTube([[-0.12, 0.63, 0.04], [-0.24, 0.62, 0.05], [-0.32, 0.68, 0.04], [-0.36, 0.78, 0.02]], 0.04), rm);
  const knot = new T.SphereGeometry(0.065, 12, 8); vcol(T, knot, (v, c) => c.copy(dark).lerp(tan, 0.5 + 0.4 * Math.sin(v.x * 90 + v.y * 60)));
  addMesh(T, g, knot, rm, -0.12, 0.63, 0.04);
  return g;
}

// Scrap: a torn, corrugated, galvanised sheet with one corner folded over, rust bloom along the
// edges, a row of rivets and a bent strap riveted across it.
function createScrapIcon(T) {
  const g = new T.Group(); g.name = 'scrapIcon';
  const W = 0.9, H = 0.62, geo = new T.PlaneGeometry(W, H, 40, 28);
  const p = geo.attributes.position;
  const corr = x => 0.022 * Math.sin(x / 0.075 * Math.PI);
  const surf = (x, y) => corr(x) + 0.06 * (vnoise(x * 4 + 3, y * 4) - 0.5) + 0.54 * Math.max(0, -x - 0.1) ** 2;
  const fold0 = new T.Vector3(0.18, H / 2, 0), foldDir = new T.Vector3(1, -1.25, 0).normalize();
  const q = new T.Quaternion().setFromAxisAngle(foldDir, -2.4), lift = new T.Vector3(0, 0, 0.012), tmp = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    // tear the outline: pull border vertices in by noise
    const ex = Math.abs(x) / (W / 2), ey = Math.abs(y) / (H / 2);
    if (ex > 0.97 || ey > 0.97) { const k = 0.06 * vnoise(x * 13 + y * 7, 5); if (ex > 0.97) x *= 1 - k; if (ey > 0.97) y *= 1 - k * 1.4; }
    tmp.set(x, y, surf(x, y));
    // folded corner (top right) flipped back over the sheet
    const side = (x - fold0.x) * -foldDir.y + (y - fold0.y) * foldDir.x;
    if (side > 0) tmp.sub(fold0).applyQuaternion(q).add(fold0).add(lift);
    p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  geo.computeVertexNormals();
  const zinc = new T.Color('#d8e0e3'), zinc2 = new T.Color('#a7b3b8'), rust = new T.Color('#a5521f'), rust2 = new T.Color('#d0803a');
  const uv = geo.attributes.uv;
  vcol(T, geo, (v, c, i) => {
    const u = uv.getX(i) - 0.5, w = uv.getY(i) - 0.5, edge = Math.max(Math.abs(u) * 2, Math.abs(w) * 2);
    const n = vnoise(u * 9 + 11, w * 9), n2 = vnoise(u * 26, w * 26 + 4);
    c.copy(zinc).lerp(zinc2, 0.5 + 0.5 * Math.sin(u * W / 0.075 * Math.PI));   // corrugation shading in the albedo
    const r = Math.min(1, Math.max(0, (n * 0.6 + edge * 0.8 - 0.95) * 3.5));
    c.lerp(r > 0.5 ? rust : rust2, r * (0.65 + 0.35 * n2));
  });
  addMesh(T, g, geo, stdv(T, { roughness: 0.4, metalness: 0.15 }));
  const rivetMat = new T.MeshStandardMaterial({ color: '#6d5a4a', roughness: 0.45, metalness: 0.3 });
  const rivet = new T.SphereGeometry(0.022, 8, 6);
  for (let k = 0; k < 5; k++) { const x = -0.36 + k * 0.13, y = -0.22; addMesh(T, g, rivet, rivetMat, x, y, surf(x, y) + 0.01); }
  // bent strap across the lower left
  const strap = new T.BoxGeometry(0.5, 0.06, 0.016, 20, 1, 1), sp = strap.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i); sp.setZ(i, sp.getZ(i) + 0.12 * Math.max(0, -x - 0.05) ** 1.2 + 0.05); }
  strap.computeVertexNormals(); strap.rotateZ(0.5);
  vcol(T, strap, (v, c) => c.copy(rust2).lerp(rust, 0.6 * vnoise(v.x * 20, v.y * 20)));
  addMesh(T, g, strap, stdv(T, { roughness: 0.6, metalness: 0.4 }), -0.1, -0.02, 0.0);
  for (const t of [-0.15, 0.15]) addMesh(T, g, rivet, rivetMat, -0.1 + Math.cos(0.5) * t, -0.02 + Math.sin(0.5) * t, 0.075);
  return g;
}

// Wood: three logs stacked 2 + 1, ends toward the camera, bark sides and pale ringed end grain,
// short enough that the end grain dominates the icon.
function createLogPile(T) {
  const g = new T.Group(); g.name = 'logPile';
  const bark = new T.Color('#9a6a3c'), bark2 = new T.Color('#6a4526'), sap = new T.Color('#e2b676'), ring = new T.Color('#b98348'), heart = new T.Color('#9c6a38');
  const mat = stdv(T, { roughness: 0.9 });
  const logs = [[-0.155, -0.1, 0.0, 0.5, 0.15], [0.155, -0.1, 0.05, 0.48, 0.15], [0.0, 0.16, -0.03, 0.52, 0.15]];
  logs.forEach(([x, y, z, L, r], li) => {
    const side = new T.CylinderGeometry(r, r, L, 16, 6, true); side.rotateX(Math.PI / 2);
    const sp = side.attributes.position;
    for (let i = 0; i < sp.count; i++) { const a = Math.atan2(sp.getY(i), sp.getX(i)), k = 1 + 0.06 * (vnoise(a * 2 + li * 5, sp.getZ(i) * 6) - 0.5); sp.setX(i, sp.getX(i) * k); sp.setY(i, sp.getY(i) * k); }
    side.computeVertexNormals();
    vcol(T, side, (v, c) => { const a = Math.atan2(v.y, v.x); c.copy(bark).lerp(bark2, 0.5 + 0.5 * Math.sin(a * 7 + v.z * 9 + li)); });
    addMesh(T, g, side, mat, x, y, z);
    for (const s of [1, -1]) {
      const cap = new T.RingGeometry(0, r * 0.97, 16, 7);
      vcol(T, cap, (v, c) => { const d = Math.hypot(v.x, v.y) / r; c.copy(d < 0.18 ? heart : (Math.floor(d * 7) % 2 ? ring : sap)); if (d > 0.9) c.lerp(bark2, 0.7); });
      const m = addMesh(T, g, cap, mat, x, y, z + s * L / 2);
      if (s < 0) m.rotation.y = Math.PI;
    }
  });
  return g;
}

// Lantern on its own (the placeable is a 1.9 m post with a small lantern hanging off an arm):
// brass base and cap, dark steel frame, amber glass, candle with flame, bail handle.
function createLanternIcon(T) {
  const g = new T.Group(); g.name = 'lanternIcon';
  const steel = new T.MeshStandardMaterial({ color: '#3e4548', roughness: 0.5, metalness: 0.6 });
  const brass = new T.MeshStandardMaterial({ color: '#c09445', roughness: 0.35, metalness: 0.7 });
  addMesh(T, g, new T.CylinderGeometry(0.2, 0.22, 0.06, 4).rotateY(Math.PI / 4), brass, 0, -0.32, 0);
  addMesh(T, g, new T.CylinderGeometry(0.17, 0.2, 0.04, 4).rotateY(Math.PI / 4), steel, 0, -0.27, 0);
  addMesh(T, g, new T.BoxGeometry(0.26, 0.46, 0.26), new T.MeshStandardMaterial({
    color: '#ffc56e', transparent: true, opacity: 0.55, roughness: 0.1, emissive: '#ff9a3c', emissiveIntensity: 0.55, depthWrite: false }), 0, -0.02, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addMesh(T, g, new T.BoxGeometry(0.04, 0.5, 0.04), steel, sx * 0.13, -0.02, sz * 0.13);
  for (const s of [-1, 1]) { addMesh(T, g, new T.BoxGeometry(0.27, 0.025, 0.02), steel, 0, -0.02, s * 0.135); addMesh(T, g, new T.BoxGeometry(0.02, 0.025, 0.27), steel, s * 0.135, -0.02, 0); }
  addMesh(T, g, new T.CylinderGeometry(0.05, 0.055, 0.14, 12), new T.MeshStandardMaterial({ color: '#efe3c4', roughness: 0.7, emissive: '#6b3a10', emissiveIntensity: 0.3 }), 0, -0.18, 0);
  addMesh(T, g, new T.SphereGeometry(0.04, 10, 8).scale(1, 1.8, 1), new T.MeshStandardMaterial({ color: '#ffe2a0', roughness: 0.4, emissive: '#ffa53a', emissiveIntensity: 2.5 }), 0, -0.04, 0);
  addMesh(T, g, new T.ConeGeometry(0.24, 0.14, 4).rotateY(Math.PI / 4), steel, 0, 0.3, 0);
  addMesh(T, g, new T.CylinderGeometry(0.045, 0.05, 0.06, 12), brass, 0, 0.39, 0);
  addMesh(T, g, new T.TorusGeometry(0.15, 0.016, 8, 24, Math.PI), brass, 0, 0.36, 0);
  addMesh(T, g, new T.TorusGeometry(0.05, 0.016, 8, 16), brass, 0, 0.55, 0);
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
    wood: () => createLogPile(T),
    leaf: () => createDebris(T, 'leaf', gm, { seed: 3 }),
    scrap: () => createScrapIcon(T),
    plastic: () => createPlastic(T),
    rope: () => createRopeCoil(T),
    fish: () => createFishModel(T),
    hook: () => createJHook(T),
    hammer: () => createHammer(T),
    fishingrod: () => createRodIcon(T),
  };
  builders.lantern = () => createLanternIcon(T);
  // sail: the 3.8 m mast makes a tall sliver; squash height for the icon only
  builders.sail = () => { const g = createCraft(T, 'sail'); g.scale.set(1, 0.68, 1); return g; };
  for (const k of ['palm', 'net', 'bench', 'crate']) builders[k] = () => createCraft(T, k);
  return Object.keys(ICON_POSES).map(kind => ({
    kind, pose: ICON_POSES[kind], make: builders[kind],
    dispose: obj => disposeTree(obj, shared),
  }));
}
