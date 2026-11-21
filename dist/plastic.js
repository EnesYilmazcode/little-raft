// Floating plastic resource: weathered milk jug. Pure procedural, no assets.
// createPlastic(T) -> THREE.Group (~0.65 x 0.7 x 0.4, centered on origin).
export function createPlastic(T) {
  const root = new T.Group();
  root.name = 'plastic';
  const geometries = [];
  const materials = [];
  const own = (g) => (geometries.push(g), g);
  const mat = (o) => {
    const m = new T.MeshStandardMaterial(Object.assign({ roughness: 0.7, metalness: 0 }, o));
    materials.push(m);
    return m;
  };

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
  const bodyGeo = own(new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 40));
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
  const body = new T.Mesh(bodyGeo, mat({ color: 0xf2f0e6, vertexColors: true, side: T.DoubleSide }));
  body.name = 'jugBody';
  root.add(body);

  // 2. Neck lip ring.
  const lip = new T.Mesh(own(new T.TorusGeometry(0.079, 0.008, 6, 24)), mat({ color: 0xe8e6da }));
  lip.rotation.x = Math.PI / 2; lip.position.y = 0.268; lip.scale.set(1, 1, 1);
  root.add(lip);

  // 3. Blue cap with knurled edge (radial segments) and slight tilt.
  const blue = mat({ color: 0x2f6fc4 });
  const cap = new T.Mesh(own(new T.CylinderGeometry(0.086, 0.09, 0.07, 28)), blue);
  cap.position.y = 0.315; cap.rotation.z = 0.03;
  root.add(cap);
  // 4. Cap tamper ring.
  const ring = new T.Mesh(own(new T.TorusGeometry(0.088, 0.007, 6, 28)), blue);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.283;
  root.add(ring);

  // 5. Handle loop (half torus bulging out on +x, ends buried in shoulder).
  const handle = new T.Mesh(own(new T.TorusGeometry(0.085, 0.022, 8, 20, Math.PI)), mat({ color: 0xeeece0 }));
  handle.rotation.z = -Math.PI / 2; handle.position.set(0.228, 0.06, 0);
  handle.scale.set(1, 1, 1.25);
  root.add(handle);

  // 6. Mold seam running up the -x side and across the base.
  const seamPts = [];
  for (let y = 0.24; y >= -0.345; y -= 0.02) seamPts.push(new T.Vector3(-radiusAt(y) - 0.002, y, 0));
  seamPts.push(new T.Vector3(0, -0.352, 0), new T.Vector3(radiusAt(-0.34), -0.352, 0));
  const seam = new T.Mesh(
    own(new T.TubeGeometry(new T.CatmullRomCurve3(seamPts), 48, 0.0035, 4, false)),
    mat({ color: 0xdcdacb }));
  root.add(seam);

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
  const creaseGeo = own(new T.BufferGeometry());
  creaseGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  creaseGeo.computeVertexNormals();
  const creases = new T.Mesh(creaseGeo, mat({
    color: 0xa9d2ec, transparent: true, opacity: 0.55, side: T.DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
  }));
  root.add(creases);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.type = 'plastic';
  root.userData.size = { x: 0.65, y: 0.7, z: 0.4 };
  root.userData.dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };
  return root;
}
