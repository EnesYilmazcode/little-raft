// Floating plastic resource: weathered milk jug. Pure procedural, no assets.
// createPlastic(T, opts?) -> THREE.Group (~0.65 x 0.7 x 0.4, centered on origin).
// Two meshes: the vertex-coloured jug (body, lip, cap, handle, seam) and the translucent creases.
// opts.shared: reuse one cached geometry set and module-wide materials (root and meshes get
// userData.shared = true: never dispose them). Otherwise root.userData.dispose() frees what it made.
let cached = null;

function makeMaterials(T) {
  return {
    jug: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: T.DoubleSide }),
    crease: new T.MeshStandardMaterial({
      color: 0xa9d2ec, roughness: 0.7, metalness: 0, transparent: true, opacity: 0.55, side: T.DoubleSide,
      forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    }),
  };
}

// Bake each part's transform and colour (material colour x existing colour attribute) into one geometry.
function bake(T, parts) {
  const geos = parts.map(([g, color, o]) => {
    o.updateMatrix();
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.applyMatrix4(o.matrix);
    const c = new T.Color(color), old = n.attributes.color, cnt = n.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = c.r * (old ? old.getX(i) : 1);
      col[i * 3 + 1] = c.g * (old ? old.getY(i) : 1);
      col[i * 3 + 2] = c.b * (old ? old.getZ(i) : 1);
    }
    n.setAttribute('color', new T.BufferAttribute(col, 3));
    return n;
  });
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const out = new T.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3]]) {
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new T.BufferAttribute(arr, size));
  }
  geos.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

function buildGeometry(T) {
  const parts = []; // [geometry, colour, transform holder]
  const at = () => new T.Object3D();

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
      col[i * 3] = grime * 0.98; col[i * 3 + 1] = grime * 0.97; col[i * 3 + 2] = grime * 0.9;
    }
    bodyGeo.setAttribute('color', new T.BufferAttribute(col, 3));
    bodyGeo.computeVertexNormals();
  }
  parts.push([bodyGeo, 0xf2f0e6, at()]);

  // 2. Neck lip ring.
  const lip = at();
  lip.rotation.x = Math.PI / 2; lip.position.y = 0.268;
  parts.push([new T.TorusGeometry(0.079, 0.008, 6, 24), 0xe8e6da, lip]);

  // 3. Blue cap with knurled edge (radial segments) and slight tilt.
  const blue = 0x2f6fc4;
  const cap = at();
  cap.position.y = 0.315; cap.rotation.z = 0.03;
  parts.push([new T.CylinderGeometry(0.086, 0.09, 0.07, 14), blue, cap]);
  // 4. Cap tamper ring.
  const ring = at();
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.283;
  parts.push([new T.TorusGeometry(0.088, 0.007, 6, 28), blue, ring]);

  // 5. Handle loop (half torus bulging out on +x, ends buried in shoulder).
  const handle = at();
  handle.rotation.z = -Math.PI / 2; handle.position.set(0.228, 0.06, 0);
  handle.scale.set(1, 1, 1.25);
  parts.push([new T.TorusGeometry(0.085, 0.022, 8, 20, Math.PI), 0xeeece0, handle]);

  // 6. Mold seam running up the -x side and across the base.
  const seamPts = [];
  for (let y = 0.24; y >= -0.345; y -= 0.02) seamPts.push(new T.Vector3(-radiusAt(y) - 0.002, y, 0));
  seamPts.push(new T.Vector3(0, -0.352, 0), new T.Vector3(radiusAt(-0.34), -0.352, 0));
  parts.push([new T.TubeGeometry(new T.CatmullRomCurve3(seamPts), 24, 0.0035, 3, false), 0xdcdacb, at()]);

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
  return { jug: bake(T, parts), crease: creaseGeo };
}

export function createPlastic(T, opts = {}) {
  const shared = !!opts.shared;
  let geos, mats;
  if (shared) {
    if (!cached) {
      cached = { geos: buildGeometry(T), mats: makeMaterials(T) };
      for (const m of Object.values(cached.mats)) { m.name = 'plastic-shared'; m.userData.shared = true; }
    }
    ({ geos, mats } = cached);
  } else { geos = buildGeometry(T); mats = makeMaterials(T); }
  const root = new T.Group();
  root.name = 'plastic';
  const body = new T.Mesh(geos.jug, mats.jug);
  body.name = 'jugBody';
  body.castShadow = true; body.receiveShadow = true;
  const creases = new T.Mesh(geos.crease, mats.crease);
  creases.receiveShadow = true;
  root.add(body, creases);
  root.userData.type = 'plastic';
  root.userData.size = { x: 0.65, y: 0.7, z: 0.4 };
  if (shared) {
    root.userData.shared = body.userData.shared = creases.userData.shared = true;
    root.userData.dispose = () => {};
  } else {
    root.userData.dispose = () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    };
  }
  return root;
}
