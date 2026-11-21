// Hook rope as a camera-facing ribbon: a thin hemp line, faintly braided, readable at 10 m (replaces the 1-px T.Line).
// createRopeMesh(T, maxPoints) -> { mesh, update(points, n), dispose() }. mesh.userData.update/dispose mirror them.
// Vertices sit on the rope centreline; the vertex shader pushes each pair sideways (perpendicular to the rope and
// the view ray), so the CPU only copies points. Half-width is ~7 mm, tapered to 60% within ~1.5 m of the camera so
// it does not balloon at the hand, and never under ~0.75 px (1.5 px wide) far away.
// One draw call, Lambert (follows sun / day-night), no shadows. All rope points are world space.

const COLOR = '#9a8460', HALF_WIDTH = .007, NEAR_TAPER = .6, TAPER_DIST = 1.5, MIN_HALF_PX = .75, BRAID_PITCH = .07; // metres per braid repeat

function braidTexture(T) { // 16x16 diagonal two-tone strands; mipmaps fade it to plain brown in the distance
  const S = 16, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = ((x + y) % 8) / 8, edge = Math.abs(x - 7.5) / 8; // diagonal strand phase, distance from ribbon centre
    const k = (d < .5 ? 1.04 - d * .3 : .86 + (d - .5) * .2) * (1 - edge * edge * .25); // light strand, soft groove
    const i = (y * S + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.min(255, Math.round(236 * k)); data[i + 3] = 255;
  }
  const tex = new T.DataTexture(data, S, S, T.RGBAFormat);
  tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = T.NoColorSpace; tex.needsUpdate = true; // a brightness mask, not a colour
  return tex;
}

export function createRopeMesh(T, maxPoints = 17) {
  const N = Math.max(2, maxPoints | 0), V = N * 2;
  const pos = new Float32Array(V * 3), dir = new Float32Array(V * 3), uv = new Float32Array(V * 2), side = new Float32Array(V), nrm = new Float32Array(V * 3);
  for (let i = 0; i < N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; uv[i * 4] = 0; uv[i * 4 + 2] = 1; nrm[i * 6 + 1] = nrm[i * 6 + 4] = 1; }
  const index = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new T.BufferGeometry();
  const posAttr = new T.BufferAttribute(pos, 3), dirAttr = new T.BufferAttribute(dir, 3), uvAttr = new T.BufferAttribute(uv, 2);
  for (const a of [posAttr, dirAttr, uvAttr]) a.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', posAttr); geo.setAttribute('ropeDir', dirAttr); geo.setAttribute('uv', uvAttr);
  geo.setAttribute('ropeSide', new T.BufferAttribute(side, 1)); geo.setAttribute('normal', new T.BufferAttribute(nrm, 3));
  geo.setIndex(index); geo.setDrawRange(0, 0);

  const map = braidTexture(T), viewH = { value: 720 }, size = new T.Vector2();
  const mat = new T.MeshLambertMaterial({ color: COLOR, map, side: T.DoubleSide });
  mat.onBeforeCompile = shader => {
    shader.uniforms.ropeViewH = viewH;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 ropeDir;\nattribute float ropeSide;\nuniform float ropeViewH;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        vec3 ropeT = normalize( ( modelViewMatrix * vec4( ropeDir, 0.0 ) ).xyz );
        vec3 ropeV = normalize( mvPosition.xyz );
        vec3 ropeN = cross( ropeT, ropeV );
        if ( dot( ropeN, ropeN ) < 1e-8 ) ropeN = cross( ropeV, vec3( 0.0, 1.0, 0.0 ) );
        float ropePx = 2.0 * max( -mvPosition.z, 0.01 ) / ( projectionMatrix[ 1 ][ 1 ] * ropeViewH );
        float ropeHalf = ${HALF_WIDTH.toFixed(4)} * mix( ${NEAR_TAPER.toFixed(2)}, 1.0, smoothstep( 0.0, ${TAPER_DIST.toFixed(2)}, length( mvPosition.xyz ) ) );
        mvPosition.xyz += normalize( ropeN ) * ropeSide * max( ropeHalf, ${MIN_HALF_PX.toFixed(2)} * ropePx );
        gl_Position = projectionMatrix * mvPosition;`);
    // DoubleSide would flip the up normal on back faces (the ribbon's winding depends on view side): keep it up.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => 'rope-ribbon-v2';

  const mesh = new T.Mesh(geo, mat);
  mesh.name = 'hookRope'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
  mesh.onBeforeRender = renderer => {
    renderer.getDrawingBufferSize(size);
    if (size.y > 0 && size.y !== viewH.value) { viewH.value = size.y; mat.uniformsNeedUpdate = true; }
  };

  function update(points, n = points.length) {
    n = Math.min(n | 0, points.length, N);
    if (n < 2) { geo.setDrawRange(0, 0); return; }
    let len = 0, tx = 1, ty = 0, tz = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      if (i > 0) len += Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      if (dx * dx + dy * dy + dz * dz > 1e-10) { tx = dx; ty = dy; tz = dz; } // else keep the last good tangent
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
        dir[v * 3] = tx; dir[v * 3 + 1] = ty; dir[v * 3 + 2] = tz;
        uv[v * 2 + 1] = len / BRAID_PITCH;
      }
    }
    posAttr.needsUpdate = dirAttr.needsUpdate = uvAttr.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }
  function dispose() { geo.dispose(); map.dispose(); mat.dispose(); }
  mesh.userData.update = update; mesh.userData.dispose = dispose;
  return { mesh, update, dispose };
}
