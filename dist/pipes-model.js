// Water Tank model and the pipe InstancedMeshes (see docs/specs/water-pipes.md section 8).
// Given THREE; imports only merge-geo.js. Tank origin = centre of the floor tile top (game.js places decor at y = .22).
// Pipes live in scene space (two InstancedMeshes, one shared material); the module copies the raft transform onto them.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

export const TANK_CAP = 12, MAX_JOINTS = 400, MAX_ARMS = 2000;
export const JOINT_SCALE = Object.freeze({ cap: .8, straight: .7, elbow: 1, tee: 1.15, cross: 1.25 });
export const PIPE_Y = .075; // hub / arm centre above the deck top
const WIN_Y = .24, WIN_H = .6; // level window: bottom and height

// [geometry, hex, x, y, z, rx, ry, rz] parts -> one indexed geometry with a colour attribute.
function bake(T, parts) {
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
  const list = parts.map(([geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0]) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z);
    geo.applyMatrix4(m4.compose(p, q, s));
    const c = new T.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    return geo;
  });
  const out = mergeGeometries(T, list);
  for (const g of list) g.dispose();
  return out;
}

// ------------------------------------------------------------------ water tank

export function createWaterTank(T) {
  const g = new T.Group(); g.name = 'craft_watertank';
  g.userData.craftType = 'watertank'; g.userData.height = 1.05;
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([new T.BoxGeometry(.06, .12, .06), '#7d5c37', sx * .2, .06, sz * .2]);
  parts.push([new T.CylinderGeometry(.3, .3, .78, 10), '#9c7649', 0, .12 + .39, 0]); // wood-stave body
  for (let i = 0; i < 10; i++) { const a = (i + .5) / 10 * Math.PI * 2; parts.push([new T.BoxGeometry(.012, .76, .012), '#7d5c37', Math.sin(a) * .298, .51, Math.cos(a) * .298, 0, a, 0]); } // stave seams
  for (const y of [.3, .78]) parts.push([new T.TorusGeometry(.305, .014, 4, 20), '#b87333', 0, y, 0, Math.PI / 2]); // copper hoops
  parts.push([new T.ConeGeometry(.33, .15, 10), '#b87333', 0, .9 + .075, 0]); // lid
  parts.push([new T.CylinderGeometry(.03, .03, .03, 6), '#8a5a2b', 0, 1.06, 0]); // lid knob
  parts.push([new T.CylinderGeometry(.03, .03, .1, 6), '#b87333', .34, .15, 0, 0, 0, Math.PI / 2]); // spigot
  parts.push([new T.CylinderGeometry(.04, .04, .03, 6), '#b87333', .4, .15, 0, 0, 0, Math.PI / 2]);
  parts.push([new T.BoxGeometry(.09, WIN_H, .01), '#2b2118', 0, WIN_Y + WIN_H / 2, .302]); // dark window backing
  for (let i = 1; i <= 3; i++) parts.push([new T.BoxGeometry(.035, .012, .012), '#e8d9b8', .075, WIN_Y + WIN_H * i / 4, .305]); // tick marks
  const body = new T.Mesh(bake(T, parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .75, metalness: .15, flatShading: true }));
  body.name = 'tankBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const levelGeo = new T.BoxGeometry(.07, WIN_H, .008); levelGeo.translate(0, WIN_H / 2, 0); // base at the origin: y scale fills upward
  const level = new T.Mesh(levelGeo, new T.MeshStandardMaterial({ color: '#7fc4dc', emissive: '#2a6f8a', emissiveIntensity: .3, roughness: .2 }));
  level.name = 'tankLevel'; level.position.set(0, WIN_Y, .31); level.scale.y = .001;
  g.add(level);
  const glass = new T.Mesh(new T.PlaneGeometry(.09, WIN_H), new T.MeshStandardMaterial({ color: '#dff3ff', transparent: true, opacity: .35, roughness: .05, depthWrite: false }));
  glass.name = 'tankGlass'; glass.position.set(0, WIN_Y + WIN_H / 2, .322);
  g.add(glass);
  g.userData.level = level; g.userData.sig = -1;
  return g;
}

/** Sets the level window to w cups; cached on g.userData.sig so a repeat call is free. */
export function paintTank(g, w) {
  if (!g || g.userData.sig === w) return;
  g.userData.sig = w;
  const level = g.userData.level ?? g.getObjectByName?.('tankLevel'); if (!level) return;
  level.scale.y = Math.max(.001, Math.min(1, (Number.isFinite(w) ? w : 0) / TANK_CAP));
}

// ------------------------------------------------------------------ pipes

function jointGeometry(T) {
  return bake(T, [
    [new T.BoxGeometry(.22, .04, .22), '#8a6a45', 0, .02, 0], // wooden cleat
    [new T.CylinderGeometry(.055, .055, .09, 6), '#b87333', 0, PIPE_Y, 0], // copper hub
  ]);
}

const WET = 0xffffff, DRY = 0xa9b8b0;

/** Two InstancedMeshes (joints, arms) sharing one material. write(layout, y) rewrites matrices + colours in place. */
export function createPipeMeshes(T) {
  const material = new T.MeshStandardMaterial({ vertexColors: true, metalness: .4, roughness: .55, flatShading: true });
  const armGeo = new T.CylinderGeometry(.035, .035, 1, 6, 1, true);
  armGeo.rotateZ(-Math.PI / 2); armGeo.translate(.5, 0, 0); // along +X over 0..1
  const ac = new Float32Array(armGeo.attributes.position.count * 3); const cc = new T.Color('#b87333');
  for (let i = 0; i < ac.length; i += 3) { ac[i] = cc.r; ac[i + 1] = cc.g; ac[i + 2] = cc.b; }
  armGeo.setAttribute('color', new T.BufferAttribute(ac, 3)); armGeo.deleteAttribute('uv');
  const mk = (geo, max, name) => {
    const m = new T.InstancedMesh(geo, material, max);
    m.name = name; m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3); m.instanceColor.setUsage(T.DynamicDrawUsage);
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0; m.visible = false;
    return m;
  };
  const joints = mk(jointGeometry(T), MAX_JOINTS, 'pipe_joints'), arms = mk(armGeo, MAX_ARMS, 'pipe_arms');
  const m4 = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(), up = new T.Vector3(0, 1, 0), col = new T.Color();
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  function write(layout, y = .2) {
    const J = layout?.joints ?? [], A = layout?.arms ?? [];
    let n = 0;
    for (let i = 0; i < J.length && n < MAX_JOINTS; i++) {
      const [x, z, kind, wet] = J[i], k = JOINT_SCALE[kind] ?? 1;
      p.set(x * 2, y, z * 2); q.identity(); s.set(k, 1, k);
      joints.setMatrixAt(n, m4.compose(p, q, s)); joints.setColorAt(n, col.setHex(wet ? WET : DRY)); n++;
    }
    joints.count = n; joints.visible = n > 0; joints.instanceMatrix.needsUpdate = true; joints.instanceColor.needsUpdate = true;
    n = 0;
    for (let i = 0; i < A.length && n < MAX_ARMS; i++) {
      const [x, z, dir, start, len, wet] = A[i], r0 = start > 0 ? start - len : 0; // start 0: centre -> edge; start 1: edge -> inward by len
      p.set(x * 2 + DX[dir] * r0, y + PIPE_Y, z * 2 + DZ[dir] * r0); q.setFromAxisAngle(up, -dir * Math.PI / 2); s.set(len, 1, 1);
      arms.setMatrixAt(n, m4.compose(p, q, s)); arms.setColorAt(n, col.setHex(wet ? WET : DRY)); n++;
    }
    arms.count = n; arms.visible = n > 0; arms.instanceMatrix.needsUpdate = true; arms.instanceColor.needsUpdate = true;
  }
  function dispose() { joints.removeFromParent(); arms.removeFromParent(); joints.geometry.dispose(); arms.geometry.dispose(); material.dispose(); joints.dispose?.(); arms.dispose?.(); }
  return { joints, arms, material, write, dispose };
}

/** One translucent joint shown at the aimed tile while a pipe is held. setOk(bool) paints it green / red. */
export function createPipeGhost(T) {
  const mat = new T.MeshBasicMaterial({ color: '#9dffc0', transparent: true, opacity: .5, depthWrite: false });
  const m = new T.Mesh(jointGeometry(T), mat); m.name = 'pipe_ghost'; m.visible = false; m.renderOrder = 2;
  let ok = null;
  m.userData.setOk = v => { if (v !== ok) { ok = v; mat.color.set(v ? '#9dffc0' : '#ff8a73'); } };
  m.userData.dispose = () => { m.removeFromParent(); m.geometry.dispose(); mat.dispose(); };
  return m;
}
