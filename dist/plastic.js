// Floating plastic resource: weathered pale-teal plastic jug. Pure procedural, no assets.
// createPlastic(T) -> THREE.Group (~0.65 x 0.7 x 0.4, centered on origin).
// Every jug is identical, so geometry and materials are built once per T and shared by all jugs
// (geometry/material.userData.shared = true): they must not be disposed when one jug is removed.

// Bake a flat color (sRGB hex -> linear) into a color attribute.
function tint(T, g, hex) {
  const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}

// Merge position/normal/color of several geometries into one non-indexed geometry. Disposes inputs.
function merge(T, geos) {
  const parts = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    col.set(p.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c;
    p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const SHARED = new WeakMap();

function buildJug(T) {
  const place = (g, x = 0, y = 0, z = 0, rx = 0, rz = 0, sz = 1) =>
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z),
      new T.Quaternion().setFromEuler(new T.Euler(rx, 0, rz)), new T.Vector3(1, 1, sz)));

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

  // 1. Hollow body (open neck, double-sided) with dents + weathered vertex tint.
  const bodyGeo = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 20);
  {
    const p = bodyGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const base = new T.Color(0x9fd0dc); // sun-bleached teal plastic, baked in (game.js tints per item)
    const h = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
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
      const grime = 0.86 + 0.1 * n - (y < -0.25 ? 0.08 : 0) - 0.04 * Math.max(0, Math.sin(ang * 2 + y * 5));
      col[i * 3] = grime * 0.96 * base.r; col[i * 3 + 1] = grime * 0.98 * base.g; col[i * 3 + 2] = grime * base.b;
    }
    bodyGeo.setAttribute('color', new T.BufferAttribute(col, 3));
    bodyGeo.computeVertexNormals();
  }
  const parts = [bodyGeo];

  // 2. Neck lip ring.
  parts.push(tint(T, place(new T.TorusGeometry(0.079, 0.008, 4, 12), 0, 0.268, 0, Math.PI / 2), 0x93c4d0));

  // 3. Blue cap with knurled edge (radial segments) and slight tilt.
  parts.push(tint(T, place(new T.CylinderGeometry(0.086, 0.09, 0.07, 20), 0, 0.315, 0, 0, 0.03), 0x2f6fc4));
  // 4. Cap tamper ring.
  parts.push(tint(T, place(new T.TorusGeometry(0.088, 0.007, 4, 12), 0, 0.283, 0, Math.PI / 2), 0x2f6fc4));

  // 5. Handle loop (half torus bulging out on +x, ends buried in shoulder).
  parts.push(tint(T, place(new T.TorusGeometry(0.085, 0.022, 6, 12, Math.PI), 0.228, 0.06, 0, 0, -Math.PI / 2, 1.25), 0x98cad6));

  // 6. Mold seam running up the -x side and across the base.
  const seamPts = [];
  for (let y = 0.24; y >= -0.345; y -= 0.02) seamPts.push(new T.Vector3(-radiusAt(y) - 0.002, y, 0));
  seamPts.push(new T.Vector3(0, -0.352, 0), new T.Vector3(radiusAt(-0.34), -0.352, 0));
  parts.push(tint(T, new T.TubeGeometry(new T.CatmullRomCurve3(seamPts), 12, 0.0035, 3, false), 0x86b8c6));

  const solidGeo = merge(T, parts);
  const solidMat = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide, roughness: 0.35, metalness: 0 });

  // 7. Light-blue creased plastic triangles on the front/back faces.
  const tris = [
    [[-0.12, 0.02], [0.02, -0.08], [-0.05, 0.07]],
    [[0.02, -0.08], [0.13, -0.02], [0.06, 0.05]],
    [[-0.16, -0.2], [-0.03, -0.15], [-0.1, -0.1]],
    [[0.05, -0.24], [0.17, -0.18], [0.09, -0.13]],
    [[-0.08, -0.05], [0.05, -0.12], [-0.02, -0.18]],
  ];
  const pos = [];
  const zOn = (x, y, s) => s * (Z * Math.sqrt(Math.max(0, radiusAt(y) ** 2 - x * x)) + 0.005);
  tris.forEach((t, i) => {
    const s = i % 2 === 0 ? 1 : -1; // alternate front/back
    const pts = s > 0 ? t : [t[0], t[2], t[1]];
    pts.forEach(([x, y]) => pos.push(x, y, zOn(x, y, s)));
  });
  const creaseGeo = new T.BufferGeometry();
  creaseGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  creaseGeo.computeVertexNormals();
  const creaseMat = new T.MeshStandardMaterial({
    color: 0xd8f0f4, transparent: true, opacity: 0.45, side: T.DoubleSide, forceSinglePass: true, roughness: 0.7, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
  });
  for (const x of [solidGeo, creaseGeo, solidMat, creaseMat]) x.userData.shared = true;
  return { solidGeo, solidMat, creaseGeo, creaseMat };
}

export function createPlastic(T) {
  let jug = SHARED.get(T);
  if (!jug) SHARED.set(T, (jug = buildJug(T)));
  const root = new T.Group();
  root.name = 'plastic';
  const body = new T.Mesh(jug.solidGeo, jug.solidMat);
  body.name = 'jugBody';
  body.castShadow = false; body.receiveShadow = true; // perf: floating jug shadows never land on the water
  const creases = new T.Mesh(jug.creaseGeo, jug.creaseMat);
  creases.castShadow = false; creases.receiveShadow = true;
  root.add(body, creases);
  root.userData.type = 'plastic';
  root.userData.size = { x: 0.65, y: 0.7, z: 0.4 };
  root.userData.dispose = () => {}; // shared resources: nothing per-jug to free
  return root;
}
