// Floating plastic resource: bright white jug with a blue cap, a carry handle and one coloured label band.
// Pure procedural, no assets.
// createPlastic(T, opts?) -> THREE.Group (~0.65 x 0.7 x 0.4). opts.seed picks the label colour
// (red / blue / yellow); without a seed successive calls cycle through the three.
// The jug is one vertex-coloured mesh (one draw call). Its three label variants are built once per THREE
// instance and shared by every jug (userData.shared, so the item batch draws them instanced); the material is shared module-wide
// and never disposed (dispose() is a no-op so engine cleanup does not force shader recompiles).
// The engine floats the jug on its side with local -z up, so the content sits SINK toward +z: it rides
// about half submerged instead of perched on the waves. Callers that frame it re-center by bounds.
const SINK = 0.05;
const CACHE = new WeakMap();
const LABELS = ['#d0493a', '#3fa0d0', '#e2b23a'];
let cycle = 0;

function lin(T, hex) { const c = new T.Color(hex); return [c.r, c.g, c.b]; }
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function build(T, labelHex) {
  const Z = 0.2 / 0.27; // depth squash -> 0.4 deep
  // Body profile (radius, y) with beveled base and shoulders.
  // Bottle silhouette: straight body, sloped shoulder, clearly narrow neck.
  const prof = [
    [0.0, -0.35], [0.18, -0.35], [0.225, -0.343], [0.245, -0.325], [0.25, -0.3], [0.25, -0.205], [0.25, -0.195], [0.25, -0.11],
    [0.25, -0.025], [0.25, -0.015], [0.25, 0.04], [0.243, 0.085], [0.22, 0.12], [0.15, 0.17], [0.085, 0.2],
    [0.066, 0.215], [0.062, 0.235], [0.062, 0.27],
  ];
  const radiusAt = (y) => {
    for (let i = 1; i < prof.length; i++) {
      const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
      if (y <= y1 && y1 > y0) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
    }
    return 0.062;
  };
  const h = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  const white = lin(T, '#f4f1e6'), cream = lin(T, '#e8e3d2'), grime = lin(T, '#c9c2ac');
  const label = lin(T, labelHex), labelFade = mix(label, white, 0.3);
  const capBlue = lin(T, '#2f7fc4'), capLight = lin(T, '#4a96d8');
  const paint = (g, fn) => {
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = typeof fn === 'function' ? fn(p.getX(i), p.getY(i), p.getZ(i)) : fn;
      col.set(c, i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  };
  const xf = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => g.applyMatrix4(new T.Matrix4().compose(
    new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz)));

  // 1. Hollow body (open neck) with light dents, faint wear and one coloured label band.
  const body = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 32);
  {
    const p = body.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      const ang = Math.atan2(x, z);
      if (r > 0.01 && y > -0.33 && y < 0.2) {
        const d = 0.006 * Math.sin(ang * 3 + y * 9) + 0.004 * Math.sin(ang * 7 - y * 17)
          - 0.018 * Math.max(0, Math.cos(ang - 2.2)) * Math.max(0, 1 - Math.abs(y + 0.08) / 0.12);
        const k = (r + d) / r;
        x *= k; z *= k;
      }
      p.setXYZ(i, x, y, z * Z);
      const n = h(Math.round(ang * 10), Math.round(y * 40));
      let c = mix(white, cream, 0.35 * n * Math.max(0, Math.sin(ang * 2 + 1)));
      c = mix(c, grime, (y < -0.3 ? 0.35 : 0) + 0.08 * Math.max(0, Math.sin(ang * 3 + y * 6)));
      // label band all the way round (the jug floats on its side, so any face may be up), lightly scuffed
      if (y > -0.2 && y < -0.02) c = mix(label, labelFade, n * n * 0.6);
      col.set(c, i * 3);
    }
    body.setAttribute('color', new T.BufferAttribute(col, 3));
  }
  const parts = [body];
  // 2. Neck lip ring.
  parts.push(paint(xf(new T.TorusGeometry(0.066, 0.008, 5, 18), 0, 0.24, 0, Math.PI / 2), white));
  // 3. Saturated blue screw cap (oversized so it reads at range) + 4. tamper ring.
  parts.push(paint(xf(new T.CylinderGeometry(0.082, 0.086, 0.08, 20), 0, 0.305, 0, 0, 0, 0.03),
    (x, y) => mix(capBlue, capLight, y > 0.035 ? 0.6 : 0)));
  parts.push(paint(xf(new T.TorusGeometry(0.08, 0.009, 5, 20), 0, 0.262, 0, Math.PI / 2), capBlue));
  // 5. Carry handle: a loop from the shoulder down the +x side, standing clear of the body.
  parts.push(paint(xf(new T.TorusGeometry(0.11, 0.024, 6, 16, Math.PI), 0.215, 0.03, 0, 0, 0, -Math.PI / 2, 1.1, 1, 1.3), cream));
  // 6. Mold seam running up the -x side and across the base.
  const seamPts = [];
  for (let y = 0.24; y >= -0.345; y -= 0.02) seamPts.push(new T.Vector3(-radiusAt(y) - 0.002, y, 0));
  seamPts.push(new T.Vector3(0, -0.352, 0), new T.Vector3(radiusAt(-0.34), -0.352, 0));
  parts.push(paint(new T.TubeGeometry(new T.CatmullRomCurve3(seamPts), 32, 0.0035, 3, false), grime));

  // merge (non-indexed) and normals
  body.computeVertexNormals();
  const flat = parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let count = 0;
  for (const g of flat) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    col.set(g.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c; g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.translate(0, 0, SINK);
  geo.computeBoundingSphere();

  const mat = new T.MeshStandardMaterial({ name: 'plastic_jug', vertexColors: true, roughness: 0.42, metalness: 0, side: T.DoubleSide });
  mat.dispose = () => {};
  return { geo, mat };
}

export function createPlastic(T, opts = {}) {
  let list = CACHE.get(T);
  if (!list) {
    let mat = null;
    list = LABELS.map((hex) => {
      const c = build(T, hex);
      if (mat) { c.mat = mat; } else mat = c.mat; // one material for every variant
      c.geo.userData.shared = true; c.mat.userData.shared = true;
      return c;
    });
    CACHE.set(T, list);
  }
  const v = opts.seed != null ? ((Math.floor(opts.seed) % LABELS.length) + LABELS.length) % LABELS.length : cycle++ % LABELS.length;
  const c = list[v];
  const root = new T.Group();
  root.name = 'plastic';
  const body = new T.Mesh(c.geo, c.mat); // shared geometry + material (userData.shared): nothing per jug to free
  body.name = 'jugBody';
  body.castShadow = false; body.receiveShadow = true; // perf: floating jug shadows never land on the water
  body.userData.batch = true; // shared geometry: debris.js createItemBatch may draw it instanced
  root.add(body);
  root.userData.type = 'plastic';
  root.userData.size = { x: 0.65, y: 0.7, z: 0.4 };
  root.userData.dispose = () => {};
  return root;
}
