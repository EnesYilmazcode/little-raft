// Glide Post, Low Glide Post, glide rope lines and the Glide Handle (see docs/specs/zipline.md section 7).
// Given THREE, imports nothing. Post origin = centre of the floor tile top (game.js places decor at y = .22).
// Static parts are merged into one vertex-coloured mesh per post, like dist/bees-model.js.

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    const c = new T.Color(hex), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    geos.push(g); n += cnt;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

function kit(T) {
  const parts = [], m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(1, 1, 1);
    parts.push([geo, hex, new T.Matrix4().copy(m4.compose(p, q, s))]);
  };
  return { parts, add };
}

const bodyMat = T => new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 });

/** A wooden mast on a foot plate with a horizontal grooved pulley; the groove centre sits at `top` (+ .22 deck offset). */
export function createGlidePost(T, top, name = top < 3 ? 'craft_glidestep' : 'craft_glidepost') {
  const g = new T.Group(); g.name = name;
  const { parts, add } = kit(T);
  const wheelY = top - .02; // decor sits at y = .22, deckY() is raft + .20: the wheel lands on deckY() + top
  // foot plate with four nail heads
  add(new T.BoxGeometry(.5, .06, .5), '#8b6a43', 0, .03, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.CylinderGeometry(.018, .018, .015, 6), '#5d564e', sx * .18, .065, sz * .18);
  // tapered mast
  const mastH = wheelY - .1;
  add(new T.CylinderGeometry(.07, .09, mastH, 6), '#a57a4c', 0, .06 + mastH / 2, 0);
  // two diagonal braces from the plate to the mast
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.04, .52, .05), '#8b6a43', sx * .15, .31, 0, 0, 0, sx * .27);
  // rope wrap ring at 1.2 m plus a second small lashing under the wheel
  add(new T.TorusGeometry(.085, .022, 5, 10), '#c9a66b', 0, 1.2, 0, Math.PI / 2);
  add(new T.TorusGeometry(.085, .022, 5, 10), '#c9a66b', 0, 1.27, 0, Math.PI / 2);
  add(new T.TorusGeometry(.078, .018, 5, 10), '#c9a66b', 0, wheelY - .16, 0, Math.PI / 2);
  // axle cap + hub disc + grooved pulley ring (horizontal, so it reads right in every link direction)
  add(new T.CylinderGeometry(.03, .03, .1, 6), '#6b5a4c', 0, wheelY - .03, 0);
  add(new T.CylinderGeometry(.1, .1, .035, 12), '#d9a86c', 0, wheelY, 0);
  add(new T.TorusGeometry(.12, .025, 5, 14), '#6b5a4c', 0, wheelY, 0, Math.PI / 2);
  add(new T.CylinderGeometry(.035, .035, .03, 8), '#6b4529', 0, wheelY + .03, 0);
  const mesh = new T.Mesh(bake(T, parts), bodyMat(T));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'post_body';
  g.add(mesh);
  g.userData.top = top;
  return g;
}

/** All glide lines as one LineSegments; game code rewrites positions in place and sets drawRange = 2 * count. */
export function createRopeLines(T, max) {
  const geo = new T.BufferGeometry();
  const attr = new T.BufferAttribute(new Float32Array(max * 6), 3); attr.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setDrawRange(0, 0);
  const lines = new T.LineSegments(geo, new T.LineBasicMaterial({ color: '#c9a66b' }));
  lines.name = 'glide_lines'; lines.frustumCulled = false;
  lines.userData.max = max;
  return lines;
}

/** Glide Handle: a T-bar grip with a short stem and a little wheel on top. Grip at the origin, long axis +Y. */
export function createHandle(T) {
  const g = new T.Group(); g.name = 'glidehandle';
  const { parts, add } = kit(T);
  // grip bar runs across (X); stem goes up (+Y) to the wheel
  add(new T.CylinderGeometry(.035, .035, .34, 8), '#a57a4c', 0, 0, 0, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) add(new T.CylinderGeometry(.04, .04, .05, 8), '#c9a66b', sx * .14, 0, 0, 0, 0, Math.PI / 2);
  add(new T.CylinderGeometry(.018, .022, .2, 6), '#c9a66b', 0, .11, 0);
  add(new T.BoxGeometry(.03, .05, .1), '#6b4529', 0, .22, 0);
  add(new T.TorusGeometry(.05, .015, 5, 12), '#6b5a4c', 0, .25, 0, 0, Math.PI / 2);
  add(new T.CylinderGeometry(.015, .015, .06, 6), '#d9a86c', 0, .25, 0, 0, 0, Math.PI / 2);
  const mesh = new T.Mesh(bake(T, parts), bodyMat(T)); mesh.name = 'handle_body';
  g.add(mesh);
  g.userData.grip = [0, 0, 0];
  return g;
}
