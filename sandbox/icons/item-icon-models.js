// Little Raft icon-only models: kinds whose world model does not read at hotbar size (40 px) get an
// exaggerated stand-in here (thick tools, a log pile for wood, the lantern without its 1.9 m post, a
// light net with floats, a rusty corrugated scrap sheet, a rope coil, a fish, chunky nails). The hook,
// hammer and rod match what the player HOLDS (held-items.js: hook.js / hammer.js / fishing-tool.js),
// not the thin models.js props. Used by item-icons.js ahead of its model provider.
// ICON_MODELS[kind] = { make: T => Object3D (owns its geometry + materials), pose: { yaw, pitch, roll } deg, look? }
// Poses are applied in ZXY order with the camera on +Z; look.rim adds a light rim for thin dark tools.
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';

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

// The held scrap hook (dist/hook.js createHook) redrawn for 40 px: the same curved steel hook,
// barb, riveted ferrule and rope-wrapped wooden handle, but laid out flat in the X-Y plane (the
// world model's bend leans toward -Z, which foreshortens it) and about twice as thick, so the
// silhouette survives the downsample. Handle at -Y, the point curls back down at the top.
function createScrapHookIcon(T) {
  const g = new T.Group(); g.name = 'scrapHookIcon';
  const steel = new T.MeshStandardMaterial({ color: '#a9c2c6', roughness: 0.3, metalness: 0.7 });
  const darkSteel = new T.MeshStandardMaterial({ color: '#63787b', roughness: 0.45, metalness: 0.75 });
  const HX = 0.2, flat = ([x, y, z]) => new T.Vector3(HX + (x - HX) * 1.05 + z * 0.35, y, 0);
  // hook.js control points, with the -Z lean folded into X so the hook reads in profile
  const pts = [[HX, -0.08, 0], [HX, 0.12, -0.01], [0.17, 0.27, -0.05], [0.06, 0.38, -0.12], [-0.1, 0.40, -0.2], [-0.25, 0.34, -0.26],
    [-0.34, 0.20, -0.28], [-0.33, 0.06, -0.25], [-0.24, 0.0, -0.2], [-0.15, 0.04, -0.16], [-0.11, 0.11, -0.13]].map(flat);
  const curve = new T.CatmullRomCurve3(pts, false, 'centripetal'), R = 0.042;
  addMesh(T, g, new T.TubeGeometry(curve, 96, R, 12, false), steel);
  const up = new T.Vector3(0, 1, 0), endP = curve.getPoint(1), endT = curve.getTangent(1).normalize();
  const tip = addMesh(T, g, new T.ConeGeometry(R, 0.12, 12), steel);
  tip.quaternion.setFromUnitVectors(up, endT); tip.position.copy(endP).addScaledVector(endT, 0.06);
  // barb: back-swept spur on the inside of the curl, near the point
  const bp = curve.getPoint(0.93), bt = curve.getTangent(0.93).normalize(), out = new T.Vector3(bt.y, -bt.x, 0);
  const mid = curve.getPoint(0.6);
  if (out.dot(bp.clone().sub(mid)) < 0) out.negate();
  const bdir = bt.clone().multiplyScalar(-0.7).addScaledVector(out, 0.7).normalize();
  const barb = addMesh(T, g, new T.ConeGeometry(0.028, 0.11, 8), steel);
  barb.quaternion.setFromUnitVectors(up, bdir); barb.position.copy(bp).addScaledVector(out, R * 0.5).addScaledVector(bdir, 0.045);
  // ferrule + rivets + lashing collar
  addMesh(T, g, new T.CylinderGeometry(0.075, 0.08, 0.1, 16), darkSteel, HX, -0.1, 0);
  const rv = new T.SphereGeometry(0.018, 8, 6), rivetMat = new T.MeshStandardMaterial({ color: '#d3ddd9', roughness: 0.35, metalness: 0.6 });
  for (const [dx, dy] of [[-0.04, -0.08], [0.04, -0.12]]) addMesh(T, g, rv, rivetMat, HX + dx, dy, 0.07);
  addMesh(T, g, new T.TorusGeometry(R + 0.01, 0.012, 6, 16), darkSteel, HX, 0.05, 0).rotation.x = Math.PI / 2;
  // weathered wooden handle with a tan rope wrap (stripes in vertex colors) and dark tie bands
  const hTop = -0.15, hBot = -0.5, wTop = -0.2, wBot = -0.44;
  const hGeo = new T.CylinderGeometry(0.068, 0.074, hTop - hBot, 16, 32); hGeo.translate(HX, (hTop + hBot) / 2, 0);
  const wood = new T.Color('#9a7650'), woodD = new T.Color('#6a4d30'), rope = new T.Color('#e0c288'), ropeD = new T.Color('#9a7c4a');
  vcol(T, hGeo, (v, c) => {
    const a = Math.atan2(v.z, v.x - HX);
    if (v.y < wTop && v.y > wBot) c.copy(ropeD).lerp(rope, Math.pow(0.5 + 0.5 * Math.sin(v.y * 130 + a), 0.5));
    else c.copy(wood).lerp(woodD, 0.5 + 0.5 * Math.sin(a * 9 + v.y * 40));
  });
  addMesh(T, g, hGeo, stdv(T, { roughness: 0.9 }));
  const band = new T.TorusGeometry(0.076, 0.014, 6, 20), bandMat = new T.MeshStandardMaterial({ color: '#7a5f3c', roughness: 1 });
  for (const y of [wTop + 0.01, wBot - 0.01]) addMesh(T, g, band, bandMat, HX, y, 0).rotation.x = Math.PI / 2;
  addMesh(T, g, new T.CylinderGeometry(0.072, 0.066, 0.035, 16), darkSteel, HX, hBot - 0.017, 0);
  // knot + short dangling cord on the right of the grip
  addMesh(T, g, new T.SphereGeometry(0.026, 8, 6), bandMat, HX + 0.075, wTop + 0.005, 0.02);
  const cord = new T.CatmullRomCurve3([[HX + 0.08, wTop], [HX + 0.12, wTop - 0.06], [HX + 0.14, wTop - 0.15], [HX + 0.155, wTop - 0.2]].map(([x, y]) => new T.Vector3(x, y, 0.03)));
  addMesh(T, g, new T.TubeGeometry(cord, 16, 0.013, 6, false), new T.MeshStandardMaterial({ color: '#c9aa70', roughness: 0.95 }));
  return g;
}

// Hammer: the dist model with its handle and head fattened for the icon (the world model's
// handle is 5 cm across, a 1 px hairline at 40 px).
function createHammerIcon(T) {
  const h = createHammer(T), g = new T.Group(); g.name = 'hammerIcon';
  h.scale.set(1.9, 1, 1.45); g.add(h);
  return g;
}

// Net: the craft net is 1.6 m of dark 1 cm cords, a dark square at 18 px. Icon version: light
// wooden frame, a coarse grid of thick tan rope with darker knots, orange corner floats.
function createNetIcon(T) {
  const g = new T.Group(); g.name = 'netIcon';
  const E = 0.5, wood = stdv(T, { roughness: 0.85 }), ropeM = new T.MeshStandardMaterial({ color: '#e3c78e', roughness: 0.95 });
  for (const s of [-1, 1]) for (const ax of ['x', 'z']) {
    const geo = new T.BoxGeometry(ax === 'x' ? 2 * E + 0.12 : 0.09, 0.08, ax === 'x' ? 0.09 : 2 * E + 0.12);
    const c0 = new T.Color('#b88a55'), c1 = new T.Color('#7a5532');
    vcol(T, geo, (v, c) => c.copy(c0).lerp(c1, 0.25 + 0.25 * Math.sin((v.x + v.z) * 40)));
    addMesh(T, g, geo, wood, ax === 'x' ? 0 : s * E, 0, ax === 'x' ? s * E : 0);
  }
  const lines = [-0.3, -0.1, 0.1, 0.3];
  for (const u of lines) {
    const a = new T.CylinderGeometry(0.024, 0.024, 2 * E, 8); a.rotateZ(Math.PI / 2);
    addMesh(T, g, a, ropeM, 0, 0.03, u);
    const b = new T.CylinderGeometry(0.024, 0.024, 2 * E, 8); b.rotateX(Math.PI / 2);
    addMesh(T, g, b, ropeM, u, 0.03, 0);
  }
  const knot = new T.SphereGeometry(0.036, 8, 6), knotM = new T.MeshStandardMaterial({ color: '#8b6c42', roughness: 1 });
  for (const x of lines) for (const z of lines) addMesh(T, g, knot, knotM, x, 0.035, z);
  const fl = new T.SphereGeometry(0.1, 14, 10), flM = new T.MeshStandardMaterial({ color: '#ec6a3a', roughness: 0.55 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addMesh(T, g, fl, flM, sx * E, 0.07, sz * E).scale.set(1, 0.7, 1);
  return g;
}

// Scrap: a torn, corrugated, galvanised sheet with one corner folded over, rust bloom along the
// edges, a row of rivets and a bent strap riveted across it.
function createScrapIcon(T) {
  const g = new T.Group(); g.name = 'scrapIcon';
  const W = 0.9, H = 0.62, geo = new T.PlaneGeometry(W, H, 40, 28);
  const p = geo.attributes.position;
  const corr = x => 0.034 * Math.sin(x / 0.13 * Math.PI);
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
  const zinc = new T.Color('#e6ecee'), zinc2 = new T.Color('#8d9ba1'), rust = new T.Color('#b0501a'), rust2 = new T.Color('#e48a3a');
  const uv = geo.attributes.uv;
  vcol(T, geo, (v, c, i) => {
    const u = uv.getX(i) - 0.5, w = uv.getY(i) - 0.5, edge = Math.max(Math.abs(u) * 2, Math.abs(w) * 2);
    const n = vnoise(u * 9 + 11, w * 9), n2 = vnoise(u * 26, w * 26 + 4);
    c.copy(zinc).lerp(zinc2, 0.5 + 0.5 * Math.sin(u * W / 0.13 * Math.PI));   // corrugation shading in the albedo
    const r = Math.min(1, Math.max(0, (n * 0.7 + edge * 0.8 - 0.75) * 3.5));
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


// Nails: models.js `nails` is five 1 cm pins (a few grey hairlines at 40 px). Three thick nails side
// by side on the diagonal, big heads, a little rust.
function createNailIcon(T) {
  const g = new T.Group(); g.name = 'nailIcon';
  const steel = new T.MeshStandardMaterial({ color: '#b9c4c8', roughness: 0.35, metalness: 0.3 });
  const head = new T.MeshStandardMaterial({ color: '#7d8a90', roughness: 0.4, metalness: 0.3 });
  const rust = new T.Color('#a5522a'), base = new T.Color('#b9c4c8');
  [[-0.16, 0.0, 0.0, 0.08], [0.0, 0.1, 0.05, -0.1], [0.16, -0.06, -0.04, 0.12]].forEach(([x, y, z, rz], i) => {
    const n = new T.Group();
    const shaft = new T.CylinderGeometry(0.045, 0.045, 0.62, 10, 8);
    vcol(T, shaft, (v, c) => c.copy(base).lerp(rust, Math.max(0, Math.sin(v.y * 22 + i * 2) - 0.55) * 1.6));
    addMesh(T, n, shaft, stdv(T, { roughness: 0.35, metalness: 0.3 }));
    addMesh(T, n, new T.ConeGeometry(0.045, 0.14, 10), steel, 0, -0.38, 0).rotation.x = Math.PI;
    addMesh(T, n, new T.CylinderGeometry(0.1, 0.1, 0.04, 16), head, 0, 0.33, 0);
    n.position.set(x, y, z); n.rotation.z = rz; g.add(n);
  });
  return g;
}

const THIN = { rim: true };
export const ICON_MODELS = {
  wood:       { make: createLogPile,      pose: { yaw: -22, pitch: 18, roll: 0 } },
  scrap:      { make: createScrapIcon,    pose: { yaw: -15, pitch: 35, roll: 8 } },
  rope:       { make: createRopeCoil,     pose: { yaw: 0, pitch: 55, roll: 0 } },
  fish:       { make: createFishModel,    pose: { yaw: -15, pitch: 10, roll: 35 } },
  hook:       { make: createScrapHookIcon, pose: { yaw: -12, pitch: 6, roll: 16 }, look: THIN },
  hammer:     { make: createHammerIcon,   pose: { yaw: -60, pitch: 15, roll: -40 }, look: THIN },
  fishingrod: { make: createRodIcon,      pose: { yaw: 0, pitch: 0, roll: -45 }, look: THIN },
  lantern:    { make: createLanternIcon,  pose: { yaw: -35, pitch: 14, roll: -10 } },
  net:        { make: createNetIcon,      pose: { yaw: -30, pitch: 42 } },
  nail:       { make: createNailIcon,     pose: { yaw: -20, pitch: 12, roll: -40 }, look: THIN },
};
