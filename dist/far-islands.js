// Little Raft - a few far-off islands on an otherwise open horizon.
//   scene.add(createFarIslands(THREE, {haze:SKY.horizon, sunDirection}));
// Two or three lumpy, varied silhouettes 150-210 m out, already hazed toward the sky colour
// (they sit past the fog end, so they skip fog). One merged mesh, one draw call, no lights.

const SAND = '#e6d7a3', GRASS = '#4f9b72', ROCK = '#7d8a6a';
// [bearing (rad), distance (m), radius x, height, radius z, haze 0..1, seed]
const LAYOUT = [
  [0.9, 158, 13, 8, 8, 0.56, 3],
  [3.6, 182, 21, 6.5, 11, 0.62, 11],
  [5.2, 205, 9, 12, 7, 0.68, 23],
];

export function createFarIslands(T, {haze = '#c4dfeb', sunDirection, layout = LAYOUT} = {}) {
  const sky = new T.Color(haze), sun = new T.Vector3(-15, 28, 12).copy(sunDirection ?? new T.Vector3(-15, 28, 12)).normalize();
  const sand = new T.Color(SAND), grass = new T.Color(GRASS), rock = new T.Color(ROCK), c = new T.Color();
  const pos = [], col = [], v = new T.Vector3(), n = new T.Vector3();
  for (const [bearing, dist, rx, h, rz, k, seed] of layout) {
    const g = new T.IcosahedronGeometry(1, 3).toNonIndexed(), p = g.attributes.position;
    // A few overlapping bumps make an uneven ridge line instead of a dome.
    const bumps = [0, 1, 2, 3, 4].map(i => [Math.sin(seed * 7.1 + i * 2.3) * .75, Math.cos(seed * 3.7 + i * 1.9) * .5, .3 + .45 * Math.abs(Math.sin(seed * 1.3 + i * 2.1))]);
    const cx = Math.sin(bearing) * dist, cz = Math.cos(bearing) * dist, rot = seed * .9;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let lift = .12;
      for (const [bx, bz, s] of bumps) lift += s * Math.exp(-((v.x - bx) ** 2 + (v.z - bz) ** 2) * 7);
      const y = Math.max(v.y, -.05) * lift * 1.6 + Math.sin(v.x * 11 + seed) * Math.cos(v.z * 9) * .06;
      const x = v.x * rx, z = v.z * rz, ca = Math.cos(rot), sa = Math.sin(rot);
      p.setXYZ(i, cx + x * ca - z * sa, Math.max(y, 0) * h - .4, cz + x * sa + z * ca);
    }
    g.computeVertexNormals();
    const nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + .4;
      n.fromBufferAttribute(nr, i);
      c.copy(y < h * .08 ? sand : n.y < .55 ? rock : grass).multiplyScalar(.72 + .38 * Math.max(n.dot(sun), 0)).lerp(sky, k);
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  // Colours are authored in the sky's (sRGB) space like the sky shader, so skip tone mapping too.
  const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({vertexColors:true, fog:false, toneMapped:false}));
  mesh.name = 'far-islands'; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  return mesh;
}
