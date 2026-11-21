// Zipline models (docs/specs/zipline.md). THREE comes in as T. The post is built ONCE as a merged,
// vertex-coloured geometry; every post mesh shares it (1 draw call each). Origin = foot of the pole on the
// walk surface; the pulley top is at y = 2.0 (POST_H).
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

const WOOD = 0xa67c4e, DARK = 0x7a5233, ROPE = 0xd9c38c, METAL = 0x8d96a3;

function postGeometry(T) {
  const parts = [], m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
  function add(g, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    g = g.index ? g.toNonIndexed() : g;
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, s); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  add(new T.CylinderGeometry(.24, .3, .12, 10), DARK, 0, .06, 0);              // foot block
  add(new T.CylinderGeometry(.07, .09, 1.86, 8), WOOD, 0, 1.0, 0);             // pole
  for (const y of [.35, 1.55]) add(new T.CylinderGeometry(.1, .1, .07, 8), ROPE, 0, y, 0); // rope lashings
  add(new T.BoxGeometry(.7, .07, .09), DARK, 0, 1.78, 0);                      // crossbar
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.06, .3, .06), DARK, sx * .2, 1.65, 0, 0, 0, sx * .6); // braces
  add(new T.BoxGeometry(.05, .26, .2), METAL, 0, 1.9, 0);                      // pulley cheek
  add(new T.CylinderGeometry(.11, .11, .08, 14), METAL, 0, 2.0, 0, Math.PI / 2, 0, 0); // pulley wheel
  add(new T.CylinderGeometry(.04, .04, .1, 8), DARK, 0, 2.0, 0, Math.PI / 2, 0, 0);    // axle
  const g = mergeGeometries(T, parts); for (const x of parts) x.dispose();
  g.computeBoundingSphere();
  return g;
}

/** One shared kit: geometry and materials for all posts and lines. dispose() frees them. */
export function createZipKit(T) {
  const geo = postGeometry(T);
  const solid = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 });
  const ghostOk = new T.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: .45, depthWrite: false });
  const ghostBad = new T.MeshBasicMaterial({ color: 0xe0716b, transparent: true, opacity: .45, depthWrite: false });
  const rope = new T.MeshStandardMaterial({ color: ROPE, roughness: .9, metalness: 0 });
  const preview = new T.LineBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: .8 });
  for (const m of [solid, ghostOk, ghostBad, rope, preview]) m.userData.shared = true;
  geo.userData.shared = true;
  return {
    postModel() { const m = new T.Mesh(geo, solid); m.castShadow = true; m.userData.zip = true; return m; },
    ghost() { const m = new T.Mesh(geo, ghostOk); m.renderOrder = 2; m.visible = false; return m; },
    setGhost(m, ok) { m.material = ok ? ghostOk : ghostBad; },
    lineMesh(pts) {
      const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p.x, p.y, p.z)));
      const m = new T.Mesh(new T.TubeGeometry(curve, Math.max(8, pts.length * 2), .03, 6, false), rope);
      m.castShadow = true; return m;
    },
    previewLine() {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      const l = new T.Line(g, preview); l.frustumCulled = false; l.visible = false; return l;
    },
    dispose() { geo.dispose(); for (const m of [solid, ghostOk, ghostBad, rope, preview]) m.dispose(); },
  };
}

