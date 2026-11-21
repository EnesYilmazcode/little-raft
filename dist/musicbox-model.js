// [musicbox] Wind-up Music Box model (docs/specs/musicbox.md §2). Imports nothing: the caller passes THREE as T.
// Origin on the deck at the tile centre; 19 meshes; userData {lidPivot, cylinder, crank} are animated by musicbox.js.
// The body and the top trim are open trays (merged boxes) so the brass cylinder and comb show when the lid is up.

const NO_RAY = () => {};

// Merges a few BoxGeometries (each already translated) into one non-indexed geometry.
function mergeBoxes(T, boxes) {
  const parts = boxes.map(([w, h, d, x, y, z]) => new T.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed());
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = parts[0].attributes[name].itemSize;
    const n = parts.reduce((a, g) => a + g.attributes[name].array.length, 0), arr = new Float32Array(n);
    let o = 0; for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new T.BufferAttribute(arr, size));
  }
  for (const g of parts) g.dispose();
  out.computeBoundingSphere();
  return out;
}

// Hollow box: floor + 4 walls, outer size w x h x d, wall thickness t, bottom at y0.
const tray = (w, h, d, t, y0) => [
  [w, t, d, 0, y0 + t / 2, 0],
  [w, h, t, 0, y0 + h / 2, d / 2 - t / 2], [w, h, t, 0, y0 + h / 2, -d / 2 + t / 2],
  [t, h, d - 2 * t, w / 2 - t / 2, y0 + h / 2, 0], [t, h, d - 2 * t, -w / 2 + t / 2, y0 + h / 2, 0],
];
// Rectangular ring (no floor).
const ring = (w, h, d, t, y) => [
  [w, h, t, 0, y, d / 2 - t / 2], [w, h, t, 0, y, -d / 2 + t / 2],
  [t, h, d - 2 * t, w / 2 - t / 2, y, 0], [t, h, d - 2 * t, -w / 2 + t / 2, y, 0],
];

export function buildMusicBox(T) {
  const g = new T.Group(); g.name = 'craft_musicbox';
  const std = (color, roughness = 0.7, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
  const M = { wood: std('#bb8650', 0.72), dark: std('#8a5a33', 0.75), cream: std('#f1e4cf', 0.6), pink: std('#e8b9a8', 0.6),
    brass: std('#c9a24a', 0.35, 0.7), steel: std('#b8bcc4', 0.4, 0.6), amber: std('#ffbd66', 0.6), inside: std('#6b4529', 0.8) };
  const mesh = (geo, mat, parent, name, ray = false) => {
    const m = new T.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    if (name) m.name = name; if (!ray) m.raycast = NO_RAY;
    parent.add(m); return m;
  };

  // body: an open-topped tray .32 x .15 x .22 (its centre at y .075), dark inside floor felt
  const body = mesh(mergeBoxes(T, tray(0.32, 0.15, 0.22, 0.014, 0)), M.wood, g, 'body', true);
  body.userData.size = [0.32, 0.15, 0.22];
  mesh(new T.BoxGeometry(0.33, 0.02, 0.23), M.dark, g, 'trimBase').position.y = 0.01;
  mesh(mergeBoxes(T, ring(0.33, 0.02, 0.23, 0.018, 0.14)), M.dark, g, 'trimTop');

  // shell rosette on the front face: 5 cream petals around a pink centre
  const shellGeo = new T.SphereGeometry(0.018, 10, 8);
  const ctr = mesh(shellGeo, M.pink, g, 'shell'); ctr.position.set(0, 0.075, 0.111); ctr.scale.set(0.8, 0.8, 0.3);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 5, s = mesh(shellGeo, M.cream, g, 'shell');
    s.position.set(Math.cos(a) * 0.034, 0.075 + Math.sin(a) * 0.034, 0.111); s.scale.set(1, 1, 0.3);
  }

  // lid on a pivot at the back top edge; 3 cream ovals on its top face
  const lidPivot = new T.Group(); lidPivot.name = 'lidPivot'; lidPivot.position.set(0, 0.15, -0.11); g.add(lidPivot);
  const lid = mesh(new T.BoxGeometry(0.32, 0.02, 0.22), M.wood, lidPivot, 'lid', true); lid.position.set(0, 0.01, 0.11);
  for (let i = 0; i < 3; i++) { const o = mesh(shellGeo, M.cream, lid, 'inlay'); o.position.set((i - 1) * 0.08, 0.011, 0); o.scale.set(1.3, 0.3, 0.9); }

  // brass cylinder (axis along x) with 18 pins in a fixed pattern
  const cylinder = mesh(new T.CylinderGeometry(0.028, 0.028, 0.2, 14), M.brass, g, 'cylinder');
  cylinder.rotation.z = Math.PI / 2; cylinder.position.set(0, 0.1, -0.03);
  const pins = new T.InstancedMesh(new T.BoxGeometry(0.006, 0.006, 0.006), M.steel, 18);
  pins.name = 'pins'; pins.castShadow = false; pins.raycast = NO_RAY;
  const tmp = new T.Object3D();
  for (let i = 0; i < 18; i++) {
    const a = i * 2.399963, y = -0.09 + ((i * 7) % 18) * 0.0105;     // golden-angle spiral, spread along the axis
    tmp.position.set(Math.cos(a) * 0.029, y, Math.sin(a) * 0.029); tmp.rotation.set(0, -a, 0); tmp.updateMatrix();
    pins.setMatrixAt(i, tmp.matrix);
  }
  pins.instanceMatrix.needsUpdate = true; pins.computeBoundingSphere?.();
  cylinder.add(pins);

  // steel comb: a plate in front of the cylinder and 10 teeth touching it
  const comb = mesh(new T.BoxGeometry(0.2, 0.008, 0.05), M.steel, g, 'comb'); comb.position.set(0, 0.096, 0.03);
  const teeth = new T.InstancedMesh(new T.BoxGeometry(0.014, 0.004, 0.012), M.steel, 10);
  teeth.name = 'teeth'; teeth.castShadow = true; teeth.raycast = NO_RAY;
  for (let i = 0; i < 10; i++) { tmp.position.set(-0.09 + i * 0.02, 0, -0.03); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); teeth.setMatrixAt(i, tmp.matrix); }
  teeth.instanceMatrix.needsUpdate = true; teeth.computeBoundingSphere?.();
  comb.add(teeth);
  const well = mesh(new T.BoxGeometry(0.29, 0.004, 0.19), M.inside, g, 'felt'); well.position.y = 0.016; well.castShadow = false;

  // crank on the +x side: an arm hanging from the axle and an amber knob
  const crank = new T.Group(); crank.name = 'crank'; crank.position.set(0.172, 0.09, 0); g.add(crank);
  const arm = mesh(new T.BoxGeometry(0.008, 0.05, 0.008), M.brass, crank, 'crankArm'); arm.position.y = -0.02;
  const knob = mesh(new T.SphereGeometry(0.012, 10, 8), M.amber, crank, 'crankKnob'); knob.position.set(0.006, -0.045, 0);

  g.userData = { lidPivot, cylinder, crank, materials: Object.values(M) };
  return g;
}

/** Frees every geometry and material of a model from buildMusicBox (shared shell geometry is freed once). */
export function disposeMusicBox(g) {
  const seen = new Set();
  g?.traverse?.(o => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
  for (const m of g?.userData?.materials ?? []) m.dispose();
}

export default buildMusicBox;
