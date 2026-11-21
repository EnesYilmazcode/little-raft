// Floating plastic resource: weathered milk jug. Pure procedural, no assets.
// createPlastic(T) -> THREE.Group (~0.65 x 0.7 x 0.4).
// The jug is one vertex-coloured mesh (one draw call). Its geometry is built once per THREE instance
// and cloned per call (each clone is owned by the returned mesh); the material is shared module-wide
// and never disposed (dispose() is a no-op so engine cleanup does not force shader recompiles).
// The engine floats the jug on its side with local -z up, so the content sits SINK toward +z: it rides
// about half submerged instead of perched on the waves. Callers that frame it re-center by bounds.
const SINK = 0.05;
const CACHE = new WeakMap();

function lin(T, hex) { const c = new T.Color(hex); return [c.r, c.g, c.b]; }
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function build(T) {
  const Z = 0.2 / 0.27; // depth squash -> 0.4 deep
  // Body profile (radius, y) with beveled base and shoulders.
  const prof = [
    [0.0, -0.35], [0.2, -0.35], [0.245, -0.343], [0.265, -0.325], [0.27, -0.3],
    [0.27, 0.08], [0.262, 0.125], [0.24, 0.155], [0.17, 0.205], [0.1, 0.24],
    [0.08, 0.255], [0.075, 0.27], [0.075, 0.29],
  ];
  const radiusAt = (y) => {
    for (let i = 1; i < prof.length; i++) {
      const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
      if (y <= y1 && y1 > y0) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
    }
    return 0.075;
  };
  const h = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  const white = lin(T, '#e4dfcf'), yellowed = lin(T, '#cfc6a8'), grime = lin(T, '#9c9682');
  const label = lin(T, '#b8695c'), labelFade = lin(T, '#d6b3a4');
  const capBlue = lin(T, '#5d84a8'), capFade = lin(T, '#8ea7bd');
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

  // 1. Hollow body (open neck) with dents, sun-yellowing, grime and a faded red label.
  const body = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 16);
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
      let c = mix(white, yellowed, 0.25 + 0.5 * n * Math.max(0, Math.sin(ang * 2 + 1)));
      c = mix(c, grime, (y < -0.27 ? 0.45 : 0) + 0.18 * Math.max(0, Math.sin(ang * 3 + y * 6)));
      // label band on the front face, scuffed
      if (y > -0.17 && y < 0.0 && Math.cos(ang) > 0.25) c = mix(label, labelFade, 0.25 + 0.6 * n);
      col.set(c, i * 3);
    }
    body.setAttribute('color', new T.BufferAttribute(col, 3));
  }
  const parts = [body];
  // 2. Neck lip ring.
  parts.push(paint(xf(new T.TorusGeometry(0.079, 0.008, 4, 10), 0, 0.268, 0, Math.PI / 2), white));
  // 3. Faded blue cap (slight tilt) + 4. tamper ring.
  parts.push(paint(xf(new T.CylinderGeometry(0.086, 0.09, 0.07, 14), 0, 0.315, 0, 0, 0, 0.03),
    (x, y) => mix(capBlue, capFade, y > 0.03 ? 0.55 : 0.15)));
  parts.push(paint(xf(new T.TorusGeometry(0.088, 0.007, 4, 14), 0, 0.283, 0, Math.PI / 2), capBlue));
  // 5. Handle loop (half torus bulging out on +x, ends buried in shoulder).
  parts.push(paint(xf(new T.TorusGeometry(0.085, 0.022, 5, 8, Math.PI), 0.228, 0.06, 0, 0, 0, -Math.PI / 2, 1, 1, 1.25), yellowed));
  // 6. Mold seam running up the -x side and across the base.
  const seamPts = [];
  for (let y = 0.24; y >= -0.345; y -= 0.02) seamPts.push(new T.Vector3(-radiusAt(y) - 0.002, y, 0));
  seamPts.push(new T.Vector3(0, -0.352, 0), new T.Vector3(radiusAt(-0.34), -0.352, 0));
  parts.push(paint(new T.TubeGeometry(new T.CatmullRomCurve3(seamPts), 12, 0.0035, 3, false), grime));

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

export function createPlastic(T) {
  let c = CACHE.get(T);
  if (!c) { c = build(T); c.geo.userData.shared = true; c.mat.userData.shared = true; CACHE.set(T, c); }
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
