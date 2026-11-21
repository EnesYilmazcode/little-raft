// Little Raft - woven rope tube from the hand to the hook.
// A single preallocated BufferGeometry: fixed rings of a low-poly tube swept along
// the input polyline (resampled by arc length), oriented with a parallel-transport
// frame that also carries over from the previous update so the braid never spins.
// update() allocates nothing; all scratch storage is created once here.

const SIDES = 6;            // radial vertices per ring (hexagonal tube, smooth normals)
const MAX_RADIUS = 0.02;
const MIN_RADIUS = 0.002;
const EPS = 1e-6;

// Weathered mid-brown braid, about sRGB #8a7a64 / #5a4e40 (average near #726553), so the line reads as a
// dark stroke on bright water. Vertex colours are linear, hence the small numbers.
const TAN_LIGHT = [0.254, 0.195, 0.127];
const TAN_DARK = [0.102, 0.076, 0.051];

function finite3(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

export function createRope(T, { segments = 32, radius = 0.012 } = {}) {
  const segs = Math.max(2, Math.min(256, Math.floor(Number(segments)) || 32));
  const rings = segs + 1;
  const baseRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number.isFinite(radius) ? radius : 0.012));

  const tubeVerts = rings * SIDES;
  const capStart = tubeVerts;          // index of first cap center
  const vertCount = tubeVerts + 2;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  // --- static topology -------------------------------------------------------
  const indexCount = segs * SIDES * 6 + SIDES * 3 * 2;
  const IndexArray = vertCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(indexCount);
  let w = 0;
  for (let r = 0; r < segs; r++) {
    const a0 = r * SIDES, b0 = (r + 1) * SIDES;
    for (let s = 0; s < SIDES; s++) {
      const s1 = (s + 1) % SIDES;
      const a = a0 + s, b = a0 + s1, c = b0 + s, d = b0 + s1;
      indices[w++] = a; indices[w++] = b; indices[w++] = c;   // CCW seen from outside
      indices[w++] = b; indices[w++] = d; indices[w++] = c;
    }
  }
  // start cap (faces backwards along tangent), end cap (faces forward)
  const lastRing = (rings - 1) * SIDES;
  for (let s = 0; s < SIDES; s++) {
    const s1 = (s + 1) % SIDES;
    indices[w++] = capStart; indices[w++] = s1; indices[w++] = s;
    indices[w++] = capStart + 1; indices[w++] = lastRing + s; indices[w++] = lastRing + s1;
  }

  // --- static braid colours: a helical two-tone stripe implies twisted strands
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < SIDES; s++) {
      const phase = (s / SIDES) * 3 + r * 0.38;               // 3 strands, helical drift
      let k = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
      k = k * k * (3 - 2 * k);
      const fleck = ((r * 7 + s * 13) % 5) * 0.005;           // tiny fibre variation
      const o = (r * SIDES + s) * 3;
      for (let c = 0; c < 3; c++) colors[o + c] = TAN_DARK[c] + (TAN_LIGHT[c] - TAN_DARK[c]) * k - fleck;
    }
  }
  for (let c = 0; c < 3; c++) {
    const v = (TAN_LIGHT[c] + TAN_DARK[c]) * 0.5;
    colors[capStart * 3 + c] = v; colors[(capStart + 1) * 3 + c] = v;
  }

  const geometry = new T.BufferGeometry();
  const posAttr = new T.BufferAttribute(positions, 3);
  const nrmAttr = new T.BufferAttribute(normals, 3);
  posAttr.setUsage(T.DynamicDrawUsage);
  nrmAttr.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', nrmAttr);
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  // Culling is disabled; a fixed generous bound keeps raycast/helpers from recomputing.
  geometry.boundingSphere = new T.Sphere(new T.Vector3(), 1e4);

  const material = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'rope';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // --- scratch storage (reused every update) ---------------------------------
  let srcCap = 64;
  let srcX = new Float32Array(srcCap), srcY = new Float32Array(srcCap), srcZ = new Float32Array(srcCap);
  let srcL = new Float32Array(srcCap);
  const ringP = new Float32Array(rings * 3);
  const cosA = new Float32Array(SIDES), sinA = new Float32Array(SIDES);
  for (let s = 0; s < SIDES; s++) { const a = (s / SIDES) * Math.PI * 2; cosA[s] = Math.cos(a); sinA[s] = Math.sin(a); }

  const tan = new T.Vector3(), prevTan = new T.Vector3(), nrm = new T.Vector3(), bin = new T.Vector3();
  const lastNormal = new T.Vector3(0, 1, 0);   // carried across updates for temporal stability
  let hasLastNormal = false;
  let disposed = false;

  function hide() { mesh.visible = false; }

  function ensureCapacity(n) {
    if (n <= srcCap) return;
    // Rare (only if a caller passes >64 points); grows once, then stays allocated.
    srcCap = Math.max(n, srcCap * 2);
    srcX = new Float32Array(srcCap); srcY = new Float32Array(srcCap); srcZ = new Float32Array(srcCap);
    srcL = new Float32Array(srcCap);
  }

  // Any unit vector perpendicular to `t`, written into `out`.
  function anyPerpendicular(t, out) {
    const ax = Math.abs(t.x), ay = Math.abs(t.y), az = Math.abs(t.z);
    if (ay <= ax && ay <= az) out.set(-t.z, 0, t.x);       // cross(t, Y) style
    else if (ax <= az) out.set(0, t.z, -t.y);
    else out.set(t.y, -t.x, 0);
    const l = out.length();
    if (l < EPS) out.set(1, 0, 0); else out.multiplyScalar(1 / l);
    return out;
  }

  // Project `n` onto plane perpendicular to unit `t`; falls back if degenerate.
  function orthonormalize(n, t) {
    n.addScaledVector(t, -n.dot(t));
    const l = n.length();
    if (l < 1e-4 || !Number.isFinite(l)) anyPerpendicular(t, n); else n.multiplyScalar(1 / l);
  }

  function update(points, { tension = 0, visible = true } = {}) {
    if (disposed || !points || !visible || typeof points.length !== 'number' || points.length < 2) { hide(); return; }

    // 1. collect finite, non-duplicate points with cumulative arc length
    const len = points.length;
    ensureCapacity(len);
    let n = 0;
    for (let i = 0; i < len; i++) {
      const p = points[i];
      if (!finite3(p)) continue;
      if (n > 0) {
        const dx = p.x - srcX[n - 1], dy = p.y - srcY[n - 1], dz = p.z - srcZ[n - 1];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < EPS) continue;
        srcL[n] = srcL[n - 1] + d;
      } else srcL[0] = 0;
      srcX[n] = p.x; srcY[n] = p.y; srcZ[n] = p.z; n++;
    }
    if (n < 2) { hide(); return; }
    const total = srcL[n - 1];
    if (!(total > 1e-5) || !Number.isFinite(total)) { hide(); return; }

    // 2. resample to fixed ring centres, evenly spaced along arc length
    let k = 0;
    for (let r = 0; r < rings; r++) {
      const target = (r === rings - 1) ? total : total * r / segs;
      while (k < n - 2 && srcL[k + 1] < target) k++;
      const l0 = srcL[k], l1 = srcL[k + 1];
      const f = l1 > l0 ? Math.min(1, Math.max(0, (target - l0) / (l1 - l0))) : 0;
      const o = r * 3;
      ringP[o] = srcX[k] + (srcX[k + 1] - srcX[k]) * f;
      ringP[o + 1] = srcY[k] + (srcY[k + 1] - srcY[k]) * f;
      ringP[o + 2] = srcZ[k] + (srcZ[k + 1] - srcZ[k]) * f;
    }

    // 3. sweep rings with a parallel-transport frame
    const t01 = Math.min(1, Math.max(0, Number.isFinite(tension) ? tension : 0));
    const rad = Math.min(MAX_RADIUS, baseRadius * (1 - 0.12 * t01));   // taut rope thins slightly

    prevTan.set(ringP[3] - ringP[0], ringP[4] - ringP[1], ringP[5] - ringP[2]);
    if (prevTan.lengthSq() < EPS * EPS) prevTan.set(0, 0, 1); else prevTan.normalize();

    for (let r = 0; r < rings; r++) {
      const o = r * 3;
      const a = r > 0 ? r - 1 : 0, b = r < rings - 1 ? r + 1 : rings - 1;
      tan.set(ringP[b * 3] - ringP[a * 3], ringP[b * 3 + 1] - ringP[a * 3 + 1], ringP[b * 3 + 2] - ringP[a * 3 + 2]);
      const tl = tan.length();
      if (tl < EPS || !Number.isFinite(tl)) tan.copy(prevTan); else tan.multiplyScalar(1 / tl);

      if (r === 0) {
        if (hasLastNormal) nrm.copy(lastNormal); else anyPerpendicular(tan, nrm);
        orthonormalize(nrm, tan);
        lastNormal.copy(nrm); hasLastNormal = true;
      } else {
        orthonormalize(nrm, tan);   // transport previous ring's normal
      }
      bin.crossVectors(tan, nrm);   // unit since tan and nrm are orthonormal

      const px = ringP[o], py = ringP[o + 1], pz = ringP[o + 2];
      for (let s = 0; s < SIDES; s++) {
        const c = cosA[s], sn = sinA[s];
        const nx = nrm.x * c + bin.x * sn, ny = nrm.y * c + bin.y * sn, nz = nrm.z * c + bin.z * sn;
        const v = (r * SIDES + s) * 3;
        normals[v] = nx; normals[v + 1] = ny; normals[v + 2] = nz;
        positions[v] = px + nx * rad; positions[v + 1] = py + ny * rad; positions[v + 2] = pz + nz * rad;
      }

      if (r === 0) {
        const v = capStart * 3;
        positions[v] = px; positions[v + 1] = py; positions[v + 2] = pz;
        normals[v] = -tan.x; normals[v + 1] = -tan.y; normals[v + 2] = -tan.z;
      } else if (r === rings - 1) {
        const v = (capStart + 1) * 3;
        positions[v] = px; positions[v + 1] = py; positions[v + 2] = pz;
        normals[v] = tan.x; normals[v + 1] = tan.y; normals[v + 2] = tan.z;
      }
      prevTan.copy(tan);
    }

    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    mesh.visible = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mesh.visible = false;
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}

export default createRope;
