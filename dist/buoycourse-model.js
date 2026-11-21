// Buoy Ring Course models (docs/specs/buoycourse.md): start flag, race scoreboard, the floating rings and the two
// shared canvas textures. Geometry/materials/textures are built ONCE; instances share them. game.js rebuildRaft()
// disposes removed children, so the shared dispose() calls are no-ops; dispose() here frees them for real.
// Local origin of a decor model = centre of the floor tile top.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
import { RING } from './buoycourse-core.js';

const NEXT = '#ff9a3c', PENDING = '#f4efe4', CLEARED = '#7fa6b0', FINISH = '#ffd04a';

function makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch { /* no canvas: the boards stay blank */ }
  return null;
}

function fitText(g, text, px, max, weight = 700) {
  let s = px;
  g.font = `${weight} ${s}px "Trebuchet MS", system-ui, sans-serif`;
  while (s > 10 && g.measureText(text).width > max) { s -= 2; g.font = `${weight} ${s}px "Trebuchet MS", system-ui, sans-serif`; }
}
function plank(g, w, h) {
  g.globalAlpha = 1; g.fillStyle = '#2f5f6e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.globalAlpha = .07;
  for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
  g.globalAlpha = 1;
}

export function buildCourseModels(T) {
  const noop = () => {};
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose, realTex = T.Texture.prototype.dispose;
  const owned = [];
  const share = x => { x.dispose = noop; owned.push(x); return x; };

  // ---- vertex-coloured merged pieces
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1);
  function add(parts, geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, one); g.applyMatrix4(m4);
    if (g.attributes.uv) g.deleteAttribute('uv');
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    parts.push(g);
  }
  const merge = parts => { const m = mergeGeometries(T, parts); for (const g of parts) g.dispose(); return share(m); };

  const body = share(new T.MeshLambertMaterial({ vertexColors: true })); body.name = 'buoyBody';
  const cloth = share(new T.MeshLambertMaterial({ color: NEXT, side: T.DoubleSide })); cloth.name = 'buoyPennant';

  // flag: pole at x -.25, ring buoy at its foot, course board at x +.3 centred y .85
  const fp = [];
  add(fp, new T.CylinderGeometry(.035, .045, 1.8, 8), '#e9e2d0', -.25, .9, 0);
  add(fp, new T.SphereGeometry(.06, 8, 6), '#ffd04a', -.25, 1.83, 0);
  add(fp, new T.TorusGeometry(.2, .06, 6, 16), '#e8553f', -.25, .08, 0, Math.PI / 2);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; add(fp, new T.BoxGeometry(.07, .13, .13), '#f6f1e6', -.25 + Math.cos(a) * .2, .08, Math.sin(a) * .2, 0, -a); }
  add(fp, new T.CylinderGeometry(.03, .035, .72, 6), '#8a6a45', .3, .36, -.03);
  add(fp, new T.BoxGeometry(.62, .34, .04), '#8a6a45', .3, .85, -.01);
  const flagGeo = merge(fp);
  const penShape = new T.Shape(); penShape.moveTo(0, 0); penShape.lineTo(.5, -.14); penShape.lineTo(0, -.3); penShape.closePath();
  const penGeo = share(new T.ShapeGeometry(penShape));
  const boardPlane = share(new T.PlaneGeometry(.56, .28));

  // scoreboard: two legs, a frame, a 0.84 m square face
  const sp = [];
  for (const x of [-.4, .4]) add(sp, new T.BoxGeometry(.07, 1.5, .07), '#8a6a45', x, .75, -.04);
  add(sp, new T.BoxGeometry(.94, .94, .05), '#6f5235', 0, 1.05, -.02);
  add(sp, new T.BoxGeometry(.98, .06, .08), '#a37b50', 0, 1.53, -.02);
  const scoreGeo = merge(sp);
  const scorePlane = share(new T.PlaneGeometry(.84, .84));

  // ---- shared canvas textures
  function texOf(w, h) {
    const canvas = makeCanvas(w, h), g = canvas?.getContext?.('2d');
    if (!g) return { tex: null, mat: share(new T.MeshLambertMaterial({ color: '#2f5f6e' })), g: null, w, h };
    const tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    tex.dispose = noop;
    const mat = share(new T.MeshLambertMaterial({ map: tex }));
    return { tex, mat, g, w, h };
  }
  const board = texOf(256, 128), score = texOf(256, 256);
  board.mat.name = 'buoyBoardText'; score.mat.name = 'buoyScoreText';

  function paintBoard(info) {
    const g = board.g; if (!g) return;
    const { w, h } = board;
    plank(g, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd04a'; fitText(g, info?.title || 'Buoy Course', 40, 236); g.fillText(info?.title || 'Buoy Course', w / 2, 40);
    g.fillStyle = '#f4efe4'; const sub = info?.sub || ''; fitText(g, sub, 26, 236, 600); g.fillText(sub, w / 2, 92);
    if (board.tex) board.tex.needsUpdate = true;
  }
  function paintScore(rows) {
    const g = score.g; if (!g) return;
    const { w, h } = score;
    plank(g, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd04a'; const title = rows?.title || 'Race Times'; fitText(g, title, 34, 236); g.fillText(title, w / 2, 26);
    const col = (label, list, y0) => {
      g.textAlign = 'left'; g.fillStyle = '#9fd3dc'; g.font = '700 22px "Trebuchet MS", system-ui, sans-serif'; g.fillText(label, 16, y0);
      for (let i = 0; i < 3; i++) {
        const r = Array.isArray(list) ? list[i] : null, y = y0 + 28 + i * 25;
        g.fillStyle = i === 0 && r ? '#ffd04a' : '#f4efe4';
        g.textAlign = 'left'; fitText(g, `${i + 1}. ${r ? r[0] : '-'}`, 20, 150, 600); g.fillText(`${i + 1}. ${r ? r[0] : '-'}`, 22, y);
        g.textAlign = 'right'; g.font = '600 20px "Trebuchet MS", system-ui, sans-serif'; g.fillText(r ? r[1] : '', w - 16, y);
      }
    };
    col('Swim', rows?.swim, 66); col('Board', rows?.board, 166);
    if (score.tex) score.tex.needsUpdate = true;
  }
  paintBoard(null); paintScore(null);

  function mesh(geo, mat, shadow = true) { const m = new T.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; return m; }
  function flag() {
    const g = new T.Group(); g.name = 'buoy_flag';
    g.add(mesh(flagGeo, body));
    const pen = mesh(penGeo, cloth); pen.position.set(-.22, 1.78, 0); pen.name = 'pennant'; g.add(pen);
    const t = mesh(boardPlane, board.mat, false); t.position.set(.3, .85, .012); t.name = 'boardText'; g.add(t);
    g.userData.buoyFlag = true;
    return g;
  }
  function scoreboard() {
    const g = new T.Group(); g.name = 'buoy_scoreboard';
    g.add(mesh(scoreGeo, body));
    const t = mesh(scorePlane, score.mat, false); t.position.set(0, 1.05, .007); t.name = 'scoreText'; g.add(t);
    g.userData.buoyScore = true;
    return g;
  }

  // ---- rings: 3 draw calls, world space
  const ringGeo = share(new T.TorusGeometry(RING.R, .1, 8, 24));
  const ringMat = share(new T.MeshLambertMaterial({ color: '#ffffff' }));
  const ring = new T.InstancedMesh(ringGeo, ringMat, RING.MAXG);
  const floatGeo = share(new T.SphereGeometry(.26, 10, 8));
  const floatMat = share(new T.MeshLambertMaterial({ color: '#ffffff' }));
  const floats = new T.InstancedMesh(floatGeo, floatMat, RING.MAXG * 2);
  const beamGeo = share(new T.CylinderGeometry(.22, .22, 6, 12, 1, true));
  const beamMat = share(new T.MeshBasicMaterial({ color: NEXT, transparent: true, opacity: .25, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  const beam = new T.Mesh(beamGeo, beamMat);
  const cNext = new T.Color(NEXT), cPend = new T.Color(PENDING), cDone = new T.Color(CLEARED), cFin = new T.Color(FINISH), cRed = new T.Color('#e8553f'), cWhite = new T.Color('#f6f1e6');
  for (let i = 0; i < RING.MAXG; i++) { ring.setColorAt(i, cPend); floats.setColorAt(i * 2, cRed); floats.setColorAt(i * 2 + 1, cWhite); }
  for (const m of [ring, floats, beam]) { m.frustumCulled = false; m.visible = false; m.castShadow = false; m.receiveShadow = false; }
  ring.name = 'buoyRings'; floats.name = 'buoyFloats'; beam.name = 'buoyBeam';
  ring.count = 0; floats.count = 0;
  const group = new T.Group(); group.name = 'buoyCourse'; group.add(ring, floats, beam);

  const o = new T.Object3D(); o.rotation.order = 'YXZ';
  const slope = { x: 0, z: 0 };
  let lastNext = -2, lastLen = -1, lastGates = null;
  /** Per frame while visible: pose every gate on the swell. No allocations. A finish that repeats gate 0
   *  (loop, figure 8) is drawn once: gate 0 shows gold as the finish once it is cleared. */
  function pose(gates, next, ocean) {
    const all = Math.min(gates.length, RING.MAXG);
    const dup = all > 1 && gates[0][0] === gates[all - 1][0] && gates[0][1] === gates[all - 1][1];
    const n = dup ? all - 1 : all;
    if (next !== lastNext || all !== lastLen || gates !== lastGates) {
      for (let i = 0; i < n; i++) {
        let c = i === next ? cNext : i < next ? cDone : i === all - 1 ? cFin : cPend;
        if (dup && i === 0) c = next === 0 || next === all - 1 ? cNext : cFin;
        ring.setColorAt(i, c);
      }
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
      lastNext = next; lastLen = all; lastGates = gates;
    }
    ring.count = n; floats.count = n * 2;
    const bi = dup && next === all - 1 ? 0 : next;
    for (let i = 0; i < n; i++) {
      const gt = gates[i], x = gt[0], z = gt[1], yaw = gt[2];
      const h = ocean ? ocean.getHeight(x, z) : 0;
      if (ocean?.getSlope) ocean.getSlope(x, z, undefined, .6, slope); else slope.x = slope.z = 0;
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      o.position.set(x, h + .3, z);
      o.rotation.set(-(slope.x * nx + slope.z * nz) * .5, yaw, (slope.x * nz - slope.z * nx) * .5);
      o.scale.set(1, 1, 1);
      o.updateMatrix(); ring.setMatrixAt(i, o.matrix);
      for (let s = 0; s < 2; s++) {
        const side = s ? -RING.R : RING.R;
        o.position.set(x + nz * side, h + .05, z - nx * side);
        o.rotation.set(0, 0, 0); o.updateMatrix(); floats.setMatrixAt(i * 2 + s, o.matrix);
      }
      if (i === bi) beam.position.set(x, h + 3, z);
    }
    beam.visible = bi >= 0 && bi < n;
    ring.instanceMatrix.needsUpdate = true; floats.instanceMatrix.needsUpdate = true;
  }
  function show(on) { ring.visible = floats.visible = on; if (!on) beam.visible = false; }

  return {
    flag, scoreboard, paintBoard, paintScore, pose, show,
    rings: { group, ring, floats, beam },
    boardTex: board.tex, scoreTex: score.tex,
    dispose() {
      group.removeFromParent();
      try { ring.dispose(); floats.dispose(); } catch { /* ignore */ }
      for (const x of owned) { try { (x.isMaterial ? realMat : realGeo).call(x); } catch { /* ignore */ } }
      for (const t of [board.tex, score.tex]) if (t) { try { realTex.call(t); } catch { /* ignore */ } }
    },
  };
}
