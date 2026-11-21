// Held Stone Axe model (first-person). Original procedural low-poly meshes, no textures. ES module.
// Usage: import { createAxe } from './axe-model.js'; const g = createAxe(THREE);
// Orientation: handle along +Y, butt at -Y, head at +Y. The stone blade sticks out along -Z (forward,
// like the hammer's striking face), the lashing wraps the handle top. Length ~0.62.
// userData.grip  Vector3: where the right hand holds it (lower handle), in root space.
// userData.size  {x,y,z}: bounds.
// userData.edge  Vector3: middle of the cutting edge, in root space.
// No mesh casts shadows (viewmodel only). 5 meshes, ~200 triangles.

export function createAxe(T) {
  const root = new T.Group();
  root.name = 'stoneAxe';
  const mats = [], geos = [];
  const mat = (color, roughness, metalness = 0, flat = false) => { const m = new T.MeshStandardMaterial({ color, roughness, metalness, flatShading: flat }); mats.push(m); return m; };
  const add = (geo, m, x = 0, y = 0, z = 0) => {
    geos.push(geo);
    const mesh = new T.Mesh(geo, m); mesh.position.set(x, y, z);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    root.add(mesh); return mesh;
  };

  const L = 0.62, r = 0.02;
  const wood = mat(0xa87a4c, 0.88), lash = mat(0xcdb27a, 0.95), stone = mat(0xffffff, 0.75, 0.02, true);
  stone.vertexColors = true; // per-facet tones, see the head below
  stone.side = T.DoubleSide; // hand-wound wedge: flat shading lights it from screen derivatives either way

  // Handle: tapered driftwood with a gentle bend and a knob at the butt.
  const handle = add(new T.CylinderGeometry(r * 0.95, r * 1.15, L, 8, 4), wood);
  const pos = handle.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / L; pos.setZ(i, pos.getZ(i) + Math.sin((y + 0.5) * Math.PI) * 0.01); }
  pos.needsUpdate = true; handle.geometry.computeVertexNormals();
  add(new T.SphereGeometry(r * 1.4, 7, 5), wood, 0, -L / 2 + 0.01, 0);

  // Stone head: a chipped wedge (low-poly, flat shaded). Edge forward (-Z), back nub behind the handle.
  const headY = L / 2 - 0.07;
  const head = new T.BufferGeometry();
  // x = thickness, y = height, z = forward(-)/back(+)
  const v = [
    [0, 0.07, -0.19], [0, -0.075, -0.2],                  // 0,1 cutting edge top/bottom (thin)
    [0.032, 0.05, -0.06], [0.032, -0.045, -0.06],         // 2,3 cheek +x
    [-0.032, 0.05, -0.06], [-0.032, -0.045, -0.06],       // 4,5 cheek -x
    [0.026, 0.035, 0.05], [0.026, -0.03, 0.05],           // 6,7 butt +x
    [-0.026, 0.035, 0.05], [-0.026, -0.03, 0.05],         // 8,9 butt -x
  ];
  const f = [
    [0, 2, 3], [0, 3, 1], [0, 5, 4], [0, 1, 5],           // blade faces
    [2, 6, 7], [2, 7, 3], [4, 5, 9], [4, 9, 8],           // sides
    [0, 4, 8], [0, 8, 6], [0, 6, 2],                      // top
    [1, 3, 7], [1, 7, 9], [1, 9, 5],                      // bottom
    [6, 8, 9], [6, 9, 7],                                 // back
  ];
  const p = new Float32Array(f.length * 9);
  f.forEach((t, i) => t.forEach((k, j) => { p[i * 9 + j * 3] = v[k][0]; p[i * 9 + j * 3 + 1] = v[k][1]; p[i * 9 + j * 3 + 2] = v[k][2]; }));
  head.setAttribute('position', new T.BufferAttribute(p, 3)); head.computeVertexNormals();
  // Knapped-flint look: each facet a slightly different grey-brown, the worked cutting edge paler. One flat
  // grey read as a steel cleaver.
  const col = new Float32Array(p.length), base = new T.Color(0x8a8e88), edgeC = new T.Color(0xc4c8bf), c = new T.Color();
  f.forEach((t, i) => {
    const k = 0.84 + ((i * 7919) % 13) / 13 * 0.3;
    t.forEach((vi, j) => { c.copy(base).multiplyScalar(k); if (v[vi][2] < -0.15) c.lerp(edgeC, 0.75); col.set([c.r, c.g, c.b], i * 9 + j * 3); });
  });
  head.setAttribute('color', new T.BufferAttribute(col, 3));
  add(head, stone, 0, headY, 0);

  // Rope lashing: two crossed bands over the head and one round the handle under it.
  const band = add(new T.TorusGeometry(r * 1.5, 0.007, 4, 10), lash, 0, headY + 0.045, 0); band.rotation.x = Math.PI / 2;
  add(new T.CylinderGeometry(r * 1.3, r * 1.3, 0.05, 8, 1), lash, 0, headY - 0.07, 0);

  const grip = new T.Vector3(0, -L * 0.28, 0);
  root.userData.grip = grip;
  root.userData.size = { x: 0.07, y: L + 0.03, z: 0.27 };
  root.userData.edge = new T.Vector3(0, headY, -0.195);
  root.userData.dispose = () => { for (const g of new Set(geos)) g.dispose(); for (const m of mats) m.dispose(); };
  return root;
}
